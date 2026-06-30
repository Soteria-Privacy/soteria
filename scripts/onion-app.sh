#!/usr/bin/env bash
# Serve the Soteria frontend as a Tor onion service, so the whole app — and
# every relayer request it makes — flows over Tor and never reveals a client IP.
#
# This is the client-side half of "relay over Tor": browsers can't fetch a
# .onion from a clearnet HTTPS page (mixed content / no Tor resolver), so the
# anonymous path is to open the app's own .onion mirror in Tor Browser, where
# both the app and the relayer (scripts/onion.sh) are onion services.
#
# Usage:
#   npm -w @soteria/app run build        # produce app/dist
#   bash scripts/onion-app.sh            # serve dist over Tor
#
# Prints the .onion address. Open it in Tor Browser, then set the relayer
# endpoint (privacy badge in the header) to the relayer's .onion.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${APP_PORT:-8088}"
DIST="app/dist"

if ! command -v tor >/dev/null 2>&1; then
  echo "tor is not installed. Install it: brew install tor  |  apt-get install tor" >&2
  exit 1
fi
if [ ! -d "$DIST" ]; then
  echo "No build at $DIST. Build first: npm -w @soteria/app run build" >&2
  exit 1
fi

# Static file server for the SPA (history-API fallback to index.html).
if command -v npx >/dev/null 2>&1; then
  npx --yes serve@14 -s "$DIST" -l "$PORT" >/dev/null 2>&1 &
elif command -v python3 >/dev/null 2>&1; then
  ( cd "$DIST" && python3 -m http.server "$PORT" >/dev/null 2>&1 ) &
else
  echo "Need npx (serve) or python3 to serve the static build." >&2
  exit 1
fi
SERVE_PID=$!

# Tor refuses a HiddenServiceDir / DataDirectory with loose permissions.
mkdir -p deploy/tor/hs-app deploy/tor/data-app
chmod 700 deploy/tor/hs-app deploy/tor/data-app

echo "Serving $DIST on 127.0.0.1:${PORT} and starting Tor onion (Ctrl-C to stop)…"
tor -f deploy/tor/torrc-app &
TOR_PID=$!
trap 'kill "$TOR_PID" "$SERVE_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 30); do
  if [ -f deploy/tor/hs-app/hostname ]; then
    ADDR="$(cat deploy/tor/hs-app/hostname)"
    echo ""
    echo "  App onion : http://${ADDR}"
    echo "  Open it in Tor Browser, then set the relayer endpoint to the"
    echo "  relayer's .onion (from scripts/onion.sh) via the header privacy badge."
    echo ""
    break
  fi
  sleep 1
done

wait "$TOR_PID"
