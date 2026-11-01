import { Router } from "express";
import { h, actor, requireFamily } from "./util.js";
import { HttpError, cleanText, parseId, getInstance, serializeInstance, loadContext, log, instanceQuery } from "../services/context.js";
import { sync } from "../services/sync.js";
import { placeInstance } from "../logic/visits.js";
import { isValidDate } from "../logic/dates.js";
import { validateRule, nextDue } from "../logic/recurrence.js";
import { addDays } from "../logic/dates.js";

function ruleFromBody(repeat, today, keepStart = null) {
  const kind = repeat?.kind;
  const rule = {
    kind,
    interval_n: kind === "custom" ? Number(repeat.n) : 1,
    interval_unit: kind === "custom" ? repeat.unit : "day",
    anchor_date: repeat?.start ?? today,
    ends_on: repeat?.ends_on || null,
  };
  const err = validateRule(rule);
  if (err) throw new HttpError(400, err);
  if (rule.anchor_date < today && rule.anchor_date !== keepStart) throw new HttpError(400, "The start date cannot be in the past.");
  return rule;
}

export function tasksRouter({ db, today }) {
  const r = Router();

  function taskRow(id) {
    const t = db.prepare(`
      SELECT t.*, r.kind AS repeat_kind, r.interval_n, r.interval_unit, r.anchor_date, r.ends_on
      FROM tasks t LEFT JOIN recurrence_rules r ON r.id = t.recurrence_id WHERE t.id = ? AND t.deleted_at IS NULL`).get(id);
    if (!t) throw new HttpError(404, "That task was not found.");
    return t;
  }

  function dropOpenInstances(taskId, where = "", params = []) {
    db.prepare(`DELETE FROM task_instances WHERE task_id = ? AND status != 'done' ${where}`).run(taskId, ...params);
  }

  // Definitions for the family's "Tasks" screen.
  r.get("/", h((req, res) => {
    requireFamily(req);
    const t0 = today();
    const rows = db.prepare(`
      SELECT t.id, t.title, t.notes, t.active, t.source, t.recurrence_id, r.kind, r.interval_n, r.interval_unit, r.anchor_date, r.ends_on
      FROM tasks t LEFT JOIN recurrence_rules r ON r.id = t.recurrence_id
      WHERE t.deleted_at IS NULL AND t.source != 'device' ORDER BY t.title COLLATE NOCASE`).all();
    const recurring = [];
    const oneOffs = [];
    for (const t of rows) {
      if (t.recurrence_id) {
        const rule = { kind: t.kind, interval_n: t.interval_n, interval_unit: t.interval_unit, anchor_date: t.anchor_date, ends_on: t.ends_on };
        recurring.push({
          id: t.id, title: t.title, notes: t.notes, active: !!t.active,
          repeat: { kind: t.kind, n: t.interval_n, unit: t.interval_unit, start: t.anchor_date, ends_on: t.ends_on },
          next_due: t.active ? nextDue(rule, addDays(t0, -1)) : null,
        });
      } else {
        const inst = db.prepare("SELECT * FROM task_instances WHERE task_id = ? ORDER BY id DESC LIMIT 1").get(t.id);
        if (inst && inst.status !== "done") {
          oneOffs.push({ id: t.id, title: t.title, notes: t.notes, due_date: inst.due_date, visit_date: inst.visit_date, rolled_from: inst.rolled_from });
        }
      }
    }
    res.json({ recurring, one_offs: oneOffs });
  }));

  r.post("/", h((req, res) => {
    const who = requireFamily(req);
    const t0 = today();
    const title = cleanText(req.body.title, { required: true, field: "The task name" });
    const notes = cleanText(req.body.notes, { max: 500 });
    const repeat = req.body.repeat ?? null;
    const ctx = loadContext(db, t0);
    let out;
    db.transaction(() => {
      if (repeat) {
        const rule = ruleFromBody(repeat, t0);
        const rid = db.prepare("INSERT INTO recurrence_rules (kind, interval_n, interval_unit, anchor_date, ends_on) VALUES (?,?,?,?,?)")
          .run(rule.kind, rule.interval_n, rule.interval_unit, rule.anchor_date, rule.ends_on).lastInsertRowid;
        const id = db.prepare("INSERT INTO tasks (title, notes, source, recurrence_id, created_by) VALUES (?,?,?,?,?)")
          .run(title, notes, "recurring", rid, who).lastInsertRowid;
        log(db, who, "task.added", "task", id, { title, repeat: rule.kind });
        out = { task_id: Number(id) };
      } else {
        const date = req.body.date ?? null;
        if (date != null && (!isValidDate(date) || date < t0)) throw new HttpError(400, "Pick today or a day in the future.");
        const due = date ?? t0;
        const id = db.prepare("INSERT INTO tasks (title, notes, source, created_by) VALUES (?,?,?,?)").run(title, notes, "manual", who).lastInsertRowid;
        const p = placeInstance({ due_date: due, recurring: false, created_date: t0 }, ctx);
        const iid = db.prepare("INSERT INTO task_instances (task_id, due_date, visit_date, status, rolled_from) VALUES (?,?,?,?,?)")
          .run(id, due, p.visit_date, p.status, p.rolled_from).lastInsertRowid;
        log(db, who, "task.added", "task", id, { title, visit_date: p.visit_date });
        out = { task_id: Number(id), instance_id: Number(iid), visit_date: p.visit_date };
      }
    })();
    sync(db, t0);
    res.status(201).json(out);
  }));

  r.patch("/:id", h((req, res) => {
    const who = requireFamily(req);
    const t0 = today();
    const id = parseId(req.params.id);
    const task = taskRow(id);
    const b = req.body ?? {};
    db.transaction(() => {
      const title = b.title !== undefined ? cleanText(b.title, { required: true, field: "The task name" }) : task.title;
      const notes = b.notes !== undefined ? cleanText(b.notes, { max: 500 }) : task.notes;
      db.prepare("UPDATE tasks SET title = ?, notes = ? WHERE id = ?").run(title, notes, id);

      if (task.recurrence_id) {
        if (b.repeat) {
          // Edits apply to FUTURE occurrences only; done history and anything already due stay.
          const rule = ruleFromBody({ ...b.repeat, start: b.repeat.start ?? task.anchor_date }, t0, task.anchor_date);
          db.prepare("UPDATE recurrence_rules SET kind=?, interval_n=?, interval_unit=?, anchor_date=?, ends_on=? WHERE id=?")
            .run(rule.kind, rule.interval_n, rule.interval_unit, rule.anchor_date, rule.ends_on, task.recurrence_id);
          dropOpenInstances(id, "AND due_date > ?", [t0]);
          db.prepare("UPDATE tasks SET generated_through = ? WHERE id = ?").run(addDays(t0, -1), id);
        }
        if (b.active !== undefined) {
          const active = b.active ? 1 : 0;
          db.prepare("UPDATE tasks SET active = ? WHERE id = ?").run(active, id);
          if (!active) dropOpenInstances(id); else db.prepare("UPDATE tasks SET generated_through = NULL WHERE id = ?").run(id);
          log(db, who, active ? "task.resumed" : "task.paused", "task", id, { title });
        }
      } else if (b.date !== undefined) {
        const inst = db.prepare("SELECT * FROM task_instances WHERE task_id = ? ORDER BY id DESC LIMIT 1").get(id);
        if (inst && inst.status === "done") throw new HttpError(409, "This task is already done, so it cannot be moved.");
        const due = b.date ?? t0;
        if (!isValidDate(due) || due < t0) throw new HttpError(400, "Pick today or a day in the future.");
        db.prepare("UPDATE task_instances SET due_date = ?, rolled_from = NULL, visit_date = ? WHERE id = ?").run(due, due, inst.id);
      }
      log(db, who, "task.edited", "task", id, { title });
    })();
    sync(db, t0);
    res.json({ ok: true });
  }));

  r.delete("/:id", h((req, res) => {
    const who = requireFamily(req);
    const id = parseId(req.params.id);
    const task = taskRow(id);
    const done = db.prepare("SELECT 1 FROM task_instances WHERE task_id = ? AND status = 'done'").get(id);
    if (!task.recurrence_id && done) throw new HttpError(409, "This task is already done, so it cannot be deleted.");
    db.transaction(() => {
      dropOpenInstances(id);
      db.prepare("UPDATE tasks SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), active = 0 WHERE id = ?").run(id);
      log(db, who, "task.deleted", "task", id, { title: task.title });
    })();
    res.json({ ok: true });
  }));

  return r;
}

export function instancesRouter({ db, today, now }) {
  const r = Router();

  r.get("/", h((req, res) => {
    const t0 = today();
    const from = req.query.from ?? t0;
    const to = req.query.to ?? addDays(from, 14);
    if (!isValidDate(from) || !isValidDate(to)) throw new HttpError(400, "from and to must be dates (YYYY-MM-DD).");
    const ctx = loadContext(db, t0);
    const rows = instanceQuery(db, "i.visit_date BETWEEN ? AND ? AND i.status IN ('pending','done')", [from, to]);
    res.json(rows.map((x) => serializeInstance(x, ctx)));
  }));

  r.patch("/:id", h((req, res) => {
    const who = actor(req);
    const t0 = today();
    const id = parseId(req.params.id);
    const cur = getInstance(db, id);
    if (!cur) throw new HttpError(404, "That task was not found.");
    const b = req.body ?? {};
    db.transaction(() => {
      if (b.note !== undefined) {
        const note = cleanText(b.note, { max: 500, field: "The note" });
        db.prepare("UPDATE task_instances SET note = ? WHERE id = ?").run(note, id);
        if (note !== cur.note) log(db, who, "task.noted", "task_instance", id, { title: cur.title, visit_date: cur.visit_date });
      }
      if (b.done !== undefined) {
        if (cur.status === "skipped") throw new HttpError(409, "That task was skipped, so it cannot be ticked.");
        if (b.done && cur.status !== "done") {
          db.prepare("UPDATE task_instances SET status='done', done_at=?, done_by=?, skip_reason=NULL WHERE id=?").run(now().toISOString(), who, id);
          log(db, who, "task.done", "task_instance", id, { title: cur.title, visit_date: cur.visit_date });
        } else if (!b.done && cur.status === "done") {
          db.prepare("UPDATE task_instances SET status='pending', done_at=NULL, done_by=NULL WHERE id=?").run(id);
          log(db, who, "task.undone", "task_instance", id, { title: cur.title, visit_date: cur.visit_date });
        }
      }
    })();
    if (b.done === false) sync(db, t0);
    res.json(serializeInstance(getInstance(db, id), loadContext(db, t0)));
  }));

  return r;
}
