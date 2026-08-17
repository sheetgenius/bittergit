#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate25-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate25-$$"
APP_NAME="gate25-app"
BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-25-bundle-json.XXXXXX)"
SETUP_JSON="$(mktemp /tmp/bittergit-gate-25-setup-json.XXXXXX)"
APP_HTML="$(mktemp /tmp/bittergit-gate-25-app-html.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-25-support-json.XXXXXX)"

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
  -d "{\"name\":\"$APP_NAME\",\"display_name\":\"Gate 25 App\"}" >"$BUNDLE_JSON"

APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$BUNDLE_JSON")"
OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$BUNDLE_JSON")"
REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$BUNDLE_JSON")"
READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$BUNDLE_JSON")"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/setup" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$SETUP_JSON"

bun -e '
const data = await Bun.file(process.argv[1]).json();
const setup = data.setup_state;
if (setup.status !== "ready") throw new Error("setup was not ready");
if (setup.progress_percent !== 100) throw new Error("setup progress was not complete");
if (setup.repairable !== false) throw new Error("ready setup should not be repairable");
if (setup.repair_action !== "No repair needed.") throw new Error("ready repair action missing");
if (!String(setup.user_message).includes("APP.md")) throw new Error("user message did not cite chartering");
if (!Array.isArray(setup.events) || setup.events.length < 4) throw new Error("setup event trail too short");
const names = setup.steps.map((step) => step.name);
for (const expected of ["account_app", "bittergit_repo", "blank_source", "initial_checkpoint", "setup_receipt"]) {
  if (!names.includes(expected)) throw new Error(`missing setup step ${expected}`);
}
const messages = setup.events.map((event) => event.message).join("\n");
for (const expected of ["BitterGit repository", "blank source", "initial checkpoint", "Setup receipt"]) {
  if (!messages.includes(expected)) throw new Error(`missing setup event message ${expected}`);
}
' "$SETUP_JSON"

curl -fsS "$BASE_URL/apps/$OWNER/$REPO" >"$APP_HTML"
rg "Setup progress" "$APP_HTML" >/dev/null
rg "Setup events" "$APP_HTML" >/dev/null
rg "account_app" "$APP_HTML" >/dev/null
rg "setup_receipt" "$APP_HTML" >/dev/null
rg "Repair action: No repair needed." "$APP_HTML" >/dev/null
rg "APP.md" "$APP_HTML" >/dev/null

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"
bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_")) throw new Error("support leaked token material");
const setup = JSON.parse(text).support.setup_state;
if (setup.progress_percent !== 100) throw new Error("support missing setup progress");
if (!Array.isArray(setup.events) || setup.events.length < 4) throw new Error("support missing setup events");
' "$SUPPORT_JSON"

echo "Gate 25 smoke passed for setup progress $OWNER/$REPO"
