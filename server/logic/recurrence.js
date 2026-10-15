// Pure recurrence computation. Occurrence k is ALWAYS computed from the anchor
// (anchor + k * interval), never from the previous result, so month-end clamping
// does not drift (Jan 31 -> Feb 28 -> Mar 31, not Mar 28).
import { addDays, addMonthsClamped, diffDays, monthIndexDiff, isValidDate } from "./dates.js";

export const KINDS = ["daily", "weekly", "monthly", "every_six_months", "custom"];
export const UNITS = ["day", "week", "month"];

/** The (n, unit) step a rule repeats by. */
export function stepOf(rule) {
  switch (rule.kind) {
    case "daily": return { n: 1, unit: "day" };
    case "weekly": return { n: 1, unit: "week" };
    case "monthly": return { n: 1, unit: "month" };
    case "every_six_months": return { n: 6, unit: "month" };
    case "custom": return { n: rule.interval_n, unit: rule.interval_unit };
    default: throw new Error(`Unknown recurrence kind: ${rule.kind}`);
  }
}

/** Returns an error message or null. */
export function validateRule(rule) {
  if (!rule || !KINDS.includes(rule.kind)) return "Pick how often the task repeats.";
  if (!isValidDate(rule.anchor_date)) return "Pick a valid start date.";
  if (rule.ends_on != null && (!isValidDate(rule.ends_on) || rule.ends_on < rule.anchor_date)) {
    return "The end date must be on or after the start date.";
  }
  if (rule.kind === "custom") {
    if (!Number.isInteger(rule.interval_n) || rule.interval_n < 1 || rule.interval_n > 366) {
      return "Repeat every N: N must be a whole number from 1 to 366.";
    }
    if (!UNITS.includes(rule.interval_unit)) return "Pick days, weeks or months.";
  }
  return null;
}

/** The k-th due date (k = 0 is the anchor). */
export function occurrence(rule, k) {
  const { n, unit } = stepOf(rule);
  if (unit === "day") return addDays(rule.anchor_date, k * n);
  if (unit === "week") return addDays(rule.anchor_date, k * n * 7);
  return addMonthsClamped(rule.anchor_date, k * n);
}

function firstIndexAtOrAfter(rule, from) {
  const { n, unit } = stepOf(rule);
  if (from <= rule.anchor_date) return 0;
  let k;
  if (unit === "month") k = Math.floor(monthIndexDiff(rule.anchor_date, from) / n) - 1;
  else k = Math.floor(diffDays(from, rule.anchor_date) / (n * (unit === "week" ? 7 : 1))) - 1;
  k = Math.max(0, k);
  while (occurrence(rule, k) < from) k++;
  return k;
}

/** Due dates d with from <= d <= to (inclusive), honouring ends_on. */
export function occurrencesBetween(rule, from, to) {
  const out = [];
  if (to < from) return out;
  for (let k = firstIndexAtOrAfter(rule, from); ; k++) {
    const d = occurrence(rule, k);
    if (d > to) break;
    if (rule.ends_on && d > rule.ends_on) break;
    out.push(d);
    if (out.length > 5000) break; // safety net
  }
  return out;
}

/** First due date strictly after `after`, or null if the rule has ended. */
export function nextDue(rule, after) {
  const start = addDays(after, 1);
  const k = firstIndexAtOrAfter(rule, start);
  const d = occurrence(rule, k);
  if (rule.ends_on && d > rule.ends_on) return null;
  return d;
}

/** Due dates that still need an instance created. Pure: the caller supplies what exists. */
export function occurrencesToCreate({ rule, generatedThrough, today, horizon, existing }) {
  const from = generatedThrough ? addDays(generatedThrough, 1) : (rule.anchor_date > today ? rule.anchor_date : today);
  const have = existing instanceof Set ? existing : new Set(existing ?? []);
  return occurrencesBetween(rule, from, horizon).filter((d) => !have.has(d));
}

/** Plain-language description key + variables for the UI (no English here). */
export function describeRule(rule) {
  if (rule.kind !== "custom") return { kind: rule.kind };
  return { kind: "custom", n: rule.interval_n, unit: rule.interval_unit };
}
