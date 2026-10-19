// Keeps task occurrences in step with the calendar: creates upcoming occurrences of recurring
// tasks and re-places everything that can still move (rollover, merge, out days, closures).
// Both steps are idempotent, so calling them at the start of every request is safe and cheap.
import { addDays } from "../logic/dates.js";
import { occurrencesToCreate } from "../logic/recurrence.js";
import { placeInstance } from "../logic/visits.js";
import { planRecompute } from "../logic/rollover.js";
import { periodStart, shouldExpire } from "../logic/periods.js";
import { loadContext, contextFor, log, createdDate, HORIZON_DAYS, MAX_HORIZON_DAYS } from "./context.js";

/** Create missing occurrences for every active recurring task up to `through` (default: horizon). */
export function ensureInstances(db, today, through) {
  const horizon = addDays(today, Math.min(MAX_HORIZON_DAYS, Math.max(HORIZON_DAYS, through ? daysBetween(today, through) : 0)));
  const ctx = loadContext(db, today);
  const tasks = db.prepare(`
    SELECT t.id, t.generated_through, t.period, COALESCE(m.role, 'housekeeper') AS owner_role,
           r.kind, r.interval_n, r.interval_unit, r.anchor_date, r.ends_on
    FROM tasks t JOIN recurrence_rules r ON r.id = t.recurrence_id LEFT JOIN members m ON m.id = t.owner_id
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
      const p = placeInstance({ due_date: periodStart(due, task.period), recurring: true, created_date: today }, contextFor(task.owner_role, ctx));
      created += insert.run(task.id, due, p.visit_date, p.status, p.skip_reason, p.rolled_from).changes;
    }
    setThrough.run(horizon, task.id);
  }
  return created;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Remove unfinished occurrences whose task says "drop" or "expire after N days" once their time is up. */
export function expireInstances(db, today, nowIso) {
  const ctx = loadContext(db, today);
  const rows = db.prepare(`
    SELECT i.id, i.due_date, i.visit_date, i.status, t.title, t.period, t.if_not_done, t.expire_days,
           COALESCE(m.role, 'housekeeper') AS owner_role
    FROM task_instances i JOIN tasks t ON t.id = i.task_id LEFT JOIN members m ON m.id = t.owner_id
    WHERE t.deleted_at IS NULL AND i.status = 'pending' AND t.if_not_done != 'carry'`).all();
  const expire = db.prepare("UPDATE task_instances SET status = 'skipped', skip_reason = NULL, expired_at = ? WHERE id = ?");
  let n = 0;
  for (const r of rows) {
    if (!shouldExpire(r, r, contextFor(r.owner_role, ctx))) continue;
    expire.run(nowIso, r.id);
    log(db, "system", "task.expired", "task_instance", r.id, { title: r.title, date: r.due_date });
    n++;
  }
  return n;
}

/** Re-place pending (and revivable skipped) occurrences. Returns the changes applied. */
export function recompute(db, today) {
  const ctx = loadContext(db, today);
  const rows = db.prepare(`
    SELECT i.id, i.task_id, i.due_date, i.visit_date, i.status, i.skip_reason, i.rolled_from, i.created_at,
           t.recurrence_id IS NOT NULL AS recurring, t.title, t.period, COALESCE(m.role, 'housekeeper') AS owner_role
    FROM task_instances i JOIN tasks t ON t.id = i.task_id LEFT JOIN members m ON m.id = t.owner_id
    WHERE t.deleted_at IS NULL AND t.active = 1 AND (
      i.status = 'pending'
      OR (i.status = 'skipped' AND i.skip_reason IS NOT NULL AND i.visit_date >= @today)
      OR (i.status = 'done' AND i.visit_date >= @today))`).all({ today });
  // Week/month tasks are placed from the start of their period; the stored due_date is unchanged.
  const instances = rows.map((r) => ({ ...r, recurring: !!r.recurring, created_date: createdDate(r.created_at), due_date: periodStart(r.due_date, r.period) }));
  // The housekeeper's tasks follow her visits; everyone else's follow their own dates.
  const hk = instances.filter((x) => x.owner_role === "housekeeper");
  const others = instances.filter((x) => x.owner_role !== "housekeeper");
  const changes = [...planRecompute(hk, ctx), ...planRecompute(others, contextFor("adult", ctx))];
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

/** Put repeating grocery items back on the list when they come due (unless already on it). */
export function addDueStaples(db, today) {
  const due = db.prepare("SELECT * FROM grocery_staples WHERE removed_at IS NULL AND next_on <= ?").all(today);
  const onList = db.prepare("SELECT 1 FROM grocery_items WHERE cleared_at IS NULL AND bought_at IS NULL AND name = ? COLLATE NOCASE");
  for (const st of due) {
    if (!onList.get(st.name)) {
      const id = db.prepare("INSERT INTO grocery_items (name, quantity, added_by) VALUES (?,?,'family')").run(st.name, st.quantity).lastInsertRowid;
      log(db, "system", "grocery.added", "grocery_item", id, { name: st.name, repeating: true });
    }
    db.prepare("UPDATE grocery_staples SET next_on = ? WHERE id = ?").run(addDays(today, st.every_days), st.id);
  }
}

/** Run before reading or writing anything that depends on "where is each task today?". */
export function sync(db, today, through, nowIso = new Date().toISOString()) {
  db.transaction(() => {
    ensureInstances(db, today, through);
    expireInstances(db, today, nowIso);
    recompute(db, today);
    addDueStaples(db, today);
  })();
}
