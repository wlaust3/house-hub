import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "..", "dist");

export function createApp(db) {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    const row = db.prepare("SELECT COUNT(*) AS n FROM schedule WHERE active = 1").get();
    res.json({ ok: true, version: 1, visitDays: row.n });
  });

  // Future (not in v1): POST /api/tasks for device ingestion, protected by an API key.
  // See docs/DATA-MODEL.md "Future: device ingestion".

  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(distDir, "index.html")));
  }
  return app;
}
