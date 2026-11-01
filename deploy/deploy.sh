#!/usr/bin/env bash
# Deploy a tag of House Hub to pi5-server, from basement1. See docs/HOSTING.md.
#   deploy/deploy.sh v0.1.0             back up the data, check out the tag, build, restart
#   deploy/deploy.sh --install v0.1.0   first deploy: also clone, and install the unit and Caddy site
set -euo pipefail

PI=wlaust3@pi5-server.local
APP=/opt/apps/house-hub
REPO=https://github.com/wlaust3/house-hub.git

install=0
if [[ "${1:-}" == "--install" ]]; then install=1; shift; fi
tag="${1:?usage: deploy/deploy.sh [--install] <tag>}"

ssh "$PI" bash -s -- "$tag" "$install" "$APP" "$REPO" <<'REMOTE'
set -euo pipefail
tag=$1; install=$2; APP=$3; REPO=$4
if [[ ! -d "$APP/.git" ]]; then
  [[ "$install" == 1 ]] || { echo "$APP is not set up yet: run with --install"; exit 1; }
  sudo install -d -o wlaust3 -g wlaust3 "$APP"
  git clone "$REPO" "$APP"
fi
cd "$APP"
[[ -f .env ]] || { echo "Create $APP/.env first (from deploy/env.example, chmod 600)"; exit 1; }

# A live copy of the data before anything changes (new versions may migrate it).
if [[ -f data/house-hub.db && -d node_modules ]]; then
  node -e 'new (require("better-sqlite3"))("data/house-hub.db", { readonly: true }).backup(process.argv[1]).then(() => console.log("backup:", process.argv[1]))' \
    "data/backup-$(date +%F-%H%M).db"
fi

git fetch --tags --quiet
git checkout --quiet "$tag"
npm ci --no-audit --no-fund
npm run build

if [[ "$install" == 1 ]]; then
  sudo cp deploy/house-hub.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable house-hub
  sudo cp deploy/house-hub.caddy /etc/caddy/sites/
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo systemctl reload caddy
fi
sudo systemctl restart house-hub
sleep 2
systemctl is-active house-hub
REMOTE

echo "Checking http://house.lan through Caddy..."
curl -sf -H 'Host: house.lan' http://10.44.10.192/api/health && echo
