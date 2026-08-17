#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${BITTERGIT_GATE53_PORT:-17453}"
WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/bittergit-gate-53.XXXXXX")"
UNSAFE_LOG="$WORK_ROOT/unsafe.log"
SAFE_LOG="$WORK_ROOT/safe.log"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK_ROOT"
}
trap cleanup EXIT

cd "$ROOT_DIR"

if BITTERGIT_HOST=0.0.0.0 \
  BITTERGIT_PORT="$PORT" \
  BITTERGIT_DATA_ROOT="$WORK_ROOT/unsafe-data" \
  bun run src/server.ts >"$UNSAFE_LOG" 2>&1; then
  echo "unsafe non-loopback defaults unexpectedly started" >&2
  exit 1
fi
rg "unsafe non-loopback BitterGit configuration" "$UNSAFE_LOG" >/dev/null

NETWORK_TOKEN="$(bun -e 'console.log(crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""))')"
ASSERTION_SECRET="$(bun -e 'console.log(crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""))')"

BITTERGIT_HOST=0.0.0.0 \
BITTERGIT_PORT="$PORT" \
BITTERGIT_DATA_ROOT="$WORK_ROOT/safe-data" \
BITTERGIT_DEV_TOKEN="$NETWORK_TOKEN" \
BITTERGIT_ASSERTION_SECRET="$ASSERTION_SECRET" \
BITTERGIT_ENABLE_DEMO_UI=false \
bun run src/server.ts >"$SAFE_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$PORT/up" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

curl -fsS "http://127.0.0.1:$PORT/up" >/dev/null
ROOT_STATUS="$(curl -sS -o "$WORK_ROOT/root.json" -w '%{http_code}' "http://127.0.0.1:$PORT/")"
test "$ROOT_STATUS" = "404"
TERMINAL_STATUS="$(curl -sS -o "$WORK_ROOT/terminal.json" -w '%{http_code}' "http://127.0.0.1:$PORT/terminals/not-a-session")"
test "$TERMINAL_STATUS" = "401"
test -d "$WORK_ROOT/safe-data/imports"

echo "Gate 53 smoke passed for fail-closed public runtime safety"
