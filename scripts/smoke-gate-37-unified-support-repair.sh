#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-37.XXXXXX)"
ARTIFACT_DIR="$WORK_ROOT/artifact"
IMPORT_JSON="$WORK_ROOT/import.json"
BUNDLE_JSON="$WORK_ROOT/bundle.json"
SESSION_JSON="$WORK_ROOT/session.json"
LAUNCH_JSON="$WORK_ROOT/launch.json"
BAD_LAUNCH_JSON="$WORK_ROOT/bad-launch.json"
FIRST_RUN_JSON="$WORK_ROOT/first-run.json"
SECRET_GRANT_JSON="$WORK_ROOT/secret-grant.json"
PUBLISH_JSON="$WORK_ROOT/publish-failed.json"
SUPPORT_JSON="$WORK_ROOT/support.json"
ACCOUNT_REF="acct-gate37-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate37-$$"

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

mkdir -p "$ARTIFACT_DIR"
printf '<!doctype html><html><body><h1>Gate 37 Imported Offer</h1></body></html>\n' >"$ARTIFACT_DIR/index.html"
printf 'body { color: #222; }\n' >"$ARTIFACT_DIR/site.css"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/review" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"source_kind\":\"folder\",\"source_path\":\"$ARTIFACT_DIR\"}" >"$IMPORT_JSON"
IMPORT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.artifact_import.id);' "$IMPORT_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/$IMPORT_ID/app-bundle" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"name":"gate37-imported"}' >"$BUNDLE_JSON"
APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$BUNDLE_JSON")"
COMMIT_SHA="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.checkpoint.commit_sha);' "$BUNDLE_JSON")"
CHECKPOINT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.checkpoint.id);' "$BUNDLE_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$SESSION_JSON"
SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$SESSION_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"provider":"codex"}' >"$LAUNCH_JSON"
LAUNCH_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.agent_launch.id);' "$LAUNCH_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"provider":"unknown-ai"}' >"$BAD_LAUNCH_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches/$LAUNCH_ID/first-runs" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$FIRST_RUN_JSON"
FIRST_RUN_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.charter_first_run.id);' "$FIRST_RUN_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches/$LAUNCH_ID/first-runs/$FIRST_RUN_ID/secret-grants" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"POSTMARK_API_KEY\",\"environment\":\"production\",\"purpose\":\"Email sending after user approves implementation.\",\"credential_ref\":\"bitterpass://accounts/$ACCOUNT_REF/apps/$APP_ID/secrets/POSTMARK_API_KEY\"}" >"$SECRET_GRANT_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/grid-publish-requests" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"preview\",\"commit_sha\":\"$COMMIT_SHA\",\"checkpoint_id\":\"$CHECKPOINT_ID\",\"simulate_status\":\"failed\"}" >"$PUBLISH_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/support-debug" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["bgt_", "sk_live_", "bitterpass://accounts", "Gate 37 Imported Offer", "private log", "stacktrace"]) {
  if (text.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
if (support.account.account_ref !== process.argv[2]) throw new Error("account ref mismatch");
if (support.plan.github_required !== false) throw new Error("plan made GitHub required");
if (!support.repo.clone_url.includes(process.argv[3])) throw new Error("repo summary missing app slug");
if (support.setup.status !== "ready") throw new Error("setup was not ready");
if (support.import.source_kind !== "artifact_import") throw new Error("import summary missing");
if (support.import.blocked_count !== 0) throw new Error("import summary had blockers");
if (support.workcell.hosted_session_count !== 1 || support.workcell.ready_count !== 1) throw new Error("workcell summary mismatch");
if (support.terminal.latest_status !== "ready" || support.terminal.token_in_url !== false) throw new Error("terminal summary mismatch");
if (support.agent.launch_count !== 2 || support.agent.blocked_count !== 1) throw new Error("agent summary mismatch");
if (support.charter_first_run.charter_required_count !== 1) throw new Error("charter summary mismatch");
if (support.secret.secret_ref_count !== 1 || support.secret.delegated_to_bitterpass_count !== 1) throw new Error("secret summary mismatch");
if (support.deploy.grid_publish_count !== 1 || support.deploy.repair_required_count !== 1) throw new Error("deploy summary mismatch");
if (support.deploy.latest_restore_candidate.checkpoint_id !== process.argv[4]) throw new Error("deploy restore candidate missing");
if (support.repair.overall_status !== "needs_repair") throw new Error("repair overall status mismatch");
for (const plane of ["Factory", "CustomerApp", "BitterGrid"]) {
  if (!support.repair.items.some((item) => item.plane === plane && item.repair_action.length > 0)) {
    throw new Error(`repair item missing owner plane ${plane}`);
  }
}
if (support.support_policy.includes_secret_values !== false) throw new Error("support includes secret values");
if (support.support_policy.includes_tokens !== false) throw new Error("support includes tokens");
if (support.support_policy.includes_credential_refs !== false) throw new Error("support includes credential refs");
if (support.support_policy.includes_raw_file_contents !== false) throw new Error("support includes raw file contents");
if (support.support_policy.includes_private_logs !== false) throw new Error("support includes private logs");
if (support.support_policy.requires_ssh !== false) throw new Error("support requires SSH");
' "$SUPPORT_JSON" "$ACCOUNT_REF" "gate37-imported" "$CHECKPOINT_ID"

echo "Gate 37 smoke passed for unified support and repair surface on app $APP_ID"
