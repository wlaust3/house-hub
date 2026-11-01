import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot } from "./helpers.js";
import { openDb } from "../server/db/index.js";

// Calendar used throughout: Thu 2026-10-15 (today), Sat 17, Mon 19, Thu 22, Sat 24. Visits are Mon/Thu/Sat.
const H = "housekeeper";

async function home(app, role = H) {
  const r = await app.get("/api/home", role);
  assert.equal(r.status, 200);
  return r.body;
}

test("one-off task added on a visit day shows today; after 'All done' it goes to the next visit", async () => {
  const app = await boot();
  try {
    const add = await app.post("/api/tasks", { title: "Let the plumber in" });
    assert.equal(add.status, 201);
    assert.equal(add.body.visit_date, "2026-10-15");
    let h = await home(app);
    assert.deepEqual(h.today_items.map((i) => i.title), ["Let the plumber in"]);
    assert.equal(h.visit.open, true);

    const close = await app.post("/api/visits/2026-10-15/close", { done_ids: [] }, H);
    assert.equal(close.status, 200);
    assert.equal(close.body.carried, 1);
    assert.equal(close.body.next_visit, "2026-10-17");

    // added after the visit was finished: following visit, not today
    const later = await app.post("/api/tasks", { title: "Water the plants" });
    assert.equal(later.body.visit_date, "2026-10-17");
    h = await home(app);
    assert.equal(h.visit.closed, true);
    assert.equal(h.visit.open, false);
    assert.equal(h.today_items.length, 0);
    const sat = h.coming_up.find((d) => d.date === "2026-10-17");
    assert.deepEqual(sat.items.map((i) => i.title).sort(), ["Let the plumber in", "Water the plants"]);
    const carried = sat.items.find((i) => i.title === "Let the plumber in");
    assert.equal(carried.carried_from, "2026-10-15");
    assert.equal(sat.items.find((i) => i.title === "Water the plants").carried_from, null);
  } finally { await app.close(); }
});

test("one-off defaults to 'next visit' on a non-visit day and honours a specific date", async () => {
  const app = await boot("2026-10-16T09:00:00"); // Friday
  try {
    const a = await app.post("/api/tasks", { title: "Wipe windows" });
    assert.equal(a.body.visit_date, "2026-10-17");
    const b = await app.post("/api/tasks", { title: "Dentist forms", date: "2026-10-20" }); // Tuesday
    assert.equal(b.body.visit_date, "2026-10-22");
    const h = await home(app);
    assert.equal(h.today_items.length, 0);
    assert.equal(h.visit.regular, false);
    assert.equal(h.next_visit, "2026-10-17");
    assert.equal(h.cant_come_date, "2026-10-17");
    const bad = await app.post("/api/tasks", { title: "x", date: "2026-10-01" });
    assert.equal(bad.status, 400);
  } finally { await app.close(); }
});

test("unchecked tasks roll forward automatically and show 'Carried over'", async () => {
  const app = await boot("2026-10-12T08:00:00"); // Monday
  try {
    await app.post("/api/tasks", { title: "Vacuum stairs" });
    let h = await home(app);
    assert.equal(h.today_items[0].carried_from, null);
    app.clock.set("2026-10-13T08:00:00"); // Tuesday: Monday's visit passed with it unchecked
    h = await home(app);
    assert.equal(h.today_items.length, 0);
    assert.equal(h.coming_up[0].date, "2026-10-15");
    assert.equal(h.coming_up[0].items[0].carried_from, "2026-10-12");
    app.clock.set("2026-10-15T08:00:00"); // Thursday
    h = await home(app);
    assert.equal(h.today_items[0].title, "Vacuum stairs");
    assert.equal(h.today_items[0].carried_from, "2026-10-12");
    assert.equal(h.today_items[0].carried_visits, 1);
    app.clock.set("2026-10-19T08:00:00"); // never done through Thu + Sat
    h = await home(app);
    assert.equal(h.today_items[0].carried_from, "2026-10-12");
    assert.equal(h.today_items[0].carried_visits, 3); // Mon, Thu, Sat
    const log = await app.get("/api/log");
    assert.ok(log.body.every((l) => l.action !== "task.rolled"), "rollover bookkeeping is hidden from History");
    assert.ok(app.db.prepare("SELECT COUNT(*) n FROM activity_log WHERE action='task.rolled'").get().n >= 1);
  } finally { await app.close(); }
});

test("weekly recurring task: right dates, check-off, next occurrence from the rule not the tick", async () => {
  const app = await boot("2026-10-12T08:00:00"); // Monday
  try {
    const r = await app.post("/api/tasks", { title: "Change bed sheets", repeat: { kind: "weekly", start: "2026-10-12" } });
    assert.equal(r.status, 201);
    const first = (await home(app)).today_items[0];
    assert.equal(first.recurring, true);
    assert.equal(first.due_date, "2026-10-12");
    const tick = await app.patch(`/api/instances/${first.id}`, { done: true }, H);
    assert.equal(tick.body.status, "done");
    assert.equal(tick.body.done_by, H);
    assert.ok(tick.body.done_at);
    // next occurrence is Oct 19 regardless of when the first was ticked
    const dues = app.db.prepare("SELECT due_date, status FROM task_instances WHERE task_id=? ORDER BY due_date LIMIT 3").all(r.body.task_id);
    assert.deepEqual(dues.map((d) => d.due_date), ["2026-10-12", "2026-10-19", "2026-10-26"]);
    // a second sync never duplicates
    await home(app); await home(app);
    assert.equal(app.db.prepare("SELECT COUNT(*) n FROM task_instances WHERE task_id=? AND due_date='2026-10-19'").get(r.body.task_id).n, 1);
    // untick is a one-tap undo
    const undo = await app.patch(`/api/instances/${first.id}`, { done: false }, H);
    assert.equal(undo.body.status, "pending");
    assert.equal(undo.body.done_at, null);
  } finally { await app.close(); }
});

test("monthly task on the 31st and custom repeat produce the documented dates", async () => {
  const app = await boot("2026-10-15T08:00:00");
  try {
    const m = await app.post("/api/tasks", { title: "Deep clean oven", repeat: { kind: "monthly", start: "2026-10-31" } });
    const c = await app.post("/api/tasks", { title: "Rotate mattress", repeat: { kind: "custom", n: 10, unit: "day", start: "2026-10-15" } });
    const six = await app.post("/api/tasks", { title: "Wash curtains", repeat: { kind: "every_six_months", start: "2026-10-31" } });
    assert.equal([m, c, six].every((x) => x.status === 201), true);
    await app.get("/api/calendar?month=2027-05"); // extends the horizon
    const dues = (id) => app.db.prepare("SELECT due_date FROM task_instances WHERE task_id=? ORDER BY due_date").pluck().all(id);
    const md = dues(m.body.task_id);
    assert.deepEqual(md.slice(0, 5), ["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28"]);
    assert.deepEqual(dues(c.body.task_id).slice(0, 3), ["2026-10-15", "2026-10-25", "2026-11-04"]);
    assert.deepEqual(dues(six.body.task_id), ["2026-10-31", "2027-04-30"].slice(0, 1).concat(dues(six.body.task_id).slice(1)));
    assert.equal(dues(six.body.task_id)[1], "2027-04-30");
  } finally { await app.close(); }
});

test("a daily task missed for days never piles up: one open item, carried over", async () => {
  const app = await boot("2026-10-12T08:00:00");
  try {
    const r = await app.post("/api/tasks", { title: "Wipe counters", repeat: { kind: "daily", start: "2026-10-12" } });
    await home(app);
    app.clock.set("2026-10-22T08:00:00"); // ten days later, nobody ticked anything
    const h = await home(app);
    const mine = h.today_items.filter((i) => i.title === "Wipe counters");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].carried_from, "2026-10-12");
    const open = app.db.prepare("SELECT COUNT(*) n FROM task_instances WHERE task_id=? AND status='pending' AND visit_date=?").get(r.body.task_id, "2026-10-22").n;
    assert.equal(open, 1);
    // ticking it leaves the merged duplicates merged, and the next visit gets its own fresh one
    await app.patch(`/api/instances/${mine[0].id}`, { done: true }, H);
    const h2 = await home(app);
    assert.equal(h2.today_items.filter((i) => i.title === "Wipe counters").length, 1);
    const sat = h2.coming_up.find((d) => d.date === "2026-10-24");
    assert.equal(sat.items.filter((i) => i.title === "Wipe counters").length, 1);
    assert.equal(sat.items[0].carried_from, null);
  } finally { await app.close(); }
});

test("editing a recurring task applies to future occurrences only; pause and delete keep history", async () => {
  const app = await boot("2026-10-12T08:00:00");
  try {
    const r = await app.post("/api/tasks", { title: "Mop floors", repeat: { kind: "weekly", start: "2026-10-12" } });
    const id = r.body.task_id;
    const today = (await home(app)).today_items[0];
    await app.patch(`/api/instances/${today.id}`, { done: true }, H);
    const ed = await app.patch(`/api/tasks/${id}`, { title: "Mop all floors", repeat: { kind: "custom", n: 2, unit: "week" } });
    assert.equal(ed.status, 200);
    assert.equal(app.db.prepare("SELECT status FROM task_instances WHERE id=?").get(today.id).status, "done"); // history intact
    await home(app);
    const dues = app.db.prepare("SELECT due_date FROM task_instances WHERE task_id=? ORDER BY due_date").pluck().all(id);
    assert.deepEqual(dues.slice(0, 3), ["2026-10-12", "2026-10-26", "2026-11-09"]);
    // pause drops open instances; resume brings them back
    await app.patch(`/api/tasks/${id}`, { active: false });
    assert.equal(app.db.prepare("SELECT COUNT(*) n FROM task_instances WHERE task_id=? AND status!='done'").get(id).n, 0);
    await app.patch(`/api/tasks/${id}`, { active: true });
    await home(app);
    assert.ok(app.db.prepare("SELECT COUNT(*) n FROM task_instances WHERE task_id=? AND status!='done'").get(id).n > 0);
    // delete: gone from lists, history kept
    const del = await app.del(`/api/tasks/${id}`);
    assert.equal(del.status, 200);
    assert.equal(app.db.prepare("SELECT COUNT(*) n FROM task_instances WHERE task_id=? AND status='done'").get(id).n, 1);
    const list = await app.get("/api/tasks");
    assert.equal(list.body.recurring.length, 0);
    const calls = await home(app);
    assert.ok(calls.today_items.every((i) => i.task_id !== id) || calls.today_items.some((i) => i.status === "done"));
  } finally { await app.close(); }
});

test("family-only guards: housekeeper cannot create tasks, edit schedule or approve requests", async () => {
  const app = await boot();
  try {
    assert.equal((await app.post("/api/tasks", { title: "x" }, H)).status, 403);
    assert.equal((await app.get("/api/tasks", H)).status, 403);
    assert.equal((await app.put("/api/schedule", { weekdays: [1] }, H)).status, 403);
    assert.equal((await app.get("/api/log", H)).status, 403);
    const rq = await app.post("/api/requests", { title: "Need spray", kind: "buy" }, H);
    assert.equal(rq.status, 201);
    assert.equal((await app.patch(`/api/requests/${rq.body.id}`, { status: "approved" }, H)).status, 403);
    assert.equal((await app.post("/api/grocery", { name: "milk" }, null)).status, 400); // role required
    assert.equal((await app.post("/api/days-out", { date: "2026-10-17", reason: "sick", mode: "hide" }, H)).status, 403);
  } finally { await app.close(); }
});

test("requests: submitted -> approved -> done, submitted -> done, everything else rejected", async () => {
  const app = await boot();
  try {
    const a = (await app.post("/api/requests", { title: "Approve contractor visit", details: "Tuesday 9am", kind: "approve" }, H)).body;
    assert.equal(a.status, "submitted");
    assert.equal(a.kind, "approve");
    assert.equal((await app.post("/api/requests", { title: "", kind: "buy" }, H)).status, 400);
    assert.equal((await app.post("/api/requests", { title: "x", kind: "wish" }, H)).status, 400);

    const ap = await app.patch(`/api/requests/${a.id}`, { status: "approved" });
    assert.equal(ap.body.status, "approved");
    assert.ok(ap.body.approved_at);
    assert.equal(ap.body.updated_at, ap.body.approved_at);
    // cannot go back or repeat
    for (const s of ["submitted", "approved", "nonsense"]) {
      const bad = await app.patch(`/api/requests/${a.id}`, { status: s });
      assert.ok(bad.status === 409 || bad.status === 409, s);
      assert.ok(bad.body.error);
    }
    const dn = await app.patch(`/api/requests/${a.id}`, { status: "done" });
    assert.equal(dn.body.status, "done");
    assert.ok(dn.body.done_at);
    assert.equal((await app.patch(`/api/requests/${a.id}`, { status: "approved" })).status, 409);

    const b = (await app.post("/api/requests", { title: "Need cleaning spray", kind: "buy" }, H)).body;
    assert.equal((await app.patch(`/api/requests/${b.id}`, { status: "done" })).body.status, "done"); // skip approval
    assert.equal((await app.patch(`/api/requests/9999`, { status: "done" })).status, 404);

    const c = (await app.post("/api/requests", { title: "Fix shade", kind: "other" }, H)).body;
    const list = (await app.get("/api/requests", H)).body;
    assert.equal(list[0].id, c.id, "submitted requests are listed first");
    assert.deepEqual(list.slice(1).map((x) => x.status), ["done", "done"]);
  } finally { await app.close(); }
});

test("grocery: add, buy moves to bottom, unbuy, clear bought keeps rows in the DB", async () => {
  const app = await boot();
  try {
    const milk = (await app.post("/api/grocery", { name: "Milk", quantity: "2" }, H)).body;
    const eggs = (await app.post("/api/grocery", { name: "Eggs" }, "family")).body;
    const soap = (await app.post("/api/grocery", { name: "Soap" }, H)).body;
    assert.equal(milk.added_by, H);
    assert.equal(eggs.added_by, "family");
    assert.equal((await app.post("/api/grocery", { name: "  " }, H)).status, 400);
    await app.patch(`/api/grocery/${milk.id}`, { bought: true }, H);
    let list = (await app.get("/api/grocery")).body;
    assert.deepEqual(list.map((x) => x.name), ["Eggs", "Soap", "Milk"]);
    assert.ok(list[2].bought_at);
    await app.patch(`/api/grocery/${milk.id}`, { bought: false }, H);
    list = (await app.get("/api/grocery")).body;
    assert.deepEqual(list.map((x) => x.name), ["Milk", "Eggs", "Soap"]);
    await app.patch(`/api/grocery/${eggs.id}`, { bought: true }, H);
    await app.patch(`/api/grocery/${soap.id}`, { bought: true }, H);
    const cl = await app.post("/api/grocery/clear-bought", {}, H);
    assert.equal(cl.body.cleared, 2);
    assert.deepEqual((await app.get("/api/grocery")).body.map((x) => x.name), ["Milk"]);
    assert.equal(app.db.prepare("SELECT COUNT(*) n FROM grocery_items").get().n, 3);
    assert.equal(app.db.prepare("SELECT COUNT(*) n FROM grocery_items WHERE cleared_at IS NOT NULL").get().n, 2);
    assert.equal((await app.patch(`/api/grocery/${eggs.id}`, { bought: false }, H)).status, 404);
  } finally { await app.close(); }
});

test("out day (shift): tasks move to the next visit and come back when undone", async () => {
  const app = await boot(); // Thursday
  try {
    await app.post("/api/tasks", { title: "Laundry", date: "2026-10-17" });
    await app.post("/api/tasks", { title: "Daily wipe", repeat: { kind: "daily", start: "2026-10-15" } });
    const out = await app.post("/api/days-out", { date: "2026-10-17", reason: "sick" }, H);
    assert.equal(out.status, 201);
    assert.equal(out.body.mode, "shift");
    assert.ok(out.body.shifted >= 1);
    let h = await home(app);
    assert.equal(h.coming_up.find((d) => d.date === "2026-10-17").out.reason, "sick");
    const mon = h.coming_up.find((d) => d.date === "2026-10-19");
    assert.ok(mon.items.some((i) => i.title === "Laundry" && i.carried_from === "2026-10-17"));
    // undo with one tap
    assert.equal((await app.del("/api/days-out/2026-10-17", H)).status, 200);
    h = await home(app);
    const sat = h.coming_up.find((d) => d.date === "2026-10-17");
    assert.equal(sat.out, null);
    assert.ok(sat.items.some((i) => i.title === "Laundry" && i.carried_from === null));
    const hist = (await app.get("/api/log")).body.map((l) => l.action);
    assert.ok(hist.includes("day.out") && hist.includes("day.out_undone"));
  } finally { await app.close(); }
});

test("out day (hide): recurring occurrences are skipped, one-offs and carried-over still move", async () => {
  const app = await boot("2026-10-12T08:00:00"); // Monday
  try {
    const rec = await app.post("/api/tasks", { title: "Weekly bathrooms", repeat: { kind: "weekly", start: "2026-10-17" } });
    await app.post("/api/tasks", { title: "Call the electrician", date: "2026-10-17" });
    await app.post("/api/tasks", { title: "Carry me", date: "2026-10-12" }); // today, will be carried
    app.clock.set("2026-10-13T08:00:00");
    await home(app); // Monday's visit passed: "Carry me" rolled to Thursday
    const out = await app.post("/api/days-out", { date: "2026-10-15", reason: "appointment", mode: "hide" }, "family");
    assert.equal(out.status, 201);
    const hideDay = await app.post("/api/days-out", { date: "2026-10-17", reason: "other", mode: "hide", note: "Family away" }, "family");
    assert.equal(hideDay.body.hidden, 1);   // the weekly bathrooms
    assert.equal(hideDay.body.shifted, 2);  // the electrician + the carried-over one
    const h = await home(app);
    const titlesOn = (d) => h.coming_up.find((x) => x.date === d)?.items.map((i) => i.title) ?? [];
    assert.deepEqual(titlesOn("2026-10-17"), []);
    assert.deepEqual(titlesOn("2026-10-19").sort(), ["Call the electrician", "Carry me"]);
    const carried = h.coming_up.find((x) => x.date === "2026-10-19").items.find((i) => i.title === "Carry me");
    assert.equal(carried.carried_from, "2026-10-12");
    const skipped = app.db.prepare("SELECT status, skip_reason FROM task_instances WHERE task_id=? AND due_date='2026-10-17'").get(rec.body.task_id);
    assert.deepEqual({ ...skipped }, { status: "skipped", skip_reason: "out_day" });
    // the following Saturday's occurrence is unaffected
    assert.ok(app.db.prepare("SELECT 1 FROM task_instances WHERE task_id=? AND due_date='2026-10-24' AND status='pending'").get(rec.body.task_id));
    // family flips hide -> shift: the recurring one comes back as carried over
    await app.patch("/api/days-out/2026-10-17", { mode: "shift" }, "family");
    const h2 = await home(app);
    assert.ok(h2.coming_up.find((x) => x.date === "2026-10-19").items.some((i) => i.title === "Weekly bathrooms" && i.carried_from === "2026-10-17"));
    // out days show with notes
    assert.equal(h2.coming_up.find((x) => x.date === "2026-10-17").out.note, "Family away");
  } finally { await app.close(); }
});

test("out day validation: past days, non-visit days, bad reasons, finished visits", async () => {
  const app = await boot();
  try {
    assert.equal((await app.post("/api/days-out", { date: "2026-10-12", reason: "sick" }, H)).status, 400);
    assert.equal((await app.post("/api/days-out", { date: "2026-10-16", reason: "sick" }, H)).status, 400);
    assert.equal((await app.post("/api/days-out", { date: "2026-10-17", reason: "holiday" }, H)).status, 400);
    assert.equal((await app.post("/api/days-out", { reason: "sick" }, H)).status, 400);
    assert.equal((await app.del("/api/days-out/2026-10-17", H)).status, 404);
    assert.equal((await app.post("/api/days-out", { date: "2026-10-15", reason: "sick" }, H)).status, 201); // today is allowed
    const h = await home(app);
    assert.equal(h.visit.out.reason, "sick");
    assert.equal(h.visit.open, false);
    assert.equal(h.next_visit, "2026-10-17");
    // housekeeper's typing is never needed; notes only come from family
    assert.equal(app.db.prepare("SELECT note FROM day_overrides WHERE date='2026-10-15'").get().note, "");
  } finally { await app.close(); }
});

test("a visit can be finished only once, only today, and can be reopened", async () => {
  const app = await boot();
  try {
    const a = (await app.post("/api/tasks", { title: "One" })).body;
    const b = (await app.post("/api/tasks", { title: "Two" })).body;
    const items = (await home(app)).today_items;
    const one = items.find((i) => i.title === "One");
    await app.patch(`/api/instances/${one.id}`, { done: true }, H);
    assert.equal((await app.post("/api/visits/2026-10-17/close", { done_ids: [] }, H)).status, 400);
    assert.equal((await app.post("/api/visits/2026-10-15/close", { done_ids: "all" }, H)).status, 400);
    // she un-ticks One in the final screen and ticks nothing else: both carry over
    const res = await app.post("/api/visits/2026-10-15/close", { done_ids: [] }, H);
    assert.equal(res.body.carried, 2);
    assert.equal(res.body.done, 0);
    assert.equal((await app.post("/api/visits/2026-10-15/close", { done_ids: [] }, H)).status, 409);
    assert.equal((await app.post("/api/days-out", { date: "2026-10-15", reason: "sick" }, H)).status, 400);
    assert.equal((await app.del("/api/visits/2026-10-15", H)).status, 200);
    const h = await home(app);
    assert.equal(h.today_items.length, 2);
    assert.ok(h.today_items.every((i) => i.status === "pending" && i.carried_from === null));
    assert.equal((await app.del("/api/visits/2026-10-15", H)).status, 404);
    void a; void b;
  } finally { await app.close(); }
});

test("batch check-off: the ids ticked on the final screen become done; the rest carry over to the next visit", async () => {
  const app = await boot();
  try {
    for (const t of ["A", "B", "C"]) await app.post("/api/tasks", { title: t });
    const items = (await home(app)).today_items;
    const byTitle = Object.fromEntries(items.map((i) => [i.title, i.id]));
    await app.patch(`/api/instances/${byTitle.A}`, { done: true }, H); // already ticked during the day
    const res = await app.post("/api/visits/2026-10-15/close", { done_ids: [byTitle.A, byTitle.B] }, H);
    assert.deepEqual({ done: res.body.done, carried: res.body.carried }, { done: 2, carried: 1 });
    const h = await home(app);
    assert.deepEqual(h.today_items.map((i) => [i.title, i.status]).sort(), [["A", "done"], ["B", "done"]]);
    assert.deepEqual(h.coming_up[0].items.map((i) => i.title), ["C"]);
    assert.equal(h.coming_up[0].items[0].carried_from, "2026-10-15");
    const actions = (await app.get("/api/log")).body.map((l) => l.action);
    assert.ok(actions.includes("visit.closed") && actions.includes("task.done"));
  } finally { await app.close(); }
});

test("editing the regular schedule re-places future tasks", async () => {
  const app = await boot();
  try {
    await app.post("/api/tasks", { title: "Friday-ish", date: "2026-10-16" });
    assert.equal((await home(app)).coming_up[0].items[0].title, "Friday-ish"); // Sat
    assert.equal((await app.put("/api/schedule", { weekdays: [] })).status, 400);
    assert.equal((await app.put("/api/schedule", { weekdays: [0, 9] })).status, 400);
    const put = await app.put("/api/schedule", { weekdays: [5, 2] });
    assert.deepEqual(put.body.weekdays, [2, 5]);
    const h = await home(app);
    assert.equal(h.visit.regular, false); // Thursday is no longer a visit day
    assert.equal(h.coming_up[0].date, "2026-10-16");
    assert.equal(h.coming_up[0].items[0].title, "Friday-ish");
    const s = (await app.get("/api/schedule")).body;
    assert.deepEqual(s.weekdays, [2, 5]);
  } finally { await app.close(); }
});

test("per-task note, due-soon list and calendar", async () => {
  const app = await boot();
  try {
    await app.post("/api/tasks", { title: "Gutters", date: "2026-10-16" }); // due Fri, seen Sat
    const h = await home(app, "family");
    assert.deepEqual(h.due_soon.map((i) => i.title), ["Gutters"]);
    const id = h.due_soon[0].id;
    const n = await app.patch(`/api/instances/${id}`, { note: "ladder is in the garage" }, H);
    assert.equal(n.body.note, "ladder is in the garage");
    assert.equal((await home(app, "family")).due_soon[0].note, "ladder is in the garage");

    const cal = await app.get("/api/calendar?month=2026-10", H);
    assert.equal(cal.status, 200);
    assert.equal(cal.body.days.length, 31);
    const d17 = cal.body.days.find((d) => d.date === "2026-10-17");
    assert.equal(d17.visit, true);
    assert.equal(d17.open_count, 1);
    assert.equal(cal.body.days.find((d) => d.date === "2026-10-16").visit, false);
    await app.post("/api/days-out", { date: "2026-10-24", reason: "sick" }, H);
    const cal2 = await app.get("/api/calendar?month=2026-10", H);
    assert.equal(cal2.body.days.find((d) => d.date === "2026-10-24").out.reason, "sick");
    assert.equal((await app.get("/api/calendar?month=2026-13", H)).status, 400);
    const next = await app.get("/api/calendar?month=2026-11", H);
    assert.equal(next.body.days.length, 30);
  } finally { await app.close(); }
});

test("history lists check-offs with the role, newest first", async () => {
  const app = await boot();
  try {
    await app.post("/api/tasks", { title: "Clean bathroom" });
    const it = (await home(app)).today_items[0];
    await app.patch(`/api/instances/${it.id}`, { done: true }, H);
    await app.patch(`/api/instances/${it.id}`, { done: false }, H);
    await app.post("/api/requests", { title: "Need spray", kind: "buy" }, H);
    const log = (await app.get("/api/log")).body;
    assert.deepEqual(log.slice(0, 3).map((l) => l.action), ["request.created", "task.undone", "task.done"]);
    assert.equal(log[1].actor, H);
    assert.equal(log[1].detail.title, "Clean bathroom");
    assert.ok(log[1].at.endsWith("Z"));
  } finally { await app.close(); }
});

test("validation: bad JSON and bad ids give clear errors", async () => {
  const app = await boot();
  try {
    const res = await fetch(app.base + "/api/grocery", { method: "POST", headers: { "content-type": "application/json", "x-role": H }, body: "{nope" });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);
    assert.equal((await app.patch("/api/instances/abc", { done: true }, H)).status, 400);
    assert.equal((await app.patch("/api/instances/99999", { done: true }, H)).status, 404);
    assert.equal((await app.get("/api/nothing")).status, 404);
    assert.equal((await app.post("/api/tasks", { title: "x", repeat: { kind: "custom", n: 0, unit: "day" } })).status, 400);
    assert.equal((await app.post("/api/tasks", { title: "x", repeat: { kind: "yearly" } })).status, 400);
  } finally { await app.close(); }
});

test("backup: copying the DB file gives a complete, working copy", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
  const file = path.join(dir, "house-hub.db");
  const app = await boot("2026-10-15T09:00:00", file);
  await app.post("/api/tasks", { title: "Survives backup" });
  await app.post("/api/grocery", { name: "Bread" }, H);
  app.db.pragma("wal_checkpoint(TRUNCATE)");
  await app.close();
  app.db.close();
  const copy = path.join(dir, "restored.db");
  fs.copyFileSync(file, copy);
  const restored = openDb(copy);
  assert.equal(restored.prepare("SELECT title FROM tasks").pluck().get(), "Survives backup");
  assert.equal(restored.prepare("SELECT name FROM grocery_items").pluck().get(), "Bread");
  restored.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
