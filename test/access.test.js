import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { boot } from "./helpers.js";
import { openDb } from "../server/db/index.js";
import { createHub } from "../server/hub.js";
import { cloudflareKeys, requireMember, verifyAccessToken } from "../server/access.js";

const team = "ourhouse.cloudflareaccess.com";
const aud = "aud-tag-123";
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const keys = { k1: publicKey };

function token(claims, { kid = "k1", key = privateKey } = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${enc({ alg: "RS256", kid, typ: "JWT" })}.${enc({ iss: `https://${team}`, aud: [aud], exp: now + 600, iat: now, ...claims })}`;
  return `${body}.${crypto.sign("RSA-SHA256", Buffer.from(body), key).toString("base64url")}`;
}

test("access tokens: only a valid, current token for this app names an email", () => {
  const check = (t) => verifyAccessToken(t, { keys, team, aud });
  assert.equal(check(token({ email: "bill@example.com" })), "bill@example.com");
  assert.equal(check(token({ email: "bill@example.com", aud: ["other-app"] })), null);
  assert.equal(check(token({ email: "bill@example.com", iss: "https://evil.cloudflareaccess.com" })), null);
  assert.equal(check(token({ email: "bill@example.com", exp: Math.floor(Date.now() / 1000) - 5 })), null);
  assert.equal(check(token({ email: "bill@example.com" }, { kid: "nope" })), null);
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  assert.equal(check(token({ email: "bill@example.com" }, { key: other })), null);
  assert.equal(check("not.a.token"), null);
  assert.equal(check(undefined), null);
});

test("Cloudflare's published keys are loaded and used to check tokens", async () => {
  const urls = [];
  const fakeFetch = async (url) => { urls.push(url); return { ok: true, json: async () => ({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1" }] }) }; };
  const getKeys = cloudflareKeys(team, fakeFetch);
  const loaded = await getKeys("k1");
  assert.deepEqual(urls, [`https://${team}/cdn-cgi/access/certs`]);
  assert.equal(verifyAccessToken(token({ email: "falon@example.com" }), { keys: loaded, team, aud }), "falon@example.com");
  await getKeys("unknown"); // asked again within a minute: no second fetch
  assert.equal(urls.length, 1);
});

test("outside access: only signed-in members get in, and the app knows who they are", async () => {
  const db = openDb(":memory:");
  const pub = express();
  pub.use(requireMember(db, { team, aud, getKeys: async () => keys }));
  pub.use(createHub(db));
  const server = pub.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, jwt) => fetch(base + path, { headers: jwt ? { "cf-access-jwt-assertion": jwt } : {} });
  try {
    assert.equal((await get("/api/me")).status, 401);
    assert.equal((await get("/")).status, 401);
    assert.equal((await get("/api/me", token({ email: "bill@example.com", exp: 1 }))).status, 401);
    const stranger = await get("/api/me", token({ email: "bill@example.com" }));
    assert.equal(stranger.status, 403);
    assert.match((await stranger.json()).error, /not in the household/);

    db.prepare("UPDATE members SET email = 'bill@example.com' WHERE name = 'Bill'").run();
    const me = await (await get("/api/me", token({ email: "Bill@Example.com" }))).json();
    assert.equal(me.device, "personal");
    assert.equal(me.member.name, "Bill");
    assert.equal(me.member.role, "adult");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("the home Wi-Fi port is the dashboard; members' sign-in emails are family-only", async () => {
  const app = await boot();
  try {
    assert.deepEqual((await app.get("/api/me")).body, { device: "dashboard", member: null });
    const gid = (await app.get("/api/members")).body.find((m) => m.name === "Gladis").id;
    const sian = (await app.get("/api/members")).body.find((m) => m.name === "Sian").id;
    assert.equal((await app.patch(`/api/members/${gid}`, { email: "not-an-email" })).status, 400);
    assert.equal((await app.patch(`/api/members/${sian}`, { email: "sian@example.com" })).status, 400);
    assert.equal((await app.patch(`/api/members/${gid}`, { email: " Gladis@Example.com " })).status, 200);
    assert.equal((await app.post("/api/members", { name: "Copy", role: "adult", email: "gladis@example.com" })).status, 409);
    assert.equal((await app.get("/api/members")).body.find((m) => m.id === gid).email, "gladis@example.com");
    assert.equal((await app.get("/api/members", "housekeeper")).body.find((m) => m.id === gid).email, undefined);
    assert.equal((await app.patch(`/api/members/${gid}`, { email: "" })).body.find((m) => m.id === gid).email, null);
  } finally { await app.close(); }
});
