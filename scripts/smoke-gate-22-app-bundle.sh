#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate22-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate22-$$"
APP_NAME="gate22-app"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-22-${APP_NAME}-$$}"
BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-22-bundle-json.XXXXXX)"
SETUP_JSON="$(mktemp /tmp/bittergit-gate-22-setup-json.XXXXXX)"
APP_HTML="$(mktemp /tmp/bittergit-gate-22-app-html.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-22-support-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0
rm -rf "$WORKDIR"

ASSERTION="$(bun -e '
import { createHmac } from "node:crypto";
const payload = {
  account_ref: process.argv[1],
  workspace_ref: process.argv[2],
  plan_key: "one_app",
  plan_status: "active",
  included_apps: 1,
  github_required: false,
  secret_material_returned: false,
  source: "gate_22_local_assertion",
  asserted_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  hosted_workcell_limit: 1,
  monthly_hosted_run_limit: 100,
  storage_limit_mb: 512,
  mirror_export_allowed: true
};
const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const signature = createHmac("sha256", process.argv[3]).update(encoded).digest("hex");
console.log(`bga1.${encoded}.${signature}`);
' "$ACCOUNT_REF" "$WORKSPACE_REF" "$BOOTSTRAP_TOKEN")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"ignored\",\"name\":\"$APP_NAME\",\"display_name\":\"Gate 22 App\"}" >"$BUNDLE_JSON"

READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$BUNDLE_JSON")"
OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$BUNDLE_JSON")"
REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$BUNDLE_JSON")"
APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$BUNDLE_JSON")"

bun -e '
const data = await Bun.file(process.argv[1]).json();
const expected = [".gitignore", "AGENTS.md", "APP.md", "docs/BITTERGRID_DEPLOYMENT_CONTRACT.md"];
if (JSON.stringify(data.source_tree) !== JSON.stringify(expected)) {
  throw new Error(`unexpected source tree ${JSON.stringify(data.source_tree)}`);
}
if (data.github_required !== false || data.plan.github_required !== false) throw new Error("GitHub became required");
if (data.setup_state.status !== "ready") throw new Error("setup state was not ready");
if (data.setup_state.current_step !== "setup_complete") throw new Error("setup did not complete");
if (data.checkpoint.checkpoint_type !== "app_bundle_initial") throw new Error("initial checkpoint missing");
if (data.receipt.receipt_type !== "app_setup") throw new Error("setup receipt missing");
if (!data.receipt.body.source_tree.includes("APP.md")) throw new Error("receipt did not cite blank app source");
' "$BUNDLE_JSON"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"
TREE="$(git ls-tree -r --name-only HEAD | sort | tr '\n' ' ')"
test "$TREE" = ".gitignore AGENTS.md APP.md docs/BITTERGRID_DEPLOYMENT_CONTRACT.md "
test ! -e README.md
test ! -e package.json
test ! -e index.html

rg "Bitter app workspace" AGENTS.md >/dev/null
rg "bitter CLI" AGENTS.md >/dev/null
rg "BitterGit" AGENTS.md >/dev/null
rg "docs/BITTERGRID_DEPLOYMENT_CONTRACT.md" AGENTS.md >/dev/null
rg "Do not commit secret values" AGENTS.md >/dev/null
rg "first task is to establish the app charter" AGENTS.md >/dev/null
rg "local optima" AGENTS.md >/dev/null
rg "cold end user" AGENTS.md >/dev/null
rg "BitterGrid Deployment Contract" docs/BITTERGRID_DEPLOYMENT_CONTRACT.md >/dev/null
rg "Do not assume GitHub Actions" docs/BITTERGRID_DEPLOYMENT_CONTRACT.md >/dev/null

bun -e '
const text = await Bun.file("APP.md").text();
const sections = ["Purpose", "User", "First Useful Version", "Core Workflow", "Constraints", "Axes Of Excellence", "Non-Goals"];
for (const section of sections) {
  if (!text.includes(`## ${section}`)) throw new Error(`APP.md missing ${section}`);
}
const axes = [
  "User Value", "First Encounter", "Workflow Fit", "UX", "Visual Design",
  "Interaction Design", "Simplicity", "Correctness", "Performance",
  "Reliability", "Operability", "Security", "Privacy", "Data Ownership",
  "Accessibility", "Content And Copy", "Domain Fit", "Ecosystem Awareness",
  "Platform Fit", "Distribution", "Interoperability", "Competitive Position",
  "Economics", "Maintainability", "Verification"
];
for (const axis of axes) {
  const header = `### ${axis}`;
  const start = text.indexOf(header);
  if (start === -1) throw new Error(`APP.md missing axis ${axis}`);
  const next = text.indexOf("\n### ", start + 1);
  const block = text.slice(start, next === -1 ? undefined : next);
  if (!block.includes("Intent:") || !block.includes("Verification:")) {
    throw new Error(`APP.md axis ${axis} missing intent/verification`);
  }
}
'

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/setup" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$SETUP_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.setup_state.status !== "ready") throw new Error("setup state endpoint not ready");
if (!data.setup_state.receipt_id || !data.setup_state.checkpoint_id) throw new Error("setup state missing receipt/checkpoint");
' "$SETUP_JSON"

curl -fsS "$BASE_URL/apps/$OWNER/$REPO" >"$APP_HTML"
rg "Setup" "$APP_HTML" >/dev/null
rg "ready" "$APP_HTML" >/dev/null
rg "APP.md" "$APP_HTML" >/dev/null
rg "Source truth" "$APP_HTML" >/dev/null
rg "BitterGit primary" "$APP_HTML" >/dev/null
if rg "Choose GitHub|GitHub required|github.com" "$APP_HTML" >/dev/null; then
  echo "default app bundle UI showed a GitHub requirement or choice" >&2
  exit 1
fi

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"
bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_")) throw new Error("support leaked token material");
const data = JSON.parse(text).support;
if (data.setup_state.status !== "ready") throw new Error("support missing setup state");
if (data.receipts.filter((receipt) => receipt.receipt_type === "app_setup").length !== 1) {
  throw new Error("support missing setup receipt");
}
' "$SUPPORT_JSON"

echo "Gate 22 smoke passed for app bundle $OWNER/$REPO with app $APP_ID"
