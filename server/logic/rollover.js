// Pure rollover / recompute planning.
//
// `planRecompute` takes every instance that could still move and returns only the rows that
// must change. The server runs it whenever the date, the schedule, an out day or a closed
// visit changes. Because placeInstance is idempotent, a missed visit rolls forward without
// anyone pressing anything, an undone out day moves things back, and a second run is a no-op.
import { placeInstance } from "./visits.js";

/**
 * instances: [{ id, task_id, recurring, due_date, visit_date, status, skip_reason,
 *               rolled_from, created_date }]
 *   - status 'pending'                         -> always re-placed
 *   - status 'skipped' with a skip_reason and visit_date >= today -> re-placed (can be revived)
 *   - status 'done'                            -> never changed; only blocks merged duplicates
 * Returns [{ id, visit_date, rolled_from, status, skip_reason }] for rows that change.
 */
export function planRecompute(instances, ctx) {
  const { today } = ctx;
  const placed = [];
  const doneKeys = new Set();

  for (const inst of instances) {
    if (inst.status === "done") {
      if (inst.recurring) doneKeys.add(`${inst.task_id}|${inst.visit_date}`);
      continue;
    }
    if (inst.status === "skipped" && !(inst.skip_reason && inst.visit_date >= today)) continue;
    if (inst.status !== "pending" && inst.status !== "skipped") continue;
    placed.push({ inst, to: placeInstance(inst, ctx) });
  }

  // A recurring task never has more than one open occurrence per visit: when several
  // occurrences land on the same visit day they merge into one (the earliest, which keeps its
  // "carried over" marker). If one is already done that day, the rest stay merged away.
  const groups = new Map();
  for (const p of placed) {
    if (!p.inst.recurring || p.to.status !== "pending") continue;
    const key = `${p.inst.task_id}|${p.to.visit_date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  for (const [key, group] of groups) {
    group.sort((a, b) => (a.inst.due_date < b.inst.due_date ? -1 : a.inst.due_date > b.inst.due_date ? 1 : a.inst.id - b.inst.id));
    const blocked = doneKeys.has(key);
    const earliestRolled = group.map((g) => g.to.rolled_from).filter(Boolean).sort()[0] ?? null;
    group.forEach((g, i) => {
      if (blocked || i > 0) {
        g.to = { status: "skipped", skip_reason: "merged", visit_date: g.to.visit_date, rolled_from: g.to.rolled_from };
      } else {
        g.to = { ...g.to, rolled_from: earliestRolled };
      }
    });
  }

  const changes = [];
  for (const { inst, to } of placed) {
    if (
      inst.visit_date !== to.visit_date ||
      (inst.rolled_from ?? null) !== to.rolled_from ||
      inst.status !== to.status ||
      (inst.skip_reason ?? null) !== to.skip_reason
    ) {
      changes.push({ id: inst.id, visit_date: to.visit_date, rolled_from: to.rolled_from, status: to.status, skip_reason: to.skip_reason, from_visit: inst.visit_date });
    }
  }
  return changes;
}
