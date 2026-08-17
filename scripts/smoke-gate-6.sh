#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate6-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-6-${REPO}}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-6-create-json.XXXXXX)"

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

git config user.email "gate6@bittergit.local"
git config user.name "BitterGit Gate 6"
git checkout -B main

echo "release one $(date -u +%Y-%m-%dT%H:%M:%SZ)" > release.txt
git add release.txt
git commit -m "Release one"
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main
FIRST_SHA="$(git rev-parse HEAD)"

FIRST_CHECKPOINT_JSON="$(mktemp /tmp/bittergit-gate-6-first-checkpoint-json.XXXXXX)"
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Release one checkpoint","checkpoint_type":"after_deploy"}' >"$FIRST_CHECKPOINT_JSON"
FIRST_CHECKPOINT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.id);' "$FIRST_CHECKPOINT_JSON")"

if curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/deployments" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"environment":"production"}'; then
  echo "deployment without commit_sha unexpectedly succeeded" >&2
  exit 1
fi

if curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/deployments" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"environment":"production","commit_sha":"0000000000000000000000000000000000000001"}'; then
  echo "deployment for unknown commit unexpectedly succeeded" >&2
  exit 1
fi

DEPLOY_JSON="$(mktemp /tmp/bittergit-gate-6-deploy-json.XXXXXX)"
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/deployments" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"production\",\"commit_sha\":\"$FIRST_SHA\",\"checkpoint_id\":\"$FIRST_CHECKPOINT_ID\"}" >"$DEPLOY_JSON"
DEPLOY_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.deployment.id);' "$DEPLOY_JSON")"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const expected = process.argv[2];
if (data.deployment.commit_sha !== expected || data.receipt.body.commit_sha !== expected) {
  console.error("deploy receipt did not cite commit");
  process.exit(1);
}
' "$DEPLOY_JSON" "$FIRST_SHA"

VERIFY_JSON="$(mktemp /tmp/bittergit-gate-6-verify-json.XXXXXX)"
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/deployments/$DEPLOY_ID/verification" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"passed","summary":"local proof verification"}' >"$VERIFY_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const expected = process.argv[2];
if (data.verification.commit_sha !== expected || data.verification.status !== "passed") {
  console.error("verification did not cite deployed commit");
  process.exit(1);
}
' "$VERIFY_JSON" "$FIRST_SHA"

echo "release two $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> release.txt
git add release.txt
git commit -m "Release two"
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main
SECOND_SHA="$(git rev-parse HEAD)"

SECOND_CHECKPOINT_JSON="$(mktemp /tmp/bittergit-gate-6-second-checkpoint-json.XXXXXX)"
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Release two checkpoint","checkpoint_type":"after_deploy"}' >"$SECOND_CHECKPOINT_JSON"
SECOND_CHECKPOINT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.id);' "$SECOND_CHECKPOINT_JSON")"
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/deployments" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"production\",\"commit_sha\":\"$SECOND_SHA\",\"checkpoint_id\":\"$SECOND_CHECKPOINT_ID\"}" >/tmp/bittergit-gate-6-second-deploy.json

ROLLBACK_JSON="$(mktemp /tmp/bittergit-gate-6-rollback-json.XXXXXX)"
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/deployments/rollback" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"production\",\"checkpoint_id\":\"$FIRST_CHECKPOINT_ID\",\"previous_commit_sha\":\"$SECOND_SHA\"}" >"$ROLLBACK_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const previous = process.argv[2];
const target = process.argv[3];
if (data.deployment.previous_commit_sha !== previous || data.deployment.commit_sha !== target) {
  console.error("rollback deployment did not cite previous and target commits");
  process.exit(1);
}
if (data.receipt.body.previous_commit_sha !== previous || data.receipt.body.rollback_commit_sha !== target) {
  console.error("rollback receipt did not cite previous and target commits");
  process.exit(1);
}
' "$ROLLBACK_JSON" "$SECOND_SHA" "$FIRST_SHA"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/receipts" \
  -H "Authorization: Bearer $READ_TOKEN" >/tmp/bittergit-gate-6-receipts.json

echo "Gate 6 smoke passed for $BASE_URL/$OWNER/$REPO.git"
