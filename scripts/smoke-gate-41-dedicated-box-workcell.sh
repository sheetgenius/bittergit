#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate41-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate41-$$"
APP_NAME="gate41-app"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-41.XXXXXX)"
BUNDLE_JSON="$WORK_ROOT/bundle.json"
SESSION_JSON="$WORK_ROOT/session.json"
FULFILL_JSON="$WORK_ROOT/fulfill.json"
REVOKE_JSON="$WORK_ROOT/revoke.json"
TERMINAL_HTML="$WORK_ROOT/terminal.html"
SUPPORT_JSON="$WORK_ROOT/support.json"

export GIT_TERMINAL_PROMPT=0

ASSERTION="$(bun -e '
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
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"terminal_fulfillment":{"mode":"dedicated_box","box_ref":"grid-host-01"}}' >"$SESSION_JSON"

SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$SESSION_JSON")"
SOURCE_ROOT="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.source_root);' "$SESSION_JSON")"
TERMINAL_URL="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.terminal_url);' "$SESSION_JSON")"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["bgt_", "BEGIN OPENSSH", "PRIVATE KEY", "sk_live_", "@github.com"]) {
  if (text.includes(forbidden)) throw new Error(`session leaked ${forbidden}`);
}
const session = JSON.parse(text).session;
const fulfillment = session.terminal_fulfillment;
if (session.app_id !== process.argv[2]) throw new Error("session missing app scope");
if (session.account_ref !== process.argv[3]) throw new Error("session missing account scope");
if (fulfillment.owner_plane !== "BitterGrid") throw new Error("wrong owner plane");
if (fulfillment.provider !== "bittergrid_dedicated_box_contract") throw new Error("wrong dedicated provider");
if (fulfillment.mode !== "dedicated_box_local_adapter") throw new Error("wrong fulfillment mode");
if (fulfillment.box_ref !== "grid-host-01") throw new Error("wrong box ref");
if (fulfillment.dedicated_box_requested !== true) throw new Error("dedicated box request not recorded");
if (fulfillment.dedicated_box_available !== false) throw new Error("local smoke should record unavailable dedicated box");
if (!fulfillment.fallback_reason) throw new Error("missing fallback reason");
if (fulfillment.lifecycle !== "dedicated_box_local_adapter_ready") throw new Error("wrong lifecycle");
if (fulfillment.cleanup_status !== "active") throw new Error("cleanup not active");
if (fulfillment.source_root !== session.source_root) throw new Error("source root mismatch");
if (fulfillment.repo_id !== session.repo_id) throw new Error("repo id mismatch");
if (fulfillment.app_id !== session.app_id) throw new Error("app id mismatch");
if (fulfillment.account_ref !== session.account_ref) throw new Error("account ref mismatch");
if (fulfillment.origin_remote !== `${process.argv[4]}/${process.argv[5]}/${process.argv[6]}.git`) {
  throw new Error("origin remote mismatch");
}
if (fulfillment.credential_delivery !== "run_scoped_git_credential_helper") throw new Error("credential delivery mismatch");
if (fulfillment.token_in_url !== false || fulfillment.clone_url_has_token !== false) throw new Error("token URL posture failed");
if (!fulfillment.created_at || !fulfillment.updated_at) throw new Error("missing lifecycle timestamps");
' "$SESSION_JSON" "$APP_ID" "$ACCOUNT_REF" "$BASE_URL" "$OWNER" "$REPO"

test -d "$SOURCE_ROOT/.git"
REMOTE_URL="$(git -C "$SOURCE_ROOT" remote get-url origin)"
test "$REMOTE_URL" = "$BASE_URL/$OWNER/$REPO.git"
if [[ "$REMOTE_URL" == *"bgt_"* || "$REMOTE_URL" == *"github.com"* || "$REMOTE_URL" == *"@"* ]]; then
  echo "origin remote leaked token material or pointed at GitHub" >&2
  exit 1
fi
CREDENTIAL_HELPER="$(git -C "$SOURCE_ROOT" config --get credential.helper)"
test -n "$CREDENTIAL_HELPER"
test -x "$CREDENTIAL_HELPER"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/terminal-fulfillment" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$FULFILL_JSON"

bun -e '
const session = (await Bun.file(process.argv[1]).json()).session;
const fulfillment = session.terminal_fulfillment;
if (fulfillment.mode !== "dedicated_box_local_adapter") throw new Error("refresh lost dedicated mode");
if (fulfillment.box_ref !== "grid-host-01") throw new Error("refresh lost box ref");
if (fulfillment.lifecycle !== "dedicated_box_local_adapter_ready") throw new Error("refresh lifecycle mismatch");
' "$FULFILL_JSON"

curl -fsS "$TERMINAL_URL" >"$TERMINAL_HTML"
rg "Terminal mode" "$TERMINAL_HTML" >/dev/null
rg "dedicated_box_local_adapter" "$TERMINAL_HTML" >/dev/null
if rg "grid-host-01|bgt_|BEGIN OPENSSH|PRIVATE KEY|sk_live_|github.com" "$TERMINAL_HTML" >/dev/null; then
  echo "terminal page leaked topology, token/key/secret material, or GitHub" >&2
  exit 1
fi

git -C "$SOURCE_ROOT" config user.email "gate41@bittergit.local"
git -C "$SOURCE_ROOT" config user.name "BitterGit Gate 41"
git -C "$SOURCE_ROOT" checkout -B gate41-before-revoke
printf 'dedicated box fulfillment proof\n' >"$SOURCE_ROOT/gate41.txt"
git -C "$SOURCE_ROOT" add gate41.txt
git -C "$SOURCE_ROOT" commit -m "Add Gate 41 dedicated box proof"
git -C "$SOURCE_ROOT" push origin gate41-before-revoke

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/revoke" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$REVOKE_JSON"

bun -e '
const session = (await Bun.file(process.argv[1]).json()).session;
const fulfillment = session.terminal_fulfillment;
if (session.status !== "revoked") throw new Error("session not revoked");
if (fulfillment.status !== "revoked") throw new Error("fulfillment status not revoked");
if (fulfillment.lifecycle !== "revoked") throw new Error("fulfillment lifecycle not revoked");
if (fulfillment.cleanup_status !== "revoked") throw new Error("cleanup status not revoked");
' "$REVOKE_JSON"

git -C "$SOURCE_ROOT" checkout -B gate41-after-revoke
printf 'revoked dedicated box proof\n' >"$SOURCE_ROOT/gate41-revoked.txt"
git -C "$SOURCE_ROOT" add gate41-revoked.txt
git -C "$SOURCE_ROOT" commit -m "Attempt revoked Gate 41 push"
if git -C "$SOURCE_ROOT" push origin gate41-after-revoke; then
  echo "revoked dedicated-box session unexpectedly retained Git write access" >&2
  exit 1
fi

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["bgt_", "BEGIN OPENSSH", "PRIVATE KEY", "sk_live_", "github.com"]) {
  if (text.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
const session = support.hosted_workcell_sessions.find((entry) => entry.id === process.argv[2]);
if (!session) throw new Error("support missing session");
const fulfillment = session.terminal_fulfillment;
if (fulfillment.owner_plane !== "BitterGrid") throw new Error("support owner plane mismatch");
if (fulfillment.mode !== "dedicated_box_local_adapter") throw new Error("support mode mismatch");
if (fulfillment.box_ref !== null) throw new Error("support returned Grid box ref");
if (fulfillment.box_ref_configured !== true || fulfillment.box_ref_returned !== false) {
  throw new Error("support box-ref posture mismatch");
}
if (fulfillment.cleanup_status !== "revoked") throw new Error("support cleanup status mismatch");
if (fulfillment.token_in_url !== false || fulfillment.clone_url_has_token !== false) throw new Error("support token URL posture failed");
' "$SUPPORT_JSON" "$SESSION_ID"

rg "scripts/smoke-gate-41-dedicated-box-workcell.sh" scripts/smoke-all.sh >/dev/null

echo "Gate 41 smoke passed for dedicated-box Grid workcell fulfillment $SESSION_ID"
