#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-35.XXXXXX)"
BUNDLE_JSON="$WORK_ROOT/bundle.json"
SESSION_JSON="$WORK_ROOT/session.json"
LAUNCH_JSON="$WORK_ROOT/launch.json"
FIRST_RUN_JSON="$WORK_ROOT/first-run.json"
GRANT_JSON="$WORK_ROOT/grant.json"
GRANTS_JSON="$WORK_ROOT/grants.json"
BAD_GRANT_JSON="$WORK_ROOT/bad-grant.json"
SUPPORT_JSON="$WORK_ROOT/support.json"
REVIEW_JSON="$WORK_ROOT/review.json"
CLONE_DIR="$WORK_ROOT/clone"
BLOCKED_DIR="$WORK_ROOT/blocked-artifact"
ACCOUNT_REF="acct-gate35-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate35-$$"
APP_NAME="gate35-app"

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

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches/$LAUNCH_ID/first-runs/$FIRST_RUN_ID/secret-grants" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"STRIPE_SECRET_KEY\",\"environment\":\"production\",\"purpose\":\"Needed later for checkout setup after charter approval.\",\"credential_ref\":\"bitterpass://accounts/$ACCOUNT_REF/apps/$APP_ID/secrets/STRIPE_SECRET_KEY\"}" >"$GRANT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["sk_live_", "sk-", "bgt_", "bitterpass://accounts"]) {
  if (text.includes(forbidden)) throw new Error(`grant response leaked ${forbidden}`);
}
const grant = JSON.parse(text).secret_grant;
if ("credential_ref" in grant) throw new Error("grant response exposed credential_ref");
if (grant.name !== "STRIPE_SECRET_KEY") throw new Error("secret name mismatch");
if (grant.materialization.delegated_to !== "BitterPass") throw new Error("grant was not delegated to BitterPass");
if (grant.materialization.includes_secret_value !== false) throw new Error("grant claims secret value");
if (grant.source_manifest.path !== ".bitter/secrets/production.json") throw new Error("manifest path mismatch");
if (!grant.source_manifest.commit_sha) throw new Error("manifest commit missing");
if (grant.source_manifest.includes_secret_value !== false) throw new Error("manifest claims secret value");
' "$GRANT_JSON"

BAD_STATUS="$(curl -sS -o "$BAD_GRANT_JSON" -w "%{http_code}" -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches/$LAUNCH_ID/first-runs/$FIRST_RUN_ID/secret-grants" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"name":"BAD_SECRET","environment":"production","purpose":"bad","credential_ref":"bitterpass://accounts/bad/apps/bad/secrets/BAD_SECRET","value":"sk_live_12345678901234567890"}')"
test "$BAD_STATUS" = "422"
if rg "sk_live_12345678901234567890" "$BAD_GRANT_JSON"; then
  echo "secret value leaked in bad grant error" >&2
  exit 1
fi

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches/$LAUNCH_ID/first-runs/$FIRST_RUN_ID/secret-grants" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$GRANTS_JSON"
bun -e '
const grants = (await Bun.file(process.argv[1]).json()).secret_grants;
if (!Array.isArray(grants) || grants.length !== 1) throw new Error("secret grant list mismatch");
if (grants[0].materialization.value_stored_in_bittergit !== false) throw new Error("grant list claims stored value");
' "$GRANTS_JSON"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$CLONE_DIR" >/dev/null
test -f "$CLONE_DIR/.bitter/secrets/production.json"
bun -e '
const text = await Bun.file(process.argv[1]).text();
if (!text.includes("STRIPE_SECRET_KEY")) throw new Error("manifest missing secret name");
if (!text.includes("\"values_committed\": false")) throw new Error("manifest missing value refusal");
for (const forbidden of ["sk_live_", "sk-", "bgt_", "bitterpass://", "credential_ref"]) {
  if (text.includes(forbidden)) throw new Error(`manifest leaked ${forbidden}`);
}
' "$CLONE_DIR/.bitter/secrets/production.json"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"
bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["sk_live_", "sk-", "bgt_", "bitterpass://accounts"]) {
  if (text.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
if (!support.secret_refs.some((entry) => entry.name === "STRIPE_SECRET_KEY" && entry.has_credential_ref === true)) {
  throw new Error("support missing secret ref");
}
if (!support.secret_grants.some((entry) => entry.name === "STRIPE_SECRET_KEY" && entry.materialization_status === "delegated_to_bitterpass")) {
  throw new Error("support missing secret grant status");
}
if (!support.receipts.some((receipt) => receipt.receipt_type === "secret_grant_request" && receipt.body.includes_secret_value === false)) {
  throw new Error("support missing safe secret grant receipt");
}
' "$SUPPORT_JSON"

mkdir -p "$BLOCKED_DIR"
printf 'STRIPE_SECRET_KEY=sk_live_12345678901234567890\n' >"$BLOCKED_DIR/.env"
printf '<html></html>\n' >"$BLOCKED_DIR/index.html"
curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/review" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"source_kind\":\"folder\",\"source_path\":\"$BLOCKED_DIR\"}" >"$REVIEW_JSON"
bun -e '
const review = (await Bun.file(process.argv[1]).json()).artifact_import;
const env = review.plan.blocked.find((entry) => entry.path === ".env");
if (!env) throw new Error("blocked .env missing");
if (!String(env.repair_action).includes("BitterPass secret grant flow")) {
  throw new Error("blocked .env did not point to secret grant flow");
}
if (review.ready_to_commit !== false) throw new Error("blocked import was ready to commit");
' "$REVIEW_JSON"

echo "Gate 35 smoke passed for BitterPass secret grant first run on $OWNER/$REPO"
