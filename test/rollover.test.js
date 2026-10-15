import test from "node:test";
import assert from "node:assert/strict";
import { planRecompute } from "../server/logic/rollover.js";

const ctx = (over = {}) => ({ today: "2026-10-15", weekdays: [1, 4, 6], outDays: new Map(), closedDays: new Set(), ...over });
let id = 0;
const inst = (o) => ({ id: ++id, task_id: 1, recurring: true, due_date: "2026-10-12", visit_date: "2026-10-12", status: "pending", skip_reason: null, rolled_from: null, created_date: "2026-10-01", ...o });
const apply = (list, changes) => list.map((i) => ({ ...i, ...(changes.find((c) => c.id === i.id) ?? {}) }));

test("an unchecked task from a past visit rolls to the next visit and is marked carried over", () => {
  const a = inst({ recurring: false, due_date: "2026-10-12", visit_date: "2026-10-12" }); // Monday, never done
  const changes = planRecompute([a], ctx());
  assert.equal(changes.length, 1);
  assert.equal(changes[0].visit_date, "2026-10-15"); // today is a visit day (Thu)
  assert.equal(changes[0].rolled_from, "2026-10-12");
  assert.equal(changes[0].status, "pending");
});

test("rolled_from records where it was FIRST shown and is never overwritten", () => {
  const a = inst({ recurring: false, due_date: "2026-10-12", visit_date: "2026-10-12" });
  let list = [a];
  list = apply(list, planRecompute(list, ctx({ today: "2026-10-15" })));
  assert.equal(list[0].rolled_from, "2026-10-12");
  list = apply(list, planRecompute(list, ctx({ today: "2026-10-17" }))); // missed Thursday too
  assert.equal(list[0].visit_date, "2026-10-17");
  assert.equal(list[0].rolled_from, "2026-10-12");
  list = apply(list, planRecompute(list, ctx({ today: "2026-10-18" }))); // missed Saturday (Sunday now)
  assert.equal(list[0].visit_date, "2026-10-19");
  assert.equal(list[0].rolled_from, "2026-10-12");
});

test("recompute is idempotent", () => {
  const list = [inst({ recurring: false }), inst({ task_id: 2, due_date: "2026-10-16", visit_date: "2026-10-17" })];
  const once = apply(list, planRecompute(list, ctx()));
  assert.deepEqual(planRecompute(once, ctx()), []);
});

test("a future task that is not late stays put with no carried-over mark", () => {
  const a = inst({ recurring: false, due_date: "2026-10-16", visit_date: "2026-10-17" });
  assert.deepEqual(planRecompute([a], ctx()), []);
});

test("daily task missed for a week shows ONE open item, not seven", () => {
  // Daily task, visits Mon/Thu/Sat; server has instances for each day Mon..Wed, all unchecked.
  const list = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"].map((d, i) =>
    inst({ task_id: 7, due_date: d, visit_date: ["2026-10-12", "2026-10-15", "2026-10-15", "2026-10-15"][i] }));
  const after = apply(list, planRecompute(list, ctx()));
  const open = after.filter((i) => i.status === "pending");
  assert.equal(open.length, 1);
  assert.equal(open[0].due_date, "2026-10-12");      // earliest wins
  assert.equal(open[0].visit_date, "2026-10-15");
  assert.equal(open[0].rolled_from, "2026-10-12");   // and keeps its carried-over marker
  assert.ok(after.filter((i) => i.status === "skipped").every((i) => i.skip_reason === "merged"));
});

test("a week of missed daily instances collapse into one even across several visits", () => {
  const dates = ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"];
  const list = dates.map((d) => inst({ task_id: 9, due_date: d, visit_date: d < "2026-10-10" ? "2026-10-08" : "2026-10-10" }));
  const after = apply(list, planRecompute(list, ctx({ today: "2026-10-19" })));
  assert.equal(after.filter((i) => i.status === "pending").length, 1);
});

test("different tasks are never merged with each other", () => {
  const list = [inst({ task_id: 1 }), inst({ task_id: 2 })];
  const after = apply(list, planRecompute(list, ctx()));
  assert.equal(after.filter((i) => i.status === "pending").length, 2);
});

test("one-off tasks are never merged even if they share a title/visit", () => {
  const list = [inst({ task_id: 1, recurring: false }), inst({ task_id: 2, recurring: false })];
  const after = apply(list, planRecompute(list, ctx()));
  assert.equal(after.filter((i) => i.status === "pending").length, 2);
});

test("merged duplicates stay merged once the surviving one is done", () => {
  const done = inst({ task_id: 3, due_date: "2026-10-13", visit_date: "2026-10-15", status: "done" });
  const dup = inst({ task_id: 3, due_date: "2026-10-14", visit_date: "2026-10-15", status: "skipped", skip_reason: "merged" });
  assert.deepEqual(planRecompute([done, dup], ctx()), []);
});

test("unticking the survivor lets the group merge again", () => {
  const a = inst({ task_id: 3, due_date: "2026-10-13", visit_date: "2026-10-15", status: "pending", rolled_from: null });
  const dup = inst({ task_id: 3, due_date: "2026-10-14", visit_date: "2026-10-15", status: "skipped", skip_reason: "merged" });
  // dup would be revived as pending by itself, then merged again => no change
  assert.deepEqual(planRecompute([a, dup], ctx()), []);
});

test("closing today's visit carries the remaining items to the next visit", () => {
  const todo = inst({ recurring: false, due_date: "2026-10-15", visit_date: "2026-10-15", created_date: "2026-10-01" });
  const changes = planRecompute([todo], ctx({ closedDays: new Set(["2026-10-15"]) }));
  assert.equal(changes[0].visit_date, "2026-10-17");
  assert.equal(changes[0].rolled_from, "2026-10-15");
});

test("reopening a visit moves unfinished items back to today", () => {
  const todo = inst({ recurring: false, due_date: "2026-10-15", visit_date: "2026-10-17", rolled_from: "2026-10-15" });
  const changes = planRecompute([todo], ctx());
  assert.equal(changes[0].visit_date, "2026-10-15");
  assert.equal(changes[0].rolled_from, null);
});

test("editing the schedule re-places future pending instances", () => {
  const a = inst({ recurring: false, due_date: "2026-10-16", visit_date: "2026-10-17" }); // was Sat
  const changes = planRecompute([a], ctx({ weekdays: [1, 5] })); // now Mon + Fri
  assert.equal(changes[0].visit_date, "2026-10-16");
});

test("done items are never moved", () => {
  const d = inst({ status: "done", visit_date: "2026-10-12" });
  assert.deepEqual(planRecompute([d], ctx()), []);
});

test("old skipped (hidden) items in the past are left alone", () => {
  const s = inst({ status: "skipped", skip_reason: "out_day", visit_date: "2026-10-12" });
  assert.deepEqual(planRecompute([s], ctx()), []);
});
