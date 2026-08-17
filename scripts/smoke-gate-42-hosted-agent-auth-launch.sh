#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate42-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate42-$$"
APP_NAME="gate42-app"
READY_CREDENTIAL_REF="cred_gate42_codex_reference_should_not_leak"
BLOCKED_CREDENTIAL_REF="bitterpass://accounts/gate42/claude-reference-should-not-leak"
AUTH_FILE_SENTINEL="/auth-src/gate42/provider-auth.json"
BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-42-bundle-json.XXXXXX)"
SESSION_JSON="$(mktemp /tmp/bittergit-gate-42-session-json.XXXXXX)"
READY_LAUNCH_JSON="$(mktemp /tmp/bittergit-gate-42-ready-launch-json.XXXXXX)"
BLOCKED_AUTH_JSON="$(mktemp /tmp/bittergit-gate-42-blocked-auth-json.XXXXXX)"
BLOCKED_CLI_JSON="$(mktemp /tmp/bittergit-gate-42-blocked-cli-json.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-42-support-json.XXXXXX)"
CUSTOMER_SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-42-customer-support-json.XXXXXX)"

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
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$SESSION_JSON"

SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$SESSION_JSON")"
SOURCE_ROOT="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.source_root);' "$SESSION_JSON")"
TERMINAL_URL="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.terminal_url);' "$SESSION_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"codex\",\"provider_cli\":{\"available\":true,\"command\":\"codex\",\"source\":\"grid_workcell_mount\"},\"provider_auth\":{\"status\":\"mounted\",\"source\":\"local_cli_subscription\",\"credential_ref\":\"$READY_CREDENTIAL_REF\",\"auth_file\":\"$AUTH_FILE_SENTINEL\"}}" >"$READY_LAUNCH_JSON"

READY_LAUNCH_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.agent_launch.id);' "$READY_LAUNCH_JSON")"

bun -e '
const text = await Bun.file(process.argv[1]).text();
const forbidden = [
  process.argv[2],
  process.argv[3],
  "sk-",
  "bgt_",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "provider-auth.json",
  "/auth-src/"
];
for (const value of forbidden) {
  if (text.includes(value)) throw new Error(`ready launch leaked ${value}`);
}
const launch = JSON.parse(text).agent_launch;
if (launch.status !== "ready") throw new Error("ready launch was not ready");
if (launch.provider !== "codex") throw new Error("provider mismatch");
if (launch.provider_cli.command !== "codex") throw new Error("provider CLI command missing");
if (launch.provider_cli.available !== true) throw new Error("provider CLI not marked available");
if (launch.provider_cli.path_returned !== false) throw new Error("provider CLI path leaked");
if (launch.provider_auth.status !== "mounted") throw new Error("provider auth not mounted");
if (launch.provider_auth.source !== "local_cli_subscription") throw new Error("provider auth source missing");
if (launch.provider_auth.reference_present !== true) throw new Error("provider auth reference presence not recorded");
if (launch.provider_auth.reference_returned !== false) throw new Error("provider auth reference returned");
if (launch.provider_auth.credential_material_returned !== false) throw new Error("provider auth material returned");
if (launch.provider_auth.auth_files_returned !== false) throw new Error("provider auth file returned");
if (launch.provider_auth.includes_secret_value !== false) throw new Error("provider auth exposed secret value");
if (!launch.readiness_evidence.instructions_present) throw new Error("AGENTS.md not visible");
if (!launch.readiness_evidence.charter_present) throw new Error("APP.md not visible");
if (!launch.readiness_evidence.provider_cli_available) throw new Error("CLI evidence missing");
if (!launch.readiness_evidence.provider_auth_ready) throw new Error("auth evidence missing");
if (launch.readiness_evidence.origin_remote_has_token) throw new Error("origin remote had token");
if (launch.readiness_evidence.terminal_url_has_token) throw new Error("terminal URL had token");
if (!launch.launch_contract.first_prompt.includes("APP.md")) throw new Error("first prompt missing APP.md");
if (!launch.launch_contract.first_prompt.includes("before substantial implementation")) {
  throw new Error("first prompt did not block premature implementation");
}
if (!String(launch.launch_contract.implementation_before_charter).includes("blocked")) {
  throw new Error("launch contract did not gate implementation");
}
if (!Array.isArray(launch.launch_contract.expected_workflow) || launch.launch_contract.expected_workflow.length < 4) {
  throw new Error("launch contract workflow missing");
}
' "$READY_LAUNCH_JSON" "$READY_CREDENTIAL_REF" "$AUTH_FILE_SENTINEL"

test -f "$SOURCE_ROOT/AGENTS.md"
test -f "$SOURCE_ROOT/APP.md"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"claude\",\"provider_cli\":{\"available\":true,\"command\":\"claude\"},\"provider_auth\":{\"status\":\"missing\",\"source\":\"local_cli_subscription\",\"credential_ref\":\"$BLOCKED_CREDENTIAL_REF\",\"repair_action\":\"Reconnect provider subscription auth through Factory.\"}}" >"$BLOCKED_AUTH_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const value of [process.argv[2], "bitterpass://", "sk-", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) {
  if (text.includes(value)) throw new Error(`blocked auth launch leaked ${value}`);
}
const launch = JSON.parse(text).agent_launch;
if (launch.status !== "blocked") throw new Error("missing auth was not blocked");
if (launch.failure_reason !== "provider_auth_not_mounted") throw new Error("missing auth failure reason wrong");
if (launch.provider_auth.status !== "blocked") throw new Error("provider auth status wrong");
if (launch.provider_auth.mount_status !== "missing") throw new Error("provider auth mount status wrong");
if (!launch.repair_action.includes("Reconnect provider subscription auth")) throw new Error("repair action missing");
' "$BLOCKED_AUTH_JSON" "$BLOCKED_CREDENTIAL_REF"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"provider":"codex","provider_cli":{"available":false,"command":"codex"},"provider_auth":{"status":"mounted","source":"local_cli_subscription"}}' >"$BLOCKED_CLI_JSON"

bun -e '
const launch = (await Bun.file(process.argv[1]).json()).agent_launch;
if (launch.status !== "blocked") throw new Error("missing CLI was not blocked");
if (launch.failure_reason !== "provider_cli_unavailable") throw new Error("missing CLI failure reason wrong");
if (launch.provider_cli.available !== false) throw new Error("provider CLI availability missing");
if (!launch.repair_action.includes("codex CLI")) throw new Error("CLI repair action missing");
' "$BLOCKED_CLI_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"
curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/support-debug" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$CUSTOMER_SUPPORT_JSON"

bun -e '
const repoText = await Bun.file(process.argv[1]).text();
const customerText = await Bun.file(process.argv[2]).text();
const combined = `${repoText}\n${customerText}`;
for (const forbidden of [
  process.argv[3],
  process.argv[4],
  process.argv[5],
  "bitterpass://",
  "provider-auth.json",
  "/auth-src/",
  "sk-",
  "bgt_",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "github_pat_"
]) {
  if (combined.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(repoText).support;
const launches = support.hosted_agent_launches;
if (!Array.isArray(launches) || launches.length < 3) throw new Error("support missing agent launch records");
const ready = launches.find((entry) => entry.id === process.argv[6]);
if (!ready || ready.status !== "ready") throw new Error("support missing ready launch");
if (ready.provider_auth.reference_returned !== false) throw new Error("support returned provider reference");
if (!launches.some((entry) => entry.failure_reason === "provider_auth_not_mounted")) {
  throw new Error("support missing provider auth repair state");
}
if (!launches.some((entry) => entry.failure_reason === "provider_cli_unavailable")) {
  throw new Error("support missing provider CLI repair state");
}
if (String(process.argv[7]).includes("token") || String(process.argv[7]).includes("bgt_")) {
  throw new Error("terminal URL had token-looking content");
}
' "$SUPPORT_JSON" "$CUSTOMER_SUPPORT_JSON" "$READY_CREDENTIAL_REF" "$BLOCKED_CREDENTIAL_REF" "$AUTH_FILE_SENTINEL" "$READY_LAUNCH_ID" "$TERMINAL_URL"

echo "Gate 42 smoke passed for hosted agent auth mount and launch $READY_LAUNCH_ID"
