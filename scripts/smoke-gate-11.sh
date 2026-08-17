#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate11-$(date -u +%Y%m%d%H%M%S)-$$}"
SEED_DIR="${BITTERGIT_EXTERNAL_SEED_DIR:-/tmp/bittergit-gate-11-${REPO}-seed}"
EXTERNAL_DIR="${BITTERGIT_EXTERNAL_DIR:-/tmp/bittergit-gate-11-${REPO}-external.git}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-11-create-json.XXXXXX)"
SOURCE_JSON="$(mktemp /tmp/bittergit-gate-11-source-json.XXXXXX)"
WORKCELL_JSON="$(mktemp /tmp/bittergit-gate-11-workcell-json.XXXXXX)"
EXTERNAL_PR_JSON="$(mktemp /tmp/bittergit-gate-11-external-pr-json.XXXXXX)"
RECEIPT_JSON="$(mktemp /tmp/bittergit-gate-11-receipt-json.XXXXXX)"
SYNC_JSON="$(mktemp /tmp/bittergit-gate-11-sync-json.XXXXXX)"
EVENTS_JSON="$(mktemp /tmp/bittergit-gate-11-events-json.XXXXXX)"
PRS_JSON="$(mktemp /tmp/bittergit-gate-11-prs-json.XXXXXX)"
REFS_JSON="$(mktemp /tmp/bittergit-gate-11-refs-json.XXXXXX)"
FAILED_SYNC_JSON="$(mktemp /tmp/bittergit-gate-11-failed-sync-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$SEED_DIR" "$EXTERNAL_DIR" "$EXTERNAL_DIR.offline"
mkdir -p "$SEED_DIR"
git -C "$SEED_DIR" init --initial-branch=main >/dev/null
git -C "$SEED_DIR" config user.email "external@bittergit.local"
git -C "$SEED_DIR" config user.name "External Canonical"
echo "external canonical source" > "$SEED_DIR/README.md"
git -C "$SEED_DIR" add README.md
git -C "$SEED_DIR" commit -m "Initial external source" >/dev/null
git init --bare --initial-branch=main "$EXTERNAL_DIR" >/dev/null
git -C "$SEED_DIR" remote add origin "$EXTERNAL_DIR"
git -C "$SEED_DIR" push origin main >/dev/null
INITIAL_EXTERNAL_SHA="$(git -C "$SEED_DIR" rev-parse HEAD)"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"
MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$CREATE_JSON")"
READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$CREATE_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/external-sources" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"github\",\"remote_url\":\"$EXTERNAL_DIR\",\"default_branch\":\"main\",\"credential_ref\":\"bitterpass://github/gate11\"}" >"$SOURCE_JSON"
SOURCE_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.external_source.id);' "$SOURCE_JSON")"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.external_source.canonical_source !== "external") throw new Error("source was not external canonical");
if (data.external_source.last_seen_default_sha !== process.argv[2]) throw new Error("initial external SHA missing");
if (data.external_source.credential_ref !== "bitterpass://github/gate11") throw new Error("credential_ref missing");
' "$SOURCE_JSON" "$INITIAL_EXTERNAL_SHA"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/external-sources/$SOURCE_ID/workcells" \
  -H "Authorization: Bearer $MAIN_TOKEN" >"$WORKCELL_JSON"
WORKCELL_PATH="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.workcell.checkout_path);' "$WORKCELL_JSON")"
ORIGIN_URL="$(git -C "$WORKCELL_PATH" remote get-url origin)"
test "$ORIGIN_URL" = "$EXTERNAL_DIR"
if echo "$ORIGIN_URL" | rg 'bgt_'; then
  echo "external workcell origin contained token material" >&2
  exit 1
fi

git -C "$WORKCELL_PATH" config user.email "gate11@bittergit.local"
git -C "$WORKCELL_PATH" config user.name "BitterGit Gate 11"
git -C "$WORKCELL_PATH" checkout -b issue-123-external
echo "external branch change" > "$WORKCELL_PATH/external-change.txt"
git -C "$WORKCELL_PATH" add external-change.txt
git -C "$WORKCELL_PATH" commit -m "Add external branch change" >/dev/null
git -C "$WORKCELL_PATH" push origin issue-123-external >/dev/null
EXTERNAL_HEAD_SHA="$(git -C "$WORKCELL_PATH" rev-parse HEAD)"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/external-sources/$SOURCE_ID/pull-requests" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"external_number":77,"title":"External PR proof","body":"Branch pushed to external canonical source.","base_ref":"main","head_ref":"issue-123-external","issue_external_id":"123","provider_url":"https://github.example.test/org/repo/pull/77"}' >"$EXTERNAL_PR_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const pr = data.pull_request;
if (pr.canonical.provider !== "external") throw new Error("external PR was not canonical external");
if (pr.external_number !== 77) throw new Error("external PR number wrong");
if (pr.head_sha !== process.argv[2]) throw new Error("external PR head SHA wrong");
if (pr.issue_external_id !== "123") throw new Error("external issue ID missing");
' "$EXTERNAL_PR_JSON" "$EXTERNAL_HEAD_SHA"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/external-sources/$SOURCE_ID/pull-requests/77/receipt" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"receipt_type":"external_preview","summary":"external PR preview verified"}' >"$RECEIPT_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const body = data.receipt.body;
if (body.external_number !== 77 || body.external_commit_sha !== process.argv[2]) {
  throw new Error("external receipt did not cite PR and commit");
}
' "$RECEIPT_JSON" "$EXTERNAL_HEAD_SHA"

git -C "$WORKCELL_PATH" checkout main
git -C "$WORKCELL_PATH" merge --ff-only issue-123-external
git -C "$WORKCELL_PATH" push origin main >/dev/null

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/external-sources/$SOURCE_ID/sync" \
  -H "Authorization: Bearer $MAIN_TOKEN" >"$SYNC_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.external_source.status !== "changed") throw new Error(`expected changed, got ${data.external_source.status}`);
if (data.external_source.last_seen_default_sha !== process.argv[2]) throw new Error("sync did not import external default SHA");
if (!data.event || data.event.old_sha !== process.argv[3] || data.event.new_sha !== process.argv[2]) {
  throw new Error("external ref update event missing old/new SHA");
}
' "$SYNC_JSON" "$EXTERNAL_HEAD_SHA" "$INITIAL_EXTERNAL_SHA"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/external-sources/$SOURCE_ID/events" \
  -H "Authorization: Bearer $READ_TOKEN" >"$EVENTS_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.events.some((event) => event.event_type === "external_ref_update" && event.new_sha === process.argv[2])) {
  throw new Error("external event list missing default branch update");
}
' "$EVENTS_JSON" "$EXTERNAL_HEAD_SHA"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/external-sources/$SOURCE_ID/pull-requests" \
  -H "Authorization: Bearer $READ_TOKEN" >"$PRS_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.pull_requests.some((pr) => pr.external_number === 77 && pr.receipt_id)) {
  throw new Error("external PR list missing receipt linkage");
}
' "$PRS_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/refs" \
  -H "Authorization: Bearer $READ_TOKEN" >"$REFS_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.refs.some((ref) => ref.sha === process.argv[2])) {
  throw new Error("external-primary sync mutated internal BitterGit repo refs");
}
' "$REFS_JSON" "$EXTERNAL_HEAD_SHA"

mv "$EXTERNAL_DIR" "$EXTERNAL_DIR.offline"
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/external-sources/$SOURCE_ID/sync" \
  -H "Authorization: Bearer $MAIN_TOKEN" >"$FAILED_SYNC_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.external_source.status !== "failed") throw new Error("failed provider sync was not visible");
if (data.external_source.last_seen_default_sha !== process.argv[2]) throw new Error("failed sync corrupted last seen SHA");
' "$FAILED_SYNC_JSON" "$EXTERNAL_HEAD_SHA"

echo "Gate 11 smoke passed for external-primary source $EXTERNAL_DIR"
