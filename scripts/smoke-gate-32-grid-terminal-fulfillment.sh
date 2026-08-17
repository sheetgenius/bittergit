#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate32-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate32-$$"
APP_NAME="gate32-app"
BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-32-bundle-json.XXXXXX)"
SESSION_JSON="$(mktemp /tmp/bittergit-gate-32-session-json.XXXXXX)"
FULFILL_JSON="$(mktemp /tmp/bittergit-gate-32-fulfill-json.XXXXXX)"
REVOKE_JSON="$(mktemp /tmp/bittergit-gate-32-revoke-json.XXXXXX)"
TERMINAL_HTML="$(mktemp /tmp/bittergit-gate-32-terminal-html.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-32-support-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

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

bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_")) throw new Error("session leaked token material");
const session = JSON.parse(text).session;
const fulfillment = session.terminal_fulfillment;
if (fulfillment.provider !== "bittergrid_adapter_local") throw new Error("missing Grid adapter provider");
if (fulfillment.route !== `/terminals/${session.id}`) throw new Error("terminal route mismatch");
if (fulfillment.lifecycle !== "fulfilled_local_contract") throw new Error("terminal lifecycle mismatch");
if (fulfillment.status !== "ready") throw new Error("terminal fulfillment not ready");
if (!String(session.terminal_url).startsWith(`${process.argv[2]}/terminals/`)) throw new Error("terminal URL not local route");
if (String(session.terminal_url).includes("bgt_")) throw new Error("terminal URL contained token material");
' "$SESSION_JSON" "$BASE_URL"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/terminal-fulfillment" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$FULFILL_JSON"

bun -e '
const session = (await Bun.file(process.argv[1]).json()).session;
if (session.terminal_fulfillment.provider !== "bittergrid_adapter_local") throw new Error("refresh missing adapter");
if (session.terminal_fulfillment.lifecycle !== "fulfilled_local_contract") throw new Error("refresh lifecycle mismatch");
if (session.terminal_fulfillment.route !== `/terminals/${session.id}`) throw new Error("refresh route mismatch");
' "$FULFILL_JSON"

curl -fsS "$TERMINAL_URL" >"$TERMINAL_HTML"
rg "Terminal route" "$TERMINAL_HTML" >/dev/null
rg "Terminal lifecycle" "$TERMINAL_HTML" >/dev/null
rg "fulfilled_local_contract" "$TERMINAL_HTML" >/dev/null
rg "$BASE_URL/$OWNER/$REPO.git" "$TERMINAL_HTML" >/dev/null
if rg "bgt_|github.com" "$TERMINAL_HTML" >/dev/null; then
  echo "terminal fulfillment leaked token material or pointed at GitHub" >&2
  exit 1
fi

git -C "$SOURCE_ROOT" config user.email "gate32@bittergit.local"
git -C "$SOURCE_ROOT" config user.name "BitterGit Gate 32"
git -C "$SOURCE_ROOT" checkout -B gate32-before-revoke
printf 'terminal fulfillment proof\n' >"$SOURCE_ROOT/gate32.txt"
git -C "$SOURCE_ROOT" add gate32.txt
git -C "$SOURCE_ROOT" commit -m "Add Gate 32 terminal proof"
git -C "$SOURCE_ROOT" push origin gate32-before-revoke

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/revoke" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$REVOKE_JSON"

bun -e '
const session = (await Bun.file(process.argv[1]).json()).session;
if (session.status !== "revoked") throw new Error("session was not revoked");
if (session.terminal_status !== "revoked") throw new Error("terminal status was not revoked");
if (session.terminal_fulfillment.lifecycle !== "revoked") throw new Error("terminal lifecycle was not revoked");
' "$REVOKE_JSON"

git -C "$SOURCE_ROOT" checkout -B gate32-after-revoke
printf 'revoked terminal proof\n' >"$SOURCE_ROOT/gate32-revoked.txt"
git -C "$SOURCE_ROOT" add gate32-revoked.txt
git -C "$SOURCE_ROOT" commit -m "Attempt revoked Gate 32 push"
if git -C "$SOURCE_ROOT" push origin gate32-after-revoke; then
  echo "revoked terminal session unexpectedly retained write access" >&2
  exit 1
fi

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_")) throw new Error("support leaked token material");
const session = JSON.parse(text).support.hosted_workcell_sessions.find((entry) => entry.id === process.argv[2]);
if (!session) throw new Error("support missing hosted session");
if (session.terminal_fulfillment.provider !== "bittergrid_adapter_local") throw new Error("support missing Grid adapter");
if (session.terminal_fulfillment.lifecycle !== "revoked") throw new Error("support missing revoked lifecycle");
' "$SUPPORT_JSON" "$SESSION_ID"

echo "Gate 32 smoke passed for Grid terminal fulfillment $SESSION_ID"
