#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate17-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-17-${REPO}}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-17-create-json.XXXXXX)"
ISSUE_JSON="$(mktemp /tmp/bittergit-gate-17-issue-json.XXXXXX)"
PR_JSON="$(mktemp /tmp/bittergit-gate-17-pr-json.XXXXXX)"
VERIFY_JSON="$(mktemp /tmp/bittergit-gate-17-verify-json.XXXXXX)"
PROJECTION_JSON="$(mktemp /tmp/bittergit-gate-17-projection-json.XXXXXX)"
PROJECT_ISSUE_JSON="$(mktemp /tmp/bittergit-gate-17-project-issue-json.XXXXXX)"
PROJECT_PR_JSON="$(mktemp /tmp/bittergit-gate-17-project-pr-json.XXXXXX)"
COMMENT_JSON="$(mktemp /tmp/bittergit-gate-17-comment-json.XXXXXX)"
DUPLICATE_COMMENT_JSON="$(mktemp /tmp/bittergit-gate-17-duplicate-comment-json.XXXXXX)"
EDIT_JSON="$(mktemp /tmp/bittergit-gate-17-edit-json.XXXXXX)"
SYNC_JSON="$(mktemp /tmp/bittergit-gate-17-sync-json.XXXXXX)"
DETAIL_JSON="$(mktemp /tmp/bittergit-gate-17-detail-json.XXXXXX)"

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
  -d '{"title":"Project issue to GitHub","body":"Projected issue should name Bitter as canonical."}' >"$ISSUE_JSON"
ISSUE_NUMBER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.issue.number);' "$ISSUE_JSON")"
ISSUE_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.issue.id);' "$ISSUE_JSON")"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"
git config user.email "gate17@bittergit.local"
git config user.name "BitterGit Gate 17"
git checkout -b issue-17-projection
mkdir -p docs
echo "Workflow projection proof." > docs/projection.md
git add docs/projection.md
git commit -m "Add workflow projection proof"
git -c http.extraHeader="Authorization: Bearer $WRITE_TOKEN" push origin issue-17-projection

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/pull-requests" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Project PR to GitHub\",\"body\":\"Projected PR should stay Bitter-canonical.\",\"base_ref\":\"main\",\"head_ref\":\"issue-17-projection\",\"issue_number\":$ISSUE_NUMBER,\"require_verification\":true}" >"$PR_JSON"
PR_NUMBER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.pull_request.number);' "$PR_JSON")"
PR_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.pull_request.id);' "$PR_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/pull-requests/$PR_NUMBER/verification" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"passed","summary":"projection verification passed","preview_url":"https://preview.example.test/gate-17"}' >"$VERIFY_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/workflow-projections" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"github\",\"remote_url\":\"https://github.com/example/$REPO\"}" >"$PROJECTION_JSON"
PROJECTION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.projection.id);' "$PROJECTION_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/workflow-projections/$PROJECTION_ID/issues/$ISSUE_NUMBER" \
  -H "Authorization: Bearer $MAIN_TOKEN" >"$PROJECT_ISSUE_JSON"
ISSUE_EXTERNAL_NUMBER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.projected_issue.external_number);' "$PROJECT_ISSUE_JSON")"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const projected = data.projected_issue;
if (projected.canonical.issue_id !== process.argv[2]) throw new Error("canonical Bitter issue id missing");
if (projected.external.canonical !== false) throw new Error("external issue number was marked canonical");
if (!projected.external_body.includes("Source of truth: Bitter")) throw new Error("issue projection does not name Bitter source of truth");
if (!projected.external_body.includes(`<!-- bitter:issue_id=${process.argv[2]} -->`)) throw new Error("issue projection missing canonical marker");
' "$PROJECT_ISSUE_JSON" "$ISSUE_ID"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/workflow-projections/$PROJECTION_ID/pull-requests/$PR_NUMBER" \
  -H "Authorization: Bearer $MAIN_TOKEN" >"$PROJECT_PR_JSON"
PR_EXTERNAL_NUMBER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.projected_pull_request.external_number);' "$PROJECT_PR_JSON")"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const projected = data.projected_pull_request;
if (projected.canonical.pull_request_id !== process.argv[2]) throw new Error("canonical Bitter PR id missing");
if (projected.external.canonical !== false) throw new Error("external PR number was marked canonical");
if (!projected.external_body.includes("Default merge path: BitterGit")) throw new Error("PR projection missing canonical merge path");
if (!projected.external_body.includes("GitHub merge button is not canonical")) throw new Error("PR projection missing GitHub merge warning");
if (!projected.external_body.includes("Preview deploy: https://preview.example.test/gate-17")) throw new Error("PR projection missing preview evidence");
if (!projected.external_body.includes(`<!-- bitter:pull_request_id=${process.argv[2]} -->`)) throw new Error("PR projection missing canonical marker");
' "$PROJECT_PR_JSON" "$PR_ID"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/workflow-projections/$PROJECTION_ID/comments" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"subject_type\":\"pull_request\",\"subject_number\":$PR_EXTERNAL_NUMBER,\"transition\":\"pull_request_opened\",\"summary\":\"Projected PR opened for review.\"}" >"$COMMENT_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.created !== true) throw new Error("first projection comment was not created");
if (!data.comment.body.includes("Bitter transition: pull_request_opened")) throw new Error("projection comment missing transition");
' "$COMMENT_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/workflow-projections/$PROJECTION_ID/comments" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"subject_type\":\"pull_request\",\"subject_number\":$PR_EXTERNAL_NUMBER,\"transition\":\"pull_request_opened\",\"summary\":\"Duplicate should stay quiet.\"}" >"$DUPLICATE_COMMENT_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.created !== false) throw new Error("duplicate projection comment was not suppressed");
' "$DUPLICATE_COMMENT_JSON"

INVALID_TRANSITION_STATUS="$(curl -sS -o /tmp/bittergit-gate-17-invalid-transition.json -w "%{http_code}" \
  -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/workflow-projections/$PROJECTION_ID/comments" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"subject_type\":\"issue\",\"subject_number\":$ISSUE_EXTERNAL_NUMBER,\"transition\":\"file_changed\",\"summary\":\"Too noisy.\"}")"
test "$INVALID_TRANSITION_STATUS" = "422"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/workflow-projections/$PROJECTION_ID/projected-issues/$ISSUE_EXTERNAL_NUMBER/external-edit" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body":"Edited directly on GitHub without the Bitter canonical marker."}' >"$EDIT_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/workflow-projections/$PROJECTION_ID/sync" \
  -H "Authorization: Bearer $MAIN_TOKEN" >"$SYNC_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.divergent < 1) throw new Error("direct external edit was not marked divergent");
if (data.projection.status !== "diverged") throw new Error("projection status was not diverged");
' "$SYNC_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/workflow-projections/$PROJECTION_ID" \
  -H "Authorization: Bearer $READ_TOKEN" >"$DETAIL_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const projection = data.projection;
if (projection.policy.github_numbers_canonical !== false) throw new Error("projection policy allowed GitHub numbers as canonical");
if (projection.policy.default_merge_path !== "bittergit") throw new Error("projection did not keep BitterGit as default merge path");
if (projection.comments.length !== 1) throw new Error("projection comments were too noisy");
if (!projection.projected_issues.some((issue) => issue.divergence_status === "diverged")) {
  throw new Error("projected issue divergence missing from detail");
}
' "$DETAIL_JSON"

echo "Gate 17 smoke passed for workflow projection $PROJECTION_ID"
