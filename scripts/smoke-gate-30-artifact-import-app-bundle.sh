#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
TMPROOT="$(mktemp -d /tmp/bittergit-gate-30.XXXXXX)"
BLOCKED_REVIEW_JSON="$(mktemp /tmp/bittergit-gate-30-blocked-review-json.XXXXXX)"
BLOCKED_BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-30-blocked-bundle-json.XXXXXX)"
SAFE_REVIEW_JSON="$(mktemp /tmp/bittergit-gate-30-safe-review-json.XXXXXX)"
SAFE_BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-30-safe-bundle-json.XXXXXX)"
PRESERVE_REVIEW_JSON="$(mktemp /tmp/bittergit-gate-30-preserve-review-json.XXXXXX)"
PRESERVE_BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-30-preserve-bundle-json.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-30-support-json.XXXXXX)"

cleanup() {
  rm -rf "$TMPROOT"
}
trap cleanup EXIT

make_assertion() {
  local account_ref="$1"
  local workspace_ref="$2"
  bun -e '
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
' "$account_ref" "$workspace_ref" "$BOOTSTRAP_TOKEN"
}

review_folder() {
  local assertion="$1"
  local folder="$2"
  local output="$3"
  curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/review" \
    -H "X-Bitter-Account-Assertion: $assertion" \
    -H "Content-Type: application/json" \
    -d "{\"source_kind\":\"folder\",\"source_path\":\"$folder\"}" >"$output"
}

bundle_from_review() {
  local assertion="$1"
  local review_json="$2"
  local app_name="$3"
  local output="$4"
  local import_id
  import_id="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.artifact_import.id);' "$review_json")"
  curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/$import_id/app-bundle" \
    -H "X-Bitter-Account-Assertion: $assertion" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$app_name\"}" >"$output"
}

BLOCKED_ACCOUNT="acct-gate30-blocked-$(date -u +%Y%m%d%H%M%S)-$$"
BLOCKED_ASSERTION="$(make_assertion "$BLOCKED_ACCOUNT" "wrk-gate30-blocked-$$")"
BLOCKED_DIR="$TMPROOT/blocked"
mkdir -p "$BLOCKED_DIR"
printf '<html><body><h1>Blocked Import</h1></body></html>\n' >"$BLOCKED_DIR/index.html"
printf 'TOKEN=do-not-import\n' >"$BLOCKED_DIR/.env"
review_folder "$BLOCKED_ASSERTION" "$BLOCKED_DIR" "$BLOCKED_REVIEW_JSON"

BLOCKED_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.artifact_import.id);' "$BLOCKED_REVIEW_JSON")"
BLOCKED_STATUS="$(curl -sS -o "$BLOCKED_BUNDLE_JSON" -w "%{http_code}" \
  -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/$BLOCKED_ID/app-bundle" \
  -H "X-Bitter-Account-Assertion: $BLOCKED_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"name":"blocked-import"}')"
test "$BLOCKED_STATUS" = "400"
rg "blockers" "$BLOCKED_BUNDLE_JSON" >/dev/null

SAFE_ACCOUNT="acct-gate30-safe-$(date -u +%Y%m%d%H%M%S)-$$"
SAFE_ASSERTION="$(make_assertion "$SAFE_ACCOUNT" "wrk-gate30-safe-$$")"
SAFE_DIR="$TMPROOT/safe"
mkdir -p "$SAFE_DIR/assets" "$SAFE_DIR/css"
printf '<html><body><h1>Imported App</h1></body></html>\n' >"$SAFE_DIR/index.html"
printf 'body { color: #111; }\n' >"$SAFE_DIR/css/site.css"
printf 'scan-only image fixture\n' >"$SAFE_DIR/assets/photo.png"
review_folder "$SAFE_ASSERTION" "$SAFE_DIR" "$SAFE_REVIEW_JSON"
bundle_from_review "$SAFE_ASSERTION" "$SAFE_REVIEW_JSON" "imported-app" "$SAFE_BUNDLE_JSON"

bun -e '
const data = await Bun.file(process.argv[1]).json();
const expected = ["AGENTS.md", "APP.md", ".gitignore", "assets/photo.png", "css/site.css", "docs/BITTERGRID_DEPLOYMENT_CONTRACT.md", "index.html"].sort();
const tree = [...data.source_tree].sort();
if (JSON.stringify(tree) !== JSON.stringify(expected)) throw new Error(`source tree mismatch: ${tree.join(",")}`);
if (data.setup_state.status !== "ready") throw new Error("setup state not ready");
if (data.setup_state.current_step !== "setup_complete") throw new Error("setup did not complete");
if (data.artifact_import.detected_shape !== "static_html_site") throw new Error("artifact shape missing");
if (data.github_required !== false) throw new Error("GitHub became required");
' "$SAFE_BUNDLE_JSON"

SAFE_CLONE="$TMPROOT/safe-clone"
SAFE_READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$SAFE_BUNDLE_JSON")"
SAFE_CLONE_URL="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.clone_url);' "$SAFE_BUNDLE_JSON")"
git -c http.extraHeader="Authorization: Bearer $SAFE_READ_TOKEN" clone "$SAFE_CLONE_URL" "$SAFE_CLONE" >/dev/null 2>&1
test -f "$SAFE_CLONE/AGENTS.md"
test -f "$SAFE_CLONE/APP.md"
test -f "$SAFE_CLONE/.gitignore"
test -f "$SAFE_CLONE/docs/BITTERGRID_DEPLOYMENT_CONTRACT.md"
test -f "$SAFE_CLONE/index.html"
test ! -e "$SAFE_CLONE/README.md"
rg "first task is to establish the app charter" "$SAFE_CLONE/AGENTS.md" >/dev/null
rg "docs/BITTERGRID_DEPLOYMENT_CONTRACT.md" "$SAFE_CLONE/AGENTS.md" >/dev/null
rg "Do not assume GitHub Actions" "$SAFE_CLONE/docs/BITTERGRID_DEPLOYMENT_CONTRACT.md" >/dev/null
rg "Axes Of Excellence" "$SAFE_CLONE/APP.md" >/dev/null

SAFE_OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$SAFE_BUNDLE_JSON")"
SAFE_REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$SAFE_BUNDLE_JSON")"
curl -fsS "$BASE_URL/bittergit/v1/repos/$SAFE_OWNER/$SAFE_REPO/support-debug" \
  -H "Authorization: Bearer $SAFE_READ_TOKEN" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["<h1>Imported App", "TOKEN=do-not-import", "bga2.", "bgt_"]) {
  if (text.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
if (support.setup_state.status !== "ready") throw new Error("support setup state not ready");
if (!support.receipts.some((receipt) => receipt.receipt_type === "artifact_app_setup")) {
  throw new Error("support missing artifact setup receipt");
}
' "$SUPPORT_JSON"

PRESERVE_ACCOUNT="acct-gate30-preserve-$(date -u +%Y%m%d%H%M%S)-$$"
PRESERVE_ASSERTION="$(make_assertion "$PRESERVE_ACCOUNT" "wrk-gate30-preserve-$$")"
PRESERVE_DIR="$TMPROOT/preserve"
mkdir -p "$PRESERVE_DIR"
printf 'CUSTOM AGENTS\n' >"$PRESERVE_DIR/AGENTS.md"
printf 'CUSTOM APP\n' >"$PRESERVE_DIR/APP.md"
printf 'dist/\n' >"$PRESERVE_DIR/.gitignore"
printf '<html><body>Preserve</body></html>\n' >"$PRESERVE_DIR/index.html"
review_folder "$PRESERVE_ASSERTION" "$PRESERVE_DIR" "$PRESERVE_REVIEW_JSON"
bundle_from_review "$PRESERVE_ASSERTION" "$PRESERVE_REVIEW_JSON" "preserve-app" "$PRESERVE_BUNDLE_JSON"

PRESERVE_CLONE="$TMPROOT/preserve-clone"
PRESERVE_READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$PRESERVE_BUNDLE_JSON")"
PRESERVE_CLONE_URL="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.clone_url);' "$PRESERVE_BUNDLE_JSON")"
git -c http.extraHeader="Authorization: Bearer $PRESERVE_READ_TOKEN" clone "$PRESERVE_CLONE_URL" "$PRESERVE_CLONE" >/dev/null 2>&1
test "$(cat "$PRESERVE_CLONE/AGENTS.md")" = "CUSTOM AGENTS"
test "$(cat "$PRESERVE_CLONE/APP.md")" = "CUSTOM APP"
test "$(cat "$PRESERVE_CLONE/.gitignore")" = "dist/"

echo "Gate 30 smoke passed for artifact app bundle $SAFE_OWNER/$SAFE_REPO"
