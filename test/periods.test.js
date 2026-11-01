import test from "node:test";
import assert from "node:assert/strict";
import { weekStart, periodStart, periodEnd, shouldExpire, comingUpDates } from "../server/logic/periods.js";
import { firstVisitOnOrAfter, countVisitsBetween } from "../server/logic/visits.js";

// Visits Mon/Thu/Sat. 2026-10-15 is a Thursday.
const ctx = (today, extra = {}) => ({ today, weekdays: [1, 4, 6], outDays: new Map(), closedDays: new Set(), extraDays: new Set(), ...extra });

test("week and month periods", () => {
  assert.equal(weekStart("2026-10-15"), "2026-10-12");
  assert.equal(weekStart("2026-10-18"), "2026-10-12"); // Sunday belongs to the same ISO week
  assert.equal(periodStart("2026-10-15", "week"), "2026-10-12");
  assert.equal(periodEnd("2026-10-15", "week"), "2026-10-18");
  assert.equal(periodStart("2026-10-15", "month"), "2026-10-01");
  assert.equal(periodEnd("2026-02-10", "month"), "2026-02-28");
  assert.equal(periodEnd("2028-02-10", "month"), "2028-02-29");
  assert.equal(periodEnd("2026-10-15", "day"), "2026-10-15");
});

test("coming up: rest of this week, or next week when none are left", () => {
  assert.deepEqual(comingUpDates("2026-10-15", ctx("2026-10-15")), ["2026-10-17"]);           // Thursday: Saturday is left
  assert.deepEqual(comingUpDates("2026-10-17", ctx("2026-10-17")), ["2026-10-19", "2026-10-22", "2026-10-24"]); // last workday
  assert.deepEqual(comingUpDates("2026-10-18", ctx("2026-10-18")), ["2026-10-19", "2026-10-22", "2026-10-24"]); // Sunday
  assert.deepEqual(comingUpDates("2026-10-12", ctx("2026-10-12")), ["2026-10-15", "2026-10-17"]);
  // out days still show in place; extra days count as visits
  assert.deepEqual(comingUpDates("2026-10-15", ctx("2026-10-15", { extraDays: new Set(["2026-10-16"]) })), ["2026-10-16", "2026-10-17"]);
});

test("extra visit days are visits", () => {
  const c = ctx("2026-10-12", { extraDays: new Set(["2026-10-13"]) });
  assert.equal(firstVisitOnOrAfter("2026-10-13", c), "2026-10-13");
  assert.equal(countVisitsBetween("2026-10-12", "2026-10-15", c), 2);
});

test("'drop' removes a task once its day has passed without another chance", () => {
  const task = { period: "day", if_not_done: "drop" };
  // due Tuesday, shown Thursday: still there on Thursday, gone on Friday
  assert.equal(shouldExpire({ status: "pending", due_date: "2026-10-13", visit_date: "2026-10-15" }, task, ctx("2026-10-15")), false);
  assert.equal(shouldExpire({ status: "pending", due_date: "2026-10-13", visit_date: "2026-10-15" }, task, ctx("2026-10-16")), true);
  // closed with it unchecked counts as passed
  assert.equal(shouldExpire({ status: "pending", due_date: "2026-10-15", visit_date: "2026-10-15" }, task, ctx("2026-10-15", { closedDays: new Set(["2026-10-15"]) })), true);
  // a week task keeps its chances inside the week
  const week = { period: "week", if_not_done: "drop" };
  assert.equal(shouldExpire({ status: "pending", due_date: "2026-10-12", visit_date: "2026-10-12" }, week, ctx("2026-10-13")), false);
  assert.equal(shouldExpire({ status: "pending", due_date: "2026-10-12", visit_date: "2026-10-17" }, week, ctx("2026-10-18")), true);
  // carry never expires; done never expires
  assert.equal(shouldExpire({ status: "pending", due_date: "2026-01-01", visit_date: "2026-01-01" }, { period: "day", if_not_done: "carry" }, ctx("2026-10-15")), false);
  assert.equal(shouldExpire({ status: "done", due_date: "2026-01-01", visit_date: "2026-01-01" }, task, ctx("2026-10-15")), false);
});

test("'expire' removes a task N days after its day", () => {
  const task = { period: "day", if_not_done: "expire", expire_days: 3 };
  const inst = (visit) => ({ status: "pending", due_date: "2026-10-12", visit_date: visit });
  assert.equal(shouldExpire(inst("2026-10-12"), task, ctx("2026-10-15")), false); // 3 days later: still ok
  assert.equal(shouldExpire(inst("2026-10-15"), task, ctx("2026-10-16")), true);  // 4 days later
  assert.equal(shouldExpire(inst("2026-10-17"), task, ctx("2026-10-17")), false); // never before its showing passes
});
