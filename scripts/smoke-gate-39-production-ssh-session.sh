#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
ACCOUNT_REF="acct-gate39-$(date -u +%Y%m%d%H%M%S)-$$"
WORKSPACE_REF="wrk-gate39-$$"
APP_NAME="gate39-app"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-39.XXXXXX)"
BUNDLE_JSON="$WORK_ROOT/bundle.json"
DEFAULT_SESSION_JSON="$WORK_ROOT/default-session.json"
WRITE_SESSION_JSON="$WORK_ROOT/write-session.json"
INVALID_SESSION_JSON="$WORK_ROOT/invalid-session.json"
TERMINAL_HTML="$WORK_ROOT/terminal.html"
REVOKE_JSON="$WORK_ROOT/revoke.json"
REPO_SUPPORT_JSON="$WORK_ROOT/repo-support.json"
APP_SUPPORT_JSON="$WORK_ROOT/app-support.json"

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
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$DEFAULT_SESSION_JSON"

SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$DEFAULT_SESSION_JSON")"
SOURCE_ROOT="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.source_root);' "$DEFAULT_SESSION_JSON")"
TERMINAL_URL="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.terminal_url);' "$DEFAULT_SESSION_JSON")"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["bgt_", "BEGIN OPENSSH", "PRIVATE KEY", "sk_live_"]) {
  if (text.includes(forbidden)) throw new Error(`default session leaked ${forbidden}`);
}
const session = JSON.parse(text).session;
const ssh = session.production_ssh;
if (ssh.enabled !== true) throw new Error("default production SSH not enabled");
if (ssh.mode !== "read_only") throw new Error("default production SSH mode was not read_only");
if (ssh.read_only_diagnostics_enabled !== true) throw new Error("read-only diagnostics not enabled");
if (ssh.write_enabled !== false) throw new Error("write access enabled by default");
if (ssh.credential_material_returned !== false || ssh.key_material_returned !== false) {
  throw new Error("production SSH returned credential material");
}
if (ssh.owner_plane !== "BitterGrid") throw new Error("wrong production SSH owner plane");
if (!session.readiness_message.includes("read-only diagnostics")) throw new Error("readiness missing read-only SSH copy");
' "$DEFAULT_SESSION_JSON"

rg "Production SSH" "$SOURCE_ROOT/AGENTS.md" >/dev/null
rg "break-glass" "$SOURCE_ROOT/AGENTS.md" >/dev/null
rg "Write or operate access is off by default" "$SOURCE_ROOT/AGENTS.md" >/dev/null

curl -fsS "$TERMINAL_URL" >"$TERMINAL_HTML"
rg "Production SSH" "$TERMINAL_HTML" >/dev/null
rg "read_only" "$TERMINAL_HTML" >/dev/null
rg "Write/operate" "$TERMINAL_HTML" >/dev/null
if rg "bgt_|BEGIN OPENSSH|PRIVATE KEY|sk_live_" "$TERMINAL_HTML" >/dev/null; then
  echo "terminal leaked token, key, or secret material" >&2
  exit 1
fi

INVALID_CODE="$(curl -sS -o "$INVALID_SESSION_JSON" -w "%{http_code}" \
  -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"production_ssh":{"write_enabled":true}}')"
test "$INVALID_CODE" = "422"
rg "write_reason" "$INVALID_SESSION_JSON" >/dev/null

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"production_ssh":{"mode":"operate","write_enabled":true,"write_reason":"Gate 39 operate proof","target":{"service":"web","host_ref":"grid-host-01"}}}' >"$WRITE_SESSION_JSON"

WRITE_SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$WRITE_SESSION_JSON")"
bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["Gate 39 operate proof", "bgt_", "BEGIN OPENSSH", "PRIVATE KEY", "sk_live_"]) {
  if (text.includes(forbidden)) throw new Error(`write session leaked ${forbidden}`);
}
const session = JSON.parse(text).session;
const ssh = session.production_ssh;
if (ssh.mode !== "operate") throw new Error("write session did not enter operate mode");
if (ssh.write_enabled !== true) throw new Error("write session not write-enabled");
if (ssh.write_reason_present !== true) throw new Error("write reason not recorded as present");
if (ssh.target.service !== "web" || ssh.target.host_ref !== "grid-host-01") throw new Error("write target mismatch");
if (session.readiness_message.includes("off by default")) throw new Error("write session readiness still claimed write was off");
' "$WRITE_SESSION_JSON"

git -C "$SOURCE_ROOT" config user.email "gate39@bittergit.local"
git -C "$SOURCE_ROOT" config user.name "BitterGit Gate 39"
git -C "$SOURCE_ROOT" checkout -B gate39-before-revoke
printf 'production ssh session proof\n' >"$SOURCE_ROOT/gate39.txt"
git -C "$SOURCE_ROOT" add gate39.txt
git -C "$SOURCE_ROOT" commit -m "Add Gate 39 production SSH proof"
git -C "$SOURCE_ROOT" push origin gate39-before-revoke

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/revoke" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$REVOKE_JSON"

bun -e '
const session = (await Bun.file(process.argv[1]).json()).session;
if (session.status !== "revoked") throw new Error("default session was not revoked");
if (session.production_ssh.access_status !== "revoked") throw new Error("production SSH access status did not revoke");
if (session.production_ssh.write_enabled !== false) throw new Error("revoked default session gained write access");
' "$REVOKE_JSON"

git -C "$SOURCE_ROOT" checkout -B gate39-after-revoke
printf 'revoked production ssh proof\n' >"$SOURCE_ROOT/gate39-revoked.txt"
git -C "$SOURCE_ROOT" add gate39-revoked.txt
git -C "$SOURCE_ROOT" commit -m "Attempt revoked Gate 39 push"
if git -C "$SOURCE_ROOT" push origin gate39-after-revoke; then
  echo "revoked session unexpectedly retained Git write access" >&2
  exit 1
fi

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$REPO_SUPPORT_JSON"
curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/support-debug" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$APP_SUPPORT_JSON"

bun -e '
const repoText = await Bun.file(process.argv[1]).text();
const appText = await Bun.file(process.argv[2]).text();
for (const forbidden of ["Gate 39 operate proof", "bgt_", "BEGIN OPENSSH", "PRIVATE KEY", "sk_live_"]) {
  if (repoText.includes(forbidden) || appText.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const repoSupport = JSON.parse(repoText).support;
const defaultSession = repoSupport.hosted_workcell_sessions.find((entry) => entry.id === process.argv[3]);
if (!defaultSession) throw new Error("repo support missing default session");
if (defaultSession.production_ssh.mode !== "read_only") throw new Error("repo support default mode mismatch");
if (defaultSession.production_ssh.access_status !== "revoked") throw new Error("repo support missing revoked SSH status");
if (defaultSession.production_ssh.write_enabled !== false) throw new Error("repo support default write enabled");
const writeSession = repoSupport.hosted_workcell_sessions.find((entry) => entry.id === process.argv[4]);
if (!writeSession) throw new Error("repo support missing write session");
if (writeSession.production_ssh.mode !== "operate") throw new Error("repo support write mode mismatch");
if (writeSession.production_ssh.write_enabled !== true) throw new Error("repo support write flag missing");
if (writeSession.production_ssh.write_reason_present !== true) throw new Error("repo support missing write reason presence");
if (writeSession.production_ssh.target.host_ref !== "grid-host-01") throw new Error("repo support target mismatch");
const appSupport = JSON.parse(appText).support;
const latest = appSupport.workcell.production_ssh_latest;
if (latest.mode !== "operate" || latest.write_enabled !== true) throw new Error("app support latest production SSH mismatch");
if (latest.owner_plane !== "BitterGrid") throw new Error("app support owner plane mismatch");
' "$REPO_SUPPORT_JSON" "$APP_SUPPORT_JSON" "$SESSION_ID" "$WRITE_SESSION_ID"

rg "scripts/smoke-gate-39-production-ssh-session.sh" scripts/smoke-all.sh >/dev/null

echo "Gate 39 smoke passed for production SSH session option on $APP_ID"
