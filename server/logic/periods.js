// Pure rules for task periods (day / week / month), "if not done" expiry, and which visits
// count as "coming up". No DB, no clock: pass `today` and the visit context in.
import { addDays, isoWeekday, daysInMonth } from "./dates.js";
import { firstVisitOnOrAfter, isRegularVisitDay } from "./visits.js";

export const PERIODS = ["day", "week", "month"];
export const IF_NOT_DONE = ["carry", "drop", "expire"];

/** Monday of the ISO week containing `date`. */
export function weekStart(date) {
  return addDays(date, 1 - isoWeekday(date));
}

/** First day of the period containing `date` (a 'day' period is the date itself). */
export function periodStart(date, period) {
  if (period === "week") return weekStart(date);
  if (period === "month") return `${date.slice(0, 7)}-01`;
  return date;
}

/** Last day of the period containing `date`. */
export function periodEnd(date, period) {
  if (period === "week") return addDays(weekStart(date), 6);
  if (period === "month") return `${date.slice(0, 7)}-${String(daysInMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7)))).padStart(2, "0")}`;
  return date;
}

/**
 * Should an unfinished occurrence be removed now? Only once the visit it was shown on has passed
 * (or was closed with it unchecked), so every task gets at least one showing.
 *   - 'drop':   when its next possible showing falls after its day/period
 *   - 'expire': when more than `expire_days` have passed since its day/period ended
 * inst: { due_date, visit_date, status }, task: { period, if_not_done, expire_days }
 */
export function shouldExpire(inst, task, ctx) {
  if (inst.status !== "pending" || task.if_not_done === "carry") return false;
  const passed = inst.visit_date < ctx.today || ctx.closedDays?.has(inst.visit_date);
  if (!passed) return false;
  const end = periodEnd(inst.due_date, task.period ?? "day");
  if (task.if_not_done === "drop") {
    const nextChance = firstVisitOnOrAfter(inst.visit_date < ctx.today ? ctx.today : addDays(inst.visit_date, 1), ctx);
    return nextChance > end;
  }
  return ctx.today > addDays(end, task.expire_days ?? 1);
}

/**
 * Days shown under "Coming up": her visit days (and out days) after today through Sunday.
 * If none are left this week (e.g. today is her last day of the week), next Monday-Sunday.
 * `outDates` are included so the family sees "out" days in place.
 */
export function comingUpDates(today, ctx, outDates = []) {
  const pick = (from, to) => {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (isRegularVisitDay(d, ctx) || outDates.includes(d)) out.push(d);
    return out;
  };
  const sunday = addDays(weekStart(today), 6);
  const rest = today < sunday ? pick(addDays(today, 1), sunday) : [];
  return rest.length > 0 ? rest : pick(addDays(sunday, 1), addDays(sunday, 7));
}
