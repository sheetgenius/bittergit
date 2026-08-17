#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate26-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate26-$$"
APP_NAME="gate26-app"
BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-26-bundle-json.XXXXXX)"
SESSION_JSON="$(mktemp /tmp/bittergit-gate-26-session-json.XXXXXX)"
TERMINAL_HTML="$(mktemp /tmp/bittergit-gate-26-terminal-html.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-26-support-json.XXXXXX)"

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

TERMINAL_URL="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.terminal_url);' "$SESSION_JSON")"
SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$SESSION_JSON")"

bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_")) throw new Error("session leaked token material");
const session = JSON.parse(text).session;
if (!String(session.terminal_url).startsWith(`${process.argv[2]}/terminals/`)) {
  throw new Error(`terminal URL was not an HTTP handoff: ${session.terminal_url}`);
}
if (session.terminal_provider !== "bittergrid_contract_local") throw new Error("terminal provider missing");
if (session.terminal_status !== "ready") throw new Error("terminal status not ready");
' "$SESSION_JSON" "$BASE_URL"

curl -fsS "$TERMINAL_URL" >"$TERMINAL_HTML"
rg "Terminal ready" "$TERMINAL_HTML" >/dev/null
rg "Source is saved in BitterGit" "$TERMINAL_HTML" >/dev/null
rg "GitHub is optional" "$TERMINAL_HTML" >/dev/null
rg "APP.md" "$TERMINAL_HTML" >/dev/null
rg "$APP_ID" "$TERMINAL_HTML" >/dev/null
rg "$ACCOUNT_REF" "$TERMINAL_HTML" >/dev/null
rg "$BASE_URL/$OWNER/$REPO.git" "$TERMINAL_HTML" >/dev/null
if rg "bgt_|github.com" "$TERMINAL_HTML" >/dev/null; then
  echo "terminal handoff leaked token material or pointed at GitHub" >&2
  exit 1
fi

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"
bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_")) throw new Error("support leaked token material");
const session = JSON.parse(text).support.hosted_workcell_sessions.find((entry) => entry.id === process.argv[2]);
if (!session) throw new Error("support missing hosted terminal session");
if (!String(session.terminal_url).startsWith(`${process.argv[3]}/terminals/`)) throw new Error("support terminal URL was not fetchable");
if (session.terminal_provider !== "bittergrid_contract_local") throw new Error("support missing terminal provider");
if (session.terminal_status !== "ready") throw new Error("support terminal status not ready");
' "$SUPPORT_JSON" "$SESSION_ID" "$BASE_URL"

echo "Gate 26 smoke passed for terminal handoff $TERMINAL_URL"
