#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-38.XXXXXX)"

make_assertion() {
  local account_ref="$1"
  local workspace_ref="$2"
  bun -e '
import { createHmac } from "node:crypto";
const payload = {
  iss: "factory.local",
  aud: "bittergit",
  sub: `account:${process.argv[1]}`,
  jti: `assertion-${process.argv[1]}-${Date.now()}-${Math.random()}`,
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
' "$account_ref" "$workspace_ref" "$BOOTSTRAP_TOKEN"
}

BLANK_ACCOUNT="acct-gate38-blank-$(date -u +%Y%m%d%H%M%S)-$$"
BLANK_WORKSPACE="wrk-gate38-blank-$$"
BLANK_ASSERTION="$(make_assertion "$BLANK_ACCOUNT" "$BLANK_WORKSPACE")"
BLANK_BUNDLE_JSON="$WORK_ROOT/blank-bundle.json"
BLANK_SESSION_JSON="$WORK_ROOT/blank-session.json"
BLANK_LAUNCH_JSON="$WORK_ROOT/blank-launch.json"
BLANK_FIRST_RUN_JSON="$WORK_ROOT/blank-first-run.json"
BLANK_SUPPORT_JSON="$WORK_ROOT/blank-support.json"
REPO_SUPPORT_JSON="$WORK_ROOT/repo-support.json"
CHECKPOINT_JSON="$WORK_ROOT/rehearsal-checkpoint.json"
RESTORE_JSON="$WORK_ROOT/restore.json"
EXPORT_JSON="$WORK_ROOT/export.json"
BLANK_CLONE="$WORK_ROOT/blank-clone"
EXPORT_REMOTE="$WORK_ROOT/export.git"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"name":"gate38-blank"}' >"$BLANK_BUNDLE_JSON"

BLANK_APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$BLANK_BUNDLE_JSON")"
BLANK_OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$BLANK_BUNDLE_JSON")"
BLANK_REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$BLANK_BUNDLE_JSON")"
BLANK_READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$BLANK_BUNDLE_JSON")"
BLANK_MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$BLANK_BUNDLE_JSON")"
BLANK_INITIAL_CHECKPOINT="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.checkpoint.id);' "$BLANK_BUNDLE_JSON")"
BLANK_INITIAL_SHA="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.checkpoint.commit_sha);' "$BLANK_BUNDLE_JSON")"

bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.github_required !== false) throw new Error("blank path required GitHub");
const tree = [...data.source_tree].sort().join(" ");
if (tree !== ".gitignore AGENTS.md APP.md docs/BITTERGRID_DEPLOYMENT_CONTRACT.md") throw new Error(`blank tree mismatch: ${tree}`);
if (data.plan.github_required !== false) throw new Error("blank plan required GitHub");
' "$BLANK_BUNDLE_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/workcell-sessions" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" >"$BLANK_SESSION_JSON"
BLANK_SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$BLANK_SESSION_JSON")"
bun -e '
const session = (await Bun.file(process.argv[1]).json()).session;
if (session.status !== "ready" || session.terminal_status !== "ready") throw new Error("blank terminal not ready");
if (!session.readiness_message.includes("GitHub is optional")) throw new Error("blank readiness missing GitHub optional");
if (session.agent_readiness.evidence.status !== "ready") throw new Error("agent readiness not ready");
if (!session.agent_readiness_checks.some((check) => check.check_name === "origin_is_bittergit" && check.status === "passed")) {
  throw new Error("origin readiness check missing");
}
' "$BLANK_SESSION_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/workcell-sessions/$BLANK_SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"provider":"codex"}' >"$BLANK_LAUNCH_JSON"
BLANK_LAUNCH_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.agent_launch.id);' "$BLANK_LAUNCH_JSON")"
curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/workcell-sessions/$BLANK_SESSION_ID/agent-launches/$BLANK_LAUNCH_ID/first-runs" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" >"$BLANK_FIRST_RUN_JSON"
bun -e '
const firstRun = (await Bun.file(process.argv[1]).json()).charter_first_run;
if (firstRun.status !== "charter_required") throw new Error("blank first run did not require charter");
if (!firstRun.first_run_prompt.includes("APP.md")) throw new Error("first run prompt missing APP.md");
if (!firstRun.readiness_output.includes("charter-only")) throw new Error("first run output missing charter-only posture");
' "$BLANK_FIRST_RUN_JSON"

git -c http.extraHeader="Authorization: Bearer $BLANK_READ_TOKEN" clone "$BASE_URL/$BLANK_OWNER/$BLANK_REPO.git" "$BLANK_CLONE" >/dev/null
git -C "$BLANK_CLONE" config user.email gate38@bittergit.local
git -C "$BLANK_CLONE" config user.name "Gate 38"
printf 'temporary rehearsal state\n' >"$BLANK_CLONE/rehearsal.txt"
git -C "$BLANK_CLONE" add rehearsal.txt
git -C "$BLANK_CLONE" commit -m "Add rehearsal state" >/dev/null
git -C "$BLANK_CLONE" -c http.extraHeader="Authorization: Bearer $BLANK_MAIN_TOKEN" push origin main >/dev/null

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$BLANK_OWNER/$BLANK_REPO/checkpoints" \
  -H "Authorization: Bearer $BLANK_MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Gate 38 rehearsal state","checkpoint_type":"gate38_rehearsal"}' >"$CHECKPOINT_JSON"
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$BLANK_OWNER/$BLANK_REPO/checkpoints/$BLANK_INITIAL_CHECKPOINT/restore" \
  -H "Authorization: Bearer $BLANK_MAIN_TOKEN" >"$RESTORE_JSON"
REMOTE_MAIN="$(git -c http.extraHeader="Authorization: Bearer $BLANK_READ_TOKEN" ls-remote "$BASE_URL/$BLANK_OWNER/$BLANK_REPO.git" refs/heads/main | awk '{print $1}')"
test "$REMOTE_MAIN" = "$BLANK_INITIAL_SHA"

git init --bare "$EXPORT_REMOTE" >/dev/null
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$BLANK_OWNER/$BLANK_REPO/exports" \
  -H "Authorization: Bearer $BLANK_MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"local_git\",\"destination_url\":\"$EXPORT_REMOTE\"}" >"$EXPORT_JSON"
bun -e '
const result = (await Bun.file(process.argv[1]).json()).export;
if (result.status !== "ok") throw new Error("export failed");
if (result.head_sha !== process.argv[2]) throw new Error("export did not preserve restored SHA");
' "$EXPORT_JSON" "$BLANK_INITIAL_SHA"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/support-debug" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" >"$BLANK_SUPPORT_JSON"
curl -fsS "$BASE_URL/bittergit/v1/repos/$BLANK_OWNER/$BLANK_REPO/support-debug" \
  -H "Authorization: Bearer $BLANK_READ_TOKEN" >"$REPO_SUPPORT_JSON"
bun -e '
const appText = await Bun.file(process.argv[1]).text();
const repoText = await Bun.file(process.argv[2]).text();
for (const forbidden of ["bgt_", "sk_live_", "bitterpass://accounts", "private log", "stacktrace"]) {
  if (appText.includes(forbidden) || repoText.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const appSupport = JSON.parse(appText).support;
if (appSupport.plan.github_required !== false) throw new Error("support plan required GitHub");
if (appSupport.workcell.ready_count !== 1) throw new Error("support missing ready workcell");
if (appSupport.agent.ready_count !== 1) throw new Error("support missing ready agent launch");
const repoSupport = JSON.parse(repoText).support;
if (repoSupport.source_history.ref_event_count < 4) throw new Error("repo support missing source history");
if (repoSupport.checkpoints.length < 2) throw new Error("repo support missing checkpoints");
' "$BLANK_SUPPORT_JSON" "$REPO_SUPPORT_JSON"

ZIP_ACCOUNT="acct-gate38-zip-$(date -u +%Y%m%d%H%M%S)-$$"
ZIP_WORKSPACE="wrk-gate38-zip-$$"
ZIP_ASSERTION="$(make_assertion "$ZIP_ACCOUNT" "$ZIP_WORKSPACE")"
ZIP_SRC="$WORK_ROOT/zip-src"
ZIP_PATH="$WORK_ROOT/import.zip"
ZIP_REVIEW_JSON="$WORK_ROOT/zip-review.json"
ZIP_BUNDLE_JSON="$WORK_ROOT/zip-bundle.json"
ZIP_SESSION_JSON="$WORK_ROOT/zip-session.json"
ZIP_LAUNCH_JSON="$WORK_ROOT/zip-launch.json"
ZIP_FIRST_RUN_JSON="$WORK_ROOT/zip-first-run.json"
mkdir -p "$ZIP_SRC/assets"
printf '<!doctype html><html><body><h1>Imported zip site</h1><img src="assets/hero.png"></body></html>\n' >"$ZIP_SRC/index.html"
printf 'zip image bytes\n' >"$ZIP_SRC/assets/hero.png"
(cd "$ZIP_SRC" && zip -qr "$ZIP_PATH" .)

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/review" \
  -H "X-Bitter-Account-Assertion: $ZIP_ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"source_kind\":\"zip\",\"source_path\":\"$ZIP_PATH\"}" >"$ZIP_REVIEW_JSON"
ZIP_IMPORT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.artifact_import.id);' "$ZIP_REVIEW_JSON")"
bun -e '
const review = (await Bun.file(process.argv[1]).json()).artifact_import;
if (review.status !== "ready") throw new Error("zip review not ready");
if (review.ready_to_commit !== true) throw new Error("zip review not ready to commit");
if (!["static_html_site", "single_html_artifact"].includes(review.detected_shape)) throw new Error("zip detected shape mismatch");
' "$ZIP_REVIEW_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/$ZIP_IMPORT_ID/app-bundle" \
  -H "X-Bitter-Account-Assertion: $ZIP_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"name":"gate38-zip"}' >"$ZIP_BUNDLE_JSON"
ZIP_APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$ZIP_BUNDLE_JSON")"
bun -e '
const bundle = await Bun.file(process.argv[1]).json();
if (bundle.github_required !== false || bundle.plan.github_required !== false) throw new Error("zip path required GitHub");
for (const path of ["AGENTS.md", "APP.md", ".gitignore", "index.html", "assets/hero.png"]) {
  if (!bundle.source_tree.includes(path)) throw new Error(`zip source missing ${path}`);
}
if (bundle.artifact_import.detected_shape !== "static_html_site" && bundle.artifact_import.detected_shape !== "single_html_artifact") {
  throw new Error("zip bundle source shape mismatch");
}
' "$ZIP_BUNDLE_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$ZIP_APP_ID/workcell-sessions" \
  -H "X-Bitter-Account-Assertion: $ZIP_ASSERTION" >"$ZIP_SESSION_JSON"
ZIP_SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$ZIP_SESSION_JSON")"
curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$ZIP_APP_ID/workcell-sessions/$ZIP_SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ZIP_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"provider":"claude"}' >"$ZIP_LAUNCH_JSON"
ZIP_LAUNCH_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.agent_launch.id);' "$ZIP_LAUNCH_JSON")"
curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$ZIP_APP_ID/workcell-sessions/$ZIP_SESSION_ID/agent-launches/$ZIP_LAUNCH_ID/first-runs" \
  -H "X-Bitter-Account-Assertion: $ZIP_ASSERTION" >"$ZIP_FIRST_RUN_JSON"
bun -e '
const session = (await Bun.file(process.argv[1]).json()).session;
if (session.status !== "ready" || session.agent_readiness.evidence.status !== "ready") throw new Error("zip session not ready");
if (!session.readiness_message.includes("GitHub is optional")) throw new Error("zip readiness missing GitHub optional");
const launch = (await Bun.file(process.argv[2]).json()).agent_launch;
if (launch.status !== "ready") throw new Error("zip agent launch not ready");
const firstRun = (await Bun.file(process.argv[3]).json()).charter_first_run;
if (firstRun.source_kind !== "artifact_import") throw new Error("zip first run missing artifact context");
if (firstRun.artifact_import_inspected !== true) throw new Error("zip artifact import not inspected");
if (!firstRun.readiness_output.includes("Imported artifact review is recorded")) throw new Error("zip first run missing import readiness");
' "$ZIP_SESSION_JSON" "$ZIP_LAUNCH_JSON" "$ZIP_FIRST_RUN_JSON"

rg "scripts/smoke-gate-38-end-to-end-one-app-launch.sh" scripts/smoke-all.sh >/dev/null

echo "Gate 38 smoke passed for blank and zip one-app launch rehearsal"
