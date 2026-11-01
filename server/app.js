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
import { HttpError } from "./services/context.js";
import { sync } from "./services/sync.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "..", "dist");

/**
 * @param db        an open better-sqlite3 database (migrated)
 * @param opts.now  () => Date, injectable clock (tests). "today" is the local calendar date of `now()`.
 */
export function createApp(db, opts = {}) {
  const now = opts.now ?? (() => new Date());
  const today = () => localDate(now());
  const deps = { db, now, today };

  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use(roleMiddleware);

  app.get("/api/health", (_req, res) => {
    const row = db.prepare("SELECT COUNT(*) AS n FROM schedule WHERE active = 1").get();
    res.json({ ok: true, version: 1, visitDays: row.n });
  });

  // Roll tasks forward and create upcoming recurring occurrences before anything is read.
  app.use("/api", (req, _res, next) => {
    try {
      sync(db, today());
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
