import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../server/db/index.js";
import { createHub } from "../server/hub.js";
import { createGoogle } from "../server/google/index.js";
import { boot } from "./helpers.js";
import { fakeGoogle } from "./fake-google.js";

// Thu 2026-10-15. Visits are Mon/Thu/Sat.
const TODAY = "2026-10-15";

async function bootGoogle({ nudgeMs = 0 } = {}) {
  const fake = fakeGoogle();
  const db = openDb(":memory:");
  const now = () => new Date(`${TODAY}T09:00:00`);
  const google = createGoogle(db, { clientId: "cid", clientSecret: "secret", today: () => TODAY, fetchImpl: fake.fetch, nudgeMs });
  const server = createHub(db, { now, google }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, role = "family", extra = {}) => {
    const res = await fetch(base + path, {
      method, redirect: "manual",
      headers: { "content-type": "application/json", ...(role ? { "x-role": role } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* redirect or empty */ }
    return { status: res.status, body: json, location: res.headers.get("location") };
  };
  const app = {
    fake, db,
    get: (p, role, extra) => call("GET", p, undefined, role, extra),
    post: (p, b, role, extra) => call("POST", p, b ?? {}, role, extra),
    patch: (p, b, role) => call("PATCH", p, b ?? {}, role),
    put: (p, b, role) => call("PUT", p, b ?? {}, role),
    del: (p, role) => call("DELETE", p, undefined, role),
    close: () => new Promise((r) => server.close(r)),
    async connect() {
      const { body } = await app.post("/api/google/connect", { origin: "http://localhost:3222" });
      const state = new URL(body.url).searchParams.get("state");
      return app.get(`/api/google/callback?code=good-code&state=${state}`, null);
    },
    hubCal: () => db.prepare("SELECT hub_calendar_id FROM google_link").pluck().get(),
    visitEvent: (date) => fake.events(app.hubCal()).find((e) => e.start.date === date),
  };
  return app;
}

test("google: off until set up; never available in test mode", async () => {
  const plain = await boot();
  try {
    const s = (await plain.get("/api/google")).body;
    assert.equal(s.configured, false);
    assert.equal(s.connected, false);
    assert.equal((await plain.post("/api/google/connect", { origin: "http://localhost:3222" })).status, 409);
    assert.deepEqual((await plain.get("/api/home")).body.events, []);
  } finally { await plain.close(); }

  const app = await bootGoogle();
  try {
    await app.connect();
    assert.equal((await app.post("/api/test-mode", { date: "2026-10-20" })).status, 200);
    const test = { "x-test-mode": "1" };
    assert.equal((await app.get("/api/google", "family", test)).body.available, false);
    const before = app.fake.calls.length;
    assert.equal((await app.post("/api/google/sync", {}, "family", test)).status, 409);
    assert.equal((await app.post("/api/days-out", { date: "2026-10-22" }, "housekeeper", test)).status, 201);
    assert.equal(app.fake.calls.length, before, "test mode made no Google calls");
    await app.del("/api/test-mode");
  } finally { await app.close(); }
});

test("google: connecting needs the family, an allowed address and a matching sign-in", async () => {
  const app = await bootGoogle();
  try {
    assert.equal((await app.post("/api/google/connect", { origin: "http://localhost:3222" }, "housekeeper")).status, 403);
    assert.equal((await app.post("/api/google/connect", { origin: "http://house.lan" })).status, 400);
    const ok = await app.post("/api/google/connect", { origin: "https://hub.example.com" });
    assert.match(ok.body.url, /redirect_uri=https%3A%2F%2Fhub.example.com%2Fapi%2Fgoogle%2Fcallback/);
    assert.match(ok.body.url, /access_type=offline/);
    assert.equal((await app.get("/api/google/callback?code=good-code&state=forged", null)).location, "/#/settings?google=failed");
    assert.equal((await app.get("/api/google")).body.connected, false);

    const done = await app.connect();
    assert.equal(done.location, "/#/settings?google=connected");
    const s = (await app.get("/api/google")).body;
    assert.equal(s.connected, true);
    assert.equal(s.email, "bill@example.com");
    assert.equal((await app.get("/api/google", "housekeeper")).body.email, null);
    assert.ok(s.last_sync_at);
  } finally { await app.close(); }
});

test("google: visit days go to the hub's own calendar and follow changes made in the hub", async () => {
  const app = await bootGoogle();
  try {
    await app.connect();
    const hubCal = app.hubCal();
    assert.ok(hubCal);
    assert.match(app.fake.calendars.get(hubCal).summary, /Gladis's visits/);
    const evs = app.fake.events(hubCal);
    assert.ok(evs.length >= 20 && evs.length <= 25, `about 8 weeks of Mon/Thu/Sat, got ${evs.length}`);
    assert.equal(app.visitEvent("2026-10-17").summary, "Gladis");
    assert.equal(app.visitEvent("2026-10-17").end.date, "2026-10-18");
    assert.equal(app.visitEvent("2026-10-16"), undefined, "Friday is not a visit day");

    await app.post("/api/days-out", { date: "2026-10-17", note: "Dentist" }, "housekeeper");
    await app.put("/api/day-notes/2026-10-19", { note: "Coming at 11" }, "housekeeper");
    await app.post("/api/extra-days", { date: "2026-10-21" });
    await app.post("/api/google/sync");
    assert.equal(app.visitEvent("2026-10-17").summary, "Gladis: not coming");
    assert.equal(app.visitEvent("2026-10-17").description, "Dentist");
    assert.equal(app.visitEvent("2026-10-19").description, "Coming at 11");
    assert.equal(app.visitEvent("2026-10-21").summary, "Gladis (extra day)");

    // Nothing changed: a sync writes nothing.
    const v = app.fake.version;
    await app.post("/api/google/sync");
    assert.equal(app.fake.version, v);

    await app.del("/api/extra-days/2026-10-21");
    await app.post("/api/google/sync");
    assert.equal(app.visitEvent("2026-10-21"), undefined);
  } finally { await app.close(); }
});

test("google: edits made in Google Calendar change the hub's visit days and notes", async () => {
  const app = await bootGoogle();
  try {
    await app.connect();
    const hubCal = app.hubCal();
    const schedule = async () => (await app.get("/api/schedule")).body;

    // Deleting a visit day in Google marks her out.
    app.fake.userDelete(hubCal, app.visitEvent("2026-10-22").id);
    // Adding an all-day event on a Wednesday makes it an extra day, with its description as the note.
    app.fake.userInsert(hubCal, { summary: "Gladis", description: "Party prep", start: { date: "2026-10-28" }, end: { date: "2026-10-29" } });
    // Editing the description sets the day note.
    app.fake.userPatch(hubCal, app.visitEvent("2026-10-24").id, { description: "Bring the ladder" });
    // Moving Monday's event to Tuesday: Monday out, Tuesday extra.
    app.fake.userPatch(hubCal, app.visitEvent("2026-10-26").id, { start: { date: "2026-10-27" }, end: { date: "2026-10-28" } });

    assert.equal((await app.post("/api/google/sync")).body.last_error, null);
    const s = await schedule();
    const visit = (d) => s.visits.find((x) => x.date === d);
    assert.ok(visit("2026-10-22").out, "deleted in Google -> out");
    assert.equal(visit("2026-10-24").note, "Bring the ladder");
    assert.ok(visit("2026-10-26").out, "moved away -> out");
    const cal = (await app.get("/api/calendar?month=2026-10")).body.days;
    assert.equal(cal.find((d) => d.date === "2026-10-28").visit, true, "added in Google -> extra day");
    assert.equal(cal.find((d) => d.date === "2026-10-27").visit, true, "moved to -> extra day");
    const notes = app.db.prepare("SELECT note FROM day_notes WHERE date = '2026-10-28'").pluck().get();
    assert.equal(notes, "Party prep");
    const hist = (await app.get("/api/log")).body.filter((x) => x.detail.via === "google").map((x) => `${x.action} ${x.detail.date}`);
    assert.ok(hist.includes("day.out 2026-10-22"));

    // The hub then writes its view back: the deleted day returns as "not coming".
    assert.equal(app.visitEvent("2026-10-22").summary, "Gladis: not coming");
    // And it settles: another sync changes nothing.
    const v = app.fake.version;
    await app.post("/api/google/sync");
    assert.equal(app.fake.version, v);

    // Deleting the "not coming" event is ignored on a day already out... re-adding one undoes it.
    app.fake.userDelete(hubCal, app.visitEvent("2026-10-22").id);
    app.fake.userInsert(hubCal, { summary: "Gladis", start: { date: "2026-10-22" }, end: { date: "2026-10-23" } });
    await app.post("/api/google/sync");
    assert.equal((await schedule()).visits.find((x) => x.date === "2026-10-22").out, null);
  } finally { await app.close(); }
});

test("google: family calendars show on Home and the calendar, and can be edited from the hub", async () => {
  const app = await bootGoogle();
  try {
    const fam = app.fake.addCalendar("family@group.calendar.google.com", { summary: "Family", backgroundColor: "#f691b2" });
    const school = app.fake.addCalendar("school@group.calendar.google.com", { summary: "School", accessRole: "reader" });
    app.fake.userInsert(fam, { summary: "Beach trip", start: { date: "2026-10-16" }, end: { date: "2026-10-19" } });
    const start = new Date("2026-10-15T18:00:00Z");
    app.fake.userInsert(fam, { summary: "Dentist", location: "Main St", start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + 3600e3).toISOString() } });
    app.fake.userInsert(school, { summary: "Picture day", start: { date: "2026-10-20" }, end: { date: "2026-10-21" } });
    await app.connect();

    const list = (await app.get("/api/google/calendars")).body;
    assert.deepEqual(list.map((c) => c.name).sort(), ["Family", "School", "bill@example.com"]);
    assert.equal(list.find((c) => c.name === "School").writable, false);
    assert.equal((await app.get("/api/google/calendars", "housekeeper")).status, 403);

    await app.put("/api/google/calendars", { ids: [fam, school] });
    let home = (await app.get("/api/home", "housekeeper")).body;
    assert.deepEqual(home.events.map((e) => e.title), ["Dentist", "Beach trip", "Picture day"]);
    const dentist = home.events[0];
    assert.equal(dentist.start_time, `${String(start.getHours()).padStart(2, "0")}:00`);
    assert.equal(dentist.calendar_name, "Family");
    assert.equal(dentist.color, "#f691b2");
    const day17 = (await app.get("/api/calendar?month=2026-10")).body.days.find((d) => d.date === "2026-10-17");
    assert.deepEqual(day17.events.map((e) => e.title), ["Beach trip"]);

    // Add, change and delete from the hub (family only, writable calendars only).
    const ev = { calendar_id: fam, title: "Pumpkin carving", date: "2026-10-18", all_day: false, start: "16:00", end: "17:30", notes: "Buy pumpkins" };
    assert.equal((await app.post("/api/google/events", ev, "housekeeper")).status, 403);
    assert.equal((await app.post("/api/google/events", { ...ev, calendar_id: school })).status, 403);
    assert.equal((await app.post("/api/google/events", { ...ev, end: "15:00" })).status, 400);
    const made = await app.post("/api/google/events", ev);
    assert.equal(made.status, 201);
    const inGoogle = app.fake.events(fam).find((e) => e.summary === "Pumpkin carving");
    assert.equal(inGoogle.start.dateTime, "2026-10-18T16:00:00");
    assert.ok(inGoogle.start.timeZone);
    assert.equal(made.body.start_time, "16:00");

    const changed = await app.patch(`/api/google/events/${encodeURIComponent(fam)}/${made.body.event_id}`, { ...ev, title: "Pumpkins!", all_day: true });
    assert.equal(changed.status, 200);
    assert.equal(app.fake.events(fam).find((e) => e.id === made.body.event_id).start.date, "2026-10-18");
    home = (await app.get("/api/home")).body;
    assert.ok(home.events.some((e) => e.title === "Pumpkins!" && e.start_time === null));

    assert.equal((await app.del(`/api/google/events/${encodeURIComponent(fam)}/${made.body.event_id}`)).status, 200);
    assert.equal(app.fake.events(fam).some((e) => e.id === made.body.event_id), false);
    assert.equal((await app.get("/api/home")).body.events.some((e) => e.title === "Pumpkins!"), false);

    // Changes made in Google show up after the next sync.
    app.fake.userInsert(fam, { summary: "Soccer", start: { date: "2026-10-19" }, end: { date: "2026-10-20" } });
    await app.post("/api/google/sync", {}, "housekeeper");
    assert.ok((await app.get("/api/home")).body.events.some((e) => e.title === "Soccer"));
  } finally { await app.close(); }
});

test("google: disconnecting revokes access and forgets the copies", async () => {
  const app = await bootGoogle();
  try {
    const fam = app.fake.addCalendar("family@group.calendar.google.com", { summary: "Family" });
    app.fake.userInsert(fam, { summary: "Beach trip", start: { date: "2026-10-16" }, end: { date: "2026-10-17" } });
    await app.connect();
    await app.put("/api/google/calendars", { ids: [fam] });
    assert.equal((await app.del("/api/google", "housekeeper")).status, 403);
    const s = (await app.del("/api/google")).body;
    assert.equal(s.connected, false);
    assert.equal(app.fake.revoked, true);
    assert.deepEqual((await app.get("/api/home")).body.events, []);
    assert.equal((await app.post("/api/google/sync")).status, 409);
  } finally { await app.close(); }
});

test("google: a change in the hub reaches Google within seconds", async () => {
  const app = await bootGoogle({ nudgeMs: 20 });
  try {
    await app.connect();
    await app.post("/api/days-out", { date: "2026-10-17", note: "Sick" }, "housekeeper");
    for (let i = 0; i < 50 && app.visitEvent("2026-10-17").summary === "Gladis"; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(app.visitEvent("2026-10-17").summary, "Gladis: not coming");
  } finally { await app.close(); }
});
