# House Hub data model

SQLite, one file (`data/house-hub.db` by default, override with `HOUSE_HUB_DB`). The authoritative schema is
[`server/db/migrations/001_init.sql`](../server/db/migrations/001_init.sql); new changes go in new numbered
migration files, never by editing an applied one. Conventions:

- Dates are `YYYY-MM-DD` strings in the **house's local time zone** (set `TZ` for the server; default is the machine's zone). Do date math on these strings with a date library or plain `Date` in UTC to avoid DST bugs - never mix in time-of-day.
- Timestamps (`*_at`) are ISO-8601 UTC strings.
- Weekdays are ISO numbers: 1 = Monday ... 7 = Sunday.
- `done_by`, `created_by`, `actor` hold a **role** (`housekeeper` / `family`), not a user id, because v1 has no accounts.

## Schema (summary)

```sql
recurrence_rules(id, kind[daily|weekly|monthly|every_six_months|custom],
                 interval_n, interval_unit[day|week|month], anchor_date, ends_on)

tasks(id, title, notes,
      source[manual|recurring|device], external_id, source_meta JSON,
      recurrence_id -> recurrence_rules, active, created_by, created_at)
      -- UNIQUE(source, external_id) where external_id is not null

task_instances(id, task_id -> tasks, due_date, visit_date,
               status[pending|done|skipped], done_at, done_by, note,
               rolled_from (date), created_at)
               -- UNIQUE(task_id, due_date)

grocery_items(id, name, quantity, added_by, added_at, bought_at, cleared_at)

requests(id, title, details, kind[buy|approve|other],
         status[submitted|approved|done], created_at, approved_at, done_at)

schedule(weekday PK 1..7, active)                       -- seeded Mon, Thu, Sat
day_overrides(date PK, reason[appointment|sick|other], mode[hide|shift],
              shifted_to, note, created_by, created_at)

activity_log(id, at, actor, action, entity, entity_id, detail JSON)
```

### Why two tables for tasks

- `tasks` is the **definition/template** ("Clean bathrooms, monthly"; or a one-off "Let plumber in").
- `task_instances` is a **dated occurrence** that actually gets checked off. All history (done_at, done_by, note, carried over) lives on instances, so editing or deleting a definition never rewrites the past.
- A one-off task is simply a `tasks` row with `recurrence_id = NULL` and exactly one instance.

### due_date vs visit_date

- `due_date` is the nominal date from the recurrence rule (or the date requested). It is the idempotency key with `task_id`.
- `visit_date` is the day the housekeeper will actually see it: the first *regular visit day* on or after `due_date` that is not covered by a `day_overrides` row (or its shifted day). The UI always queries by `visit_date`.
- Because `visit_date` is derived, it can be recomputed whenever the schedule or an override changes, for all `pending` instances in the future.

## Recurrence computation

A rule generates a sequence of due dates starting at `anchor_date`:

| kind | interval | next due date |
| --- | --- | --- |
| `daily` | 1 day | previous + 1 day |
| `weekly` | 1 week | previous + 7 days (same weekday) |
| `monthly` | 1 month | same day of month; clamp to month end (Jan 31 -> Feb 28/29 -> Mar 31) |
| `every_six_months` | 6 months | same day of month, clamped |
| `custom` | `interval_n` x `interval_unit` | as above |

Rules for correctness:

1. **Compute from the anchor, not from the previous result**: occurrence *k* = `anchor + k * interval` (clamped). This stops month-end drift (Jan 31 -> Feb 28 -> Mar 28...). Use the anchor's day-of-month for every month.
2. Dates are fixed to the rule, not to when the task was ticked. Finishing a monthly task late does not move next month's date. (Documented decision; "repeat N days after completion" is a possible future option.)
3. **Materialization is lazy and idempotent**: a function `ensureInstances(throughDate)` inserts missing `task_instances` for every active recurring task up to a horizon (e.g. today + 60 days for the calendar) using `INSERT ... ON CONFLICT(task_id, due_date) DO NOTHING`. Run it on server start, once a day, and before any read that needs the future. No cron dependency is required: calling it on request is fine.
4. `ends_on` stops generation; pausing a task sets `tasks.active = 0` and deletes (or skips) future `pending` instances.
5. Pure functions (`nextDue`, `occurrencesBetween`, `firstVisitOnOrAfter`) take plain values and no DB handle so they can be unit tested, including: Jan 31 monthly, Feb 29 on a leap year, six-month from Aug 31, DST weekends, custom 10 days, custom 3 weeks, custom 2 months.

## Rollover ("unchecked tasks roll forward automatically")

Rollover updates the **same instance in place** (one row per task occurrence; `UNIQUE(task_id, due_date)` stays true). `due_date` never changes; `visit_date` moves forward; `rolled_from` records the visit date the item was **first** shown on (set once, never overwritten), so the UI can say "Carried over from Monday" whenever `rolled_from IS NOT NULL`.

Rollover is computed, not manually triggered. `rollover(today)` is called by `ensureInstances` and at the start of any request that reads tasks (cheap and idempotent):

1. Find `pending` instances with `visit_date < today` (the visit has passed without being completed).
2. Set `visit_date` = the next valid visit day on or after `today` (regular visit day, not out), and set `rolled_from` = the old `visit_date` if it was NULL. Log `task.rolled` once per move.
3. End-of-day confirm ("All done" with items left unchecked) does the same for today's remaining `pending` items immediately, moving them to the next visit after today, so the confirmation summary ("3 things will carry over to Thursday") is exact.
4. **At most one open instance per task:** when a recurring task's next occurrence becomes due while an earlier one is still `pending`, do not insert another; the open one stays (carried over). Without this rule a daily task missed for a week would show seven copies.
5. Undoing: ticking a done task back sets `status = 'pending'`, clears `done_at`/`done_by`, and logs `task.undone`.

## Out-day handling

A row in `day_overrides` says "the regular visit on `date` will not happen". Creating one is a single action: `{date, reason, created_by}` (mode defaults to `shift`).

- **shift (default):** every `pending` instance with `visit_date = date` gets a new `visit_date` = `shifted_to` if set, else the next regular visit day (that is not itself an out day). `rolled_from` is set to `date` so they show as carried over. Nothing is lost.
- **hide:** that day's *recurring* occurrences are marked `skipped` (not carried over; the next occurrence is generated normally). One-off tasks (`recurrence_id IS NULL`) and anything already carried over are *still* shifted - a hidden day must never swallow something the family explicitly asked for.
- Undoing an out day deletes the override and moves shifted instances back to `date` if they have not been completed, and un-skips hidden ones. Keep enough data (the `rolled_from` date plus an `activity_log` entry) to do this reliably; if it is too complex, undo may simply recompute `visit_date` for all pending future instances from the schedule.
- Only today or future regular visit days may be marked out. A change to the regular `schedule` triggers the same recompute of `visit_date` for pending future instances.
- Always write an `activity_log` row (`day.out`, `day.out_undone`).

## Grocery, requests

- `grocery_items`: pending = `bought_at IS NULL`; bought = `bought_at` set; hidden after "Clear bought" sets `cleared_at` on bought rows. Rows are never hard-deleted.
- `requests.status` allowed transitions: `submitted -> approved -> done`, `submitted -> done`. Enforce in the server (not only the UI). Set `approved_at` / `done_at` on the transition.

## Activity log

Append-only. `action` uses dotted verbs: `task.done`, `task.undone`, `task.added`, `visit.closed`, `grocery.bought`, `request.approved`, `request.done`, `day.out`, `schedule.changed`. `detail` is free JSON for display (task title snapshot, etc.), so history still reads correctly after items are renamed.

## Future: device ingestion (not in v1)

Smart-home devices or hubs may later push tasks (e.g. "Charge smart shade batteries - Living room" when a battery is low). The v1 schema already supports this; adding it must not require migrations beyond adding an API key table:

- `tasks.source = 'device'`, `tasks.external_id` = a stable id from the device (e.g. `shade-livingroom-battery`), `tasks.source_meta` = JSON with device name, battery %, etc. for display.
- `UNIQUE(source, external_id)` makes pushes idempotent: re-sending an active alert updates the existing task instead of duplicating it.
- Planned endpoint (documented only, **not implemented in v1**):

```http
POST /api/tasks
X-API-Key: <key>
Content-Type: application/json

{
  "title": "Charge living room shade batteries",
  "source": "device",
  "external_id": "shade-livingroom-battery",
  "source_meta": { "device": "Living room shade", "battery_pct": 12 },
  "due_date": "2026-10-20"        // optional; default = next visit
}
-> 201 { "task_id": 17, "instance_id": 42 }  (200 if it already existed and is open)
```

- Keys will live in a future `api_keys(id, name, key_hash, created_at, revoked_at)` table; only the hash is stored; keys are created from a Family-only settings screen. The device endpoints are the *only* part that would ever need auth, and are still LAN-only.
- A device may also `DELETE /api/tasks/by-external/:source/:external_id` (or send `"resolved": true`) when the condition clears (battery charged), which marks the open instance `skipped`.
- Device-created tasks flow through the same instance / rollover / out-day logic as manual ones; the UI shows a small device badge when `source = 'device'`.
