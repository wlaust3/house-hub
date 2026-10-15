// Database-facing helpers shared by the routes: loading the visit context, logging,
// serialising instances. The decisions themselves live in server/logic/ (pure functions).
import { addDays, localDate } from "../logic/dates.js";
import { countVisitsBetween } from "../logic/visits.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** How many days ahead tasks are due and "coming up" (single named constant). */
export const DUE_SOON_DAYS = 3;
/** Recurring occurrences are materialised this far ahead (calendar preview). */
export const HORIZON_DAYS = 60;
/** The calendar may look further ahead than HORIZON_DAYS, but never beyond this. */
export const MAX_HORIZON_DAYS = 400;
export const UPCOMING_VISITS = 3;

export function loadContext(db, today) {
  const weekdays = db.prepare("SELECT weekday FROM schedule WHERE active = 1 ORDER BY weekday").pluck().all();
  const outDays = new Map(db.prepare("SELECT date, mode FROM day_overrides WHERE date >= ?").all(today).map((r) => [r.date, r.mode]));
  const closedDays = new Set(db.prepare("SELECT date FROM visit_closures WHERE date >= ?").pluck().all(today));
  return { today, weekdays, outDays, closedDays };
}

export function log(db, actor, action, entity, entityId, detail = {}, at) {
  db.prepare("INSERT INTO activity_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)").run(
    actor, action, entity, entityId ?? null, JSON.stringify(detail),
  );
  void at;
}

export function createdDate(isoUtc) {
  return isoUtc ? localDate(new Date(isoUtc)) : undefined;
}

const INSTANCE_SELECT = `
  SELECT i.id, i.task_id, i.due_date, i.visit_date, i.status, i.skip_reason, i.done_at, i.done_by,
         i.note, i.rolled_from, i.created_at,
         t.title, t.notes, t.source, t.source_meta, t.recurrence_id,
         r.kind AS repeat_kind, r.interval_n, r.interval_unit
  FROM task_instances i
  JOIN tasks t ON t.id = i.task_id
  LEFT JOIN recurrence_rules r ON r.id = t.recurrence_id`;

export function instanceQuery(db, where, params = []) {
  return db.prepare(`${INSTANCE_SELECT} WHERE t.deleted_at IS NULL AND ${where} ORDER BY i.visit_date, i.status = 'done', i.id`).all(...params);
}

export function getInstance(db, id) {
  return db.prepare(`${INSTANCE_SELECT} WHERE i.id = ?`).get(id);
}

/** Shape sent to the web app. `carried_visits` = how many regular visits it has been carried. */
export function serializeInstance(row, ctx) {
  const carried = row.rolled_from != null && row.rolled_from < row.visit_date;
  return {
    id: row.id,
    task_id: row.task_id,
    title: row.title,
    task_notes: row.notes,
    note: row.note,
    status: row.status,
    due_date: row.due_date,
    visit_date: row.visit_date,
    done_at: row.done_at,
    done_by: row.done_by,
    recurring: row.recurrence_id != null,
    repeat: row.repeat_kind ? { kind: row.repeat_kind, n: row.interval_n, unit: row.interval_unit } : null,
    source: row.source,
    carried_from: carried ? row.rolled_from : null,
    carried_visits: carried ? Math.max(1, countVisitsBetween(row.rolled_from, row.visit_date, ctx)) : 0,
  };
}

export function parseId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "That id is not valid.");
  return n;
}

export function cleanText(v, { max = 200, required = false, field = "Text" } = {}) {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw new HttpError(400, `${field} is required.`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (at most ${max} characters).`);
  return s;
}

export { addDays };
