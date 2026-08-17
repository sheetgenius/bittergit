#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${BITTERGIT_VERIFY_PORT:-17420}"
WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/bittergit-verify.XXXXXX")"
DATA_ROOT="$WORK_ROOT/data"
SERVER_LOG="$WORK_ROOT/server.log"
SERVER_PID=""

stop_server() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  SERVER_PID=""
}

cleanup() {
  stop_server
  rm -rf "$WORK_ROOT"
}
trap cleanup EXIT

start_server() {
  BITTERGIT_HOST=127.0.0.1 \
  BITTERGIT_PORT="$PORT" \
  BITTERGIT_DATA_ROOT="$DATA_ROOT" \
  BITTERGIT_RATE_LIMIT_PER_MINUTE=100000 \
  bun run src/server.ts >"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!

  for _ in $(seq 1 100); do
    if curl -fsS "http://127.0.0.1:$PORT/up" >/dev/null 2>&1; then
      return
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      tail -100 "$SERVER_LOG" >&2
      return 1
    fi
    sleep 0.1
  done

  tail -100 "$SERVER_LOG" >&2
  echo "BitterGit verification server did not become ready" >&2
  return 1
}

cd "$ROOT_DIR"

if curl -fsS "http://127.0.0.1:$PORT/up" >/dev/null 2>&1; then
  echo "verification port $PORT is already in use; set BITTERGIT_VERIFY_PORT" >&2
  exit 1
fi

export BITTERGIT_BASE_URL="http://127.0.0.1:$PORT"
export BITTERGIT_DATA_ROOT="$DATA_ROOT"

start_server
scripts/smoke-all.sh
stop_server

start_server
scripts/smoke-gate-3-post-restart.sh
stop_server

echo "BitterGit isolated verification passed"
