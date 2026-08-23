import { config } from "./config";
import type { AccountApp } from "./apps";
import type { Repository } from "./repos";
import { cloneUrl } from "./config";
import { claudePointerMd, geminiPointerMd, workcellParentAgentsMd } from "./agent-context";

export type GridTerminalFulfillment = {
  id: string;
  provider: string;
  mode: string;
  owner_plane: string;
  box_ref: string;
  dedicated_box_requested: boolean;
  dedicated_box_available: boolean;
  fallback_reason: string | null;
  repair_action?: string | null;
  route: string;
  url: string;
  status: string;
  lifecycle: string;
  message: string;
  readiness_state: string;
  source_root: string;
  app_id: string;
  repo_id: string;
  account_ref: string;
  origin_remote: string;
  credential_delivery: string;
  token_in_url: false;
  clone_url_has_token: false;
  cleanup_status: string;
  grid_api_url?: string | null;
  grid_workcell_id?: string | null;
  grid_workcell_key?: string | null;
  grid_execution_session_id?: string | null;
  grid_operation_ref?: string | null;
  parent_context?: {
    status: string;
    files: string[];
    canonical_instructions: string;
  } | null;
  created_at: string;
  updated_at: string;
};

export type GridProviderReadiness = {
  cli: {
    provider: string;
    command: string;
    available: boolean;
    status: string;
    source: string;
    version: string | null;
    path_returned: false;
    repair_action: string | null;
    checked_by: string;
    exit_code: number | null;
  };
  auth: {
    provider: string;
    source: string;
    status: string;
    mount_status: string;
    reference_present: boolean;
    reference_returned: false;
    credential_material_returned: false;
    auth_files_returned: false;
    includes_secret_value: false;
    repair_action: string | null;
    checked_by: string;
    bundle_present: boolean;
    bootstrap_status: string;
    secret_material_returned: false;
  };
  source: {
    evidence_source: string;
    source_root: string;
    source_root_exists: boolean;
    instructions_present: boolean;
    charter_present: boolean;
    origin_remote: string;
    origin_remote_has_token: boolean;
    source_files_visible: string[];
    parent_context_files_visible: string[];
    grid_workcell_id: string | null;
    grid_execution_session_id: string | null;
  };
};

export async function requestGridTerminalFulfillment(input: {
  session_id: string;
  app: AccountApp;
  repo: Repository;
  source_root: string;
  git_token?: string;
  terminal_fulfillment?: unknown;
}): Promise<GridTerminalFulfillment> {
  const request = normalizeTerminalFulfillmentRequest(input.terminal_fulfillment);
  if (request.mode === "grid_api") {
    return requestBitterGridApiFulfillment(input, request);
  }

  const route = `/terminals/${encodeURIComponent(input.session_id)}`;
  const now = new Date().toISOString();
  const dedicated = request.mode === "dedicated_box";
  return {
    id: `grid_terminal_${input.session_id}`,
    provider: dedicated ? "bittergrid_dedicated_box_contract" : "bittergrid_adapter_local",
    mode: dedicated ? "dedicated_box_local_adapter" : "local_adapter",
    owner_plane: "BitterGrid",
    box_ref: request.box_ref,
    dedicated_box_requested: dedicated,
    dedicated_box_available: false,
    fallback_reason: dedicated ? "dedicated box execution unavailable in local proof; using faithful local adapter" : null,
    route,
    url: `http://${config.host}:${config.port}${route}`,
    status: "ready",
    lifecycle: dedicated ? "dedicated_box_local_adapter_ready" : "fulfilled_local_contract",
    message: dedicated
      ? "BitterGrid dedicated-box terminal contract is ready through the local adapter for this app-scoped workcell."
      : "BitterGrid terminal fulfillment contract is ready for this app-scoped workcell.",
    readiness_state: "ready",
    source_root: input.source_root,
    app_id: input.app.id,
    repo_id: input.repo.id,
    account_ref: input.app.account_ref,
    origin_remote: cloneUrl(input.repo.owner, input.repo.name),
    credential_delivery: "run_scoped_git_credential_helper",
    token_in_url: false,
    clone_url_has_token: false,
    cleanup_status: "active",
    parent_context: {
      status: "installed",
      files: ["AGENTS.md", "CLAUDE.md", "GEMINI.md"],
      canonical_instructions: "AGENTS.md"
    },
    created_at: now,
    updated_at: now
  };
}

export async function requestGridProviderReadiness(input: {
  provider: string;
  workcell_id: string | null | undefined;
  execution_session_id?: string | null;
  source_root: string;
  origin_remote: string;
  provider_auth?: {
    bundle_id?: unknown;
    service_url?: unknown;
    repair_action?: unknown;
  };
}): Promise<GridProviderReadiness> {
  const provider = normalizeProviderCommand(input.provider);
  const bundleId = stringValue(input.provider_auth?.bundle_id, "");
  const serviceUrl = stringValue(input.provider_auth?.service_url, "");
  const blocked = blockedGridProviderReadiness(input, "Grid provider readiness check is not configured.");

  if (!gridApiConfigured()) {
    return {
      ...blocked,
      auth: {
        ...blocked.auth,
        repair_action: "Configure BITTERGRID_API_URL and BITTERGRID_SERVICE_TOKEN before checking provider readiness."
      }
    };
  }
  if (!input.workcell_id) {
    return {
      ...blocked,
      auth: {
        ...blocked.auth,
        repair_action: "Create a Grid workcell before checking provider readiness."
      }
    };
  }

  const source = await gridSourceAndCliEvidence({
    provider,
    workcell_id: input.workcell_id,
    execution_session_id: input.execution_session_id,
    source_root: input.source_root,
    origin_remote: input.origin_remote
  }).catch(() => ({
    cli: {
      provider,
      command: provider,
      available: false,
      status: "missing",
      source: "bittergrid_exec",
      version: null,
      path_returned: false as const,
      repair_action: `Retry Grid readiness, then install or mount the ${provider} CLI if it remains unavailable.`,
      checked_by: "bittergrid_exec",
      exit_code: null
    },
    source: {
      evidence_source: "bittergrid_exec",
      source_root: input.source_root,
      source_root_exists: false,
      instructions_present: false,
      charter_present: false,
      origin_remote: safeOriginRemote(input.origin_remote),
      origin_remote_has_token: hasTokenMaterial(input.origin_remote),
      source_files_visible: [],
      parent_context_files_visible: [],
      grid_workcell_id: input.workcell_id ?? null,
      grid_execution_session_id: input.execution_session_id ?? null
    }
  }));

  const auth = await gridProviderAuthEvidence({
    provider,
    workcell_id: input.workcell_id,
    bundle_id: bundleId,
    service_url: serviceUrl,
    repair_action: input.provider_auth?.repair_action
  });

  return {
    cli: source.cli,
    auth,
    source: source.source
  };
}

export function serializeGridTerminalFulfillment(fulfillment: GridTerminalFulfillment): string {
  return JSON.stringify(fulfillment);
}

export function gridTerminalFulfillmentFromJson(
  value: string | null | undefined,
  fallback: Partial<GridTerminalFulfillment>
): GridTerminalFulfillment {
  if (value) {
    try {
      const parsed = JSON.parse(value) as Partial<GridTerminalFulfillment>;
      return normalizeStoredFulfillment({ ...fallback, ...parsed });
    } catch {
      // Fall through to fallback normalization.
    }
  }
  return normalizeStoredFulfillment(fallback);
}

export function gridTerminalFulfillmentSupportJson(
  fulfillment: GridTerminalFulfillment
): Record<string, unknown> {
  const needsRepair = fulfillment.status === "blocked" || Boolean(fulfillment.repair_action);
  return {
    id: fulfillment.id,
    provider: fulfillment.provider,
    mode: fulfillment.mode,
    owner_plane: fulfillment.owner_plane,
    box_ref: null,
    box_ref_configured: Boolean(fulfillment.box_ref),
    box_ref_returned: false,
    dedicated_box_requested: fulfillment.dedicated_box_requested,
    dedicated_box_available: fulfillment.dedicated_box_available,
    fallback_reason: fulfillment.fallback_reason
      ? "The requested Grid capacity is unavailable; a compatible fallback may be active."
      : null,
    repair_action: needsRepair
      ? "Retry terminal fulfillment or use the owner-plane support workflow."
      : null,
    route: null,
    route_configured: Boolean(fulfillment.route),
    route_returned: false,
    url: null,
    url_configured: Boolean(fulfillment.url),
    url_returned: false,
    status: fulfillment.status,
    lifecycle: fulfillment.lifecycle,
    message: supportFulfillmentMessage(fulfillment),
    readiness_state: fulfillment.readiness_state,
    source_root: null,
    source_root_returned: false,
    app_id: fulfillment.app_id,
    repo_id: fulfillment.repo_id,
    account_ref: fulfillment.account_ref,
    origin_remote: null,
    origin_remote_configured: Boolean(fulfillment.origin_remote),
    origin_remote_returned: false,
    credential_delivery: fulfillment.credential_delivery === "run_scoped_git_credential_helper"
      ? "run_scoped_git_credential_helper"
      : "configured",
    token_in_url: false,
    clone_url_has_token: false,
    cleanup_status: fulfillment.cleanup_status,
    grid_api_url: null,
    grid_api_url_returned: false,
    grid_workcell_id: null,
    grid_workcell_key: null,
    grid_execution_session_id: null,
    grid_operation_ref: null,
    grid_workcell_linked: Boolean(fulfillment.grid_workcell_id || fulfillment.grid_workcell_key),
    grid_execution_session_linked: Boolean(fulfillment.grid_execution_session_id),
    grid_operation_linked: Boolean(fulfillment.grid_operation_ref),
    grid_refs_returned: false,
    parent_context: supportParentContext(fulfillment.parent_context),
    created_at: fulfillment.created_at,
    updated_at: fulfillment.updated_at,
    projection: "support_safe_v1"
  };
}

export function revokeGridTerminalFulfillment(
  fulfillment: GridTerminalFulfillment,
  revokedAt: string
): GridTerminalFulfillment {
  return {
    ...fulfillment,
    status: "revoked",
    lifecycle: "revoked",
    readiness_state: "revoked",
    cleanup_status: "revoked",
    message: "Hosted workcell session revoked; Grid terminal fulfillment is no longer active.",
    updated_at: revokedAt
  };
}

export async function revokeGridTerminalFulfillmentRemote(
  fulfillment: GridTerminalFulfillment,
  revokedAt: string
): Promise<GridTerminalFulfillment> {
  if (fulfillment.provider !== "bittergrid_api" || !fulfillment.grid_workcell_id || !gridApiConfigured()) {
    return revokeGridTerminalFulfillment(fulfillment, revokedAt);
  }

  try {
    await gridRequest("DELETE", `/workcells/${encodeURIComponent(fulfillment.grid_workcell_id)}`);
    return {
      ...revokeGridTerminalFulfillment(fulfillment, revokedAt),
      cleanup_status: "grid_destroy_requested",
      message: "Hosted workcell session revoked; Grid terminal cleanup was requested."
    };
  } catch {
    return {
      ...revokeGridTerminalFulfillment(fulfillment, revokedAt),
      cleanup_status: "grid_cleanup_needs_repair",
      repair_action: "Retry Grid workcell cleanup from support-debug; Git write access was revoked in BitterGit.",
      message: "Hosted workcell session revoked; Grid terminal cleanup needs repair."
    };
  }
}

function normalizeTerminalFulfillmentRequest(value: unknown): { mode: string; box_ref: string } {
  const defaultMode = config.gridTerminalMode === "api" ? "grid_api" : "local_adapter";
  if (!isRecord(value)) return { mode: defaultMode, box_ref: config.gridHostSlug };
  const mode = typeof value.mode === "string" ? value.mode : defaultMode;
  const boxRef = typeof value.box_ref === "string" && value.box_ref.trim()
    ? value.box_ref.trim()
    : config.gridHostSlug;
  return {
    mode: normalizeMode(mode),
    box_ref: boxRef
  };
}

function normalizeMode(mode: string): string {
  if (mode === "grid_api" || mode === "bittergrid_api" || mode === "docker_local" || mode === "real_grid") {
    return "grid_api";
  }
  if (mode === "dedicated_box") return "dedicated_box";
  return "local_adapter";
}

function normalizeStoredFulfillment(value: Partial<GridTerminalFulfillment>): GridTerminalFulfillment {
  const now = new Date().toISOString();
  return {
    id: stringValue(value.id, "grid_terminal_unknown"),
    provider: stringValue(value.provider, "bittergrid_adapter_local"),
    mode: stringValue(value.mode, "local_adapter"),
    owner_plane: stringValue(value.owner_plane, "BitterGrid"),
    box_ref: stringValue(value.box_ref, "local"),
    dedicated_box_requested: Boolean(value.dedicated_box_requested),
    dedicated_box_available: Boolean(value.dedicated_box_available),
    fallback_reason: typeof value.fallback_reason === "string" ? value.fallback_reason : null,
    repair_action: typeof value.repair_action === "string" ? value.repair_action : null,
    route: stringValue(value.route, ""),
    url: stringValue(value.url, ""),
    status: stringValue(value.status, "ready"),
    lifecycle: stringValue(value.lifecycle, "fulfilled_local_contract"),
    message: stringValue(value.message, "BitterGrid terminal fulfillment contract is ready for this app-scoped workcell."),
    readiness_state: stringValue(value.readiness_state, "ready"),
    source_root: stringValue(value.source_root, ""),
    app_id: stringValue(value.app_id, ""),
    repo_id: stringValue(value.repo_id, ""),
    account_ref: stringValue(value.account_ref, ""),
    origin_remote: stringValue(value.origin_remote, ""),
    credential_delivery: stringValue(value.credential_delivery, "run_scoped_git_credential_helper"),
    token_in_url: false,
    clone_url_has_token: false,
    cleanup_status: stringValue(value.cleanup_status, value.status === "revoked" ? "revoked" : "active"),
    grid_api_url: typeof value.grid_api_url === "string" ? value.grid_api_url : null,
    grid_workcell_id: typeof value.grid_workcell_id === "string" ? value.grid_workcell_id : null,
    grid_workcell_key: typeof value.grid_workcell_key === "string" ? value.grid_workcell_key : null,
    grid_execution_session_id: typeof value.grid_execution_session_id === "string" ? value.grid_execution_session_id : null,
    grid_operation_ref: typeof value.grid_operation_ref === "string" ? value.grid_operation_ref : null,
    parent_context: isRecord(value.parent_context)
      ? {
          status: stringValue(value.parent_context.status, "unknown"),
          files: arrayValue(value.parent_context.files).map((file) => String(file)),
          canonical_instructions: stringValue(value.parent_context.canonical_instructions, "AGENTS.md")
        }
      : null,
    created_at: stringValue(value.created_at, now),
    updated_at: stringValue(value.updated_at, now)
  };
}

async function requestBitterGridApiFulfillment(
  input: {
    session_id: string;
    app: AccountApp;
    repo: Repository;
    source_root: string;
    git_token?: string;
  },
  request: { mode: string; box_ref: string }
): Promise<GridTerminalFulfillment> {
  const now = new Date().toISOString();
  if (!gridApiConfigured()) {
    return {
      ...blockedGridFulfillment(input, request, now),
      repair_action: "Configure BITTERGRID_API_URL and BITTERGRID_SERVICE_TOKEN before requesting real Grid terminal fulfillment."
    };
  }
  if (!input.git_token) {
    return {
      ...blockedGridFulfillment(input, request, now),
      repair_action: "Issue a run-scoped BitterGit token before requesting Grid terminal fulfillment."
    };
  }

  try {
    const host = await findGridHost(request.box_ref);
    const key = gridWorkcellKey(input.app, input.session_id);
    const remote = cloneUrl(input.repo.owner, input.repo.name);
    const metadata = gridWorkcellMetadata(input, request, remote);
    const sourceControl = recordValue(metadata, "source_control") as Record<string, unknown>;
    const workcellAttrs = {
      key,
      name: `${input.app.app_slug} backstage`,
      template: "backstage-terminal",
      repo_url: remote,
      repo_ref: input.repo.default_branch,
      host_id: host.id,
      desired_state: "running",
      status: "pending",
      metadata: {
        ...metadata,
        source_control: {
          ...sourceControl,
          credential_helper: {
            username: "bittergit",
            password: input.git_token
          }
        }
      }
    };
    const workcell = await upsertGridWorkcell(key, workcellAttrs);
    const workcellId = stringPath(workcell, ["workcell", "id"]) || stringPath(workcell, ["id"]) || key;
    const ensure = await gridRequest("POST", `/workcells/${encodeURIComponent(workcellId)}/ensure`, {
      actor_ref: `bittergit:${input.session_id}`
    });
    const ensuredWorkcell = await waitForGridWorkcellReady(workcellId, ensure);
    const session = await gridRequest("POST", `/workcells/${encodeURIComponent(workcellId)}/execution_sessions`, {
      actor_ref: `bittergit:${input.session_id}`,
      execution_session: {
        actor_kind: "agent",
        actor_ref: `bittergit:${input.session_id}`,
        metadata: {
          app_id: input.app.id,
          repo_id: input.repo.id,
          account_ref: input.app.account_ref,
          workspace_ref: input.app.workspace_ref,
          source: "bittergit_hosted_session"
        }
      }
    });
    const gridExecutionSessionId = stringPath(session, ["execution_session", "id"]);
    const attachedWorkcell = await waitForGridExecutionSessionReady(workcellId, gridExecutionSessionId, session);
    const parentContext = await installGridParentContext(workcellId, gridExecutionSessionId);
    const terminalPlan = await gridRequest("GET", `/workcells/${encodeURIComponent(workcellId)}/terminal_attachment`);
    const workcellPayload =
      recordValue(attachedWorkcell, "workcell") ??
      recordValue(ensuredWorkcell, "workcell") ??
      recordValue(ensure, "workcell") ??
      recordValue(workcell, "workcell") ??
      workcell;
    const terminalAttachment = recordValue(terminalPlan, "terminal_attachment") ?? terminalPlan;
    const sourceRoot =
      stringPath(workcellPayload, ["metadata", "workspace", "root"]) ||
      stringPath(terminalAttachment, ["runtime", "workspace_root"]) ||
      `${config.gridWorkcellsRoot}/${key}/workspace`;
    const terminalUrl =
      stringPath(terminalAttachment, ["terminal", "url"]) ||
      gridTerminalUrl(input.app.app_slug);
    const terminalRoute = safeTerminalRoute(terminalUrl, input.session_id);
    const status = normalizeGridStatus(
      stringPath(workcellPayload, ["status"]) ||
      stringPath(recordValue(ensure, "workcell"), ["status"])
    );

    return {
      id: `grid_terminal_${input.session_id}`,
      provider: "bittergrid_api",
      mode: "docker_local",
      owner_plane: "BitterGrid",
      box_ref: request.box_ref,
      dedicated_box_requested: false,
      dedicated_box_available: true,
      fallback_reason: null,
      repair_action: status === "ready" ? null : "Wait for or repair the queued Grid workcell ensure operation.",
      route: terminalRoute,
      url: terminalUrl,
      status,
      lifecycle: status === "ready" ? "grid_workcell_ready" : "grid_workcell_requested",
      message: status === "ready"
        ? "BitterGrid workcell is ready with BitterGit origin and run-scoped credential helper delivery."
        : "BitterGrid workcell fulfillment was requested and is waiting for Grid execution.",
      readiness_state: status,
      source_root: sourceRoot,
      app_id: input.app.id,
      repo_id: input.repo.id,
      account_ref: input.app.account_ref,
      origin_remote: remote,
      credential_delivery: "run_scoped_git_credential_helper",
      token_in_url: false,
      clone_url_has_token: false,
      cleanup_status: "active",
      grid_api_url: config.gridApiUrl,
      grid_workcell_id: workcellId,
      grid_workcell_key: stringPath(workcellPayload, ["key"]) || key,
      grid_execution_session_id: gridExecutionSessionId,
      grid_operation_ref: stringPath(ensure, ["workcell", "recent_operations", "0", "id"]) || null,
      parent_context: parentContext,
      created_at: now,
      updated_at: new Date().toISOString()
    };
  } catch {
    return {
      ...blockedGridFulfillment(input, request, now),
      message: "BitterGrid workcell fulfillment needs repair before the hosted terminal is ready.",
      repair_action: "Retry Grid terminal fulfillment or use the BitterGrid support workflow."
    };
  }
}

function blockedGridFulfillment(
  input: { session_id: string; app: AccountApp; repo: Repository; source_root: string },
  request: { box_ref: string },
  now: string
): GridTerminalFulfillment {
  const route = `/terminals/${encodeURIComponent(input.session_id)}`;
  return {
    id: `grid_terminal_${input.session_id}`,
    provider: "bittergrid_api",
    mode: "docker_local",
    owner_plane: "BitterGrid",
    box_ref: request.box_ref,
    dedicated_box_requested: false,
    dedicated_box_available: false,
    fallback_reason: "Grid API fulfillment unavailable",
    repair_action: "Retry Grid terminal fulfillment after closing the Grid API blocker.",
    route,
    url: `http://${config.host}:${config.port}${route}`,
    status: "blocked",
    lifecycle: "grid_workcell_blocked",
    message: "BitterGrid workcell fulfillment is blocked.",
    readiness_state: "blocked",
    source_root: input.source_root,
    app_id: input.app.id,
    repo_id: input.repo.id,
    account_ref: input.app.account_ref,
    origin_remote: cloneUrl(input.repo.owner, input.repo.name),
    credential_delivery: "run_scoped_git_credential_helper",
    token_in_url: false,
    clone_url_has_token: false,
    cleanup_status: "not_started",
    grid_api_url: config.gridApiUrl || null,
    grid_workcell_id: null,
    grid_workcell_key: null,
    grid_execution_session_id: null,
    grid_operation_ref: null,
    parent_context: null,
    created_at: now,
    updated_at: now
  };
}

function gridApiConfigured(): boolean {
  return config.gridApiUrl.length > 0 && config.gridServiceToken.trim().length > 0;
}

async function findGridHost(slug: string): Promise<Record<string, unknown>> {
  const payload = await gridRequest("GET", "/hosts");
  const hosts = Array.isArray(recordValue(payload, "hosts")) ? recordValue(payload, "hosts") as Array<Record<string, unknown>> : [];
  const host = hosts.find((entry) => entry.slug === slug || entry.id === slug);
  if (!host) throw new Error(`Grid host ${slug} not found`);
  if (host.status && host.status !== "online") throw new Error(`Grid host ${slug} is not online`);
  return host;
}

async function upsertGridWorkcell(key: string, attributes: Record<string, unknown>): Promise<Record<string, unknown>> {
  const existing = await gridRequest("GET", `/workcells/${encodeURIComponent(key)}`).catch((error) => {
    if (error instanceof GridApiError && error.status === 404) return null;
    throw error;
  });
  if (existing) {
    return gridRequest("PATCH", `/workcells/${encodeURIComponent(key)}`, { workcell: attributes });
  }
  return gridRequest("POST", "/workcells", { workcell: attributes });
}

async function gridRequest(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.gridApiUrl}${path}`, {
    method,
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "authorization": `Bearer ${config.gridServiceToken}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const payload = text ? safeJson(text) : {};
  if (!response.ok) throw new GridApiError(response.status, payload);
  return payload;
}

async function waitForGridWorkcellReady(workcellId: string, initialPayload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return waitForGridState(
    async () => gridRequest("GET", `/workcells/${encodeURIComponent(workcellId)}`),
    (payload) => {
      const workcell = recordValue(payload, "workcell") as Record<string, unknown> | undefined;
      if (!workcell) return { done: false };
      const failed = recentOperation(workcell, "workcell.ensure.execute", "failed");
      if (failed) return { done: true, error: operationFailureMessage(failed, "Grid workcell checkout failed.") };

      const workspaceRoot = stringPath(workcell, ["metadata", "workspace", "root"]);
      const ready = normalizeGridStatus(stringPath(workcell, ["status"])) === "ready" && Boolean(workspaceRoot);
      if (ready) return { done: true, payload };
      if (workspaceRoot && !recentOperation(workcell, "workcell.ensure.execute", "queued", "running")) {
        return { done: true, payload };
      }
      return { done: false };
    },
    initialPayload,
    "Timed out waiting for Grid workcell checkout readiness."
  );
}

async function waitForGridExecutionSessionReady(
  workcellId: string,
  sessionId: string | null,
  initialPayload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!sessionId) throw new Error("Grid execution session id missing after attach request.");
  return waitForGridState(
    async () => gridRequest("GET", `/workcells/${encodeURIComponent(workcellId)}`),
    (payload) => {
      const workcell = recordValue(payload, "workcell") as Record<string, unknown> | undefined;
      if (!workcell) return { done: false };
      const attachedSession = recordValue(payload, "execution_session");
      if (
        isRecord(attachedSession) &&
        String(attachedSession.id ?? "") === String(sessionId) &&
        stringPath(attachedSession, ["state"]) === "attached"
      ) {
        return { done: true, payload };
      }

      const failed = recentOperation(workcell, "workcell.session.attach.execute", "failed", undefined, sessionId);
      if (failed) return { done: true, error: operationFailureMessage(failed, "Grid execution session attach failed.") };

      const succeeded = recentOperation(workcell, "workcell.session.attach.execute", "succeeded", undefined, sessionId);
      const session = recentExecutionSession(workcell, sessionId);
      if (succeeded && stringPath(session, ["state"]) === "attached") return { done: true, payload };
      return { done: false };
    },
    initialPayload,
    "Timed out waiting for Grid execution session attach."
  );
}

async function waitForGridState(
  poll: () => Promise<Record<string, unknown>>,
  classify: (payload: Record<string, unknown>) => { done: boolean; payload?: Record<string, unknown>; error?: string },
  initialPayload: Record<string, unknown>,
  timeoutMessage: string
): Promise<Record<string, unknown>> {
  const timeoutMs = Number(process.env.BITTERGIT_GRID_READY_TIMEOUT_MS ?? "30000");
  const pollMs = Number(process.env.BITTERGIT_GRID_READY_POLL_MS ?? "500");
  const deadline = Date.now() + timeoutMs;
  let payload = initialPayload;
  while (Date.now() <= deadline) {
    const result = classify(payload);
    if (result.error) throw new Error(result.error);
    if (result.done) return result.payload ?? payload;
    await sleep(pollMs);
    payload = await poll();
  }
  throw new Error(timeoutMessage);
}

function recentOperation(
  workcell: Record<string, unknown>,
  kind: string,
  state: string,
  alternateState?: string,
  sessionId?: string
): Record<string, unknown> | null {
  const operations = arrayValue(workcell.recent_operations);
  return operations.find((operation) => {
    if (!isRecord(operation)) return false;
    if (operation.kind !== kind) return false;
    if (operation.state !== state && operation.state !== alternateState) return false;
    if (!sessionId) return true;
    const metadata = isRecord(operation.metadata) ? operation.metadata : {};
    return String(metadata.session_id ?? "") === String(sessionId);
  }) as Record<string, unknown> | undefined ?? null;
}

function recentExecutionSession(workcell: Record<string, unknown>, sessionId: string): Record<string, unknown> | null {
  const sessions = [
    ...arrayValue(workcell.recent_execution_sessions),
    workcell.latest_execution_session
  ];
  return sessions.find((session) => isRecord(session) && String(session.id ?? "") === String(sessionId)) as Record<string, unknown> | undefined ?? null;
}

function operationFailureMessage(_operation: Record<string, unknown>, fallback: string): string {
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(50, ms)));
}

async function gridSourceAndCliEvidence(input: {
  provider: string;
  workcell_id: string;
  execution_session_id?: string | null;
  source_root: string;
  origin_remote: string;
}): Promise<Pick<GridProviderReadiness, "cli" | "source">> {
  const payload = await gridRequest("POST", `/workcells/${encodeURIComponent(input.workcell_id)}/exec`, {
    actor_ref: "bittergit:provider-readiness",
    execution_session_id: input.execution_session_id ?? undefined,
    cwd: ".",
    timeout_ms: 8000,
    capture_max: 4096,
    command: {
      kind: "script",
      script: providerReadinessScript(input.provider)
    }
  });
  const stdout = stringValue(payload.stdout, "");
  const exitCode = numberValue(payload.exit_code);
  const facts = parseReadinessFacts(stdout);
  const available = facts.BITTERGIT_PROVIDER_CLI_AVAILABLE === "1";
  const rawOrigin = facts.BITTERGIT_ORIGIN_REMOTE || input.origin_remote;
  const sourceRoot = facts.BITTERGIT_WORKCELL_PWD || input.source_root;
  const files = [];
  if (facts.BITTERGIT_AGENTS_PRESENT === "1") files.push("AGENTS.md");
  if (facts.BITTERGIT_APP_PRESENT === "1") files.push("APP.md");
  const parentFiles = [];
  if (facts.BITTERGIT_PARENT_AGENTS_PRESENT === "1") parentFiles.push("../AGENTS.md");
  if (facts.BITTERGIT_PARENT_CLAUDE_PRESENT === "1") parentFiles.push("../CLAUDE.md");
  if (facts.BITTERGIT_PARENT_GEMINI_PRESENT === "1") parentFiles.push("../GEMINI.md");

  return {
    cli: {
      provider: input.provider,
      command: input.provider,
      available,
      status: available ? "available" : "missing",
      source: "bittergrid_executor_command_v",
      version: available ? sanitizeGridText(facts.BITTERGIT_PROVIDER_CLI_VERSION || null) : null,
      path_returned: false,
      repair_action: available ? null : `Install or mount the ${input.provider} CLI in the hosted workcell.`,
      checked_by: "bittergrid_exec",
      exit_code: exitCode
    },
    source: {
      evidence_source: "bittergrid_exec",
      source_root: sanitizeGridText(sourceRoot) || input.source_root,
      source_root_exists: true,
      instructions_present: facts.BITTERGIT_AGENTS_PRESENT === "1",
      charter_present: facts.BITTERGIT_APP_PRESENT === "1",
      origin_remote: safeOriginRemote(rawOrigin),
      origin_remote_has_token: hasTokenMaterial(rawOrigin),
      source_files_visible: files,
      parent_context_files_visible: parentFiles,
      grid_workcell_id: input.workcell_id,
      grid_execution_session_id: input.execution_session_id ?? null
    }
  };
}

async function gridProviderAuthEvidence(input: {
  provider: string;
  workcell_id: string;
  bundle_id: string;
  service_url: string;
  repair_action?: unknown;
}): Promise<GridProviderReadiness["auth"]> {
  if (!input.bundle_id) {
    return {
      provider: input.provider,
      source: "bitterpass_provider_bootstrap_plan",
      status: "blocked",
      mount_status: "bundle_missing",
      reference_present: false,
      reference_returned: false,
      credential_material_returned: false,
      auth_files_returned: false,
      includes_secret_value: false,
      repair_action: sanitizeRepairAction(input.repair_action, "Issue a short-lived BitterPass provider auth bundle before launching this agent."),
      checked_by: "bittergrid_terminal_provider_bootstrap_dry_run",
      bundle_present: false,
      bootstrap_status: "blocked",
      secret_material_returned: false
    };
  }

  try {
    const payload = await gridRequest(
      "POST",
      `/workcells/${encodeURIComponent(input.workcell_id)}/terminal_attachment/provider_bootstrap`,
      {
        dry_run: true,
        provider: input.provider,
        bundle_id: input.bundle_id,
        service_url: input.service_url || undefined,
        actor_ref: "bittergit:provider-readiness"
      }
    );
    const plan = recordValue(payload, "terminal_provider_bootstrap") as Record<string, unknown> | undefined;
    const planStatus = stringValue(plan?.status, stringValue(payload.status, "blocked"));
    const ready = planStatus === "ready";
    return {
      provider: input.provider,
      source: "bitterpass_provider_bootstrap_plan",
      status: ready ? "mounted" : "blocked",
      mount_status: ready ? "bundle_ready" : "blocked",
      reference_present: true,
      reference_returned: false,
      credential_material_returned: false,
      auth_files_returned: false,
      includes_secret_value: false,
      repair_action: ready ? null : "Repair the BitterPass provider auth bundle before launching this agent.",
      checked_by: "bittergrid_terminal_provider_bootstrap_dry_run",
      bundle_present: true,
      bootstrap_status: planStatus,
      secret_material_returned: false
    };
  } catch {
    return {
      provider: input.provider,
      source: "bitterpass_provider_bootstrap_plan",
      status: "blocked",
      mount_status: "blocked",
      reference_present: true,
      reference_returned: false,
      credential_material_returned: false,
      auth_files_returned: false,
      includes_secret_value: false,
      repair_action: "Repair the BitterPass provider auth bundle before launching this agent.",
      checked_by: "bittergrid_terminal_provider_bootstrap_dry_run",
      bundle_present: true,
      bootstrap_status: "blocked",
      secret_material_returned: false
    };
  }
}

function blockedGridProviderReadiness(
  input: {
    provider: string;
    workcell_id: string | null | undefined;
    execution_session_id?: string | null;
    source_root: string;
    origin_remote: string;
    provider_auth?: { bundle_id?: unknown };
  },
  repairAction: string
): GridProviderReadiness {
  const provider = normalizeProviderCommand(input.provider);
  return {
    cli: {
      provider,
      command: provider,
      available: false,
      status: "missing",
      source: "bittergrid_executor_command_v",
      version: null,
      path_returned: false,
      repair_action: `Install or mount the ${provider} CLI in the hosted workcell.`,
      checked_by: "bittergrid_exec",
      exit_code: null
    },
    auth: {
      provider,
      source: "bitterpass_provider_bootstrap_plan",
      status: "blocked",
      mount_status: "blocked",
      reference_present: Boolean(input.provider_auth?.bundle_id),
      reference_returned: false,
      credential_material_returned: false,
      auth_files_returned: false,
      includes_secret_value: false,
      repair_action: repairAction,
      checked_by: "bittergrid_terminal_provider_bootstrap_dry_run",
      bundle_present: Boolean(input.provider_auth?.bundle_id),
      bootstrap_status: "blocked",
      secret_material_returned: false
    },
    source: {
      evidence_source: "bittergrid_exec",
      source_root: input.source_root,
      source_root_exists: false,
      instructions_present: false,
      charter_present: false,
      origin_remote: safeOriginRemote(input.origin_remote),
      origin_remote_has_token: hasTokenMaterial(input.origin_remote),
      source_files_visible: [],
      parent_context_files_visible: [],
      grid_workcell_id: input.workcell_id ?? null,
      grid_execution_session_id: input.execution_session_id ?? null
    }
  };
}

function providerReadinessScript(provider: string): string {
  const command = normalizeProviderCommand(provider);
  return [
    "set +e",
    "printf 'BITTERGIT_WORKCELL_PWD=%s\\n' \"$(pwd)\"",
    "origin_remote=\"$(git remote get-url origin 2>/dev/null)\"",
    "printf 'BITTERGIT_ORIGIN_REMOTE=%s\\n' \"$origin_remote\"",
    "test -f AGENTS.md; printf 'BITTERGIT_AGENTS_PRESENT=%s\\n' \"$([ $? -eq 0 ] && printf 1 || printf 0)\"",
    "test -f APP.md; printf 'BITTERGIT_APP_PRESENT=%s\\n' \"$([ $? -eq 0 ] && printf 1 || printf 0)\"",
    "test -f ../AGENTS.md; printf 'BITTERGIT_PARENT_AGENTS_PRESENT=%s\\n' \"$([ $? -eq 0 ] && printf 1 || printf 0)\"",
    "test -f ../CLAUDE.md; printf 'BITTERGIT_PARENT_CLAUDE_PRESENT=%s\\n' \"$([ $? -eq 0 ] && printf 1 || printf 0)\"",
    "test -f ../GEMINI.md; printf 'BITTERGIT_PARENT_GEMINI_PRESENT=%s\\n' \"$([ $? -eq 0 ] && printf 1 || printf 0)\"",
    `if command -v ${command} >/dev/null 2>&1; then`,
    `  version="$(${command} --version 2>/dev/null | head -n 1)"`,
    "  printf 'BITTERGIT_PROVIDER_CLI_AVAILABLE=1\\n'",
    "  printf 'BITTERGIT_PROVIDER_CLI_VERSION=%s\\n' \"$version\"",
    "  exit 0",
    "fi",
    "printf 'BITTERGIT_PROVIDER_CLI_AVAILABLE=0\\n'",
    "exit 0"
  ].join("\n");
}

async function installGridParentContext(
  workcellId: string,
  executionSessionId: string | null
): Promise<{ status: string; files: string[]; canonical_instructions: string }> {
  try {
    const payload = await gridRequest("POST", `/workcells/${encodeURIComponent(workcellId)}/exec`, {
      actor_ref: "bittergit:parent-context",
      execution_session_id: executionSessionId ?? undefined,
      cwd: ".",
      timeout_ms: 8000,
      capture_max: 2048,
      command: {
        kind: "script",
        script: parentContextInstallScript()
      }
    });
    const facts = parseReadinessFacts(stringValue(payload.stdout, ""));
    const installed =
      facts.BITTERGIT_PARENT_AGENTS_PRESENT === "1" &&
      facts.BITTERGIT_PARENT_CLAUDE_PRESENT === "1" &&
      facts.BITTERGIT_PARENT_GEMINI_PRESENT === "1";
    return {
      status: installed ? "installed" : "needs_repair",
      files: ["AGENTS.md", "CLAUDE.md", "GEMINI.md"],
      canonical_instructions: "AGENTS.md"
    };
  } catch {
    return {
      status: "needs_repair",
      files: ["AGENTS.md", "CLAUDE.md", "GEMINI.md"],
      canonical_instructions: "AGENTS.md"
    };
  }
}

function parentContextInstallScript(): string {
  return [
    "set -eu",
    "parent=\"$(dirname \"$PWD\")\"",
    writeParentFileCommand("AGENTS.md", workcellParentAgentsMd()),
    writeParentFileCommand("CLAUDE.md", claudePointerMd()),
    writeParentFileCommand("GEMINI.md", geminiPointerMd()),
    "test -f \"$parent/AGENTS.md\"; printf 'BITTERGIT_PARENT_AGENTS_PRESENT=%s\\n' \"$([ $? -eq 0 ] && printf 1 || printf 0)\"",
    "test -f \"$parent/CLAUDE.md\"; printf 'BITTERGIT_PARENT_CLAUDE_PRESENT=%s\\n' \"$([ $? -eq 0 ] && printf 1 || printf 0)\"",
    "test -f \"$parent/GEMINI.md\"; printf 'BITTERGIT_PARENT_GEMINI_PRESENT=%s\\n' \"$([ $? -eq 0 ] && printf 1 || printf 0)\""
  ].join("\n");
}

function writeParentFileCommand(path: string, content: string): string {
  return `cat > "$parent/${path}" <<'BITTERGIT_PARENT_CONTEXT'\n${content}BITTERGIT_PARENT_CONTEXT`;
}

function parseReadinessFacts(stdout: string): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (!key.startsWith("BITTERGIT_")) continue;
    facts[key] = line.slice(index + 1).trim();
  }
  return facts;
}

function normalizeProviderCommand(provider: string): string {
  return provider === "claude" ? "claude" : "codex";
}

class GridApiError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(`BitterGrid API request failed with ${status}`);
    this.status = status;
    this.payload = payload;
  }
}

function gridWorkcellMetadata(
  input: { session_id: string; app: AccountApp; repo: Repository },
  request: { box_ref: string },
  remote: string
): Record<string, unknown> {
  const appSlug = input.app.app_slug;
  const key = gridWorkcellKey(input.app, input.session_id);
  const routePath = `/app/apps/${encodeURIComponent(appSlug)}/backstage/terminal`;
  const terminalUrl = gridTerminalUrl(appSlug);
  const terminalHostname = new URL(terminalUrl).hostname;
  const imageRef = config.gridTerminalImageRef.trim();
  const imageSource = imageRef ? {
    ref: imageRef,
    source_repo: config.gridTerminalImageSourceRepo.trim(),
    source_commit: config.gridTerminalImageSourceCommit.trim() || undefined,
    source_path: config.gridTerminalImageSourcePath.trim() || "docker/backstage-terminal",
    secret_material_returned: false
  } : undefined;
  const runtimeEnvRef = `bittergrid.terminal/${key}.runtime_env/env_value`;
  const workspaceMount = `/workspace/${safeMountSegment(appSlug)}`;
  return {
    schema: "bittergit.grid_workcell.v1",
    app_slug: appSlug,
    account_ref: input.app.account_ref,
    workspace_ref: input.app.workspace_ref,
    bittergit: {
      session_id: input.session_id,
      app_id: input.app.id,
      repo_id: input.repo.id,
      source_posture: "bittergit_primary"
    },
    runtime: {
      backend: "docker_local",
      host_ref: request.box_ref
    },
    source_control: {
      canonical: "bittergit",
      origin_remote: remote,
      credential_delivery: "run_scoped_git_credential_helper"
    },
    terminal_transport: "ttyd-websocket-v1",
    auth_mode: "bitterhub_app_membership",
    terminal_session_cookie_auth_supported: true,
    terminal_session_secret_ref: `bittergrid.terminal/${key}.session_secret/env_value`,
    terminal_runtime_env_ref: runtimeEnvRef,
    route_owner: "bittergrid_workcell_terminal_attachment",
    terminal_lifecycle: "grid_requested",
    terminal_image_ref: imageRef || undefined,
    terminal_image_source: imageSource,
    terminal_attachment: {
      schema: "bittergrid.workcell_terminal_attachment.v0",
      app_slug: appSlug,
      lifecycle: "source_contract_recorded",
      route: {
        owner: "bittergrid_workcell_terminal_attachment",
        hostname: terminalHostname,
        path: routePath,
        url: terminalUrl
      },
      runtime: {
        transport: "ttyd-websocket-v1",
        container_name: `${key}-terminal`,
        env_ref: runtimeEnvRef,
        workspace_mount: workspaceMount,
        home_mount: "/home/backstage"
      },
      image: imageSource,
      custody: {
        desired_secret_custody: "bitterpass_or_grid_secret_ref",
        session_cookie_auth_supported: true,
        session_secret_ref: `bittergrid.terminal/${key}.session_secret/env_value`,
        runtime_env_ref: runtimeEnvRef,
        secret_material_returned: false
      }
    }
  };
}

function gridTerminalUrl(appSlug: string): string {
  const base = config.gridTerminalPublicBaseUrl || `http://${config.host}:${config.port}`;
  return `${base}/app/apps/${encodeURIComponent(appSlug)}/backstage/terminal/`;
}

function gridWorkcellKey(app: AccountApp, sessionId: string): string {
  const base = `bittergit-${app.app_slug}-${sessionId.replace(/^hws_/, "").slice(0, 8)}`;
  return base.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function safeMountSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "app";
}

function normalizeGridStatus(status: string | null): string {
  if (status === "ready" || status === "leased") return "ready";
  if (status === "failed" || status === "destroyed") return "blocked";
  return "provisioning";
}

function safeTerminalRoute(url: string, sessionId: string): string {
  try {
    return new URL(url).pathname || `/terminals/${encodeURIComponent(sessionId)}`;
  } catch {
    return `/terminals/${encodeURIComponent(sessionId)}`;
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function recordValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringPath(record: unknown, path: string[]): string | null {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  if (typeof current === "number" && Number.isFinite(current)) return String(current);
  return typeof current === "string" && current.trim().length > 0 ? current : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeGridText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sanitized = value.replace(/\b(sk-|bgt_|ghp_|github_pat_|cred_|bearer\s+)[^\s]+/gi, "[redacted]").trim();
  return sanitized.length > 0 ? sanitized.slice(0, 160) : null;
}

function sanitizeRepairAction(value: unknown, fallback: string): string {
  const sanitized = sanitizeGridText(value);
  return sanitized || fallback;
}

function supportFulfillmentMessage(fulfillment: GridTerminalFulfillment): string {
  if (fulfillment.status === "revoked") {
    return "Hosted workcell session revoked; terminal fulfillment is no longer active.";
  }
  if (fulfillment.status === "blocked") {
    return "Terminal fulfillment needs repair before the hosted terminal is ready.";
  }
  if (fulfillment.status === "ready") {
    return fulfillment.dedicated_box_requested
      ? "Dedicated terminal fulfillment is ready for this app-scoped workcell."
      : "Terminal fulfillment is ready for this app-scoped workcell.";
  }
  return "Terminal fulfillment is in progress for this app-scoped workcell.";
}

function supportParentContext(
  value: GridTerminalFulfillment["parent_context"]
): Record<string, unknown> | null {
  if (!value) return null;
  const allowedFiles = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
  return {
    status: value.status === "installed" || value.status === "needs_repair" ? value.status : "unknown",
    files: value.files.filter((file) => allowedFiles.has(file)),
    canonical_instructions: value.canonical_instructions === "AGENTS.md" ? "AGENTS.md" : null
  };
}

function safeOriginRemote(value: unknown): string {
  const remote = sanitizeGridText(value) || "";
  if (!remote) return "";
  return hasTokenMaterial(remote) ? "[redacted-token-bearing-origin]" : remote;
}

function hasTokenMaterial(value: unknown): boolean {
  return typeof value === "string" && /\b(token|bgt_|sk-|ghp_|github_pat_|bearer\s+|x-access-token|oauth2:)/i.test(value);
}
