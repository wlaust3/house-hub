# Hosting on a Raspberry Pi with outside access

House Hub runs on a Raspberry Pi at home. It answers on two ports:

| Port | Who uses it | Login |
|---|---|---|
| `3222` (all interfaces) | The family dashboard tablet on the home Wi-Fi | None. Anyone on the Wi-Fi gets in, with the "Who are you?" toggle as before |
| `3223` (this Pi only) | Phones away from home, through a Cloudflare Tunnel | Google sign-in via Cloudflare Access, **and** the email must belong to a household member |

On a personal phone the app knows who you are, so it opens in your view (Gladis → Housekeeper, adults → Family). The view toggle still works there, because the housekeeper may use the family view.

Nothing is port-forwarded. The Pi connects *out* to Cloudflare, and Cloudflare sends signed-in visitors back down that connection to port 3223. The app checks Cloudflare's signed token on every request, so even something on your network that reaches 3223 directly can't get in without a valid sign-in.

Cloudflare's dashboard menus move around. If a name below doesn't match exactly, look for the closest one.

## 1. The Pi

1. Flash **Raspberry Pi OS (64-bit) Lite**. Boot from an SSD or USB drive if you can: SQLite writes often, and SD cards wear out.
2. Set the hostname to `house-hub` (in Raspberry Pi Imager's settings, or with `sudo raspi-config`). Install Avahi so the tablet can use `house-hub.local`: `sudo apt install avahi-daemon`.
3. Give the Pi a fixed IP (a DHCP reservation in your router).
4. Node 20 or newer: `sudo apt install nodejs npm git`, then check `node -v`. If it is older than 20, install Node 20 from NodeSource instead. If `better-sqlite3` fails to install later, `sudo apt install build-essential python3` and retry.

## 2. The app

```bash
git clone https://github.com/wlaust3/house-hub.git ~/house-hub
cd ~/house-hub
npm ci
npm run build
cp deploy/env.example .env      # fill it in after step 3 (Cloudflare)
```

**Moving the existing data:** stop the old server, then copy `data/house-hub.db` (plus `-wal`/`-shm` if they exist) into `~/house-hub/data/` on the Pi.

**Run it as a service** (starts on boot, restarts if it crashes). Edit `User` and the paths in `deploy/house-hub.service` if your user isn't `bill`, then:

```bash
sudo cp deploy/house-hub.service /etc/systemd/system/
sudo systemctl enable --now house-hub
journalctl -u house-hub -f      # logs
```

The tablet now works at `http://house-hub.local:3222`.

## 3. Cloudflare

You need a domain on Cloudflare (buy one through Cloudflare, or point an existing domain's nameservers at Cloudflare). The examples use `hub.example.com`.

**a. Zero Trust team.** Open Cloudflare → *Zero Trust* and pick a team name. Your team domain is `<team>.cloudflareaccess.com`. The free plan covers up to 50 users.

**b. Google sign-in.** In *Zero Trust → Settings → Authentication → Login methods → Add → Google*, Cloudflare shows the steps:
- In Google Cloud Console, create a project, set up the OAuth consent screen (External), and create an *OAuth client ID* of type *Web application*.
- Set the authorized redirect URI to `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`.
- Paste the client ID and secret into Cloudflare, then use *Test* to check it.

**c. The tunnel.** *Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared*.
- Run the install command it shows on the Pi (`sudo cloudflared service install <token>`). That makes the tunnel a service too.
- Add a *public hostname*: `hub.example.com` → service **HTTP** `localhost:3223`. Use 3223, never 3222.

**d. The Access application.** *Zero Trust → Access → Applications → Add → Self-hosted*.
- Domain: `hub.example.com`. Login method: Google only.
- Policy: **Allow**, *Include → Emails*: the household's Google addresses.
- Save, then copy the application's **Audience (AUD) tag**.

**e. Tell the app.** Fill in `~/house-hub/.env`:

```
CF_ACCESS_TEAM=<team>.cloudflareaccess.com
CF_ACCESS_AUD=<the AUD tag>
```

Then run `sudo systemctl restart house-hub`. The log should say `Signed-in access for the tunnel on http://127.0.0.1:3223`. If either value is missing, port 3223 stays off.

## 4. Add people

On the dashboard, open **Settings → Household**, tap each person, and fill in **Google account** (only the housekeeper and adults can sign in). The email must be listed in both places:
- **Cloudflare's policy** lets them reach the site.
- **Settings** tells the app who they are.

Someone allowed by Cloudflare but missing from Settings sees "Not set up yet".

## 5. Check it

- On the Pi, `curl -s localhost:3223/api/me` should return a sign-in error, not data.
- From a phone on mobile data, `https://hub.example.com` should ask for Google sign-in and then open in that person's view.
- To sign out, visit `https://hub.example.com/cdn-cgi/access/logout`.

## Backups

The whole database is one file. Make a nightly copy with `crontab -e` (after `sudo apt install sqlite3`):

```
15 3 * * * mkdir -p ~/hub-backups && sqlite3 ~/house-hub/data/house-hub.db ".backup '$HOME/hub-backups/house-hub-$(date +\%a).db'"
```

This keeps one copy per weekday. Copy them off the Pi now and then, for example to a NAS or cloud drive.

## Updating

```bash
cd ~/house-hub && git pull && npm ci && npm run build && sudo systemctl restart house-hub
```
