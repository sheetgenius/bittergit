import { randomUUID } from "node:crypto";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import { commitExists, findCheckpoint, findCheckpointForCommit, type Checkpoint } from "./checkpoints";
import {
  isRecord,
  safeCount,
  safeIdentifier,
  safeLabel,
  safeSha,
  supportImportSummary,
  supportSourceContract
} from "./support-projection";

export type Deployment = {
  id: string;
  repo_id: string;
  commit_sha: string;
  checkpoint_id: string | null;
  environment: string;
  status: string;
  deploy_type: string;
  previous_commit_sha: string | null;
  created_at: string;
};

export type Receipt = {
  id: string;
  repo_id: string;
  deployment_id: string | null;
  receipt_type: string;
  body_json: string;
  created_at: string;
};

export type VerificationResult = {
  id: string;
  deployment_id: string;
  repo_id: string;
  commit_sha: string;
  status: string;
  summary: string | null;
  created_at: string;
};

export function createDeployment(
  repo: Repository,
  input: { commit_sha: string; environment: string; checkpoint_id?: string | null }
): { deployment: Deployment; receipt: unknown } {
  const checkpoint = validateDeploySource(repo, input.commit_sha, input.checkpoint_id ?? null, input.environment);
  const deployment = insertDeployment(repo, {
    commitSha: input.commit_sha,
    checkpointId: checkpoint?.id ?? null,
    environment: input.environment,
    status: "recorded",
    deployType: "deploy",
    previousCommitSha: null
  });
  const receipt = createReceipt(repo, deployment, "deploy", {
    repo_id: repo.id,
    commit_sha: deployment.commit_sha,
    checkpoint_id: deployment.checkpoint_id,
    environment: deployment.environment,
    status: deployment.status
  });

  return { deployment, receipt: receiptToJson(receipt) };
}

export function createRollback(
  repo: Repository,
  input: { checkpoint_id: string; previous_commit_sha: string; environment: string }
): { deployment: Deployment; receipt: unknown } {
  const checkpoint = findCheckpoint(repo, input.checkpoint_id);
  if (!checkpoint) throw new Error("checkpoint not found");
  if (!commitExists(repo, input.previous_commit_sha)) throw new Error("previous commit does not exist");

  const deployment = insertDeployment(repo, {
    commitSha: checkpoint.commit_sha,
    checkpointId: checkpoint.id,
    environment: input.environment,
    status: "recorded",
    deployType: "rollback",
    previousCommitSha: input.previous_commit_sha
  });
  const receipt = createReceipt(repo, deployment, "rollback", {
    repo_id: repo.id,
    previous_commit_sha: input.previous_commit_sha,
    rollback_commit_sha: checkpoint.commit_sha,
    checkpoint_id: checkpoint.id,
    environment: deployment.environment,
    status: deployment.status
  });

  return { deployment, receipt: receiptToJson(receipt) };
}

export function createVerification(
  repo: Repository,
  deployment: Deployment,
  input: { status: string; summary?: string | null }
): VerificationResult {
  const verification: VerificationResult = {
    id: `ver_${randomUUID()}`,
    deployment_id: deployment.id,
    repo_id: repo.id,
    commit_sha: deployment.commit_sha,
    status: input.status,
    summary: input.summary ?? null,
    created_at: new Date().toISOString()
  };

  ensureStorage().query(`
    INSERT INTO verification_results
      (id, deployment_id, repo_id, commit_sha, status, summary, created_at)
    VALUES
      ($id, $deployment_id, $repo_id, $commit_sha, $status, $summary, $created_at)
  `).run({
    $id: verification.id,
    $deployment_id: verification.deployment_id,
    $repo_id: verification.repo_id,
    $commit_sha: verification.commit_sha,
    $status: verification.status,
    $summary: verification.summary,
    $created_at: verification.created_at
  });

  createReceipt(repo, deployment, "verification", {
    repo_id: repo.id,
    deployment_id: deployment.id,
    commit_sha: deployment.commit_sha,
    status: verification.status,
    summary: verification.summary
  });

  return verification;
}

export function listDeployments(repo: Repository): Deployment[] {
  return ensureStorage().query<Deployment, [string]>(`
    SELECT id, repo_id, commit_sha, checkpoint_id, environment, status, deploy_type, previous_commit_sha, created_at
    FROM deployments
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id);
}

export function findDeployment(repo: Repository, id: string): Deployment | undefined {
  return ensureStorage().query<Deployment, [string, string]>(`
    SELECT id, repo_id, commit_sha, checkpoint_id, environment, status, deploy_type, previous_commit_sha, created_at
    FROM deployments
    WHERE repo_id = ? AND id = ?
  `).get(repo.id, id) ?? undefined;
}

export function listReceipts(repo: Repository): unknown[] {
  return ensureStorage().query(`
    SELECT id, repo_id, deployment_id, receipt_type, body_json, created_at
    FROM receipts
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id).map((row) => receiptToJson(row as Receipt));
}

export function receiptSupportJson(value: unknown): Record<string, unknown> {
  const receipt = isRecord(value) ? value : {};
  const receiptType = safeIdentifier(receipt.receipt_type) ?? "unknown";
  return {
    id: safeIdentifier(receipt.id),
    repo_id: safeIdentifier(receipt.repo_id),
    deployment_id: safeIdentifier(receipt.deployment_id),
    receipt_type: receiptType,
    body: receiptBodySupportJson(receiptType, receipt.body),
    created_at: typeof receipt.created_at === "string" ? receipt.created_at : null,
    projection: "support_safe_v1"
  };
}

export function findReceipt(repo: Repository, id: string): Receipt | undefined {
  return ensureStorage().query<Receipt, [string, string]>(`
    SELECT id, repo_id, deployment_id, receipt_type, body_json, created_at
    FROM receipts
    WHERE repo_id = ? AND id = ?
  `).get(repo.id, id) ?? undefined;
}

export function createSourceReceipt(repo: Repository, receiptType: string, body: unknown): Record<string, unknown> {
  return receiptToJson(insertReceipt(repo, null, receiptType, body));
}

function validateDeploySource(
  repo: Repository,
  commitSha: string,
  checkpointId: string | null,
  environment: string
): Checkpoint | undefined {
  if (!commitSha) throw new Error("commit_sha is required");
  if (!commitExists(repo, commitSha)) throw new Error("commit does not exist");

  const checkpoint = checkpointId ? findCheckpoint(repo, checkpointId) : findCheckpointForCommit(repo, commitSha);
  if (environment === "production" && !checkpoint) {
    throw new Error("production deploy requires checkpointed commit");
  }
  if (checkpoint && checkpoint.commit_sha !== commitSha) {
    throw new Error("checkpoint does not match commit_sha");
  }

  return checkpoint;
}

function insertDeployment(
  repo: Repository,
  input: {
    commitSha: string;
    checkpointId: string | null;
    environment: string;
    status: string;
    deployType: string;
    previousCommitSha: string | null;
  }
): Deployment {
  const deployment: Deployment = {
    id: `dep_${randomUUID()}`,
    repo_id: repo.id,
    commit_sha: input.commitSha,
    checkpoint_id: input.checkpointId,
    environment: input.environment,
    status: input.status,
    deploy_type: input.deployType,
    previous_commit_sha: input.previousCommitSha,
    created_at: new Date().toISOString()
  };

  ensureStorage().query(`
    INSERT INTO deployments
      (id, repo_id, commit_sha, checkpoint_id, environment, status, deploy_type, previous_commit_sha, created_at)
    VALUES
      ($id, $repo_id, $commit_sha, $checkpoint_id, $environment, $status, $deploy_type, $previous_commit_sha, $created_at)
  `).run({
    $id: deployment.id,
    $repo_id: deployment.repo_id,
    $commit_sha: deployment.commit_sha,
    $checkpoint_id: deployment.checkpoint_id,
    $environment: deployment.environment,
    $status: deployment.status,
    $deploy_type: deployment.deploy_type,
    $previous_commit_sha: deployment.previous_commit_sha,
    $created_at: deployment.created_at
  });

  return deployment;
}

function createReceipt(repo: Repository, deployment: Deployment, receiptType: string, body: unknown): Receipt {
  return insertReceipt(repo, deployment.id, receiptType, body);
}

function insertReceipt(repo: Repository, deploymentId: string | null, receiptType: string, body: unknown): Receipt {
  const receipt: Receipt = {
    id: `rec_${randomUUID()}`,
    repo_id: repo.id,
    deployment_id: deploymentId,
    receipt_type: receiptType,
    body_json: JSON.stringify(body),
    created_at: new Date().toISOString()
  };

  ensureStorage().query(`
    INSERT INTO receipts
      (id, repo_id, deployment_id, receipt_type, body_json, created_at)
    VALUES
      ($id, $repo_id, $deployment_id, $receipt_type, $body_json, $created_at)
  `).run({
    $id: receipt.id,
    $repo_id: receipt.repo_id,
    $deployment_id: receipt.deployment_id,
    $receipt_type: receipt.receipt_type,
    $body_json: receipt.body_json,
    $created_at: receipt.created_at
  });

  return receipt;
}

function receiptToJson(receipt: Receipt): Record<string, unknown> {
  return {
    id: receipt.id,
    repo_id: receipt.repo_id,
    deployment_id: receipt.deployment_id,
    receipt_type: receipt.receipt_type,
    body: JSON.parse(receipt.body_json),
    created_at: receipt.created_at
  };
}

function receiptBodySupportJson(receiptType: string, value: unknown): Record<string, unknown> {
  const body = isRecord(value) ? value : {};
  if (receiptType === "deploy") {
    return {
      repo_id: safeIdentifier(body.repo_id),
      commit_sha: safeSha(body.commit_sha),
      checkpoint_id: safeIdentifier(body.checkpoint_id),
      environment: safeLabel(body.environment),
      status: safeLabel(body.status)
    };
  }
  if (receiptType === "rollback") {
    return {
      repo_id: safeIdentifier(body.repo_id),
      previous_commit_sha: safeSha(body.previous_commit_sha),
      rollback_commit_sha: safeSha(body.rollback_commit_sha),
      checkpoint_id: safeIdentifier(body.checkpoint_id),
      environment: safeLabel(body.environment),
      status: safeLabel(body.status)
    };
  }
  if (receiptType === "verification") {
    return {
      repo_id: safeIdentifier(body.repo_id),
      deployment_id: safeIdentifier(body.deployment_id),
      commit_sha: safeSha(body.commit_sha),
      status: safeLabel(body.status),
      summary: null,
      summary_present: nonEmptyString(body.summary),
      summary_returned: false
    };
  }
  if (receiptType === "app_setup") {
    return setupReceiptBody(body, "blank_app");
  }
  if (receiptType === "artifact_app_setup") {
    return {
      ...setupReceiptBody(body, "artifact_import"),
      artifact_import_id: safeIdentifier(body.artifact_import_id),
      detected_shape: safeLabel(body.detected_shape),
      import_summary: artifactImportSummarySupportJson(body.import_summary)
    };
  }
  if (receiptType === "git_import_app_setup") {
    return {
      ...setupReceiptBody(body, "git_url_import"),
      source_contract: supportSourceContract(body.source_contract),
      import_summary: supportImportSummary(body.import_summary),
      terminal_prompt_disabled: body.terminal_prompt_disabled === true
    };
  }
  if (receiptType === "secret_grant_request") {
    return {
      secret_grant_request_id: safeIdentifier(body.secret_grant_request_id),
      secret_ref_id: safeIdentifier(body.secret_ref_id),
      app_id: safeIdentifier(body.app_id),
      repo_id: safeIdentifier(body.repo_id),
      first_run_id: safeIdentifier(body.first_run_id),
      name: safeLabel(body.name),
      environment: safeLabel(body.environment),
      manifest_path: null,
      manifest_path_present: nonEmptyString(body.manifest_path),
      manifest_path_returned: false,
      commit_sha: safeSha(body.commit_sha),
      materialization_request_ids: safeIdentifierArray(body.materialization_request_ids),
      materialization_targets: safeLabelArray(body.materialization_targets),
      delegated_to: body.delegated_to === "BitterPass" ? "BitterPass" : null,
      value_stored_in_bittergit: false,
      includes_secret_value: false,
      includes_credential_ref: false,
      includes_grant_token: false,
      includes_materialized_file: false
    };
  }
  if (receiptType === "grid_publish" || receiptType === "grid_publish_callback") {
    return gridPublishReceiptBody(body);
  }
  return {
    details_present: Object.keys(body).length > 0,
    details_returned: false
  };
}

function setupReceiptBody(body: Record<string, unknown>, sourceKind: string): Record<string, unknown> {
  return {
    app_id: safeIdentifier(body.app_id),
    repo_id: safeIdentifier(body.repo_id),
    commit_sha: safeSha(body.commit_sha),
    checkpoint_id: safeIdentifier(body.checkpoint_id),
    source_kind: sourceKind,
    source_tree_count: Array.isArray(body.source_tree) ? body.source_tree.length : null,
    context_files_present: isRecord(body.context_files),
    github_required: false,
    setup_status: safeLabel(body.setup_status)
  };
}

function artifactImportSummarySupportJson(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return {
    detected_shape: safeLabel(value.detected_shape),
    import_count: safeCount(value.import_count),
    skip_count: safeCount(value.skip_count),
    blocked_count: safeCount(value.blocked_count),
    ready_to_commit: value.ready_to_commit === true
  };
}

function gridPublishReceiptBody(body: Record<string, unknown>): Record<string, unknown> {
  return {
    grid_publish_request_id: safeIdentifier(body.grid_publish_request_id),
    app_id: safeIdentifier(body.app_id),
    repo_id: safeIdentifier(body.repo_id),
    deployment_id: safeIdentifier(body.deployment_id),
    commit_sha: safeSha(body.commit_sha),
    checkpoint_id: safeIdentifier(body.checkpoint_id),
    environment: safeLabel(body.environment),
    status: safeLabel(body.status),
    owner_plane: body.owner_plane === "BitterGrid" ? "BitterGrid" : null,
    grid_operation_ref: null,
    grid_operation_linked: nonEmptyString(body.grid_operation_ref),
    grid_operation_ref_returned: false,
    grid_receipt_id: safeIdentifier(body.grid_receipt_id),
    callback_status: safeLabel(body.callback_status),
    published_url: null,
    published_url_present: nonEmptyString(body.published_url) || nonEmptyString(body.preview_url),
    published_url_returned: false,
    verification_status: safeLabel(body.verification_status),
    restore_candidate: restoreCandidateSupportJson(body.restore_candidate),
    repair_action: nonEmptyString(body.repair_action)
      ? "Retry publish through the BitterGrid support workflow."
      : null,
    private_logs_included: false
  };
}

function restoreCandidateSupportJson(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return {
    checkpoint_id: safeIdentifier(value.checkpoint_id),
    commit_sha: safeSha(value.commit_sha),
    deployment_id: safeIdentifier(value.deployment_id)
  };
}

function safeIdentifierArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(safeIdentifier).filter((entry): entry is string => entry !== null).slice(0, 100);
}

function safeLabelArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(safeLabel).filter((entry): entry is string => entry !== null).slice(0, 20);
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
