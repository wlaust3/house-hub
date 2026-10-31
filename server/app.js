import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { localDate } from "./logic/dates.js";
import { roleMiddleware } from "./routes/util.js";
import { tasksRouter, instancesRouter } from "./routes/tasks.js";
import { visitsRouter } from "./routes/visits.js";
import { scheduleRouter } from "./routes/schedule.js";
import { groceryRouter, requestsRouter } from "./routes/lists.js";
import { viewsRouter } from "./routes/views.js";
import { householdRouter } from "./routes/household.js";
import { googleRouter } from "./routes/google.js";
import { HttpError } from "./services/context.js";
import { sync } from "./services/sync.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "..", "dist");

/**
 * @param db        an open better-sqlite3 database (migrated)
 * @param opts.now  () => Date, injectable clock (tests). "today" is the local calendar date of `now()`.
 * @param opts.google the Google Calendar service (server/google/index.js); null in test mode
 */
export function createApp(db, opts = {}) {
  const now = opts.now ?? (() => new Date());
  const today = () => localDate(now());
  const deps = { db, now, today, testFromId: opts.testFromId ?? null, google: opts.google };

  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use(roleMiddleware);

  app.get("/api/health", (_req, res) => {
    const row = db.prepare("SELECT COUNT(*) AS n FROM schedule WHERE active = 1").get();
    res.json({ ok: true, version: 1, visitDays: row.n });
  });

  // Who is using this device: a signed-in member (outside access) or the shared family dashboard.
  app.get("/api/me", (req, res) => res.json(req.member ? { device: "personal", member: req.member } : { device: "dashboard", member: null }));

  // Changes in the hub reach Google Calendar within seconds, not just on the minute.
  if (opts.google) {
    app.use("/api", (req, res, next) => {
      if (req.method !== "GET") res.on("finish", () => { if (res.statusCode < 400) opts.google.changed(); });
      next();
    });
  }

  // Roll tasks forward and create upcoming recurring occurrences before anything is read.
  app.use("/api", (req, _res, next) => {
    try {
      sync(db, today(), undefined, now().toISOString());
      next();
    } catch (e) {
      next(e);
    }
  });

  app.use("/api/tasks", tasksRouter(deps));
  app.use("/api/instances", instancesRouter(deps));
  app.use("/api/visits", visitsRouter(deps));
  app.use("/api/grocery", groceryRouter(deps));
  app.use("/api/requests", requestsRouter(deps));
  app.use("/api", scheduleRouter(deps));
  app.use("/api", viewsRouter(deps));
  app.use("/api", householdRouter(deps));
  app.use("/api", googleRouter(deps));

  // Future (not in v1): POST /api/tasks for device ingestion, protected by an API key.
  // See docs/DATA-MODEL.md "Future: device ingestion".

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(distDir, "index.html")));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "That request was not valid JSON." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the house computer." });
  });
  return app;
}
