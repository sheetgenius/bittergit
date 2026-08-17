#!/usr/bin/env bash
set -euo pipefail

BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
STAMP="$(date -u +%Y%m%d%H%M%S)-$$"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-52.XXXXXX)"
GRID_RECORDS="$WORK_ROOT/grid-records.jsonl"
FAKE_GRID="$WORK_ROOT/fake-grid.ts"
BITTERGIT_PORT="${BITTERGIT_GATE52_PORT:-$((29600 + RANDOM % 1000))}"
GRID_PORT="${BITTERGIT_GATE52_GRID_PORT:-$((30600 + RANDOM % 1000))}"
BASE_URL="http://127.0.0.1:$BITTERGIT_PORT"
GRID_URL="http://127.0.0.1:$GRID_PORT/api/v1"
ACCOUNT_REF="account:gate52-example-$STAMP"
WORKSPACE_REF="bitterhub:hub-account-gate52-$STAMP"
APP_NAME="gate52-charter-launch"
BUNDLE_ID="bundle_gate52_codex_should_not_leak"
READY_JSON="$WORK_ROOT/ready-launch.json"
MISSING_AUTH_JSON="$WORK_ROOT/missing-auth-launch.json"
MISSING_CLI_JSON="$WORK_ROOT/missing-cli-launch.json"
BUNDLE_JSON="$WORK_ROOT/bundle.json"
SESSION_JSON="$WORK_ROOT/session.json"
SUPPORT_JSON="$WORK_ROOT/support.json"

cat >"$FAKE_GRID" <<'FAKE_GRID'
import { appendFileSync } from "node:fs";

const port = Number(process.env.GRID_PORT);
const recordsPath = process.env.GRID_RECORDS;
const token = process.env.GRID_TOKEN;
const workcells = new Map();
let workcellCounter = 0;
let sessionCounter = 0;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function record(entry) {
  appendFileSync(recordsPath, `${JSON.stringify(entry)}\n`);
}

function parseBody(text) {
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

function workcellPayload(workcell) {
  return {
    id: workcell.id,
    key: workcell.key,
    name: workcell.name,
    template: workcell.template,
    repo_url: workcell.repo_url,
    repo_ref: workcell.repo_ref,
    status: workcell.status,
    host_slug: "grid-host-01",
    metadata: {
      ...workcell.metadata,
      source_control: {
        ...(workcell.metadata.source_control || {}),
        credential_helper: "configured"
      },
      workspace: {
        root: `/var/lib/bittergrid/workcells/${workcell.key}/workspace`,
        credential_helper: "configured"
      }
    },
    recent_operations: [
      { id: "grid-op-ensure-gate52", kind: "workcell.ensure.execute", state: "succeeded" }
    ],
    secret_material_returned: false
  };
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v1/, "");
    if (path === "/up") return json({ ok: true });
    if (request.headers.get("authorization") !== `Bearer ${token}`) {
      return json({ error: "unauthorized" }, 401);
    }

    if (request.method === "GET" && path === "/hosts") {
      record({ method: request.method, path, authorized: true });
      return json({ hosts: [{ id: 52, slug: "grid-host-01", role: "runtime", status: "online" }] });
    }

    if (request.method === "GET" && path.startsWith("/workcells/") && !path.endsWith("/terminal_attachment")) {
      const key = decodeURIComponent(path.split("/")[2] || "");
      const workcell = workcells.get(key);
      record({ method: request.method, path, found: Boolean(workcell), authorized: true });
      if (!workcell) return json({ error: "not found" }, 404);
      return json({ workcell: workcellPayload(workcell) });
    }

    if (request.method === "POST" && path === "/workcells") {
      const text = await request.text();
      const parsed = parseBody(text);
      const attrs = parsed.workcell;
      const credential = attrs?.metadata?.source_control?.credential_helper;
      record({
        method: request.method,
        path,
        repo_url: attrs?.repo_url,
        has_credential_helper_password: Boolean(credential?.password),
        body_had_grid_token: text.includes(token),
        body_had_bittergit_token: text.includes("bgt_")
      });
      const workcell = {
        id: `grid-wc-${++workcellCounter}`,
        key: attrs.key,
        name: attrs.name,
        template: attrs.template,
        repo_url: attrs.repo_url,
        repo_ref: attrs.repo_ref,
        status: "ready",
        metadata: attrs.metadata || {}
      };
      workcells.set(workcell.key, workcell);
      workcells.set(workcell.id, workcell);
      return json({ workcell: workcellPayload(workcell) }, 201);
    }

    if (request.method === "POST" && path.endsWith("/ensure")) {
      const id = decodeURIComponent(path.split("/")[2] || "");
      const workcell = workcells.get(id);
      record({ method: request.method, path, workcell_found: Boolean(workcell) });
      if (!workcell) return json({ error: "not found" }, 404);
      return json({ workcell: workcellPayload(workcell) });
    }

    if (request.method === "POST" && path.endsWith("/execution_sessions")) {
      const id = decodeURIComponent(path.split("/")[2] || "");
      const workcell = workcells.get(id);
      record({ method: request.method, path, workcell_found: Boolean(workcell) });
      if (!workcell) return json({ error: "not found" }, 404);
      return json({
        execution_session: {
          id: `grid-session-${++sessionCounter}`,
          state: "attached",
          actor_kind: "agent",
          actor_ref: "bittergit"
        },
        workcell: workcellPayload(workcell)
      }, 201);
    }

    if (request.method === "GET" && path.endsWith("/terminal_attachment")) {
      const id = decodeURIComponent(path.split("/")[2] || "");
      const workcell = workcells.get(id);
      record({ method: request.method, path, workcell_found: Boolean(workcell) });
      if (!workcell) return json({ error: "not found" }, 404);
      const appSlug = workcell.metadata.app_slug;
      const routePath = `/app/apps/${encodeURIComponent(appSlug)}/backstage/terminal`;
      return json({
        terminal_attachment: {
          status: "ready_for_grid_owned_ensure",
          terminal: { url: `https://terminal.example.test${routePath}/`, transport: "ttyd-websocket-v1" },
          runtime: { workspace_root: `/var/lib/bittergrid/workcells/${workcell.key}/workspace` },
          blockers: [],
          secret_material_returned: false
        }
      });
    }

    if (request.method === "POST" && path.endsWith("/exec")) {
      const id = decodeURIComponent(path.split("/")[2] || "");
      const workcell = workcells.get(id);
      const text = await request.text();
      const parsed = parseBody(text);
      const script = parsed?.command?.script || "";
      const provider = script.includes("claude --version") ? "claude" : "codex";
      const available = provider === "codex";
      record({
        method: request.method,
        path,
        workcell_found: Boolean(workcell),
        execution_session_id: parsed.execution_session_id || null,
        provider,
        body_had_bundle: text.includes("bundle_gate52"),
        body_had_bittergit_token: text.includes("bgt_")
      });
      if (!workcell) return json({ error: "not found" }, 404);
      return json({
        stdout: [
          "BITTERGIT_WORKCELL_PWD=/workspace",
          `BITTERGIT_ORIGIN_REMOTE=${workcell.repo_url}`,
          "BITTERGIT_AGENTS_PRESENT=1",
          "BITTERGIT_APP_PRESENT=1",
          `BITTERGIT_PROVIDER_CLI_AVAILABLE=${available ? "1" : "0"}`,
          available ? "BITTERGIT_PROVIDER_CLI_VERSION=codex 1.2.3" : "BITTERGIT_PROVIDER_CLI_VERSION="
        ].join("\n"),
        stderr: "",
        exit_code: 0,
        duration_ms: 12,
        operation: { id: "grid-op-exec-gate52", kind: "workcell.exec.buffered", state: "succeeded" }
      });
    }

    if (request.method === "POST" && path.endsWith("/terminal_attachment/provider_bootstrap")) {
      const text = await request.text();
      const parsed = parseBody(text);
      record({
        method: request.method,
        path,
        provider: parsed.provider,
        has_bundle_id: Boolean(parsed.bundle_id),
        body_had_bundle_value: text.includes("bundle_gate52"),
        body_had_bittergit_token: text.includes("bgt_")
      });
      if (!parsed.bundle_id) {
        return json({
          status: "blocked",
          mutates: false,
          terminal_provider_bootstrap: {
            status: "blocked",
            next_action: "issue a short-lived Factory BitterPass bundle for the provider scope before confirming bootstrap",
            secret_material_returned: false
          },
          secret_material_returned: false
        }, 422);
      }
      return json({
        status: "dry_run",
        mutates: false,
        terminal_provider_bootstrap: {
          status: "ready",
          provider: { name: parsed.provider, scope_namespace: `${parsed.provider}_cli`, secret_material_returned: false },
          bundle: { bundle_id_status: "present", secret_material_returned: false },
          custody: { source: "factory_bitterpass_broker_bundle", secret_material_returned: false },
          secret_material_returned: false
        },
        secret_material_returned: false
      });
    }

    return json({ error: "not found", path }, 404);
  }
});

console.log(`Fake Grid listening on ${port}`);
FAKE_GRID

cleanup() {
  if [[ -n "${BITTERGIT_PID:-}" ]]; then kill "$BITTERGIT_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "${GRID_PID:-}" ]]; then kill "$GRID_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

GRID_PORT="$GRID_PORT" GRID_RECORDS="$GRID_RECORDS" GRID_TOKEN="grid-test-token" bun "$FAKE_GRID" >"$WORK_ROOT/fake-grid.log" 2>&1 &
GRID_PID="$!"

BITTERGIT_ROOT="$(pwd)" \
BITTERGIT_DATA_ROOT="$WORK_ROOT/bittergit" \
BITTERGIT_PORT="$BITTERGIT_PORT" \
BITTERGIT_PUBLIC_BASE_URL="$BASE_URL" \
BITTERGRID_API_URL="$GRID_URL" \
BITTERGRID_SERVICE_TOKEN="grid-test-token" \
BITTERGIT_GRID_TERMINAL_MODE="api" \
BITTERGIT_GRID_HOST_SLUG="grid-host-01" \
bun run src/server.ts >"$WORK_ROOT/bittergit.log" 2>&1 &
BITTERGIT_PID="$!"

for _ in {1..80}; do
  if curl -fsS "$GRID_URL/up" >/dev/null 2>&1 && curl -fsS "$BASE_URL/bittergit/v1/providers" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

curl -fsS "$GRID_URL/up" >/dev/null
curl -fsS "$BASE_URL/bittergit/v1/providers" >/dev/null

ASSERTION="$(bun -e '
import { createHmac } from "node:crypto";
const payload = {
  iss: "factory.local",
  aud: "bittergit",
  sub: `factory:${process.argv[1]}:user:gate52`,
  jti: `factory-provider-readiness-${Date.now()}-${Math.random()}`,
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
' "$ACCOUNT_REF" "$WORKSPACE_REF" "$BOOTSTRAP_TOKEN")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/app-bundles" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$APP_NAME\"}" >"$BUNDLE_JSON"

APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$BUNDLE_JSON")"
OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$BUNDLE_JSON")"
REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$BUNDLE_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"terminal_fulfillment":{"mode":"grid_api","box_ref":"grid-host-01"}}' >"$SESSION_JSON"

SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$SESSION_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"codex\",\"provider_auth\":{\"bundle_id\":\"$BUNDLE_ID\",\"service_url\":\"https://api.bitterpass.test\"},\"launch_refs\":{\"factory_run_ref\":\"factory-run-gate52\",\"bitter_session_ref\":\"bitter-session-gate52\",\"bitter_log_ref\":\"bitter-log-gate52\"}}" >"$READY_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of [process.argv[2], "grid-test-token", "bgt_", "sk-", "provider-auth.json", "/auth-src/", "BEGIN OPENSSH"]) {
  if (text.includes(forbidden)) throw new Error(`ready launch leaked ${forbidden}`);
}
const launch = JSON.parse(text).agent_launch;
if (launch.status !== "ready") throw new Error("ready launch was not ready");
if (launch.source_root !== "/workspace") throw new Error("launch source root did not come from Grid executor");
if (launch.origin_remote !== `${process.argv[3]}/${process.argv[4]}/${process.argv[5]}.git`) throw new Error("origin did not come from Grid executor");
if (launch.provider_cli.source !== "bittergrid_executor_command_v") throw new Error("provider CLI was not executor-derived");
if (launch.provider_cli.checked_by !== "bittergrid_exec") throw new Error("provider CLI check owner missing");
if (!String(launch.provider_cli.version).includes("codex 1.2.3")) throw new Error("provider version missing");
if (launch.provider_auth.source !== "bitterpass_provider_bootstrap_plan") throw new Error("provider auth was not BitterPass plan checked");
if (launch.provider_auth.bundle_present !== true) throw new Error("provider auth bundle presence missing");
if (launch.provider_auth.reference_returned !== false) throw new Error("provider auth reference leaked");
if (launch.provider_auth.credential_material_returned !== false) throw new Error("provider auth material leaked");
if (launch.readiness_evidence.evidence_source !== "bittergrid_exec") throw new Error("readiness was not executor-derived");
if (!launch.readiness_evidence.instructions_present || !launch.readiness_evidence.charter_present) throw new Error("charter scaffold not proven in Grid");
if (!launch.readiness_evidence.origin_remote_is_bittergit) throw new Error("origin was not recognized as BitterGit");
if (launch.readiness_evidence.origin_remote_has_token) throw new Error("origin token posture failed");
if (!launch.readiness_evidence.grid_workcell_id || !launch.readiness_evidence.grid_execution_session_id) throw new Error("Grid refs missing from readiness evidence");
if (!launch.launch_contract.first_prompt.includes("repo-local AGENTS.md and APP.md")) throw new Error("first prompt missing repo-local charter guidance");
if (!String(launch.launch_contract.implementation_before_charter).includes("blocked")) throw new Error("implementation was not charter-gated");
if (launch.launch_contract.runtime_refs.factory_run_ref !== "factory-run-gate52") throw new Error("Factory run ref mapping missing");
if (!launch.launch_contract.runtime_refs.grid_workcell_id) throw new Error("Grid workcell runtime ref missing");
' "$READY_JSON" "$BUNDLE_ID" "$BASE_URL" "$OWNER" "$REPO"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"provider":"codex"}' >"$MISSING_AUTH_JSON"

bun -e '
const launch = (await Bun.file(process.argv[1]).json()).agent_launch;
if (launch.status !== "blocked") throw new Error("missing bundle did not block launch");
if (launch.failure_reason !== "provider_auth_not_mounted") throw new Error("missing bundle failure reason wrong");
if (launch.provider_auth.bundle_present !== false) throw new Error("missing bundle posture wrong");
if (!String(launch.repair_action).includes("BitterPass provider auth bundle")) throw new Error("missing bundle repair action wrong");
' "$MISSING_AUTH_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/agent-launches" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"claude\",\"provider_auth\":{\"bundle_id\":\"$BUNDLE_ID\"}}" >"$MISSING_CLI_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes(process.argv[2])) throw new Error("missing CLI launch leaked bundle id");
const launch = JSON.parse(text).agent_launch;
if (launch.status !== "blocked") throw new Error("missing CLI did not block launch");
if (launch.failure_reason !== "provider_cli_unavailable") throw new Error("missing CLI failure reason wrong");
if (launch.provider_cli.available !== false) throw new Error("missing CLI availability wrong");
if (launch.provider_auth.bundle_present !== true) throw new Error("provider auth should still be bundle-ready");
' "$MISSING_CLI_JSON" "$BUNDLE_ID"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/support-debug" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of [process.argv[2], "grid-test-token", "bgt_", "sk-", "provider-auth.json", "/auth-src/", "BEGIN OPENSSH"]) {
  if (text.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
if (support.agent.ready_count !== 1) throw new Error("support missing ready agent launch");
if (support.agent.blocked_count < 2) throw new Error("support missing blocked repair states");
' "$SUPPORT_JSON" "$BUNDLE_ID"

bun -e '
const records = (await Bun.file(process.argv[1]).text()).trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
if (!records.some((record) => record.path.endsWith("/exec") && record.provider === "codex")) throw new Error("Grid exec did not check codex");
if (!records.some((record) => record.path.endsWith("/exec") && record.provider === "claude")) throw new Error("Grid exec did not check claude");
if (!records.some((record) => record.path.endsWith("/terminal_attachment/provider_bootstrap") && record.has_bundle_id === true)) throw new Error("Grid provider bootstrap plan was not checked");
if (records.some((record) => record.body_had_grid_token === true)) throw new Error("Grid request body leaked Grid service token");
if (records.some((record) => record.path.endsWith("/exec") && record.body_had_bittergit_token === true)) throw new Error("Grid exec leaked BitterGit token");
if (records.some((record) => record.path.endsWith("/terminal_attachment/provider_bootstrap") && record.body_had_bittergit_token === true)) throw new Error("Grid provider bootstrap leaked BitterGit token");
' "$GRID_RECORDS"

echo "Gate 52 smoke passed for real provider readiness and charter-first launch on $APP_ID"
