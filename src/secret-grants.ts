import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { AccountAssertion } from "./assertions";
import { config } from "./config";
import { createSourceReceipt } from "./deployments";
import { findAccountAppById } from "./apps";
import { findRepositoryById, type Repository } from "./repos";
import { createSecretRef, listSecretRefs, type AppSecretRef } from "./secrets";
import { ensureStorage } from "./storage";
import {
  findCharterFirstRun,
  type CharterFirstRun
} from "./charter-first-runs";

export type SecretGrantRequest = {
  id: string;
  secret_ref_id: string;
  first_run_id: string;
  launch_id: string;
  session_id: string;
  app_id: string;
  repo_id: string;
  account_ref: string;
  workspace_ref: string;
  name: string;
  environment: string;
  purpose: string;
  grant_status: string;
  materialization_status: string;
  manifest_path: string;
  commit_sha: string | null;
  receipt_id: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export type SecretMaterializationRequest = {
  id: string;
  secret_grant_request_id: string;
  secret_ref_id: string;
  app_id: string;
  repo_id: string;
  account_ref: string;
  workspace_ref: string;
  session_id: string | null;
  deployment_id: string | null;
  target_plane: string;
  target_ref: string;
  name: string;
  environment: string;
  owner_plane: string;
  request_status: string;
  materialization_status: string;
  repair_action: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export function createFirstRunSecretGrant(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string,
  launchId: string,
  firstRunId: string,
  input: {
    name?: string;
    environment?: string;
    purpose?: string;
    credential_ref?: string;
    value?: string;
    credential_value?: string;
  }
): SecretGrantRequest {
  if (input.value || input.credential_value) {
    throw new Error("secret values are not accepted; store values in BitterPass and pass credential_ref");
  }

  const firstRun = requireFirstRun(assertion, appId, sessionId, launchId, firstRunId);
  const repo = findRepositoryById(firstRun.repo_id);
  if (!repo) throw new Error("app repository missing");

  const secretRef = createSecretRef(repo, {
    name: input.name,
    environment: input.environment,
    credential_ref: input.credential_ref
  }, `secret-grant:${firstRun.id}`);
  const purpose = normalizePurpose(input.purpose);
  const now = new Date().toISOString();
  const request: SecretGrantRequest = {
    id: `secret_grant_${randomUUID()}`,
    secret_ref_id: secretRef.id,
    first_run_id: firstRun.id,
    launch_id: firstRun.launch_id,
    session_id: firstRun.session_id,
    app_id: firstRun.app_id,
    repo_id: firstRun.repo_id,
    account_ref: firstRun.account_ref,
    workspace_ref: firstRun.workspace_ref,
    name: secretRef.name,
    environment: secretRef.environment,
    purpose,
    grant_status: "requested",
    materialization_status: "delegated_to_bitterpass",
    manifest_path: manifestPath(secretRef.environment),
    commit_sha: null,
    receipt_id: null,
    created_at: now,
    updated_at: now,
    revoked_at: null
  };
  insertSecretGrantRequest(request);
  const materializationRequests = createMaterializationRequests(request);

  const manifest = commitSecretManifest(repo, secretRef.environment);
  const receipt = createSourceReceipt(repo, "secret_grant_request", {
    secret_grant_request_id: request.id,
    secret_ref_id: secretRef.id,
    app_id: firstRun.app_id,
    repo_id: firstRun.repo_id,
    first_run_id: firstRun.id,
    name: secretRef.name,
    environment: secretRef.environment,
    manifest_path: manifest.path,
    commit_sha: manifest.commit_sha,
    materialization_request_ids: materializationRequests.map((entry) => entry.id),
    materialization_targets: materializationRequests.map((entry) => entry.target_plane),
    delegated_to: "BitterPass",
    value_stored_in_bittergit: false,
    includes_secret_value: false,
    includes_credential_ref: false,
    includes_grant_token: false,
    includes_materialized_file: false
  });

  ensureStorage().query(`
    UPDATE secret_grant_requests
    SET commit_sha = $commit_sha,
        receipt_id = $receipt_id,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: request.id,
    $commit_sha: manifest.commit_sha,
    $receipt_id: String(receipt.id),
    $updated_at: new Date().toISOString()
  });

  return findSecretGrantRequest(firstRun, request.id) as SecretGrantRequest;
}

export function listSecretGrantRequestsForFirstRun(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string,
  launchId: string,
  firstRunId: string
): SecretGrantRequest[] {
  const firstRun = requireFirstRun(assertion, appId, sessionId, launchId, firstRunId);
  return ensureStorage().query<SecretGrantRequest, [string]>(`
    SELECT ${secretGrantColumns()}
    FROM secret_grant_requests
    WHERE first_run_id = ?
    ORDER BY created_at ASC
  `).all(firstRun.id);
}

export function listSecretGrantRequestsForRepo(repo: Repository): SecretGrantRequest[] {
  return ensureStorage().query<SecretGrantRequest, [string]>(`
    SELECT ${secretGrantColumns()}
    FROM secret_grant_requests
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id);
}

export function listSecretMaterializationRequestsForGrant(
  request: Pick<SecretGrantRequest, "id">
): SecretMaterializationRequest[] {
  return ensureStorage().query<SecretMaterializationRequest, [string]>(`
    SELECT ${secretMaterializationColumns()}
    FROM secret_materialization_requests
    WHERE secret_grant_request_id = ?
    ORDER BY target_plane ASC, created_at ASC
  `).all(request.id);
}

export function listSecretMaterializationRequestsForRepo(repo: Repository): SecretMaterializationRequest[] {
  return ensureStorage().query<SecretMaterializationRequest, [string]>(`
    SELECT ${secretMaterializationColumns()}
    FROM secret_materialization_requests
    WHERE repo_id = ?
    ORDER BY environment ASC, name ASC, target_plane ASC, created_at ASC
  `).all(repo.id);
}

export function secretMaterializationReadiness(
  assertion: AccountAssertion,
  appId: string,
  environment: string | null
): Record<string, unknown> {
  const app = findAccountAppById(appId);
  if (!app || app.account_ref !== assertion.account_ref) throw new Error("app not found");
  const repo = findRepositoryById(app.repo_id);
  if (!repo) throw new Error("app repository missing");
  return secretMaterializationReadinessForRepo(repo, normalizeEnvironmentFilter(environment), app.id);
}

export function secretGrantRequestToJson(request: SecretGrantRequest): Record<string, unknown> {
  const materializations = listSecretMaterializationRequestsForGrant(request);
  return {
    id: request.id,
    secret_ref_id: request.secret_ref_id,
    first_run_id: request.first_run_id,
    launch_id: request.launch_id,
    session_id: request.session_id,
    app_id: request.app_id,
    repo_id: request.repo_id,
    account_ref: request.account_ref,
    workspace_ref: request.workspace_ref,
    name: request.name,
    environment: request.environment,
    purpose: request.purpose,
    grant_status: request.grant_status,
    materialization: {
      status: request.materialization_status,
      delegated_to: "BitterPass",
      includes_secret_value: false,
      value_stored_in_bittergit: false,
      includes_credential_ref: false,
      includes_grant_token: false,
      includes_materialized_file: false
    },
    materialization_requests: materializations.map(secretMaterializationRequestToJson),
    source_manifest: {
      path: request.manifest_path,
      commit_sha: request.commit_sha,
      includes_secret_value: false,
      includes_credential_ref: false,
      includes_grant_token: false
    },
    receipt_id: request.receipt_id,
    created_at: request.created_at,
    updated_at: request.updated_at,
    revoked_at: request.revoked_at
  };
}

export function secretGrantRequestSupportJson(request: SecretGrantRequest): Record<string, unknown> {
  const materializations = listSecretMaterializationRequestsForGrant(request);
  return {
    id: request.id,
    secret_ref_id: request.secret_ref_id,
    first_run_id: request.first_run_id,
    app_id: request.app_id,
    repo_id: request.repo_id,
    name: request.name,
    environment: request.environment,
    grant_status: request.grant_status,
    materialization_status: request.materialization_status,
    materialization_request_count: materializations.length,
    materialization_targets: materializations.map((entry) => entry.target_plane),
    manifest_path: request.manifest_path,
    commit_sha: request.commit_sha,
    receipt_id: request.receipt_id,
    includes_secret_value: false,
    includes_credential_ref: false,
    includes_grant_token: false,
    includes_materialized_file: false,
    revoked_at: request.revoked_at
  };
}

export function secretMaterializationRequestToJson(request: SecretMaterializationRequest): Record<string, unknown> {
  return {
    id: request.id,
    secret_grant_request_id: request.secret_grant_request_id,
    secret_ref_id: request.secret_ref_id,
    app_id: request.app_id,
    repo_id: request.repo_id,
    account_ref: request.account_ref,
    workspace_ref: request.workspace_ref,
    session_id: request.session_id,
    deployment_id: request.deployment_id,
    target_plane: request.target_plane,
    target_ref: request.target_ref,
    name: request.name,
    environment: request.environment,
    owner_plane: request.owner_plane,
    request_status: request.request_status,
    materialization_status: request.materialization_status,
    repair_action: request.repair_action,
    includes_secret_value: false,
    includes_credential_ref: false,
    includes_grant_token: false,
    includes_materialized_file: false,
    created_at: request.created_at,
    updated_at: request.updated_at,
    revoked_at: request.revoked_at
  };
}

export function secretMaterializationRequestSupportJson(request: SecretMaterializationRequest): Record<string, unknown> {
  return {
    id: request.id,
    secret_grant_request_id: request.secret_grant_request_id,
    app_id: request.app_id,
    repo_id: request.repo_id,
    target_plane: request.target_plane,
    target_ref: request.target_ref,
    name: request.name,
    environment: request.environment,
    owner_plane: request.owner_plane,
    request_status: request.request_status,
    materialization_status: request.materialization_status,
    repair_action: request.repair_action,
    includes_secret_value: false,
    includes_credential_ref: false,
    includes_grant_token: false,
    includes_materialized_file: false,
    revoked_at: request.revoked_at
  };
}

export function secretMaterializationReadinessForRepo(
  repo: Repository,
  environment: string,
  appId: string | null = null
): Record<string, unknown> {
  const materializations = listSecretMaterializationRequestsForRepo(repo)
    .filter((request) => request.environment === environment && !request.revoked_at);
  const names = Array.from(new Set(materializations.map((request) => request.name))).sort();
  const workcell = readinessForTarget(materializations, "workcell");
  const deploy = readinessForTarget(materializations, "deploy");
  const ready = names.length > 0 && workcell.status === "delegated_to_bitterpass" && deploy.status === "delegated_to_bitterpass";
  return {
    app_id: appId,
    repo_id: repo.id,
    environment,
    owner_plane: "BitterPass",
    status: ready ? "ready" : "missing_grants",
    required_secret_names: names,
    workcell,
    deploy,
    repair_action: ready ? null : "Create first-run secret grants so BitterPass can materialize workcell and deploy secrets.",
    includes_secret_value: false,
    includes_credential_ref: false,
    includes_grant_token: false,
    includes_materialized_file: false
  };
}

function requireFirstRun(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string,
  launchId: string,
  firstRunId: string
): CharterFirstRun {
  const firstRun = findCharterFirstRun(assertion, appId, sessionId, launchId, firstRunId);
  if (!firstRun) throw new Error("charter-first run not found");
  return firstRun;
}

function commitSecretManifest(repo: Repository, environment: string): { path: string; commit_sha: string } {
  const tmpRoot = join(config.dataRoot, "tmp");
  mkdirSync(tmpRoot, { recursive: true });
  const worktree = mkdtempSync(join(tmpRoot, "secret-manifest-"));
  const path = manifestPath(environment);

  try {
    runGit(["clone", repo.storage_path, worktree]);
    writeSecretManifest(worktree, environment, activeSecretRefsForEnvironment(repo, environment));
    runGit(["-C", worktree, "config", "user.email", "system@bittergit.local"]);
    runGit(["-C", worktree, "config", "user.name", "BitterGit"]);
    runGit(["-C", worktree, "add", path]);
    const status = gitOutput(["-C", worktree, "status", "--porcelain"]);
    if (status.trim().length > 0) {
      runGit(["-C", worktree, "commit", "-m", "Record BitterPass secret refs"]);
      runGit(["-C", worktree, "push", "origin", "main"], {
        BITTERGIT_ACTOR: "system:secret-grant",
        BITTERGIT_SCOPES: JSON.stringify(["repo:admin"])
      });
    }
    return {
      path,
      commit_sha: gitOutput(["-C", worktree, "rev-parse", "HEAD"]).trim()
    };
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
}

function writeSecretManifest(worktree: string, environment: string, refs: AppSecretRef[]): void {
  const path = join(worktree, manifestPath(environment));
  mkdirSync(dirname(path), { recursive: true });
  const body = {
    version: 1,
    environment,
    values_committed: false,
    custody: "BitterPass",
    note: "This manifest records required secret names only. Secret values and grant tokens are not stored in Git.",
    secrets: refs.map((ref) => ({
      name: ref.name,
      provider: "BitterPass",
      required: true,
      value_committed: false
    }))
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf8" });
}

function activeSecretRefsForEnvironment(repo: Repository, environment: string): AppSecretRef[] {
  return listSecretRefs(repo)
    .filter((ref) => ref.environment === environment && !ref.revoked_at)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function insertSecretGrantRequest(request: SecretGrantRequest): void {
  ensureStorage().query(`
    INSERT INTO secret_grant_requests
      (id, secret_ref_id, first_run_id, launch_id, session_id, app_id, repo_id,
       account_ref, workspace_ref, name, environment, purpose, grant_status,
       materialization_status, manifest_path, commit_sha, receipt_id,
       created_at, updated_at, revoked_at)
    VALUES
      ($id, $secret_ref_id, $first_run_id, $launch_id, $session_id, $app_id,
       $repo_id, $account_ref, $workspace_ref, $name, $environment, $purpose,
       $grant_status, $materialization_status, $manifest_path, $commit_sha,
       $receipt_id, $created_at, $updated_at, NULL)
  `).run({
    $id: request.id,
    $secret_ref_id: request.secret_ref_id,
    $first_run_id: request.first_run_id,
    $launch_id: request.launch_id,
    $session_id: request.session_id,
    $app_id: request.app_id,
    $repo_id: request.repo_id,
    $account_ref: request.account_ref,
    $workspace_ref: request.workspace_ref,
    $name: request.name,
    $environment: request.environment,
    $purpose: request.purpose,
    $grant_status: request.grant_status,
    $materialization_status: request.materialization_status,
    $manifest_path: request.manifest_path,
    $commit_sha: request.commit_sha,
    $receipt_id: request.receipt_id,
    $created_at: request.created_at,
    $updated_at: request.updated_at
  });
}

function createMaterializationRequests(request: SecretGrantRequest): SecretMaterializationRequest[] {
  const now = new Date().toISOString();
  const requests: SecretMaterializationRequest[] = [
    materializationRequest(request, "workcell", request.session_id, now),
    materializationRequest(request, "deploy", `app:${request.app_id}:deploy`, now)
  ];

  for (const materialization of requests) {
    ensureStorage().query(`
      INSERT INTO secret_materialization_requests
        (id, secret_grant_request_id, secret_ref_id, app_id, repo_id,
         account_ref, workspace_ref, session_id, deployment_id, target_plane,
         target_ref, name, environment, owner_plane, request_status,
         materialization_status, repair_action, created_at, updated_at,
         revoked_at)
      VALUES
        ($id, $secret_grant_request_id, $secret_ref_id, $app_id, $repo_id,
         $account_ref, $workspace_ref, $session_id, $deployment_id,
         $target_plane, $target_ref, $name, $environment, $owner_plane,
         $request_status, $materialization_status, $repair_action,
         $created_at, $updated_at, NULL)
    `).run({
      $id: materialization.id,
      $secret_grant_request_id: materialization.secret_grant_request_id,
      $secret_ref_id: materialization.secret_ref_id,
      $app_id: materialization.app_id,
      $repo_id: materialization.repo_id,
      $account_ref: materialization.account_ref,
      $workspace_ref: materialization.workspace_ref,
      $session_id: materialization.session_id,
      $deployment_id: materialization.deployment_id,
      $target_plane: materialization.target_plane,
      $target_ref: materialization.target_ref,
      $name: materialization.name,
      $environment: materialization.environment,
      $owner_plane: materialization.owner_plane,
      $request_status: materialization.request_status,
      $materialization_status: materialization.materialization_status,
      $repair_action: materialization.repair_action,
      $created_at: materialization.created_at,
      $updated_at: materialization.updated_at
    });
  }

  return requests;
}

function materializationRequest(
  request: SecretGrantRequest,
  targetPlane: "workcell" | "deploy",
  targetRef: string,
  now: string
): SecretMaterializationRequest {
  return {
    id: `secret_materialization_${randomUUID()}`,
    secret_grant_request_id: request.id,
    secret_ref_id: request.secret_ref_id,
    app_id: request.app_id,
    repo_id: request.repo_id,
    account_ref: request.account_ref,
    workspace_ref: request.workspace_ref,
    session_id: targetPlane === "workcell" ? request.session_id : null,
    deployment_id: null,
    target_plane: targetPlane,
    target_ref: targetRef,
    name: request.name,
    environment: request.environment,
    owner_plane: "BitterPass",
    request_status: "requested",
    materialization_status: "delegated_to_bitterpass",
    repair_action: null,
    created_at: now,
    updated_at: now,
    revoked_at: null
  };
}

function readinessForTarget(
  materializations: SecretMaterializationRequest[],
  targetPlane: "workcell" | "deploy"
): Record<string, unknown> {
  const targetRequests = materializations.filter((request) => request.target_plane === targetPlane);
  const names = Array.from(new Set(targetRequests.map((request) => request.name))).sort();
  const ready = targetRequests.length > 0;
  return {
    status: ready ? "delegated_to_bitterpass" : "missing_grants",
    request_count: targetRequests.length,
    required_secret_names: names,
    owner_plane: "BitterPass",
    repair_action: ready ? null : `Create first-run secret grants before ${targetPlane} secret materialization.`,
    includes_secret_value: false,
    includes_credential_ref: false,
    includes_grant_token: false,
    includes_materialized_file: false
  };
}

function findSecretGrantRequest(firstRun: CharterFirstRun, id: string): SecretGrantRequest | undefined {
  return ensureStorage().query<SecretGrantRequest, [string, string]>(`
    SELECT ${secretGrantColumns()}
    FROM secret_grant_requests
    WHERE id = ? AND first_run_id = ?
  `).get(id, firstRun.id) ?? undefined;
}

function secretGrantColumns(): string {
  return `
    id, secret_ref_id, first_run_id, launch_id, session_id, app_id, repo_id,
    account_ref, workspace_ref, name, environment, purpose, grant_status,
    materialization_status, manifest_path, commit_sha, receipt_id, created_at,
    updated_at, revoked_at
  `;
}

function secretMaterializationColumns(): string {
  return `
    id, secret_grant_request_id, secret_ref_id, app_id, repo_id, account_ref,
    workspace_ref, session_id, deployment_id, target_plane, target_ref, name,
    environment, owner_plane, request_status, materialization_status,
    repair_action, created_at, updated_at, revoked_at
  `;
}

function manifestPath(environment: string): string {
  return `.bitter/secrets/${environment}.json`;
}

function normalizePurpose(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 6) {
    return "Declared during first-run secret grant setup.";
  }
  if (value.length > 500) throw new Error("purpose is too long");
  return value.trim();
}

function normalizeEnvironmentFilter(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "production";
  const environment = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(environment)) {
    throw new Error("invalid secret environment");
  }
  return environment;
}

function runGit(args: string[], env: Record<string, string> = {}): void {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function gitOutput(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}
