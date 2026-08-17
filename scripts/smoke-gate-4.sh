#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate4-$(date -u +%Y%m%d%H%M%S)-$$}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-4-create-json.XXXXXX)"
WORKCELL_JSON="$(mktemp /tmp/bittergit-gate-4-workcell-json.XXXXXX)"
SEED_DIR="${BITTERGIT_SEED_DIR:-/tmp/bittergit-gate-4-seed-${REPO}}"

export GIT_TERMINAL_PROMPT=0

rm -rf "$SEED_DIR"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"

READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$CREATE_JSON")"
MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$CREATE_JSON")"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$SEED_DIR"
cd "$SEED_DIR"
git config user.email "gate4@bittergit.local"
git config user.name "BitterGit Gate 4"
git checkout -B main
echo "seed $(date -u +%Y-%m-%dT%H:%M:%SZ)" > seed.txt
git add seed.txt
git commit -m "Seed main"
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main

curl -fsS -X POST "$BASE_URL/bittergit/v1/workcells" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$WORKCELL_JSON"

WORKCELL_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.id);' "$WORKCELL_JSON")"
CHECKOUT_PATH="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.checkout_path);' "$WORKCELL_JSON")"

git -C "$CHECKOUT_PATH" remote -v >/tmp/bittergit-gate-4-remotes.txt
if rg 'bgt_|dev-token|Bearer' /tmp/bittergit-gate-4-remotes.txt; then
  echo "remote contains token material" >&2
  exit 1
fi

git -C "$CHECKOUT_PATH" fetch origin
git -C "$CHECKOUT_PATH" checkout -B issue-4 origin/main
echo "workcell $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$CHECKOUT_PATH/workcell.txt"
git -C "$CHECKOUT_PATH" add workcell.txt
git -C "$CHECKOUT_PATH" -c user.email="gate4@bittergit.local" -c user.name="BitterGit Gate 4" commit -m "Workcell branch change"
git -C "$CHECKOUT_PATH" push origin issue-4

git -C "$CHECKOUT_PATH" checkout main
echo "blocked $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$CHECKOUT_PATH/seed.txt"
git -C "$CHECKOUT_PATH" add seed.txt
git -C "$CHECKOUT_PATH" -c user.email="gate4@bittergit.local" -c user.name="BitterGit Gate 4" commit -m "Attempt protected main"
if git -C "$CHECKOUT_PATH" push origin main; then
  echo "workcell token unexpectedly pushed protected main" >&2
  exit 1
fi

curl -fsS -X POST "$BASE_URL/bittergit/v1/workcells/$WORKCELL_ID/revoke" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >/tmp/bittergit-gate-4-revoked.json

git -C "$CHECKOUT_PATH" checkout -B issue-4-revoked
echo "revoked $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$CHECKOUT_PATH/revoked.txt"
git -C "$CHECKOUT_PATH" add revoked.txt
git -C "$CHECKOUT_PATH" -c user.email="gate4@bittergit.local" -c user.name="BitterGit Gate 4" commit -m "Attempt revoked token push"
if git -C "$CHECKOUT_PATH" push origin issue-4-revoked; then
  echo "revoked workcell token unexpectedly pushed" >&2
  exit 1
fi

echo "Gate 4 smoke passed for workcell $WORKCELL_ID at $CHECKOUT_PATH"
