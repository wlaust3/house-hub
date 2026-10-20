// Members, lost items, extra visit days and day notes.
import { Router } from "express";
import { h, actor, requireFamily } from "./util.js";
import { HttpError, cleanText, parseId, log } from "../services/context.js";
import { sync } from "../services/sync.js";
import { isValidDate, isoWeekday } from "../logic/dates.js";

export const MEMBER_ROLES = ["housekeeper", "adult", "child", "baby"];

export function householdRouter({ db, today, now }) {
  const r = Router();

  // ---------- members ----------
  const members = () => db.prepare("SELECT id, name, role, email FROM members WHERE removed_at IS NULL ORDER BY sort, id").all();
  // Emails are only shown to the family.
  const listFor = (req) => (req.role === "family" ? members() : members().map(({ email: _e, ...m }) => m));

  // The Google account someone signs in with from outside. Only housekeepers and adults sign in.
  const emailFrom = (body, role, id) => {
    const email = cleanText(body?.email, { field: "The email", max: 200 }).toLowerCase();
    if (!email) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "That email does not look right.");
    if (!["housekeeper", "adult"].includes(role)) throw new HttpError(400, "Only the housekeeper and adults can sign in.");
    if (db.prepare("SELECT 1 FROM members WHERE lower(email) = ? AND removed_at IS NULL AND id IS NOT ?").get(email, id ?? null)) {
      throw new HttpError(409, "Someone else already uses that email.");
    }
    return email;
  };

  r.get("/members", h((req, res) => res.json(listFor(req))));

  r.post("/members", h((req, res) => {
    const who = requireFamily(req);
    const name = cleanText(req.body?.name, { required: true, field: "The name", max: 60 });
    const role = req.body?.role;
    if (!MEMBER_ROLES.includes(role)) throw new HttpError(400, "Role must be housekeeper, adult, child or baby.");
    const email = emailFrom(req.body, role);
    const sort = db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 FROM members").pluck().get();
    const id = db.prepare("INSERT INTO members (name, role, email, sort) VALUES (?,?,?,?)").run(name, role, email, sort).lastInsertRowid;
    log(db, who, "member.added", "member", id, { name });
    res.status(201).json(members());
  }));

  r.patch("/members/:id", h((req, res) => {
    const who = requireFamily(req);
    const id = parseId(req.params.id);
    const m = db.prepare("SELECT * FROM members WHERE id = ? AND removed_at IS NULL").get(id);
    if (!m) throw new HttpError(404, "That person was not found.");
    const name = req.body?.name !== undefined ? cleanText(req.body.name, { required: true, field: "The name", max: 60 }) : m.name;
    const role = req.body?.role ?? m.role;
    if (!MEMBER_ROLES.includes(role)) throw new HttpError(400, "Role must be housekeeper, adult, child or baby.");
    if (role !== m.role && ["child", "baby"].includes(role) && db.prepare("SELECT 1 FROM tasks WHERE owner_id = ? AND deleted_at IS NULL").get(id)) {
      throw new HttpError(409, "This person still has tasks. Give them to someone else first.");
    }
    const email = req.body?.email !== undefined ? emailFrom(req.body, role, id) : m.email && emailFrom(m, role, id);
    db.prepare("UPDATE members SET name = ?, role = ?, email = ? WHERE id = ?").run(name, role, email, id);
    log(db, who, "member.edited", "member", id, { name });
    sync(db, today());
    res.json(members());
  }));

  r.delete("/members/:id", h((req, res) => {
    const who = requireFamily(req);
    const id = parseId(req.params.id);
    const m = db.prepare("SELECT * FROM members WHERE id = ? AND removed_at IS NULL").get(id);
    if (!m) throw new HttpError(404, "That person was not found.");
    if (db.prepare("SELECT 1 FROM tasks WHERE owner_id = ? AND deleted_at IS NULL").get(id)) {
      throw new HttpError(409, "This person still has tasks. Give them to someone else first.");
    }
    db.prepare("UPDATE members SET removed_at = ?, email = NULL WHERE id = ?").run(now().toISOString(), id);
    log(db, who, "member.removed", "member", id, { name: m.name });
    res.json(members());
  }));

  // ---------- lost items ----------
  const LOST = "SELECT id, title, details, created_by, created_at, found_at, found_by, found_note FROM lost_items";

  r.get("/lost", h((_req, res) => {
    // Still missing first, then the last few found ones.
    res.json({
      missing: db.prepare(`${LOST} WHERE found_at IS NULL ORDER BY created_at DESC`).all(),
      found: db.prepare(`${LOST} WHERE found_at IS NOT NULL ORDER BY found_at DESC LIMIT 10`).all(),
    });
  }));

  r.post("/lost", h((req, res) => {
    const who = actor(req);
    const title = cleanText(req.body?.title, { required: true, field: "What is missing", max: 120 });
    const details = cleanText(req.body?.details, { max: 300 });
    const id = db.prepare("INSERT INTO lost_items (title, details, created_by, created_at) VALUES (?,?,?,?)").run(title, details, who, now().toISOString()).lastInsertRowid;
    log(db, who, "lost.added", "lost_item", id, { title });
    res.status(201).json(db.prepare(`${LOST} WHERE id = ?`).get(id));
  }));

  // { found: true, note } marks it found; { found: false } puts it back on the banner.
  r.patch("/lost/:id", h((req, res) => {
    const who = actor(req);
    const id = parseId(req.params.id);
    const row = db.prepare(`${LOST} WHERE id = ?`).get(id);
    if (!row) throw new HttpError(404, "That item was not found.");
    if (req.body?.found === true) {
      const note = cleanText(req.body?.note, { max: 200, field: "The note" });
      db.prepare("UPDATE lost_items SET found_at = ?, found_by = ?, found_note = ? WHERE id = ?").run(now().toISOString(), who, note, id);
      log(db, who, "lost.found", "lost_item", id, { title: row.title });
    } else if (req.body?.found === false) {
      db.prepare("UPDATE lost_items SET found_at = NULL, found_by = NULL, found_note = '' WHERE id = ?").run(id);
      log(db, who, "lost.reopened", "lost_item", id, { title: row.title });
    }
    res.json(db.prepare(`${LOST} WHERE id = ?`).get(id));
  }));

  r.delete("/lost/:id", h((req, res) => {
    const who = actor(req);
    const id = parseId(req.params.id);
    const row = db.prepare(`${LOST} WHERE id = ?`).get(id);
    if (!row) throw new HttpError(404, "That item was not found.");
    db.prepare("DELETE FROM lost_items WHERE id = ?").run(id);
    log(db, who, "lost.removed", "lost_item", id, { title: row.title });
    res.json({ ok: true });
  }));

  // ---------- extra visit days ----------
  r.post("/extra-days", h((req, res) => {
    const who = actor(req);
    const t0 = today();
    const date = req.body?.date;
    if (!isValidDate(date) || date < t0) throw new HttpError(400, "Pick today or a day in the future.");
    if (db.prepare("SELECT 1 FROM schedule WHERE weekday = ? AND active = 1").get(isoWeekday(date))) {
      throw new HttpError(400, "She already comes that day.");
    }
    db.prepare("INSERT INTO extra_visits (date, created_by) VALUES (?, ?) ON CONFLICT(date) DO NOTHING").run(date, who);
    log(db, who, "day.extra", "day", null, { date });
    sync(db, t0);
    res.status(201).json({ date });
  }));

  r.delete("/extra-days/:date", h((req, res) => {
    const who = actor(req);
    const t0 = today();
    if (db.prepare("SELECT 1 FROM visit_closures WHERE date = ?").get(req.params.date)) throw new HttpError(409, "That visit is already finished.");
    const n = db.prepare("DELETE FROM extra_visits WHERE date = ?").run(req.params.date).changes;
    if (!n) throw new HttpError(404, "That is not an extra day.");
    log(db, who, "day.extra_removed", "day", null, { date: req.params.date });
    sync(db, t0);
    res.json({ ok: true });
  }));

  // ---------- day notes ----------
  // PUT with an empty note removes it.
  r.put("/day-notes/:date", h((req, res) => {
    const who = actor(req);
    const date = req.params.date;
    if (!isValidDate(date)) throw new HttpError(400, "That date is not valid.");
    const note = cleanText(req.body?.note, { max: 300, field: "The note" });
    if (!note) {
      db.prepare("DELETE FROM day_notes WHERE date = ?").run(date);
    } else {
      db.prepare(`INSERT INTO day_notes (date, note, updated_by, updated_at) VALUES (?,?,?,?)
        ON CONFLICT(date) DO UPDATE SET note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(date, note, who, now().toISOString());
    }
    log(db, who, note ? "day.noted" : "day.note_removed", "day", null, { date });
    res.json({ date, note });
  }));

  return r;
}
