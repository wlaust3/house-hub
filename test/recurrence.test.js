import test from "node:test";
import assert from "node:assert/strict";
import { occurrence, occurrencesBetween, nextDue, validateRule, occurrencesToCreate } from "../server/logic/recurrence.js";
import { addMonthsClamped, isoWeekday, isValidDate } from "../server/logic/dates.js";

const rule = (kind, anchor, extra = {}) => ({ kind, anchor_date: anchor, interval_n: 1, interval_unit: "day", ends_on: null, ...extra });

test("dates: validation and ISO weekday", () => {
  assert.ok(isValidDate("2028-02-29"));
  assert.ok(!isValidDate("2027-02-29"));
  assert.ok(!isValidDate("2026-13-01"));
  assert.ok(!isValidDate("26-1-1"));
  assert.equal(isoWeekday("2026-10-15"), 4); // Thursday
  assert.equal(isoWeekday("2026-10-18"), 7); // Sunday
  assert.equal(isoWeekday("2026-10-19"), 1);
});

test("daily and weekly keep the weekday", () => {
  assert.deepEqual(occurrencesBetween(rule("daily", "2026-10-01"), "2026-10-03", "2026-10-06"),
    ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]);
  const w = occurrencesBetween(rule("weekly", "2026-10-05"), "2026-10-01", "2026-11-02");
  assert.deepEqual(w, ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
  assert.ok(w.every((d) => isoWeekday(d) === 1));
});

test("weekly rule spans a DST change without shifting", () => {
  // US clocks go back on 2026-11-01
  const w = occurrencesBetween(rule("weekly", "2026-10-25"), "2026-10-25", "2026-11-15");
  assert.deepEqual(w, ["2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15"]);
});

test("monthly on the 31st clamps to month end and recovers (no drift)", () => {
  const r = rule("monthly", "2027-01-31");
  assert.deepEqual(occurrencesBetween(r, "2027-01-01", "2027-06-30"),
    ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31", "2027-06-30"]);
});

test("monthly on the 31st in a leap year lands on Feb 29", () => {
  assert.equal(occurrence(rule("monthly", "2028-01-31"), 1), "2028-02-29");
  assert.equal(occurrence(rule("monthly", "2028-01-31"), 2), "2028-03-31");
});

test("monthly anchored on Feb 29 (leap day) clamps in later months and years", () => {
  const r = rule("monthly", "2028-02-29");
  assert.equal(occurrence(r, 1), "2028-03-29");
  assert.equal(occurrence(r, 12), "2029-02-28");
  assert.equal(occurrence(r, 48), "2032-02-29");
});

test("every six months is +6 calendar months, clamped", () => {
  const r = rule("every_six_months", "2026-08-31");
  assert.deepEqual([0, 1, 2, 3].map((k) => occurrence(r, k)), ["2026-08-31", "2027-02-28", "2027-08-31", "2028-02-29"]);
  assert.equal(addMonthsClamped("2026-12-15", 6), "2027-06-15");
});

test("custom intervals: days, weeks, months", () => {
  const days = rule("custom", "2026-10-01", { interval_n: 10, interval_unit: "day" });
  assert.deepEqual(occurrencesBetween(days, "2026-10-01", "2026-10-31"), ["2026-10-01", "2026-10-11", "2026-10-21", "2026-10-31"]);
  const weeks = rule("custom", "2026-10-05", { interval_n: 3, interval_unit: "week" });
  assert.deepEqual(occurrencesBetween(weeks, "2026-10-01", "2026-12-31"), ["2026-10-05", "2026-10-26", "2026-11-16", "2026-12-07", "2026-12-28"]);
  const months = rule("custom", "2026-11-30", { interval_n: 2, interval_unit: "month" });
  assert.deepEqual(occurrencesBetween(months, "2026-11-01", "2027-07-31"), ["2026-11-30", "2027-01-30", "2027-03-30", "2027-05-30", "2027-07-30"]);
});

test("range query far after the anchor matches brute force", () => {
  const r = rule("custom", "2020-01-31", { interval_n: 1, interval_unit: "month" });
  const got = occurrencesBetween(r, "2026-12-01", "2027-03-31");
  assert.deepEqual(got, ["2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
  const w = rule("custom", "2020-01-06", { interval_n: 2, interval_unit: "week" });
  const all = occurrencesBetween(w, "2020-01-06", "2026-12-31");
  const slice = occurrencesBetween(w, "2026-06-01", "2026-12-31");
  assert.deepEqual(slice, all.filter((d) => d >= "2026-06-01"));
});

test("ends_on stops generation; nextDue is strictly after", () => {
  const r = rule("weekly", "2026-10-05", { ends_on: "2026-10-20" });
  assert.deepEqual(occurrencesBetween(r, "2026-10-01", "2026-12-31"), ["2026-10-05", "2026-10-12", "2026-10-19"]);
  assert.equal(nextDue(r, "2026-10-12"), "2026-10-19");
  assert.equal(nextDue(r, "2026-10-19"), null);
  assert.equal(nextDue(rule("monthly", "2027-01-31"), "2027-01-31"), "2027-02-28");
});

test("the next occurrence is scheduled from the rule, not from when it was ticked", () => {
  // Ticking the Oct 5 occurrence late (Oct 9) does not move the following one.
  assert.equal(nextDue(rule("weekly", "2026-10-05"), "2026-10-05"), "2026-10-12");
});

test("validateRule", () => {
  assert.equal(validateRule(rule("daily", "2026-10-01")), null);
  assert.ok(validateRule(rule("custom", "2026-10-01", { interval_n: 0, interval_unit: "day" })));
  assert.ok(validateRule(rule("custom", "2026-10-01", { interval_n: 2, interval_unit: "year" })));
  assert.ok(validateRule(rule("hourly", "2026-10-01")));
  assert.ok(validateRule(rule("daily", "2026-13-01")));
  assert.ok(validateRule(rule("daily", "2026-10-05", { ends_on: "2026-10-01" })));
});

test("occurrencesToCreate is idempotent and starts at max(anchor, today)", () => {
  const r = rule("weekly", "2026-09-07"); // Mondays, anchor in the past
  const first = occurrencesToCreate({ rule: r, generatedThrough: null, today: "2026-10-15", horizon: "2026-11-01", existing: [] });
  assert.deepEqual(first, ["2026-10-19", "2026-10-26"]);
  const again = occurrencesToCreate({ rule: r, generatedThrough: "2026-11-01", today: "2026-10-15", horizon: "2026-11-01", existing: first });
  assert.deepEqual(again, []);
  const later = occurrencesToCreate({ rule: r, generatedThrough: "2026-11-01", today: "2026-10-15", horizon: "2026-11-10", existing: first });
  assert.deepEqual(later, ["2026-11-02", "2026-11-09"]);
});
