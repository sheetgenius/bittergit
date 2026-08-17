#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate24-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate24-$$"
APP_NAME="gate24-app"
PLAN_JSON="$(mktemp /tmp/bittergit-gate-24-plan-json.XXXXXX)"
BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-24-bundle-json.XXXXXX)"
BAD_JSON="$(mktemp /tmp/bittergit-gate-24-bad-json.XXXXXX)"

make_assertion() {
  local issuer="$1"
  local audience="$2"
  bun -e '
import { createHmac } from "node:crypto";
const payload = {
  iss: process.argv[1],
  aud: process.argv[2],
  sub: `account:${process.argv[3]}`,
  jti: `assertion-${process.argv[3]}-${Date.now()}`,
  kid: "hub-dev-key-1",
  authority_kind: "account_plan_assertion",
  account_ref: process.argv[3],
  workspace_ref: process.argv[4],
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
const signature = createHmac("sha256", process.argv[5]).update(`bga2.${encoded}`).digest("hex");
console.log(`bga2.${encoded}.${signature}`);
' "$issuer" "$audience" "$ACCOUNT_REF" "$WORKSPACE_REF" "$BOOTSTRAP_TOKEN"
}

ASSERTION="$(make_assertion bitterhub.local bittergit)"
BAD_ISSUER_ASSERTION="$(make_assertion unknown.local bittergit)"
BAD_AUDIENCE_ASSERTION="$(make_assertion bitterhub.local github)"

curl -fsS "$BASE_URL/bittergit/v1/customer/plan" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$PLAN_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["bgt_", "stripe", "card", "billing", "secret_material"]) {
  if (text.toLowerCase().includes(forbidden)) throw new Error(`plan leaked ${forbidden}`);
}
const data = JSON.parse(text).plan;
if (data.assertion_issuer !== "bitterhub.local") throw new Error("issuer missing from plan");
if (!String(data.assertion_subject).startsWith("account:")) throw new Error("subject missing from plan");
if (data.assertion_key_ref !== "hub-dev-key-1") throw new Error("key ref missing from plan");
if (data.authority_kind !== "account_plan_assertion") throw new Error("authority kind missing");
if (data.github_required !== false) throw new Error("GitHub became required");
' "$PLAN_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$APP_NAME\"}" >"$BUNDLE_JSON"

bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.app.account_ref !== process.argv[2]) throw new Error("app was not scoped to issued account");
if (data.plan.assertion_issuer !== "bitterhub.local") throw new Error("bundle plan missing issuer");
if (data.plan.assertion_key_ref !== "hub-dev-key-1") throw new Error("bundle plan missing key ref");
if (data.github_required !== false) throw new Error("bundle made GitHub required");
' "$BUNDLE_JSON" "$ACCOUNT_REF"

BAD_STATUS="$(curl -sS -o "$BAD_JSON" -w "%{http_code}" \
  "$BASE_URL/bittergit/v1/customer/plan" \
  -H "X-Bitter-Account-Assertion: $BAD_ISSUER_ASSERTION")"
test "$BAD_STATUS" = "401"
rg "untrusted account assertion issuer" "$BAD_JSON" >/dev/null

BAD_STATUS="$(curl -sS -o "$BAD_JSON" -w "%{http_code}" \
  "$BASE_URL/bittergit/v1/customer/plan" \
  -H "X-Bitter-Account-Assertion: $BAD_AUDIENCE_ASSERTION")"
test "$BAD_STATUS" = "401"
rg "audience mismatch" "$BAD_JSON" >/dev/null

echo "Gate 24 smoke passed for issuer-shaped assertion $ACCOUNT_REF"
