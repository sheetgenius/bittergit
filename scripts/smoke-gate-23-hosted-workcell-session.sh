#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate23-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate23-$$"
APP_NAME="gate23-app"
BUNDLE_JSON="$(mktemp /tmp/bittergit-gate-23-bundle-json.XXXXXX)"
SESSION_JSON="$(mktemp /tmp/bittergit-gate-23-session-json.XXXXXX)"
SESSIONS_JSON="$(mktemp /tmp/bittergit-gate-23-sessions-json.XXXXXX)"
REVOKE_JSON="$(mktemp /tmp/bittergit-gate-23-revoke-json.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-23-support-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

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
  source: "gate_23_local_assertion",
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

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$APP_NAME\",\"display_name\":\"Gate 23 App\"}" >"$BUNDLE_JSON"

APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$BUNDLE_JSON")"
OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$BUNDLE_JSON")"
REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$BUNDLE_JSON")"
READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$BUNDLE_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$SESSION_JSON"

SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$SESSION_JSON")"
SOURCE_ROOT="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.source_root);' "$SESSION_JSON")"

bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_")) throw new Error("session response leaked token material");
const data = JSON.parse(text);
const session = data.session;
if (session.app_id !== process.argv[2]) throw new Error("session missing app scope");
if (session.account_ref !== process.argv[3]) throw new Error("session missing account scope");
if (session.workspace_ref !== process.argv[4]) throw new Error("session missing workspace scope");
if (!session.repo_id || !session.source_root || !session.terminal_url) throw new Error("session missing core fields");
if (session.status !== "ready") throw new Error("session not ready");
if (!session.git_token_ref.startsWith("token_")) throw new Error("session missing token ref");
if (session.agent_readiness.github_optional !== true) throw new Error("session made GitHub required");
if (session.agent_readiness.source_saved !== true || session.agent_readiness.terminal_ready !== true) {
  throw new Error("session readiness incomplete");
}
if (!session.readiness_message.includes("Terminal ready")) throw new Error("readiness message missing terminal readiness");
if (!session.readiness_message.includes("Source is saved")) throw new Error("readiness message missing source saved");
if (!session.readiness_message.includes("GitHub is optional")) throw new Error("readiness message missing GitHub optional");
if (!session.readiness_message.includes("APP.md")) throw new Error("readiness message missing charter first task");
' "$SESSION_JSON" "$APP_ID" "$ACCOUNT_REF" "$WORKSPACE_REF"

test -d "$SOURCE_ROOT/.git"
REMOTE_URL="$(git -C "$SOURCE_ROOT" remote get-url origin)"
case "$REMOTE_URL" in
  "$BASE_URL/$OWNER/$REPO.git") ;;
  *) echo "unexpected origin remote $REMOTE_URL" >&2; exit 1 ;;
esac
if [[ "$REMOTE_URL" == *"github.com"* || "$REMOTE_URL" == *"bgt_"* || "$REMOTE_URL" == *"@"* ]]; then
  echo "origin remote leaked credentials or pointed at GitHub" >&2
  exit 1
fi

cd "$SOURCE_ROOT"
git config user.email "gate23@bittergit.local"
git config user.name "BitterGit Gate 23"
git checkout -B session-proof
echo "session proof" > session-proof.txt
git add session-proof.txt
git commit -m "Add hosted session proof"
git push origin session-proof

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$SESSIONS_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.sessions.some((session) => session.id === process.argv[2] && session.status === "ready")) {
  throw new Error("session list missing ready session");
}
' "$SESSIONS_JSON" "$SESSION_ID"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/revoke" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$REVOKE_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.session.status !== "revoked" || !data.session.revoked_at) throw new Error("session was not revoked");
' "$REVOKE_JSON"

git checkout -B session-proof-revoked
echo "revoked proof" > revoked-proof.txt
git add revoked-proof.txt
git commit -m "Attempt revoked hosted session push"
if git push origin session-proof-revoked; then
  echo "revoked hosted session token unexpectedly pushed" >&2
  exit 1
fi

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"
bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_")) throw new Error("support leaked token material");
const data = JSON.parse(text).support;
const session = data.hosted_workcell_sessions.find((entry) => entry.id === process.argv[2]);
if (!session) throw new Error("support missing hosted workcell session");
if (session.status !== "revoked") throw new Error("support did not show revoked session");
if (session.account_ref !== process.argv[3]) throw new Error("support missing account scope");
if (session.agent_readiness.github_optional !== true) throw new Error("support readiness made GitHub required");
' "$SUPPORT_JSON" "$SESSION_ID" "$ACCOUNT_REF"

echo "Gate 23 smoke passed for hosted workcell session $SESSION_ID on $OWNER/$REPO"
