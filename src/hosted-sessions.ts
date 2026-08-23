import { randomUUID } from "node:crypto";
import { ensureStorage } from "./storage";
import { cloneUrl } from "./config";
import type { AccountAssertion } from "./assertions";
import { findAccountAppById, type AccountApp } from "./apps";
import { findRepositoryById, type Repository } from "./repos";
import { createWorkcellWithToken, revokeWorkcell } from "./workcells";
import {
  listAgentReadinessChecks,
  readinessCheckToJson,
  readinessSummary,
  recordAgentReadinessChecks
} from "./agent-readiness";
import {
  gridTerminalFulfillmentFromJson,
  gridTerminalFulfillmentSupportJson,
  requestGridTerminalFulfillment,
  revokeGridTerminalFulfillmentRemote,
  serializeGridTerminalFulfillment
} from "./grid-terminal";
import {
  normalizeProductionSsh,
  productionSshFromJson,
  productionSshSessionJson,
  productionSshSupportJson,
  serializeProductionSsh,
  type ProductionSshPolicy
} from "./production-ssh";

export type HostedWorkcellSession = {
  id: string;
  app_id: string;
  repo_id: string;
  account_ref: string;
  workspace_ref: string;
  workcell_id: string;
  token_id: string;
  source_root: string;
  terminal_url: string;
  terminal_provider: string;
  terminal_status: string;
  terminal_message: string | null;
  terminal_fulfillment_id: string | null;
  terminal_route: string | null;
  terminal_lifecycle: string | null;
  terminal_fulfillment_json: string | null;
  production_ssh_json: string | null;
  status: string;
  agent_readiness_json: string;
  readiness_message: string;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export async function createHostedWorkcellSession(
  assertion: AccountAssertion,
  appId: string,
  options: { production_ssh?: unknown; terminal_fulfillment?: unknown } = {}
): Promise<{ app: AccountApp; repo: Repository; session: HostedWorkcellSession }> {
  const { app, repo } = requireAssertedApp(assertion, appId);
  const productionSsh = normalizeProductionSsh(options.production_ssh);
  const sessionId = `hws_${randomUUID()}`;
  const workcellId = `wc_${randomUUID()}`;
  const workcellCreation = createWorkcellWithToken(repo, `hosted-session:${sessionId}`, {
    id: workcellId,
    allowMainPush: true
  });
  const workcell = workcellCreation.workcell;
  const now = new Date().toISOString();
  const readiness = {
    terminal_ready: true,
    source_saved: true,
    github_optional: true,
    origin_remote: cloneUrl(repo.owner, repo.name),
    first_task: "Establish the app charter with the user in APP.md, including axes of excellence and verification gates.",
    agents: ["claude", "codex"],
    token_posture: "run_scoped_credential_helper",
    production_ssh: productionSshSessionJson(productionSsh, "ready")
  };
  const fulfillment = await requestGridTerminalFulfillment({
    session_id: sessionId,
    app,
    repo,
    source_root: workcell.checkout_path,
    git_token: workcellCreation.token,
    terminal_fulfillment: options.terminal_fulfillment
  });
  const session: HostedWorkcellSession = {
    id: sessionId,
    app_id: app.id,
    repo_id: repo.id,
    account_ref: app.account_ref,
    workspace_ref: app.workspace_ref,
    workcell_id: workcell.id,
    token_id: workcell.token_id,
    source_root: workcell.checkout_path,
    terminal_url: fulfillment.url,
    terminal_provider: hostedSessionTerminalProvider(fulfillment.provider),
    terminal_status: fulfillment.status,
    terminal_message: fulfillment.message,
    terminal_fulfillment_id: fulfillment.id,
    terminal_route: fulfillment.route,
    terminal_lifecycle: fulfillment.lifecycle,
    terminal_fulfillment_json: serializeGridTerminalFulfillment(fulfillment),
    production_ssh_json: serializeProductionSsh(productionSsh),
    status: "ready",
    agent_readiness_json: JSON.stringify(readiness),
    readiness_message: readinessMessage(productionSsh),
    created_at: now,
    updated_at: now,
    revoked_at: null
  };

  ensureStorage().query(`
    INSERT INTO hosted_workcell_sessions
      (id, app_id, repo_id, account_ref, workspace_ref, workcell_id, token_id,
       source_root, terminal_url, terminal_provider, terminal_status,
       terminal_message, terminal_fulfillment_id, terminal_route,
       terminal_lifecycle, terminal_fulfillment_json, production_ssh_json, status, agent_readiness_json,
       readiness_message, created_at, updated_at, revoked_at)
    VALUES
      ($id, $app_id, $repo_id, $account_ref, $workspace_ref, $workcell_id,
       $token_id, $source_root, $terminal_url, $terminal_provider,
       $terminal_status, $terminal_message, $terminal_fulfillment_id,
       $terminal_route, $terminal_lifecycle, $terminal_fulfillment_json, $production_ssh_json, $status, $agent_readiness_json,
       $readiness_message, $created_at, $updated_at, NULL)
  `).run({
    $id: session.id,
    $app_id: session.app_id,
    $repo_id: session.repo_id,
    $account_ref: session.account_ref,
    $workspace_ref: session.workspace_ref,
    $workcell_id: session.workcell_id,
    $token_id: session.token_id,
    $source_root: session.source_root,
    $terminal_url: session.terminal_url,
    $terminal_provider: session.terminal_provider,
    $terminal_status: session.terminal_status,
    $terminal_message: session.terminal_message,
    $terminal_fulfillment_id: session.terminal_fulfillment_id,
    $terminal_route: session.terminal_route,
    $terminal_lifecycle: session.terminal_lifecycle,
    $terminal_fulfillment_json: session.terminal_fulfillment_json,
    $production_ssh_json: session.production_ssh_json,
    $status: session.status,
    $agent_readiness_json: session.agent_readiness_json,
    $readiness_message: session.readiness_message,
    $created_at: session.created_at,
    $updated_at: session.updated_at
  });

  const inserted = findHostedWorkcellSession(session.id) as HostedWorkcellSession;
  recordAgentReadinessChecks(inserted, repo);
  const agentReadiness = {
    ...readiness,
    evidence: readinessSummary(inserted.id)
  };
  ensureStorage().query(`
    UPDATE hosted_workcell_sessions
    SET agent_readiness_json = $agent_readiness_json, updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: inserted.id,
    $agent_readiness_json: JSON.stringify(agentReadiness),
    $updated_at: new Date().toISOString()
  });

  return { app, repo, session: findHostedWorkcellSession(session.id) as HostedWorkcellSession };
}

export async function fulfillHostedWorkcellTerminal(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string
): Promise<HostedWorkcellSession> {
  const { app, repo } = requireAssertedApp(assertion, appId);
  const session = findHostedWorkcellSession(sessionId);
  if (!session || session.app_id !== appId) throw new Error("hosted workcell session not found");
  if (session.status === "revoked") throw new Error("hosted workcell session revoked");
  const existingFulfillment = terminalFulfillmentForSession(session);
  if (existingFulfillment.provider === "bittergrid_api") return session;

  const fulfillment = await requestGridTerminalFulfillment({
    session_id: session.id,
    app,
    repo,
    source_root: session.source_root,
    terminal_fulfillment: terminalFulfillmentRequestForRefresh(session)
  });
  const now = new Date().toISOString();
  ensureStorage().query(`
    UPDATE hosted_workcell_sessions
    SET terminal_url = $terminal_url,
        terminal_provider = $terminal_provider,
        terminal_status = $terminal_status,
        terminal_message = $terminal_message,
        terminal_fulfillment_id = $terminal_fulfillment_id,
        terminal_route = $terminal_route,
        terminal_lifecycle = $terminal_lifecycle,
        terminal_fulfillment_json = $terminal_fulfillment_json,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: session.id,
    $terminal_url: fulfillment.url,
    $terminal_provider: hostedSessionTerminalProvider(fulfillment.provider),
    $terminal_status: fulfillment.status,
    $terminal_message: fulfillment.message,
    $terminal_fulfillment_id: fulfillment.id,
    $terminal_route: fulfillment.route,
    $terminal_lifecycle: fulfillment.lifecycle,
    $terminal_fulfillment_json: serializeGridTerminalFulfillment(fulfillment),
    $updated_at: now
  });

  return findHostedWorkcellSession(session.id) as HostedWorkcellSession;
}

export function listHostedWorkcellSessionsForApp(assertion: AccountAssertion, appId: string): HostedWorkcellSession[] {
  const { app } = requireAssertedApp(assertion, appId);
  return ensureStorage().query<HostedWorkcellSession, [string]>(`
    SELECT id, app_id, repo_id, account_ref, workspace_ref, workcell_id, token_id,
           source_root, terminal_url, terminal_provider, terminal_status,
           terminal_message, terminal_fulfillment_id, terminal_route,
           terminal_lifecycle, terminal_fulfillment_json, production_ssh_json, status, agent_readiness_json,
           readiness_message, created_at, updated_at, revoked_at
    FROM hosted_workcell_sessions
    WHERE app_id = ?
    ORDER BY created_at ASC
  `).all(app.id);
}

export function listHostedWorkcellSessionsForRepo(repo: Repository): HostedWorkcellSession[] {
  return ensureStorage().query<HostedWorkcellSession, [string]>(`
    SELECT id, app_id, repo_id, account_ref, workspace_ref, workcell_id, token_id,
           source_root, terminal_url, terminal_provider, terminal_status,
           terminal_message, terminal_fulfillment_id, terminal_route,
           terminal_lifecycle, terminal_fulfillment_json, production_ssh_json, status, agent_readiness_json,
           readiness_message, created_at, updated_at, revoked_at
    FROM hosted_workcell_sessions
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id);
}

export function findHostedWorkcellSession(id: string): HostedWorkcellSession | undefined {
  return ensureStorage().query<HostedWorkcellSession, [string]>(`
    SELECT id, app_id, repo_id, account_ref, workspace_ref, workcell_id, token_id,
           source_root, terminal_url, terminal_provider, terminal_status,
           terminal_message, terminal_fulfillment_id, terminal_route,
           terminal_lifecycle, terminal_fulfillment_json, production_ssh_json, status, agent_readiness_json,
           readiness_message, created_at, updated_at, revoked_at
    FROM hosted_workcell_sessions
    WHERE id = ?
  `).get(id) ?? undefined;
}

export async function revokeHostedWorkcellSession(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string
): Promise<HostedWorkcellSession> {
  requireAssertedApp(assertion, appId);
  const session = findHostedWorkcellSession(sessionId);
  if (!session || session.app_id !== appId) throw new Error("hosted workcell session not found");

  revokeWorkcell(session.workcell_id);
  const now = new Date().toISOString();
  const revokedFulfillment = await revokeGridTerminalFulfillmentRemote(terminalFulfillmentForSession(session), now);
  ensureStorage().query(`
    UPDATE hosted_workcell_sessions
    SET status = 'revoked',
        terminal_status = 'revoked',
        terminal_lifecycle = 'revoked',
        terminal_message = 'Hosted workcell session revoked; Grid terminal fulfillment is no longer active.',
        terminal_fulfillment_json = $terminal_fulfillment_json,
        revoked_at = $revoked_at,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: session.id,
    $terminal_fulfillment_json: serializeGridTerminalFulfillment(revokedFulfillment),
    $revoked_at: now,
    $updated_at: now
  });

  return findHostedWorkcellSession(session.id) as HostedWorkcellSession;
}

export function hostedWorkcellSessionToJson(session: HostedWorkcellSession): Record<string, unknown> {
  const productionSsh = productionSshFromJson(session.production_ssh_json);
  const terminalFulfillment = terminalFulfillmentForSession(session);
  return {
    id: session.id,
    app_id: session.app_id,
    repo_id: session.repo_id,
    account_ref: session.account_ref,
    workspace_ref: session.workspace_ref,
    workcell_id: session.workcell_id,
    git_token_ref: session.token_id,
    source_root: session.source_root,
    terminal_url: session.terminal_url,
    terminal_provider: session.terminal_provider,
    terminal_status: session.terminal_status,
    terminal_message: session.terminal_message,
    terminal_route: session.terminal_route,
    terminal_lifecycle: session.terminal_lifecycle,
    terminal_fulfillment: terminalFulfillment,
    production_ssh: productionSshSessionJson(productionSsh, session.status),
    status: session.status,
    agent_readiness: JSON.parse(session.agent_readiness_json),
    agent_readiness_checks: listAgentReadinessChecks(session.id).map(readinessCheckToJson),
    readiness_message: session.readiness_message,
    created_at: session.created_at,
    updated_at: session.updated_at,
    revoked_at: session.revoked_at
  };
}

export function hostedWorkcellSessionSupportJson(session: HostedWorkcellSession): Record<string, unknown> {
  const productionSsh = productionSshFromJson(session.production_ssh_json);
  const terminalFulfillment = terminalFulfillmentForSession(session);
  const repo = findRepositoryById(session.repo_id);
  return {
    id: session.id,
    app_id: session.app_id,
    repo_id: session.repo_id,
    account_ref: session.account_ref,
    workspace_ref: session.workspace_ref,
    workcell_id: session.workcell_id,
    git_token_ref: null,
    git_token_ref_returned: false,
    source_root: null,
    source_root_returned: false,
    terminal_url: null,
    terminal_url_configured: Boolean(session.terminal_url),
    terminal_url_returned: false,
    terminal_provider: session.terminal_provider,
    terminal_status: session.terminal_status,
    terminal_message: supportTerminalMessage(session.terminal_status),
    terminal_route: null,
    terminal_route_configured: Boolean(session.terminal_route),
    terminal_route_returned: false,
    terminal_lifecycle: session.terminal_lifecycle,
    terminal_fulfillment: gridTerminalFulfillmentSupportJson(terminalFulfillment),
    production_ssh: productionSshSupportJson(productionSsh, session.status),
    status: session.status,
    agent_readiness: {
      terminal_ready: session.terminal_status === "ready",
      source_saved: true,
      github_optional: true,
      origin_remote: repo ? cloneUrl(repo.owner, repo.name) : "",
      first_task: "Establish the app charter with the user in APP.md, including axes of excellence and verification gates.",
      agents: ["claude", "codex"],
      token_posture: "run_scoped_credential_helper",
      production_ssh: productionSshSupportJson(productionSsh, session.status),
      evidence: readinessSummary(session.id)
    },
    agent_readiness_checks: listAgentReadinessChecks(session.id).map(readinessCheckToJson),
    readiness_message: session.readiness_message,
    created_at: session.created_at,
    updated_at: session.updated_at,
    revoked_at: session.revoked_at,
    projection: "support_safe_v1"
  };
}

function supportTerminalMessage(status: string): string {
  if (status === "revoked") return "Hosted workcell session revoked; terminal fulfillment is no longer active.";
  if (status === "blocked") return "Terminal fulfillment needs repair before the hosted terminal is ready.";
  if (status === "ready") return "Terminal fulfillment is ready for this app-scoped workcell.";
  return "Terminal fulfillment is in progress for this app-scoped workcell.";
}

function readinessMessage(productionSsh: ProductionSshPolicy): string {
  const ssh = productionSsh.write_enabled
    ? "Production SSH write/operate is explicitly enabled for this session."
    : productionSsh.enabled
      ? "Production SSH read-only diagnostics are available; write/operate is off by default."
      : "Production SSH is disabled for this session.";
  return `Terminal ready. Source is saved in BitterGit. GitHub is optional. ${ssh} First task: establish the app charter in APP.md with axes of excellence and verification gates.`;
}

function terminalFulfillmentForSession(session: HostedWorkcellSession) {
  return gridTerminalFulfillmentFromJson(session.terminal_fulfillment_json, {
    id: session.terminal_fulfillment_id ?? `grid_terminal_${session.id}`,
    provider: session.terminal_provider,
    route: session.terminal_route ?? `/terminals/${encodeURIComponent(session.id)}`,
    url: session.terminal_url,
    status: session.terminal_status,
    lifecycle: session.terminal_lifecycle ?? (session.status === "revoked" ? "revoked" : "fulfilled_local_contract"),
    readiness_state: session.status === "ready" ? "ready" : session.status,
    source_root: session.source_root,
    app_id: session.app_id,
    repo_id: session.repo_id,
    account_ref: session.account_ref,
    cleanup_status: session.status === "revoked" ? "revoked" : "active"
  });
}

function hostedSessionTerminalProvider(fulfillmentProvider: string): string {
  return fulfillmentProvider === "bittergrid_api" ? "bittergrid_api" : "bittergrid_contract_local";
}

function terminalFulfillmentRequestForRefresh(session: HostedWorkcellSession): Record<string, unknown> {
  const fulfillment = terminalFulfillmentForSession(session);
  return {
    mode: fulfillment.dedicated_box_requested ? "dedicated_box" : "local_adapter",
    box_ref: fulfillment.box_ref
  };
}

function requireAssertedApp(assertion: AccountAssertion, appId: string): { app: AccountApp; repo: Repository } {
  const app = findAccountAppById(appId);
  if (!app || app.account_ref !== assertion.account_ref) throw new Error("app not found");
  const repo = findRepositoryById(app.repo_id);
  if (!repo) throw new Error("app repository missing");
  return { app, repo };
}
