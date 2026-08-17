#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
STAMP="$(date -u +%Y%m%d%H%M%S)-$$"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-49.XXXXXX)"
SOURCE_WORK="$WORK_ROOT/source-work"
SOURCE_REMOTE="$WORK_ROOT/source.git"

export GIT_TERMINAL_PROMPT=0

make_factory_bridge_assertion() {
  local account_ref="$1"
  local workspace_ref="$2"
  bun -e '
import { createHmac } from "node:crypto";
const payload = {
  iss: "factory.local",
  aud: "bittergit",
  sub: `factory:${process.argv[1]}:user:gate49`,
  jti: `factory-git-import-${Date.now()}-${Math.random()}`,
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

mkdir -p "$SOURCE_WORK/assets"
git -C "$SOURCE_WORK" init -q
git -C "$SOURCE_WORK" config user.email "source@example.test"
git -C "$SOURCE_WORK" config user.name "Source Builder"
printf '<!doctype html><html><body><h1>Example Static App</h1></body></html>\n' >"$SOURCE_WORK/index.html"
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>\n' >"$SOURCE_WORK/assets/logo.svg"
printf '{"name":"example-static-artifact","private":true}\n' >"$SOURCE_WORK/package.json"
git -C "$SOURCE_WORK" add -A
git -C "$SOURCE_WORK" commit -q -m "Initial example app artifact"
git -C "$SOURCE_WORK" branch -M main
git -C "$SOURCE_WORK" tag v0.1.0
git init --bare -q "$SOURCE_REMOTE"
git -C "$SOURCE_WORK" remote add origin "$SOURCE_REMOTE"
git -C "$SOURCE_WORK" push -q origin main --tags

ACCOUNT_REF="account:gate49-example-$STAMP"
WORKSPACE_REF="bitterhub:hub-account-gate49-$STAMP"
ASSERTION="$(make_factory_bridge_assertion "$ACCOUNT_REF" "$WORKSPACE_REF")"
IMPORT_JSON="$WORK_ROOT/import-bundle.json"
PROGRESS_JSON="$WORK_ROOT/progress.json"
CUSTOMER_SUPPORT_JSON="$WORK_ROOT/customer-support.json"
REPO_SUPPORT_JSON="$WORK_ROOT/repo-support.json"
BAD_ACCOUNT_REF="account:gate49-bad-$STAMP"
BAD_ASSERTION="$(make_factory_bridge_assertion "$BAD_ACCOUNT_REF" "bitterhub:hub-account-gate49-bad-$STAMP")"
BAD_JSON="$WORK_ROOT/bad-embedded-creds.json"
BAD_PLAN_JSON="$WORK_ROOT/bad-plan.json"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/git-import-app-bundles" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"example-import\",\"display_name\":\"Example Import\",\"source_url\":\"$SOURCE_REMOTE\"}" >"$IMPORT_JSON"

APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$IMPORT_JSON")"
OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$IMPORT_JSON")"
REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$IMPORT_JSON")"
READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$IMPORT_JSON")"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["dev-token", "bga2.", "github_required=true", "secret_material", "BEGIN OPENSSH", "PRIVATE KEY"]) {
  if (text.includes(forbidden)) throw new Error(`import response leaked ${forbidden}`);
}
const data = JSON.parse(text);
if (data.github_required !== false || data.plan.github_required !== false) throw new Error("GitHub became required");
if (data.app.source_posture !== "bittergit_primary") throw new Error("app was not BitterGit primary");
if (data.git_import.source_kind !== "git_url_import") throw new Error("wrong import source kind");
if (data.source_contract.mode !== "bittergit_import") throw new Error("wrong source contract mode");
if (data.source_contract.sync_contract !== "one_time_import_no_background_sync") throw new Error("Git import implied background sync");
if (data.git_import.source_of_truth !== "bittergit") throw new Error("Git import did not make BitterGit canonical");
if (data.git_import.upstream_relationship !== "import_then_detach") throw new Error("Git import did not detach upstream");
if (data.git_import.sync_contract !== "one_time_import_no_background_sync") throw new Error("wrong Git import sync contract");
if (data.git_import.upstream_after_import.background_sync !== false) throw new Error("upstream background sync was enabled");
if (data.git_import.source_url.kind !== "local_git") throw new Error("local Git smoke source was not reported safely");
if (data.git_import.default_branch !== "main") throw new Error("default branch not detected");
if (data.git_import.branch_count !== 1) throw new Error("branch count mismatch");
if (data.git_import.tag_count !== 1) throw new Error("tag count mismatch");
if (!data.git_import.head_sha) throw new Error("missing imported HEAD SHA");
if (data.git_import.terminal_prompt_disabled !== true) throw new Error("GIT_TERMINAL_PROMPT posture missing");
if (data.context_files.canonical_instructions !== "AGENTS.md") throw new Error("wrong canonical instruction file");
const contextStatuses = Object.fromEntries(data.context_files.files.map((file) => [file.path, file.status]));
if (contextStatuses["AGENTS.md"] !== "added") throw new Error("AGENTS.md context status was not added");
if (contextStatuses["APP.md"] !== "added") throw new Error("APP.md context status was not added");
if (contextStatuses["docs/BITTERGRID_DEPLOYMENT_CONTRACT.md"] !== "added") throw new Error("deployment contract context status was not added");
if (contextStatuses["CLAUDE.md"] !== "missing") throw new Error("CLAUDE.md context status was not missing");
if (contextStatuses["GEMINI.md"] !== "missing") throw new Error("GEMINI.md context status was not missing");
for (const required of [".gitignore", "AGENTS.md", "APP.md", "docs/BITTERGRID_DEPLOYMENT_CONTRACT.md", "index.html", "assets/logo.svg", "package.json"]) {
  if (!data.source_tree.includes(required)) throw new Error(`missing imported source file ${required}`);
}
for (const scaffold of [".gitignore", "AGENTS.md", "APP.md", "docs/BITTERGRID_DEPLOYMENT_CONTRACT.md"]) {
  if (!data.git_import.scaffold_added.includes(scaffold)) throw new Error(`missing scaffold_added ${scaffold}`);
}
if (data.setup_state.status !== "ready") throw new Error("setup was not ready");
if (!String(data.setup_state.user_message).includes("APP.md")) throw new Error("setup missing charter guidance");
' "$IMPORT_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/setup/progress" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$PROGRESS_JSON"
bun -e '
const progress = (await Bun.file(process.argv[1]).json()).progress;
if (progress.status !== "ready" || progress.progress_percent !== 100) throw new Error("setup progress not ready");
if (!progress.steps.some((step) => step.key === "git_import" && step.label === "Git source import")) throw new Error("missing Git import setup step");
if (!progress.steps.some((step) => step.key === "charter_scaffold" && step.label === "Charter files")) throw new Error("missing charter scaffold setup step");
' "$PROGRESS_JSON"
assert_clean_text "$PROGRESS_JSON" "bga2\\." "bgt_" "dev-token" "secret_material" "raw source" "private log"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/support-debug" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$CUSTOMER_SUPPORT_JSON"
curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/support-debug" \
  -H "Authorization: Bearer $READ_TOKEN" >"$REPO_SUPPORT_JSON"

assert_clean_text "$CUSTOMER_SUPPORT_JSON" "bga2\\." "bgt_" "dev-token" "BEGIN OPENSSH" "PRIVATE KEY" "secret_material" "Bearer" "user:pass"
assert_clean_text "$REPO_SUPPORT_JSON" "bga2\\." "bgt_" "dev-token" "BEGIN OPENSSH" "PRIVATE KEY" "secret_material" "Bearer" "user:pass"

bun -e '
const support = (await Bun.file(process.argv[1]).json()).support;
if (support.import.source_kind !== "git_url_import") throw new Error("customer support missing Git import source kind");
if (support.import.default_branch !== "main") throw new Error("customer support missing default branch");
if (support.import.branch_count !== 1 || support.import.tag_count !== 1) throw new Error("customer support ref counts wrong");
if (support.import.sync_contract !== "one_time_import_no_background_sync") throw new Error("customer support missing detached import sync contract");
if (support.import.upstream_relationship !== "import_then_detach") throw new Error("customer support missing import detach posture");
if (support.import.upstream_after_import.background_sync !== false) throw new Error("customer support implied upstream sync");
if (support.import.terminal_prompt_disabled !== true) throw new Error("customer support missing prompt-disabled posture");
const repo = (await Bun.file(process.argv[2]).json()).support;
if (repo.plan.github_required !== false) throw new Error("repo support required GitHub");
if (!repo.receipts.some((receipt) => receipt.receipt_type === "git_import_app_setup")) throw new Error("repo support missing Git import receipt");
' "$CUSTOMER_SUPPORT_JSON" "$REPO_SUPPORT_JSON"

status="$(curl -sS -o "$BAD_JSON" -w "%{http_code}" \
  -X POST "$BASE_URL/bittergit/v1/customer/git-import-app-bundles" \
  -H "X-Bitter-Account-Assertion: $BAD_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"name":"bad-import","source_url":"https://user:pass@example.com/private/repo.git"}')"
test "$status" = "400"
rg "credentials must not be embedded in source_url" "$BAD_JSON" >/dev/null

curl -fsS "$BASE_URL/bittergit/v1/customer/plan" \
  -H "X-Bitter-Account-Assertion: $BAD_ASSERTION" >"$BAD_PLAN_JSON"
bun -e '
const plan = (await Bun.file(process.argv[1]).json()).plan;
if (plan.active_app_count !== 0 || plan.remaining_app_slots !== 1) throw new Error("rejected credential URL consumed an app slot");
' "$BAD_PLAN_JSON"

echo "Gate 49 smoke passed for public Git URL import app bundle $OWNER/$REPO"
