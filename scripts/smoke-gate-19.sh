#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate19-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-19-${REPO}}"
EXPORT_REMOTE="${WORKDIR}-export.git"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-19-create-json.XXXXXX)"
APP_HTML="$(mktemp /tmp/bittergit-gate-19-app-html.XXXXXX)"
WORKCELL_JSON="$(mktemp /tmp/bittergit-gate-19-workcell-json.XXXXXX)"
CHECKPOINT_JSON="$(mktemp /tmp/bittergit-gate-19-checkpoint-json.XXXXXX)"
RESTORE_JSON="$(mktemp /tmp/bittergit-gate-19-restore-json.XXXXXX)"
DEPLOY_JSON="$(mktemp /tmp/bittergit-gate-19-deploy-json.XXXXXX)"
VERIFY_JSON="$(mktemp /tmp/bittergit-gate-19-verify-json.XXXXXX)"
SECRET_JSON="$(mktemp /tmp/bittergit-gate-19-secret-json.XXXXXX)"
SECRETS_JSON="$(mktemp /tmp/bittergit-gate-19-secrets-json.XXXXXX)"
EXPORT_JSON="$(mktemp /tmp/bittergit-gate-19-export-json.XXXXXX)"
MIRROR_JSON="$(mktemp /tmp/bittergit-gate-19-mirror-json.XXXXXX)"
REMOTE_JSON="$(mktemp /tmp/bittergit-gate-19-remote-json.XXXXXX)"
SUPPORT_JSON="$(mktemp /tmp/bittergit-gate-19-support-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$WORKDIR" "$EXPORT_REMOTE"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"
READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$CREATE_JSON")"
MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$CREATE_JSON")"

bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.clone_url.includes("127.0.0.1")) throw new Error("local launch clone URL missing");
if (data.clone_url.includes("github.com")) throw new Error("app creation depended on GitHub");
if (data.existing !== false) throw new Error("new app was not created");
' "$CREATE_JSON"

curl -fsS "$BASE_URL/apps/$OWNER/$REPO" >"$APP_HTML"
rg "Backstage" "$APP_HTML" >/dev/null
rg "Secrets" "$APP_HTML" >/dev/null
rg "Source truth" "$APP_HTML" >/dev/null
rg "BitterGit primary" "$APP_HTML" >/dev/null

curl -fsS -X POST "$BASE_URL/bittergit/v1/workcells" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$WORKCELL_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.checkout_path || !data.remote_url.includes(process.argv[2])) throw new Error("usable workcell was not created");
if (String(data.remote_url).includes("@")) throw new Error("workcell remote URL leaked credentials");
' "$WORKCELL_JSON" "$REPO"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"
git config user.email "gate19@bittergit.local"
git config user.name "BitterGit Gate 19"
echo "launch version one" > launch.txt
git add launch.txt
git commit -m "Launch version one"
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main
V1_SHA="$(git rev-parse HEAD)"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Launch version one","checkpoint_type":"launch","ref":"refs/heads/main"}' >"$CHECKPOINT_JSON"
CHECKPOINT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.id);' "$CHECKPOINT_JSON")"

echo "launch version two with mistake" >> launch.txt
git add launch.txt
git commit -m "Launch version two mistake"
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main
V2_SHA="$(git rev-parse HEAD)"
test "$V1_SHA" != "$V2_SHA"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/checkpoints/$CHECKPOINT_ID/restore" \
  -H "Authorization: Bearer $MAIN_TOKEN" >"$RESTORE_JSON"
REMOTE_MAIN="$(git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" ls-remote origin refs/heads/main | awk '{print $1}')"
test "$REMOTE_MAIN" = "$V1_SHA"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/deployments" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"production\",\"commit_sha\":\"$V1_SHA\",\"checkpoint_id\":\"$CHECKPOINT_ID\"}" >"$DEPLOY_JSON"
DEPLOYMENT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.deployment.id);' "$DEPLOY_JSON")"
RECEIPT_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.receipt.id);' "$DEPLOY_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/deployments/$DEPLOYMENT_ID/verification" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"passed","summary":"local launch verification passed"}' >"$VERIFY_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.verification.status !== "passed") throw new Error("deployment verification did not pass");
' "$VERIFY_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/secrets" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"STRIPE_SECRET_KEY\",\"environment\":\"production\",\"credential_ref\":\"bitterpass://apps/$OWNER/$REPO/STRIPE_SECRET_KEY\"}" >"$SECRET_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.secret.name !== "STRIPE_SECRET_KEY") throw new Error("secret ref was not registered");
if (data.secret.value_stored_in_bittergit !== false) throw new Error("secret ref stored a value");
' "$SECRET_JSON"

SECRET_VALUE_STATUS="$(curl -sS -o /tmp/bittergit-gate-19-secret-value-response.json -w "%{http_code}" \
  -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/secrets" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"BAD_SECRET","environment":"production","credential_ref":"bitterpass://apps/test/bad","value":"sk_live_12345678901234567890"}')"
test "$SECRET_VALUE_STATUS" = "422"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/secrets" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SECRETS_JSON"
bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("sk_live_")) throw new Error("secret value leaked into secrets response");
const data = JSON.parse(text);
if (!data.secrets.some((secret) => secret.name === "STRIPE_SECRET_KEY" && secret.value_stored_in_bittergit === false)) {
  throw new Error("secret ref missing from list");
}
' "$SECRETS_JSON"

git init --bare "$EXPORT_REMOTE" >/dev/null
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/exports" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"local_git\",\"destination_url\":\"$EXPORT_REMOTE\"}" >"$EXPORT_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.export.status !== "ok") throw new Error("source export failed");
if (data.export.head_sha !== process.argv[2]) throw new Error("export did not point at restored launch SHA");
' "$EXPORT_JSON" "$V1_SHA"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/remotes" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"github\",\"provider\":\"github\",\"remote_url\":\"https://github.com/example/$REPO.git\",\"role\":\"export\"}" >"$REMOTE_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/mirrors" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"local_git\",\"remote_url\":\"$EXPORT_REMOTE\",\"sync_now\":false}" >"$MIRROR_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!["pending", "ok"].includes(data.mirror.status)) throw new Error("mirror option was not recorded");
' "$MIRROR_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$SUPPORT_JSON"
bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("sk_live_")) throw new Error("support bundle leaked a secret value");
if (text.includes("bgt_")) throw new Error("support bundle leaked a token");
const data = JSON.parse(text).support;
if (data.support_policy.requires_ssh !== false) throw new Error("support still requires SSH");
if (data.support_policy.includes_secret_values !== false) throw new Error("support bundle includes secret values");
if (data.source_history.ref_event_count < 3) throw new Error("support bundle missing source history");
if (data.deployments.length < 1 || data.receipts.length < 2) throw new Error("support bundle missing deploy receipts");
if (!data.secret_refs.some((secret) => secret.name === "STRIPE_SECRET_KEY" && secret.has_credential_ref === true)) {
  throw new Error("support bundle missing secret ref state");
}
if (!data.remotes.some((remote) => remote.name === "github" && remote.role === "export")) {
  throw new Error("support bundle missing export remote story");
}
if (data.mirrors.length < 1) throw new Error("support bundle missing mirror story");
' "$SUPPORT_JSON"

echo "Gate 19 smoke passed for no-GitHub app $OWNER/$REPO with deploy receipt $RECEIPT_ID"
