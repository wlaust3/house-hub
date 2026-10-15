# Handoff note for coding agents

You are building **House Hub**, a LAN-only web app for a housekeeper (who is the general house manager) and her family. Read [`README.md`](../README.md), [`docs/DATA-MODEL.md`](DATA-MODEL.md) and [`docs/MILESTONE-1.md`](MILESTONE-1.md) first; the milestone's checkboxes are the spec. GitHub issue #1 mirrors that file.

## Current state

Scaffold only: Express + better-sqlite3 server with a migration that creates every table, `/api/health`, a Vite + React + TypeScript placeholder page with `en.json` and a `t()` helper, a smoke test, and an active CI workflow (`.github/workflows/ci.yml`: install, build, test). `npm install && npm start` works. No feature endpoints or screens exist yet.

## In scope (Milestone 1)

1. Recurring tasks (daily, weekly, monthly, every six months, custom) with automatic roll-forward and a "Carried over" marker.
2. Arrival home screen (today + coming up) and end-of-day batch "All done" check-off.
3. Optional calendar view (default is upcoming-only).
4. Family adds one-off tasks for her next visit.
5. Grocery list (add, check off, clear bought).
6. Her requests to the family: submitted -> approved -> done.
7. Schedule (Mon/Thu/Sat default), one-tap out-day with reason, hide or shift, family edits the schedule.
8. Nice-to-haves only if simple: check-off log, per-task note, due-soon.

## Explicitly out of scope

- Home automation / device ingestion. Do **not** build `POST /api/tasks` or API keys; keep the schema ready (`source`, `external_id`, `source_meta`) and the design documented.
- Cloud hosting, tunnels, any internet exposure.
- Accounts, passwords, sessions, OAuth. v1 is a "Who are you?" role picker (Housekeeper / Family) stored in `localStorage`, with the LAN-trust assumption documented. Do not present it as security.
- Push notifications, email/SMS.
- Any language other than English (but **all** strings go through i18n keys).
- Native apps, offline sync, multi-household support.

## Conventions

- **Language/tooling:** Node 20+, ES modules, server in plain JS (JSDoc OK) unless you migrate it wholesale to TS; frontend in strict TypeScript. Keep dependencies few - this runs on a Raspberry Pi.
- **One process, one command:** `npm start` must keep working at all times. Don't add a second service.
- **Database:** only via numbered migrations in `server/db/migrations/`; never edit an applied migration. Use prepared statements. Wrap multi-row changes in transactions. Write an `activity_log` row for user-visible changes.
- **Dates:** `YYYY-MM-DD` local strings for dates, ISO UTC for timestamps. Keep recurrence/rollover/out-day logic in **pure functions** under `server/logic/` (no DB or clock inside; pass `today` in) so they are unit-testable.
- **API:** JSON under `/api`, REST-ish (`/api/tasks`, `/api/instances`, `/api/grocery`, `/api/requests`, `/api/schedule`, `/api/days-out`, `/api/log`). Validate input; return clear errors. The role is sent as a header (e.g. `X-Role`) for logging and for family-only guards; treat it as advisory.
- **i18n:** no literal user-visible strings in components. Add keys to `web/src/i18n/en.json`; call `t("key")`. Keys are namespaced (`task.carriedOver`, `schedule.out.sick`). Use `Intl` for dates. A test should check for missing/unused keys.
- **UI:** tap targets >= 56 px, one primary action per screen, plain words, high contrast, optimistic updates with undo, no hover-only behaviour. Test at 360px width and on a tablet width.
- **Tests:** `node --test` in `test/`. Mandatory coverage: recurrence (month-end clamping, leap day, six-month, custom), rollover, out-day hide vs shift, request transitions.
- **Commits:** small, descriptive; PR against `main`; CI (install, build, test) must be green.

## Suggested file layout

```
server/
  index.js, app.js
  db/ (index.js, migrations/)
  logic/        recurrence.js, rollover.js, visits.js, outdays.js   # pure functions
  routes/       tasks.js, instances.js, grocery.js, requests.js, schedule.js, log.js
web/src/
  main.tsx, App.tsx, api.ts, role.ts
  screens/      Home.tsx, EndOfDay.tsx, Calendar.tsx, Grocery.tsx, Requests.tsx,
                Schedule.tsx, AddTask.tsx, History.tsx
  components/   BigButton.tsx, CheckRow.tsx, ...
  i18n/         en.json, index.ts
test/           recurrence.test.js, rollover.test.js, outdays.test.js, requests.test.js, ...
```

## Suggested build order

0. **CI is active** (`.github/workflows/ci.yml`). Keep it green.
1. **Pure logic + tests:** `recurrence` (next due, occurrences between), `visits` (next visit day given schedule + overrides), `rollover`, `outdays` (hide/shift). Get these green first.
2. **Tasks API:** CRUD for definitions, `ensureInstances`, list instances by visit date, check/uncheck.
3. **Home screen** (role picker, Today + Coming up, tick rows, Carried over marker).
4. **End-of-day "All done"** screen and confirm summary.
5. **Schedule + out days** (family edit, housekeeper 2-tap out, hide/shift, undo).
6. **One-off tasks** from family and the recurring-task editor.
7. **Grocery list.**
8. **Requests** with status transitions.
9. **Calendar view** (opt-in).
10. **Nice-to-haves:** activity log view, per-task note, due-soon.
11. **Polish:** a11y/contrast pass, i18n key test, manual test script (`docs/MANUAL-TEST.md`), README sync.

## Definition of done

- Every checkbox in `docs/MILESTONE-1.md` is ticked (nice-to-haves may be deferred with a linked issue).
- `npm install && npm start` works on a clean machine; app works from a phone and tablet over Wi-Fi.
- `npm test` and CI are green; logic is covered by tests as listed above.
- README and DATA-MODEL match the code; any decision you changed is written down.
- Final PR to `main` describes what was done and anything undecided.

## Open decisions (decide, then document)

- Recurrence from fixed anchor (default, documented) vs "N days after completion".
- Whether a day's tasks that are not done when she taps "All done" need a per-task choice or always carry over (default: always carry over).
- Polling interval for shared lists (default 10 s) vs server-sent events.
- Whether to give each person a name later (v1: role only).
