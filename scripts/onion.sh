#!/usr/bin/env bash
# Run the Soteria API as a Tor onion service so the server never sees a client
# IP. Start the API first (npm run dev:server), then this:
#
#   bash scripts/onion.sh
#
# Prints the .onion address to point the app at:
#   VITE_SOTERIA_SERVER=http://<addr>.onion
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v tor >/dev/null 2>&1; then
  echo "tor is not installed. Install it: brew install tor  |  apt-get install tor" >&2
  exit 1
fi

# Tor refuses to use a HiddenServiceDir / DataDirectory with loose permissions.
mkdir -p deploy/tor/hs deploy/tor/data
chmod 700 deploy/tor/hs deploy/tor/data

echo "Starting Tor onion service -> 127.0.0.1:${PORT:-8787} (Ctrl-C to stop)…"
tor -f deploy/tor/torrc &
TOR_PID=$!
trap 'kill "$TOR_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 30); do
  if [ -f deploy/tor/hs/hostname ]; then
    ADDR="$(cat deploy/tor/hs/hostname)"
    echo ""
    echo "  Onion address : http://${ADDR}"
    echo "  Point the app : VITE_SOTERIA_SERVER=http://${ADDR}"
    echo ""
    break
  fi
  sleep 1
done

wait "$TOR_PID"
