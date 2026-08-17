#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate13-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-13-${REPO}}"
CREATE_HEADERS="$(mktemp /tmp/bittergit-gate-13-create-headers.XXXXXX)"
PAGE_HTML="$(mktemp /tmp/bittergit-gate-13-page-html.XXXXXX)"
WORKCELL_HEADERS="$(mktemp /tmp/bittergit-gate-13-workcell-headers.XXXXXX)"
RESTORE_HEADERS="$(mktemp /tmp/bittergit-gate-13-restore-headers.XXXXXX)"
ISSUE_JSON="$(mktemp /tmp/bittergit-gate-13-issue-json.XXXXXX)"
CHECKPOINT_JSON="$(mktemp /tmp/bittergit-gate-13-checkpoint-json.XXXXXX)"
DEPLOY_JSON="$(mktemp /tmp/bittergit-gate-13-deploy-json.XXXXXX)"
PR_JSON="$(mktemp /tmp/bittergit-gate-13-pr-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$WORKDIR"

curl -fsS -D "$CREATE_HEADERS" -o /tmp/bittergit-gate-13-create-body.html \
  -X POST "$BASE_URL/apps" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "owner=$OWNER" \
  --data-urlencode "name=$REPO"
rg "303" "$CREATE_HEADERS" >/dev/null
rg "Location: /apps/$OWNER/$REPO\\?created=1" "$CREATE_HEADERS" >/dev/null

git -c http.extraHeader="Authorization: Bearer $BOOTSTRAP_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"
git config user.email "gate13@bittergit.local"
git config user.name "BitterGit Gate 13"
git checkout main
echo "backstage proof" > backstage.txt
git add backstage.txt
git commit -m "Add backstage proof"
git -c http.extraHeader="Authorization: Bearer $BOOTSTRAP_TOKEN" push origin main
MAIN_SHA="$(git rev-parse HEAD)"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Backstage proof checkpoint","checkpoint_type":"ui_history"}' >"$CHECKPOINT_JSON"
CHECKPOINT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.id);' "$CHECKPOINT_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Gate 13 visible issue","body":"This issue should appear in the app surface."}' >"$ISSUE_JSON"
ISSUE_NUMBER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.issue.number);' "$ISSUE_JSON")"

git checkout -b issue-13-pr
echo "visible pull request" > pr-visible.txt
git add pr-visible.txt
git commit -m "Add visible PR file"
git -c http.extraHeader="Authorization: Bearer $BOOTSTRAP_TOKEN" push origin issue-13-pr

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/pull-requests" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Gate 13 visible pull request\",\"base_ref\":\"main\",\"head_ref\":\"issue-13-pr\",\"issue_number\":$ISSUE_NUMBER,\"require_verification\":false}" >"$PR_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/deployments" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"preview\",\"commit_sha\":\"$MAIN_SHA\",\"checkpoint_id\":\"$CHECKPOINT_ID\"}" >"$DEPLOY_JSON"
DEPLOYMENT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.deployment.id);' "$DEPLOY_JSON")"
RECEIPT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.receipt.id);' "$DEPLOY_JSON")"

curl -fsS "$BASE_URL/apps/$OWNER/$REPO" >"$PAGE_HTML"
for text in \
  "Backstage" \
  "Issues" \
  "Pull Requests" \
  "History" \
  "Deploys" \
  "Secrets" \
  "Settings" \
  "Open workcell" \
  "Restore" \
  "Gate 13 visible issue" \
  "Gate 13 visible pull request" \
  "Backstage proof checkpoint" \
  "$DEPLOYMENT_ID" \
  "$RECEIPT_ID" \
  "Import Source" \
  "Export Source" \
  "$BASE_URL/$OWNER/$REPO.git" \
  "No secret values stored"; do
  rg "$text" "$PAGE_HTML" >/dev/null
done

curl -fsS -D "$WORKCELL_HEADERS" -o /tmp/bittergit-gate-13-workcell-body.html \
  -X POST "$BASE_URL/apps/$OWNER/$REPO/workcells"
rg "303" "$WORKCELL_HEADERS" >/dev/null
rg "workcell=wc_" "$WORKCELL_HEADERS" >/dev/null

curl -fsS -D "$RESTORE_HEADERS" -o /tmp/bittergit-gate-13-restore-body.html \
  -X POST "$BASE_URL/apps/$OWNER/$REPO/checkpoints/$CHECKPOINT_ID/restore"
rg "303" "$RESTORE_HEADERS" >/dev/null
rg "restored=$CHECKPOINT_ID" "$RESTORE_HEADERS" >/dev/null

echo "Gate 13 smoke passed for app surface $BASE_URL/apps/$OWNER/$REPO"
