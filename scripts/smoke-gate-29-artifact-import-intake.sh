#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate29-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate29-$$"
TMPROOT="$(mktemp -d /tmp/bittergit-gate-29.XXXXXX)"
BLOCKED_JSON="$(mktemp /tmp/bittergit-gate-29-blocked-json.XXXXXX)"
SAFE_JSON="$(mktemp /tmp/bittergit-gate-29-safe-json.XXXXXX)"
ZIP_JSON="$(mktemp /tmp/bittergit-gate-29-zip-json.XXXXXX)"
FETCH_JSON="$(mktemp /tmp/bittergit-gate-29-fetch-json.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-29-support-json.XXXXXX)"

cleanup() {
  rm -rf "$TMPROOT"
}
trap cleanup EXIT

make_assertion() {
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
' "$ACCOUNT_REF" "$WORKSPACE_REF" "$BOOTSTRAP_TOKEN"
}

ASSERTION="$(make_assertion)"

BLOCKED_DIR="$TMPROOT/blocked-artifact"
mkdir -p "$BLOCKED_DIR/assets" "$BLOCKED_DIR/css" "$BLOCKED_DIR/js" "$BLOCKED_DIR/node_modules/pkg" "$BLOCKED_DIR/secrets"
printf '<html><body><h1>Blocked</h1></body></html>\n' >"$BLOCKED_DIR/index.html"
printf 'body { color: #222; }\n' >"$BLOCKED_DIR/css/site.css"
printf 'console.log("hello");\n' >"$BLOCKED_DIR/js/app.js"
printf '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n' >"$BLOCKED_DIR/assets/logo.svg"
printf 'metadata\n' >"$BLOCKED_DIR/.DS_Store"
printf 'dependency\n' >"$BLOCKED_DIR/node_modules/pkg/index.js"
printf 'nested archive placeholder\n' >"$BLOCKED_DIR/source.zip"
printf 'API_TOKEN=do-not-import\n' >"$BLOCKED_DIR/.env"
printf '%s\n' '-----BEGIN PRIVATE KEY-----' >"$BLOCKED_DIR/secrets/private.pem"
ln -s index.html "$BLOCKED_DIR/linked-file"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/review" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"source_kind\":\"folder\",\"source_path\":\"$BLOCKED_DIR\"}" >"$BLOCKED_JSON"

bun -e '
const data = await Bun.file(process.argv[1]).json();
const review = data.artifact_import;
if (review.status !== "blocked") throw new Error("blocked folder was not blocked");
if (review.detected_shape !== "static_html_site") throw new Error("blocked folder shape was not detected");
const plan = review.plan;
for (const path of ["index.html", "css/site.css", "js/app.js", "assets/logo.svg"]) {
  if (!plan.will_import.some((entry) => entry.path === path)) throw new Error(`missing import path ${path}`);
}
for (const reason of ["macos_metadata", "dependency_directory", "nested_archive"]) {
  if (!plan.will_skip.some((entry) => entry.reason === reason)) throw new Error(`missing skip reason ${reason}`);
}
for (const reason of ["env_file", "private_key", "symlink"]) {
  if (!plan.blocked.some((entry) => entry.reason === reason)) throw new Error(`missing block reason ${reason}`);
}
if (review.ready_to_commit !== false) throw new Error("blocked review became commit-ready");
if (review.github_required !== false) throw new Error("GitHub became required");
' "$BLOCKED_JSON"

SAFE_DIR="$TMPROOT/safe-static-site"
mkdir -p "$SAFE_DIR/assets" "$SAFE_DIR/css"
printf '<html><body><h1>Safe</h1></body></html>\n' >"$SAFE_DIR/index.html"
printf 'body { color: #111; }\n' >"$SAFE_DIR/css/site.css"
printf 'not really a png, scan-only fixture\n' >"$SAFE_DIR/assets/photo.png"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/review" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"source_kind\":\"folder\",\"source_path\":\"$SAFE_DIR\"}" >"$SAFE_JSON"

SAFE_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.artifact_import.id);' "$SAFE_JSON")"

bun -e '
const data = await Bun.file(process.argv[1]).json();
const review = data.artifact_import;
if (review.status !== "ready") throw new Error("safe folder was not ready");
if (review.detected_shape !== "static_html_site") throw new Error("safe folder shape was not static_html_site");
if (review.plan.blocked.length !== 0) throw new Error("safe folder had blockers");
if (review.summary.import_count !== 3) throw new Error("safe folder import count mismatch");
' "$SAFE_JSON"

ZIP_DIR="$TMPROOT/zip-static-site"
mkdir -p "$ZIP_DIR/assets" "$ZIP_DIR/css" "$ZIP_DIR/__MACOSX"
printf '<html><body><h1>Zip</h1></body></html>\n' >"$ZIP_DIR/index.html"
printf 'body { color: #333; }\n' >"$ZIP_DIR/css/site.css"
printf '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n' >"$ZIP_DIR/assets/logo.svg"
printf 'metadata\n' >"$ZIP_DIR/__MACOSX/.DS_Store"
printf 'nested archive placeholder\n' >"$ZIP_DIR/nested.zip"
(cd "$ZIP_DIR" && zip -qr "$TMPROOT/artifact.zip" .)

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/review" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"source_kind\":\"zip\",\"source_path\":\"$TMPROOT/artifact.zip\"}" >"$ZIP_JSON"

bun -e '
const data = await Bun.file(process.argv[1]).json();
const review = data.artifact_import;
if (review.status !== "ready") throw new Error("zip review was not ready");
if (review.detected_shape !== "static_html_site") throw new Error("zip shape was not static_html_site");
if (!review.plan.will_skip.some((entry) => entry.reason === "macos_archive_metadata")) {
  throw new Error("zip review did not skip macOS archive metadata");
}
if (!review.plan.will_skip.some((entry) => entry.reason === "nested_archive")) {
  throw new Error("zip review did not skip nested archive");
}
' "$ZIP_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/artifact-imports/$SAFE_ID" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$FETCH_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/artifact-imports/$SAFE_ID/support-debug" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["<h1>", "API_TOKEN", "PRIVATE KEY", "bga2.", "dev-token", process.argv[2]]) {
  if (text.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support.artifact_import;
if (support.policy.scanned_before_commit !== true) throw new Error("support missing scan policy");
if (support.policy.commits_blocked_until_blockers_resolved !== true) throw new Error("support missing commit block policy");
if (support.policy.includes_raw_file_contents !== false) throw new Error("support claimed raw file contents");
if (support.summary.import_count !== 3) throw new Error("support import count mismatch");
' "$SUPPORT_JSON" "$TMPROOT"

echo "Gate 29 smoke passed for artifact import intake $SAFE_ID"
