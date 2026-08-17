import { randomUUID } from "node:crypto";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import { commitExists, findCheckpoint, findCheckpointForCommit, type Checkpoint } from "./checkpoints";

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
