#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm check
pnpm test
pnpm build
mkdir -p .artifacts
stage=$(mktemp -d "$PWD/.artifacts/server.XXXXXXXX")
pnpm --filter kathrine deploy --prod --legacy "$stage"
# pnpm 11's legacy deploy leaves the source workspace state in production mode.
# Restore the development workspace before subsequent scripts verify dependencies.
CI=1 pnpm install --frozen-lockfile --prod=false
release="$(date -u +%Y%m%dT%H%M%SZ)-$$"
ssh -o BatchMode=yes ewaste "mkdir -p kathrine/releases/$release"
rsync -az "$stage/" "ewaste:kathrine/releases/$release/"
ssh -o BatchMode=yes ewaste bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release=$1
mkdir -p "$HOME/kathrine-data/downloads" "$HOME/.config/systemd/user"
chmod 700 "$HOME/kathrine-data"
if [ ! -f "$HOME/kathrine-data/server.env" ]; then
  cat > "$HOME/kathrine-data/server.env" <<EOF
KATHRINE_HOST=127.0.0.1
KATHRINE_PORT=8765
KATHRINE_HTTPS=true
KATHRINE_DATA=$HOME/kathrine-data
KATHRINE_VIDEO_TRANSCODE=false
KATHRINE_MAX_CONVERSIONS=1
KATHRINE_CACHE_GB=32
EOF
  chmod 600 "$HOME/kathrine-data/server.env"
fi
# Verify the private route without resetting other Serve handlers (such as /qb).
tailscale serve status --json | "$HOME/.local/bin/node" --input-type=module -e '
let text=""; for await (const chunk of process.stdin) text+=chunk;
const config=JSON.parse(text),site="ewaste.tail3123d8.ts.net:443";
if(config.TCP?.[443]?.HTTPS!==true || config.Web?.[site]?.Handlers?.["/"]?.Proxy!=="http://127.0.0.1:8765" || config.AllowFunnel?.[site]) {
  throw new Error("Configure private Tailscale Serve for Kathrine before deploying; public Funnel is not allowed.");
}
'
env_next=$(mktemp "$HOME/kathrine-data/server.env.XXXXXXXX")
awk '!/^(KATHRINE_HOST|KATHRINE_HTTPS)=/' "$HOME/kathrine-data/server.env" > "$env_next"
printf 'KATHRINE_HOST=127.0.0.1\nKATHRINE_HTTPS=true\n' >> "$env_next"
chmod 600 "$env_next"
mv -f -- "$env_next" "$HOME/kathrine-data/server.env"
ln -s "releases/$release" "$HOME/kathrine/current-next-$release"
mv -Tf "$HOME/kathrine/current-next-$release" "$HOME/kathrine/current"
cp "$HOME/kathrine/current/deploy/kathrine.service" "$HOME/.config/systemd/user/kathrine.service"
cd "$HOME/kathrine/current"
set -a
. "$HOME/kathrine-data/server.env"
set +a
"$HOME/.local/bin/node" scripts/import-libraries.mjs "$HOME/jellyfin/movies" "$HOME/jellyfin/tvshows"
if [ -d "$HOME/jellyfin/downloads" ]; then
  "$HOME/.local/bin/node" scripts/import-libraries.mjs --shows "$HOME/jellyfin/downloads"
fi
systemctl --user daemon-reload
systemctl --user enable kathrine.service
systemctl --user restart kathrine.service
curl --fail --silent --retry 8 --retry-delay 1 --retry-connrefused http://127.0.0.1:8765/api/health
REMOTE
for device in phone tv; do
  if [ -f ".artifacts/apks/kathrine-$device.apk" ]; then
    scp ".artifacts/apks/kathrine-$device.apk" "ewaste:kathrine-data/downloads/.kathrine-$device.apk-next"
    ssh -o BatchMode=yes ewaste "mv -f -- kathrine-data/downloads/.kathrine-$device.apk-next kathrine-data/downloads/kathrine-$device.apk"
  fi
done
printf '\nDeployed to Ewaste. Connect through Tailscale: https://ewaste.tail3123d8.ts.net · Direct LAN access is disabled.\n'
