// Pure out-day rules: validation, and a preview of what an out day does to the instances.
import { isRegularVisitDay } from "./visits.js";
import { planRecompute } from "./rollover.js";

export const REASONS = ["appointment", "sick", "other"];
export const MODES = ["hide", "shift"];

/** Returns an error message or null. Only today or a future regular visit day can be out. */
export function validateOutDay({ date, reason, mode }, ctx) {
  if (!REASONS.includes(reason)) return "Pick a reason: appointment, sick or other.";
  if (mode != null && !MODES.includes(mode)) return "Mode must be hide or shift.";
  if (date < ctx.today) return "A day that has already passed cannot be marked out.";
  if (!isRegularVisitDay(date, ctx)) return "That is not one of the regular visit days.";
  if (ctx.closedDays?.has(date)) return "That visit is already finished.";
  return null;
}

/**
 * What would marking `date` out do? Returns { shifted: [...], hidden: [...] } of plan rows
 * whose old visit day was `date`. Used for the API response and for tests.
 */
export function previewOutDay(instances, date, mode, ctx) {
  const outDays = new Map(ctx.outDays ?? []);
  outDays.set(date, mode ?? "shift");
  const changes = planRecompute(instances, { ...ctx, outDays });
  const affected = changes.filter((c) => c.from_visit === date);
  return {
    shifted: affected.filter((c) => c.status === "pending"),
    hidden: affected.filter((c) => c.status === "skipped"),
  };
}
