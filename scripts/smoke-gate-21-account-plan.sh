#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate21-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate21-$$"
APP_NAME="gate21-app"
SECOND_APP_NAME="gate21-second"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-21-create-json.XXXXXX)"
PLAN_JSON="$(mktemp /tmp/bittergit-gate-21-plan-json.XXXXXX)"
SECOND_JSON="$(mktemp /tmp/bittergit-gate-21-second-json.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-21-support-json.XXXXXX)"
DEV_JSON="$(mktemp /tmp/bittergit-gate-21-dev-json.XXXXXX)"

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
  source: "gate_21_local_assertion",
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

curl -fsS "$BASE_URL/bittergit/v1/customer/plan" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$PLAN_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["stripe", "card", "billing", "secret", "token", "bgt_"]) {
  if (text.toLowerCase().includes(forbidden)) throw new Error(`plan leaked ${forbidden}`);
}
const data = JSON.parse(text);
if (data.plan.github_required !== false) throw new Error("plan did not state github_required=false");
if (data.plan.included_apps !== 1 || data.plan.active_app_count !== 0) throw new Error("unexpected starting plan counts");
' "$PLAN_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"evil\",\"name\":\"$APP_NAME\",\"display_name\":\"Gate 21 App\"}" >"$CREATE_JSON"

READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$CREATE_JSON")"
OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$CREATE_JSON")"
REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$CREATE_JSON")"

bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.app.account_ref !== process.argv[2]) throw new Error("app account did not come from assertion");
if (data.app.workspace_ref !== process.argv[3]) throw new Error("app workspace did not come from assertion");
if (data.app.repo.owner === "evil") throw new Error("free-form owner was honored");
if (!data.app.repo.owner.startsWith("acct-gate21")) throw new Error("repo owner was not assertion-derived");
if (data.app.repo.name !== process.argv[4]) throw new Error("app slug was not used as repo name");
if (data.plan.github_required !== false) throw new Error("create response did not state GitHub optional");
if (data.plan.active_app_count !== 1 || data.plan.remaining_app_slots !== 0) throw new Error("plan counts did not update");
' "$CREATE_JSON" "$ACCOUNT_REF" "$WORKSPACE_REF" "$APP_NAME"

SECOND_STATUS="$(curl -sS -o "$SECOND_JSON" -w "%{http_code}" \
  -X POST "$BASE_URL/bittergit/v1/customer/apps" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$SECOND_APP_NAME\"}")"
test "$SECOND_STATUS" = "422"
rg "one-app plan" "$SECOND_JSON" >/dev/null

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_")) throw new Error("support bundle leaked token material");
if (text.toLowerCase().includes("stripe") || text.toLowerCase().includes("billing")) {
  throw new Error("support bundle exposed billing internals");
}
const data = JSON.parse(text).support;
if (data.account.account_ref !== process.argv[2]) throw new Error("support missing account ref");
if (data.account.workspace_ref !== process.argv[3]) throw new Error("support missing workspace ref");
if (data.plan.github_required !== false) throw new Error("support did not preserve GitHub optional posture");
if (data.support_policy.includes_tokens !== false) throw new Error("support policy allows token exposure");
' "$SUPPORT_JSON" "$ACCOUNT_REF" "$WORKSPACE_REF"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"test\",\"name\":\"gate21-dev-token-$APP_NAME-$$\"}" >"$DEV_JSON"

bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.tokens?.read_token || data.existing !== false) throw new Error("dev-token repo path regressed");
' "$DEV_JSON"

echo "Gate 21 smoke passed for assertion account $ACCOUNT_REF with app $OWNER/$REPO"
