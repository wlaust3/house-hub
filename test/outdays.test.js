import test from "node:test";
import assert from "node:assert/strict";
import { planRecompute } from "../server/logic/rollover.js";
import { validateOutDay, previewOutDay } from "../server/logic/outdays.js";

// Thu 2026-10-15 is today; Sat 17 and Mon 19 are upcoming visits.
const base = { today: "2026-10-15", weekdays: [1, 4, 6], outDays: new Map(), closedDays: new Set() };
let id = 100;
const inst = (o) => ({ id: ++id, task_id: id, recurring: false, due_date: "2026-10-17", visit_date: "2026-10-17", status: "pending", skip_reason: null, rolled_from: null, created_date: "2026-10-10", ...o });
const apply = (list, changes) => list.map((i) => ({ ...i, ...(changes.find((c) => c.id === i.id) ?? {}) }));
const withOut = (date, mode) => ({ ...base, outDays: new Map([[date, mode]]) });

test("shift (default): every task on the out day moves to the next visit as 'Carried over'", () => {
  const recurring = inst({ recurring: true });
  const oneOff = inst({ recurring: false });
  const list = apply([recurring, oneOff], planRecompute([recurring, oneOff], withOut("2026-10-17", "shift")));
  for (const i of list) {
    assert.equal(i.status, "pending");
    assert.equal(i.visit_date, "2026-10-19");
    assert.equal(i.rolled_from, "2026-10-17");
  }
});

test("hide: recurring occurrences are skipped, not carried over", () => {
  const r = inst({ recurring: true });
  const [c] = planRecompute([r], withOut("2026-10-17", "hide"));
  assert.equal(c.status, "skipped");
  assert.equal(c.skip_reason, "out_day");
  assert.equal(c.visit_date, "2026-10-17");
  assert.equal(c.rolled_from, null);
});

test("hide: one-off tasks still shift - a hidden day never swallows something the family asked for", () => {
  const o = inst({ recurring: false });
  const [c] = planRecompute([o], withOut("2026-10-17", "hide"));
  assert.equal(c.status, "pending");
  assert.equal(c.visit_date, "2026-10-19");
  assert.equal(c.rolled_from, "2026-10-17");
});

test("hide: a recurring task that was already carried over also shifts instead of vanishing", () => {
  // missed Monday, carried to Thursday (today), and today is marked out in hide mode
  const carried = inst({ recurring: true, due_date: "2026-10-12", visit_date: "2026-10-15", rolled_from: "2026-10-12" });
  const [c] = planRecompute([carried], withOut("2026-10-15", "hide"));
  assert.equal(c.status, "pending");
  assert.equal(c.visit_date, "2026-10-17");
  assert.equal(c.rolled_from, "2026-10-12"); // still "carried over from Monday"
});

test("shift: a day-override on a day that already has carried-over tasks keeps the original marker", () => {
  const carried = inst({ recurring: false, due_date: "2026-10-12", visit_date: "2026-10-15", rolled_from: "2026-10-12" });
  const fresh = inst({ recurring: false, due_date: "2026-10-15", visit_date: "2026-10-15" });
  const list = apply([carried, fresh], planRecompute([carried, fresh], withOut("2026-10-15", "shift")));
  assert.equal(list[0].visit_date, "2026-10-17");
  assert.equal(list[0].rolled_from, "2026-10-12");
  assert.equal(list[1].visit_date, "2026-10-17");
  assert.equal(list[1].rolled_from, "2026-10-15");
});

test("consecutive out days: items skip both and keep the first planned day", () => {
  const o = inst({ recurring: false });
  const ctx = { ...base, outDays: new Map([["2026-10-17", "shift"], ["2026-10-19", "shift"]]) };
  const [c] = planRecompute([o], ctx);
  assert.equal(c.visit_date, "2026-10-22");
  assert.equal(c.rolled_from, "2026-10-17");
});

test("undoing a shift out day moves tasks back and clears the marker", () => {
  const o = inst({ recurring: false });
  const shifted = apply([o], planRecompute([o], withOut("2026-10-17", "shift")));
  assert.equal(shifted[0].visit_date, "2026-10-19");
  const undone = apply(shifted, planRecompute(shifted, base));
  assert.equal(undone[0].visit_date, "2026-10-17");
  assert.equal(undone[0].rolled_from, null);
});

test("undoing a hide out day un-skips the recurring occurrence", () => {
  const r = inst({ recurring: true });
  const hidden = apply([r], planRecompute([r], withOut("2026-10-17", "hide")));
  assert.equal(hidden[0].status, "skipped");
  const undone = apply(hidden, planRecompute(hidden, base));
  assert.equal(undone[0].status, "pending");
  assert.equal(undone[0].skip_reason, null);
  assert.equal(undone[0].visit_date, "2026-10-17");
});

test("switching an out day from hide to shift revives hidden items as carried over", () => {
  const r = inst({ recurring: true });
  const hidden = apply([r], planRecompute([r], withOut("2026-10-17", "hide")));
  const shifted = apply(hidden, planRecompute(hidden, withOut("2026-10-17", "shift")));
  assert.equal(shifted[0].status, "pending");
  assert.equal(shifted[0].visit_date, "2026-10-19");
  assert.equal(shifted[0].rolled_from, "2026-10-17");
});

test("tasks due on a non-visit day that falls before an out day visit are hidden/shifted with it", () => {
  // due Friday -> would show Saturday; Saturday is out (hide). Recurring: skipped.
  const r = inst({ recurring: true, due_date: "2026-10-16", visit_date: "2026-10-17" });
  const [c] = planRecompute([r], withOut("2026-10-17", "hide"));
  assert.equal(c.status, "skipped");
});

test("a task done earlier on the out day is not touched", () => {
  const d = inst({ status: "done", visit_date: "2026-10-15" });
  assert.deepEqual(planRecompute([d], withOut("2026-10-15", "shift")), []);
});

test("previewOutDay reports how many items shift and how many are hidden", () => {
  const a = inst({ recurring: true });
  const b = inst({ recurring: false });
  const other = inst({ recurring: true, due_date: "2026-10-19", visit_date: "2026-10-19" });
  const hide = previewOutDay([a, b, other], "2026-10-17", "hide", base);
  assert.equal(hide.hidden.length, 1);
  assert.equal(hide.shifted.length, 1);
  const shift = previewOutDay([a, b, other], "2026-10-17", "shift", base);
  assert.equal(shift.hidden.length, 0);
  assert.equal(shift.shifted.length, 2);
});

test("validateOutDay: only today/future regular visit days with a valid reason", () => {
  assert.equal(validateOutDay({ date: "2026-10-17", reason: "sick" }, base), null);
  assert.equal(validateOutDay({ date: "2026-10-15", reason: "appointment" }, base), null); // today
  assert.ok(validateOutDay({ date: "2026-10-12", reason: "sick" }, base));                 // past
  assert.ok(validateOutDay({ date: "2026-10-16", reason: "sick" }, base));                 // not a visit day
  assert.ok(validateOutDay({ date: "2026-10-17", reason: "vacation" }, base));             // bad reason
  assert.ok(validateOutDay({ date: "2026-10-17", reason: "sick", mode: "delete" }, base));
  assert.ok(validateOutDay({ date: "2026-10-15", reason: "sick" }, { ...base, closedDays: new Set(["2026-10-15"]) }));
});
