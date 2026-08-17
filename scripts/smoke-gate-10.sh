#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate10-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-10-${REPO}}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-10-create-json.XXXXXX)"
ISSUE_JSON="$(mktemp /tmp/bittergit-gate-10-issue-json.XXXXXX)"
PR_JSON="$(mktemp /tmp/bittergit-gate-10-pr-json.XXXXXX)"
PR_GET_JSON="$(mktemp /tmp/bittergit-gate-10-pr-get-json.XXXXXX)"
CHECKPOINT_JSON="$(mktemp /tmp/bittergit-gate-10-checkpoint-json.XXXXXX)"
DEPLOY_JSON="$(mktemp /tmp/bittergit-gate-10-deploy-json.XXXXXX)"
VERIFY_JSON="$(mktemp /tmp/bittergit-gate-10-verify-json.XXXXXX)"
MERGE_JSON="$(mktemp /tmp/bittergit-gate-10-merge-json.XXXXXX)"
EVENTS_JSON="$(mktemp /tmp/bittergit-gate-10-events-json.XXXXXX)"
ISSUE_GET_JSON="$(mktemp /tmp/bittergit-gate-10-issue-get-json.XXXXXX)"
CLOSE_PR_JSON="$(mktemp /tmp/bittergit-gate-10-close-pr-json.XXXXXX)"
PRS_JSON="$(mktemp /tmp/bittergit-gate-10-prs-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$WORKDIR"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"

READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$CREATE_JSON")"
WRITE_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.write_token);' "$CREATE_JSON")"
MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$CREATE_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Add pull request proof file","body":"Use a branch and PR before main changes."}' >"$ISSUE_JSON"
ISSUE_NUMBER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.issue.number);' "$ISSUE_JSON")"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"
git config user.email "gate10@bittergit.local"
git config user.name "BitterGit Gate 10"
git checkout -b issue-1-pr
mkdir -p docs
echo "Pull request proof." > docs/pr.md
git add docs/pr.md
git commit -m "Add pull request proof file"
git -c http.extraHeader="Authorization: Bearer $WRITE_TOKEN" push origin issue-1-pr
HEAD_SHA="$(git rev-parse HEAD)"
BASE_SHA="$(git rev-parse main)"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/pull-requests" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Add pull request proof file\",\"body\":\"Implements issue #$ISSUE_NUMBER.\",\"base_ref\":\"main\",\"head_ref\":\"issue-1-pr\",\"issue_number\":$ISSUE_NUMBER,\"require_verification\":true}" >"$PR_JSON"
PR_NUMBER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.pull_request.number);' "$PR_JSON")"
test "$PR_NUMBER" = "1"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const pr = data.pull_request;
if (pr.status !== "open") throw new Error("PR was not open");
if (!pr.diff_stat.includes("docs/pr.md")) throw new Error("PR diff did not include docs/pr.md");
if (!pr.commits.some((commit) => commit.sha === process.argv[2])) throw new Error("PR commits did not include head SHA");
if (pr.base_sha !== process.argv[3] || pr.head_sha !== process.argv[2]) throw new Error("PR source SHAs wrong");
' "$PR_JSON" "$HEAD_SHA" "$BASE_SHA"

if curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/pull-requests/$PR_NUMBER/merge" \
  -H "Authorization: Bearer $MAIN_TOKEN" > /tmp/bittergit-gate-10-merge-before-verification.json 2>&1; then
  echo "PR merge unexpectedly succeeded before verification" >&2
  exit 1
fi

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"PR 1 verified head","checkpoint_type":"pull_request_verification","ref":"refs/heads/issue-1-pr"}' >"$CHECKPOINT_JSON"
CHECKPOINT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.id);' "$CHECKPOINT_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/deployments" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"preview\",\"commit_sha\":\"$HEAD_SHA\",\"checkpoint_id\":\"$CHECKPOINT_ID\"}" >"$DEPLOY_JSON"
DEPLOYMENT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.deployment.id);' "$DEPLOY_JSON")"
RECEIPT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.receipt.id);' "$DEPLOY_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/pull-requests/$PR_NUMBER/verification" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"passed\",\"summary\":\"local PR verification passed\",\"preview_url\":\"https://preview.example.test/pr-$PR_NUMBER\",\"deployment_id\":\"$DEPLOYMENT_ID\",\"receipt_id\":\"$RECEIPT_ID\"}" >"$VERIFY_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const pr = data.pull_request;
if (pr.verification_status !== "passed") throw new Error("verification status was not passed");
if (pr.deployment_id !== process.argv[2] || pr.receipt_id !== process.argv[3]) throw new Error("PR did not retain deploy receipt evidence");
if (!pr.preview_url.includes("preview.example.test")) throw new Error("preview URL missing");
' "$VERIFY_JSON" "$DEPLOYMENT_ID" "$RECEIPT_ID"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/pull-requests/$PR_NUMBER/merge" \
  -H "Authorization: Bearer $MAIN_TOKEN" >"$MERGE_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const pr = data.pull_request;
const merge = data.merge;
if (pr.status !== "merged") throw new Error("PR did not merge");
if (pr.merge_method !== "fast_forward") throw new Error("unexpected merge method");
if (merge.old_base_sha !== process.argv[2] || merge.head_sha !== process.argv[3] || merge.new_base_sha !== process.argv[3]) {
  throw new Error("merge record did not preserve old base/head/new base");
}
if (merge.actor !== "main-token") throw new Error("merge actor wrong");
' "$MERGE_JSON" "$BASE_SHA" "$HEAD_SHA"

REMOTE_MAIN="$(git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" ls-remote origin refs/heads/main | awk '{print $1}')"
test "$REMOTE_MAIN" = "$HEAD_SHA"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/events" \
  -H "Authorization: Bearer $READ_TOKEN" >"$EVENTS_JSON"
bun -e '
const events = (await Bun.file(process.argv[1]).json()).events;
if (!events.some((event) => event.ref === "refs/heads/main" && event.old_sha === process.argv[2] && event.new_sha === process.argv[3] && event.actor === "main-token")) {
  throw new Error("PR merge ref event missing");
}
' "$EVENTS_JSON" "$BASE_SHA" "$HEAD_SHA"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER" \
  -H "Authorization: Bearer $READ_TOKEN" >"$ISSUE_GET_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.issue.links.some((link) => link.link_type === "pull_request" && link.target_id === process.argv[2])) {
  throw new Error("linked issue did not record pull request");
}
' "$ISSUE_GET_JSON" "$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.pull_request.id);' "$PR_JSON")"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" fetch origin
git checkout -b issue-1-close-pr origin/main
echo "Closed PR proof." > docs/closed-pr.md
git add docs/closed-pr.md
git commit -m "Add closed PR proof file"
git -c http.extraHeader="Authorization: Bearer $WRITE_TOKEN" push origin issue-1-close-pr

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/pull-requests" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Closed PR proof\",\"base_ref\":\"main\",\"head_ref\":\"issue-1-close-pr\",\"issue_number\":$ISSUE_NUMBER,\"require_verification\":false}" >"$PR_GET_JSON"
CLOSE_PR_NUMBER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.pull_request.number);' "$PR_GET_JSON")"
test "$CLOSE_PR_NUMBER" = "2"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/pull-requests/$CLOSE_PR_NUMBER/close" \
  -H "Authorization: Bearer $MAIN_TOKEN" >"$CLOSE_PR_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.pull_request.status !== "closed") throw new Error("PR close failed");
if (data.pull_request.closed_by !== "main-token") throw new Error("PR close actor wrong");
' "$CLOSE_PR_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/pull-requests" \
  -H "Authorization: Bearer $READ_TOKEN" >"$PRS_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.pull_requests.length !== 2) throw new Error("PR list did not include both PRs");
if (!data.pull_requests.some((pr) => pr.number === 1 && pr.status === "merged")) throw new Error("merged PR missing from list");
if (!data.pull_requests.some((pr) => pr.number === 2 && pr.status === "closed")) throw new Error("closed PR missing from list");
' "$PRS_JSON"

echo "Gate 10 smoke passed for PR #$PR_NUMBER in $BASE_URL/$OWNER/$REPO.git"
