#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
STAMP="$(date -u +%Y%m%d%H%M%S)-$$"
ACCOUNT_SLUG="gate48-example-$STAMP"
ACCOUNT_REF="account:$ACCOUNT_SLUG"
WORKSPACE_REF="bitterhub:hub-account-gate48-$STAMP"
APP_NAME="example-bridge-app"
SECOND_APP_NAME="second-app"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-48.XXXXXX)"

make_factory_bridge_assertion() {
  local account_ref="$1"
  local workspace_ref="$2"
  bun -e '
import { createHmac } from "node:crypto";
const payload = {
  iss: "factory.local",
  aud: "bittergit",
  sub: `factory:${process.argv[1]}:user:gate48`,
  jti: `factory-bridge-${Date.now()}-${Math.random()}`,
  kid: "factory-dev-key-1",
  authority_kind: "factory_hub_account_plan_bridge",
  account_ref: process.argv[1],
  workspace_ref: process.argv[2],
  plan_key: "indie_builder",
  plan_status: "active",
  included_apps: 1,
  github_required: false,
  secret_material_returned: false,
  source: "factory_hub_account_bridge",
  asserted_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  hosted_workcell_limit: 1,
  monthly_hosted_run_limit: 120,
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

ASSERTION="$(make_factory_bridge_assertion "$ACCOUNT_REF" "$WORKSPACE_REF")"
PLAN_BEFORE_JSON="$WORK_ROOT/plan-before.json"
BUNDLE_JSON="$WORK_ROOT/app-bundle.json"
PLAN_AFTER_JSON="$WORK_ROOT/plan-after.json"
CUSTOMER_SUPPORT_JSON="$WORK_ROOT/customer-support.json"
REPO_SUPPORT_JSON="$WORK_ROOT/repo-support.json"
SECOND_JSON="$WORK_ROOT/second-app.json"

curl -fsS "$BASE_URL/bittergit/v1/customer/plan" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$PLAN_BEFORE_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["dev-token", "bga2.", "stripe", "card", "secret_material", "billing"]) {
  if (text.toLowerCase().includes(forbidden)) throw new Error(`plan leaked ${forbidden}`);
}
const plan = JSON.parse(text).plan;
if (plan.assertion_issuer !== "factory.local") throw new Error("wrong bridge issuer");
if (plan.authority_kind !== "factory_hub_account_plan_bridge") throw new Error("wrong authority kind");
if (plan.source !== "factory_hub_account_bridge") throw new Error("wrong bridge source");
if (plan.plan_key !== "indie_builder") throw new Error("wrong plan key");
if (plan.github_required !== false) throw new Error("GitHub became required");
if (plan.included_apps !== 1) throw new Error("one-app entitlement missing");
if (plan.active_app_count !== 0 || plan.remaining_app_slots !== 1) throw new Error("unexpected app count before creation");
if (plan.assertion_trust.key_status !== "active") throw new Error("bridge key was not trusted");
' "$PLAN_BEFORE_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$APP_NAME\",\"display_name\":\"Example Bridge App\"}" >"$BUNDLE_JSON"

APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$BUNDLE_JSON")"
OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$BUNDLE_JSON")"
REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$BUNDLE_JSON")"
READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$BUNDLE_JSON")"

bun -e '
const bundle = await Bun.file(process.argv[1]).json();
if (bundle.github_required !== false || bundle.plan.github_required !== false) throw new Error("bundle required GitHub");
if (bundle.app.account_ref !== process.argv[2]) throw new Error("app did not derive owner from assertion account");
if (bundle.app.repo.owner !== process.argv[3]) throw new Error("repo owner was not assertion-derived");
if (bundle.plan.remaining_app_slots !== 0) throw new Error("one-app slot was not consumed");
if (bundle.app.source_posture !== "bittergit_primary") throw new Error("app was not BitterGit primary");
' "$BUNDLE_JSON" "$ACCOUNT_REF" "$ACCOUNT_SLUG"

curl -fsS "$BASE_URL/bittergit/v1/customer/plan" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$PLAN_AFTER_JSON"

bun -e '
const plan = (await Bun.file(process.argv[1]).json()).plan;
if (plan.active_app_count !== 1 || plan.remaining_app_slots !== 0) throw new Error("one-app entitlement did not block further active apps");
if (plan.github_required !== false) throw new Error("GitHub became required after app creation");
' "$PLAN_AFTER_JSON"

status="$(curl -sS -o "$SECOND_JSON" -w "%{http_code}" \
  -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$SECOND_APP_NAME\"}")"
test "$status" = "422"
rg "one-app plan already has an active app" "$SECOND_JSON" >/dev/null

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/support-debug" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$CUSTOMER_SUPPORT_JSON"
curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$REPO_SUPPORT_JSON"

assert_clean_text "$CUSTOMER_SUPPORT_JSON" "dev-token" "bga2\\." "bgt_" "stripe" "card" "secret_material" "billing" "Bearer"
assert_clean_text "$REPO_SUPPORT_JSON" "dev-token" "bga2\\." "bgt_" "stripe" "card" "secret_material" "billing" "Bearer"

bun -e '
const customer = (await Bun.file(process.argv[1]).json()).support;
if (customer.account.account_ref !== process.argv[3]) throw new Error("customer support missing account ref");
if (customer.account.workspace_ref !== process.argv[4]) throw new Error("customer support missing workspace ref");
if (customer.plan.github_required !== false) throw new Error("support plan required GitHub");
if (customer.plan.authority_kind !== "factory_hub_account_plan_bridge") throw new Error("support missing bridge authority");
const repo = (await Bun.file(process.argv[2]).json()).support;
if (repo.account.account_ref !== process.argv[3]) throw new Error("repo support missing account ref");
if (repo.account.plan_source !== "factory_hub_account_bridge") throw new Error("repo support missing plan source");
if (!repo.account_assertions.some((entry) => entry.issuer === "factory.local" && entry.authority_kind === "factory_hub_account_plan_bridge")) {
  throw new Error("repo support missing sanitized bridge assertion record");
}
' "$CUSTOMER_SUPPORT_JSON" "$REPO_SUPPORT_JSON" "$ACCOUNT_REF" "$WORKSPACE_REF"

echo "Gate 48 smoke passed for Factory-to-BitterGit account bridge $ACCOUNT_REF"
