#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate5-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-5-${REPO}}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-5-create-json.XXXXXX)"

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

git config user.email "gate5@bittergit.local"
git config user.name "BitterGit Gate 5"
git checkout -B main

echo "before $(date -u +%Y-%m-%dT%H:%M:%SZ)" > app.txt
git add app.txt
git commit -m "Before checkpoint state"
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main
BEFORE_SHA="$(git rev-parse HEAD)"

BEFORE_JSON="$(mktemp /tmp/bittergit-gate-5-before-json.XXXXXX)"
NOOP_JSON="$(mktemp /tmp/bittergit-gate-5-noop-json.XXXXXX)"
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Before agent run","checkpoint_type":"before_agent_run"}' >"$BEFORE_JSON"
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Before agent run duplicate","checkpoint_type":"before_agent_run"}' >"$NOOP_JSON"

bun -e '
const first = await Bun.file(process.argv[1]).json();
const second = await Bun.file(process.argv[2]).json();
if (first.created !== true || second.created !== false || first.id !== second.id) {
  console.error("no-op checkpoint behavior failed");
  process.exit(1);
}
' "$BEFORE_JSON" "$NOOP_JSON"

echo "after $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> app.txt
git add app.txt
git commit -m "After checkpoint state"
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main
AFTER_SHA="$(git rev-parse HEAD)"

AFTER_JSON="$(mktemp /tmp/bittergit-gate-5-after-json.XXXXXX)"
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"After agent run","checkpoint_type":"after_agent_run"}' >"$AFTER_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Before deploy","checkpoint_type":"before_deploy"}' >/tmp/bittergit-gate-5-before-deploy.json
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"After deploy","checkpoint_type":"after_deploy"}' >/tmp/bittergit-gate-5-after-deploy.json

BEFORE_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.id);' "$BEFORE_JSON")"
AFTER_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.id);' "$AFTER_JSON")"

DIFF_JSON="$(mktemp /tmp/bittergit-gate-5-diff-json.XXXXXX)"
curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints/$BEFORE_ID/diff?to=$AFTER_ID" \
  -H "Authorization: Bearer $READ_TOKEN" >"$DIFF_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.diff_stat.includes("app.txt")) {
  console.error("checkpoint diff did not include changed file");
  process.exit(1);
}
' "$DIFF_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints" \
  -H "Authorization: Bearer $READ_TOKEN" >/tmp/bittergit-gate-5-checkpoints.json

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints/$BEFORE_ID/restore" \
  -H "Authorization: Bearer $MAIN_TOKEN" >/tmp/bittergit-gate-5-restore.json

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" fetch origin
REMOTE_MAIN="$(git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" ls-remote origin refs/heads/main | awk '{print $1}')"
if [ "$REMOTE_MAIN" != "$BEFORE_SHA" ]; then
  echo "restore did not reset main to checkpoint: expected $BEFORE_SHA got $REMOTE_MAIN" >&2
  exit 1
fi

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/events" \
  -H "Authorization: Bearer $READ_TOKEN" >/tmp/bittergit-gate-5-events.json
bun -e '
const events = (await Bun.file("/tmp/bittergit-gate-5-events.json").json()).events;
const before = process.argv[1];
const after = process.argv[2];
if (!events.some((event) => event.old_sha === after && event.new_sha === before && event.actor === "main-token")) {
  console.error("restore ref event not recorded");
  process.exit(1);
}
' "$BEFORE_SHA" "$AFTER_SHA"

echo "Gate 5 smoke passed for $BASE_URL/$OWNER/$REPO.git"
