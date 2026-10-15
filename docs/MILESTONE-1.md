# Milestone 1: Core housekeeper hub

## Goal

A housekeeper who comes Monday, Thursday and Saturday can open House Hub on her phone or tablet, see what to do today, tick it off, add to the grocery list, ask the family for things, and tell them when she can't come. The family can add tasks, approve requests and change the schedule. Everything runs on one computer in the house, on the home Wi-Fi only.

## In scope

1. Recurring tasks (daily, weekly, monthly, every six months, custom interval) with automatic roll-forward of unchecked tasks.
2. Arrival workflow: home screen with today's tasks plus upcoming items, and an end-of-day batch check-off.
3. Optional, navigable calendar view (default is upcoming-only).
4. Family can add one-off tasks for her next visit.
5. Grocery list (add, check off, clear bought).
6. Her requests to the family, with statuses submitted, approved, done.
7. Schedule: Mon/Thu/Sat by default, one-tap "I'm out" with reason, family can edit the regular schedule.
8. Nice-to-haves, only if simple: timestamped check-off log, per-task note, due-soon surface.

## Explicitly out of scope

- Home automation / device integration (the data model must allow it later; see `docs/DATA-MODEL.md`).
- Cloud hosting or any internet exposure.
- Accounts, passwords, or real authentication (v1 uses a simple "Who are you?" picker, trusting the home LAN).
- Push notifications, email or SMS.
- Languages other than English (but all UI text must go through i18n keys).
- Native mobile apps.

## Cross-cutting acceptance criteria

- [ ] **Run:** `npm install && npm start` starts a single process that serves the API and the web app, creating the SQLite DB file on first run. No other command or service is needed.
- [ ] **LAN:** server binds `0.0.0.0` (configurable via `HOST`/`PORT`); from a phone and a tablet on the same Wi-Fi, the app loads at `http://<server-ip>:3000` and all features work. README documents finding the IP and the optional `house-hub.local` name.
- [ ] **Tap targets:** every tappable control is at least 56x56 CSS px with at least 8px between neighbours; verified on a 360px-wide phone viewport and on a tablet. Checkboxes are large rows (whole row is tappable), not tiny boxes.
- [ ] **One primary action per screen:** each screen has one visually dominant button; no screen needs more than one scroll to reach it.
- [ ] **Plain words:** no jargon in the UI ("Done", "I can't come", "Add to list"); high-contrast text (WCAG AA at least); no hover-only or gesture-only interactions.
- [ ] **i18n keys only:** no user-visible literal strings in components; all text comes from `web/src/i18n/en.json` through `t("key")`. A test fails if a key used in code is missing from `en.json` or if `en.json` has unused keys. Dates are formatted with `Intl.DateTimeFormat` using the active locale.
- [ ] **Roles:** first visit shows "Who are you?" with Housekeeper / Family; the choice is remembered on the device and can be changed from one clearly visible control. Family-only actions (edit schedule, approve requests, edit recurring task definitions) are hidden from the Housekeeper role. This is a convenience, not security; the LAN-trust assumption is stated in the README.
- [ ] **Persistence & backup:** all data lives in one SQLite file (path set by `HOUSE_HUB_DB`); copying that file while the server is stopped is a complete backup, and restoring it restores everything.
- [ ] **Tests:** automated tests cover recurrence computation, rollover, and out-day handling (hide and shift), including month-end and leap-day cases, and a day-override on a day with carried-over tasks. `npm test` passes.
- [ ] **CI:** the workflow in `docs/ci.yml.example` is moved to `.github/workflows/ci.yml` (needs a token with `workflow` scope). GitHub Actions runs install, build and test on every push and PR to `main`, and is green.
- [ ] **Docs:** README and `docs/DATA-MODEL.md` match what was built.

## Acceptance criteria by scope item

### (1) Recurring tasks

- [ ] Family can create a task with a title and a repeat of: every day, every week, every month, every six months, or custom ("every N days / weeks / months").
- [ ] Family can edit, pause, or delete a recurring task; edits apply to future occurrences only and never rewrite history.
- [ ] Occurrences appear on the correct dates for each repeat type (unit-tested): weekly keeps the weekday, monthly on the 31st falls on the last day of shorter months, six-monthly is +6 calendar months, custom N works for days/weeks/months.
- [ ] A task due on a day she does not visit shows up on her next visit day.
- [ ] An unchecked task rolls forward automatically to her next visit day (no one has to press anything) and shows a **"Carried over"** marker, plus how many visits it has been carried (e.g. "Carried over from Monday").
- [ ] A recurring task never has more than one open occurrence: if the previous one is still unchecked when the next is due, they merge into one carried-over item instead of piling up.
- [ ] Checking a task off records `done_at` and who did it, and the next occurrence is scheduled from the rule (not from when it was ticked), as documented.

### (2) Arrival workflow and end-of-day check-off

- [ ] Opening the app as Housekeeper on a visit day lands on a home screen showing: **Today** (tasks for today including carried-over ones) at the top, then **Coming up** (next few visits/days).
- [ ] On a non-visit day, home shows "Next visit: <day>" and the upcoming list instead of an empty Today.
- [ ] Tapping a task row toggles done / not done with immediate visual feedback (strike-through plus check) and is undoable with one tap.
- [ ] There is one obvious **"Before I leave"** button on home. It opens a single screen listing all of today's tasks as large rows; already-done tasks are pre-checked, she can tick the rest, and a single **"All done"** confirm button saves everything in one tap.
- [ ] Confirming with unchecked tasks remaining shows a plain-language summary ("3 things will carry over to Thursday") before saving; confirming rolls those tasks to her next visit.
- [ ] The Today list can be completed using the home screen alone, with no other screen required.

### (3) Calendar view

- [ ] Default home shows upcoming-only; the calendar is reached through one clearly labelled "Calendar" button and is never shown unless chosen.
- [ ] The calendar is a month view with large day cells (at least 48px), previous/next month buttons, and today highlighted; visit days, out days and days with tasks are visually distinct (not by colour alone).
- [ ] Tapping a day shows that day's tasks (read-only for past days; editable for today/future).
- [ ] Back to home is one tap, and the app remembers nothing that forces the calendar to be the default.

### (4) One-off tasks from family

- [ ] Family can add a one-off task with just a title (optional note); it defaults to **"Next visit"**, with an optional specific date picker.
- [ ] The new task appears on the housekeeper's next visit day (taking out-days into account) and not before.
- [ ] A task added after a visit day has already started appears on that day if it is today and the visit has not been completed; otherwise on the following visit.
- [ ] One-off tasks are `source = 'manual'`, with no recurrence rule, and can be edited or deleted by Family until done.
- [ ] If not done, a one-off task rolls forward like any other.

### (5) Grocery list

- [ ] Either role can add an item with a name (optional quantity) in at most 2 taps plus typing; the input stays focused for adding several in a row.
- [ ] Items are shown as large check rows; tapping marks an item **bought** (struck through, moves to the bottom) and tapping again un-buys it.
- [ ] One **"Clear bought"** button removes all bought items from view (soft-delete via `cleared_at`, kept in the DB) after a one-tap confirmation.
- [ ] The list is shared and updates on other devices within 10 seconds (polling is fine) or on refresh.
- [ ] The list works on a phone in a store with a slow connection: at most 1 request per action and no page reload.

### (6) Requests to the family

- [ ] Housekeeper can create a request with a short title (e.g. "Need cleaning spray", "Approve contractor visit"), an optional detail, and a kind (buy / approve / other).
- [ ] New requests have status **submitted**. Family sees submitted requests first, flagged on their home screen, and can move a request to **approved** or **done** with one tap each.
- [ ] Allowed transitions are submitted -> approved -> done, and submitted -> done (for requests that need no approval). The server rejects any other transition with a clear error (tested).
- [ ] The housekeeper sees the current status of each of her requests, in plain words ("Waiting", "Approved", "Done"), and the timestamp of the last change.
- [ ] Done requests move to a collapsed "Finished" section; nothing is deleted.

### (7) Schedule and out days

- [ ] The regular schedule defaults to Monday, Thursday and Saturday.
- [ ] Family can edit the regular schedule by tapping weekday toggles (any combination of the seven days); changes apply to future visits and existing future task placements are recomputed.
- [ ] From home, the Housekeeper can mark an upcoming visit day (including today) as **out** in at most **2 taps**: tap "I can't come" then tap one reason button (**Appointment**, **Sick**, **Other**). No typing is required.
- [ ] Marking a day out never silently loses tasks. Default behaviour is **shift**: that day's tasks move to the next regular visit day and show "Carried over". Family can choose **hide** per out day instead: that day's *recurring* occurrences are marked skipped (not carried over; the next occurrence is unaffected), while one-off tasks and anything already carried over always move to the next visit so nothing the family asked for is lost (behaviour documented in `docs/DATA-MODEL.md` and tested).
- [ ] An out day appears on the family home screen ("The housekeeper is out Thursday - Sick") and in the calendar; the housekeeper can undo it with one tap.
- [ ] Marking a past day out is not allowed. Marking a non-visit day out is not needed.
- [ ] Optional: family can add a note to an out day; the housekeeper's reason is never required to be typed.

### (8) Nice-to-haves (only if simple; all must be behind the same tap-target and i18n rules)

- [ ] **Check-off log:** every check/uncheck, request status change, out-day and schedule edit writes a row to `activity_log` with timestamp and role; Family can view a read-only "History" list, newest first, with plain-language lines ("Housekeeper finished 'Clean bathroom' Mon 3:42 PM").
- [ ] **Per-task note:** a task row can expand to add or read a short note (saved on that occurrence); notes show on the Family view.
- [ ] **Due-soon:** home shows a "Next few days" section listing tasks due in the next 3 days that are not on a visit day today; the window is a single named constant.
- [ ] If any of these is deferred, an issue is opened for it and this box is ticked with "(deferred, see #N)".

## Definition of done

All boxes above ticked (or explicitly deferred with a linked issue for the nice-to-haves), CI green on `main`, README run instructions verified on a clean machine, and a short manual test script (`docs/MANUAL-TEST.md`) walked through on a real phone and tablet over Wi-Fi.
