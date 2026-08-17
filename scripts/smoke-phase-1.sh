#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-hello-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-phase-1-${REPO}}"
CREATE_JSON="$(mktemp /tmp/bittergit-phase-1-create-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$WORKDIR"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"

READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$CREATE_JSON")"
MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$CREATE_JSON")"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"

git config user.email "phase1@bittergit.local"
git config user.name "BitterGit Phase 1"
git checkout -B main

echo "hello $(date -u +%Y-%m-%dT%H:%M:%SZ)" > hello.txt
git add hello.txt
git commit -m "Add hello"

if git -c http.extraHeader="Authorization: Bearer invalid-token" push origin main; then
  echo "invalid token push unexpectedly succeeded" >&2
  exit 1
fi

git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" fetch origin
git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" ls-remote origin >/tmp/bittergit-phase-1-ls-remote.txt

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/events" \
  -H "Authorization: Bearer $READ_TOKEN" >/tmp/bittergit-phase-1-events.json

test -s /tmp/bittergit-phase-1-ls-remote.txt
test -s /tmp/bittergit-phase-1-events.json

echo "Phase 1 smoke passed for $BASE_URL/$OWNER/$REPO.git"
