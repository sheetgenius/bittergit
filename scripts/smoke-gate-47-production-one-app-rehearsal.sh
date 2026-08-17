#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
STAMP="$(date -u +%Y%m%d%H%M%S)-$$"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-47.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

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

assert_clean_text() {
  local file="$1"
  shift
  for forbidden in "$@"; do
    if rg "$forbidden" "$file" >/dev/null; then
      echo "$file leaked forbidden content: $forbidden" >&2
      exit 1
    fi
  done
}

BLANK_ACCOUNT="acct-gate47-blank-$STAMP"
BLANK_WORKSPACE="wrk-gate47-blank-$$"
BLANK_ASSERTION="$(make_assertion "$BLANK_ACCOUNT" "$BLANK_WORKSPACE")"
BLANK_BUNDLE_JSON="$WORK_ROOT/blank-bundle.json"
BLANK_PROGRESS_JSON="$WORK_ROOT/blank-progress.json"
BLANK_SESSION_JSON="$WORK_ROOT/blank-session.json"
BLANK_TERMINAL_HTML="$WORK_ROOT/blank-terminal.html"
BLANK_LAUNCH_JSON="$WORK_ROOT/blank-launch.json"
BLANK_FIRST_RUN_JSON="$WORK_ROOT/blank-first-run.json"
BLANK_MISSING_SECRETS_JSON="$WORK_ROOT/blank-missing-secrets.json"
BLANK_SECRET_GRANT_JSON="$WORK_ROOT/blank-secret-grant.json"
BLANK_READY_SECRETS_JSON="$WORK_ROOT/blank-ready-secrets.json"
BLANK_GRID_REQUEST_JSON="$WORK_ROOT/blank-grid-request.json"
BLANK_GRID_CALLBACK_JSON="$WORK_ROOT/blank-grid-callback.json"
BLANK_CHECKPOINT_JSON="$WORK_ROOT/blank-checkpoint.json"
BLANK_RESTORE_JSON="$WORK_ROOT/blank-restore.json"
BLANK_EXPORT_JSON="$WORK_ROOT/blank-export.json"
BLANK_SUPPORT_JSON="$WORK_ROOT/blank-support.json"
BLANK_REPO_SUPPORT_JSON="$WORK_ROOT/blank-repo-support.json"
BLANK_EVENTS_JSON="$WORK_ROOT/blank-events.json"
BLANK_CLONE="$WORK_ROOT/blank-clone"
BLANK_EXPORT_REMOTE="$WORK_ROOT/blank-export.git"
SECRET_NAME="STRIPE_SECRET_KEY"
CREDENTIAL_REF="bitterpass://accounts/$BLANK_ACCOUNT/apps/gate47-blank/secrets/$SECRET_NAME/should-not-leak"
GRANT_TOKEN="grant_token_gate47_should_not_leak"
VAULT_OUTPUT="private_vault_output_gate47_should_not_leak"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"name":"gate47-blank","display_name":"Gate 47 Blank"}' >"$BLANK_BUNDLE_JSON"

BLANK_APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$BLANK_BUNDLE_JSON")"
BLANK_OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$BLANK_BUNDLE_JSON")"
BLANK_REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$BLANK_BUNDLE_JSON")"
BLANK_READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$BLANK_BUNDLE_JSON")"
BLANK_MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$BLANK_BUNDLE_JSON")"
BLANK_INITIAL_CHECKPOINT="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.checkpoint.id);' "$BLANK_BUNDLE_JSON")"
BLANK_INITIAL_SHA="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.checkpoint.commit_sha);' "$BLANK_BUNDLE_JSON")"

bun -e '
const bundle = await Bun.file(process.argv[1]).json();
if (bundle.github_required !== false || bundle.plan.github_required !== false) throw new Error("blank app required GitHub");
const tree = [...bundle.source_tree].sort().join(" ");
if (tree !== ".gitignore AGENTS.md APP.md docs/BITTERGRID_DEPLOYMENT_CONTRACT.md") throw new Error(`blank scaffold mismatch: ${tree}`);
' "$BLANK_BUNDLE_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/setup/progress" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" >"$BLANK_PROGRESS_JSON"
bun -e '
const progress = (await Bun.file(process.argv[1]).json()).progress;
if (progress.status !== "ready" || progress.progress_percent !== 100) throw new Error("blank setup progress was not ready");
if (progress.polling.mode !== "stable_poll") throw new Error("blank setup progress was not pollable");
if (!String(progress.user_message).includes("APP.md")) throw new Error("blank setup progress missing charter guidance");
if (!progress.steps.some((step) => step.label === "Source repository" && step.owner_plane === "BitterGit")) {
  throw new Error("blank setup progress missing source repository step");
}
' "$BLANK_PROGRESS_JSON"
assert_clean_text "$BLANK_PROGRESS_JSON" "bgt_" "bga2\\." "sk-" "private log" "raw source" "$CREDENTIAL_REF" "$GRANT_TOKEN" "$VAULT_OUTPUT"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/workcell-sessions" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"terminal_fulfillment":{"mode":"dedicated_box","box_ref":"grid-host-01"}}' >"$BLANK_SESSION_JSON"

BLANK_SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$BLANK_SESSION_JSON")"
BLANK_SOURCE_ROOT="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.source_root);' "$BLANK_SESSION_JSON")"
BLANK_TERMINAL_URL="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.terminal_url);' "$BLANK_SESSION_JSON")"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["bgt_", "BEGIN OPENSSH", "PRIVATE KEY", "@github.com", "github_pat_", "sk-"]) {
  if (text.includes(forbidden)) throw new Error(`blank session leaked ${forbidden}`);
}
const session = JSON.parse(text).session;
if (session.status !== "ready" || session.terminal_status !== "ready") throw new Error("blank dedicated terminal was not ready");
if (session.account_ref !== process.argv[2]) throw new Error("blank session account scope mismatch");
if (session.app_id !== process.argv[3]) throw new Error("blank session app scope mismatch");
if (!session.readiness_message.includes("GitHub is optional")) throw new Error("blank readiness missing GitHub optional");
if (!session.readiness_message.includes("APP.md")) throw new Error("blank readiness missing charter guidance");
const fulfillment = session.terminal_fulfillment;
if (fulfillment.provider !== "bittergrid_dedicated_box_contract") throw new Error("blank session missing dedicated-box provider");
if (fulfillment.mode !== "dedicated_box_local_adapter") throw new Error("blank session missing dedicated-box local adapter");
if (fulfillment.box_ref !== "grid-host-01") throw new Error("blank session box ref mismatch");
if (fulfillment.dedicated_box_requested !== true) throw new Error("blank session did not request dedicated box");
if (fulfillment.credential_delivery !== "run_scoped_git_credential_helper") throw new Error("blank session credential delivery mismatch");
if (fulfillment.token_in_url !== false || fulfillment.clone_url_has_token !== false) throw new Error("blank session token URL posture failed");
const ssh = session.production_ssh;
if (ssh.mode !== "read_only" || ssh.write_enabled !== false) throw new Error("blank production SSH was not read-only by default");
if (ssh.read_only_diagnostics_enabled !== true) throw new Error("blank read-only diagnostics missing");
if (ssh.credential_material_returned !== false || ssh.key_material_returned !== false) throw new Error("blank production SSH returned material");
if (!session.agent_readiness_checks.some((check) => check.check_name === "origin_is_bittergit" && check.status === "passed")) {
  throw new Error("blank origin readiness check missing");
}
' "$BLANK_SESSION_JSON" "$BLANK_ACCOUNT" "$BLANK_APP_ID"

test -f "$BLANK_SOURCE_ROOT/AGENTS.md"
test -f "$BLANK_SOURCE_ROOT/APP.md"
REMOTE_URL="$(git -C "$BLANK_SOURCE_ROOT" remote get-url origin)"
test "$REMOTE_URL" = "$BASE_URL/$BLANK_OWNER/$BLANK_REPO.git"
if [[ "$REMOTE_URL" == *"bgt_"* || "$REMOTE_URL" == *"github.com"* || "$REMOTE_URL" == *"@"* ]]; then
  echo "blank origin remote leaked token material or pointed at GitHub" >&2
  exit 1
fi
test -x "$(git -C "$BLANK_SOURCE_ROOT" config --get credential.helper)"

curl -fsS "$BLANK_TERMINAL_URL" >"$BLANK_TERMINAL_HTML"
rg "Terminal mode" "$BLANK_TERMINAL_HTML" >/dev/null
rg "dedicated_box_local_adapter" "$BLANK_TERMINAL_HTML" >/dev/null
rg "Production SSH" "$BLANK_TERMINAL_HTML" >/dev/null
assert_clean_text "$BLANK_TERMINAL_HTML" "bgt_" "BEGIN OPENSSH" "PRIVATE KEY" "github.com" "sk-"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/workcell-sessions/$BLANK_SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"provider":"codex","provider_cli":{"available":true,"command":"codex","source":"grid_workcell_mount"},"provider_auth":{"status":"mounted","source":"local_cli_subscription","credential_ref":"cred_gate47_codex_should_not_leak","auth_file":"/auth-src/gate47/provider-auth.json"}}' >"$BLANK_LAUNCH_JSON"
BLANK_LAUNCH_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.agent_launch.id);' "$BLANK_LAUNCH_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/workcell-sessions/$BLANK_SESSION_ID/agent-launches/$BLANK_LAUNCH_ID/first-runs" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" >"$BLANK_FIRST_RUN_JSON"
BLANK_FIRST_RUN_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.charter_first_run.id);' "$BLANK_FIRST_RUN_JSON")"

bun -e '
const combined = `${await Bun.file(process.argv[1]).text()}\n${await Bun.file(process.argv[2]).text()}`;
for (const forbidden of ["cred_gate47_codex_should_not_leak", "/auth-src/", "provider-auth.json", "sk-", "bgt_", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
  if (combined.includes(forbidden)) throw new Error(`agent launch leaked ${forbidden}`);
}
const launch = JSON.parse(await Bun.file(process.argv[1]).text()).agent_launch;
if (launch.status !== "ready") throw new Error("blank agent launch was not ready");
if (launch.provider_auth.reference_present !== true || launch.provider_auth.reference_returned !== false) {
  throw new Error("blank provider auth reference posture wrong");
}
const firstRun = JSON.parse(await Bun.file(process.argv[2]).text()).charter_first_run;
if (firstRun.status !== "charter_required") throw new Error("blank first run did not require charter");
if (!firstRun.first_run_prompt.includes("APP.md")) throw new Error("blank first run missing APP.md");
if (!firstRun.readiness_output.includes("charter-only")) throw new Error("blank first run missing charter-only posture");
' "$BLANK_LAUNCH_JSON" "$BLANK_FIRST_RUN_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/secret-materialization-readiness?environment=production" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" >"$BLANK_MISSING_SECRETS_JSON"
bun -e '
const readiness = (await Bun.file(process.argv[1]).json()).readiness;
if (readiness.status !== "missing_grants") throw new Error("secret readiness was not repairably missing");
if (!String(readiness.repair_action).includes("Create first-run secret grants")) throw new Error("missing secret repair action absent");
' "$BLANK_MISSING_SECRETS_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/workcell-sessions/$BLANK_SESSION_ID/agent-launches/$BLANK_LAUNCH_ID/first-runs/$BLANK_FIRST_RUN_ID/secret-grants" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$SECRET_NAME\",\"environment\":\"production\",\"purpose\":\"Gate 47 checkout integration rehearsal after charter approval.\",\"credential_ref\":\"$CREDENTIAL_REF\",\"grant_token\":\"$GRANT_TOKEN\",\"private_vault_output\":\"$VAULT_OUTPUT\"}" >"$BLANK_SECRET_GRANT_JSON"
assert_clean_text "$BLANK_SECRET_GRANT_JSON" "$CREDENTIAL_REF" "$GRANT_TOKEN" "$VAULT_OUTPUT" "sk-" "bgt_"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/secret-materialization-readiness?environment=production" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" >"$BLANK_READY_SECRETS_JSON"
bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of [process.argv[2], process.argv[3], process.argv[4]]) {
  if (text.includes(forbidden)) throw new Error(`secret readiness leaked ${forbidden}`);
}
const readiness = JSON.parse(text).readiness;
if (readiness.status !== "ready") throw new Error("secret materialization was not ready");
if (readiness.workcell.status !== "delegated_to_bitterpass") throw new Error("workcell materialization not delegated");
if (readiness.deploy.status !== "delegated_to_bitterpass") throw new Error("deploy materialization not delegated");
' "$BLANK_READY_SECRETS_JSON" "$CREDENTIAL_REF" "$GRANT_TOKEN" "$VAULT_OUTPUT"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/grid-publish-requests" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"preview\",\"commit_sha\":\"$BLANK_INITIAL_SHA\",\"checkpoint_id\":\"$BLANK_INITIAL_CHECKPOINT\",\"callback_mode\":true}" >"$BLANK_GRID_REQUEST_JSON"
GRID_REQUEST_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.grid_publish.id);' "$BLANK_GRID_REQUEST_JSON")"
GRID_OPERATION_REF="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.grid_publish.grid_operation_ref);' "$BLANK_GRID_REQUEST_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/grid/publish-requests/$GRID_REQUEST_ID/callback" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"grid_operation_ref\":\"$GRID_OPERATION_REF\",\"commit_sha\":\"$BLANK_INITIAL_SHA\",\"status\":\"verified\",\"published_url\":\"https://preview.gate47.bittergrid.local/$GRID_REQUEST_ID\",\"verification_status\":\"passed\",\"grid_receipt_id\":\"grid_receipt_gate47_blank\"}" >"$BLANK_GRID_CALLBACK_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.grid_publish.status !== "verified") throw new Error("Grid callback did not verify");
if (data.grid_publish.callback_status !== "verified") throw new Error("Grid callback status missing");
if (data.receipt.receipt_type !== "grid_publish_callback") throw new Error("Grid callback receipt missing");
if (data.receipt.body.private_logs_included !== false) throw new Error("Grid callback included private logs");
' "$BLANK_GRID_CALLBACK_JSON"
assert_clean_text "$BLANK_GRID_CALLBACK_JSON" "private log" "stacktrace" "sk-" "bgt_"

git -c http.extraHeader="Authorization: Bearer $BLANK_READ_TOKEN" clone "$BASE_URL/$BLANK_OWNER/$BLANK_REPO.git" "$BLANK_CLONE" >/dev/null
git -C "$BLANK_CLONE" config user.email gate47@bittergit.local
git -C "$BLANK_CLONE" config user.name "BitterGit Gate 47"
printf 'gate 47 production rehearsal state\n' >"$BLANK_CLONE/rehearsal.txt"
git -C "$BLANK_CLONE" add rehearsal.txt
git -C "$BLANK_CLONE" commit -m "Add Gate 47 rehearsal state" >/dev/null
git -C "$BLANK_CLONE" -c http.extraHeader="Authorization: Bearer $BLANK_MAIN_TOKEN" push origin main >/dev/null

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$BLANK_OWNER/$BLANK_REPO/checkpoints" \
  -H "Authorization: Bearer $BLANK_MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Gate 47 rehearsal state","checkpoint_type":"gate47_rehearsal"}' >"$BLANK_CHECKPOINT_JSON"
NEW_CHECKPOINT="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.id);' "$BLANK_CHECKPOINT_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$BLANK_OWNER/$BLANK_REPO/checkpoints/$BLANK_INITIAL_CHECKPOINT/restore" \
  -H "Authorization: Bearer $BLANK_MAIN_TOKEN" >"$BLANK_RESTORE_JSON"
REMOTE_MAIN="$(git -c http.extraHeader="Authorization: Bearer $BLANK_READ_TOKEN" ls-remote "$BASE_URL/$BLANK_OWNER/$BLANK_REPO.git" refs/heads/main | awk '{print $1}')"
test "$REMOTE_MAIN" = "$BLANK_INITIAL_SHA"

git init --bare "$BLANK_EXPORT_REMOTE" >/dev/null
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$BLANK_OWNER/$BLANK_REPO/exports" \
  -H "Authorization: Bearer $BLANK_MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"local_git\",\"destination_url\":\"$BLANK_EXPORT_REMOTE\"}" >"$BLANK_EXPORT_JSON"
bun -e '
const result = (await Bun.file(process.argv[1]).json()).export;
if (result.status !== "ok") throw new Error("blank export failed");
if (result.head_sha !== process.argv[2]) throw new Error("blank export did not preserve restored SHA");
' "$BLANK_EXPORT_JSON" "$BLANK_INITIAL_SHA"

curl -fsS "$BASE_URL/bittergit/v1/repos/$BLANK_OWNER/$BLANK_REPO/events" \
  -H "Authorization: Bearer $BLANK_READ_TOKEN" >"$BLANK_EVENTS_JSON"
curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$BLANK_APP_ID/support-debug" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" >"$BLANK_SUPPORT_JSON"
curl -fsS "$BASE_URL/bittergit/v1/repos/$BLANK_OWNER/$BLANK_REPO/support-debug" \
  -H "Authorization: Bearer $BLANK_READ_TOKEN" >"$BLANK_REPO_SUPPORT_JSON"

bun -e '
const files = process.argv.slice(1, 4);
const combined = (await Promise.all(files.map((file) => Bun.file(file).text()))).join("\n");
for (const forbidden of [
  process.argv[4],
  process.argv[5],
  process.argv[6],
  "bgt_",
  "bga2.",
  "BEGIN OPENSSH",
  "PRIVATE KEY",
  "private log",
  "stacktrace",
  "sk-",
  "github_pat_"
]) {
  if (combined.includes(forbidden)) throw new Error(`support/events leaked ${forbidden}`);
}
const events = JSON.parse(await Bun.file(process.argv[1]).text()).events;
if (events.length < 3) throw new Error("source history events missing");
const appSupport = JSON.parse(await Bun.file(process.argv[2]).text()).support;
if (appSupport.plan.github_required !== false) throw new Error("app support required GitHub");
if (appSupport.workcell.ready_count < 1) throw new Error("app support missing ready workcell");
if (appSupport.agent.ready_count < 1) throw new Error("app support missing ready agent launch");
if (appSupport.secret.materialization_readiness.status !== "ready") throw new Error("app support secret readiness not ready");
if (appSupport.deploy.grid_publish_count < 1) throw new Error("app support missing Grid publish state");
const repoSupport = JSON.parse(await Bun.file(process.argv[3]).text()).support;
if (!repoSupport.setup_progress || repoSupport.setup_progress.progress_percent !== 100) throw new Error("repo support missing setup progress");
if (repoSupport.source_history.ref_event_count < 3) throw new Error("repo support missing source history");
if (!repoSupport.checkpoints.some((checkpoint) => checkpoint.id === process.argv[7])) throw new Error("repo support missing new checkpoint");
if (!repoSupport.receipts.some((receipt) => receipt.receipt_type === "grid_publish_callback")) throw new Error("repo support missing Grid callback receipt");
if (!repoSupport.grid_publish_requests.some((entry) => entry.callback_status === "verified")) throw new Error("repo support missing verified Grid callback");
if (!repoSupport.pass_materialization_readiness || repoSupport.pass_materialization_readiness.status !== "ready") {
  throw new Error("repo support missing pass materialization readiness");
}
' "$BLANK_EVENTS_JSON" "$BLANK_SUPPORT_JSON" "$BLANK_REPO_SUPPORT_JSON" "$CREDENTIAL_REF" "$GRANT_TOKEN" "$VAULT_OUTPUT" "$NEW_CHECKPOINT"

ZIP_ACCOUNT="acct-gate47-zip-$STAMP"
ZIP_WORKSPACE="wrk-gate47-zip-$$"
ZIP_ASSERTION="$(make_assertion "$ZIP_ACCOUNT" "$ZIP_WORKSPACE")"
ZIP_SRC="$WORK_ROOT/zip-src"
ZIP_PATH="$WORK_ROOT/import.zip"
ZIP_REVIEW_JSON="$WORK_ROOT/zip-review.json"
ZIP_BUNDLE_JSON="$WORK_ROOT/zip-bundle.json"
ZIP_PROGRESS_JSON="$WORK_ROOT/zip-progress.json"
ZIP_SESSION_JSON="$WORK_ROOT/zip-session.json"
ZIP_LAUNCH_JSON="$WORK_ROOT/zip-launch.json"
ZIP_FIRST_RUN_JSON="$WORK_ROOT/zip-first-run.json"
ZIP_SUPPORT_JSON="$WORK_ROOT/zip-support.json"

mkdir -p "$ZIP_SRC/assets"
printf '<!doctype html><html><body><h1>Gate 47 imported artifact</h1><img src="assets/hero.svg"></body></html>\n' >"$ZIP_SRC/index.html"
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>\n' >"$ZIP_SRC/assets/hero.svg"
printf 'temporary mac junk\n' >"$ZIP_SRC/.DS_Store"
(cd "$ZIP_SRC" && zip -qr "$ZIP_PATH" .)

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/review" \
  -H "X-Bitter-Account-Assertion: $ZIP_ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"source_kind\":\"zip\",\"source_path\":\"$ZIP_PATH\"}" >"$ZIP_REVIEW_JSON"
ZIP_IMPORT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.artifact_import.id);' "$ZIP_REVIEW_JSON")"

bun -e '
const review = (await Bun.file(process.argv[1]).json()).artifact_import;
if (review.status !== "ready" || review.ready_to_commit !== true) throw new Error("zip import review was not ready");
if (!["static_html_site", "single_html_artifact"].includes(review.detected_shape)) throw new Error("zip import shape mismatch");
if (!review.plan.will_skip.some((file) => file.path === ".DS_Store" && file.reason === "macos_metadata")) {
  throw new Error("zip import did not report skipped junk");
}
' "$ZIP_REVIEW_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/$ZIP_IMPORT_ID/app-bundle" \
  -H "X-Bitter-Account-Assertion: $ZIP_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"name":"gate47-zip","display_name":"Gate 47 Zip"}' >"$ZIP_BUNDLE_JSON"
ZIP_APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$ZIP_BUNDLE_JSON")"
ZIP_OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$ZIP_BUNDLE_JSON")"
ZIP_REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$ZIP_BUNDLE_JSON")"
ZIP_READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$ZIP_BUNDLE_JSON")"

bun -e '
const bundle = await Bun.file(process.argv[1]).json();
if (bundle.github_required !== false || bundle.plan.github_required !== false) throw new Error("zip app required GitHub");
for (const path of ["AGENTS.md", "APP.md", ".gitignore", "index.html", "assets/hero.svg"]) {
  if (!bundle.source_tree.includes(path)) throw new Error(`zip source missing ${path}`);
}
if (bundle.source_tree.includes(".DS_Store")) throw new Error("zip source committed skipped junk");
' "$ZIP_BUNDLE_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$ZIP_APP_ID/setup/progress" \
  -H "X-Bitter-Account-Assertion: $ZIP_ASSERTION" >"$ZIP_PROGRESS_JSON"
bun -e '
const progress = (await Bun.file(process.argv[1]).json()).progress;
if (progress.status !== "ready" || progress.progress_percent !== 100) throw new Error("zip setup progress was not ready");
if (!progress.steps.some((step) => step.label === "Import review" && step.owner_plane === "Factory")) {
  throw new Error("zip setup progress missing import review owner plane");
}
if (!progress.steps.some((step) => step.label === "Imported files" && step.owner_plane === "BitterGit")) {
  throw new Error("zip setup progress missing imported files step");
}
' "$ZIP_PROGRESS_JSON"
assert_clean_text "$ZIP_PROGRESS_JSON" "bgt_" "bga2\\." "sk-" "private log" "raw source"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$ZIP_APP_ID/workcell-sessions" \
  -H "X-Bitter-Account-Assertion: $ZIP_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"terminal_fulfillment":{"mode":"dedicated_box","box_ref":"grid-host-01"}}' >"$ZIP_SESSION_JSON"
ZIP_SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$ZIP_SESSION_JSON")"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["bgt_", "BEGIN OPENSSH", "PRIVATE KEY", "@github.com", "github_pat_", "sk-"]) {
  if (text.includes(forbidden)) throw new Error(`zip session leaked ${forbidden}`);
}
const session = JSON.parse(text).session;
if (session.status !== "ready" || session.terminal_status !== "ready") throw new Error("zip dedicated terminal was not ready");
if (session.terminal_fulfillment.provider !== "bittergrid_dedicated_box_contract") throw new Error("zip session missing dedicated provider");
if (session.terminal_fulfillment.dedicated_box_requested !== true) throw new Error("zip session did not request dedicated box");
if (session.production_ssh.mode !== "read_only" || session.production_ssh.write_enabled !== false) {
  throw new Error("zip production SSH was not read-only by default");
}
if (!session.readiness_message.includes("GitHub is optional")) throw new Error("zip readiness missing GitHub optional");
' "$ZIP_SESSION_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$ZIP_APP_ID/workcell-sessions/$ZIP_SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ZIP_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"provider":"claude","provider_cli":{"available":true,"command":"claude","source":"grid_workcell_mount"},"provider_auth":{"status":"mounted","source":"local_cli_subscription"}}' >"$ZIP_LAUNCH_JSON"
ZIP_LAUNCH_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.agent_launch.id);' "$ZIP_LAUNCH_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$ZIP_APP_ID/workcell-sessions/$ZIP_SESSION_ID/agent-launches/$ZIP_LAUNCH_ID/first-runs" \
  -H "X-Bitter-Account-Assertion: $ZIP_ASSERTION" >"$ZIP_FIRST_RUN_JSON"

bun -e '
const launch = (await Bun.file(process.argv[1]).json()).agent_launch;
if (launch.status !== "ready") throw new Error("zip agent launch was not ready");
const firstRun = (await Bun.file(process.argv[2]).json()).charter_first_run;
if (firstRun.status !== "charter_required") throw new Error("zip first run did not require charter");
if (firstRun.source_kind !== "artifact_import") throw new Error("zip first run missing artifact context");
if (firstRun.artifact_import_inspected !== true) throw new Error("zip artifact import was not inspected");
if (!firstRun.readiness_output.includes("Imported artifact review is recorded")) {
  throw new Error("zip first run missing imported-artifact readiness");
}
' "$ZIP_LAUNCH_JSON" "$ZIP_FIRST_RUN_JSON"
assert_clean_text "$ZIP_LAUNCH_JSON" "bgt_" "sk-" "OPENAI_API_KEY" "ANTHROPIC_API_KEY" "provider-auth.json" "/auth-src/"

curl -fsS "$BASE_URL/bittergit/v1/repos/$ZIP_OWNER/$ZIP_REPO/support-debug" \
  -H "Authorization: Bearer $ZIP_READ_TOKEN" >"$ZIP_SUPPORT_JSON"
bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["bgt_", "bga2.", "BEGIN OPENSSH", "PRIVATE KEY", "private log", "stacktrace", "sk-", "github_pat_"]) {
  if (text.includes(forbidden)) throw new Error(`zip support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
if (support.plan.github_required !== false) throw new Error("zip support required GitHub");
if (!support.setup_progress || support.setup_progress.progress_percent !== 100) throw new Error("zip support missing setup progress");
if (!support.hosted_workcell_sessions.some((session) => session.id === process.argv[2] && session.terminal_fulfillment.dedicated_box_requested === true)) {
  throw new Error("zip support missing dedicated session");
}
if (!support.hosted_agent_launches.some((launch) => launch.status === "ready")) throw new Error("zip support missing ready agent launch");
' "$ZIP_SUPPORT_JSON" "$ZIP_SESSION_ID"

rg "scripts/smoke-gate-47-production-one-app-rehearsal.sh" scripts/smoke-all.sh >/dev/null

echo "Gate 47 smoke passed for production one-app rehearsal on blank $BLANK_OWNER/$BLANK_REPO and zip $ZIP_OWNER/$ZIP_REPO"
