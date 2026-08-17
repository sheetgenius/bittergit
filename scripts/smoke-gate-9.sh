#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate9-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-9-${REPO}}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-9-create-json.XXXXXX)"
ISSUE_JSON="$(mktemp /tmp/bittergit-gate-9-issue-json.XXXXXX)"
ISSUE_TWO_JSON="$(mktemp /tmp/bittergit-gate-9-issue-two-json.XXXXXX)"
COMMENT_JSON="$(mktemp /tmp/bittergit-gate-9-comment-json.XXXXXX)"
AGENT_RUN_JSON="$(mktemp /tmp/bittergit-gate-9-agent-run-json.XXXXXX)"
CHECKPOINT_JSON="$(mktemp /tmp/bittergit-gate-9-checkpoint-json.XXXXXX)"
DEPLOY_JSON="$(mktemp /tmp/bittergit-gate-9-deploy-json.XXXXXX)"
CLOSE_JSON="$(mktemp /tmp/bittergit-gate-9-close-json.XXXXXX)"
GET_JSON="$(mktemp /tmp/bittergit-gate-9-get-json.XXXXXX)"
LIST_JSON="$(mktemp /tmp/bittergit-gate-9-list-json.XXXXXX)"
SECRET_ERROR="$(mktemp /tmp/bittergit-gate-9-secret-error.XXXXXX)"

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
  -d '{"title":"Add operator-facing setup note","body":"Explain first-run setup in the app docs.","external_provider":"github","external_id":"123"}' >"$ISSUE_JSON"
ISSUE_NUMBER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.issue.number);' "$ISSUE_JSON")"
test "$ISSUE_NUMBER" = "1"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Second issue proves repo scoped numbers"}' >"$ISSUE_TWO_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.issue.number !== 2) throw new Error("second issue did not receive number 2");
' "$ISSUE_TWO_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER/comments" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body":"Agent should create a short docs note and link the source evidence."}' >"$COMMENT_JSON"

if curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER/comments" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body":"do not store sk_live_1234567890abcdef here"}' >"$SECRET_ERROR" 2>&1; then
  echo "secret-bearing issue comment unexpectedly succeeded" >&2
  exit 1
fi
if rg 'sk_live_1234567890abcdef' "$SECRET_ERROR"; then
  echo "secret value leaked in issue rejection output" >&2
  exit 1
fi

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"
git config user.email "gate9@bittergit.local"
git config user.name "BitterGit Gate 9"
git checkout -b issue-1-add-doc
mkdir -p docs
echo "First-run setup lives here." > docs/setup.md
git add docs/setup.md
git commit -m "Add setup note for issue 1"
git -c http.extraHeader="Authorization: Bearer $WRITE_TOKEN" push origin issue-1-add-doc
BRANCH_SHA="$(git rev-parse HEAD)"
BRANCH_REF="refs/heads/issue-1-add-doc"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER/links" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"link_type\":\"branch\",\"target_ref\":\"$BRANCH_REF\"}" >/tmp/bittergit-gate-9-branch-link.json

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER/links" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"link_type\":\"commit\",\"target_sha\":\"$BRANCH_SHA\"}" >/tmp/bittergit-gate-9-commit-link.json

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER/agent-runs" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"run_id":"run_gate9","branch":"issue-1-add-doc","instruction":"Implement issue 1 with a docs setup note."}' >"$AGENT_RUN_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"label\":\"Issue 1 after agent run\",\"checkpoint_type\":\"after_agent_run\",\"ref\":\"$BRANCH_REF\"}" >"$CHECKPOINT_JSON"
CHECKPOINT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.id);' "$CHECKPOINT_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER/links" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"link_type\":\"checkpoint\",\"target_id\":\"$CHECKPOINT_ID\"}" >/tmp/bittergit-gate-9-checkpoint-link.json

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/deployments" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"preview\",\"commit_sha\":\"$BRANCH_SHA\",\"checkpoint_id\":\"$CHECKPOINT_ID\"}" >"$DEPLOY_JSON"
DEPLOYMENT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.deployment.id);' "$DEPLOY_JSON")"
RECEIPT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.receipt.id);' "$DEPLOY_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER/links" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"link_type\":\"deployment\",\"target_id\":\"$DEPLOYMENT_ID\"}" >/tmp/bittergit-gate-9-deployment-link.json

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER/links" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"link_type\":\"receipt\",\"target_id\":\"$RECEIPT_ID\",\"metadata\":{\"kind\":\"preview deploy receipt\"}}" >/tmp/bittergit-gate-9-receipt-link.json

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER/close" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"comment\":\"Issue complete with linked source and preview evidence.\",\"evidence\":[{\"link_type\":\"commit\",\"target_sha\":\"$BRANCH_SHA\",\"metadata\":{\"closing_evidence\":true}}]}" >"$CLOSE_JSON"

bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.issue.status !== "closed") throw new Error("issue was not closed");
if (data.issue.closed_by !== "main-token") throw new Error(`unexpected closed_by ${data.issue.closed_by}`);
' "$CLOSE_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER" \
  -H "Authorization: Bearer $READ_TOKEN" >"$GET_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const issue = data.issue;
if (issue.canonical.provider !== "bittergit") throw new Error("canonical issue provider was not BitterGit");
if (issue.external_provider !== "github" || issue.external_id !== "123") throw new Error("external issue projection fields missing");
if (issue.status !== "closed") throw new Error("issue detail was not closed");
if (issue.comments.length < 2) throw new Error("expected ordinary and closing comments");
const types = new Set(issue.links.map((link) => link.link_type));
for (const type of ["agent_run", "branch", "checkpoint", "commit", "deployment", "receipt"]) {
  if (!types.has(type)) throw new Error(`missing ${type} link`);
}
if (!issue.links.some((link) => link.link_type === "commit" && link.target_sha === process.argv[2])) {
  throw new Error("commit link did not cite branch SHA");
}
' "$GET_JSON" "$BRANCH_SHA"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues" \
  -H "Authorization: Bearer $READ_TOKEN" >"$LIST_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.issues.length !== 2) throw new Error("issue list did not include both issues");
const first = data.issues.find((issue) => issue.number === 1);
const second = data.issues.find((issue) => issue.number === 2);
if (!first || first.status !== "closed") throw new Error("first issue list entry wrong");
if (!second || second.status !== "open") throw new Error("second issue list entry wrong");
' "$LIST_JSON"

echo "Gate 9 smoke passed for issue #$ISSUE_NUMBER in $BASE_URL/$OWNER/$REPO.git"
