import { Router } from "express";
import { h, actor, requireFamily } from "./util.js";
import { HttpError, cleanText, parseId, log } from "../services/context.js";
import { transitionError, KINDS } from "../logic/requests.js";

export function groceryRouter({ db, now }) {
  const r = Router();
  const list = () => db.prepare(`SELECT id, name, quantity, added_by, added_at, bought_at FROM grocery_items
    WHERE cleared_at IS NULL ORDER BY bought_at IS NOT NULL, CASE WHEN bought_at IS NULL THEN added_at END, bought_at, id`).all();

  r.get("/", h((_req, res) => res.json(list())));

  r.post("/", h((req, res) => {
    const who = actor(req);
    const name = cleanText(req.body?.name, { required: true, field: "The item name", max: 100 });
    const quantity = cleanText(req.body?.quantity, { max: 40 });
    const id = db.prepare("INSERT INTO grocery_items (name, quantity, added_by) VALUES (?,?,?)").run(name, quantity, who).lastInsertRowid;
    log(db, who, "grocery.added", "grocery_item", id, { name });
    res.status(201).json(db.prepare("SELECT id, name, quantity, added_by, added_at, bought_at FROM grocery_items WHERE id = ?").get(id));
  }));

  r.post("/clear-bought", h((req, res) => {
    const who = actor(req);
    const n = db.prepare("UPDATE grocery_items SET cleared_at = ? WHERE bought_at IS NOT NULL AND cleared_at IS NULL").run(now().toISOString()).changes;
    if (n) log(db, who, "grocery.cleared", "grocery_item", null, { count: n });
    res.json({ cleared: n });
  }));

  r.patch("/:id", h((req, res) => {
    const who = actor(req);
    const id = parseId(req.params.id);
    const row = db.prepare("SELECT * FROM grocery_items WHERE id = ? AND cleared_at IS NULL").get(id);
    if (!row) throw new HttpError(404, "That item was not found.");
    if (typeof req.body?.bought !== "boolean") throw new HttpError(400, "Say whether it is bought (true or false).");
    if (req.body.bought && !row.bought_at) {
      db.prepare("UPDATE grocery_items SET bought_at = ? WHERE id = ?").run(now().toISOString(), id);
      log(db, who, "grocery.bought", "grocery_item", id, { name: row.name });
    } else if (!req.body.bought && row.bought_at) {
      db.prepare("UPDATE grocery_items SET bought_at = NULL WHERE id = ?").run(id);
      log(db, who, "grocery.unbought", "grocery_item", id, { name: row.name });
    }
    res.json(db.prepare("SELECT id, name, quantity, added_by, added_at, bought_at FROM grocery_items WHERE id = ?").get(id));
  }));

  return r;
}

export function requestsRouter({ db, now }) {
  const r = Router();
  const SELECT = "SELECT id, title, details, kind, status, created_at, approved_at, done_at, COALESCE(done_at, approved_at, created_at) AS updated_at FROM requests";

  r.get("/", h((_req, res) => {
    // Submitted first (newest first), then approved, then finished.
    res.json(db.prepare(`${SELECT} ORDER BY CASE status WHEN 'submitted' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, updated_at DESC, id DESC`).all());
  }));

  r.post("/", h((req, res) => {
    const who = actor(req);
    const title = cleanText(req.body?.title, { required: true, field: "The request", max: 120 });
    const details = cleanText(req.body?.details, { max: 500 });
    const kind = req.body?.kind ?? "other";
    if (!KINDS.includes(kind)) throw new HttpError(400, "Kind must be buy, approve or other.");
    const id = db.prepare("INSERT INTO requests (title, details, kind, created_at) VALUES (?,?,?,?)").run(title, details, kind, now().toISOString()).lastInsertRowid;
    log(db, who, "request.created", "request", id, { title, kind });
    res.status(201).json(db.prepare(`${SELECT} WHERE id = ?`).get(id));
  }));

  // Moving a request forward is a family decision.
  r.patch("/:id", h((req, res) => {
    const who = requireFamily(req);
    const id = parseId(req.params.id);
    const row = db.prepare("SELECT * FROM requests WHERE id = ?").get(id);
    if (!row) throw new HttpError(404, "That request was not found.");
    const to = req.body?.status;
    const err = transitionError(row.status, to);
    if (err) throw new HttpError(409, err);
    const stamp = now().toISOString();
    db.transaction(() => {
      if (to === "approved") db.prepare("UPDATE requests SET status='approved', approved_at=? WHERE id=?").run(stamp, id);
      else db.prepare("UPDATE requests SET status='done', done_at=? WHERE id=?").run(stamp, id);
      log(db, who, `request.${to}`, "request", id, { title: row.title });
    })();
    res.json(db.prepare(`${SELECT} WHERE id = ?`).get(id));
  }));

  return r;
}
