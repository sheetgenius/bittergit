#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-43.XXXXXX)"
BUNDLE_JSON="$WORK_ROOT/bundle.json"
SESSION_JSON="$WORK_ROOT/session.json"
LAUNCH_JSON="$WORK_ROOT/launch.json"
FIRST_RUN_JSON="$WORK_ROOT/first-run.json"
MISSING_READINESS_JSON="$WORK_ROOT/missing-readiness.json"
GRANT_JSON="$WORK_ROOT/grant.json"
READY_READINESS_JSON="$WORK_ROOT/ready-readiness.json"
GRANTS_JSON="$WORK_ROOT/grants.json"
SECRETS_JSON="$WORK_ROOT/secrets.json"
SUPPORT_JSON="$WORK_ROOT/support.json"
CUSTOMER_SUPPORT_JSON="$WORK_ROOT/customer-support.json"
CLONE_DIR="$WORK_ROOT/clone"
ACCOUNT_REF="acct-gate43-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate43-$$"
APP_NAME="gate43-app"
SECRET_NAME="STRIPE_SECRET_KEY"
CREDENTIAL_REF="bitterpass://accounts/$ACCOUNT_REF/apps/$APP_NAME/secrets/$SECRET_NAME/gate43-should-not-leak"
GRANT_TOKEN="grant_token_gate43_should_not_leak"
VAULT_OUTPUT="private_vault_output_gate43_should_not_leak"

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

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"provider":"codex"}' >"$LAUNCH_JSON"
LAUNCH_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.agent_launch.id);' "$LAUNCH_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches/$LAUNCH_ID/first-runs" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$FIRST_RUN_JSON"
FIRST_RUN_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.charter_first_run.id);' "$FIRST_RUN_JSON")"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/secret-materialization-readiness?environment=production" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$MISSING_READINESS_JSON"

bun -e '
const readiness = (await Bun.file(process.argv[1]).json()).readiness;
if (readiness.status !== "missing_grants") throw new Error("missing grant readiness was not repairable");
if (readiness.workcell.status !== "missing_grants") throw new Error("workcell missing-grant status wrong");
if (readiness.deploy.status !== "missing_grants") throw new Error("deploy missing-grant status wrong");
if (!String(readiness.repair_action).includes("Create first-run secret grants")) throw new Error("missing grant repair action absent");
' "$MISSING_READINESS_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches/$LAUNCH_ID/first-runs/$FIRST_RUN_ID/secret-grants" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$SECRET_NAME\",\"environment\":\"production\",\"purpose\":\"Needed later for checkout setup after charter approval.\",\"credential_ref\":\"$CREDENTIAL_REF\",\"grant_token\":\"$GRANT_TOKEN\",\"private_vault_output\":\"$VAULT_OUTPUT\"}" >"$GRANT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of [process.argv[2], process.argv[3], process.argv[4], "sk-", "bgt_", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
  if (text.includes(forbidden)) throw new Error(`grant response leaked ${forbidden}`);
}
const grant = JSON.parse(text).secret_grant;
if (grant.name !== process.argv[5]) throw new Error("secret name mismatch");
if (grant.materialization.delegated_to !== "BitterPass") throw new Error("grant was not delegated to BitterPass");
if (grant.materialization.includes_secret_value !== false) throw new Error("grant claims secret value");
if (grant.materialization.includes_credential_ref !== false) throw new Error("grant claims credential ref");
if (grant.materialization.includes_grant_token !== false) throw new Error("grant claims grant token");
if (!Array.isArray(grant.materialization_requests) || grant.materialization_requests.length !== 2) {
  throw new Error("materialization requests missing");
}
const planes = grant.materialization_requests.map((request) => request.target_plane).sort().join(",");
if (planes !== "deploy,workcell") throw new Error(`unexpected materialization planes ${planes}`);
for (const request of grant.materialization_requests) {
  if (request.owner_plane !== "BitterPass") throw new Error("materialization owner plane mismatch");
  if (request.materialization_status !== "delegated_to_bitterpass") throw new Error("materialization status wrong");
  if (request.includes_secret_value !== false || request.includes_credential_ref !== false || request.includes_grant_token !== false || request.includes_materialized_file !== false) {
    throw new Error("materialization request returned private material");
  }
}
' "$GRANT_JSON" "$CREDENTIAL_REF" "$GRANT_TOKEN" "$VAULT_OUTPUT" "$SECRET_NAME"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/secret-materialization-readiness?environment=production" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$READY_READINESS_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of [process.argv[2], process.argv[3], process.argv[4]]) {
  if (text.includes(forbidden)) throw new Error(`readiness leaked ${forbidden}`);
}
const readiness = JSON.parse(text).readiness;
if (readiness.status !== "ready") throw new Error("materialization readiness was not ready");
if (!readiness.required_secret_names.includes(process.argv[5])) throw new Error("readiness missing secret name");
if (readiness.workcell.status !== "delegated_to_bitterpass") throw new Error("workcell readiness wrong");
if (readiness.deploy.status !== "delegated_to_bitterpass") throw new Error("deploy readiness wrong");
if (readiness.includes_secret_value !== false || readiness.includes_credential_ref !== false || readiness.includes_grant_token !== false || readiness.includes_materialized_file !== false) {
  throw new Error("readiness included private material");
}
' "$READY_READINESS_JSON" "$CREDENTIAL_REF" "$GRANT_TOKEN" "$VAULT_OUTPUT" "$SECRET_NAME"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches/$LAUNCH_ID/first-runs/$FIRST_RUN_ID/secret-grants" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$GRANTS_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/secrets" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SECRETS_JSON"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$CLONE_DIR" >/dev/null
test -f "$CLONE_DIR/.bitter/secrets/production.json"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"
curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/support-debug" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$CUSTOMER_SUPPORT_JSON"

bun -e '
const files = process.argv.slice(1, 6);
const combined = (await Promise.all(files.map((file) => Bun.file(file).text()))).join("\n");
for (const forbidden of [process.argv[6], process.argv[7], process.argv[8], "sk-", "bgt_", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "github_pat_"]) {
  if (combined.includes(forbidden)) throw new Error(`secret material leaked ${forbidden}`);
}
const support = JSON.parse(await Bun.file(process.argv[4]).text()).support;
if (!Array.isArray(support.pass_materializations) || support.pass_materializations.length !== 2) {
  throw new Error("support missing materialization requests");
}
if (support.pass_materialization_readiness.status !== "ready") throw new Error("support readiness not ready");
if (!support.secret_grants.some((grant) => grant.materialization_targets.includes("workcell") && grant.materialization_targets.includes("deploy"))) {
  throw new Error("support missing materialization targets");
}
const customerSupport = JSON.parse(await Bun.file(process.argv[5]).text()).support;
if (customerSupport.secret.materialization_request_count !== 2) throw new Error("customer support missing materialization count");
if (customerSupport.secret.materialization_readiness.status !== "ready") throw new Error("customer support readiness not ready");
const manifest = JSON.parse(await Bun.file(process.argv[3]).text());
if (manifest.values_committed !== false) throw new Error("manifest claims committed values");
if (!manifest.secrets.some((entry) => entry.name === process.argv[9])) throw new Error("manifest missing secret name");
' "$GRANTS_JSON" "$SECRETS_JSON" "$CLONE_DIR/.bitter/secrets/production.json" "$SUPPORT_JSON" "$CUSTOMER_SUPPORT_JSON" "$CREDENTIAL_REF" "$GRANT_TOKEN" "$VAULT_OUTPUT" "$SECRET_NAME"

echo "Gate 43 smoke passed for BitterPass materialization handoff on $OWNER/$REPO"
