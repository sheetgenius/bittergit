#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate7-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-7-${REPO}}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-7-create-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$WORKDIR"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"

READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$CREATE_JSON")"
MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$CREATE_JSON")"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"

git config user.email "gate7@bittergit.local"
git config user.name "BitterGit Gate 7"
git checkout main

test -f .gitignore
echo "PASSWORD=local" > .env
if git status --short --ignored | rg '^[?][?] .env$'; then
  echo ".env was not ignored by starter .gitignore" >&2
  exit 1
fi

git add -f .env
git commit -m "Attempt env commit"
if git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main 2>/tmp/bittergit-gate-7-env-error.txt; then
  echo ".env push unexpectedly succeeded" >&2
  exit 1
fi
rg 'blocked unsafe source path .env' /tmp/bittergit-gate-7-env-error.txt >/dev/null

git reset --hard origin/main
echo "STRIPE_SECRET_KEY=sk_live_1234567890abcdef" > secret.txt
git add secret.txt
git commit -m "Attempt secret commit"
if git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main 2>/tmp/bittergit-gate-7-secret-error.txt; then
  echo "secret push unexpectedly succeeded" >&2
  exit 1
fi
rg 'blocked high-confidence secret' /tmp/bittergit-gate-7-secret-error.txt >/dev/null
if rg 'sk_live_1234567890abcdef' /tmp/bittergit-gate-7-secret-error.txt; then
  echo "secret value leaked in rejection output" >&2
  exit 1
fi

git reset --hard origin/main
echo "STRIPE_SECRET_KEY=sk_test_example" > .env.example
git add .env.example
git commit -m "Allow env example"
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main

echo "Gate 7 smoke passed for $BASE_URL/$OWNER/$REPO.git"
