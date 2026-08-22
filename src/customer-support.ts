import type { AccountAssertion } from "./assertions";
import { planSummary } from "./assertions";
import { findAccountAppById } from "./apps";
import { findSetupStateForApp, setupStateSupportJson } from "./app-bundles";
import { listCharterFirstRunsForRepo } from "./charter-first-runs";
import { listDeployments, listReceipts } from "./deployments";
import { listGridPublishRequestsForRepo } from "./grid-publish";
import { listHostedAgentLaunchesForRepo } from "./agent-launches";
import { listHostedWorkcellSessionsForRepo } from "./hosted-sessions";
import { findRepositoryById, repoToJson } from "./repos";
import {
  listSecretGrantRequestsForRepo,
  listSecretMaterializationRequestsForRepo,
  secretMaterializationReadinessForRepo
} from "./secret-grants";
import { listSecretRefs } from "./secrets";
import { productionSshFromJson, productionSshSupportJson } from "./production-ssh";
import { isRecord, supportImportSummary, supportSourceContract } from "./support-projection";

type RepairItem = {
  plane: string;
  subject: string;
  status: string;
  repair_action: string;
};

export function customerAppSupportDebug(assertion: AccountAssertion, appId: string): Record<string, unknown> {
  const app = findAccountAppById(appId);
  if (!app || app.account_ref !== assertion.account_ref) throw new Error("app not found");
  const repo = findRepositoryById(app.repo_id);
  if (!repo) throw new Error("app repository missing");

  const setup = findSetupStateForApp(app.id);
  const setupJson = setup ? setupStateSupportJson(setup) : null;
  const receipts = listReceipts(repo) as Array<Record<string, unknown>>;
  const sessions = listHostedWorkcellSessionsForRepo(repo);
  const launches = listHostedAgentLaunchesForRepo(repo);
  const firstRuns = listCharterFirstRunsForRepo(repo);
  const secretRefs = listSecretRefs(repo);
  const secretGrants = listSecretGrantRequestsForRepo(repo);
  const secretMaterializations = listSecretMaterializationRequestsForRepo(repo);
  const deployments = listDeployments(repo);
  const gridPublishes = listGridPublishRequestsForRepo(repo);
  const latestSession = sessions.at(-1);
  const repairItems = [
    ...setupRepair(setupJson),
    ...terminalRepair(sessions),
    ...agentRepair(launches),
    ...charterRepair(firstRuns),
    ...gridPublishRepair(gridPublishes)
  ];

  return {
    account: {
      account_ref: app.account_ref,
      workspace_ref: app.workspace_ref
    },
    plan: planSummary(assertion, 1),
    app: {
      id: app.id,
      app_slug: app.app_slug,
      status: app.status,
      source_posture: app.source_posture
    },
    repo: repoToJson(repo),
    setup: setupJson ? {
      status: setupJson.status,
      current_step: setupJson.current_step,
      progress_percent: setupJson.progress_percent,
      repairable: setupJson.repairable,
      repair_action: setupJson.repair_action
    } : null,
    import: importSummary(receipts),
    workcell: {
      hosted_session_count: sessions.length,
      ready_count: sessions.filter((session) => session.status === "ready").length,
      revoked_count: sessions.filter((session) => session.status === "revoked").length,
      production_ssh_latest: latestSession
        ? productionSshSupportJson(productionSshFromJson(latestSession.production_ssh_json), latestSession.status)
        : null
    },
    terminal: {
      latest_status: sessions.at(-1)?.terminal_status ?? "not_requested",
      latest_lifecycle: sessions.at(-1)?.terminal_lifecycle ?? null,
      terminal_url_present: Boolean(sessions.at(-1)?.terminal_url),
      token_in_url: false
    },
    agent: {
      launch_count: launches.length,
      ready_count: launches.filter((launch) => launch.status === "ready").length,
      blocked_count: launches.filter((launch) => launch.status === "blocked").length,
      latest_first_task: launches.at(-1)?.first_task ?? null
    },
    charter_first_run: {
      count: firstRuns.length,
      ready_for_implementation_count: firstRuns.filter((run) => run.status === "ready_for_implementation").length,
      charter_required_count: firstRuns.filter((run) => run.status === "charter_required").length,
      implementation_allowed: firstRuns.some((run) => run.substantial_implementation_allowed === 1)
    },
    secret: {
      secret_ref_count: secretRefs.length,
      active_secret_ref_count: secretRefs.filter((ref) => !ref.revoked_at).length,
      grant_count: secretGrants.length,
      delegated_to_bitterpass_count: secretGrants.filter((grant) => grant.materialization_status === "delegated_to_bitterpass").length,
      materialization_request_count: secretMaterializations.length,
      workcell_materialization_count: secretMaterializations.filter((request) => request.target_plane === "workcell").length,
      deploy_materialization_count: secretMaterializations.filter((request) => request.target_plane === "deploy").length,
      materialization_readiness: secretMaterializationReadinessForRepo(repo, "production", app.id),
      values_stored_in_bittergit: false
    },
    deploy: {
      deployment_count: deployments.length,
      grid_publish_count: gridPublishes.length,
      verified_count: gridPublishes.filter((publish) => publish.status === "verified").length,
      repair_required_count: gridPublishes.filter((publish) => publish.status === "repair_required").length,
      latest_commit_sha: gridPublishes.at(-1)?.commit_sha ?? null,
      latest_restore_candidate: gridPublishes.at(-1)?.checkpoint_id ? {
        checkpoint_id: gridPublishes.at(-1)?.checkpoint_id,
        commit_sha: gridPublishes.at(-1)?.commit_sha,
        deployment_id: gridPublishes.at(-1)?.deployment_id
      } : null,
      private_logs_included: false
    },
    repair: {
      overall_status: repairItems.length > 0 ? "needs_repair" : "ready",
      item_count: repairItems.length,
      items: repairItems
    },
    support_policy: {
      includes_secret_values: false,
      includes_tokens: false,
      includes_credential_refs: false,
      includes_raw_file_contents: false,
      includes_private_logs: false,
      requires_ssh: false
    }
  };
}

function importSummary(receipts: Array<Record<string, unknown>>): Record<string, unknown> {
  const gitReceipt = receipts.find((receipt) => receipt.receipt_type === "git_import_app_setup");
  if (gitReceipt) {
    const body = gitReceipt.body as Record<string, unknown>;
    const summary = body.import_summary as Record<string, unknown> | undefined;
    const projected = supportImportSummary({
      ...(summary ?? {}),
      source_contract: summary?.source_contract ?? body.source_contract
    });
    return {
      ...projected,
      source_kind: "git_url_import",
      source_contract: projected?.source_contract ?? supportSourceContract(body.source_contract),
      blocked_count: Array.isArray(summary?.blocked) ? summary.blocked.length : 0,
      skip_count: Array.isArray(summary?.skipped) ? summary.skipped.length : 0,
      context_files: null,
      context_files_configured: isRecord(summary?.context_files) || isRecord(body.context_files),
      context_files_returned: false
    };
  }

  const artifactReceipt = receipts.find((receipt) => receipt.receipt_type === "artifact_app_setup");
  if (!artifactReceipt) {
    const appReceipt = receipts.find((receipt) => receipt.receipt_type === "app_setup");
    const body = appReceipt?.body as Record<string, unknown> | undefined;
    return {
      source_kind: "blank_app",
      artifact_import_id: null,
      detected_shape: null,
      import_count: 0,
      skip_count: 0,
      blocked_count: 0,
      context_files: null,
      context_files_configured: isRecord(body?.context_files),
      context_files_returned: false
    };
  }

  const body = artifactReceipt.body as Record<string, unknown>;
  const summary = body.import_summary as Record<string, unknown> | undefined;
  return {
    source_kind: "artifact_import",
    artifact_import_id: body.artifact_import_id ?? null,
    detected_shape: body.detected_shape ?? null,
    import_count: summary?.import_count ?? null,
    skip_count: summary?.skip_count ?? null,
    blocked_count: summary?.blocked_count ?? null,
    context_files: null,
    context_files_configured: isRecord(body.context_files),
    context_files_returned: false
  };
}

function setupRepair(setup: Record<string, unknown> | null): RepairItem[] {
  if (!setup || setup.status === "ready") return [];
  return [{
    plane: "BitterGit",
    subject: "app_setup",
    status: String(setup.status),
    repair_action: String(setup.repair_action ?? "Retry app setup or inspect setup events.")
  }];
}

function terminalRepair(sessions: Array<{ id: string; status: string; terminal_status: string; terminal_message: string | null }>): RepairItem[] {
  return sessions
    .filter((session) => session.status !== "ready" || session.terminal_status !== "ready")
    .map((session) => ({
      plane: "BitterGrid",
      subject: `terminal:${session.id}`,
      status: session.terminal_status,
      repair_action: "Retry terminal fulfillment or use the BitterGrid support workflow."
    }));
}

function agentRepair(launches: Array<{ id: string; status: string; repair_action: string | null }>): RepairItem[] {
  return launches
    .filter((launch) => launch.status === "blocked")
    .map((launch) => ({
      plane: "Factory",
      subject: `agent_launch:${launch.id}`,
      status: "blocked",
      repair_action: "Repair provider readiness through the owner-plane support workflow, then retry the launch."
    }));
}

function charterRepair(firstRuns: Array<{ id: string; status: string; repair_action: string | null }>): RepairItem[] {
  return firstRuns
    .filter((run) => run.status !== "ready_for_implementation")
    .map((run) => ({
      plane: "CustomerApp",
      subject: `charter_first_run:${run.id}`,
      status: run.status,
      repair_action: run.repair_action ?? "Complete APP.md and record charter sufficiency."
    }));
}

function gridPublishRepair(publishes: Array<{ id: string; status: string; repair_action: string | null }>): RepairItem[] {
  return publishes
    .filter((publish) => publish.status === "repair_required")
    .map((publish) => ({
      plane: "BitterGrid",
      subject: `grid_publish:${publish.id}`,
      status: publish.status,
      repair_action: "Retry publish through the BitterGrid support workflow."
    }));
}
