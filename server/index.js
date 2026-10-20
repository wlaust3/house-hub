import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db/index.js";
import { createHub } from "./hub.js";
import { requireMember } from "./access.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.HOUSE_HUB_DB ?? path.join(here, "..", "data", "house-hub.db");
const port = Number(process.env.PORT ?? 3000);
// Bind all interfaces so the tablet on the home Wi-Fi can reach it. This port has NO login (it is
// the family dashboard): never port-forward it to the internet.
const host = process.env.HOST ?? "0.0.0.0";

// Outside access goes through a Cloudflare Tunnel to a second port on this computer only, where
// everyone must be signed in (Cloudflare Access + Google) as a member. See docs/HOSTING.md.
const team = process.env.CF_ACCESS_TEAM; // e.g. ourhouse.cloudflareaccess.com
const aud = process.env.CF_ACCESS_AUD;
const publicPort = Number(process.env.PUBLIC_PORT ?? 3223);

// HOUSE_HUB_NOW (testing/demo only): pretend the clock started at this local time, e.g. 2026-10-16T09:00:00.
const fake = process.env.HOUSE_HUB_NOW ? Date.parse(process.env.HOUSE_HUB_NOW) - Date.now() : 0;
const now = () => new Date(Date.now() + fake);

const db = openDb(dbFile);
const hub = createHub(db, { now, dbFile });
hub.listen(port, host, () => {
  console.log(`House Hub running on http://${host}:${port}  (db: ${dbFile})`);
  console.log("Open it from another device using this computer's LAN IP address.");
});

if (team && aud) {
  const pub = express();
  pub.use(requireMember(db, { team, aud }));
  pub.use(hub);
  pub.listen(publicPort, "127.0.0.1", () => console.log(`Signed-in access for the tunnel on http://127.0.0.1:${publicPort}`));
} else if (team || aud) {
  console.warn("Set both CF_ACCESS_TEAM and CF_ACCESS_AUD to turn on outside access.");
}
