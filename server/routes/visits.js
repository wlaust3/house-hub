import { Router } from "express";
import { h, actor } from "./util.js";
import { HttpError, loadContext, log, instanceQuery, serializeInstance } from "../services/context.js";
import { sync } from "../services/sync.js";
import { isRegularVisitDay, nextVisitAfter } from "../logic/visits.js";
import { isValidDate } from "../logic/dates.js";

export function visitsRouter({ db, today, now }) {
  const r = Router();

  function mustBeToday(date, t0) {
    if (!isValidDate(date)) throw new HttpError(400, "That date is not valid.");
    if (date !== t0) throw new HttpError(400, "You can only finish today's visit.");
  }

  // "All done": save the final tick state for today's list and close the visit. Anything left
  // unchecked rolls to her next visit.
  r.post("/:date/close", h((req, res) => {
    const who = actor(req);
    const t0 = today();
    const date = req.params.date;
    mustBeToday(date, t0);
    const ids = req.body?.done_ids;
    if (!Array.isArray(ids) || !ids.every(Number.isInteger)) throw new HttpError(400, "done_ids must be a list of task ids.");
    let ctx = loadContext(db, t0);
    if (!isRegularVisitDay(date, ctx) || ctx.outDays.has(date)) throw new HttpError(400, "There is no visit today to finish.");
    if (ctx.closedDays.has(date)) throw new HttpError(409, "Today's visit is already finished.");
    const wanted = new Set(ids);
    let doneCount = 0;
    let carried = 0;
    db.transaction(() => {
      const items = instanceQuery(db, "i.visit_date = ? AND i.status IN ('pending','done')", [date]);
      for (const it of items) {
        const shouldBeDone = wanted.has(it.id);
        if (shouldBeDone && it.status !== "done") {
          db.prepare("UPDATE task_instances SET status='done', done_at=?, done_by=? WHERE id=?").run(now().toISOString(), who, it.id);
          log(db, who, "task.done", "task_instance", it.id, { title: it.title, visit_date: date });
        } else if (!shouldBeDone && it.status === "done") {
          db.prepare("UPDATE task_instances SET status='pending', done_at=NULL, done_by=NULL WHERE id=?").run(it.id);
          log(db, who, "task.undone", "task_instance", it.id, { title: it.title, visit_date: date });
        }
        if (shouldBeDone) doneCount++; else carried++;
      }
      db.prepare("INSERT INTO visit_closures (date, closed_by) VALUES (?, ?)").run(date, who);
      ctx = loadContext(db, t0);
      log(db, who, "visit.closed", "visit", null, { date, done: doneCount, carried, next_visit: nextVisitAfter(date, ctx) });
    })();
    sync(db, t0);
    res.json({ done: doneCount, carried, next_visit: nextVisitAfter(date, loadContext(db, t0)) });
  }));

  // Undo "All done" for today: unfinished items move back to today.
  r.delete("/:date", h((req, res) => {
    const who = actor(req);
    const t0 = today();
    mustBeToday(req.params.date, t0);
    const n = db.prepare("DELETE FROM visit_closures WHERE date = ?").run(req.params.date).changes;
    if (!n) throw new HttpError(404, "Today's visit was not finished.");
    log(db, who, "visit.reopened", "visit", null, { date: req.params.date });
    sync(db, t0);
    res.json({ ok: true });
  }));

  return r;
}

export { serializeInstance };
