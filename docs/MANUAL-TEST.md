# Manual test script (real phone and tablet over Wi-Fi)

Automated tests and headless-browser checks (phone 360px, tablet 820px, emulated touch) were run during development. **This script has not yet been walked through on a real phone or tablet.** Do that before calling milestone 1 done, and tick the boxes here.

## Setup

1. On the house computer: `npm install && npm start`. Note the IP address (README "Using it from phones and tablets").
2. Phone and tablet on the same Wi-Fi: open `http://<ip>:3000`. Expect the "Who are you?" screen.
3. Optional: set `TZ` correctly on the server and check that Home shows today's real date.

## Housekeeper (phone)

- [ ] Choose **Housekeeper**. Close the browser tab and reopen: you are still Housekeeper.
- [ ] Home shows today's tasks (on a Mon/Thu/Sat) or "Next visit: ..." (other days), then "Coming up".
- [ ] Tap a task row with your thumb: it ticks (check mark, strike-through). Tap again: it unticks.
- [ ] Tap **Note**, type a note, **Save**: the note shows under the task.
- [ ] Every button is easy to hit one-handed; nothing is hidden behind the bottom bar.
- [ ] Tap **Before I leave**. Pre-ticked items are ticked. Leave one unticked, tap **All done**: the screen says how many things will carry over and to which day. Tap **Yes, save and finish**.
- [ ] Home says today's visit is finished; the leftover item is under the next visit with "Carried over from ...".
- [ ] Next visit day: the carried item is at the top of Today with its "Carried over" marker.
- [ ] **I can't come <day>** -> **Sick**: exactly two taps. The day shows as out; **Undo** brings it back.
- [ ] Groceries: type an item, tap **Add to list** (or the keyboard's Done): the field is ready for the next item. Tick an item: it moves to the bottom. **Clear bought items** -> **Yes, clear them**.
- [ ] Open Groceries on the tablet at the same time; add an item on the phone; it appears on the tablet within ~10 seconds.
- [ ] Requests: send "Need cleaning spray". It shows **Waiting**.
- [ ] Calendar (button on Home): month view, big day cells, today outlined, visit days dotted, out days marked with an x. Tap a day to see its tasks. **Home** goes back.

## Family (tablet)

- [ ] Choose **Family** (use the button at the top right to switch).
- [ ] Home shows "N requests are waiting for you". Requests: **Approve**, then **Mark done**: it moves to "Finished".
- [ ] More -> **Tasks** -> **Add a task**: "Just once" + "Next visit" appears on her next visit day. "Repeats" every week from today appears on the right weekday.
- [ ] Edit a repeating task; **Pause** it; **Delete** one-off (with the confirmation).
- [ ] More -> **Schedule**: toggle a weekday on and off; the upcoming visits change. Mark an upcoming day out, switch between "Move to next visit" and "Skip repeating tasks", add a note, **Undo**.
- [ ] While she is marked out, Home shows "The housekeeper is out ...".
- [ ] More -> **History** shows plain lines like `Housekeeper finished "..."` with the day and time.

## Backup

- [ ] Stop the server, copy `data/house-hub.db`, start the server: nothing changed. Restore the copy on a second machine (`HOUSE_HUB_DB=...`): the same data appears.
