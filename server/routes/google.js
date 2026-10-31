// Google Calendar: connect the family's Google account, pick which calendars to show, and add,
// change or delete events on them from the hub. The sync itself lives in server/google/sync.js.
import { Router } from "express";
import { ah, requireFamily } from "./util.js";
import { HttpError, cleanText, log } from "../services/context.js";
import { isValidDate } from "../logic/dates.js";
import { getLink, toRow, eventBody, saveRow } from "../google/sync.js";

const ORIGIN_OK = /^(https:\/\/[^/\s]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** @param google  the Google service (server/google/index.js); null in test mode, undefined when not set up */
export function googleRouter({ db, google }) {
  const r = Router();

  const status = (req) => {
    const link = getLink(db);
    return {
      available: google !== null,    // false in test mode
      configured: !!google?.configured,
      connected: !!link,
      email: req.role === "family" ? link?.email ?? null : null,
      last_sync_at: link?.last_sync_at ?? null,
      last_error: link?.last_error ?? null,
      calendars: db.prepare("SELECT calendar_id, name, color, writable FROM google_calendars ORDER BY name").all().map((c) => ({ ...c, writable: !!c.writable })),
    };
  };
  const ready = () => {
    if (google === null) throw new HttpError(409, "Google Calendar is not available in test mode.");
    if (!google?.configured) throw new HttpError(409, "Google Calendar is not set up on the house computer yet (see docs/HOSTING.md).");
  };
  const linked = () => {
    ready();
    const link = getLink(db);
    if (!link) throw new HttpError(409, "Connect Google Calendar in Settings first.");
    return link;
  };
  const gapi = (link, method, path, opts) => google.client.request(link.refresh_token, method, path, opts).catch((e) => {
    throw new HttpError(e.status === 404 || e.status === 410 ? 404 : 502, e.status === 404 || e.status === 410 ? "That event is not in Google Calendar any more." : `Google Calendar said: ${e.message}`);
  });

  r.get("/google", (req, res) => res.json(status(req)));

  // Sign-in only works from an https address or from localhost: Google refuses other return addresses.
  r.post("/google/connect", ah(async (req, res) => {
    requireFamily(req);
    ready();
    const origin = String(req.body?.origin ?? "");
    if (!ORIGIN_OK.test(origin)) {
      throw new HttpError(400, "Google only allows connecting from the outside (https) address or from http://localhost. See docs/HOSTING.md.");
    }
    const redirectUri = `${origin}/api/google/callback`;
    res.json({ url: google.client.authUrl(redirectUri, google.begin(redirectUri)) });
  }));

  // Google sends the browser back here after the family agrees.
  r.get("/google/callback", ah(async (req, res) => {
    ready();
    const redirectUri = google.finish(String(req.query.state ?? ""));
    if (!redirectUri || req.query.error || !req.query.code) return res.redirect("/#/settings?google=failed");
    let refreshToken, email;
    try {
      ({ refreshToken, email } = await google.client.exchangeCode(String(req.query.code), redirectUri));
    } catch (e) {
      console.error("Google sign-in failed:", e.message);
      return res.redirect("/#/settings?google=failed");
    }
    const old = getLink(db);
    db.transaction(() => {
      if (old && old.email !== email) {
        // A different Google account: start over with its own calendars.
        db.prepare("DELETE FROM google_link").run();
        db.prepare("DELETE FROM google_calendars").run();
        db.prepare("DELETE FROM google_events").run();
        db.prepare("DELETE FROM google_visit_events").run();
      }
      db.prepare(`INSERT INTO google_link (id, email, refresh_token) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token, last_error = NULL`).run(email, refreshToken);
      log(db, "family", "google.connected", "google", null, { name: email ?? "" });
    })();
    await google.sync();
    res.redirect("/#/settings?google=connected");
  }));

  r.delete("/google", ah(async (req, res) => {
    requireFamily(req);
    ready();
    const link = getLink(db);
    if (link) await google.client.revoke(link.refresh_token);
    db.transaction(() => {
      for (const t of ["google_link", "google_calendars", "google_events", "google_visit_events"]) db.prepare(`DELETE FROM ${t}`).run();
      log(db, "family", "google.disconnected", "google", null, {});
    })();
    res.json(status(req));
  }));

  // All the calendars in the linked account, with which ones the hub shows.
  r.get("/google/calendars", ah(async (req, res) => {
    requireFamily(req);
    const link = linked();
    const list = await gapi(link, "GET", "/users/me/calendarList", { query: { maxResults: 250 } });
    const chosen = new Set(db.prepare("SELECT calendar_id FROM google_calendars").pluck().all());
    res.json((list.items ?? []).filter((c) => c.id !== link.hub_calendar_id).map((c) => ({
      calendar_id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor ?? null,
      writable: c.accessRole === "owner" || c.accessRole === "writer", selected: chosen.has(c.id), primary: !!c.primary,
    })));
  }));

  r.put("/google/calendars", ah(async (req, res) => {
    requireFamily(req);
    const link = linked();
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) throw new HttpError(400, "Pick the calendars to show.");
    const list = await gapi(link, "GET", "/users/me/calendarList", { query: { maxResults: 250 } });
    const pick = (list.items ?? []).filter((c) => ids.includes(c.id) && c.id !== link.hub_calendar_id);
    db.transaction(() => {
      db.prepare("DELETE FROM google_calendars").run();
      const ins = db.prepare("INSERT INTO google_calendars (calendar_id, name, color, writable) VALUES (?, ?, ?, ?)");
      for (const c of pick) ins.run(c.id, c.summaryOverride || c.summary, c.backgroundColor ?? null, c.accessRole === "owner" || c.accessRole === "writer" ? 1 : 0);
    })();
    await google.sync();
    res.json(status(req));
  }));

  r.post("/google/sync", ah(async (req, res) => {
    linked();
    await google.sync();
    res.json(status(req));
  }));

  // ---------- events on the family calendars ----------
  const writableCalendar = (id) => {
    const cal = db.prepare("SELECT * FROM google_calendars WHERE calendar_id = ?").get(id);
    if (!cal) throw new HttpError(400, "Pick one of the calendars shown in the hub.");
    if (!cal.writable) throw new HttpError(403, "That calendar is read-only in Google.");
    return cal;
  };
  const eventFrom = (b) => {
    const e = {
      title: cleanText(b?.title, { required: true, field: "The title", max: 200 }),
      date: b?.date,
      end_date: b?.end_date || b?.date,
      all_day: b?.all_day !== false,
      start: b?.start,
      end: b?.end,
      location: cleanText(b?.location, { max: 200, field: "The place" }),
      notes: cleanText(b?.notes, { max: 2000, field: "The notes" }),
    };
    if (!isValidDate(e.date) || !isValidDate(e.end_date) || e.end_date < e.date) throw new HttpError(400, "Pick the day (and an end day on or after it).");
    if (!e.all_day) {
      if (!TIME.test(e.start ?? "") || !TIME.test(e.end ?? "")) throw new HttpError(400, "Pick a start and end time.");
      if (e.end_date === e.date && e.end <= e.start) throw new HttpError(400, "The end time must be after the start time.");
    }
    return e;
  };
  const shown = (row) => {
    const cal = db.prepare("SELECT name, color FROM google_calendars WHERE calendar_id = ?").get(row.calendar_id);
    return { ...row, recurring: !!row.recurring, calendar_name: cal?.name ?? "", color: cal?.color ?? null };
  };

  r.post("/google/events", ah(async (req, res) => {
    const who = requireFamily(req);
    const link = linked();
    const cal = writableCalendar(req.body?.calendar_id);
    const e = eventFrom(req.body);
    const ev = await gapi(link, "POST", `/calendars/${encodeURIComponent(cal.calendar_id)}/events`, { body: eventBody(e) });
    const row = toRow(cal.calendar_id, ev);
    saveRow(db, row);
    log(db, who, "calendar.added", "calendar_event", null, { title: e.title, date: e.date });
    res.status(201).json(shown(row));
  }));

  // Changing an occurrence of a repeating event changes just that occurrence.
  r.patch("/google/events/:cal/:id", ah(async (req, res) => {
    const who = requireFamily(req);
    const link = linked();
    const cal = writableCalendar(req.params.cal);
    const e = eventFrom(req.body);
    const ev = await gapi(link, "PATCH", `/calendars/${encodeURIComponent(cal.calendar_id)}/events/${encodeURIComponent(req.params.id)}`, { body: eventBody(e) });
    const row = toRow(cal.calendar_id, ev);
    db.prepare("DELETE FROM google_events WHERE calendar_id = ? AND event_id = ?").run(cal.calendar_id, req.params.id);
    saveRow(db, row);
    log(db, who, "calendar.edited", "calendar_event", null, { title: e.title, date: e.date });
    res.json(shown(row));
  }));

  r.delete("/google/events/:cal/:id", ah(async (req, res) => {
    const who = requireFamily(req);
    const link = linked();
    const cal = writableCalendar(req.params.cal);
    const row = db.prepare("SELECT * FROM google_events WHERE calendar_id = ? AND event_id = ?").get(cal.calendar_id, req.params.id);
    await gapi(link, "DELETE", `/calendars/${encodeURIComponent(cal.calendar_id)}/events/${encodeURIComponent(req.params.id)}`).catch((e) => {
      if (e.status !== 404) throw e; // already gone: fine
    });
    db.prepare("DELETE FROM google_events WHERE calendar_id = ? AND event_id = ?").run(cal.calendar_id, req.params.id);
    log(db, who, "calendar.deleted", "calendar_event", null, { title: row?.title ?? "", date: row?.start_date });
    res.json({ ok: true });
  }));

  return r;
}

/** Family-calendar events between two dates (inclusive), for Home and the calendar. */
export function eventsBetween(db, from, to) {
  return db.prepare(`SELECT e.*, c.name AS calendar_name, c.color, c.writable FROM google_events e JOIN google_calendars c ON c.calendar_id = e.calendar_id
    WHERE e.start_date <= ? AND e.end_date >= ? ORDER BY e.start_date, e.start_time IS NOT NULL, e.start_time, e.title`).all(to, from)
    .map((e) => ({ ...e, recurring: !!e.recurring, writable: !!e.writable }));
}
