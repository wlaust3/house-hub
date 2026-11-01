// The real app plus an optional test-mode sandbox.
//
// Test mode copies the database to a sandbox file and runs a second app on it with a pretend
// date. Only devices that send `X-Test-Mode: 1` talk to the sandbox, so everyone else keeps
// using the real data. Leaving test mode deletes the copy: nothing done while testing (task
// changes or history entries) ever reaches the real database.
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { openDb } from "./db/index.js";
import { isValidDate, localDate } from "./logic/dates.js";

/** A clock that reads `date` at the current time of day. */
export function pretendClock(date, realNow = () => new Date()) {
  const [y, m, d] = date.split("-").map(Number);
  return () => {
    const n = realNow();
    return new Date(y, m - 1, d, n.getHours(), n.getMinutes(), n.getSeconds(), n.getMilliseconds());
  };
}

export function createHub(db, { now = () => new Date(), dbFile = ":memory:" } = {}) {
  const realApp = createApp(db, { now });
  const sandboxFile = dbFile === ":memory:"
    ? path.join(os.tmpdir(), `house-hub-sandbox-${process.pid}.db`)
    : path.join(path.dirname(dbFile), "house-hub.sandbox.db");
  let sandbox = null; // { db, app, date }

  const status = () => ({ active: !!sandbox, date: sandbox?.date ?? null, real_today: localDate(now()) });

  function stop() {
    if (!sandbox) return;
    sandbox.db.close();
    sandbox = null;
    for (const f of [sandboxFile, `${sandboxFile}-wal`, `${sandboxFile}-shm`]) fs.rmSync(f, { force: true });
  }

  const hub = express();
  hub.use("/api/test-mode", express.json());

  hub.get("/api/test-mode", (_req, res) => res.json(status()));

  // Start test mode (copying the real data) or change the pretend date.
  hub.post("/api/test-mode", (req, res) => {
    const date = req.body?.date;
    if (!isValidDate(date)) return res.status(400).json({ error: "Pick a date." });
    if (!sandbox) {
      stop();
      fs.rmSync(sandboxFile, { force: true });
      db.prepare("VACUUM INTO ?").run(sandboxFile);
      const sdb = openDb(sandboxFile);
      const testFromId = sdb.prepare("SELECT COALESCE(MAX(id), 0) FROM activity_log").pluck().get();
      let clock = pretendClock(date, now);
      sandbox = { db: sdb, date, setDate: (d) => { clock = pretendClock(d, now); }, app: null };
      sandbox.app = createApp(sdb, { now: () => clock(), testFromId });
    } else {
      sandbox.setDate(date);
      sandbox.date = date;
    }
    res.json(status());
  });

  // Leave test mode and throw the copy away.
  hub.delete("/api/test-mode", (_req, res) => {
    stop();
    res.json(status());
  });

  hub.use((req, res, next) => {
    if (sandbox && req.get("x-test-mode") === "1" && req.path.startsWith("/api/")) return sandbox.app(req, res, next);
    return realApp(req, res, next);
  });

  hub.close = stop;
  return hub;
}
