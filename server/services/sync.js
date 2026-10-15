// Keeps task occurrences in step with the calendar: creates upcoming occurrences of recurring
// tasks and re-places everything that can still move (rollover, merge, out days, closures).
// Both steps are idempotent, so calling them at the start of every request is safe and cheap.
import { addDays } from "../logic/dates.js";
import { occurrencesToCreate } from "../logic/recurrence.js";
import { placeInstance } from "../logic/visits.js";
import { planRecompute } from "../logic/rollover.js";
import { loadContext, log, createdDate, HORIZON_DAYS, MAX_HORIZON_DAYS } from "./context.js";

/** Create missing occurrences for every active recurring task up to `through` (default: horizon). */
export function ensureInstances(db, today, through) {
  const horizon = addDays(today, Math.min(MAX_HORIZON_DAYS, Math.max(HORIZON_DAYS, through ? daysBetween(today, through) : 0)));
  const ctx = loadContext(db, today);
  const tasks = db.prepare(`
    SELECT t.id, t.generated_through, r.kind, r.interval_n, r.interval_unit, r.anchor_date, r.ends_on
    FROM tasks t JOIN recurrence_rules r ON r.id = t.recurrence_id
    WHERE t.active = 1 AND t.deleted_at IS NULL`).all();
  const insert = db.prepare(`
    INSERT INTO task_instances (task_id, due_date, visit_date, status, skip_reason, rolled_from)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(task_id, due_date) DO NOTHING`);
  const setThrough = db.prepare("UPDATE tasks SET generated_through = ? WHERE id = ?");
  let created = 0;
  for (const task of tasks) {
    if (task.generated_through && task.generated_through >= horizon) continue;
    const from = task.generated_through ? addDays(task.generated_through, 1) : task.anchor_date > today ? task.anchor_date : today;
    const existing = db.prepare("SELECT due_date FROM task_instances WHERE task_id = ? AND due_date >= ?").pluck().all(task.id, from);
    const dues = occurrencesToCreate({ rule: task, generatedThrough: task.generated_through, today, horizon, existing });
    for (const due of dues) {
      const p = placeInstance({ due_date: due, recurring: true, created_date: today }, ctx);
      created += insert.run(task.id, due, p.visit_date, p.status, p.skip_reason, p.rolled_from).changes;
    }
    setThrough.run(horizon, task.id);
  }
  return created;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Re-place pending (and revivable skipped) occurrences. Returns the changes applied. */
export function recompute(db, today) {
  const ctx = loadContext(db, today);
  const rows = db.prepare(`
    SELECT i.id, i.task_id, i.due_date, i.visit_date, i.status, i.skip_reason, i.rolled_from, i.created_at,
           t.recurrence_id IS NOT NULL AS recurring, t.title
    FROM task_instances i JOIN tasks t ON t.id = i.task_id
    WHERE t.deleted_at IS NULL AND t.active = 1 AND (
      i.status = 'pending'
      OR (i.status = 'skipped' AND i.skip_reason IS NOT NULL AND i.visit_date >= @today)
      OR (i.status = 'done' AND i.visit_date >= @today))`).all({ today });
  const instances = rows.map((r) => ({ ...r, recurring: !!r.recurring, created_date: createdDate(r.created_at) }));
  const changes = planRecompute(instances, ctx);
  if (changes.length === 0) return changes;
  const update = db.prepare("UPDATE task_instances SET visit_date = ?, rolled_from = ?, status = ?, skip_reason = ? WHERE id = ?");
  const titles = new Map(rows.map((r) => [r.id, r]));
  for (const c of changes) {
    update.run(c.visit_date, c.rolled_from, c.status, c.skip_reason, c.id);
    const before = titles.get(c.id);
    // Log genuine roll-forwards once (a visit that passed or was closed with the task unchecked).
    if (c.status === "pending" && before.status === "pending" && c.from_visit <= today && c.visit_date > c.from_visit && !ctx.outDays.has(c.from_visit)) {
      log(db, "system", "task.rolled", "task_instance", c.id, { title: before.title, from: c.from_visit, to: c.visit_date });
    }
  }
  return changes;
}

/** Run before reading or writing anything that depends on "where is each task today?". */
export function sync(db, today, through) {
  db.transaction(() => {
    ensureInstances(db, today, through);
    recompute(db, today);
  })();
}
