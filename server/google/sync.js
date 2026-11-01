// Two-way sync between the hub and Google Calendar. Runs about once a minute (server/index.js)
// and on "Sync now". Never runs for the test-mode sandbox.
//
// 1. Visit days ⇄ the hub's own Google calendar. Each day the housekeeper comes (or was due but is
//    out) has one all-day event. Edits made in Google flow back:
//      - delete a visit event     → that day becomes an out day (or an extra day is removed)
//      - add an event on a day    → extra visit day (or an out day is undone)
//      - move an event            → both of the above
//      - change its description   → the day note (or the out note)
//    Then the hub writes its own view of the next VISIT_DAYS days back to Google.
// 2. Family calendars → a local copy (google_events) that Home and the calendar read from.
import { addDays, isoWeekday, localDate } from "../logic/dates.js";
import { isRegularVisitDay } from "../logic/visits.js";
import { loadContext, log } from "../services/context.js";
import { sync } from "../services/sync.js";
import { isRevoked } from "./client.js";

export const VISIT_DAYS = 56;           // visit days written to Google
export const EVENTS_BACK = 7;           // family events copied: a week back...
export const EVENTS_AHEAD = 62;         // ...to about two months ahead
const TAG = { houseHub: "visit" };      // marks the hub's own events

const p2 = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const houseTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const getLink = (db) => db.prepare("SELECT * FROM google_link WHERE id = 1").get() ?? null;

/** The date an event starts on, in the house's time zone. */
function eventDate(ev) {
  if (ev.start?.date) return ev.start.date;
  if (ev.start?.dateTime) return localDate(new Date(ev.start.dateTime));
  return null;
}

/** A Google event as a google_events row (dates/times in the house's time zone, end inclusive). */
export function toRow(calendarId, ev) {
  const base = { calendar_id: calendarId, event_id: ev.id, title: ev.summary || "(no title)", location: ev.location ?? "", notes: ev.description ?? "", recurring: ev.recurringEventId ? 1 : 0 };
  if (ev.start.date) {
    const end = addDays(ev.end?.date ?? addDays(ev.start.date, 1), -1);
    return { ...base, start_date: ev.start.date, end_date: end < ev.start.date ? ev.start.date : end, start_time: null, end_time: null };
  }
  const s = new Date(ev.start.dateTime);
  const e = new Date(ev.end?.dateTime ?? ev.start.dateTime);
  return { ...base, start_date: localDate(s), end_date: localDate(e) < localDate(s) ? localDate(s) : localDate(e), start_time: hhmm(s), end_time: hhmm(e) };
}

/** The Google event body for an event typed into the hub. */
export function eventBody(e, tz = houseTimeZone()) {
  const end = e.end_date || e.date;
  const when = e.all_day
    ? { start: { date: e.date }, end: { date: addDays(end, 1) } }
    : { start: { dateTime: `${e.date}T${e.start}:00`, timeZone: tz }, end: { dateTime: `${end}T${e.end}:00`, timeZone: tz } };
  return { summary: e.title, location: e.location ?? "", description: e.notes ?? "", ...when };
}

const saveRow = (db, r) => db.prepare(`INSERT INTO google_events (calendar_id, event_id, title, start_date, end_date, start_time, end_time, location, notes, recurring)
  VALUES (@calendar_id, @event_id, @title, @start_date, @end_date, @start_time, @end_time, @location, @notes, @recurring)
  ON CONFLICT(calendar_id, event_id) DO UPDATE SET title = excluded.title, start_date = excluded.start_date, end_date = excluded.end_date,
    start_time = excluded.start_time, end_time = excluded.end_time, location = excluded.location, notes = excluded.notes, recurring = excluded.recurring`).run(r);
export { saveRow };

async function listAll(req, calendarId, query) {
  const items = [];
  let pageToken;
  let nextSyncToken;
  do {
    const page = await req("GET", `/calendars/${encodeURIComponent(calendarId)}/events`, { query: { ...query, pageToken, maxResults: 250 } });
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
    nextSyncToken = page.nextSyncToken ?? nextSyncToken;
  } while (pageToken);
  return { items, nextSyncToken };
}

// ---------- 1. visit days ----------

/** What the hub wants each visit day's event to say. */
function wantedVisits(db, today) {
  const ctx = loadContext(db, today);
  const name = db.prepare("SELECT name FROM members WHERE role = 'housekeeper' AND removed_at IS NULL ORDER BY sort, id LIMIT 1").pluck().get() ?? "Housekeeper";
  const outs = new Map(db.prepare("SELECT date, note FROM day_overrides WHERE date >= ?").all(today).map((o) => [o.date, o.note]));
  const notes = new Map(db.prepare("SELECT date, note FROM day_notes WHERE date >= ?").all(today).map((n) => [n.date, n.note]));
  const want = new Map();
  for (let i = 0; i < VISIT_DAYS; i++) {
    const d = addDays(today, i);
    if (!isRegularVisitDay(d, ctx)) continue;
    const out = outs.has(d);
    want.set(d, {
      summary: out ? `${name}: not coming` : ctx.extraDays.has(d) ? `${name} (extra day)` : name,
      description: out ? outs.get(d) ?? "" : notes.get(d) ?? "",
    });
  }
  return want;
}

/** Apply edits made in Google to the hub. Returns true if anything changed. */
function applyInbound(db, today, items) {
  const ctx = loadContext(db, today);
  const byEvent = db.prepare("SELECT * FROM google_visit_events WHERE event_id = ?");
  const byDate = db.prepare("SELECT * FROM google_visit_events WHERE date = ?");
  const isOut = (d) => !!db.prepare("SELECT 1 FROM day_overrides WHERE date = ?").get(d);
  const closed = (d) => !!db.prepare("SELECT 1 FROM visit_closures WHERE date = ?").get(d);
  const weekly = (d) => !!db.prepare("SELECT 1 FROM schedule WHERE weekday = ? AND active = 1").get(isoWeekday(d));
  const via = { via: "google" };
  let changed = false;

  const removeDay = (d) => {
    if (d < today || closed(d)) return;
    if (ctx.extraDays.has(d) && !weekly(d)) {
      db.prepare("DELETE FROM extra_visits WHERE date = ?").run(d);
      log(db, "family", "day.extra_removed", "day", null, { date: d, ...via });
    } else if (weekly(d) && !isOut(d)) {
      db.prepare("INSERT INTO day_overrides (date, reason, mode, note, created_by) VALUES (?, 'other', 'shift', '', 'family')").run(d);
      log(db, "family", "day.out", "day", null, { date: d, reason: "other", mode: "shift", ...via });
    }
    changed = true;
  };
  const addDay = (d) => {
    if (d < today) return;
    if (isOut(d)) {
      db.prepare("DELETE FROM day_overrides WHERE date = ?").run(d);
      log(db, "family", "day.out_undone", "day", null, { date: d, ...via });
    } else if (!weekly(d) && !ctx.extraDays.has(d)) {
      db.prepare("INSERT INTO extra_visits (date, created_by) VALUES (?, 'family') ON CONFLICT(date) DO NOTHING").run(d);
      log(db, "family", "day.extra", "day", null, { date: d, ...via });
    }
    changed = true;
  };
  const setNote = (d, text) => {
    if (d < today) return;
    const note = String(text ?? "").trim().slice(0, 300);
    if (isOut(d)) {
      db.prepare("UPDATE day_overrides SET note = ? WHERE date = ?").run(note.slice(0, 200), d);
    } else if (note) {
      db.prepare(`INSERT INTO day_notes (date, note, updated_by, updated_at) VALUES (?, ?, 'family', ?)
        ON CONFLICT(date) DO UPDATE SET note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(d, note, new Date().toISOString());
    } else {
      db.prepare("DELETE FROM day_notes WHERE date = ?").run(d);
    }
    log(db, "family", note ? "day.noted" : "day.note_removed", "day", null, { date: d, ...via });
    changed = true;
  };

  for (const ev of items) {
    const mine = byEvent.get(ev.id);
    if (mine && mine.etag && mine.etag === ev.etag) continue; // the hub's own write coming back
    if (ev.status === "cancelled") {
      if (!mine) continue;
      db.prepare("DELETE FROM google_visit_events WHERE event_id = ?").run(ev.id);
      removeDay(mine.date);
      continue;
    }
    const d = eventDate(ev);
    if (!d) continue;
    if (mine && mine.date !== d) {
      // Moved to another day: the old day is off, the new one is on.
      db.prepare("DELETE FROM google_visit_events WHERE event_id = ?").run(ev.id);
      removeDay(mine.date);
    }
    if (!mine || mine.date !== d) {
      if (byDate.get(d)) continue; // that day already has its event; leave the extra one alone
      addDay(d);
      db.prepare("INSERT INTO google_visit_events (date, event_id, summary, description, etag) VALUES (?, ?, ?, ?, ?)")
        .run(d, ev.id, ev.summary ?? "", "", ev.etag ?? null);
      if (ev.description) setNote(d, ev.description);
      continue;
    }
    // Same day, edited in Google: the description is the note. (The title is the hub's to write.)
    if ((ev.description ?? "") !== mine.description) setNote(d, ev.description);
    db.prepare("UPDATE google_visit_events SET etag = ?, description = ? WHERE event_id = ?").run(ev.etag ?? null, ev.description ?? "", ev.id);
  }
  return changed;
}

async function syncVisits(db, req, link, today) {
  // Changes made in Google since the last sync (all events the first time).
  let listed;
  try {
    listed = await listAll(req, link.hub_calendar_id, link.sync_token ? { syncToken: link.sync_token, showDeleted: true } : { timeMin: `${addDays(today, -1)}T00:00:00Z`, showDeleted: true, singleEvents: true });
  } catch (e) {
    if (e.status === 404) {
      // Someone deleted the hub's calendar in Google: make a new one next time.
      db.prepare("UPDATE google_link SET hub_calendar_id = NULL, sync_token = NULL WHERE id = 1").run();
      db.prepare("DELETE FROM google_visit_events").run();
      return;
    }
    if (e.status !== 410) throw e; // 410: Google forgot the sync token; start over
    db.prepare("UPDATE google_link SET sync_token = NULL WHERE id = 1").run();
    listed = await listAll(req, link.hub_calendar_id, { timeMin: `${addDays(today, -1)}T00:00:00Z`, showDeleted: true, singleEvents: true });
  }
  if (link.sync_token && db.transaction(() => applyInbound(db, today, listed.items))()) sync(db, today);

  // Then write the hub's view back.
  const want = wantedVisits(db, today);
  const have = new Map(db.prepare("SELECT * FROM google_visit_events WHERE date >= ?").all(today).map((r) => [r.date, r]));
  const path = `/calendars/${encodeURIComponent(link.hub_calendar_id)}/events`;
  const remember = db.prepare(`INSERT INTO google_visit_events (date, event_id, summary, description, etag) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET event_id = excluded.event_id, summary = excluded.summary, description = excluded.description, etag = excluded.etag`);
  for (const [d, w] of want) {
    const cur = have.get(d);
    if (cur && cur.summary === w.summary && cur.description === w.description) continue;
    const body = { summary: w.summary, description: w.description, start: { date: d }, end: { date: addDays(d, 1) }, transparency: "transparent", extendedProperties: { private: TAG } };
    let ev;
    if (cur) {
      try {
        ev = await req("PATCH", `${path}/${encodeURIComponent(cur.event_id)}`, { body });
      } catch (e) {
        if (e.status !== 404 && e.status !== 410) throw e;
        ev = await req("POST", path, { body }); // deleted in Google meanwhile: put it back
      }
    } else {
      ev = await req("POST", path, { body });
    }
    remember.run(d, ev.id, w.summary, w.description, ev.etag ?? null);
  }
  for (const [d, cur] of have) {
    if (want.has(d)) continue;
    try { await req("DELETE", `${path}/${encodeURIComponent(cur.event_id)}`); } catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
    db.prepare("DELETE FROM google_visit_events WHERE date = ?").run(d);
  }
  db.prepare("DELETE FROM google_visit_events WHERE date < ?").run(addDays(today, -30));

  // Catch up the sync token past our own writes, so next time only others' edits come back.
  // Anything listed here that is not ours (etag differs) is applied on the next run.
  const after = await listAll(req, link.hub_calendar_id, listed.nextSyncToken ? { syncToken: listed.nextSyncToken, showDeleted: true } : { timeMin: `${addDays(today, -1)}T00:00:00Z`, showDeleted: true, singleEvents: true });
  if (db.transaction(() => applyInbound(db, today, after.items))()) sync(db, today);
  db.prepare("UPDATE google_link SET sync_token = ? WHERE id = 1").run(after.nextSyncToken ?? listed.nextSyncToken ?? null);
}

// ---------- 2. family calendars ----------

async function syncFamily(db, req, today) {
  const cals = db.prepare("SELECT calendar_id FROM google_calendars").pluck().all();
  const from = `${addDays(today, -EVENTS_BACK)}T00:00:00Z`;
  const to = `${addDays(today, EVENTS_AHEAD)}T00:00:00Z`;
  for (const cal of cals) {
    const { items } = await listAll(req, cal, { timeMin: from, timeMax: to, singleEvents: true, orderBy: "startTime" });
    db.transaction(() => {
      db.prepare("DELETE FROM google_events WHERE calendar_id = ?").run(cal);
      for (const ev of items) if (ev.status !== "cancelled" && ev.start) saveRow(db, toRow(cal, ev));
    })();
  }
  db.prepare(`DELETE FROM google_events WHERE calendar_id NOT IN (SELECT calendar_id FROM google_calendars)`).run();
}

/** Create the hub's own calendar the first time. */
async function ensureHubCalendar(db, req, link) {
  if (link.hub_calendar_id) return link;
  const name = db.prepare("SELECT name FROM members WHERE role = 'housekeeper' AND removed_at IS NULL ORDER BY sort, id LIMIT 1").pluck().get() ?? "Housekeeper";
  const cal = await req("POST", "/calendars", { body: { summary: `${name}'s visits (House Hub)`, description: "Kept up to date by House Hub. Delete a day to mark it out; add an all-day event to add an extra day.", timeZone: houseTimeZone() } });
  db.prepare("UPDATE google_link SET hub_calendar_id = ?, sync_token = NULL WHERE id = 1").run(cal.id);
  db.prepare("DELETE FROM google_visit_events").run();
  return getLink(db);
}

/** One full sync. Returns { ok, error }. Never throws. */
export async function syncGoogle(db, client, today) {
  let link = getLink(db);
  if (!link || !client?.configured) return { ok: false, error: null };
  const req = (method, path, opts) => client.request(link.refresh_token, method, path, opts);
  try {
    link = await ensureHubCalendar(db, req, link);
    await syncVisits(db, req, link, today);
    await syncFamily(db, req, today);
    db.prepare("UPDATE google_link SET last_sync_at = ?, last_error = NULL WHERE id = 1").run(new Date().toISOString());
    return { ok: true, error: null };
  } catch (e) {
    const error = isRevoked(e) ? "Google access was removed. Connect Google Calendar again in Settings." : `Google Calendar: ${e.message}`;
    if (getLink(db)) db.prepare("UPDATE google_link SET last_error = ? WHERE id = 1").run(error);
    if (!isRevoked(e)) console.error("Google sync failed:", e);
    return { ok: false, error };
  }
}
