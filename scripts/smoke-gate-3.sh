#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ROOT_DIR="$(pwd)"
DATA_ROOT="${BITTERGIT_DATA_ROOT:-$ROOT_DIR/.var/bittergit}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate3-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-3-${REPO}}"
CONTEXT_FILE="${BITTERGIT_GATE3_CONTEXT:-/tmp/bittergit-gate-3-context.env}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-3-create-json.XXXXXX)"
DUPLICATE_JSON="$(mktemp /tmp/bittergit-gate-3-duplicate-json.XXXXXX)"
REFS_JSON="$(mktemp /tmp/bittergit-gate-3-refs-json.XXXXXX)"
REPO_JSON="$(mktemp /tmp/bittergit-gate-3-repo-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$WORKDIR"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$DUPLICATE_JSON"

READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$CREATE_JSON")"
MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$CREATE_JSON")"
REPO_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.id);' "$CREATE_JSON")"

bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.existing !== true) {
  console.error("duplicate create did not report existing repo");
  process.exit(1);
}
if ("tokens" in data) {
  console.error("duplicate create unexpectedly returned fresh tokens");
  process.exit(1);
}
' "$DUPLICATE_JSON"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"

git config user.email "gate3@bittergit.local"
git config user.name "BitterGit Gate 3"
git checkout -B main

echo "durable $(date -u +%Y-%m-%dT%H:%M:%SZ)" > durable.txt
git add durable.txt
git commit -m "Add durable state"
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main

HEAD_SHA="$(git rev-parse HEAD)"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/refs" \
  -H "Authorization: Bearer $READ_TOKEN" >"$REFS_JSON"

bun -e '
const refs = (await Bun.file(process.argv[1]).json()).refs;
const expected = process.argv[2];
const main = refs.find((ref) => ref.ref === "refs/heads/main");
if (!main || main.sha !== expected) {
  console.error("refs endpoint did not report expected main SHA");
  process.exit(1);
}
' "$REFS_JSON" "$HEAD_SHA"

curl -fsS "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >/tmp/bittergit-gate-3-repos.json

REPO_PATH="$(find "$DATA_ROOT/repos" -type d -name "$REPO_ID.git" -print -quit)"
if [ -z "$REPO_PATH" ]; then
  echo "could not locate repo storage path for $REPO_ID" >&2
  exit 1
fi

mv "$REPO_PATH" "$REPO_PATH.missing"
curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO" \
  -H "Authorization: Bearer $READ_TOKEN" >"$REPO_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.storage_state !== "missing") {
  console.error(`expected storage_state=missing, got ${data.storage_state}`);
  process.exit(1);
}
' "$REPO_JSON"
mv "$REPO_PATH.missing" "$REPO_PATH"

cat >"$CONTEXT_FILE" <<EOF
BASE_URL="$BASE_URL"
OWNER="$OWNER"
REPO="$REPO"
READ_TOKEN="$READ_TOKEN"
BOOTSTRAP_TOKEN="$BOOTSTRAP_TOKEN"
HEAD_SHA="$HEAD_SHA"
EOF

echo "Gate 3 smoke passed for $BASE_URL/$OWNER/$REPO.git"
echo "Gate 3 context written to $CONTEXT_FILE"
