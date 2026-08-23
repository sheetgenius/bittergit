import { randomUUID } from "node:crypto";
import { ensureStorage } from "./storage";
import type { AccountAssertion } from "./assertions";
import { createCustomerApp, type AccountApp } from "./apps";
import type { Repository } from "./repos";
import { initializeBlankAppSource, listSourceFiles } from "./blank-app";
import { createCheckpoint, type Checkpoint } from "./checkpoints";
import { createSourceReceipt } from "./deployments";
import type { ContextFileReport } from "./agent-context";

export type AppSetupState = {
  id: string;
  app_id: string;
  repo_id: string;
  status: string;
  current_step: string;
  steps_json: string;
  error: string | null;
  receipt_id: string | null;
  checkpoint_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AppSetupEvent = {
  id: string;
  app_id: string;
  repo_id: string;
  status: string;
  step: string;
  message: string;
  created_at: string;
};

export function createAppBundle(assertion: AccountAssertion, input: { name?: string; display_name?: string | null }): {
  app: AccountApp;
  repo: Repository;
  tokens: unknown;
  setup_state: Record<string, unknown>;
  checkpoint: Checkpoint;
  receipt: Record<string, unknown>;
  source_tree: string[];
  context_files: ContextFileReport;
  existing: boolean;
} {
  const result = createCustomerApp(assertion, input);
  const { app, repo } = result;
  writeSetupState(app, repo, "in_progress", "repo_created", [
    setupStep("account_app", "done"),
    setupStep("bittergit_repo", "done"),
    setupStep("blank_source", "pending"),
    setupStep("initial_checkpoint", "pending"),
    setupStep("setup_receipt", "pending")
  ], null, null, null, "Created account app record and BitterGit repository.");

  try {
    const source = initializeBlankAppSource(repo);
    writeSetupState(app, repo, "in_progress", "blank_source", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("blank_source", "done"),
      setupStep("initial_checkpoint", "pending"),
      setupStep("setup_receipt", "pending")
    ], null, null, null, "Created blank source scaffold.");

    const checkpointResult = createCheckpoint(repo, {
      label: "Blank app scaffold",
      checkpoint_type: "app_bundle_initial",
      actor: "system:app-bundle",
      ref: "refs/heads/main"
    });
    const checkpoint = checkpointResult.checkpoint;
    writeSetupState(app, repo, "in_progress", "initial_checkpoint", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("blank_source", "done"),
      setupStep("initial_checkpoint", "done"),
      setupStep("setup_receipt", "pending")
    ], null, null, checkpoint.id, "Created initial checkpoint.");

    const receipt = createSourceReceipt(repo, "app_setup", {
      app_id: app.id,
      account_ref: app.account_ref,
      workspace_ref: app.workspace_ref,
      repo_id: repo.id,
      commit_sha: source.commit_sha,
      checkpoint_id: checkpoint.id,
      source_tree: source.files,
      context_files: source.context_files,
      github_required: false,
      setup_status: "ready"
    });

    const setupState = writeSetupState(app, repo, "ready", "setup_complete", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("blank_source", "done"),
      setupStep("initial_checkpoint", "done"),
      setupStep("setup_receipt", "done")
    ], null, String(receipt.id), checkpoint.id, "Setup receipt recorded. App bundle is ready.");

    return {
      app,
      repo,
      tokens: result.tokens,
      setup_state: setupStateToJson(setupState),
      checkpoint,
      receipt,
      source_tree: source.files,
      context_files: source.context_files,
      existing: result.existing
    };
  } catch (error) {
    writeSetupState(app, repo, "repair_required", "failed", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("blank_source", "unknown"),
      setupStep("initial_checkpoint", "unknown"),
      setupStep("setup_receipt", "unknown")
    ], error instanceof Error ? error.message : "unknown setup failure", null, null, "Setup failed and needs repair.");
    throw error;
  }
}

export function findSetupStateForRepo(repo: Repository): AppSetupState | undefined {
  return ensureStorage().query<AppSetupState, [string]>(`
    SELECT id, app_id, repo_id, status, current_step, steps_json, error, receipt_id,
           checkpoint_id, created_at, updated_at
    FROM app_setup_states
    WHERE repo_id = ?
  `).get(repo.id) ?? undefined;
}

export function findSetupStateForApp(appId: string): AppSetupState | undefined {
  return ensureStorage().query<AppSetupState, [string]>(`
    SELECT id, app_id, repo_id, status, current_step, steps_json, error, receipt_id,
           checkpoint_id, created_at, updated_at
    FROM app_setup_states
    WHERE app_id = ?
  `).get(appId) ?? undefined;
}

export function setupStateToJson(state: AppSetupState): Record<string, unknown> {
  const steps = JSON.parse(state.steps_json) as Array<Record<string, string>>;
  const done = steps.filter((entry) => entry.status === "done").length;
  const total = steps.length || 1;
  return {
    id: state.id,
    app_id: state.app_id,
    repo_id: state.repo_id,
    status: state.status,
    current_step: state.current_step,
    progress_percent: Math.round((done / total) * 100),
    steps,
    events: listSetupEventsForApp(state.app_id),
    repairable: state.status === "repair_required",
    repair_action: state.status === "repair_required"
      ? "Retry app bundle setup from the persisted account app and BitterGit repo."
      : "No repair needed.",
    user_message: state.status === "ready"
      ? "App source is ready. Open the terminal and establish the charter in APP.md."
      : state.status === "repair_required"
        ? "Setup needs repair before the terminal is opened."
        : "App setup is in progress.",
    error: state.error,
    receipt_id: state.receipt_id,
    checkpoint_id: state.checkpoint_id,
    created_at: state.created_at,
    updated_at: state.updated_at
  };
}

export function setupProgressToJson(state: AppSetupState): Record<string, unknown> {
  const setup = setupStateToJson(state);
  const steps = Array.isArray(setup.steps) ? setup.steps as Array<Record<string, unknown>> : [];
  const events = Array.isArray(setup.events) ? setup.events as Array<Record<string, unknown>> : [];
  return {
    app_id: state.app_id,
    repo_id: state.repo_id,
    status: state.status,
    current_step: state.current_step,
    progress_percent: setup.progress_percent,
    polling: {
      mode: "stable_poll",
      poll_after_ms: state.status === "ready" || state.status === "repair_required" ? null : 1000
    },
    steps: steps.map((step) => setupProgressStep(step, state.status)),
    events: events.map(setupProgressEvent),
    owner_plane: ownerPlaneForStep(state.current_step),
    repairable: setup.repairable,
    repair_action: setup.repair_action,
    user_message: setup.user_message,
    includes_token_material: false,
    includes_secret_values: false,
    includes_raw_source_contents: false,
    includes_private_logs: false,
    updated_at: state.updated_at
  };
}

export function setupStateSupportJson(state: AppSetupState): Record<string, unknown> {
  const steps = supportSetupSteps(state);
  const done = steps.filter((entry) => entry.status === "done").length;
  const total = steps.length || 1;
  return {
    id: state.id,
    app_id: state.app_id,
    repo_id: state.repo_id,
    status: supportSetupStatus(state.status),
    current_step: supportSetupStep(state.current_step),
    progress_percent: Math.round((done / total) * 100),
    steps,
    events: supportSetupEvents(state),
    repairable: state.status === "repair_required",
    repair_action: supportSetupRepairAction(state),
    user_message: supportSetupUserMessage(state),
    error: null,
    error_present: Boolean(state.error),
    error_details_returned: false,
    receipt_id: state.receipt_id,
    checkpoint_id: state.checkpoint_id,
    created_at: state.created_at,
    updated_at: state.updated_at,
    projection: "support_safe_v1"
  };
}

export function setupProgressSupportJson(state: AppSetupState): Record<string, unknown> {
  const setup = setupStateSupportJson(state);
  return {
    app_id: state.app_id,
    repo_id: state.repo_id,
    status: setup.status,
    current_step: setup.current_step,
    progress_percent: setup.progress_percent,
    polling: {
      mode: "stable_poll",
      poll_after_ms: state.status === "ready" || state.status === "repair_required" ? null : 1000
    },
    steps: setup.steps,
    events: setup.events,
    owner_plane: ownerPlaneForStep(state.current_step),
    repairable: setup.repairable,
    repair_action: setup.repair_action,
    user_message: setup.user_message,
    error_present: setup.error_present,
    error_details_returned: false,
    includes_token_material: false,
    includes_secret_values: false,
    includes_raw_source_contents: false,
    includes_private_logs: false,
    updated_at: state.updated_at,
    projection: "support_safe_v1"
  };
}

export function listSetupEventsForApp(appId: string): AppSetupEvent[] {
  return ensureStorage().query<AppSetupEvent, [string]>(`
    SELECT id, app_id, repo_id, status, step, message, created_at
    FROM app_setup_events
    WHERE app_id = ?
    ORDER BY created_at ASC
  `).all(appId);
}

function setupProgressStep(step: Record<string, unknown>, setupStatus: string): Record<string, unknown> {
  const key = String(step.name ?? "");
  const status = String(step.status ?? "unknown");
  return {
    key,
    label: labelForStep(key),
    status,
    owner_plane: ownerPlaneForStep(key),
    repair_action: setupStatus === "repair_required" && status !== "done"
      ? repairActionForStep(key)
      : null
  };
}

function setupProgressEvent(event: Record<string, unknown>): Record<string, unknown> {
  const step = String(event.step ?? "");
  return {
    step,
    label: labelForStep(step),
    status: String(event.status ?? ""),
    owner_plane: ownerPlaneForStep(step),
    message: String(event.message ?? ""),
    repair_action: String(event.status ?? "") === "repair_required" ? repairActionForStep(step) : null,
    created_at: event.created_at
  };
}

function supportSetupSteps(state: AppSetupState): Array<Record<string, unknown>> {
  let steps: unknown = [];
  try {
    steps = JSON.parse(state.steps_json);
  } catch {
    steps = [];
  }
  if (!Array.isArray(steps)) return [];
  return steps
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map((entry) => {
      const key = supportSetupStep(String(entry.name ?? ""));
      const status = supportSetupStatus(String(entry.status ?? "unknown"));
      return {
        key,
        label: labelForStep(key),
        status,
        owner_plane: ownerPlaneForStep(key),
        repair_action: state.status === "repair_required" && status !== "done"
          ? repairActionForStep(key)
          : null
      };
    });
}

function supportSetupEvents(state: AppSetupState): Array<Record<string, unknown>> {
  return listSetupEventsForApp(state.app_id).map((event) => {
    const step = supportSetupStep(event.step);
    const status = supportSetupStatus(event.status);
    return {
      step,
      label: labelForStep(step),
      status,
      owner_plane: ownerPlaneForStep(step),
      message: supportSetupEventMessage(status),
      repair_action: status === "repair_required" ? repairActionForStep(step) : null,
      created_at: event.created_at
    };
  });
}

function supportSetupStep(value: string): string {
  return [
    "account_app",
    "bittergit_repo",
    "blank_source",
    "artifact_import_review",
    "git_import",
    "imported_source",
    "charter_scaffold",
    "initial_checkpoint",
    "setup_receipt",
    "setup_complete",
    "repo_created",
    "failed"
  ].includes(value) ? value : "unknown";
}

function supportSetupStatus(value: string): string {
  return ["ready", "in_progress", "repair_required", "done", "pending", "unknown"].includes(value)
    ? value
    : "unknown";
}

function supportSetupRepairAction(state: AppSetupState): string {
  return state.status === "repair_required"
    ? "Retry app bundle setup from the persisted account app and BitterGit repo."
    : "No repair needed.";
}

function supportSetupUserMessage(state: AppSetupState): string {
  if (state.status === "ready") return "App source is ready. Open the terminal and establish the charter in APP.md.";
  if (state.status === "repair_required") return "Setup needs repair before the terminal is opened.";
  return "App setup is in progress.";
}

function supportSetupEventMessage(status: string): string {
  if (status === "ready" || status === "done") return "Setup step completed.";
  if (status === "repair_required") return "Setup step needs repair.";
  return "Setup step status updated.";
}

function labelForStep(step: string): string {
  const labels: Record<string, string> = {
    account_app: "Bitter account app",
    bittergit_repo: "Source repository",
    blank_source: "Starter files",
    artifact_import_review: "Import review",
    git_import: "Git source import",
    imported_source: "Imported files",
    charter_scaffold: "Charter files",
    initial_checkpoint: "First saved version",
    setup_receipt: "Setup receipt",
    setup_complete: "Setup complete",
    repo_created: "Source repository"
  };
  return labels[step] ?? "Setup step";
}

function ownerPlaneForStep(step: string): string {
  if (step === "account_app" || step === "artifact_import_review") return "Factory";
  if (step === "blank_source" || step === "git_import" || step === "imported_source" || step === "charter_scaffold" || step === "initial_checkpoint" || step === "setup_receipt" || step === "bittergit_repo" || step === "repo_created" || step === "setup_complete") return "BitterGit";
  return "BitterGit";
}

function repairActionForStep(step: string): string {
  if (step === "account_app") return "Refresh the Bitter account plan assertion and retry app setup.";
  if (step === "artifact_import_review") return "Review and repair blocked artifact files before creating the app.";
  if (step === "git_import") return "Verify the public Git URL is reachable without credentials, then retry Git import.";
  if (step === "charter_scaffold") return "Retry charter scaffold insertion after checking repository default branch state.";
  if (step === "blank_source" || step === "imported_source") return "Retry source scaffold creation after checking blocked files and repository state.";
  if (step === "initial_checkpoint") return "Retry checkpoint creation after verifying the repository has a valid main branch.";
  if (step === "setup_receipt") return "Retry setup receipt recording; source custody remains in BitterGit.";
  return "Retry app setup or inspect support-debug for the failed owner plane.";
}

export function sourceTreeForRepo(repo: Repository): string[] {
  return listSourceFiles(repo);
}

export function writeSetupState(
  app: AccountApp,
  repo: Repository,
  status: string,
  currentStep: string,
  steps: Array<Record<string, string>>,
  error: string | null = null,
  receiptId: string | null = null,
  checkpointId: string | null = null,
  message: string | null = null
): AppSetupState {
  const existing = findSetupStateForApp(app.id);
  const now = new Date().toISOString();
  const state: AppSetupState = {
    id: existing?.id ?? `setup_${randomUUID()}`,
    app_id: app.id,
    repo_id: repo.id,
    status,
    current_step: currentStep,
    steps_json: JSON.stringify(steps),
    error,
    receipt_id: receiptId ?? existing?.receipt_id ?? null,
    checkpoint_id: checkpointId ?? existing?.checkpoint_id ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now
  };

  ensureStorage().query(`
    INSERT INTO app_setup_states
      (id, app_id, repo_id, status, current_step, steps_json, error,
       receipt_id, checkpoint_id, created_at, updated_at)
    VALUES
      ($id, $app_id, $repo_id, $status, $current_step, $steps_json, $error,
       $receipt_id, $checkpoint_id, $created_at, $updated_at)
    ON CONFLICT(app_id) DO UPDATE SET
      status = excluded.status,
      current_step = excluded.current_step,
      steps_json = excluded.steps_json,
      error = excluded.error,
      receipt_id = excluded.receipt_id,
      checkpoint_id = excluded.checkpoint_id,
      updated_at = excluded.updated_at
  `).run({
    $id: state.id,
    $app_id: state.app_id,
    $repo_id: state.repo_id,
    $status: state.status,
    $current_step: state.current_step,
    $steps_json: state.steps_json,
    $error: state.error,
    $receipt_id: state.receipt_id,
    $checkpoint_id: state.checkpoint_id,
    $created_at: state.created_at,
    $updated_at: state.updated_at
  });

  if (message) {
    ensureStorage().query(`
      INSERT INTO app_setup_events
        (id, app_id, repo_id, status, step, message, created_at)
      VALUES
        ($id, $app_id, $repo_id, $status, $step, $message, $created_at)
    `).run({
      $id: `setup_evt_${randomUUID()}`,
      $app_id: app.id,
      $repo_id: repo.id,
      $status: state.status,
      $step: state.current_step,
      $message: message,
      $created_at: now
    });
  }

  return findSetupStateForApp(app.id) as AppSetupState;
}

export function setupStep(name: string, status: string): Record<string, string> {
  return { name, status };
}
