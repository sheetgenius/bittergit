import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { config } from "./config";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import { assertSafeTextForStorage } from "./source-safety";

export type ExternalSource = {
  id: string;
  repo_id: string;
  provider: string;
  remote_url: string;
  default_branch: string;
  credential_ref: string | null;
  status: string;
  last_seen_default_sha: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ExternalWorkcell = {
  id: string;
  repo_id: string;
  external_source_id: string;
  checkout_path: string;
  created_at: string;
};

export type ExternalPullRequest = {
  id: string;
  repo_id: string;
  external_source_id: string;
  external_number: number;
  title: string;
  body: string | null;
  status: string;
  base_ref: string;
  head_ref: string;
  head_sha: string;
  issue_external_id: string | null;
  provider_url: string | null;
  receipt_id: string | null;
  created_at: string;
  updated_at: string;
};

type ExternalEvent = {
  id: string;
  repo_id: string;
  external_source_id: string;
  event_type: string;
  ref: string | null;
  old_sha: string | null;
  new_sha: string | null;
  actor: string;
  created_at: string;
};

type Receipt = {
  id: string;
  repo_id: string;
  deployment_id: string | null;
  receipt_type: string;
  body_json: string;
  created_at: string;
};

export function connectExternalSource(repo: Repository, input: {
  provider?: string;
  remote_url?: string;
  default_branch?: string;
  credential_ref?: string | null;
  credential_value?: string;
}, actor: string): ExternalSource {
  if (!input.remote_url) throw new Error("remote_url is required");
  if (input.credential_value) throw new Error("credential_value is not accepted; store secrets outside BitterGit and pass credential_ref");

  const provider = validateProvider(input.provider ?? "github");
  validateExternalRemote(input.remote_url);
  const defaultBranch = validateBranchName(input.default_branch ?? "main");
  const defaultRef = `refs/heads/${defaultBranch}`;
  const defaultSha = readRemoteRef(input.remote_url, defaultRef);
  const now = new Date().toISOString();
  const id = `extsrc_${randomUUID()}`;

  ensureStorage().query(`
    INSERT INTO external_sources
      (id, repo_id, provider, remote_url, default_branch, credential_ref, status,
       last_seen_default_sha, last_checked_at, last_error, created_at, updated_at)
    VALUES
      ($id, $repo_id, $provider, $remote_url, $default_branch, $credential_ref, 'ok',
       $last_seen_default_sha, $last_checked_at, NULL, $created_at, $updated_at)
  `).run({
    $id: id,
    $repo_id: repo.id,
    $provider: provider,
    $remote_url: input.remote_url,
    $default_branch: defaultBranch,
    $credential_ref: input.credential_ref ?? null,
    $last_seen_default_sha: defaultSha,
    $last_checked_at: now,
    $created_at: now,
    $updated_at: now
  });

  const source = findExternalSource(repo, id) as ExternalSource;
  recordExternalEvent(repo, source, "connected", defaultRef, null, defaultSha, actor);
  return source;
}

export function listExternalSources(repo: Repository): ExternalSource[] {
  return ensureStorage().query<ExternalSource, [string]>(`
    SELECT id, repo_id, provider, remote_url, default_branch, credential_ref,
           status, last_seen_default_sha, last_checked_at, last_error,
           created_at, updated_at
    FROM external_sources
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id);
}

export function findExternalSource(repo: Repository, id: string): ExternalSource | undefined {
  return ensureStorage().query<ExternalSource, [string, string]>(`
    SELECT id, repo_id, provider, remote_url, default_branch, credential_ref,
           status, last_seen_default_sha, last_checked_at, last_error,
           created_at, updated_at
    FROM external_sources
    WHERE repo_id = ? AND id = ?
  `).get(repo.id, id) ?? undefined;
}

export function externalSourceToJson(source: ExternalSource): Record<string, unknown> {
  return {
    id: source.id,
    repo_id: source.repo_id,
    provider: source.provider,
    remote_url: source.remote_url,
    default_branch: source.default_branch,
    credential_ref: source.credential_ref,
    canonical_source: "external",
    status: source.status,
    last_seen_default_sha: source.last_seen_default_sha,
    last_checked_at: source.last_checked_at,
    last_error: source.last_error,
    created_at: source.created_at,
    updated_at: source.updated_at
  };
}

export function createExternalWorkcell(repo: Repository, source: ExternalSource): ExternalWorkcell {
  const id = `extwc_${randomUUID()}`;
  const checkoutPath = join(config.dataRoot, "external-workcells", id, "workspace");
  rmSync(join(config.dataRoot, "external-workcells", id), { recursive: true, force: true });
  mkdirSync(join(config.dataRoot, "external-workcells", id), { recursive: true });
  runGit(["clone", source.remote_url, checkoutPath]);
  const now = new Date().toISOString();

  const workcell: ExternalWorkcell = {
    id,
    repo_id: repo.id,
    external_source_id: source.id,
    checkout_path: checkoutPath,
    created_at: now
  };

  ensureStorage().query(`
    INSERT INTO external_workcells
      (id, repo_id, external_source_id, checkout_path, created_at)
    VALUES
      ($id, $repo_id, $external_source_id, $checkout_path, $created_at)
  `).run({
    $id: workcell.id,
    $repo_id: workcell.repo_id,
    $external_source_id: workcell.external_source_id,
    $checkout_path: workcell.checkout_path,
    $created_at: workcell.created_at
  });

  return workcell;
}

export function externalWorkcellToJson(source: ExternalSource, workcell: ExternalWorkcell): Record<string, unknown> {
  return {
    id: workcell.id,
    repo_id: workcell.repo_id,
    external_source_id: workcell.external_source_id,
    checkout_path: workcell.checkout_path,
    origin: source.remote_url,
    canonical_source: "external",
    created_at: workcell.created_at
  };
}

export function openExternalPullRequest(repo: Repository, source: ExternalSource, input: {
  external_number?: number;
  title?: string;
  body?: string | null;
  base_ref?: string;
  head_ref?: string;
  issue_external_id?: string | null;
  provider_url?: string | null;
}): ExternalPullRequest {
  const title = requireText(input.title, "title", 240);
  const body = optionalText(input.body ?? null, "body", 20_000);
  const baseRef = normalizeBranchRef(input.base_ref ?? source.default_branch);
  const headRef = normalizeBranchRef(requireText(input.head_ref, "head_ref", 300));
  const headSha = readRemoteRef(source.remote_url, headRef);
  const number = input.external_number ?? nextExternalPullRequestNumber(source);
  const providerUrl = optionalProviderUrl(input.provider_url ?? null);
  const issueExternalId = optionalExternalId(input.issue_external_id ?? null);
  const id = `extpr_${randomUUID()}`;
  const now = new Date().toISOString();

  ensureStorage().query(`
    INSERT INTO external_pull_requests
      (id, repo_id, external_source_id, external_number, title, body, status,
       base_ref, head_ref, head_sha, issue_external_id, provider_url, receipt_id,
       created_at, updated_at)
    VALUES
      ($id, $repo_id, $external_source_id, $external_number, $title, $body, 'open',
       $base_ref, $head_ref, $head_sha, $issue_external_id, $provider_url, NULL,
       $created_at, $updated_at)
  `).run({
    $id: id,
    $repo_id: repo.id,
    $external_source_id: source.id,
    $external_number: number,
    $title: title,
    $body: body,
    $base_ref: baseRef,
    $head_ref: headRef,
    $head_sha: headSha,
    $issue_external_id: issueExternalId,
    $provider_url: providerUrl,
    $created_at: now,
    $updated_at: now
  });

  return findExternalPullRequest(repo, source, number) as ExternalPullRequest;
}

export function listExternalPullRequests(repo: Repository, source: ExternalSource): ExternalPullRequest[] {
  return ensureStorage().query<ExternalPullRequest, [string, string]>(`
    SELECT id, repo_id, external_source_id, external_number, title, body, status,
           base_ref, head_ref, head_sha, issue_external_id, provider_url,
           receipt_id, created_at, updated_at
    FROM external_pull_requests
    WHERE repo_id = ? AND external_source_id = ?
    ORDER BY external_number ASC
  `).all(repo.id, source.id);
}

export function findExternalPullRequest(repo: Repository, source: ExternalSource, number: number): ExternalPullRequest | undefined {
  return ensureStorage().query<ExternalPullRequest, [string, string, number]>(`
    SELECT id, repo_id, external_source_id, external_number, title, body, status,
           base_ref, head_ref, head_sha, issue_external_id, provider_url,
           receipt_id, created_at, updated_at
    FROM external_pull_requests
    WHERE repo_id = ? AND external_source_id = ? AND external_number = ?
  `).get(repo.id, source.id, number) ?? undefined;
}

export function externalPullRequestToJson(pr: ExternalPullRequest): Record<string, unknown> {
  return {
    id: pr.id,
    repo_id: pr.repo_id,
    external_source_id: pr.external_source_id,
    external_number: pr.external_number,
    title: pr.title,
    body: pr.body,
    status: pr.status,
    base_ref: pr.base_ref,
    head_ref: pr.head_ref,
    head_sha: pr.head_sha,
    issue_external_id: pr.issue_external_id,
    provider_url: pr.provider_url,
    receipt_id: pr.receipt_id,
    canonical: {
      provider: "external",
      external_source_id: pr.external_source_id,
      external_number: pr.external_number
    },
    created_at: pr.created_at,
    updated_at: pr.updated_at
  };
}

export function syncExternalSource(repo: Repository, source: ExternalSource, actor: string): {
  source: ExternalSource;
  event: ExternalEvent | null;
} {
  const ref = `refs/heads/${source.default_branch}`;
  const oldSha = source.last_seen_default_sha;
  const now = new Date().toISOString();

  try {
    const newSha = readRemoteRef(source.remote_url, ref);
    let event: ExternalEvent | null = null;
    if (oldSha !== newSha) {
      event = recordExternalEvent(repo, source, "external_ref_update", ref, oldSha, newSha, actor);
    }

    ensureStorage().query(`
      UPDATE external_sources
      SET status = $status,
          last_seen_default_sha = $last_seen_default_sha,
          last_checked_at = $last_checked_at,
          last_error = NULL,
          updated_at = $updated_at
      WHERE id = $id
    `).run({
      $id: source.id,
      $status: event ? "changed" : "ok",
      $last_seen_default_sha: newSha,
      $last_checked_at: now,
      $updated_at: now
    });

    return { source: findExternalSource(repo, source.id) as ExternalSource, event };
  } catch (error) {
    const message = scrubError(error instanceof Error ? error.message : String(error));
    ensureStorage().query(`
      UPDATE external_sources
      SET status = 'failed',
          last_checked_at = $last_checked_at,
          last_error = $last_error,
          updated_at = $updated_at
      WHERE id = $id
    `).run({
      $id: source.id,
      $last_checked_at: now,
      $last_error: message,
      $updated_at: now
    });
    return { source: findExternalSource(repo, source.id) as ExternalSource, event: null };
  }
}

export function listExternalEvents(repo: Repository, source: ExternalSource): ExternalEvent[] {
  return ensureStorage().query<ExternalEvent, [string, string]>(`
    SELECT id, repo_id, external_source_id, event_type, ref, old_sha, new_sha,
           actor, created_at
    FROM external_source_events
    WHERE repo_id = ? AND external_source_id = ?
    ORDER BY created_at ASC
  `).all(repo.id, source.id);
}

export function createExternalReceipt(repo: Repository, source: ExternalSource, pr: ExternalPullRequest, input: {
  receipt_type?: string;
  summary?: string | null;
}): Record<string, unknown> {
  const body = {
    repo_id: repo.id,
    external_source_id: source.id,
    provider: source.provider,
    external_pr_id: pr.id,
    external_number: pr.external_number,
    external_commit_sha: pr.head_sha,
    summary: optionalText(input.summary ?? null, "summary", 4000)
  };
  const receipt = insertReceipt(repo, input.receipt_type ?? "external_source", body);
  ensureStorage().query(`
    UPDATE external_pull_requests
    SET receipt_id = $receipt_id,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: pr.id,
    $receipt_id: receipt.id,
    $updated_at: new Date().toISOString()
  });

  return receiptToJson(receipt);
}

function validateProvider(value: string): string {
  if (!["github", "gitlab", "generic_git", "local_git"].includes(value)) throw new Error("unsupported external provider");
  return value;
}

function validateExternalRemote(remoteUrl: string): void {
  if (remoteUrl.length === 0 || remoteUrl.length > 2048) throw new Error("invalid external remote_url");
  if (/[\u0000-\u001f\s]/.test(remoteUrl) || remoteUrl.startsWith("-")) {
    throw new Error("invalid external remote_url");
  }
  if (remoteUrl.startsWith("/")) return;
  if (remoteUrl.startsWith("http://") || remoteUrl.startsWith("https://")) {
    const parsed = new URL(remoteUrl);
    if (parsed.username || parsed.password) throw new Error("external credentials must not be embedded in remote_url");
    return;
  }
  if (remoteUrl.startsWith("ssh://")) return;
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:.+/.test(remoteUrl)) return;
  throw new Error("unsupported external remote_url");
}

function validateBranchName(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/.test(value) || value.includes("..")) {
    throw new Error("invalid default_branch");
  }
  return value.replace(/^refs\/heads\//, "");
}

function normalizeBranchRef(value: string): string {
  return value.startsWith("refs/heads/") ? value : `refs/heads/${validateBranchName(value)}`;
}

function readRemoteRef(remoteUrl: string, ref: string): string {
  const result = spawnSync("git", ["ls-remote", "--refs", remoteUrl, ref], {
    encoding: "utf8",
    env: gitEnv()
  });
  if (result.status !== 0) throw new Error(`git ls-remote external source failed: ${result.stderr}`);
  const [sha] = result.stdout.trim().split(/\s+/);
  if (!sha) throw new Error(`external ref ${ref} not found`);
  return sha;
}

function nextExternalPullRequestNumber(source: ExternalSource): number {
  return ensureStorage().query<{ number: number }, [string]>(`
    SELECT COALESCE(MAX(external_number), 0) + 1 AS number
    FROM external_pull_requests
    WHERE external_source_id = ?
  `).get(source.id)?.number ?? 1;
}

function requireText(value: string | undefined, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  if (value.length > maxLength) throw new Error(`${label} is too long`);
  assertSafeTextForStorage(label, value);
  return value;
}

function optionalText(value: string | null | undefined, label: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (value.length > maxLength) throw new Error(`${label} is too long`);
  assertSafeTextForStorage(label, value);
  return value;
}

function optionalExternalId(value: string | null): string | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/.test(value.replaceAll("_", "-"))) {
    throw new Error("invalid issue_external_id");
  }
  return value;
}

function optionalProviderUrl(value: string | null): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("provider_url must be http or https");
  return value;
}

function recordExternalEvent(
  repo: Repository,
  source: ExternalSource,
  eventType: string,
  ref: string | null,
  oldSha: string | null,
  newSha: string | null,
  actor: string
): ExternalEvent {
  const event: ExternalEvent = {
    id: `extevt_${randomUUID()}`,
    repo_id: repo.id,
    external_source_id: source.id,
    event_type: eventType,
    ref,
    old_sha: oldSha,
    new_sha: newSha,
    actor,
    created_at: new Date().toISOString()
  };

  ensureStorage().query(`
    INSERT INTO external_source_events
      (id, repo_id, external_source_id, event_type, ref, old_sha, new_sha,
       actor, created_at)
    VALUES
      ($id, $repo_id, $external_source_id, $event_type, $ref, $old_sha, $new_sha,
       $actor, $created_at)
  `).run({
    $id: event.id,
    $repo_id: event.repo_id,
    $external_source_id: event.external_source_id,
    $event_type: event.event_type,
    $ref: event.ref,
    $old_sha: event.old_sha,
    $new_sha: event.new_sha,
    $actor: event.actor,
    $created_at: event.created_at
  });

  return event;
}

function insertReceipt(repo: Repository, receiptType: string, body: unknown): Receipt {
  const receipt: Receipt = {
    id: `rec_${randomUUID()}`,
    repo_id: repo.id,
    deployment_id: null,
    receipt_type: receiptType,
    body_json: JSON.stringify(body),
    created_at: new Date().toISOString()
  };

  ensureStorage().query(`
    INSERT INTO receipts
      (id, repo_id, deployment_id, receipt_type, body_json, created_at)
    VALUES
      ($id, $repo_id, NULL, $receipt_type, $body_json, $created_at)
  `).run({
    $id: receipt.id,
    $repo_id: receipt.repo_id,
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

function runGit(args: string[]): void {
  const result = spawnSync("git", args, { encoding: "utf8", env: gitEnv() });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function gitEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GIT_QUARANTINE_PATH;
  return env;
}

function scrubError(message: string): string {
  return message.replace(/(https?:\/\/)([^/\s:@]+):([^@\s/]+)@/g, "$1***:***@");
}
