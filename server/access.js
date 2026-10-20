// Sign-in for people opening the hub from outside the house.
//
// Cloudflare Access sits in front of the public address and makes everyone sign in with Google.
// For each request it lets through, Cloudflare adds a signed token (JWT) naming the person's email.
// We check that token here and match the email to a member. Requests on the home Wi-Fi port never
// pass through this: those are the family dashboard (see server/index.js).
import crypto from "node:crypto";

const b64json = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

/**
 * Check a Cloudflare Access token. Returns the email it names, or null if it is not valid.
 * @param keys  { [kid]: KeyObject } Cloudflare's current signing keys
 */
export function verifyAccessToken(token, { keys, team, aud, now = Date.now() }) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  let header, claims;
  try {
    header = b64json(parts[0]);
    claims = b64json(parts[1]);
  } catch {
    return null;
  }
  const key = keys[header.kid];
  if (header.alg !== "RS256" || !key) return null;
  const signed = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
  if (!signed) return null;
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud) || claims.iss !== `https://${team}`) return null;
  const sec = now / 1000;
  if (typeof claims.exp !== "number" || claims.exp < sec) return null;
  if (typeof claims.nbf === "number" && claims.nbf > sec + 60) return null;
  return typeof claims.email === "string" && claims.email ? claims.email : null;
}

/** Cloudflare's signing keys for a team, fetched on demand and re-fetched at most once a minute. */
export function cloudflareKeys(team, fetchImpl = fetch) {
  let keys = {};
  let fetchedAt = 0;
  return async (kid) => {
    if (keys[kid] || Date.now() - fetchedAt < 60_000) return keys;
    fetchedAt = Date.now();
    const res = await fetchImpl(`https://${team}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`Cloudflare keys: HTTP ${res.status}`);
    const body = await res.json();
    keys = Object.fromEntries((body.keys ?? []).map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" })]));
    return keys;
  };
}

const page = (title, text) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>House Hub</title>
<style>body{font:18px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#1c1f24;background:#f6f7f9}h1{font-size:1.4rem}</style></head>
<body><h1>${title}</h1><p>${text}</p></body></html>`;

/**
 * Middleware for the public port: only signed-in members get through, and `req.member` says who they are.
 * @param opts.team  the Cloudflare team domain, e.g. "ourhouse.cloudflareaccess.com"
 * @param opts.aud   the Access application's audience (AUD) tag
 * @param opts.getKeys (kid) => Promise<{ [kid]: KeyObject }>  (injectable for tests)
 */
export function requireMember(db, { team, aud, getKeys = cloudflareKeys(team) }) {
  const byEmail = db.prepare("SELECT id, name, role FROM members WHERE lower(email) = lower(?) AND removed_at IS NULL");
  return async (req, res, next) => {
    const deny = (status, title, text) =>
      req.path.startsWith("/api/") ? res.status(status).json({ error: text }) : res.status(status).type("html").send(page(title, text));
    const token = req.get("cf-access-jwt-assertion");
    let email = null;
    try {
      const kid = token ? b64json(token.split(".")[0]).kid : undefined;
      if (kid) email = verifyAccessToken(token, { keys: await getKeys(kid), team, aud });
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error(e);
    }
    if (!email) return deny(401, "Please sign in", "Your sign-in has run out or could not be checked. Reload the page to sign in again.");
    const member = byEmail.get(email);
    if (!member) return deny(403, "Not set up yet", `You are signed in as ${email.replace(/[<>&"]/g, "")}, but that account is not in the household. Ask the family to add it in Settings.`);
    req.member = member;
    next();
  };
}
