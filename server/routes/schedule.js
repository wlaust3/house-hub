import { Router } from "express";
import { h, actor, requireFamily } from "./util.js";
import { HttpError, loadContext, log } from "../services/context.js";
import { sync } from "../services/sync.js";
import { validateOutDay, previewOutDay, MODES } from "../logic/outdays.js";
import { isValidDate, addDays } from "../logic/dates.js";
import { upcomingVisits, isRegularVisitDay } from "../logic/visits.js";

export function scheduleRouter({ db, today }) {
  const r = Router();

  const outRows = (t0) => db.prepare("SELECT date, reason, mode, shifted_to, note, created_by FROM day_overrides WHERE date >= ? ORDER BY date").all(t0);

  r.get("/schedule", h((_req, res) => {
    const t0 = today();
    sync(db, t0);
    const ctx = loadContext(db, t0);
    const out = outRows(t0);
    // The next few regular visit days (including today) with whether each is out, for "I can't come".
    const visits = [];
    let d = addDays(t0, -1);
    for (let i = 0; i < 60 && visits.length < 6; i++) {
      d = addDays(d, 1);
      if (isRegularVisitDay(d, ctx) && !ctx.closedDays.has(d)) visits.push({ date: d, out: out.find((o) => o.date === d) ?? null });
    }
    res.json({ weekdays: ctx.weekdays, today: t0, out_days: out, visits });
  }));

  r.put("/schedule", h((req, res) => {
    const who = requireFamily(req);
    const t0 = today();
    const days = req.body?.weekdays;
    if (!Array.isArray(days) || !days.every((n) => Number.isInteger(n) && n >= 1 && n <= 7)) throw new HttpError(400, "Pick weekdays from Monday (1) to Sunday (7).");
    const set = [...new Set(days)].sort();
    if (set.length === 0) throw new HttpError(400, "Pick at least one day she comes.");
    db.transaction(() => {
      const upd = db.prepare("UPDATE schedule SET active = ? WHERE weekday = ?");
      for (let w = 1; w <= 7; w++) upd.run(set.includes(w) ? 1 : 0, w);
      log(db, who, "schedule.changed", "schedule", null, { weekdays: set });
    })();
    sync(db, t0);
    res.json({ weekdays: set });
  }));

  // One-tap out day. Default mode is shift (nothing is lost).
  r.post("/days-out", h((req, res) => {
    const who = actor(req);
    const t0 = today();
    sync(db, t0);
    const { date, reason } = req.body ?? {};
    const mode = req.body?.mode ?? "shift";
    if (!isValidDate(date)) throw new HttpError(400, "Pick a date.");
    if (mode !== "shift" && who !== "family") throw new HttpError(403, "Only the family can choose to hide a day's tasks.");
    const ctx = loadContext(db, t0);
    const err = validateOutDay({ date, reason, mode }, ctx);
    if (err) throw new HttpError(400, err);
    const note = who === "family" ? String(req.body?.note ?? "").trim().slice(0, 200) : "";
    let preview;
    db.transaction(() => {
      const instances = db.prepare(`
        SELECT i.id, i.task_id, i.due_date, i.visit_date, i.status, i.skip_reason, i.rolled_from, i.created_at,
               t.recurrence_id IS NOT NULL AS recurring FROM task_instances i JOIN tasks t ON t.id = i.task_id
        WHERE t.deleted_at IS NULL AND t.active = 1 AND i.status IN ('pending','skipped','done')`).all()
        .map((x) => ({ ...x, recurring: !!x.recurring }));
      preview = previewOutDay(instances, date, mode, ctx);
      db.prepare(`INSERT INTO day_overrides (date, reason, mode, note, created_by) VALUES (?,?,?,?,?)
        ON CONFLICT(date) DO UPDATE SET reason = excluded.reason, mode = excluded.mode, note = excluded.note`).run(date, reason, mode, note, who);
      log(db, who, "day.out", "day", null, { date, reason, mode });
    })();
    sync(db, t0);
    res.status(201).json({ date, reason, mode, shifted: preview.shifted.length, hidden: preview.hidden.length });
  }));

  // Family can switch an existing out day between shift and hide, or add a note.
  r.patch("/days-out/:date", h((req, res) => {
    const who = requireFamily(req);
    const t0 = today();
    const row = db.prepare("SELECT * FROM day_overrides WHERE date = ?").get(req.params.date);
    if (!row) throw new HttpError(404, "That day is not marked out.");
    const mode = req.body?.mode ?? row.mode;
    if (!MODES.includes(mode)) throw new HttpError(400, "Mode must be hide or shift.");
    const note = req.body?.note !== undefined ? String(req.body.note).trim().slice(0, 200) : row.note;
    db.transaction(() => {
      db.prepare("UPDATE day_overrides SET mode = ?, note = ? WHERE date = ?").run(mode, note, row.date);
      log(db, who, "day.out_changed", "day", null, { date: row.date, mode });
    })();
    sync(db, t0);
    res.json({ ok: true });
  }));

  r.delete("/days-out/:date", h((req, res) => {
    const who = actor(req);
    const t0 = today();
    const n = db.prepare("DELETE FROM day_overrides WHERE date = ?").run(req.params.date).changes;
    if (!n) throw new HttpError(404, "That day is not marked out.");
    db.transaction(() => log(db, who, "day.out_undone", "day", null, { date: req.params.date }))();
    sync(db, t0);
    res.json({ ok: true });
  }));

  return r;
}

export { upcomingVisits };
