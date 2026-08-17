import { randomUUID } from "node:crypto";
import type { AccountAssertion } from "./assertions";
import { findAccountAppById } from "./apps";
import { findCheckpoint, findCheckpointForCommit } from "./checkpoints";
import {
  createDeployment,
  createSourceReceipt,
  createVerification,
  findDeployment
} from "./deployments";
import { findRepositoryById, type Repository } from "./repos";
import { ensureStorage } from "./storage";

export type GridPublishRequest = {
  id: string;
  app_id: string;
  repo_id: string;
  account_ref: string;
  workspace_ref: string;
  deployment_id: string;
  checkpoint_id: string | null;
  commit_sha: string;
  environment: string;
  status: string;
  grid_operation_ref: string;
  preview_url: string | null;
  verification_status: string | null;
  repair_action: string | null;
  owner_plane: string;
  grid_receipt_id: string | null;
  callback_status: string | null;
  callback_received_at: string | null;
  grid_callback_json: string | null;
  created_at: string;
  updated_at: string;
};

export function createGridPublishRequest(
  assertion: AccountAssertion,
  appId: string,
  input: {
    commit_sha?: string;
    checkpoint_id?: string | null;
    environment?: string;
    simulate_status?: string;
    verification_status?: string;
    callback_mode?: boolean;
  }
): GridPublishRequest {
  const { app, repo } = requireAssertedApp(assertion, appId);
  const commitSha = requiredString(input.commit_sha, "commit_sha");
  const environment = normalizeEnvironment(input.environment ?? "preview");
  const checkpoint = input.checkpoint_id
    ? findCheckpoint(repo, input.checkpoint_id)
    : findCheckpointForCommit(repo, commitSha);
  if (input.checkpoint_id && !checkpoint) throw new Error("checkpoint not found");
  const deploymentResult = createDeployment(repo, {
    commit_sha: commitSha,
    checkpoint_id: checkpoint?.id ?? null,
    environment
  });
  const deployment = deploymentResult.deployment;
  const now = new Date().toISOString();
  const callbackMode = input.callback_mode === true;
  const simulated = callbackMode ? "awaiting_callback" : input.simulate_status === "failed" ? "failed" : "published";
  const verificationStatus = simulated === "failed" ? "not_run" : simulated === "awaiting_callback" ? null : normalizeVerification(input.verification_status ?? "passed");
  const request: GridPublishRequest = {
    id: `grid_publish_${randomUUID()}`,
    app_id: app.id,
    repo_id: repo.id,
    account_ref: app.account_ref,
    workspace_ref: app.workspace_ref,
    deployment_id: deployment.id,
    checkpoint_id: deployment.checkpoint_id,
    commit_sha: deployment.commit_sha,
    environment,
    status: simulated === "failed" ? "repair_required" : simulated === "awaiting_callback" ? "awaiting_grid_callback" : "verified",
    grid_operation_ref: `bittergrid://publish/${deployment.id}`,
    preview_url: simulated === "failed" || simulated === "awaiting_callback" ? null : previewUrl(app.app_slug, deployment.id),
    verification_status: verificationStatus,
    repair_action: simulated === "failed"
      ? "BitterGrid publish failed in the local contract. Retry publish after checking build/deploy configuration; source custody remains intact."
      : null,
    owner_plane: "BitterGrid",
    grid_receipt_id: null,
    callback_status: simulated === "awaiting_callback" ? "pending" : "local_simulation",
    callback_received_at: null,
    grid_callback_json: null,
    created_at: now,
    updated_at: now
  };
  insertGridPublishRequest(request);

  if (simulated === "published" && verificationStatus) {
    createVerification(repo, deployment, {
      status: verificationStatus,
      summary: `BitterGrid local publish contract verified ${environment} for ${deployment.commit_sha}.`
    });
  }

  createSourceReceipt(repo, "grid_publish", {
    grid_publish_request_id: request.id,
    app_id: app.id,
    repo_id: repo.id,
    deployment_id: deployment.id,
    commit_sha: deployment.commit_sha,
    checkpoint_id: deployment.checkpoint_id,
    environment,
    status: request.status,
    owner_plane: request.owner_plane,
    grid_operation_ref: request.grid_operation_ref,
    preview_url: request.preview_url,
    verification_status: request.verification_status,
    repair_action: request.repair_action,
    grid_receipt_id: request.grid_receipt_id,
    callback_status: request.callback_status,
    private_logs_included: false
  });

  return findGridPublishRequest(assertion, appId, request.id) as GridPublishRequest;
}

export function recordGridPublishCallback(
  requestId: string,
  input: {
    grid_operation_ref?: string;
    commit_sha?: string;
    status?: string;
    published_url?: string;
    verification_status?: string;
    grid_receipt_id?: string;
    private_logs?: unknown;
    logs?: unknown;
  }
): { request: GridPublishRequest; receipt: Record<string, unknown> } {
  if (input.private_logs !== undefined || input.logs !== undefined) {
    throw new Error("private deploy logs are not accepted by BitterGit callbacks");
  }

  const existing = findGridPublishRequestById(requestId);
  if (!existing) throw new Error("Grid publish request not found");
  if (input.grid_operation_ref && input.grid_operation_ref !== existing.grid_operation_ref) {
    throw new Error("grid_operation_ref does not match request");
  }
  if (input.commit_sha && input.commit_sha !== existing.commit_sha) {
    throw new Error("callback commit_sha does not match request");
  }

  const repo = findRepositoryById(existing.repo_id);
  if (!repo) throw new Error("app repository missing");
  const deployment = findDeployment(repo, existing.deployment_id);
  if (!deployment) throw new Error("deployment missing");

  const callbackStatus = normalizeCallbackStatus(input.status ?? "verified");
  const verificationStatus = callbackStatus === "verified"
    ? normalizeVerification(input.verification_status ?? "passed")
    : "failed";
  const publishedUrl = callbackStatus === "verified"
    ? normalizePublishedUrl(input.published_url ?? previewUrl(existing.app_id, existing.deployment_id))
    : null;
  const gridReceiptId = sanitizeGridReceiptId(input.grid_receipt_id ?? `grid_receipt_${randomUUID()}`);
  const now = new Date().toISOString();
  const repairAction = callbackStatus === "verified"
    ? null
    : "BitterGrid callback reported publish or verification failure. Inspect Grid-owned build/deploy logs and retry after repair.";
  const callback = {
    status: callbackStatus,
    verification_status: verificationStatus,
    published_url_present: Boolean(publishedUrl),
    grid_receipt_id: gridReceiptId,
    owner_plane: "BitterGrid",
    private_logs_included: false
  };

  ensureStorage().query(`
    UPDATE grid_publish_requests
    SET status = $status,
        preview_url = $preview_url,
        verification_status = $verification_status,
        repair_action = $repair_action,
        grid_receipt_id = $grid_receipt_id,
        callback_status = $callback_status,
        callback_received_at = $callback_received_at,
        grid_callback_json = $grid_callback_json,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: existing.id,
    $status: callbackStatus === "verified" ? "verified" : "repair_required",
    $preview_url: publishedUrl,
    $verification_status: verificationStatus,
    $repair_action: repairAction,
    $grid_receipt_id: gridReceiptId,
    $callback_status: callbackStatus,
    $callback_received_at: now,
    $grid_callback_json: JSON.stringify(callback),
    $updated_at: now
  });

  createVerification(repo, deployment, {
    status: verificationStatus,
    summary: `BitterGrid callback recorded ${callbackStatus} for ${existing.environment} at ${existing.commit_sha}.`
  });

  const receipt = createSourceReceipt(repo, "grid_publish_callback", {
    grid_publish_request_id: existing.id,
    app_id: existing.app_id,
    repo_id: existing.repo_id,
    deployment_id: existing.deployment_id,
    commit_sha: existing.commit_sha,
    checkpoint_id: existing.checkpoint_id,
    environment: existing.environment,
    status: callbackStatus === "verified" ? "verified" : "repair_required",
    owner_plane: "BitterGrid",
    grid_operation_ref: existing.grid_operation_ref,
    grid_receipt_id: gridReceiptId,
    published_url: publishedUrl,
    verification_status: verificationStatus,
    restore_candidate: existing.checkpoint_id ? {
      checkpoint_id: existing.checkpoint_id,
      commit_sha: existing.commit_sha,
      deployment_id: existing.deployment_id
    } : null,
    repair_action: repairAction,
    private_logs_included: false
  });

  return {
    request: findGridPublishRequestById(existing.id) as GridPublishRequest,
    receipt
  };
}

export function findGridPublishRequest(
  assertion: AccountAssertion,
  appId: string,
  requestId: string
): GridPublishRequest | undefined {
  const { app } = requireAssertedApp(assertion, appId);
  return ensureStorage().query<GridPublishRequest, [string, string]>(`
    SELECT ${gridPublishColumns()}
    FROM grid_publish_requests
    WHERE id = ? AND app_id = ?
  `).get(requestId, app.id) ?? undefined;
}

export function listGridPublishRequestsForApp(assertion: AccountAssertion, appId: string): GridPublishRequest[] {
  const { app } = requireAssertedApp(assertion, appId);
  return ensureStorage().query<GridPublishRequest, [string]>(`
    SELECT ${gridPublishColumns()}
    FROM grid_publish_requests
    WHERE app_id = ?
    ORDER BY created_at ASC
  `).all(app.id);
}

export function listGridPublishRequestsForRepo(repo: Repository): GridPublishRequest[] {
  return ensureStorage().query<GridPublishRequest, [string]>(`
    SELECT ${gridPublishColumns()}
    FROM grid_publish_requests
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id);
}

export function findGridPublishRequestById(requestId: string): GridPublishRequest | undefined {
  return ensureStorage().query<GridPublishRequest, [string]>(`
    SELECT ${gridPublishColumns()}
    FROM grid_publish_requests
    WHERE id = ?
  `).get(requestId) ?? undefined;
}

export function gridPublishRequestToJson(request: GridPublishRequest): Record<string, unknown> {
  const restore = request.checkpoint_id ? {
    checkpoint_id: request.checkpoint_id,
    commit_sha: request.commit_sha,
    deployment_id: request.deployment_id,
    restore_supported: true
  } : {
    checkpoint_id: null,
    commit_sha: request.commit_sha,
    deployment_id: request.deployment_id,
    restore_supported: false
  };

  return {
    id: request.id,
    app_id: request.app_id,
    repo_id: request.repo_id,
    account_ref: request.account_ref,
    workspace_ref: request.workspace_ref,
    deployment_id: request.deployment_id,
    checkpoint_id: request.checkpoint_id,
    commit_sha: request.commit_sha,
    environment: request.environment,
    status: request.status,
    owner_plane: request.owner_plane,
    bittergit_role: "source_custody_recorder",
    grid_operation_ref: request.grid_operation_ref,
    preview_url: request.preview_url,
    published_url: request.preview_url,
    verification_status: request.verification_status,
    repair_action: request.repair_action,
    grid_receipt_id: request.grid_receipt_id,
    callback_status: request.callback_status,
    callback_received_at: request.callback_received_at,
    grid_callback: callbackFromJson(request.grid_callback_json),
    restore_candidate: restore,
    private_logs_included: false,
    created_at: request.created_at,
    updated_at: request.updated_at
  };
}

export function gridPublishSupportJson(request: GridPublishRequest): Record<string, unknown> {
  return {
    id: request.id,
    app_id: request.app_id,
    repo_id: request.repo_id,
    deployment_id: request.deployment_id,
    checkpoint_id: request.checkpoint_id,
    commit_sha: request.commit_sha,
    environment: request.environment,
    status: request.status,
    owner_plane: request.owner_plane,
    grid_operation_ref: request.grid_operation_ref,
    grid_receipt_id: request.grid_receipt_id,
    callback_status: request.callback_status,
    callback_received_at: request.callback_received_at,
    published_url_present: Boolean(request.preview_url),
    verification_status: request.verification_status,
    repair_action: request.repair_action,
    restore_candidate: request.checkpoint_id ? {
      checkpoint_id: request.checkpoint_id,
      commit_sha: request.commit_sha,
      deployment_id: request.deployment_id
    } : null,
    private_logs_included: false
  };
}

function requireAssertedApp(assertion: AccountAssertion, appId: string): {
  app: { id: string; repo_id: string; account_ref: string; workspace_ref: string; app_slug: string };
  repo: Repository;
} {
  const app = findAccountAppById(appId);
  if (!app || app.account_ref !== assertion.account_ref) throw new Error("app not found");
  const repo = findRepositoryById(app.repo_id);
  if (!repo) throw new Error("app repository missing");
  return { app, repo };
}

function insertGridPublishRequest(request: GridPublishRequest): void {
  ensureStorage().query(`
    INSERT INTO grid_publish_requests
      (id, app_id, repo_id, account_ref, workspace_ref, deployment_id,
       checkpoint_id, commit_sha, environment, status, grid_operation_ref,
       preview_url, verification_status, repair_action, owner_plane,
       grid_receipt_id, callback_status, callback_received_at,
       grid_callback_json, created_at, updated_at)
    VALUES
      ($id, $app_id, $repo_id, $account_ref, $workspace_ref, $deployment_id,
       $checkpoint_id, $commit_sha, $environment, $status,
       $grid_operation_ref, $preview_url, $verification_status,
       $repair_action, $owner_plane, $grid_receipt_id, $callback_status,
       $callback_received_at, $grid_callback_json, $created_at, $updated_at)
  `).run({
    $id: request.id,
    $app_id: request.app_id,
    $repo_id: request.repo_id,
    $account_ref: request.account_ref,
    $workspace_ref: request.workspace_ref,
    $deployment_id: request.deployment_id,
    $checkpoint_id: request.checkpoint_id,
    $commit_sha: request.commit_sha,
    $environment: request.environment,
    $status: request.status,
    $grid_operation_ref: request.grid_operation_ref,
    $preview_url: request.preview_url,
    $verification_status: request.verification_status,
    $repair_action: request.repair_action,
    $owner_plane: request.owner_plane,
    $grid_receipt_id: request.grid_receipt_id,
    $callback_status: request.callback_status,
    $callback_received_at: request.callback_received_at,
    $grid_callback_json: request.grid_callback_json,
    $created_at: request.created_at,
    $updated_at: request.updated_at
  });
}

function gridPublishColumns(): string {
  return `
    id, app_id, repo_id, account_ref, workspace_ref, deployment_id,
    checkpoint_id, commit_sha, environment, status, grid_operation_ref,
    preview_url, verification_status, repair_action, owner_plane,
    grid_receipt_id, callback_status, callback_received_at,
    grid_callback_json, created_at, updated_at
  `;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value.trim();
}

function normalizeEnvironment(value: string): string {
  if (!/^(preview|production)$/.test(value)) throw new Error("environment must be preview or production");
  return value;
}

function normalizeVerification(value: string): string {
  if (value === "passed" || value === "failed") return value;
  throw new Error("verification_status must be passed or failed");
}

function normalizeCallbackStatus(value: string): string {
  if (value === "verified" || value === "published" || value === "passed") return "verified";
  if (value === "failed" || value === "repair_required") return "failed";
  throw new Error("callback status must be verified or failed");
}

function normalizePublishedUrl(value: string): string {
  if (!/^https:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/.test(value)) {
    throw new Error("published_url must be https");
  }
  return value;
}

function sanitizeGridReceiptId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/.test(value)) {
    throw new Error("invalid grid receipt id");
  }
  return value;
}

function callbackFromJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function previewUrl(appSlug: string, deploymentId: string): string {
  return `https://preview.bittergrid.local/${encodeURIComponent(appSlug)}/${encodeURIComponent(deploymentId)}`;
}
