#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate54-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate54-$$"
APP_NAME="gate54-app"
BOX_SENTINEL="gate54-private-grid-box"
SSH_HOST_SENTINEL="gate54-private-ssh-host"
SSH_SERVICE_SENTINEL="gate54-private-ssh-service"
CREDENTIAL_SENTINEL="bitterpass://accounts/gate54/private-provider-ref"
AUTH_FILE_SENTINEL="/private/gate54/provider-auth.json"
DOWNSTREAM_SENTINEL="gate54-private-downstream-error"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-54.XXXXXX)"
MIRROR_PATH="$WORK_ROOT/private-mirror.git"
BUNDLE_JSON="$WORK_ROOT/bundle.json"
SESSION_JSON="$WORK_ROOT/session.json"
LAUNCH_JSON="$WORK_ROOT/launch.json"
MIRROR_JSON="$WORK_ROOT/mirror.json"
SUPPORT_JSON="$WORK_ROOT/support.json"
CUSTOMER_SUPPORT_JSON="$WORK_ROOT/customer-support.json"
TERMINAL_HTML="$WORK_ROOT/terminal.html"

trap 'rm -rf "$WORK_ROOT"' EXIT

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

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"production_ssh\":{\"mode\":\"operate\",\"write_enabled\":true,\"write_reason\":\"Gate 54 compatibility proof\",\"target\":{\"service\":\"$SSH_SERVICE_SENTINEL\",\"host_ref\":\"$SSH_HOST_SENTINEL\"}},\"terminal_fulfillment\":{\"mode\":\"dedicated_box\",\"box_ref\":\"$BOX_SENTINEL\"}}" >"$SESSION_JSON"

SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$SESSION_JSON")"
SOURCE_ROOT="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.source_root);' "$SESSION_JSON")"
TOKEN_REF="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.git_token_ref);' "$SESSION_JSON")"
TERMINAL_URL="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.terminal_url);' "$SESSION_JSON")"

bun -e '
const session = (await Bun.file(process.argv[1]).json()).session;
if (session.source_root !== process.argv[2]) throw new Error("orchestration source_root contract changed");
if (session.git_token_ref !== process.argv[3]) throw new Error("orchestration token-ref contract changed");
if (session.terminal_fulfillment.box_ref !== process.argv[4]) throw new Error("orchestration box-ref contract changed");
if (session.production_ssh.target.host_ref !== process.argv[5]) throw new Error("orchestration SSH target contract changed");
' "$SESSION_JSON" "$SOURCE_ROOT" "$TOKEN_REF" "$BOX_SENTINEL" "$SSH_HOST_SENTINEL"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"codex\",\"provider_cli\":{\"available\":true,\"command\":\"codex\"},\"provider_auth\":{\"status\":\"missing\",\"credential_ref\":\"$CREDENTIAL_SENTINEL\",\"auth_file\":\"$AUTH_FILE_SENTINEL\",\"repair_action\":\"$DOWNSTREAM_SENTINEL\"}}" >"$LAUNCH_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/mirrors" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"local_git\",\"remote_url\":\"$MIRROR_PATH\",\"credential_ref\":\"$CREDENTIAL_SENTINEL\",\"sync_now\":false}" >"$MIRROR_JSON"

MIRROR_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.mirror.id);' "$MIRROR_JSON")"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"
curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/support-debug" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$CUSTOMER_SUPPORT_JSON"
curl -fsS "$TERMINAL_URL" \
  -H "Authorization: Bearer $READ_TOKEN" >"$TERMINAL_HTML"

bun -e '
const repoText = await Bun.file(process.argv[1]).text();
const customerText = await Bun.file(process.argv[2]).text();
const terminalText = await Bun.file(process.argv[3]).text();
for (const forbidden of [...process.argv.slice(4, 12), process.argv[14]]) {
  if (!forbidden) continue;
  if (repoText.includes(forbidden)) throw new Error(`repo support leaked ${forbidden}`);
  if (customerText.includes(forbidden)) throw new Error(`customer support leaked ${forbidden}`);
  if (terminalText.includes(forbidden)) throw new Error(`terminal surface leaked ${forbidden}`);
}
const support = JSON.parse(repoText).support;
const session = support.hosted_workcell_sessions.find((entry) => entry.id === process.argv[12]);
if (!session) throw new Error("support session missing");
if (session.source_root !== null || session.source_root_returned !== false) throw new Error("support returned source root");
if (session.git_token_ref !== null || session.git_token_ref_returned !== false) throw new Error("support returned token ref");
if (session.terminal_url !== null || session.terminal_url_configured !== true || session.terminal_url_returned !== false) {
  throw new Error("support returned terminal URL");
}
if (session.terminal_route !== null || session.terminal_route_configured !== true || session.terminal_route_returned !== false) {
  throw new Error("support returned terminal route");
}
if (session.terminal_fulfillment.url !== null || session.terminal_fulfillment.url_returned !== false) {
  throw new Error("support fulfillment returned terminal URL");
}
if (session.terminal_fulfillment.route !== null || session.terminal_fulfillment.route_returned !== false) {
  throw new Error("support fulfillment returned terminal route");
}
if (session.terminal_fulfillment.origin_remote !== null || session.terminal_fulfillment.origin_remote_returned !== false) {
  throw new Error("support fulfillment returned origin remote");
}
if (session.terminal_fulfillment.box_ref !== null || session.terminal_fulfillment.box_ref_returned !== false) {
  throw new Error("support returned Grid box ref");
}
if (session.production_ssh.target.host_ref !== null || session.production_ssh.target_ref_returned !== false) {
  throw new Error("support returned production SSH target");
}
const launch = support.hosted_agent_launches.find((entry) => entry.session_id === process.argv[12]);
if (!launch || launch.source_root !== null || launch.git_token_ref !== null) throw new Error("support launch boundary failed");
if (launch.launch_contract.runtime_refs.grid_workcell_id !== null || launch.launch_contract.runtime_refs_returned !== false) {
  throw new Error("support launch returned runtime refs");
}
const mirror = support.mirrors.find((entry) => entry.id === process.argv[13]);
if (!mirror || mirror.remote_url !== null || mirror.credential_ref !== null) throw new Error("support mirror boundary failed");
if (mirror.credential_ref_present !== true || mirror.credential_ref_returned !== false) {
  throw new Error("support mirror credential posture failed");
}
if (!terminalText.includes("Target configured")) throw new Error("terminal omitted safe SSH posture");
if (terminalText.includes("<dt>Grid box</dt>") || terminalText.includes("<dt>Source root</dt>")) {
  throw new Error("terminal rendered internal topology labels");
}
' "$SUPPORT_JSON" "$CUSTOMER_SUPPORT_JSON" "$TERMINAL_HTML" \
  "$SOURCE_ROOT" "$TOKEN_REF" "$BOX_SENTINEL" "$SSH_HOST_SENTINEL" "$SSH_SERVICE_SENTINEL" \
  "$CREDENTIAL_SENTINEL" "$AUTH_FILE_SENTINEL" "$MIRROR_PATH" "$SESSION_ID" "$MIRROR_ID" \
  "$DOWNSTREAM_SENTINEL"

rg "scripts/smoke-gate-54-support-disclosure-boundary.sh" scripts/smoke-all.sh >/dev/null

echo "Gate 54 smoke passed for support and terminal disclosure boundaries on $APP_ID"
