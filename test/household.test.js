import test from "node:test";
import assert from "node:assert/strict";
import { boot } from "./helpers.js";
import { openDb } from "../server/db/index.js";
import { createHub } from "../server/hub.js";

// Thu 2026-10-15 unless said otherwise. Visits are Mon/Thu/Sat.
const H = "housekeeper";
const home = async (app, role = H) => (await app.get("/api/home", role)).body;
const memberId = async (app, name) => (await app.get("/api/members")).body.find((m) => m.name === name).id;

test("members: seeded household, roles, and owners must be adults or the housekeeper", async () => {
  const app = await boot();
  try {
    const list = (await app.get("/api/members")).body;
    assert.deepEqual(list.map((m) => [m.name, m.role]), [["Gladis", "housekeeper"], ["Bill", "adult"], ["Falon", "adult"], ["Sian", "child"], ["William", "baby"]]);
    assert.equal((await home(app)).housekeeper_name, "Gladis");
    const sian = list.find((m) => m.name === "Sian").id;
    assert.equal((await app.post("/api/tasks", { title: "x", owner_id: sian })).status, 400);
    assert.equal((await app.post("/api/members", { name: "Nana", role: "adult" }, H)).status, 403);
    const add = await app.post("/api/members", { name: "Nana", role: "adult" });
    assert.equal(add.status, 201);
    const gid = list.find((m) => m.name === "Gladis").id;
    await app.patch(`/api/members/${gid}`, { name: "Gladys" });
    assert.equal((await home(app)).housekeeper_name, "Gladys");
  } finally { await app.close(); }
});

test("tasks for an adult follow their own dates and stay off the housekeeper's list", async () => {
  const app = await boot();
  try {
    const falon = await memberId(app, "Falon");
    await app.post("/api/tasks", { title: "Book the dentist", owner_id: falon, date: "2026-10-16" }); // Friday: not a visit day
    await app.post("/api/tasks", { title: "Mop", date: "2026-10-16" });
    let h = await home(app);
    assert.deepEqual(h.today_items.map((i) => i.title), []);
    const fam = h.family_tasks.find((i) => i.title === "Book the dentist");
    assert.equal(fam.visit_date, "2026-10-16");
    assert.equal(fam.owner_name, "Falon");
    assert.equal(h.coming_up.find((d) => d.date === "2026-10-17").items[0].title, "Mop");
    // missed on Friday: it is carried to Saturday (the next day), not to her next visit
    app.clock.set("2026-10-17T09:00:00");
    h = await home(app);
    const carried = h.family_tasks.find((i) => i.title === "Book the dentist");
    assert.equal(carried.visit_date, "2026-10-17");
    assert.equal(carried.carried_from, "2026-10-16");
  } finally { await app.close(); }
});

test("priority sorts the list; 'drop' and 'expire' remove unfinished tasks", async () => {
  const app = await boot("2026-10-12T09:00:00"); // Monday
  try {
    await app.post("/api/tasks", { title: "Low one", priority: 3 });
    await app.post("/api/tasks", { title: "High one", priority: 1 });
    await app.post("/api/tasks", { title: "Normal one" });
    await app.post("/api/tasks", { title: "Only today", if_not_done: "drop" });
    await app.post("/api/tasks", { title: "Give it two days", if_not_done: "expire", expire_days: 2 });
    let h = await home(app);
    assert.deepEqual(h.today_items.map((i) => i.title), ["High one", "Normal one", "Only today", "Give it two days", "Low one"]);
    assert.equal(h.today_items[0].priority, 1);

    app.clock.set("2026-10-15T09:00:00"); // Thursday: Monday passed
    h = await home(app);
    const titles = h.today_items.map((i) => i.title);
    assert.ok(!titles.includes("Only today"));
    assert.ok(!titles.includes("Give it two days")); // 3 days after its day
    assert.ok(titles.includes("Normal one"));
    const log = (await app.get("/api/log")).body;
    assert.equal(log.filter((l) => l.action === "task.expired").length, 2);
  } finally { await app.close(); }
});

test("a week task moves between visits in its week without being 'carried over'", async () => {
  const app = await boot("2026-10-12T09:00:00"); // Monday
  try {
    await app.post("/api/tasks", { title: "Clean the fridge", period: "week" });
    app.clock.set("2026-10-15T09:00:00");
    let h = await home(app);
    const item = h.today_items.find((i) => i.title === "Clean the fridge");
    assert.equal(item.carried_from, null);
    assert.equal(item.period, "week");
    assert.equal(item.period_end, "2026-10-18");
    app.clock.set("2026-10-19T09:00:00"); // next Monday: now it is carried over
    h = await home(app);
    assert.equal(h.today_items.find((i) => i.title === "Clean the fridge").carried_from, "2026-10-12");
  } finally { await app.close(); }
});

test("extra visit day, day notes, and an out day with just a note", async () => {
  const app = await boot();
  try {
    await app.post("/api/tasks", { title: "Iron shirts", date: "2026-10-16" });
    assert.equal((await app.post("/api/extra-days", { date: "2026-10-17" }, H)).status, 400); // already a visit day
    assert.equal((await app.post("/api/extra-days", { date: "2026-10-16" }, H)).status, 201);
    let h = await home(app);
    const fri = h.coming_up.find((d) => d.date === "2026-10-16");
    assert.equal(fri.extra, true);
    assert.deepEqual(fri.items.map((i) => i.title), ["Iron shirts"]);

    await app.put("/api/day-notes/2026-10-17", { note: "Coming at 11" }, H);
    const out = await app.post("/api/days-out", { date: "2026-10-15", note: "Doctor this morning" }, H);
    assert.equal(out.status, 201);
    h = await home(app, "family");
    assert.equal(h.coming_up.find((d) => d.date === "2026-10-17").note.note, "Coming at 11");
    assert.equal(h.visit.out.note, "Doctor this morning");
    assert.equal(h.visit.out.reason, "other");

    // removing the extra day sends its tasks to Saturday
    await app.del("/api/extra-days/2026-10-16", H);
    h = await home(app);
    assert.ok(h.coming_up.find((d) => d.date === "2026-10-17").items.some((i) => i.title === "Iron shirts"));
  } finally { await app.close(); }
});

test("lost items: banner until found", async () => {
  const app = await boot();
  try {
    const add = await app.post("/api/lost", { title: "Sian's blue water bottle", details: "Probably in the playroom" });
    assert.equal(add.status, 201);
    assert.deepEqual((await home(app)).lost.map((l) => l.title), ["Sian's blue water bottle"]);
    await app.patch(`/api/lost/${add.body.id}`, { found: true, note: "Under the sofa" }, H);
    assert.deepEqual((await home(app)).lost, []);
    const all = (await app.get("/api/lost")).body;
    assert.equal(all.found[0].found_note, "Under the sofa");
    assert.equal(all.found[0].found_by, "housekeeper");
  } finally { await app.close(); }
});

test("groceries: 'Out' first, suggestions, and repeating items come back", async () => {
  const app = await boot();
  try {
    await app.post("/api/grocery", { name: "Bananas" });
    await app.post("/api/grocery", { name: "Diapers", urgent: true });
    const milk = await app.post("/api/grocery", { name: "Milk", quantity: "2 gallons", every_days: 7 });
    let list = (await app.get("/api/grocery")).body;
    assert.deepEqual(list.map((g) => g.name), ["Diapers", "Bananas", "Milk"]);
    assert.equal((await home(app)).grocery.urgent, 1);
    assert.equal((await app.get("/api/grocery/staples")).body[0].next_on, "2026-10-22");

    await app.patch(`/api/grocery/${milk.body.id}`, { bought: true });
    await app.post("/api/grocery/clear-bought");
    app.clock.set("2026-10-22T09:00:00");
    list = (await app.get("/api/grocery")).body;
    assert.ok(list.some((g) => g.name === "Milk" && g.quantity === "2 gallons" && !g.bought_at));
    // not added twice while it is still on the list
    app.clock.set("2026-10-29T09:00:00");
    assert.equal((await app.get("/api/grocery")).body.filter((g) => g.name === "Milk").length, 1);

    const sugg = (await app.get("/api/grocery/suggestions")).body;
    assert.equal(sugg[0].name, "Milk");
    assert.equal(sugg[0].quantity, "2 gallons");
  } finally { await app.close(); }
});

test("test mode works on a copy: the real data and history are untouched", async () => {
  const db = openDb(":memory:");
  const hub = createHub(db, { now: () => new Date("2026-10-15T09:00:00") });
  const server = hub.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, test = false) => {
    const res = await fetch(base + p, { method, headers: { "content-type": "application/json", "x-role": "family", ...(test ? { "x-test-mode": "1" } : {}) }, body: body && JSON.stringify(body) });
    return res.json();
  };
  try {
    await call("POST", "/api/tasks", { title: "Real task" });
    const on = await call("POST", "/api/test-mode", { date: "2026-10-22" });
    assert.deepEqual([on.active, on.date], [true, "2026-10-22"]);
    // the sandbox pretends it is the 22nd and starts with a copy of the real data
    const th = await call("GET", "/api/home", undefined, true);
    assert.equal(th.today, "2026-10-22");
    assert.ok(th.today_items.some((i) => i.title === "Real task"));
    await call("POST", "/api/tasks", { title: "Test task" }, true);
    const tlog = await call("GET", "/api/log", undefined, true);
    assert.equal(tlog.find((l) => l.detail.title === "Test task").test, true);
    assert.equal(tlog.find((l) => l.detail.title === "Real task").test, false);
    // devices not in test mode still see the real data
    const real = await call("GET", "/api/home");
    assert.equal(real.today, "2026-10-15");
    assert.ok(!(await call("GET", "/api/log")).some((l) => l.detail.title === "Test task"));
    // leaving throws the copy away
    assert.equal((await call("DELETE", "/api/test-mode")).active, false);
    assert.equal((await call("GET", "/api/home", undefined, true)).today, "2026-10-15");
  } finally {
    hub.close();
    await new Promise((r) => server.close(r));
  }
});

test("requests: priority sorts open requests and anyone can change it", async () => {
  const app = await boot();
  try {
    await app.post("/api/requests", { title: "Normal ask" }, H);
    const low = await app.post("/api/requests", { title: "Low ask", priority: 3 }, H);
    await app.post("/api/requests", { title: "Urgent ask", priority: 1 }, H);
    assert.equal((await app.post("/api/requests", { title: "x", priority: 9 }, H)).status, 400);
    let list = (await app.get("/api/requests")).body;
    assert.deepEqual(list.map((r) => r.title), ["Urgent ask", "Normal ask", "Low ask"]);
    assert.equal((await app.patch(`/api/requests/${low.body.id}`, { priority: 1 }, H)).status, 200);
    list = (await app.get("/api/requests")).body;
    assert.equal(list[1].title, "Low ask");
    assert.deepEqual((await home(app, "family")).requests_open.map((r) => r.priority), [1, 1, 2]);
    // moving a request forward is still family-only
    assert.equal((await app.patch(`/api/requests/${low.body.id}`, { status: "approved" }, H)).status, 403);
  } finally { await app.close(); }
});
