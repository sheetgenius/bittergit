#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate40-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate40-$$"
SUBJECT_ACCOUNT_REF="acct-gate40-subject-$(date -u +%Y%m%d%H%M%S)-$$"
SUBJECT_WORKSPACE_REF="wrk-gate40-subject-$$"
APP_NAME="gate40-app"
DISCOVERY_JSON="$(mktemp /tmp/bittergit-gate-40-discovery-json.XXXXXX)"
REVOCATION_JSON="$(mktemp /tmp/bittergit-gate-40-revocation-json.XXXXXX)"
REVOCATIONS_JSON="$(mktemp /tmp/bittergit-gate-40-revocations-json.XXXXXX)"
PLAN_JSON="$(mktemp /tmp/bittergit-gate-40-plan-json.XXXXXX)"
BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-40-bundle-json.XXXXXX)"
SECOND_APP_JSON="$(mktemp /tmp/bittergit-gate-40-second-json.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-40-support-json.XXXXXX)"
BAD_JSON="$(mktemp /tmp/bittergit-gate-40-bad-json.XXXXXX)"

make_assertion() {
  local account_ref="$1"
  local workspace_ref="$2"
  local key_ref="$3"
  local assertion_id="$4"
  bun -e '
import { createHmac } from "node:crypto";
const payload = {
  iss: "bitterhub.local",
  aud: "bittergit",
  sub: `account:${process.argv[1]}`,
  jti: process.argv[4],
  kid: process.argv[3],
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
const signature = createHmac("sha256", process.argv[5]).update(`bga2.${encoded}`).digest("hex");
console.log(`bga2.${encoded}.${signature}`);
' "$account_ref" "$workspace_ref" "$key_ref" "$assertion_id" "$BOOTSTRAP_TOKEN"
}

expect_unauthorized() {
  local assertion="$1"
  local expected="$2"
  local status
  status="$(curl -sS -o "$BAD_JSON" -w "%{http_code}" \
    "$BASE_URL/bittergit/v1/customer/plan" \
    -H "X-Bitter-Account-Assertion: $assertion")"
  test "$status" = "401"
  rg "$expected" "$BAD_JSON" >/dev/null
}

ROTATED_ASSERTION_ID="assertion-gate40-rotated-$ACCOUNT_REF"
REVOKED_ASSERTION_ID="assertion-gate40-revoked-$ACCOUNT_REF"
SUBJECT_ASSERTION_ID="assertion-gate40-subject-$SUBJECT_ACCOUNT_REF"
ROTATED_ASSERTION="$(make_assertion "$ACCOUNT_REF" "$WORKSPACE_REF" "hub-rotated-key-2" "$ROTATED_ASSERTION_ID")"
REVOKED_ASSERTION="$(make_assertion "$ACCOUNT_REF" "$WORKSPACE_REF" "hub-rotated-key-2" "$REVOKED_ASSERTION_ID")"
SUBJECT_ASSERTION="$(make_assertion "$SUBJECT_ACCOUNT_REF" "$SUBJECT_WORKSPACE_REF" "hub-rotated-key-2" "$SUBJECT_ASSERTION_ID")"

curl -fsS "$BASE_URL/bittergit/v1/operations/issuer-discovery" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$DISCOVERY_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["dev-token", "bga2.", "secret_material", "\"secret\""]) {
  if (text.toLowerCase().includes(forbidden)) throw new Error(`issuer discovery leaked ${forbidden}`);
}
const discovery = JSON.parse(text).issuer_discovery;
if (discovery.audience !== "bittergit") throw new Error("wrong discovery audience");
const hub = discovery.documents.find((entry) => entry.issuer === "bitterhub.local");
if (!hub) throw new Error("missing bitterhub discovery doc");
if (!hub.active_key_refs.includes("hub-dev-key-1")) throw new Error("missing current active key");
if (!hub.active_key_refs.includes("hub-rotated-key-2")) throw new Error("missing rotated active key");
if (!hub.retired_key_refs.includes("hub-retired-key-1")) throw new Error("missing retired key");
if (!String(hub.discovery_url).startsWith("local://")) throw new Error("missing discovery URL");
' "$DISCOVERY_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/plan" \
  -H "X-Bitter-Account-Assertion: $ROTATED_ASSERTION" >"$PLAN_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["dev-token", "bga2.", "stripe", "card", "secret_material"]) {
  if (text.toLowerCase().includes(forbidden)) throw new Error(`plan leaked ${forbidden}`);
}
const plan = JSON.parse(text).plan;
if (plan.github_required !== false) throw new Error("GitHub became required");
if (plan.assertion_key_ref !== "hub-rotated-key-2") throw new Error("rotated key ref missing");
if (plan.assertion_trust.key_status !== "active") throw new Error("rotated key not active");
if (plan.assertion_trust.revocation_status !== "not_revoked") throw new Error("revocation posture missing");
if (plan.assertion_trust.replay_status !== "first_seen") throw new Error("first use replay status missing");
' "$PLAN_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/operations/assertion-revocations" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"issuer\":\"bitterhub.local\",\"assertion_id\":\"$REVOKED_ASSERTION_ID\",\"account_ref\":\"$ACCOUNT_REF\",\"reason\":\"gate40 assertion revoke\",\"source\":\"gate40_smoke\"}" >"$REVOCATION_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["dev-token", "bga2.", "bgt_", "secret_material"]) {
  if (text.toLowerCase().includes(forbidden)) throw new Error(`revocation leaked ${forbidden}`);
}
const revocation = JSON.parse(text).assertion_revocation;
if (revocation.assertion_id !== process.argv[2]) throw new Error("revoked assertion id mismatch");
if (revocation.issuer !== "bitterhub.local") throw new Error("revocation issuer mismatch");
' "$REVOCATION_JSON" "$REVOKED_ASSERTION_ID"

expect_unauthorized "$REVOKED_ASSERTION" "account assertion revoked"

curl -fsS -X POST "$BASE_URL/bittergit/v1/operations/assertion-revocations" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"issuer\":\"bitterhub.local\",\"subject\":\"account:$SUBJECT_ACCOUNT_REF\",\"account_ref\":\"$SUBJECT_ACCOUNT_REF\",\"reason\":\"gate40 subject revoke\",\"source\":\"gate40_smoke\"}" >/dev/null

expect_unauthorized "$SUBJECT_ASSERTION" "account assertion revoked"

curl -fsS "$BASE_URL/bittergit/v1/operations/assertion-revocations" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$REVOCATIONS_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["dev-token", "bga2.", "bgt_", "secret_material"]) {
  if (text.toLowerCase().includes(forbidden)) throw new Error(`revocation list leaked ${forbidden}`);
}
const records = JSON.parse(text).assertion_revocations;
if (!records.some((entry) => entry.assertion_id === process.argv[2])) throw new Error("missing assertion revocation");
if (!records.some((entry) => entry.subject === `account:${process.argv[3]}`)) throw new Error("missing subject revocation");
' "$REVOCATIONS_JSON" "$REVOKED_ASSERTION_ID" "$SUBJECT_ACCOUNT_REF"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $ROTATED_ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$APP_NAME\"}" >"$BUNDLE_JSON"

APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$BUNDLE_JSON")"
OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$BUNDLE_JSON")"
REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$BUNDLE_JSON")"
READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$BUNDLE_JSON")"

SECOND_STATUS="$(curl -sS -o "$SECOND_APP_JSON" -w "%{http_code}" \
  -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $ROTATED_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"name":"gate40-second-app"}')"
test "$SECOND_STATUS" = "422"
rg "one-app plan already has an active app" "$SECOND_APP_JSON" >/dev/null

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["dev-token", "bga2.", "bgt_", "stripe", "card", "secret_material"]) {
  if (text.toLowerCase().includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
if (support.plan.github_required !== false) throw new Error("support plan required GitHub");
const use = support.account_assertions.find((entry) => entry.assertion_id === process.argv[2]);
if (!use) throw new Error("support missing rotated assertion use");
if (use.key_ref !== "hub-rotated-key-2") throw new Error("support missing rotated key ref");
if (use.replay_status !== "seen_before") throw new Error("support missing replay state");
if (use.revocation_status !== "not_revoked") throw new Error("support missing revocation state");
if (!Array.isArray(support.account_assertion_revocations)) throw new Error("support missing revocation projection");
' "$SUPPORT_JSON" "$ROTATED_ASSERTION_ID"

echo "Gate 40 smoke passed for issuer discovery, rotation, and revocation on $APP_ID"
