#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate46-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate46-$$"
APP_NAME="gate46-app"
BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-46-bundle-json.XXXXXX)"
PROGRESS_JSON="$(mktemp /tmp/bittergit-gate-46-progress-json.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-46-support-json.XXXXXX)"

ASSERTION="$(bun -e '
import { createHmac } from "node:crypto";
const payload = {
  iss: "bitterhub.local",
  aud: "bittergit",
  sub: `account:${process.argv[1]}`,
  jti: `assertion-${process.argv[1]}-${Date.now()}`,
  kid: "hub-dev-key-1",
  authority_kind: "account_plan_assertion",
  account_ref: process.argv[1],
  workspace_ref: process.argv[2],
  plan_key: "one_app",
  plan_status: "active",
  included_apps: 1,
  github_required: false,
  secret_material_returned: false,
  source: "hub_factory_assertion",
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
  -d "{\"name\":\"$APP_NAME\",\"display_name\":\"Gate 46 App\"}" >"$BUNDLE_JSON"

APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$BUNDLE_JSON")"
OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$BUNDLE_JSON")"
REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$BUNDLE_JSON")"
READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$BUNDLE_JSON")"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/setup/progress" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$PROGRESS_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["dev-token", "bga2.", "bgt_", "sk-", "raw source", "private log", "APP_SECRET_VALUE"]) {
  if (text.includes(forbidden)) throw new Error(`progress leaked ${forbidden}`);
}
const progress = JSON.parse(text).progress;
if (progress.status !== "ready") throw new Error("progress was not ready");
if (progress.progress_percent !== 100) throw new Error("progress percent was not complete");
if (progress.polling.mode !== "stable_poll") throw new Error("polling mode missing");
if (progress.polling.poll_after_ms !== null) throw new Error("ready progress should not ask for another poll");
if (progress.includes_token_material !== false) throw new Error("progress includes token material");
if (progress.includes_secret_values !== false) throw new Error("progress includes secret values");
if (progress.includes_raw_source_contents !== false) throw new Error("progress includes raw source contents");
if (progress.includes_private_logs !== false) throw new Error("progress includes private logs");
const labels = progress.steps.map((step) => step.label);
for (const expected of ["Bitter account app", "Source repository", "Starter files", "First saved version", "Setup receipt"]) {
  if (!labels.includes(expected)) throw new Error(`missing progress label ${expected}`);
}
for (const step of progress.steps) {
  if (!step.owner_plane) throw new Error("progress step missing owner plane");
  if (!("repair_action" in step)) throw new Error("progress step missing repair action field");
}
if (!Array.isArray(progress.events) || progress.events.length < 4) throw new Error("progress events missing");
for (const event of progress.events) {
  if (!event.label || !event.owner_plane) throw new Error("progress event missing label or owner plane");
  if (!("repair_action" in event)) throw new Error("progress event missing repair action field");
}
if (!String(progress.user_message).includes("APP.md")) throw new Error("progress user message missing chartering");
' "$PROGRESS_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["dev-token", "bga2.", "bgt_", "sk-", "APP_SECRET_VALUE", "private log"]) {
  if (text.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
if (!support.setup_progress) throw new Error("support missing setup progress projection");
if (support.setup_progress.progress_percent !== 100) throw new Error("support progress not complete");
if (support.setup_progress.polling.mode !== "stable_poll") throw new Error("support polling contract missing");
if (!support.setup_progress.steps.some((step) => step.label === "Source repository" && step.owner_plane === "BitterGit")) {
  throw new Error("support progress missing stable source repository step");
}
' "$SUPPORT_JSON"

echo "Gate 46 smoke passed for live setup progress on $OWNER/$REPO"
