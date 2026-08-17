#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate33-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate33-$$"
APP_NAME="gate33-app"
BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-33-bundle-json.XXXXXX)"
SESSION_JSON="$(mktemp /tmp/bittergit-gate-33-session-json.XXXXXX)"
LAUNCH_JSON="$(mktemp /tmp/bittergit-gate-33-launch-json.XXXXXX)"
FETCH_JSON="$(mktemp /tmp/bittergit-gate-33-fetch-json.XXXXXX)"
BAD_JSON="$(mktemp /tmp/bittergit-gate-33-bad-json.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-33-support-json.XXXXXX)"

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

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"provider":"codex"}' >"$LAUNCH_JSON"

LAUNCH_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.agent_launch.id);' "$LAUNCH_JSON")"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["sk-", "bgt_", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
  if (text.includes(forbidden)) throw new Error(`launch leaked ${forbidden}`);
}
const launch = JSON.parse(text).agent_launch;
if (launch.status !== "ready") throw new Error("launch was not ready");
if (launch.provider !== "codex") throw new Error("provider mismatch");
if (launch.source_root !== process.argv[2]) throw new Error("source root mismatch");
if (!launch.instructions_path.endsWith("/AGENTS.md")) throw new Error("instructions path missing");
if (!launch.charter_path.endsWith("/APP.md")) throw new Error("charter path missing");
if (!launch.first_task.includes("establish the app charter")) throw new Error("first task did not point to chartering");
if (launch.provider_auth.includes_secret_value !== false) throw new Error("provider auth claimed secret values");
if (!String(launch.origin_remote).includes(process.argv[3])) throw new Error("origin remote missing repo");
if (!launch.run_scope_ref.includes("agent_launch:")) throw new Error("run scope missing");
' "$LAUNCH_JSON" "$SOURCE_ROOT" "$REPO"

test -f "$SOURCE_ROOT/AGENTS.md"
test -f "$SOURCE_ROOT/APP.md"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches/$LAUNCH_ID" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$FETCH_JSON"
rg "$LAUNCH_ID" "$FETCH_JSON" >/dev/null

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"provider":"unknown-ai"}' >"$BAD_JSON"

bun -e '
const launch = (await Bun.file(process.argv[1]).json()).agent_launch;
if (launch.status !== "blocked") throw new Error("unsupported provider was not blocked");
if (launch.failure_reason !== "unsupported_provider") throw new Error("failure reason missing");
if (!launch.repair_action.includes("claude or codex")) throw new Error("repair action missing");
' "$BAD_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["sk-", "bgt_", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
  if (text.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const launches = JSON.parse(text).support.hosted_agent_launches;
if (!Array.isArray(launches) || launches.length < 2) throw new Error("support missing agent launches");
if (!launches.some((entry) => entry.id === process.argv[2] && entry.status === "ready")) {
  throw new Error("support missing ready launch");
}
if (!launches.some((entry) => entry.failure_reason === "unsupported_provider")) {
  throw new Error("support missing blocked launch");
}
' "$SUPPORT_JSON" "$LAUNCH_ID"

echo "Gate 33 smoke passed for hosted agent launch envelope $LAUNCH_ID"
