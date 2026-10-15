// Read-only composed views: the home screen, the calendar and the history list.
import { Router } from "express";
import { h, requireFamily } from "./util.js";
import { HttpError, loadContext, instanceQuery, serializeInstance, DUE_SOON_DAYS, UPCOMING_VISITS } from "../services/context.js";
import { sync } from "../services/sync.js";
import { addDays, daysInMonth, isoWeekday } from "../logic/dates.js";
import { isRegularVisitDay, nextVisitAfter, firstVisitOnOrAfter, upcomingVisits } from "../logic/visits.js";

export function viewsRouter({ db, today }) {
  const r = Router();

  r.get("/home", h((_req, res) => {
    const t0 = today();
    sync(db, t0);
    const ctx = loadContext(db, t0);
    const ser = (rows) => rows.map((x) => serializeInstance(x, ctx));

    const regular = isRegularVisitDay(t0, ctx);
    const outToday = db.prepare("SELECT date, reason, mode, note FROM day_overrides WHERE date = ?").get(t0) ?? null;
    const closed = db.prepare("SELECT closed_at FROM visit_closures WHERE date = ?").get(t0);
    const open = regular && !outToday && !closed;

    const todayItems = ser(instanceQuery(db, "i.visit_date = ? AND i.status IN ('pending','done')", [t0]));

    const visitDates = upcomingVisits(t0, UPCOMING_VISITS, ctx);
    const last = visitDates[visitDates.length - 1] ?? t0;
    const outs = db.prepare("SELECT date, reason, mode, note, created_by FROM day_overrides WHERE date > ? AND date <= ? ORDER BY date").all(t0, last);
    const dates = [...new Set([...visitDates, ...outs.map((o) => o.date)])].sort();
    const comingUp = dates.map((date) => ({
      date,
      out: outs.find((o) => o.date === date) ?? null,
      items: ser(instanceQuery(db, "i.visit_date = ? AND i.status = 'pending'", [date])),
    }));

    const dueSoon = ser(instanceQuery(db,
      "i.status = 'pending' AND i.due_date > ? AND i.due_date <= ? AND i.visit_date > ?", [t0, addDays(t0, DUE_SOON_DAYS), t0]))
      .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));

    const waiting = db.prepare("SELECT id, title, kind, created_at FROM requests WHERE status = 'submitted' ORDER BY created_at DESC").all();
    const approved = db.prepare("SELECT COUNT(*) FROM requests WHERE status = 'approved'").pluck().get();

    res.json({
      today: t0,
      visit: { regular, open, out: outToday, closed: !!closed },
      today_items: todayItems,
      next_visit: nextVisitAfter(t0, ctx),
      cant_come_date: firstVisitOnOrAfter(t0, ctx), // the day "I can't come" applies to (today if she is still coming)
      coming_up: comingUp,
      due_soon: dueSoon,
      requests_waiting: waiting,
      requests_approved: approved,
    });
  }));

  r.get("/calendar", h((req, res) => {
    const t0 = today();
    const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.month ?? t0.slice(0, 7)));
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new HttpError(400, "month must look like 2026-10.");
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const first = `${m[1]}-${m[2]}-01`;
    const lastDay = daysInMonth(y, mo);
    const last = `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}`;
    sync(db, t0, last);
    const ctx = loadContext(db, t0);
    const items = instanceQuery(db, "i.visit_date BETWEEN ? AND ? AND i.status IN ('pending','done')", [first, last]);
    const outs = db.prepare("SELECT date, reason, mode, note FROM day_overrides WHERE date BETWEEN ? AND ?").all(first, last);
    const closed = new Set(db.prepare("SELECT date FROM visit_closures WHERE date BETWEEN ? AND ?").pluck().all(first, last));
    const weekdays = new Set(ctx.weekdays);
    const days = [];
    for (let i = 0; i < lastDay; i++) {
      const date = addDays(first, i);
      const own = items.filter((x) => x.visit_date === date).map((x) => serializeInstance(x, ctx));
      days.push({
        date,
        weekday: isoWeekday(date),
        visit: weekdays.has(isoWeekday(date)),
        out: outs.find((o) => o.date === date) ?? null,
        closed: closed.has(date),
        open_count: own.filter((x) => x.status === "pending").length,
        done_count: own.filter((x) => x.status === "done").length,
        items: own,
      });
    }
    res.json({ month: `${m[1]}-${m[2]}`, today: t0, days });
  }));

  r.get("/log", h((req, res) => {
    requireFamily(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const rows = db.prepare("SELECT id, at, actor, action, entity, entity_id, detail FROM activity_log WHERE action != 'task.rolled' ORDER BY id DESC LIMIT ?").all(limit);
    res.json(rows.map((x) => ({ ...x, detail: JSON.parse(x.detail) })));
  }));

  return r;
}
