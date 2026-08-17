#!/usr/bin/env bash
set -euo pipefail

BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
STAMP="$(date -u +%Y%m%d%H%M%S)-$$"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-51.XXXXXX)"
SOURCE_WORK="$WORK_ROOT/source-work"
SOURCE_REMOTE="$WORK_ROOT/source.git"
GRID_RECORDS="$WORK_ROOT/grid-records.jsonl"
FAKE_GRID="$WORK_ROOT/fake-grid.ts"
BITTERGIT_PORT="${BITTERGIT_GATE51_PORT:-$((27600 + RANDOM % 1000))}"
GRID_PORT="${BITTERGIT_GATE51_GRID_PORT:-$((28600 + RANDOM % 1000))}"
BASE_URL="http://127.0.0.1:$BITTERGIT_PORT"
GRID_URL="http://127.0.0.1:$GRID_PORT/api/v1"
ACCOUNT_REF="account:gate51-example-$STAMP"
WORKSPACE_REF="bitterhub:hub-account-gate51-$STAMP"
APP_NAME="gate51-example-app"
IMPORT_JSON="$WORK_ROOT/import.json"
SESSION_JSON="$WORK_ROOT/session.json"
SUPPORT_JSON="$WORK_ROOT/support.json"
REVOKE_JSON="$WORK_ROOT/revoke.json"

export GIT_TERMINAL_PROMPT=0

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

function redactedRecord(request, path, bodyText) {
  let parsed = {};
  try { parsed = bodyText ? JSON.parse(bodyText) : {}; } catch {}
  const credential = parsed?.workcell?.metadata?.source_control?.credential_helper;
  record({
    method: request.method,
    path,
    authorized: request.headers.get("authorization") === `Bearer ${token}`,
    repo_url: parsed?.workcell?.repo_url ?? null,
    host_id: parsed?.workcell?.host_id ?? null,
    has_credential_helper_password: Boolean(credential?.password),
    has_credential_helper_username: Boolean(credential?.username),
    body_had_bittergit_token: bodyText.includes("bgt_"),
    body_had_grid_token: bodyText.includes(token)
  });
}

function workcellPayload(workcell) {
  const recentSessions = workcell.sessions || [];
  const recentOperations = [
    ...(workcell.attachOperation ? [workcell.attachOperation] : []),
    { id: "grid-op-ensure-1", kind: "workcell.ensure.execute", state: "succeeded" }
  ];
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
        repo_head: "abc123",
        repo_status: "## main; clean;",
        credential_helper: "configured"
      }
    },
    latest_execution_session: recentSessions[0] || null,
    recent_execution_sessions: recentSessions,
    recent_operations: recentOperations,
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
      return json({
        hosts: [
          { id: 51, slug: "grid-host-01", role: "runtime", status: "online" }
        ]
      });
    }

    if (request.method === "GET" && path.startsWith("/workcells/") && !path.endsWith("/terminal_attachment")) {
      const key = decodeURIComponent(path.split("/")[2] || "");
      const workcell = workcells.get(key);
      record({ method: request.method, path, found: Boolean(workcell), authorized: true });
      if (!workcell) return json({ error: "not found" }, 404);
      return json({ workcell: workcellPayload(workcell) });
    }

    if (request.method === "POST" && path === "/workcells") {
      const bodyText = await request.text();
      redactedRecord(request, path, bodyText);
      const parsed = JSON.parse(bodyText);
      const attrs = parsed.workcell;
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

    if (request.method === "PATCH" && path.startsWith("/workcells/")) {
      const bodyText = await request.text();
      redactedRecord(request, path, bodyText);
      const key = decodeURIComponent(path.split("/")[2] || "");
      const parsed = JSON.parse(bodyText);
      const existing = workcells.get(key);
      if (!existing) return json({ error: "not found" }, 404);
      Object.assign(existing, parsed.workcell || {});
      existing.status = "ready";
      workcells.set(existing.key, existing);
      workcells.set(existing.id, existing);
      return json({ workcell: workcellPayload(existing) });
    }

    if (request.method === "POST" && path.endsWith("/ensure")) {
      const id = decodeURIComponent(path.split("/")[2] || "");
      const workcell = workcells.get(id);
      record({ method: request.method, path, authorized: true, workcell_found: Boolean(workcell) });
      if (!workcell) return json({ error: "not found" }, 404);
      workcell.status = "ready";
      return json({ workcell: workcellPayload(workcell) });
    }

    if (request.method === "POST" && path.endsWith("/execution_sessions")) {
      const id = decodeURIComponent(path.split("/")[2] || "");
      const workcell = workcells.get(id);
      record({ method: request.method, path, authorized: true, workcell_found: Boolean(workcell) });
      if (!workcell) return json({ error: "not found" }, 404);
      const sessionId = `grid-session-${++sessionCounter}`;
      const session = {
        id: sessionId,
        state: "attached",
        actor_kind: "agent",
        actor_ref: "bittergit"
      };
      workcell.sessions = [session, ...(workcell.sessions || [])];
      workcell.attachOperation = {
        id: "grid-op-attach-1",
        kind: "workcell.session.attach.execute",
        state: "succeeded",
        metadata: { session_id: sessionId }
      };
      return json({
        execution_session: session,
        workcell: workcellPayload(workcell)
      }, 201);
    }

    if (request.method === "POST" && path.endsWith("/exec")) {
      const id = decodeURIComponent(path.split("/")[2] || "");
      const workcell = workcells.get(id);
      const bodyText = await request.text();
      let parsed = {};
      try { parsed = JSON.parse(bodyText); } catch {}
      record({
        method: request.method,
        path,
        authorized: true,
        workcell_found: Boolean(workcell),
        actor_ref: parsed?.actor_ref ?? null,
        cwd: parsed?.cwd ?? null,
        command_writes_parent_context: bodyText.includes("BITTERGIT_PARENT_CONTEXT"),
        command_mentions_agents: bodyText.includes("AGENTS.md"),
        command_mentions_claude: bodyText.includes("CLAUDE.md"),
        command_mentions_gemini: bodyText.includes("GEMINI.md")
      });
      if (!workcell) return json({ error: "not found" }, 404);
      return json({
        exit_code: 0,
        stdout: "BITTERGIT_PARENT_AGENTS_PRESENT=1\nBITTERGIT_PARENT_CLAUDE_PRESENT=1\nBITTERGIT_PARENT_GEMINI_PRESENT=1\n",
        stderr: "",
        status: "succeeded"
      });
    }

    if (request.method === "GET" && path.endsWith("/terminal_attachment")) {
      const id = decodeURIComponent(path.split("/")[2] || "");
      const workcell = workcells.get(id);
      record({ method: request.method, path, authorized: true, workcell_found: Boolean(workcell) });
      if (!workcell) return json({ error: "not found" }, 404);
      const appSlug = workcell.metadata.app_slug;
      const routePath = `/app/apps/${encodeURIComponent(appSlug)}/backstage/terminal`;
      return json({
        terminal_attachment: {
          status: "ready_for_grid_owned_ensure",
          terminal: {
            url: `https://terminal.example.test${routePath}/`,
            transport: "ttyd-websocket-v1"
          },
          runtime: {
            workspace_root: `/var/lib/bittergrid/workcells/${workcell.key}/workspace`
          },
          blockers: [],
          secret_material_returned: false
        }
      });
    }

    if (request.method === "DELETE" && path.startsWith("/workcells/")) {
      const id = decodeURIComponent(path.split("/")[2] || "");
      const workcell = workcells.get(id);
      record({ method: request.method, path, authorized: true, deleted: Boolean(workcell) });
      if (workcell) {
        workcell.status = "destroyed";
      }
      return json({ workcell: workcell ? workcellPayload(workcell) : null });
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

mkdir -p "$SOURCE_WORK"
git -C "$SOURCE_WORK" init -q
git -C "$SOURCE_WORK" config user.email "source@example.test"
git -C "$SOURCE_WORK" config user.name "Source Builder"
printf '<!doctype html><html><body><h1>Example Static App</h1></body></html>\n' >"$SOURCE_WORK/index.html"
git -C "$SOURCE_WORK" add -A
git -C "$SOURCE_WORK" commit -q -m "Initial example app"
git -C "$SOURCE_WORK" branch -M main
git init --bare -q "$SOURCE_REMOTE"
git -C "$SOURCE_WORK" remote add origin "$SOURCE_REMOTE"
git -C "$SOURCE_WORK" push -q origin main

ASSERTION="$(bun -e '
import { createHmac } from "node:crypto";
const payload = {
  iss: "factory.local",
  aud: "bittergit",
  sub: `factory:${process.argv[1]}:user:gate51`,
  jti: `factory-grid-terminal-${Date.now()}-${Math.random()}`,
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

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/git-import-app-bundles" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$APP_NAME\",\"display_name\":\"Gate 51 Example App\",\"source_url\":\"$SOURCE_REMOTE\"}" >"$IMPORT_JSON"

APP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.id);' "$IMPORT_JSON")"
OWNER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.owner);' "$IMPORT_JSON")"
REPO="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.app.repo.name);' "$IMPORT_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" \
  -H "Content-Type: application/json" \
  -d '{"terminal_fulfillment":{"mode":"grid_api","box_ref":"grid-host-01"}}' >"$SESSION_JSON"

SESSION_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.id);' "$SESSION_JSON")"
SOURCE_ROOT="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.session.source_root);' "$SESSION_JSON")"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["grid-test-token", "BEGIN OPENSSH", "PRIVATE KEY", "sk_live_"]) {
  if (text.includes(forbidden)) throw new Error(`session leaked ${forbidden}`);
}
if (text.includes("bgt_")) throw new Error("session leaked BitterGit token");
const session = JSON.parse(text).session;
const fulfillment = session.terminal_fulfillment;
if (fulfillment.provider !== "bittergrid_api") throw new Error("session did not use Grid API provider");
if (fulfillment.mode !== "docker_local") throw new Error("wrong Grid mode");
if (fulfillment.owner_plane !== "BitterGrid") throw new Error("wrong owner plane");
if (fulfillment.box_ref !== "grid-host-01") throw new Error("wrong Grid host");
if (fulfillment.status !== "ready") throw new Error("Grid fulfillment not ready");
if (fulfillment.lifecycle !== "grid_workcell_ready") throw new Error("wrong Grid lifecycle");
if (!fulfillment.grid_workcell_id || !fulfillment.grid_workcell_key) throw new Error("missing Grid workcell refs");
if (!fulfillment.grid_execution_session_id) throw new Error("missing Grid execution session");
if (!fulfillment.source_root.includes("/var/lib/bittergrid/workcells/")) throw new Error("missing Grid source root");
if (!String(fulfillment.url).startsWith("https://terminal.example.test/app/apps/")) throw new Error("terminal URL was not Grid route");
if (fulfillment.origin_remote !== `${process.argv[2]}/${process.argv[3]}/${process.argv[4]}.git`) throw new Error("wrong BitterGit origin");
if (fulfillment.credential_delivery !== "run_scoped_git_credential_helper") throw new Error("wrong credential delivery");
if (fulfillment.token_in_url !== false || fulfillment.clone_url_has_token !== false) throw new Error("token URL posture failed");
if (fulfillment.parent_context?.status !== "installed") throw new Error("parent agent context was not installed");
if (fulfillment.parent_context?.canonical_instructions !== "AGENTS.md") throw new Error("wrong parent canonical instructions");
for (const file of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
  if (!fulfillment.parent_context.files.includes(file)) throw new Error(`missing parent context file ${file}`);
}
' "$SESSION_JSON" "$BASE_URL" "$OWNER" "$REPO"

test -d "$SOURCE_ROOT/.git"
REMOTE_URL="$(git -C "$SOURCE_ROOT" remote get-url origin)"
test "$REMOTE_URL" = "$BASE_URL/$OWNER/$REPO.git"
if [[ "$REMOTE_URL" == *"bgt_"* || "$REMOTE_URL" == *"github.com"* || "$REMOTE_URL" == *"@"* ]]; then
  echo "origin remote leaked token material or pointed at GitHub" >&2
  exit 1
fi

bun -e '
const records = (await Bun.file(process.argv[1]).text()).trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
const create = records.find((record) => record.method === "POST" && record.path === "/workcells");
if (!create) throw new Error("fake Grid did not receive workcell create");
if (create.repo_url !== process.argv[2]) throw new Error("Grid repo_url was not BitterGit origin");
if (create.repo_url.includes("bgt_") || create.repo_url.includes("github.com") || create.repo_url.includes("@")) throw new Error("Grid repo_url leaked token or GitHub");
if (create.has_credential_helper_password !== true) throw new Error("Grid did not receive credential helper password");
if (create.has_credential_helper_username !== true) throw new Error("Grid did not receive credential helper username");
if (create.body_had_grid_token === true) throw new Error("Grid service token was copied into body");
if (!records.some((record) => record.path.endsWith("/ensure"))) throw new Error("Grid ensure was not requested");
if (!records.some((record) => record.path.endsWith("/execution_sessions"))) throw new Error("Grid execution session was not requested");
const parentContext = records.find((record) => record.path.endsWith("/exec") && record.actor_ref === "bittergit:parent-context");
if (!parentContext) throw new Error("Grid parent-context exec was not requested");
if (parentContext.cwd !== ".") throw new Error("Grid parent-context exec used wrong cwd");
if (parentContext.command_writes_parent_context !== true) throw new Error("Grid parent-context exec did not write parent context");
if (parentContext.command_mentions_agents !== true || parentContext.command_mentions_claude !== true || parentContext.command_mentions_gemini !== true) {
  throw new Error("Grid parent-context exec missed provider context files");
}
if (!records.some((record) => record.path.endsWith("/terminal_attachment"))) throw new Error("Grid terminal plan was not requested");
' "$GRID_RECORDS" "$BASE_URL/$OWNER/$REPO.git"

curl -fsS "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/support-debug" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$SUPPORT_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
for (const forbidden of ["bgt_", "grid-test-token", "BEGIN OPENSSH", "PRIVATE KEY", "sk_live_"]) {
  if (text.includes(forbidden)) throw new Error(`support leaked ${forbidden}`);
}
const support = JSON.parse(text).support;
if (support.terminal.latest_status !== "ready") throw new Error("support terminal status was not ready");
if (support.terminal.token_in_url !== false) throw new Error("support terminal token posture failed");
if (support.workcell.ready_count !== 1) throw new Error("support did not record ready workcell session");
' "$SUPPORT_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/customer/apps/$APP_ID/workcell-sessions/$SESSION_ID/revoke" \
  -H "X-Bitter-Account-Assertion: $ASSERTION" >"$REVOKE_JSON"

bun -e '
const text = await Bun.file(process.argv[1]).text();
if (text.includes("bgt_") || text.includes("grid-test-token")) throw new Error("revoke leaked credential material");
const session = JSON.parse(text).session;
if (session.status !== "revoked") throw new Error("session was not revoked");
if (session.terminal_fulfillment.cleanup_status !== "grid_destroy_requested") throw new Error("Grid cleanup was not requested");
' "$REVOKE_JSON"

bun -e '
const records = (await Bun.file(process.argv[1]).text()).trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
if (!records.some((record) => record.method === "DELETE" && record.path.startsWith("/workcells/") && record.deleted === true)) {
  throw new Error("Grid destroy was not requested");
}
' "$GRID_RECORDS"

echo "Gate 51 smoke passed for real Grid terminal fulfillment adapter on $APP_ID"
