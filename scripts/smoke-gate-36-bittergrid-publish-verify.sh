#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate36-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate36-$$"
APP_NAME="gate36-app"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-36.XXXXXX)"
BUNDLE_JSON="$WORK_ROOT/bundle.json"
PREVIEW_JSON="$WORK_ROOT/preview.json"
PRODUCTION_JSON="$WORK_ROOT/production.json"
FAILED_JSON="$WORK_ROOT/failed.json"
LIST_JSON="$WORK_ROOT/list.json"
SUPPORT_JSON="$WORK_ROOT/support.json"

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
  -d "{\"environment\":\"preview\",\"commit_sha\":\"$COMMIT_SHA\",\"checkpoint_id\":\"$CHECKPOINT_ID\",\"verification_status\":\"passed\"}" >"$PREVIEW_JSON"

bun -e '
const publish = (await Bun.file(process.argv[1]).json()).grid_publish;
if (publish.status !== "verified") throw new Error("preview publish was not verified");
if (publish.owner_plane !== "BitterGrid") throw new Error("owner plane mismatch");
if (publish.bittergit_role !== "source_custody_recorder") throw new Error("BitterGit role mismatch");
if (publish.commit_sha !== process.argv[2]) throw new Error("preview commit mismatch");
if (publish.checkpoint_id !== process.argv[3]) throw new Error("preview checkpoint mismatch");
if (publish.verification_status !== "passed") throw new Error("preview verification mismatch");
if (!String(publish.preview_url).includes("preview.bittergrid.local")) throw new Error("preview URL missing");
if (publish.private_logs_included !== false) throw new Error("private logs were included");
if (publish.restore_candidate.checkpoint_id !== process.argv[3]) throw new Error("restore candidate missing checkpoint");
' "$PREVIEW_JSON" "$COMMIT_SHA" "$CHECKPOINT_ID"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/grid-publish-requests" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"production\",\"commit_sha\":\"$COMMIT_SHA\",\"checkpoint_id\":\"$CHECKPOINT_ID\",\"verification_status\":\"passed\"}" >"$PRODUCTION_JSON"

bun -e '
const publish = (await Bun.file(process.argv[1]).json()).grid_publish;
if (publish.environment !== "production") throw new Error("production environment mismatch");
if (publish.status !== "verified") throw new Error("production publish was not verified");
if (publish.commit_sha !== process.argv[2]) throw new Error("production commit mismatch");
if (publish.restore_candidate.restore_supported !== true) throw new Error("production restore candidate missing");
' "$PRODUCTION_JSON" "$COMMIT_SHA"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/grid-publish-requests" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"preview\",\"commit_sha\":\"$COMMIT_SHA\",\"checkpoint_id\":\"$CHECKPOINT_ID\",\"simulate_status\":\"failed\"}" >"$FAILED_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("private log") || text.includes("stacktrace") || text.includes("bgt_")) {
  throw new Error("failed publish leaked private material");
}
const publish = JSON.parse(text).grid_publish;
if (publish.status !== "repair_required") throw new Error("failed publish was not repairable");
if (!publish.repair_action.includes("BitterGrid publish failed")) throw new Error("failed publish repair action missing");
if (publish.private_logs_included !== false) throw new Error("failed publish included private logs");
' "$FAILED_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/grid-publish-requests" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$LIST_JSON"
bun -e '
const list = (await Bun.file(process.argv[1]).json()).grid_publish_requests;
if (!Array.isArray(list) || list.length !== 3) throw new Error("publish list length mismatch");
if (!list.some((entry) => entry.environment === "production" && entry.status === "verified")) throw new Error("production publish missing from list");
if (!list.some((entry) => entry.status === "repair_required")) throw new Error("repairable failure missing from list");
' "$LIST_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"
bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["bgt_", "private log", "stacktrace", "SECRET", "sk_live_"]) {
  if (text.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
if (support.grid_publish_requests.length !== 3) throw new Error("support missing Grid publish requests");
if (!support.grid_publish_requests.some((entry) => entry.restore_candidate?.checkpoint_id === process.argv[2])) {
  throw new Error("support missing deploy-linked restore candidate");
}
if (!support.receipts.some((receipt) => receipt.receipt_type === "grid_publish" && receipt.body.commit_sha === process.argv[3] && receipt.body.verification_status === "passed")) {
  throw new Error("support missing Grid publish receipt with commit and verification");
}
if (support.deployments.length < 3) throw new Error("support missing deployment records");
' "$SUPPORT_JSON" "$CHECKPOINT_ID" "$COMMIT_SHA"

echo "Gate 36 smoke passed for BitterGrid publish/verify contract on $OWNER/$REPO"
