#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"

make_assertion() {
  local account_ref="$1"
  local workspace_ref="$2"
  bun -e '
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
' "$account_ref" "$workspace_ref" "$BOOTSTRAP_TOKEN"
}

create_session_launch_and_first_run() {
  local assertion="$1"
  local app_id="$2"
  local out_prefix="$3"

  curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$app_id/workcell-sessions" \
    -H "X-Bitter-Account-Assertion: $assertion" >"${out_prefix}-session.json"
  local session_id
  session_id="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "${out_prefix}-session.json")"

  curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$app_id/workcell-sessions/$session_id/agent-launches" \
    -H "X-Bitter-Account-Assertion: $assertion" \
    -H "Content-Type: application/json" \
    -d '{"provider":"codex"}' >"${out_prefix}-launch.json"
  local launch_id
  launch_id="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.agent_launch.id);' "${out_prefix}-launch.json")"

  curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$app_id/workcell-sessions/$session_id/agent-launches/$launch_id/first-runs" \
    -H "X-Bitter-Account-Assertion: $assertion" >"${out_prefix}-first-run.json"
  local first_run_id
  first_run_id="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.charter_first_run.id);' "${out_prefix}-first-run.json")"

  printf '%s %s %s\n' "$session_id" "$launch_id" "$first_run_id"
}

WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-34.XXXXXX)"
BLANK_BUNDLE_JSON="$WORK_ROOT/blank-bundle.json"
BLANK_FIRST_PREFIX="$WORK_ROOT/blank"
ARTIFACT_DIR="$WORK_ROOT/artifact"
IMPORT_JSON="$WORK_ROOT/import.json"
ARTIFACT_BUNDLE_JSON="$WORK_ROOT/artifact-bundle.json"
ARTIFACT_FIRST_PREFIX="$WORK_ROOT/artifact"
BLOCK_JSON="$WORK_ROOT/blocked.json"
SUFFICIENCY_JSON="$WORK_ROOT/sufficiency.json"
IMPLEMENTATION_JSON="$WORK_ROOT/implementation.json"
FETCH_JSON="$WORK_ROOT/fetch.json"
SUPPORT_JSON="$WORK_ROOT/support.json"
TERMINAL_HTML="$WORK_ROOT/terminal.html"

BLANK_ACCOUNT="acct-gate34-blank-$(date -u +%Y%m%d%H%M%S)-$$"
BLANK_WORKSPACE="wrk-gate34-blank-$$"
BLANK_ASSERTION="$(make_assertion "$BLANK_ACCOUNT" "$BLANK_WORKSPACE")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $BLANK_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"name":"gate34-blank"}' >"$BLANK_BUNDLE_JSON"
BLANK_APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$BLANK_BUNDLE_JSON")"
read -r BLANK_SESSION_ID BLANK_LAUNCH_ID BLANK_FIRST_RUN_ID < <(create_session_launch_and_first_run "$BLANK_ASSERTION" "$BLANK_APP_ID" "$BLANK_FIRST_PREFIX")

bun -e '
const firstRun = (await Bun.file(process.argv[1]).json()).charter_first_run;
if (firstRun.status !== "charter_required") throw new Error("blank first run did not require charter");
if (firstRun.charter_status !== "placeholder") throw new Error("blank charter was not classified as placeholder");
if (firstRun.source_kind !== "blank_app") throw new Error("blank source kind mismatch");
if (firstRun.substantial_implementation_allowed !== false) throw new Error("blank first run allowed implementation too early");
if (!firstRun.first_run_prompt.includes("verification gates")) throw new Error("prompt missing verification gates");
if (!firstRun.readiness_output.includes("GitHub is optional")) throw new Error("readiness missing GitHub optional");
if (!firstRun.readiness_output.includes("charter-only")) throw new Error("readiness missing charter-only posture");
' "$BLANK_FIRST_PREFIX-first-run.json"

mkdir -p "$ARTIFACT_DIR/assets"
printf '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Imported offer</h1><img src="assets/photo.png"></body></html>\n' >"$ARTIFACT_DIR/index.html"
printf 'body { font-family: sans-serif; }\n' >"$ARTIFACT_DIR/style.css"
printf 'fake image bytes\n' >"$ARTIFACT_DIR/assets/photo.png"
printf 'junk\n' >"$ARTIFACT_DIR/.DS_Store"

ARTIFACT_ACCOUNT="acct-gate34-artifact-$(date -u +%Y%m%d%H%M%S)-$$"
ARTIFACT_WORKSPACE="wrk-gate34-artifact-$$"
ARTIFACT_ASSERTION="$(make_assertion "$ARTIFACT_ACCOUNT" "$ARTIFACT_WORKSPACE")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/review" \
  -H "X-Bitter-Account-Assertion: $ARTIFACT_ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"source_kind\":\"folder\",\"source_path\":\"$ARTIFACT_DIR\"}" >"$IMPORT_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/artifact-imports/$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.artifact_import.id);' "$IMPORT_JSON")/app-bundle" \
  -H "X-Bitter-Account-Assertion: $ARTIFACT_ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"name":"gate34-imported"}' >"$ARTIFACT_BUNDLE_JSON"

ARTIFACT_APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$ARTIFACT_BUNDLE_JSON")"
ARTIFACT_OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$ARTIFACT_BUNDLE_JSON")"
ARTIFACT_REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$ARTIFACT_BUNDLE_JSON")"
ARTIFACT_READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$ARTIFACT_BUNDLE_JSON")"
read -r ARTIFACT_SESSION_ID ARTIFACT_LAUNCH_ID ARTIFACT_FIRST_RUN_ID < <(create_session_launch_and_first_run "$ARTIFACT_ASSERTION" "$ARTIFACT_APP_ID" "$ARTIFACT_FIRST_PREFIX")
ARTIFACT_SOURCE_ROOT="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.source_root);' "$ARTIFACT_FIRST_PREFIX-session.json")"
ARTIFACT_TERMINAL_URL="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.terminal_url);' "$ARTIFACT_FIRST_PREFIX-session.json")"

bun -e '
const firstRun = (await Bun.file(process.argv[1]).json()).charter_first_run;
if (firstRun.status !== "charter_required") throw new Error("artifact first run did not require charter");
if (firstRun.source_kind !== "artifact_import") throw new Error("artifact source kind mismatch");
if (firstRun.artifact_import_inspected !== true) throw new Error("artifact import was not marked inspected");
if (!firstRun.import_context.imported_artifact_summary) throw new Error("missing safe artifact summary");
if (firstRun.import_context.imported_artifact_summary.blocked_count !== 0) throw new Error("unexpected artifact blockers");
if (!firstRun.readiness_output.includes("Imported artifact review is recorded")) throw new Error("readiness missing artifact review");
' "$ARTIFACT_FIRST_PREFIX-first-run.json"

BLOCK_STATUS="$(curl -sS -o "$BLOCK_JSON" -w "%{http_code}" -X POST "$BASE_URL/bittergit/v1/customer/apps/$ARTIFACT_APP_ID/workcell-sessions/$ARTIFACT_SESSION_ID/agent-launches/$ARTIFACT_LAUNCH_ID/first-runs/$ARTIFACT_FIRST_RUN_ID/implementation-start" \
  -H "X-Bitter-Account-Assertion: $ARTIFACT_ASSERTION")"
test "$BLOCK_STATUS" = "409"
bun -e '
const blocked = await Bun.file(process.argv[1]).json();
if (blocked.status !== "blocked") throw new Error("implementation start did not block");
if (!blocked.charter_first_run.repair_action.includes("Complete APP.md")) throw new Error("repair action missing APP.md");
' "$BLOCK_JSON"

cat >"$ARTIFACT_SOURCE_ROOT/APP.md" <<'APP'
# App Charter

## Purpose

Publish a simple, trustworthy local event page from an imported static artifact.

## User

Community organizers who need a public page but do not want to assemble GitHub,
hosting, source history, and an agent terminal by hand.

## First Useful Version

A static page that clearly explains the event, shows the main action, loads
quickly, and can be published after visual review.

## Core Workflow

Visitor opens the page, understands the event, reviews details, and chooses the
next action without needing prior context.

## Constraints

Keep the first version static, accessible, fast, and source-controlled. Do not
add payments, accounts, or secret-backed integrations until the user asks.

## Axes Of Excellence

### User Value

- Intent: The page should help the organizer get real attendees or leads.
- Verification: A cold visitor can identify the event and next action.

### First Encounter

- Intent: The first screen should make the offer obvious without internal terms.
- Verification: Review the page as a new visitor with no Bitter context.

### Workflow Fit

- Intent: The page should match the organizer's actual event promotion flow.
- Verification: Confirm the page supports discovery, details, and contact.

### UX

- Intent: Navigation and calls to action should be obvious on mobile and desktop.
- Verification: Inspect the core path at mobile and desktop widths.

### Correctness

- Intent: Event details and links should be accurate and consistent.
- Verification: Check dates, copy, links, and visible state before publish.

### Performance

- Intent: The static page should load quickly with appropriately sized assets.
- Verification: Run a local load check and inspect media sizes.

### Security

- Intent: The app should not contain secrets, credentials, or unsafe embeds.
- Verification: Scan source and support debug output for secret-looking data.

### Ecosystem Awareness

- Intent: The page should fit how users encounter local event pages online.
- Verification: Compare copy and structure against common event landing pages.

### Verification

- Intent: Every material change should have a concrete review path.
- Verification: Maintain a short checklist before deploy or handoff.

## Verification Gates

- Cold visitor can state what the event is and what to do next.
- Page loads locally without console errors or missing media.
- Source contains no secret values or private credentials.

## Non-Goals

No account system, payment flow, CRM, or dynamic backend in the first version.
APP

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$ARTIFACT_APP_ID/workcell-sessions/$ARTIFACT_SESSION_ID/agent-launches/$ARTIFACT_LAUNCH_ID/first-runs/$ARTIFACT_FIRST_RUN_ID/charter-sufficiency" \
  -H "X-Bitter-Account-Assertion: $ARTIFACT_ASSERTION" >"$SUFFICIENCY_JSON"

bun -e '
const firstRun = (await Bun.file(process.argv[1]).json()).charter_first_run;
if (firstRun.status !== "ready_for_implementation") throw new Error("sufficient charter was not ready");
if (firstRun.charter_status !== "sufficient") throw new Error("charter was not sufficient");
if (firstRun.substantial_implementation_allowed !== true) throw new Error("implementation was not allowed after sufficiency");
if (!firstRun.sufficiency_recorded_at) throw new Error("sufficiency timestamp missing");
if (firstRun.charter_summary.verification_gate_count < 3) throw new Error("verification gates not counted");
' "$SUFFICIENCY_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$ARTIFACT_APP_ID/workcell-sessions/$ARTIFACT_SESSION_ID/agent-launches/$ARTIFACT_LAUNCH_ID/first-runs/$ARTIFACT_FIRST_RUN_ID/implementation-start" \
  -H "X-Bitter-Account-Assertion: $ARTIFACT_ASSERTION" >"$IMPLEMENTATION_JSON"
bun -e '
const start = await Bun.file(process.argv[1]).json();
if (start.status !== "allowed") throw new Error("implementation start was not allowed");
' "$IMPLEMENTATION_JSON"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$ARTIFACT_APP_ID/workcell-sessions/$ARTIFACT_SESSION_ID/agent-launches/$ARTIFACT_LAUNCH_ID/first-runs/$ARTIFACT_FIRST_RUN_ID" \
  -H "X-Bitter-Account-Assertion: $ARTIFACT_ASSERTION" >"$FETCH_JSON"
rg "ready_for_implementation" "$FETCH_JSON" >/dev/null

curl -fsS "$ARTIFACT_TERMINAL_URL" >"$TERMINAL_HTML"
rg "charter sufficiency" "$TERMINAL_HTML" >/dev/null
rg "verification gates" "$TERMINAL_HTML" >/dev/null

curl -fsS "$BASE_URL/bittergit/v1/repos/$ARTIFACT_OWNER/$ARTIFACT_REPO/support-debug" \
  -H "Authorization: Bearer $ARTIFACT_READ_TOKEN" >"$SUPPORT_JSON"
bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["sk-", "bgt_", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
  if (text.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
if (!Array.isArray(support.charter_first_runs) || support.charter_first_runs.length !== 1) {
  throw new Error("support missing charter-first run");
}
const firstRun = support.charter_first_runs[0];
if (firstRun.substantial_implementation_allowed !== true) throw new Error("support did not show sufficiency");
if (firstRun.policy.includes_raw_source_contents !== false) throw new Error("support claims raw source contents");
' "$SUPPORT_JSON"

echo "Gate 34 smoke passed for charter-first run $ARTIFACT_FIRST_RUN_ID on $ARTIFACT_OWNER/$ARTIFACT_REPO"
