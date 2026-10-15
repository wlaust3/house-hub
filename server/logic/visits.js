// Pure visit-day logic: which day will the housekeeper actually see a task on?
//
// Context shape (plain values, no DB, no clock):
//   { today: 'YYYY-MM-DD',
//     weekdays: number[] | Set<number>,   // regular visit weekdays, ISO 1..7
//     outDays: Map<date, 'hide'|'shift'>, // regular visits that will NOT happen
//     closedDays: Set<date> }             // visits already finished ("All done" pressed)
import { addDays, isoWeekday, maxDate, diffDays } from "./dates.js";

const SCAN_LIMIT = 900; // days; protects against pathological input

function wd(ctx) {
  return ctx.weekdays instanceof Set ? ctx.weekdays : new Set(ctx.weekdays);
}

export function isRegularVisitDay(date, ctx) {
  return wd(ctx).has(isoWeekday(date));
}

/** First regular visit weekday on or after `date`, ignoring out days and closed visits. */
export function rawVisitOnOrAfter(date, ctx) {
  const set = wd(ctx);
  if (set.size === 0) return date; // no schedule at all: show things on their own date
  let d = date;
  for (let i = 0; i < 8; i++, d = addDays(d, 1)) if (set.has(isoWeekday(d))) return d;
  return date;
}

/** Is she actually coming (regular day, not marked out, visit not already finished)? */
export function isAvailableVisit(date, ctx) {
  return isRegularVisitDay(date, ctx) && !ctx.outDays?.has(date) && !ctx.closedDays?.has(date);
}

/** First day on or after `date` on which she is actually coming. */
export function firstVisitOnOrAfter(date, ctx) {
  if (wd(ctx).size === 0) return date;
  let d = rawVisitOnOrAfter(date, ctx);
  for (let i = 0; i < SCAN_LIMIT; i++) {
    if (isAvailableVisit(d, ctx)) return d;
    d = rawVisitOnOrAfter(addDays(d, 1), ctx);
  }
  return d;
}

export function nextVisitAfter(date, ctx) {
  return firstVisitOnOrAfter(addDays(date, 1), ctx);
}

/** The next `count` days she is coming, starting strictly after `date`. */
export function upcomingVisits(date, count, ctx) {
  const out = [];
  let d = date;
  for (let i = 0; i < count; i++) {
    d = nextVisitAfter(d, ctx);
    if (out.includes(d)) break;
    out.push(d);
  }
  return out;
}

/** How many regular visits lie in [from, to): used for "carried over N visits". */
export function countVisitsBetween(from, to, ctx) {
  const set = wd(ctx);
  let n = 0;
  const span = Math.min(diffDays(to, from), 400);
  for (let i = 0; i < span; i++) if (set.has(isoWeekday(addDays(from, i)))) n++;
  return n;
}

/**
 * Decide where one task occurrence belongs RIGHT NOW. Pure and idempotent: feeding the
 * result back in gives the same result, so the server can recompute whenever the schedule,
 * an out day or the date changes.
 *
 * inst: { due_date, recurring: boolean,
 *         visit_date?, rolled_from?, created_date? }   (visit_date absent => brand new)
 * Returns { status: 'pending'|'skipped', skip_reason: null|'out_day',
 *           visit_date, rolled_from }
 *
 * - The base day is max(due_date, today): nothing is ever placed in the past.
 * - A visit that already passed with the task unchecked, or one already carried over
 *   (rolled_from in the past), keeps its original rolled_from and moves forward.
 * - If the visit day is out in `hide` mode and the occurrence is a *fresh recurring* one it is
 *   skipped. One-off tasks and anything already carried over are never hidden: they shift.
 * - Otherwise it goes to the first day she is really coming; if that differs from the
 *   planned visit it is marked "carried over" from the planned day.
 */
export function placeInstance(inst, ctx) {
  const { today } = ctx;
  const base = maxDate(inst.due_date, today);
  const raw = rawVisitOnOrAfter(base, ctx);

  const missed = inst.visit_date != null && inst.visit_date < today;
  const priorCarry = inst.rolled_from != null && inst.rolled_from < today;
  const carriedFrom = missed || priorCarry ? (inst.rolled_from ?? inst.visit_date) : null;

  if (ctx.outDays?.get(raw) === "hide" && inst.recurring && !carriedFrom) {
    return { status: "skipped", skip_reason: "out_day", visit_date: raw, rolled_from: null };
  }

  const visit = firstVisitOnOrAfter(raw, ctx);
  const existedBefore = inst.created_date === undefined || inst.created_date < raw;
  const rolled_from = carriedFrom ?? (visit !== raw && existedBefore ? raw : null);
  return { status: "pending", skip_reason: null, visit_date: visit, rolled_from };
}
