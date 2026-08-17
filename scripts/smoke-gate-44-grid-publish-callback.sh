#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate44-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate44-$$"
APP_NAME="gate44-app"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-44.XXXXXX)"
BUNDLE_JSON="$WORK_ROOT/bundle.json"
REQUEST_JSON="$WORK_ROOT/request.json"
SUCCESS_CALLBACK_JSON="$WORK_ROOT/success-callback.json"
FAILED_REQUEST_JSON="$WORK_ROOT/failed-request.json"
BAD_CALLBACK_JSON="$WORK_ROOT/bad-callback.json"
FAILED_CALLBACK_JSON="$WORK_ROOT/failed-callback.json"
LIST_JSON="$WORK_ROOT/list.json"
SUPPORT_JSON="$WORK_ROOT/support.json"
PRIVATE_LOG_SENTINEL="private_grid_log_gate44_should_not_leak"
GRID_RECEIPT_ID="grid_receipt_gate44_success"

ASSERTION="$(bun -e '
import { createHmac } from "node:crypto";
const payload = {
  iss: "factory.local",
  aud: "bittergit",
  sub: `account:${process.argv[1]}`,
  jti: `assertion-${process.argv[1]}-${Date.now()}`,
  kid: "factory-dev-key-1",
  authority_kind: "account_plan_assertion",
  account_ref: process.argv[1],
  workspace_ref: process.argv[2],
  plan_key: "one_app",
  plan_status: "active",
  included_apps: 1,
  github_required: false,
  secret_material_returned: false,
  source: "factory_assertion",
  asserted_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  hosted_workcell_limit: 1,
  monthly_hosted_run_limit: 100,
  storage_limit_mb: 512,
  mirror_export_allowed: true
};
const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const signature = createHmac("sha256", process.argv[3]).update(`bga2.${encoded}`).digest("hex");
console.log(`bga2.${encoded}.${signature}`);
' "$ACCOUNT_REF" "$WORKSPACE_REF" "$BOOTSTRAP_TOKEN")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$APP_NAME\"}" >"$BUNDLE_JSON"

APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$BUNDLE_JSON")"
OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$BUNDLE_JSON")"
REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$BUNDLE_JSON")"
READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$BUNDLE_JSON")"
COMMIT_SHA="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.checkpoint.commit_sha);' "$BUNDLE_JSON")"
CHECKPOINT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.checkpoint.id);' "$BUNDLE_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/grid-publish-requests" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"preview\",\"commit_sha\":\"$COMMIT_SHA\",\"checkpoint_id\":\"$CHECKPOINT_ID\",\"callback_mode\":true}" >"$REQUEST_JSON"

REQUEST_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.grid_publish.id);' "$REQUEST_JSON")"
GRID_OPERATION_REF="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.grid_publish.grid_operation_ref);' "$REQUEST_JSON")"

bun -e '
const publish = (await Bun.file(process.argv[1]).json()).grid_publish;
if (publish.status !== "awaiting_grid_callback") throw new Error("publish request was not awaiting Grid callback");
if (!publish.grid_operation_ref.startsWith("bittergrid://publish/")) throw new Error("Grid operation ref missing");
if (publish.preview_url !== null || publish.published_url !== null) throw new Error("publish URL existed before callback");
if (publish.verification_status !== null) throw new Error("verification existed before callback");
if (publish.callback_status !== "pending") throw new Error("callback pending status missing");
if (publish.commit_sha !== process.argv[2]) throw new Error("commit mismatch");
if (publish.checkpoint_id !== process.argv[3]) throw new Error("checkpoint mismatch");
' "$REQUEST_JSON" "$COMMIT_SHA" "$CHECKPOINT_ID"

curl -fsS -X POST "$BASE_URL/bittergit/v1/grid/publish-requests/$REQUEST_ID/callback" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"grid_operation_ref\":\"$GRID_OPERATION_REF\",\"commit_sha\":\"$COMMIT_SHA\",\"status\":\"verified\",\"published_url\":\"https://preview.gate44.bittergrid.local/$REQUEST_ID\",\"verification_status\":\"passed\",\"grid_receipt_id\":\"$GRID_RECEIPT_ID\"}" >"$SUCCESS_CALLBACK_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["private log", "stacktrace", "sk-", "bgt_"]) {
  if (text.includes(forbidden)) throw new Error(`success callback leaked ${forbidden}`);
}
const data = JSON.parse(text);
const publish = data.grid_publish;
if (publish.status !== "verified") throw new Error("callback did not verify publish");
if (publish.callback_status !== "verified") throw new Error("callback status missing");
if (publish.grid_receipt_id !== process.argv[2]) throw new Error("Grid receipt id missing");
if (publish.verification_status !== "passed") throw new Error("verification status missing");
if (!String(publish.published_url).includes("preview.gate44.bittergrid.local")) throw new Error("published URL missing");
if (publish.restore_candidate.checkpoint_id !== process.argv[3]) throw new Error("restore candidate missing");
if (data.receipt.receipt_type !== "grid_publish_callback") throw new Error("callback receipt missing");
if (data.receipt.body.grid_receipt_id !== process.argv[2]) throw new Error("callback receipt missing Grid receipt id");
if (data.receipt.body.private_logs_included !== false) throw new Error("callback receipt included private logs");
' "$SUCCESS_CALLBACK_JSON" "$GRID_RECEIPT_ID" "$CHECKPOINT_ID"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/grid-publish-requests" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"production\",\"commit_sha\":\"$COMMIT_SHA\",\"checkpoint_id\":\"$CHECKPOINT_ID\",\"callback_mode\":true}" >"$FAILED_REQUEST_JSON"

FAILED_REQUEST_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.grid_publish.id);' "$FAILED_REQUEST_JSON")"
FAILED_GRID_OPERATION_REF="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.grid_publish.grid_operation_ref);' "$FAILED_REQUEST_JSON")"

BAD_STATUS="$(curl -sS -o "$BAD_CALLBACK_JSON" -w "%{http_code}" -X POST "$BASE_URL/bittergit/v1/grid/publish-requests/$FAILED_REQUEST_ID/callback" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"grid_operation_ref\":\"$FAILED_GRID_OPERATION_REF\",\"commit_sha\":\"$COMMIT_SHA\",\"status\":\"failed\",\"private_logs\":\"$PRIVATE_LOG_SENTINEL\"}")"
test "$BAD_STATUS" = "422"
if rg "$PRIVATE_LOG_SENTINEL" "$BAD_CALLBACK_JSON"; then
  echo "Grid callback error leaked private logs" >&2
  exit 1
fi

curl -fsS -X POST "$BASE_URL/bittergit/v1/grid/publish-requests/$FAILED_REQUEST_ID/callback" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"grid_operation_ref\":\"$FAILED_GRID_OPERATION_REF\",\"commit_sha\":\"$COMMIT_SHA\",\"status\":\"failed\",\"verification_status\":\"failed\",\"grid_receipt_id\":\"grid_receipt_gate44_failed\"}" >"$FAILED_CALLBACK_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of [process.argv[2], "private log", "stacktrace", "sk-", "bgt_"]) {
  if (text.includes(forbidden)) throw new Error(`failed callback leaked ${forbidden}`);
}
const data = JSON.parse(text);
const publish = data.grid_publish;
if (publish.status !== "repair_required") throw new Error("failed callback was not repairable");
if (publish.callback_status !== "failed") throw new Error("failed callback status missing");
if (publish.verification_status !== "failed") throw new Error("failed callback verification missing");
if (!publish.repair_action.includes("BitterGrid callback reported")) throw new Error("failed callback repair missing");
if (publish.private_logs_included !== false) throw new Error("failed callback included private logs");
' "$FAILED_CALLBACK_JSON" "$PRIVATE_LOG_SENTINEL"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/grid-publish-requests" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$LIST_JSON"

bun -e '
const list = (await Bun.file(process.argv[1]).json()).grid_publish_requests;
if (!Array.isArray(list) || list.length !== 2) throw new Error("publish list length mismatch");
if (!list.some((entry) => entry.callback_status === "verified" && entry.grid_receipt_id === process.argv[2])) {
  throw new Error("verified callback missing from list");
}
if (!list.some((entry) => entry.callback_status === "failed" && entry.status === "repair_required")) {
  throw new Error("failed callback missing from list");
}
' "$LIST_JSON" "$GRID_RECEIPT_ID"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of [process.argv[4], "private log", "stacktrace", "SECRET", "sk_live_", "bgt_"]) {
  if (text.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
if (support.grid_publish_requests.length !== 2) throw new Error("support missing Grid callback requests");
if (!support.grid_publish_requests.some((entry) => entry.grid_receipt_id === process.argv[2] && entry.callback_status === "verified")) {
  throw new Error("support missing verified callback");
}
if (!support.grid_publish_requests.some((entry) => entry.callback_status === "failed" && entry.repair_action)) {
  throw new Error("support missing failed callback repair");
}
if (!support.receipts.some((receipt) => receipt.receipt_type === "grid_publish_callback" && receipt.body.commit_sha === process.argv[3] && receipt.body.grid_receipt_id === process.argv[2])) {
  throw new Error("support missing source-cited callback receipt");
}
if (!support.grid_publish_requests.some((entry) => entry.restore_candidate?.checkpoint_id === process.argv[5])) {
  throw new Error("support missing restore candidate");
}
' "$SUPPORT_JSON" "$GRID_RECEIPT_ID" "$COMMIT_SHA" "$PRIVATE_LOG_SENTINEL" "$CHECKPOINT_ID"

echo "Gate 44 smoke passed for Grid publish callback receipt intake on $OWNER/$REPO"
