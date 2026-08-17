#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate27-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate27-$$"
APP_NAME="gate27-app"
BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-27-bundle-json.XXXXXX)"
SESSION_JSON="$(mktemp /tmp/bittergit-gate-27-session-json.XXXXXX)"
READINESS_JSON="$(mktemp /tmp/bittergit-gate-27-readiness-json.XXXXXX)"
TERMINAL_HTML="$(mktemp /tmp/bittergit-gate-27-terminal-html.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-27-support-json.XXXXXX)"

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
TERMINAL_URL="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.terminal_url);' "$SESSION_JSON")"

bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_")) throw new Error("session leaked token material");
const session = JSON.parse(text).session;
if (session.agent_readiness.evidence.status !== "ready") throw new Error("readiness evidence was not ready");
if (!Array.isArray(session.agent_readiness_checks) || session.agent_readiness_checks.length < 9) {
  throw new Error("session missing readiness checks");
}
' "$SESSION_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/readiness" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$READINESS_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_")) throw new Error("readiness endpoint leaked token material");
const data = JSON.parse(text);
if (data.readiness.evidence.status !== "ready") throw new Error("readiness status was not ready");
const checks = data.checks;
const required = checks.filter((check) => check.required);
if (required.some((check) => check.status !== "passed")) {
  throw new Error(`required readiness check failed: ${JSON.stringify(required)}`);
}
const names = checks.map((check) => check.check_name);
for (const expected of [
  "source_root_exists",
  "origin_is_bittergit",
  "origin_has_no_token",
  "agents_file_present",
  "app_charter_present",
  "credential_helper_configured",
  "git_status_clean",
  "codex_cli_detected",
  "claude_cli_detected"
]) {
  if (!names.includes(expected)) throw new Error(`missing readiness check ${expected}`);
}
' "$READINESS_JSON"

curl -fsS "$TERMINAL_URL" >"$TERMINAL_HTML"
rg "Agent readiness" "$TERMINAL_HTML" >/dev/null
rg "origin_is_bittergit" "$TERMINAL_HTML" >/dev/null
rg "app_charter_present" "$TERMINAL_HTML" >/dev/null
if rg "bgt_|github.com" "$TERMINAL_HTML" >/dev/null; then
  echo "terminal readiness leaked token material or pointed at GitHub" >&2
  exit 1
fi

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"
bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_")) throw new Error("support leaked token material");
const session = JSON.parse(text).support.hosted_workcell_sessions.find((entry) => entry.id === process.argv[2]);
if (!session) throw new Error("support missing hosted session");
if (session.agent_readiness.evidence.status !== "ready") throw new Error("support readiness status not ready");
if (!session.agent_readiness_checks.some((check) => check.check_name === "origin_has_no_token" && check.status === "passed")) {
  throw new Error("support missing no-token readiness proof");
}
' "$SUPPORT_JSON" "$SESSION_ID"

echo "Gate 27 smoke passed for agent readiness evidence on $OWNER/$REPO"
