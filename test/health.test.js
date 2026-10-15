import test from "node:test";
import assert from "node:assert/strict";
import { openDb, migrate } from "../server/db/index.js";
import { createApp } from "../server/app.js";

test("migration creates all tables and seeds Mon/Thu/Sat", () => {
  const db = openDb(":memory:");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of [
    "recurrence_rules", "tasks", "task_instances", "grocery_items",
    "requests", "schedule", "day_overrides", "activity_log",
  ]) assert.ok(tables.includes(t), `missing table ${t}`);
  const days = db.prepare("SELECT weekday FROM schedule WHERE active=1 ORDER BY weekday").all().map((r) => r.weekday);
  assert.deepEqual(days, [1, 4, 6]);
});

test("migrations are idempotent", () => {
  const db = openDb(":memory:");
  migrate(db);


  assert.equal(db.prepare("SELECT COUNT(*) n FROM schedule").get().n, 7);
});

test("GET /api/health", async () => {
  const db = openDb(":memory:");
  const server = createApp(db).listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.visitDays, 3);
  } finally {
    server.close();
  }
});
