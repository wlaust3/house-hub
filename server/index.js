import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db/index.js";
import { createApp } from "./app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.HOUSE_HUB_DB ?? path.join(here, "..", "data", "house-hub.db");
const port = Number(process.env.PORT ?? 3000);
// Bind all interfaces so phones/tablets on the home Wi-Fi can reach it.
// House Hub has NO login in v1: never port-forward it to the internet.
const host = process.env.HOST ?? "0.0.0.0";

// HOUSE_HUB_NOW (testing/demo only): pretend the clock started at this local time, e.g. 2026-10-16T09:00:00.
const fake = process.env.HOUSE_HUB_NOW ? Date.parse(process.env.HOUSE_HUB_NOW) - Date.now() : 0;
const now = () => new Date(Date.now() + fake);

const db = openDb(dbFile);
createApp(db, { now }).listen(port, host, () => {
  console.log(`House Hub running on http://${host}:${port}  (db: ${dbFile})`);
  console.log("Open it from another device using this computer's LAN IP address.");
});
