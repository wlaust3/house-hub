# House Hub

A small web app that runs **on a computer inside your house** (no cloud) so a housekeeper who acts as the general house manager, and the family she works for, can share one simple list: what to do today, groceries, requests, and when she is coming.

> **Status: milestone 1 built, awaiting real-device testing.** Recurring tasks with roll-forward, the arrival screen and end-of-day check-off, one-off tasks, groceries, requests, schedule with one-tap out days, a calendar, a history list, per-task notes and a due-soon list are implemented and tested. It has been exercised with automated API tests and a headless browser at phone (360px) and tablet widths, but **not yet on a real phone or tablet over Wi-Fi** - see [`docs/MANUAL-TEST.md`](docs/MANUAL-TEST.md). Spec: [`docs/MILESTONE-1.md`](docs/MILESTONE-1.md).

## Who it is for

- **The housekeeper** (primary user): often on a phone or tablet, wants big buttons, few steps, and plain words. English only in v1, but built so a second language can be added without rework.
- **The family**: adds one-off tasks, approves her requests, edits the regular schedule.

## What v1 does

Recurring tasks that roll forward when unchecked; an arrival screen (today + coming up) and an end-of-day "All done" check-off; an optional calendar; one-off tasks from family; a grocery list; her requests with statuses submitted / approved / done; a Mon/Thu/Sat schedule where she can mark a day out in two taps; plus (if simple) a check-off log, per-task notes, and a due-soon list. Full details and acceptance criteria: [`docs/MILESTONE-1.md`](docs/MILESTONE-1.md).

**Not in v1:** home-automation/device integration (designed for, see below), cloud hosting, passwords/accounts, push notifications, other languages, native apps.

## Stack and rationale

**Node.js 20+ / Express / SQLite (`better-sqlite3`) / Vite + React + TypeScript**, in **one process**: Express serves the JSON API under `/api` and the built frontend as static files. One command (`npm start`), one DB file.

Why:

- **Shared state needs a tiny server.** Several phones and tablets must see the same list, so it can't be browser-only storage.
- **SQLite** is a single file: easy to back up (copy it), no database server to install, plenty fast for one household. `better-sqlite3` is synchronous and simple, with no async plumbing.
- **Single process, single command** runs on a Raspberry Pi, old laptop, or Mac mini.
- **React + TypeScript for the frontend:** the UI is a handful of very interactive screens (tick rows, optimistic updates, undo, calendar), and typed i18n keys catch missing strings at build time. Vite builds to plain static files, so there is no Node build step at runtime on the device and no separate frontend server in production.

Alternatives considered:

| Option | Why not (for now) |
| --- | --- |
| **htmx + server-rendered templates** (e.g. EJS) | Genuinely simpler and a fine choice. Rejected mainly because the check-off / undo / calendar interactions and typed i18n are nicer in React, and agents building this are fluent in it. Would reduce dependencies if we ever want to shrink the project. |
| **Python (Flask/FastAPI) + SQLite** | Equally valid backend; Node chosen so the whole repo is one language and one toolchain. |
| **Next.js / full-stack framework** | Heavier than needed, more moving parts on a small device. |
| **Firebase/Supabase/any cloud** | Violates the local-only, no-cloud requirement. |
| **Postgres/MySQL** | Another service to install and back up; unnecessary at this scale. |
| **PWA with offline-first sync** | Complexity not justified: the server is on the home Wi-Fi where she works. Can add a service worker later. |

## Run it

```bash
npm install
npm start          # builds the frontend, then starts the server on port 3000
```

Open `http://localhost:3000` on the same machine. Settings (environment variables):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Interface to bind (`0.0.0.0` = reachable from the home network) |
| `HOUSE_HUB_DB` | `./data/house-hub.db` | SQLite file location (created on first run) |
| `TZ` | system zone | Set to the house's time zone so "today" is correct |
| `HOUSE_HUB_NOW` | (real clock) | Testing/demo only: pretend the clock started at this local time |

Development: `npm run dev:server` (API with auto-restart) and `npm run dev:web` (Vite dev server with `/api` proxied to port 3000). Tests: `npm test`.

### Using it from phones and tablets (LAN)

1. Make sure the server computer and the phones/tablets are on the **same Wi-Fi**.
2. Find the server's IP address: macOS `ipconfig getifaddr en0`; Linux / Raspberry Pi `hostname -I`; Windows `ipconfig` (IPv4 Address).
3. On the phone, open `http://<that-ip>:3000` (e.g. `http://192.168.1.50:3000`) and "Add to Home Screen" for an app-like icon.
4. Give the server a **fixed IP** (a DHCP reservation in your router) so the address doesn't change.
5. Optional friendly name: on macOS the machine is already reachable as `<computer-name>.local`; on a Raspberry Pi/Linux install Avahi (`sudo apt install avahi-daemon`) and set the hostname to `house-hub` so it answers at `http://house-hub.local:3000`.
6. Optional: start on boot with a systemd unit (Linux) or launchd (macOS) running `npm run start:server` after one `npm run build`.

**Keep it off the internet.** v1 has **no login**. Anyone who can reach the port can use and change everything. The design assumes a trusted home network: do not port-forward it, do not expose it through a tunnel, and use a router/guest-Wi-Fi setup if you do not trust everyone on your Wi-Fi.

### Who are you? (roles, no passwords)

On first open, each device asks **"Who are you?"** - **Housekeeper** or **Family** - and remembers the answer (browser `localStorage`). The role decides which screens and buttons appear (family-only: edit schedule, approve requests, edit recurring tasks) and is stored in `done_by`/`created_by` in the log. It is a convenience, **not security**.

### Backups

Stop the server and copy the DB file (default `data/house-hub.db`, plus `-wal`/`-shm` files if present). Restoring is copying it back. (While running, `sqlite3 data/house-hub.db ".backup backup.db"` also works.)

## Data model overview

Full schema in [`server/db/migrations/`](server/db/migrations/) (`001_init.sql`, then `002_milestone1.sql`); explanation in [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md).

| Table | Purpose |
| --- | --- |
| `tasks` | Task **definitions**: title, notes, `source` (manual / recurring / device), `external_id`, `source_meta` JSON, optional recurrence rule |
| `recurrence_rules` | daily / weekly / monthly / every six months / custom interval, with an anchor date |
| `task_instances` | Dated **occurrences** that get ticked: `due_date`, `visit_date`, `status`, `done_at`, `done_by`, `note`, `rolled_from` (carried over) |
| `grocery_items` | Shopping list: bought / cleared timestamps |
| `requests` | Her requests to the family: `submitted` -> `approved` -> `done` |
| `schedule` | Regular visit weekdays (seeded Mon, Thu, Sat) |
| `day_overrides` | Out days with reason (appointment / sick / other) and hide-or-shift mode |
| `visit_closures` | Visits finished with "All done" (later tasks go to the following visit) |
| `activity_log` | Append-only timestamped history of check-offs and changes |

**Future devices:** tasks already carry `source`, `external_id` and `source_meta`, so smart-home gear can later push tasks (e.g. "charge smart shade batteries") through a planned, documented-only `POST /api/device/tasks` with an API key (`POST /api/tasks` is the family's task editor). No rework of the schema is needed. See [DATA-MODEL.md](docs/DATA-MODEL.md#future-device-ingestion-not-in-v1).

## UI design principles

1. **Big targets:** every tappable control at least **56 px**, with space between; whole rows are tappable.
2. **One primary action per screen:** one dominant button; everything else is clearly secondary.
3. **Plain words:** "Done", "I can't come", "Add to list". No jargon, no abbreviations.
4. **High contrast** and large text (base font 20 px); never colour alone to convey meaning.
5. **Minimal steps:** marking a day out is at most 2 taps; the end-of-day check-off is one screen with one "All done" button.
6. **No hover or gesture-only interactions;** works with a thumb on a phone and on a tablet.
7. **All text through i18n keys** (`web/src/i18n/en.json`, `t("key")`), so adding a language later is adding one file.
8. **Forgiving:** every check-off can be undone in one tap; nothing is permanently deleted by accident.

## Project layout

```
house-hub/
  server/
    index.js            # entry: opens DB, starts Express (binds 0.0.0.0)
    app.js              # Express app factory (injectable clock), error handling, static files
    db/
      index.js          # opens SQLite, runs migrations
      migrations/       # 001_init.sql, 002_milestone1.sql (never edit an applied one)
    logic/              # PURE functions, no DB/clock: dates, recurrence, visits (placement),
                        #   rollover (recompute + merge), outdays, requests (transitions)
    services/           # DB-facing: context (load schedule/out days), sync (ensure + recompute)
    routes/             # tasks, visits, schedule (+days-out), lists (grocery, requests), views (home, calendar, log)
  web/
    index.html
    vite.config.ts
    src/
      main.tsx, App.tsx # hash router, role picker, tab bar
      api.ts, role.ts, hooks.ts, format.ts, types.ts
      screens/          # Home, EndOfDay, Grocery, Requests, Schedule, Tasks, TaskForm, Calendar, History
      components/ui.tsx # PrimaryButton, CheckRow, ...
      i18n/             # en.json + t()/plural() helpers
  test/                 # node:test tests (npm test)
  docs/                 # MILESTONE-1.md, DATA-MODEL.md, HANDOFF.md, MANUAL-TEST.md
  .github/workflows/ci.yml  # GitHub Actions CI (install, build, test)
```

## API at a glance

JSON under `/api`; send `X-Role: housekeeper|family` (advisory, see "Who are you?"). Errors are `{ "error": "plain-language message" }`.

| Endpoint | Purpose |
| --- | --- |
| `GET /home` | Everything the home screen needs: today's items, coming up, due soon, waiting requests |
| `GET /calendar?month=YYYY-MM` | Month grid data (visit days, out days, tasks per day) |
| `PATCH /instances/:id` | `{done}` tick/untick, `{note}` per-task note |
| `POST /visits/:date/close`, `DELETE /visits/:date` | "All done" (batch check-off; unchecked items carry over) and undo |
| `GET/POST /tasks`, `PATCH/DELETE /tasks/:id` | Family: task definitions (one-off or repeating), edit/pause/delete |
| `GET/PUT /schedule` | Regular visit days (family edits) and the next visits |
| `POST /days-out`, `PATCH/DELETE /days-out/:date` | Out day (reason; shift or hide), change mode/note, undo |
| `GET/POST /grocery`, `PATCH /grocery/:id`, `POST /grocery/clear-bought` | Shopping list |
| `GET/POST /requests`, `PATCH /requests/:id` | Requests; family moves `submitted -> approved -> done` |
| `GET /log` | Family: history |

For demos and tests only, `HOUSE_HUB_NOW=2026-10-16T09:00:00` starts the server with a pretend clock.

## CI

CI is active: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs install, build and test on every push to `main` and every pull request.

## Contributing / agents

Start with [`docs/HANDOFF.md`](docs/HANDOFF.md). License: MIT.
