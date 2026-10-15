import test from "node:test";
import assert from "node:assert/strict";
import { firstVisitOnOrAfter, nextVisitAfter, upcomingVisits, placeInstance, rawVisitOnOrAfter, countVisitsBetween, isAvailableVisit } from "../server/logic/visits.js";

// 2026-10-15 is a Thursday. Mon 12, Thu 15, Sat 17, Mon 19, Thu 22, Sat 24, Mon 26.
const ctx = (over = {}) => ({ today: "2026-10-15", weekdays: [1, 4, 6], outDays: new Map(), closedDays: new Set(), ...over });

test("a task due on a non-visit day shows on her next visit day", () => {
  assert.equal(firstVisitOnOrAfter("2026-10-16", ctx()), "2026-10-17"); // Fri -> Sat
  assert.equal(firstVisitOnOrAfter("2026-10-18", ctx()), "2026-10-19"); // Sun -> Mon
  assert.equal(firstVisitOnOrAfter("2026-10-17", ctx()), "2026-10-17"); // visit day itself
});

test("out days and closed visits are skipped", () => {
  const c = ctx({ outDays: new Map([["2026-10-17", "shift"]]) });
  assert.equal(firstVisitOnOrAfter("2026-10-16", c), "2026-10-19");
  const closed = ctx({ closedDays: new Set(["2026-10-15"]) });
  assert.equal(firstVisitOnOrAfter("2026-10-15", closed), "2026-10-17");
  assert.equal(isAvailableVisit("2026-10-15", closed), false);
  assert.equal(nextVisitAfter("2026-10-15", ctx()), "2026-10-17");
});

test("upcomingVisits lists the next N visit days", () => {
  assert.deepEqual(upcomingVisits("2026-10-15", 4, ctx()), ["2026-10-17", "2026-10-19", "2026-10-22", "2026-10-24"]);
  assert.deepEqual(upcomingVisits("2026-10-15", 2, ctx({ outDays: new Map([["2026-10-17", "hide"]]) })), ["2026-10-19", "2026-10-22"]);
});

test("any weekday combination works; no schedule falls back to the date itself", () => {
  assert.equal(rawVisitOnOrAfter("2026-10-15", ctx({ weekdays: [2] })), "2026-10-20");
  assert.equal(rawVisitOnOrAfter("2026-10-15", ctx({ weekdays: [] })), "2026-10-15");
  assert.equal(firstVisitOnOrAfter("2026-10-15", ctx({ weekdays: [1, 2, 3, 4, 5, 6, 7] })), "2026-10-15");
});

test("countVisitsBetween counts regular visits in [from, to)", () => {
  assert.equal(countVisitsBetween("2026-10-12", "2026-10-22", ctx()), 4); // Mon, Thu, Sat, Mon
  assert.equal(countVisitsBetween("2026-10-15", "2026-10-15", ctx()), 0);
});

test("placeInstance: new one-off lands on next visit; never in the past", () => {
  const r = placeInstance({ due_date: "2026-10-10", recurring: false, created_date: "2026-10-15" }, ctx());
  assert.deepEqual(r, { status: "pending", skip_reason: null, visit_date: "2026-10-15", rolled_from: null });
  const later = placeInstance({ due_date: "2026-10-16", recurring: false, created_date: "2026-10-15" }, ctx());
  assert.equal(later.visit_date, "2026-10-17");
  assert.equal(later.rolled_from, null); // simply her next visit, not "carried over"
});

test("placeInstance is idempotent (feeding the result back changes nothing)", () => {
  const c = ctx({ outDays: new Map([["2026-10-17", "shift"]]) });
  const first = placeInstance({ due_date: "2026-10-17", recurring: false, created_date: "2026-10-01" }, c);
  assert.equal(first.visit_date, "2026-10-19");
  assert.equal(first.rolled_from, "2026-10-17");
  const second = placeInstance({ due_date: "2026-10-17", recurring: false, created_date: "2026-10-01", ...first }, c);
  assert.deepEqual(second, first);
});

test("a task added after today's visit was finished goes to the following visit without a 'carried' mark", () => {
  const c = ctx({ closedDays: new Set(["2026-10-15"]) });
  const r = placeInstance({ due_date: "2026-10-15", recurring: false, created_date: "2026-10-15" }, c);
  assert.equal(r.visit_date, "2026-10-17");
  assert.equal(r.rolled_from, null);
});

test("a task added today while today's visit is still open appears today", () => {
  const r = placeInstance({ due_date: "2026-10-15", recurring: false, created_date: "2026-10-15" }, ctx());
  assert.equal(r.visit_date, "2026-10-15");
});
