import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AccountAssertion } from "./assertions";
import { findAccountAppById } from "./apps";
import { cloneUrl } from "./config";
import { findRepositoryById, type Repository } from "./repos";
import { findHostedWorkcellSession, type HostedWorkcellSession } from "./hosted-sessions";
import { ensureStorage } from "./storage";
import { requestGridProviderReadiness, type GridTerminalFulfillment } from "./grid-terminal";

export type HostedAgentLaunch = {
  id: string;
  session_id: string;
  app_id: string;
  repo_id: string;
  account_ref: string;
  workspace_ref: string;
  provider: string;
  status: string;
  source_root: string;
  origin_remote: string;
  instructions_path: string;
  charter_path: string;
  first_task: string;
  run_scope_ref: string;
  git_token_ref: string;
  provider_auth_status: string;
  provider_auth_ref: string | null;
  provider_cli_json: string | null;
  provider_auth_json: string | null;
  readiness_evidence_json: string | null;
  launch_contract_json: string | null;
  readiness_state: string;
  failure_reason: string | null;
  repair_action: string | null;
  launch_message: string;
  created_at: string;
  updated_at: string;
};

type HostedAgentLaunchInput = {
  provider?: string;
  provider_cli?: {
    available?: boolean;
    command?: string;
    source?: string;
  };
  provider_auth?: {
    status?: string;
    source?: string;
    credential_ref?: string;
    reference?: string;
    auth_file?: string;
    bundle_id?: string;
    service_url?: string;
    repair_action?: string;
  };
  launch_refs?: {
    factory_run_ref?: string;
    bitter_session_ref?: string;
    bitter_log_ref?: string;
  };
};

type ProviderCliPosture = {
  provider: string;
  command: string;
  available: boolean;
  status: string;
  source: string;
  version: string | null;
  path_returned: boolean;
  repair_action: string | null;
  checked_by: string;
  exit_code: number | null;
};

type ProviderAuthPosture = {
  provider: string;
  source: string;
  status: string;
  mount_status: string;
  reference_present: boolean;
  reference_returned: boolean;
  credential_material_returned: boolean;
  auth_files_returned: boolean;
  includes_secret_value: boolean;
  repair_action: string | null;
  checked_by: string;
  bundle_present: boolean;
  bootstrap_status: string;
  secret_material_returned: boolean;
};

type LaunchReadinessEvidence = {
  evidence_source: string;
  session_ready: boolean;
  source_root_exists: boolean;
  instructions_present: boolean;
  charter_present: boolean;
  origin_remote_is_bittergit: boolean;
  origin_remote_has_token: boolean;
  provider_cli_available: boolean;
  provider_auth_ready: boolean;
  git_credential_delivery: string;
  terminal_url_has_token: boolean;
  source_files_visible: string[];
  grid_workcell_id: string | null;
  grid_execution_session_id: string | null;
};

type LaunchContract = {
  provider: string;
  source_root: string;
  instructions_path: string;
  charter_path: string;
  first_prompt: string;
  implementation_before_charter: string;
  expected_workflow: string[];
  runtime_refs: Record<string, string | null>;
};

type SourceEvidence = {
  evidence_source: string;
  source_root: string;
  source_root_exists: boolean;
  instructions_present: boolean;
  charter_present: boolean;
  origin_remote: string;
  origin_remote_has_token: boolean;
  source_files_visible: string[];
  grid_workcell_id: string | null;
  grid_execution_session_id: string | null;
};

export async function createHostedAgentLaunch(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string,
  input: HostedAgentLaunchInput
): Promise<HostedAgentLaunch> {
  const { repo, session } = requireLaunchSession(assertion, appId, sessionId);
  const provider = normalizeProvider(input.provider);
  const posture = provider.ok
    ? await providerPostureForLaunch(session, repo, provider.provider, input)
    : localProviderPosture(session, repo, provider.provider, input);
  const cli = posture.cli;
  const auth = posture.auth;
  const evidence = readinessEvidence(session, repo, cli, auth, posture.source);
  const baseStatus = provider.ok ? readinessForSession(session, provider.provider, evidence) : blockedProvider(provider.provider);
  const status = applyLaunchReadiness(baseStatus, cli, auth);
  const now = new Date().toISOString();
  const firstTask = "Read repo-local AGENTS.md and APP.md, then establish the app charter with axes of excellence and verification gates before substantial implementation.";
  const contract = launchContract(session, provider.provider, firstTask, input.launch_refs);
  const launch: HostedAgentLaunch = {
    id: `agent_launch_${randomUUID()}`,
    session_id: session.id,
    app_id: session.app_id,
    repo_id: session.repo_id,
    account_ref: session.account_ref,
    workspace_ref: session.workspace_ref,
    provider: provider.provider,
    status: status.status,
    source_root: posture.source.source_root,
    origin_remote: posture.source.origin_remote,
    instructions_path: join(posture.source.source_root, "AGENTS.md"),
    charter_path: join(posture.source.source_root, "APP.md"),
    first_task: firstTask,
    run_scope_ref: `agent_launch:${session.id}`,
    git_token_ref: session.token_id,
    provider_auth_status: auth.status,
    provider_auth_ref: auth.reference_present ? "configured_reference_redacted" : null,
    provider_cli_json: JSON.stringify(cli),
    provider_auth_json: JSON.stringify(auth),
    readiness_evidence_json: JSON.stringify(evidence),
    launch_contract_json: JSON.stringify(contract),
    readiness_state: status.readiness_state,
    failure_reason: status.failure_reason,
    repair_action: status.repair_action,
    launch_message: status.launch_message,
    created_at: now,
    updated_at: now
  };

  ensureStorage().query(`
    INSERT INTO hosted_agent_launches
      (id, session_id, app_id, repo_id, account_ref, workspace_ref, provider,
       status, source_root, origin_remote, instructions_path, charter_path,
       first_task, run_scope_ref, git_token_ref, provider_auth_status,
       provider_auth_ref, provider_cli_json, provider_auth_json,
       readiness_evidence_json, launch_contract_json, readiness_state,
       failure_reason, repair_action, launch_message, created_at, updated_at)
    VALUES
      ($id, $session_id, $app_id, $repo_id, $account_ref, $workspace_ref,
       $provider, $status, $source_root, $origin_remote, $instructions_path,
       $charter_path, $first_task, $run_scope_ref, $git_token_ref,
       $provider_auth_status, $provider_auth_ref, $provider_cli_json,
       $provider_auth_json, $readiness_evidence_json, $launch_contract_json,
       $readiness_state, $failure_reason, $repair_action, $launch_message,
       $created_at, $updated_at)
  `).run({
    $id: launch.id,
    $session_id: launch.session_id,
    $app_id: launch.app_id,
    $repo_id: launch.repo_id,
    $account_ref: launch.account_ref,
    $workspace_ref: launch.workspace_ref,
    $provider: launch.provider,
    $status: launch.status,
    $source_root: launch.source_root,
    $origin_remote: launch.origin_remote,
    $instructions_path: launch.instructions_path,
    $charter_path: launch.charter_path,
    $first_task: launch.first_task,
    $run_scope_ref: launch.run_scope_ref,
    $git_token_ref: launch.git_token_ref,
    $provider_auth_status: launch.provider_auth_status,
    $provider_auth_ref: launch.provider_auth_ref,
    $provider_cli_json: launch.provider_cli_json,
    $provider_auth_json: launch.provider_auth_json,
    $readiness_evidence_json: launch.readiness_evidence_json,
    $launch_contract_json: launch.launch_contract_json,
    $readiness_state: launch.readiness_state,
    $failure_reason: launch.failure_reason,
    $repair_action: launch.repair_action,
    $launch_message: launch.launch_message,
    $created_at: launch.created_at,
    $updated_at: launch.updated_at
  });

  return findHostedAgentLaunch(assertion, appId, sessionId, launch.id) as HostedAgentLaunch;
}

export function listHostedAgentLaunchesForSession(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string
): HostedAgentLaunch[] {
  requireLaunchSession(assertion, appId, sessionId);
  return ensureStorage().query<HostedAgentLaunch, [string]>(`
    SELECT ${launchColumns()}
    FROM hosted_agent_launches
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(sessionId);
}

export function findHostedAgentLaunch(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string,
  launchId: string
): HostedAgentLaunch | undefined {
  requireLaunchSession(assertion, appId, sessionId);
  return ensureStorage().query<HostedAgentLaunch, [string, string]>(`
    SELECT ${launchColumns()}
    FROM hosted_agent_launches
    WHERE session_id = ? AND id = ?
  `).get(sessionId, launchId) ?? undefined;
}

export function listHostedAgentLaunchesForRepo(repo: Repository): HostedAgentLaunch[] {
  return ensureStorage().query<HostedAgentLaunch, [string]>(`
    SELECT ${launchColumns()}
    FROM hosted_agent_launches
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id);
}

export function hostedAgentLaunchToJson(launch: HostedAgentLaunch): Record<string, unknown> {
  const providerCli = providerCliFromJson(launch.provider_cli_json, launch.provider);
  const providerAuth = providerAuthFromJson(launch.provider_auth_json, launch.provider, launch.provider_auth_status);
  const readiness = readinessEvidenceFromJson(launch.readiness_evidence_json, launch);
  const contract = launchContractFromJson(launch.launch_contract_json, launch);
  return {
    id: launch.id,
    session_id: launch.session_id,
    app_id: launch.app_id,
    repo_id: launch.repo_id,
    account_ref: launch.account_ref,
    workspace_ref: launch.workspace_ref,
    provider: launch.provider,
    status: launch.status,
    source_root: launch.source_root,
    origin_remote: launch.origin_remote,
    instructions_path: launch.instructions_path,
    charter_path: launch.charter_path,
    first_task: launch.first_task,
    run_scope_ref: launch.run_scope_ref,
    git_token_ref: launch.git_token_ref,
    provider_cli: providerCli,
    provider_auth: {
      ...providerAuth,
      reference_returned: false,
      credential_material_returned: false,
      auth_files_returned: false,
      includes_secret_value: false
    },
    readiness_evidence: readiness,
    launch_contract: contract,
    readiness_state: launch.readiness_state,
    failure_reason: launch.failure_reason,
    repair_action: launch.repair_action,
    launch_message: launch.launch_message,
    created_at: launch.created_at,
    updated_at: launch.updated_at
  };
}

export function hostedAgentLaunchSupportJson(launch: HostedAgentLaunch): Record<string, unknown> {
  const providerCli = providerCliFromJson(launch.provider_cli_json, launch.provider);
  const providerAuth = providerAuthFromJson(launch.provider_auth_json, launch.provider, launch.provider_auth_status);
  const readiness = readinessEvidenceFromJson(launch.readiness_evidence_json, launch);
  const contract = launchContractFromJson(launch.launch_contract_json, launch);
  const runtimeRefs = contract.runtime_refs && typeof contract.runtime_refs === "object"
    ? contract.runtime_refs
    : {};
  const sourceFiles = Array.isArray(readiness.source_files_visible) ? readiness.source_files_visible : [];
  const expectedWorkflow = Array.isArray(contract.expected_workflow) ? contract.expected_workflow : [];
  const failureReason = supportFailureReason(launch.failure_reason);
  return {
    id: launch.id,
    session_id: launch.session_id,
    app_id: launch.app_id,
    repo_id: launch.repo_id,
    account_ref: launch.account_ref,
    workspace_ref: launch.workspace_ref,
    provider: launch.provider,
    status: launch.status,
    source_root: null,
    source_root_returned: false,
    origin_remote: supportOriginRemote(launch.origin_remote),
    instructions_path: null,
    charter_path: null,
    source_paths_returned: false,
    first_task: launch.first_task,
    run_scope_ref: null,
    run_scope_ref_returned: false,
    git_token_ref: null,
    git_token_ref_returned: false,
    provider_cli: {
      provider: launch.provider,
      command: launch.provider === "claude" ? "claude" : "codex",
      available: providerCli.available,
      status: providerCli.available ? "available" : "missing",
      source: providerCli.source === "bittergrid_executor_command_v"
        ? "bittergrid_executor_command_v"
        : "local_launch_contract",
      version: null,
      version_detected: Boolean(providerCli.version),
      path_returned: false,
      repair_action: providerCli.available
        ? null
        : `Retry provider readiness, then install or mount the ${launch.provider} CLI if it remains unavailable.`,
      checked_by: providerCli.source === "bittergrid_executor_command_v"
        ? "bittergrid_exec"
        : "local_launch_contract",
      exit_code: providerCli.exit_code
    },
    provider_auth: {
      provider: launch.provider,
      source: supportProviderAuthSource(providerAuth.source),
      status: providerAuth.status === "mounted" ? "mounted" : "blocked",
      mount_status: providerAuth.status === "mounted" ? "mounted" : "blocked",
      reference_present: providerAuth.reference_present,
      reference_returned: false,
      credential_material_returned: false,
      auth_files_returned: false,
      includes_secret_value: false,
      repair_action: providerAuth.status === "mounted"
        ? null
        : "Repair the provider auth mount through the owner-plane support workflow.",
      checked_by: providerAuth.checked_by === "bittergrid_terminal_provider_bootstrap_dry_run"
        ? "bittergrid_terminal_provider_bootstrap_dry_run"
        : "local_launch_contract",
      bundle_present: providerAuth.bundle_present,
      bootstrap_status: providerAuth.status === "mounted" ? "ready" : "blocked",
      secret_material_returned: false
    },
    readiness_evidence: {
      evidence_source: readiness.evidence_source === "bittergrid_exec" ? "bittergrid_exec" : "local_checkout",
      session_ready: readiness.session_ready,
      source_root_exists: readiness.source_root_exists,
      instructions_present: readiness.instructions_present,
      charter_present: readiness.charter_present,
      origin_remote_is_bittergit: readiness.origin_remote_is_bittergit,
      origin_remote_has_token: readiness.origin_remote_has_token,
      provider_cli_available: readiness.provider_cli_available,
      provider_auth_ready: readiness.provider_auth_ready,
      git_credential_delivery: "run_scoped_credential_helper",
      terminal_url_has_token: readiness.terminal_url_has_token,
      source_files_visible: sourceFiles.filter((file) => file === "AGENTS.md" || file === "APP.md"),
      grid_workcell_id: null,
      grid_execution_session_id: null,
      grid_workcell_linked: Boolean(readiness.grid_workcell_id),
      grid_execution_session_linked: Boolean(readiness.grid_execution_session_id),
      grid_refs_returned: false
    },
    launch_contract: {
      provider: launch.provider,
      source_root: null,
      instructions_path: null,
      charter_path: null,
      source_paths_returned: false,
      first_prompt: contract.first_prompt,
      implementation_before_charter: contract.implementation_before_charter,
      expected_workflow: expectedWorkflow.filter((step) => typeof step === "string").slice(0, 8),
      runtime_refs: {
        bittergit_session_id: launch.session_id,
        bittergit_workcell_id: null,
        bittergit_run_scope_ref: null,
        factory_run_ref: null,
        grid_workcell_id: null,
        grid_execution_session_id: null,
        bitter_session_ref: null,
        bitter_log_ref: null
      },
      factory_run_linked: Boolean(runtimeRefs.factory_run_ref),
      grid_workcell_linked: Boolean(runtimeRefs.grid_workcell_id),
      grid_execution_session_linked: Boolean(runtimeRefs.grid_execution_session_id),
      bitter_session_linked: Boolean(runtimeRefs.bitter_session_ref),
      bitter_log_linked: Boolean(runtimeRefs.bitter_log_ref),
      runtime_refs_returned: false
    },
    readiness_state: launch.readiness_state,
    failure_reason: failureReason,
    repair_action: supportLaunchRepairAction(failureReason, launch.provider),
    launch_message: launch.status === "ready"
      ? `${launch.provider} launch envelope is ready; establish the app charter before implementation.`
      : `${launch.provider} launch needs repair before it can start.`,
    created_at: launch.created_at,
    updated_at: launch.updated_at,
    projection: "support_safe_v1"
  };
}

function supportProviderAuthSource(value: string): string {
  if (value === "bitterpass_provider_bootstrap_plan") return value;
  if (value === "factory_provider_auth_mount") return value;
  if (value === "local_dev_subscription_contract") return value;
  return "local_launch_contract";
}

function supportOriginRemote(value: string): string {
  if (!value || hasTokenMaterial(value)) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function supportFailureReason(value: string | null): string | null {
  if (!value) return null;
  return [
    "session_not_ready",
    "missing_charter_scaffold",
    "unsupported_provider",
    "provider_cli_unavailable",
    "provider_auth_not_mounted"
  ].includes(value) ? value : "launch_blocked";
}

function supportLaunchRepairAction(failureReason: string | null, provider: string): string | null {
  if (!failureReason) return null;
  if (failureReason === "session_not_ready") {
    return "Create or refresh a ready hosted workcell session before launching an agent.";
  }
  if (failureReason === "missing_charter_scaffold") {
    return "Restore AGENTS.md and APP.md before launching a hosted agent.";
  }
  if (failureReason === "unsupported_provider") {
    return "Choose claude or codex for the hosted agent launch envelope.";
  }
  if (failureReason === "provider_cli_unavailable") {
    return `Retry provider readiness, then install or mount the ${provider} CLI if it remains unavailable.`;
  }
  if (failureReason === "provider_auth_not_mounted") {
    return "Repair the provider auth mount through the owner-plane support workflow.";
  }
  return "Use the owner-plane support workflow to repair this launch.";
}

function requireLaunchSession(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string
): { repo: Repository; session: HostedWorkcellSession } {
  const app = findAccountAppById(appId);
  if (!app || app.account_ref !== assertion.account_ref) throw new Error("app not found");
  const repo = findRepositoryById(app.repo_id);
  if (!repo) throw new Error("app repository missing");
  const session = findHostedWorkcellSession(sessionId);
  if (!session || session.app_id !== app.id || session.account_ref !== assertion.account_ref) {
    throw new Error("hosted workcell session not found");
  }
  return { repo, session };
}

function normalizeProvider(value: unknown): { ok: boolean; provider: string } {
  const provider = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (provider === "claude" || provider === "codex") return { ok: true, provider };
  return { ok: false, provider: provider || "unknown" };
}

function readinessForSession(
  session: HostedWorkcellSession,
  provider: string,
  evidence: LaunchReadinessEvidence
): {
  status: string;
  readiness_state: string;
  failure_reason: string | null;
  repair_action: string | null;
  launch_message: string;
} {
  if (session.status !== "ready") {
    return {
      status: "blocked",
      readiness_state: "blocked",
      failure_reason: "session_not_ready",
      repair_action: "Create or refresh a ready hosted workcell session before launching an agent.",
      launch_message: "Agent launch is blocked because the hosted workcell session is not ready."
    };
  }

  if (!evidence.instructions_present || !evidence.charter_present) {
    return {
      status: "blocked",
      readiness_state: "blocked",
      failure_reason: "missing_charter_scaffold",
      repair_action: "Restore AGENTS.md and APP.md before launching a hosted agent.",
      launch_message: "Agent launch is blocked because the source root lacks required charter files."
    };
  }

  return {
    status: "ready",
    readiness_state: "ready",
    failure_reason: null,
    repair_action: null,
    launch_message: `${provider} launch envelope is ready. First task is chartering in APP.md with verification gates.`
  };
}

function applyLaunchReadiness(
  base: {
    status: string;
    readiness_state: string;
    failure_reason: string | null;
    repair_action: string | null;
    launch_message: string;
  },
  cli: ProviderCliPosture,
  auth: ProviderAuthPosture
): {
  status: string;
  readiness_state: string;
  failure_reason: string | null;
  repair_action: string | null;
  launch_message: string;
} {
  if (base.status !== "ready") return base;

  if (!cli.available) {
    return {
      status: "blocked",
      readiness_state: "blocked",
      failure_reason: "provider_cli_unavailable",
      repair_action: cli.repair_action ?? `Install or mount the ${cli.command} CLI in the hosted workcell before launching this agent.`,
      launch_message: `${cli.command} launch is blocked because the provider CLI is not available in the hosted workcell.`
    };
  }

  if (auth.status !== "mounted") {
    return {
      status: "blocked",
      readiness_state: "blocked",
      failure_reason: "provider_auth_not_mounted",
      repair_action: auth.repair_action ?? "Mount provider CLI subscription auth through Factory/Grid before launching this agent.",
      launch_message: `${cli.command} launch is blocked because provider auth is not mounted.`
    };
  }

  return base;
}

function blockedProvider(provider: string): {
  status: string;
  readiness_state: string;
  failure_reason: string;
  repair_action: string;
  launch_message: string;
} {
  return {
    status: "blocked",
    readiness_state: "blocked",
    failure_reason: "unsupported_provider",
    repair_action: "Choose claude or codex for the hosted agent launch envelope.",
    launch_message: `Agent launch is blocked because provider ${provider} is not supported.`
  };
}

function providerCliPosture(provider: string, input: HostedAgentLaunchInput["provider_cli"]): ProviderCliPosture {
  const command = sanitizeCliCommand(input?.command, provider);
  const available = input?.available === false ? false : true;
  return {
    provider,
    command,
    available,
    status: available ? "available" : "missing",
    source: sanitizeShortText(input?.source, "local_workcell_contract"),
    version: null,
    path_returned: false,
    repair_action: available ? null : `Install or mount the ${command} CLI in the hosted workcell.`,
    checked_by: "local_launch_contract",
    exit_code: null
  };
}

function providerAuthPosture(provider: string, input: HostedAgentLaunchInput["provider_auth"]): ProviderAuthPosture {
  const envReference = process.env[`BITTERGIT_AGENT_AUTH_REF_${provider.toUpperCase()}`];
  const requestedStatus = normalizeAuthStatus(input?.status);
  const blocked = requestedStatus === "missing" || requestedStatus === "blocked" || requestedStatus === "not_configured";
  const referencePresent = Boolean(input?.credential_ref || input?.reference || input?.auth_file || envReference);
  const status = blocked ? "blocked" : "mounted";
  return {
    provider,
    source: sanitizeShortText(input?.source, referencePresent ? "factory_provider_auth_mount" : "local_dev_subscription_contract"),
    status,
    mount_status: blocked ? "missing" : "mounted",
    reference_present: referencePresent,
    reference_returned: false,
    credential_material_returned: false,
    auth_files_returned: false,
    includes_secret_value: false,
    checked_by: "local_launch_contract",
    bundle_present: false,
    bootstrap_status: status,
    secret_material_returned: false,
    repair_action: blocked
      ? sanitizeRepairAction(input?.repair_action, "Mount provider CLI subscription auth through Factory/Grid before launching this agent.")
      : null
  };
}

function readinessEvidence(
  session: HostedWorkcellSession,
  repo: Repository,
  cli: ProviderCliPosture,
  auth: ProviderAuthPosture,
  source?: SourceEvidence
): LaunchReadinessEvidence {
  const origin = source?.origin_remote ?? cloneUrl(repo.owner, repo.name);
  const sourceRoot = source?.source_root ?? session.source_root;
  const instructionsPath = join(sourceRoot, "AGENTS.md");
  const charterPath = join(sourceRoot, "APP.md");
  return {
    evidence_source: source?.evidence_source ?? "local_checkout",
    session_ready: session.status === "ready",
    source_root_exists: source?.source_root_exists ?? existsSync(sourceRoot),
    instructions_present: source?.instructions_present ?? existsSync(instructionsPath),
    charter_present: source?.charter_present ?? existsSync(charterPath),
    origin_remote_is_bittergit: isBitterGitRemote(origin, repo),
    origin_remote_has_token: source?.origin_remote_has_token ?? hasTokenMaterial(origin),
    provider_cli_available: cli.available,
    provider_auth_ready: auth.status === "mounted",
    git_credential_delivery: "run_scoped_credential_helper",
    terminal_url_has_token: hasTokenMaterial(session.terminal_url ?? ""),
    source_files_visible: source?.source_files_visible ?? ["AGENTS.md", "APP.md"].filter((file) => existsSync(join(sourceRoot, file))),
    grid_workcell_id: source?.grid_workcell_id ?? null,
    grid_execution_session_id: source?.grid_execution_session_id ?? null
  };
}

function launchContract(
  session: HostedWorkcellSession,
  provider: string,
  firstPrompt: string,
  refs: HostedAgentLaunchInput["launch_refs"]
): LaunchContract {
  return {
    provider,
    source_root: session.source_root,
    instructions_path: join(session.source_root, "AGENTS.md"),
    charter_path: join(session.source_root, "APP.md"),
    first_prompt: firstPrompt,
    implementation_before_charter: "blocked_until_app_md_has_product_intent_axes_and_verification_gates",
    expected_workflow: [
      "read AGENTS.md",
      "read APP.md",
      "ask or infer enough product intent to improve APP.md",
      "define axes of excellence and verification gates",
      "only then begin substantial implementation"
    ],
    runtime_refs: runtimeRefs(session, refs)
  };
}

function providerCliFromJson(value: string | null, provider: string): ProviderCliPosture {
  return parseJsonObject<ProviderCliPosture>(value) ?? providerCliPosture(provider, undefined);
}

function providerAuthFromJson(value: string | null, provider: string, status: string): ProviderAuthPosture {
  return parseJsonObject<ProviderAuthPosture>(value) ?? {
    provider,
    source: "legacy_launch_record",
    status,
    mount_status: status === "mounted" ? "mounted" : "unknown",
    reference_present: false,
    reference_returned: false,
    credential_material_returned: false,
    auth_files_returned: false,
    includes_secret_value: false,
    checked_by: "legacy_launch_record",
    bundle_present: false,
    bootstrap_status: status,
    secret_material_returned: false,
    repair_action: null
  };
}

function readinessEvidenceFromJson(value: string | null, launch: HostedAgentLaunch): LaunchReadinessEvidence {
  const repo = findRepositoryById(launch.repo_id);
  return parseJsonObject<LaunchReadinessEvidence>(value) ?? {
    evidence_source: "legacy_launch_record",
    session_ready: launch.status === "ready",
    source_root_exists: existsSync(launch.source_root),
    instructions_present: existsSync(launch.instructions_path),
    charter_present: existsSync(launch.charter_path),
    origin_remote_is_bittergit: isBitterGitRemote(launch.origin_remote, repo),
    origin_remote_has_token: hasTokenMaterial(launch.origin_remote),
    provider_cli_available: launch.status === "ready",
    provider_auth_ready: launch.status === "ready",
    git_credential_delivery: "run_scoped_credential_helper",
    terminal_url_has_token: false,
    source_files_visible: ["AGENTS.md", "APP.md"].filter((file) => existsSync(join(launch.source_root, file))),
    grid_workcell_id: null,
    grid_execution_session_id: null
  };
}

function launchContractFromJson(value: string | null, launch: HostedAgentLaunch): LaunchContract {
  return parseJsonObject<LaunchContract>(value) ?? {
    provider: launch.provider,
    source_root: launch.source_root,
    instructions_path: launch.instructions_path,
    charter_path: launch.charter_path,
    first_prompt: launch.first_task,
    implementation_before_charter: "blocked_until_app_md_has_product_intent_axes_and_verification_gates",
    expected_workflow: ["read AGENTS.md", "read APP.md", "establish charter before substantial implementation"],
    runtime_refs: {
      bittergit_session_id: launch.session_id,
      bittergit_workcell_id: null,
      bittergit_run_scope_ref: launch.run_scope_ref,
      factory_run_ref: null,
      grid_workcell_id: null,
      grid_execution_session_id: null,
      bitter_session_ref: null,
      bitter_log_ref: null
    }
  };
}

function parseJsonObject<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as T : undefined;
  } catch {
    return undefined;
  }
}

function normalizeAuthStatus(value: unknown): string {
  if (typeof value !== "string") return "mounted";
  const normalized = value.trim().toLowerCase();
  if (["missing", "blocked", "not_configured"].includes(normalized)) return normalized;
  return "mounted";
}

function sanitizeCliCommand(value: unknown, fallback: string): string {
  const command = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (command === "claude" || command === "codex") return command;
  return fallback === "claude" || fallback === "codex" ? fallback : "unknown";
}

function sanitizeShortText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, "_").slice(0, 80);
  return sanitized || fallback;
}

function sanitizeRepairAction(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const sanitized = value.replace(/\b(sk-|bgt_|ghp_|github_pat_|cred_|bitterpass:)[^\s]+/gi, "[redacted]").slice(0, 240);
  return sanitized.trim() || fallback;
}

async function providerPostureForLaunch(
  session: HostedWorkcellSession,
  repo: Repository,
  provider: string,
  input: HostedAgentLaunchInput
): Promise<{ cli: ProviderCliPosture; auth: ProviderAuthPosture; source: SourceEvidence }> {
  const fulfillment = terminalFulfillmentFromSession(session);
  if (fulfillment.provider !== "bittergrid_api") {
    return localProviderPosture(session, repo, provider, input);
  }

  const readiness = await requestGridProviderReadiness({
    provider,
    workcell_id: fulfillment.grid_workcell_id,
    execution_session_id: fulfillment.grid_execution_session_id,
    source_root: fulfillment.source_root || session.source_root,
    origin_remote: cloneUrl(repo.owner, repo.name),
    provider_auth: input.provider_auth
  });
  return {
    cli: readiness.cli,
    auth: readiness.auth,
    source: readiness.source
  };
}

function localProviderPosture(
  session: HostedWorkcellSession,
  repo: Repository,
  provider: string,
  input: HostedAgentLaunchInput
): { cli: ProviderCliPosture; auth: ProviderAuthPosture; source: SourceEvidence } {
  const sourceRoot = session.source_root;
  const origin = cloneUrl(repo.owner, repo.name);
  return {
    cli: providerCliPosture(provider, input.provider_cli),
    auth: providerAuthPosture(provider, input.provider_auth),
    source: {
      evidence_source: "local_checkout",
      source_root: sourceRoot,
      source_root_exists: existsSync(sourceRoot),
      instructions_present: existsSync(join(sourceRoot, "AGENTS.md")),
      charter_present: existsSync(join(sourceRoot, "APP.md")),
      origin_remote: origin,
      origin_remote_has_token: hasTokenMaterial(origin),
      source_files_visible: ["AGENTS.md", "APP.md"].filter((file) => existsSync(join(sourceRoot, file))),
      grid_workcell_id: null,
      grid_execution_session_id: null
    }
  };
}

function terminalFulfillmentFromSession(session: HostedWorkcellSession): Partial<GridTerminalFulfillment> {
  if (!session.terminal_fulfillment_json) return {};
  try {
    const parsed = JSON.parse(session.terminal_fulfillment_json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Partial<GridTerminalFulfillment>
      : {};
  } catch {
    return {};
  }
}

function runtimeRefs(session: HostedWorkcellSession, refs: HostedAgentLaunchInput["launch_refs"]): Record<string, string | null> {
  const fulfillment = terminalFulfillmentFromSession(session);
  return {
    bittergit_session_id: session.id,
    bittergit_workcell_id: session.workcell_id,
    bittergit_run_scope_ref: `agent_launch:${session.id}`,
    factory_run_ref: sanitizeOptionalRef(refs?.factory_run_ref),
    grid_workcell_id: sanitizeOptionalRef(fulfillment.grid_workcell_id),
    grid_execution_session_id: sanitizeOptionalRef(fulfillment.grid_execution_session_id),
    bitter_session_ref: sanitizeOptionalRef(refs?.bitter_session_ref),
    bitter_log_ref: sanitizeOptionalRef(refs?.bitter_log_ref)
  };
}

function sanitizeOptionalRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || hasTokenMaterial(trimmed)) return null;
  return trimmed.replace(/[^a-zA-Z0-9_.:/-]/g, "_").slice(0, 160);
}

export function isBitterGitRemote(
  value: string,
  repo?: Pick<Repository, "owner" | "name">
): boolean {
  if (!value || !repo || hasTokenMaterial(value)) return false;
  try {
    const candidate = new URL(value);
    const expected = new URL(cloneUrl(repo.owner, repo.name));
    return !candidate.username
      && !candidate.password
      && !candidate.search
      && !candidate.hash
      && candidate.protocol === expected.protocol
      && candidate.host === expected.host
      && candidate.pathname.replace(/\/+$/, "") === expected.pathname.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

function hasTokenMaterial(value: unknown): boolean {
  return typeof value === "string" && /\b(token|bgt_|sk-|ghp_|github_pat_|bearer\s+|x-access-token|oauth2:)/i.test(value);
}

function launchColumns(): string {
  return `
    id, session_id, app_id, repo_id, account_ref, workspace_ref, provider,
    status, source_root, origin_remote, instructions_path, charter_path,
    first_task, run_scope_ref, git_token_ref, provider_auth_status,
    provider_auth_ref, provider_cli_json, provider_auth_json,
    readiness_evidence_json, launch_contract_json, readiness_state,
    failure_reason, repair_action, launch_message, created_at, updated_at
  `;
}
