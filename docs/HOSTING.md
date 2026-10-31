# Hosting on pi5-server

House Hub runs on the home Raspberry Pi (`pi5-server`, `10.44.10.192`). The Pi's own setup rules are in sysmgr's platform contract (`~/agents/sysmgr/pi5-deploy.md` on basement1). The files in `deploy/` follow those rules.

| | |
|---|---|
| Code | `/opt/apps/house-hub`, a git checkout of a tag from `main` |
| Data | `/opt/apps/house-hub/data/house-hub.db` |
| Settings | `/opt/apps/house-hub/.env`, mode 600, copied from `deploy/env.example`. It holds the Cloudflare and Google settings |
| Service | `house-hub.service` (runs as `wlaust3`), from `deploy/house-hub.service` |
| Logs | `journalctl -u house-hub -f` |

The app answers on two ports, both on `127.0.0.1` only:

| Port | Who uses it | How it is reached | Login |
|---|---|---|---|
| `3222` | The family dashboard tablet on the home Wi-Fi | Caddy: `http://house.lan` → `127.0.0.1:3222` (`deploy/house-hub.caddy`) | None. Anyone on the Wi-Fi gets in, with the "Who are you?" toggle |
| `3223` | Phones away from home | Cloudflare Tunnel → `localhost:3223` | Google sign-in through Cloudflare Access, **and** the email must belong to a household member |

The Pi's firewall only lets ports 22, 80 and 443 in from the home network, so neither app port can be reached directly. `http://pi5-server.local:3222` does not work, and that's intended. Port 3223 is only on if both `CF_ACCESS_` settings are filled in.

On a personal phone the app knows who you are, so it opens in your view (Gladis → Housekeeper, adults → Family). The toggle still works there, because the housekeeper may use the family view.

## First deploy

The first install is a system change on the Pi: it adds a service and a Caddy site. **Get Bill's OK first.** After that, redeploying the same app doesn't need it.

1. **Tag `main`:** for example `git tag v0.1.0 && git push origin v0.1.0`. Only tags from `main` get deployed.
2. **Create the settings file** on the Pi:
   ```bash
   ssh wlaust3@pi5-server.local
   sudo install -d -o wlaust3 -g wlaust3 /opt/apps/house-hub
   git clone https://github.com/wlaust3/house-hub.git /opt/apps/house-hub
   cp /opt/apps/house-hub/deploy/env.example /opt/apps/house-hub/.env && chmod 600 /opt/apps/house-hub/.env
   ```
3. **Optional: bring the existing data across.** Stop the server on basement1, then:
   ```bash
   scp data/house-hub.db wlaust3@pi5-server.local:/opt/apps/house-hub/data/
   ```
   Make `data/` on the Pi first (`mkdir -p /opt/apps/house-hub/data`). If you skip this, the app starts with the default household.
4. **Install, from basement1:** `deploy/deploy.sh --install v0.1.0`. This checks out the tag, runs `npm ci` and `npm run build`, installs the service and the Caddy site, restarts both, and checks `/api/health` through Caddy.
5. **Check it from a phone** on the home Wi-Fi at `http://house.lan`.

If `npm ci` fails while building `better-sqlite3`, the Pi needs `build-essential` and `python3`. That's a host install: ask sysmgr, and record it in the project notes.

## Updating

From basement1:

```bash
deploy/deploy.sh v0.2.0
```

It first makes a live copy of the database (`data/backup-<date>.db`), because new versions may change the data format. Then it checks out the tag, builds, and restarts.

**Rollback:** `deploy/deploy.sh <previous tag>`. If the newer version changed the data format, also stop the service, copy back the backup taken just before that deploy, and start it again.

## Outside access (Cloudflare)

This part is optional, and the dashboard works without it. Signed-in visitors reach the app through a Cloudflare Tunnel: the Pi connects *out* to Cloudflare, so the firewall needs no changes. The app checks Cloudflare's signed token on every request to port 3223, so even something on the Pi that reaches that port directly can't get in without a valid sign-in.

Cloudflare's dashboard menus move around. If a name below doesn't match exactly, look for the closest one.

You need a domain on Cloudflare: buy one through Cloudflare, or point an existing domain's nameservers at Cloudflare. The examples use `hub.example.com`.

1. **Zero Trust team.** Open Cloudflare → *Zero Trust* and pick a team name. Your team domain is `<team>.cloudflareaccess.com`. The free plan covers up to 50 users.
2. **Google sign-in.** In *Zero Trust → Settings → Authentication → Login methods → Add → Google*, Cloudflare shows the steps:
   - In Google Cloud Console, create a project, set up the OAuth consent screen (External), and create an *OAuth client ID* of type *Web application*.
   - Set the authorized redirect URI to `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`.
   - Paste the client ID and secret into Cloudflare, then use *Test* to check it.
3. **The tunnel.** *Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared*.
   - Installing `cloudflared` on the Pi is a host install, so **ask sysmgr** to install it as a service with the token Cloudflare shows.
   - Add a *public hostname*: `hub.example.com` → service **HTTP** `localhost:3223`. Use 3223, never 3222 or Caddy's port 80: those have no login.
4. **The Access application.** *Zero Trust → Access → Applications → Add → Self-hosted*.
   - Domain: `hub.example.com`. Login method: Google only.
   - Policy: **Allow**, *Include → Emails*: the household's Google addresses.
   - Save, then copy the application's **Audience (AUD) tag**.
5. **Tell the app.** In `/opt/apps/house-hub/.env`, uncomment and fill in:
   ```
   CF_ACCESS_TEAM=<team>.cloudflareaccess.com
   CF_ACCESS_AUD=<the AUD tag>
   ```
   Then run `sudo systemctl restart house-hub`. The log should say `Signed-in access for the tunnel on http://127.0.0.1:3223`.
6. **Add people.** On the dashboard, open **Settings → Household**, tap each person, and fill in **Google account** (only the housekeeper and adults can sign in). The email must be listed in both places:
   - **Cloudflare's policy** lets them reach the site.
   - **Settings** tells the app who they are.

   Someone allowed by Cloudflare but missing from Settings sees "Not set up yet".
7. **Check it:**
   - On the Pi, `curl -s localhost:3223/api/me` should return a sign-in error, not data.
   - From a phone on mobile data, `https://hub.example.com` should ask for Google sign-in and then open in that person's view.
   - To sign out, visit `https://hub.example.com/cdn-cgi/access/logout`.

## Google Calendar

This part is optional. Once it's connected:
- **Family calendars on the hub:** the calendars you pick in **Settings → Google Calendar** show on Home ("Family calendar", this week) and on the Calendar screen. In the Family view you can add, change and delete their events from the hub. Changing one day of a repeating event changes only that day.
- **Visit days in Google:** the hub creates a calendar called "Gladis's visits (House Hub)" and keeps the next 8 weeks of visit days in it as all-day events. You can share it with Falon or Gladis from Google Calendar.
- **Edits in Google flow back to the hub** within about a minute:
  - Delete a visit day → she's out that day.
  - Add an all-day event on another day → extra visit day.
  - Move an event → the old day is out and the new day is an extra day.
  - Edit an event's description → that day's note.
- **Changes made in the hub** reach Google within a few seconds.
- **Test mode** never touches Google.

One Google account is linked for the whole household. Use the account that owns (or can edit) the family calendars.

**Showing someone else's calendar, such as Falon's:** in Google Calendar, they share it with the linked account (*Settings → their calendar → Share with specific people*). Choose "See all event details" to only show it, or "Make changes to events" to also edit it from the hub. It then appears under **Settings → Google Calendar** in the hub, ready to tick. Anything shown is visible on the kitchen tablet, including in the housekeeper's view.

### 1. A Google Cloud OAuth client (once)

You can reuse the Google Cloud project made for Cloudflare's Google sign-in, if there is one.

1. In [Google Cloud Console](https://console.cloud.google.com/), select the project, go to *APIs & Services → Library*, and enable **Google Calendar API**.
2. Set up the *OAuth consent screen*:
   - User type **External**, with your email as the contact.
   - Add the scope `.../auth/calendar`.
   - Then **publish the app** (set *Publishing status* to *In production*). While it stays in "Testing", Google ends the hub's access every 7 days. You don't need Google to verify the app: you'll see an "unverified app" warning once, when you connect, and you can continue past it.
3. Go to *Credentials → Create credentials → OAuth client ID → Web application*. Add these authorized redirect URIs:
   - `http://localhost:3222/api/google/callback`, for connecting from basement1 (below).
   - `https://hub.example.com/api/google/callback`, if outside access is set up.
4. In `/opt/apps/house-hub/.env`, uncomment and fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Then run `sudo systemctl restart house-hub`.

### 2. Connect (once)

Google only sends people back to an `https` address or to `localhost`, so connecting doesn't work from `http://house.lan`. Use one of these:

- **From basement1:** run `ssh -L 3222:127.0.0.1:3222 wlaust3@pi5-server.local`, then open `http://localhost:3222/#/settings`.
- **Through outside access**, if it's set up: open `https://hub.example.com/#/settings`.

Then:
1. Switch to the Family view.
2. Tap **Connect Google Calendar** and sign in with the household Google account.
3. Tick the calendars to show, and tap **Save**.

Once connected, everything works from `house.lan` as usual. You only need to connect again if access is removed. Settings shows it when that happens.

**Disconnect** in Settings removes the hub's access and its copies of the family events. The visits calendar stays in Google, and you can delete it there.

## Backups

The whole database is one file. `deploy.sh` backs it up before every deploy. For a nightly copy that's safe while the app is running, add this with `crontab -e` on the Pi:

```
15 3 * * * cd /opt/apps/house-hub && /usr/bin/node -e 'new (require("better-sqlite3"))("data/house-hub.db",{readonly:true}).backup(process.argv[1])' "data/backup-$(date +\%a).db"
```

This keeps one copy per weekday, without installing the `sqlite3` tool. Once Google Calendar is connected, the database holds the hub's Google access, so keep the backups private. Keep a copy off the Pi too, for example on basement1 with `scp wlaust3@pi5-server.local:/opt/apps/house-hub/data/backup-*.db ~/house-hub-backups/`.

**Restore:**
1. `sudo systemctl stop house-hub`.
2. Copy the backup over `data/house-hub.db`, and delete any `house-hub.db-wal` or `-shm` files.
3. `sudo systemctl start house-hub`.
