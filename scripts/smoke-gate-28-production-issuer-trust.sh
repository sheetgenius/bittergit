#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate28-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate28-$$"
APP_NAME="gate28-app"
TRUST_JSON="$(mktemp /tmp/bittergit-gate-28-trust-json.XXXXXX)"
PLAN_ONE_JSON="$(mktemp /tmp/bittergit-gate-28-plan-one-json.XXXXXX)"
PLAN_TWO_JSON="$(mktemp /tmp/bittergit-gate-28-plan-two-json.XXXXXX)"
BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-28-bundle-json.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-28-support-json.XXXXXX)"
BAD_JSON="$(mktemp /tmp/bittergit-gate-28-bad-json.XXXXXX)"

make_assertion() {
  local mode="$1"
  bun -e '
import { createHmac } from "node:crypto";
const mode = process.argv[1];
const payload = {
  iss: "bitterhub.local",
  aud: "bittergit",
  sub: `account:${process.argv[2]}`,
  jti: `assertion-${mode}-${process.argv[2]}-${Date.now()}`,
  kid: "hub-dev-key-1",
  authority_kind: "account_plan_assertion",
  account_ref: process.argv[2],
  workspace_ref: process.argv[3],
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

if (mode === "bad_issuer") payload.iss = "unknown.local";
if (mode === "bad_audience") payload.aud = "github";
if (mode === "missing_subject") delete payload.sub;
if (mode === "missing_jti") delete payload.jti;
if (mode === "expired") payload.expires_at = new Date(Date.now() - 60 * 1000).toISOString();
if (mode === "retired_key") payload.kid = "hub-retired-key-1";
if (mode === "unknown_key") payload.kid = "hub-missing-key";

const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const signature = createHmac("sha256", process.argv[4]).update(`bga2.${encoded}`).digest("hex");
console.log(`bga2.${encoded}.${signature}`);
' "$mode" "$ACCOUNT_REF" "$WORKSPACE_REF" "$BOOTSTRAP_TOKEN"
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

ASSERTION="$(make_assertion valid)"

curl -fsS "$BASE_URL/bittergit/v1/operations/assertion-trust" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$TRUST_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["dev-token", "secret", "bga2."]) {
  if (text.includes(forbidden)) throw new Error(`trust config leaked ${forbidden}`);
}
const data = JSON.parse(text).assertion_trust;
const issuer = data.issuers.find((entry) => entry.issuer === "bitterhub.local");
if (!issuer) throw new Error("missing bitterhub issuer");
const active = issuer.keys.find((entry) => entry.key_ref === "hub-dev-key-1");
const retired = issuer.keys.find((entry) => entry.key_ref === "hub-retired-key-1");
if (!active || active.status !== "active") throw new Error("missing active key");
if (!retired || retired.status !== "retired") throw new Error("missing retired key");
if (!issuer.audiences.includes("bittergit")) throw new Error("missing bittergit audience");
' "$TRUST_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/plan" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$PLAN_ONE_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["dev-token", "bga2.", "stripe", "card", "secret_material"]) {
  if (text.toLowerCase().includes(forbidden)) throw new Error(`plan leaked ${forbidden}`);
}
const plan = JSON.parse(text).plan;
if (plan.github_required !== false) throw new Error("GitHub became required");
if (plan.assertion_trust.key_status !== "active") throw new Error("active key was not proven");
if (plan.assertion_trust.replay_status !== "first_seen") throw new Error("first use replay status missing");
if (plan.assertion_trust.use_count !== 1) throw new Error("first use count missing");
if (!plan.assertion_trust.audience_verified) throw new Error("audience proof missing");
if (!plan.assertion_trust.subject_verified) throw new Error("subject proof missing");
if (!plan.assertion_trust.expiry_verified) throw new Error("expiry proof missing");
if (!plan.assertion_trust.assertion_id_verified) throw new Error("assertion id proof missing");
' "$PLAN_ONE_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/plan" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$PLAN_TWO_JSON"

bun -e '
const plan = await Bun.file(process.argv[1]).json();
const trust = plan.plan.assertion_trust;
if (trust.replay_status !== "seen_before") throw new Error("replay posture did not mark repeated assertion");
if (trust.use_count !== 2) throw new Error("replay use count was not incremented");
' "$PLAN_TWO_JSON"

expect_unauthorized "$(make_assertion bad_issuer)" "untrusted account assertion issuer"
expect_unauthorized "$(make_assertion bad_audience)" "audience mismatch"
expect_unauthorized "$(make_assertion missing_subject)" "subject is required"
expect_unauthorized "$(make_assertion missing_jti)" "assertion_id is required"
expect_unauthorized "$(make_assertion expired)" "account assertion expired"
expect_unauthorized "$(make_assertion retired_key)" "account assertion key is not active"
expect_unauthorized "$(make_assertion unknown_key)" "untrusted account assertion key"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$APP_NAME\"}" >"$BUNDLE_JSON"

OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$BUNDLE_JSON")"
REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$BUNDLE_JSON")"
READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$BUNDLE_JSON")"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["dev-token", "bga2.", "bgt_", "stripe", "card", "secret_material"]) {
  if (text.toLowerCase().includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
if (!Array.isArray(support.account_assertions) || support.account_assertions.length === 0) {
  throw new Error("support missing assertion use records");
}
const record = support.account_assertions.find((entry) => entry.issuer === "bitterhub.local");
if (!record) throw new Error("support missing trusted issuer assertion");
if (record.key_ref !== "hub-dev-key-1") throw new Error("support missing key ref");
if (record.replay_status !== "seen_before") throw new Error("support missing replay posture");
' "$SUPPORT_JSON"

echo "Gate 28 smoke passed for production issuer trust $ACCOUNT_REF"
