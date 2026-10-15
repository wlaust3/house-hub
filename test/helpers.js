import { openDb } from "../server/db/index.js";
import { createApp } from "../server/app.js";

/** Boots the app on a random port with a controllable clock. `clock.set('2026-10-15T09:00')` is local time. */
export async function boot(start = "2026-10-15T09:00:00", dbFile = ":memory:") {
  let current = new Date(start);
  const db = openDb(dbFile);
  const server = createApp(db, { now: () => current }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, role = "family") => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(role ? { "x-role": role } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json };
  };
  return {
    db,
    base,
    clock: { set: (s) => { current = new Date(s); } },
    get: (p, role) => call("GET", p, undefined, role),
    post: (p, b, role) => call("POST", p, b ?? {}, role),
    patch: (p, b, role) => call("PATCH", p, b ?? {}, role),
    put: (p, b, role) => call("PUT", p, b ?? {}, role),
    del: (p, role) => call("DELETE", p, undefined, role),
    close: () => new Promise((r) => server.close(r)),
  };
}
