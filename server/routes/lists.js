import { Router } from "express";
import { h, actor, requireFamily } from "./util.js";
import { HttpError, cleanText, parseId, log } from "../services/context.js";
import { addDays } from "../logic/dates.js";
import { transitionError, KINDS } from "../logic/requests.js";

export function groceryRouter({ db, now, today }) {
  const r = Router();
  const COLS = "SELECT id, name, quantity, added_by, added_at, bought_at, urgent FROM grocery_items";
  // Still to buy ("Out" first), then bought.
  const list = () => db.prepare(`${COLS}
    WHERE cleared_at IS NULL ORDER BY bought_at IS NOT NULL, urgent DESC, CASE WHEN bought_at IS NULL THEN added_at END, bought_at, id`).all()
    .map((g) => ({ ...g, urgent: !!g.urgent }));
  const one = (id) => { const g = db.prepare(`${COLS} WHERE id = ?`).get(id); return { ...g, urgent: !!g.urgent }; };
  const staples = () => db.prepare("SELECT id, name, quantity, every_days, next_on FROM grocery_staples WHERE removed_at IS NULL ORDER BY name COLLATE NOCASE").all();

  r.get("/", h((_req, res) => res.json(list())));

  // Things bought before, most often first, with the last quantity used: for typing suggestions
  // and one-tap re-adding.
  r.get("/suggestions", h((_req, res) => {
    res.json(db.prepare(`
      SELECT g.name, COUNT(*) AS times,
             (SELECT quantity FROM grocery_items q WHERE q.name = g.name COLLATE NOCASE ORDER BY q.id DESC LIMIT 1) AS quantity
      FROM grocery_items g GROUP BY g.name COLLATE NOCASE ORDER BY times DESC, MAX(g.id) DESC LIMIT 40`).all());
  }));

  r.post("/", h((req, res) => {
    const who = actor(req);
    const name = cleanText(req.body?.name, { required: true, field: "The item name", max: 100 });
    const quantity = cleanText(req.body?.quantity, { max: 40 });
    const urgent = req.body?.urgent ? 1 : 0;
    const every = req.body?.every_days == null ? null : Number(req.body.every_days);
    if (every !== null && !(Number.isInteger(every) && every >= 1 && every <= 365)) throw new HttpError(400, "Repeat every 1 to 365 days.");
    const id = db.transaction(() => {
      const newId = db.prepare("INSERT INTO grocery_items (name, quantity, added_by, urgent) VALUES (?,?,?,?)").run(name, quantity, who, urgent).lastInsertRowid;
      log(db, who, "grocery.added", "grocery_item", newId, { name });
      if (every) {
        db.prepare("INSERT INTO grocery_staples (name, quantity, every_days, next_on, created_by) VALUES (?,?,?,?,?)").run(name, quantity, every, addDays(today(), every), who);
        log(db, who, "grocery.repeating", "grocery_item", newId, { name, count: every });
      }
      return newId;
    })();
    res.status(201).json(one(id));
  }));

  r.get("/staples", h((_req, res) => res.json(staples())));

  r.delete("/staples/:id", h((req, res) => {
    const who = actor(req);
    const id = parseId(req.params.id);
    const st = db.prepare("SELECT * FROM grocery_staples WHERE id = ? AND removed_at IS NULL").get(id);
    if (!st) throw new HttpError(404, "That item was not found.");
    db.prepare("UPDATE grocery_staples SET removed_at = ? WHERE id = ?").run(now().toISOString(), id);
    log(db, who, "grocery.repeat_stopped", "grocery_item", null, { name: st.name });
    res.json(staples());
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
    if (typeof req.body?.urgent === "boolean") {
      db.prepare("UPDATE grocery_items SET urgent = ? WHERE id = ?").run(req.body.urgent ? 1 : 0, id);
      return res.json(one(id));
    }
    if (typeof req.body?.bought !== "boolean") throw new HttpError(400, "Say whether it is bought (true or false).");
    if (req.body.bought && !row.bought_at) {
      db.prepare("UPDATE grocery_items SET bought_at = ? WHERE id = ?").run(now().toISOString(), id);
      log(db, who, "grocery.bought", "grocery_item", id, { name: row.name });
    } else if (!req.body.bought && row.bought_at) {
      db.prepare("UPDATE grocery_items SET bought_at = NULL WHERE id = ?").run(id);
      log(db, who, "grocery.unbought", "grocery_item", id, { name: row.name });
    }
    res.json(one(id));
  }));

  return r;
}

export function requestsRouter({ db, now }) {
  const r = Router();
  const SELECT = "SELECT id, title, details, kind, status, priority, created_at, approved_at, done_at, COALESCE(done_at, approved_at, created_at) AS updated_at FROM requests";

  r.get("/", h((_req, res) => {
    // Open ones first (most important, then waiting before approved, newest first), then finished.
    res.json(db.prepare(`${SELECT} ORDER BY status = 'done', CASE WHEN status != 'done' THEN priority END,
      CASE status WHEN 'submitted' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, updated_at DESC, id DESC`).all());
  }));

  r.post("/", h((req, res) => {
    const who = actor(req);
    const title = cleanText(req.body?.title, { required: true, field: "The request", max: 120 });
    const details = cleanText(req.body?.details, { max: 500 });
    const kind = req.body?.kind ?? "other";
    if (!KINDS.includes(kind)) throw new HttpError(400, "Kind must be buy, approve or other.");
    const priority = Number(req.body?.priority ?? 2);
    if (![1, 2, 3].includes(priority)) throw new HttpError(400, "Priority must be high, normal or low.");
    const id = db.prepare("INSERT INTO requests (title, details, kind, priority, created_at) VALUES (?,?,?,?,?)").run(title, details, kind, priority, now().toISOString()).lastInsertRowid;
    log(db, who, "request.created", "request", id, { title, kind });
    res.status(201).json(db.prepare(`${SELECT} WHERE id = ?`).get(id));
  }));

  // Anyone can change the priority; moving a request forward is a family decision.
  r.patch("/:id", h((req, res) => {
    const id = parseId(req.params.id);
    const row = db.prepare("SELECT * FROM requests WHERE id = ?").get(id);
    if (!row) throw new HttpError(404, "That request was not found.");
    if (req.body?.priority !== undefined && req.body?.status === undefined) {
      const who = actor(req);
      const priority = Number(req.body.priority);
      if (![1, 2, 3].includes(priority)) throw new HttpError(400, "Priority must be high, normal or low.");
      db.prepare("UPDATE requests SET priority = ? WHERE id = ?").run(priority, id);
      log(db, who, "request.priority", "request", id, { title: row.title });
      return res.json(db.prepare(`${SELECT} WHERE id = ?`).get(id));
    }
    const who = requireFamily(req);
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
