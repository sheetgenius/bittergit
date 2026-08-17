import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import { recordRefUpdate } from "./events";
import { findDeployment, findReceipt } from "./deployments";
import { addIssueLink, findIssueByNumber, type Issue } from "./issues";
import { assertSafeTextForStorage } from "./source-safety";
import { syncMirrors } from "./mirrors";

export type PullRequest = {
  id: string;
  repo_id: string;
  number: number;
  title: string;
  body: string | null;
  status: string;
  base_ref: string;
  head_ref: string;
  base_sha: string;
  head_sha: string;
  issue_id: string | null;
  require_verification: number;
  verification_status: string | null;
  verification_summary: string | null;
  preview_url: string | null;
  deployment_id: string | null;
  receipt_id: string | null;
  merge_method: string | null;
  merge_commit_sha: string | null;
  merged_by: string | null;
  merged_at: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type PullRequestMerge = {
  id: string;
  repo_id: string;
  pull_request_id: string;
  old_base_sha: string;
  head_sha: string;
  new_base_sha: string;
  merge_method: string;
  actor: string;
  created_at: string;
};

export function createPullRequest(repo: Repository, input: {
  title?: string;
  body?: string | null;
  base_ref?: string;
  head_ref?: string;
  issue_number?: number | null;
  require_verification?: boolean;
}, actor: string): PullRequest {
  const title = requireText(input.title, "title", 240);
  const body = optionalText(input.body ?? null, "body", 20_000);
  const baseRef = normalizeBranchRef(input.base_ref ?? "main");
  const headRef = normalizeBranchRef(requireText(input.head_ref, "head_ref", 300));
  if (baseRef === headRef) throw new Error("base_ref and head_ref must differ");

  const baseSha = resolveRef(repo, baseRef);
  const headSha = resolveRef(repo, headRef);
  if (baseSha === headSha) throw new Error("pull request has no source changes");

  const issue = input.issue_number ? findIssueByNumber(repo, input.issue_number) : undefined;
  if (input.issue_number && !issue) throw new Error(`issue ${input.issue_number} not found`);

  const db = ensureStorage();
  const now = new Date().toISOString();
  const pr = db.transaction(() => {
    const next = db.query<{ number: number }, [string]>(`
      SELECT COALESCE(MAX(number), 0) + 1 AS number
      FROM pull_requests
      WHERE repo_id = ?
    `).get(repo.id)?.number ?? 1;
    const id = `pr_${randomUUID()}`;

    db.query(`
      INSERT INTO pull_requests
        (id, repo_id, number, title, body, status, base_ref, head_ref, base_sha,
         head_sha, issue_id, require_verification, verification_status,
         verification_summary, preview_url, deployment_id, receipt_id,
         merge_method, merge_commit_sha, merged_by, merged_at, closed_by,
         closed_at, created_by, created_at, updated_at)
      VALUES
        ($id, $repo_id, $number, $title, $body, 'open', $base_ref, $head_ref, $base_sha,
         $head_sha, $issue_id, $require_verification, NULL,
         NULL, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL, NULL,
         NULL, $created_by, $created_at, $updated_at)
    `).run({
      $id: id,
      $repo_id: repo.id,
      $number: next,
      $title: title,
      $body: body,
      $base_ref: baseRef,
      $head_ref: headRef,
      $base_sha: baseSha,
      $head_sha: headSha,
      $issue_id: issue?.id ?? null,
      $require_verification: input.require_verification === false ? 0 : 1,
      $created_by: actor,
      $created_at: now,
      $updated_at: now
    });

    return findPullRequestByNumber(repo, next) as PullRequest;
  })();

  if (issue) linkIssueToPullRequest(repo, issue, pr, actor);
  return pr;
}

export function listPullRequests(repo: Repository): PullRequest[] {
  return ensureStorage().query<PullRequest, [string]>(`
    SELECT id, repo_id, number, title, body, status, base_ref, head_ref, base_sha,
           head_sha, issue_id, require_verification, verification_status,
           verification_summary, preview_url, deployment_id, receipt_id,
           merge_method, merge_commit_sha, merged_by, merged_at, closed_by,
           closed_at, created_by, created_at, updated_at
    FROM pull_requests
    WHERE repo_id = ?
    ORDER BY number ASC
  `).all(repo.id);
}

export function findPullRequestByNumber(repo: Repository, number: number): PullRequest | undefined {
  return ensureStorage().query<PullRequest, [string, number]>(`
    SELECT id, repo_id, number, title, body, status, base_ref, head_ref, base_sha,
           head_sha, issue_id, require_verification, verification_status,
           verification_summary, preview_url, deployment_id, receipt_id,
           merge_method, merge_commit_sha, merged_by, merged_at, closed_by,
           closed_at, created_by, created_at, updated_at
    FROM pull_requests
    WHERE repo_id = ? AND number = ?
  `).get(repo.id, number) ?? undefined;
}

export function updatePullRequestVerification(repo: Repository, pr: PullRequest, input: {
  status?: string;
  summary?: string | null;
  preview_url?: string | null;
  deployment_id?: string | null;
  receipt_id?: string | null;
}): PullRequest {
  if (pr.status !== "open") throw new Error("pull request is not open");

  const status = validateVerificationStatus(input.status);
  const summary = optionalText(input.summary ?? null, "summary", 4000);
  const previewUrl = optionalPreviewUrl(input.preview_url ?? null);
  if (input.deployment_id && !findDeployment(repo, input.deployment_id)) {
    throw new Error(`deployment ${input.deployment_id} not found`);
  }
  if (input.receipt_id && !findReceipt(repo, input.receipt_id)) {
    throw new Error(`receipt ${input.receipt_id} not found`);
  }

  ensureStorage().query(`
    UPDATE pull_requests
    SET verification_status = $verification_status,
        verification_summary = $verification_summary,
        preview_url = $preview_url,
        deployment_id = $deployment_id,
        receipt_id = $receipt_id,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: pr.id,
    $verification_status: status,
    $verification_summary: summary,
    $preview_url: previewUrl,
    $deployment_id: input.deployment_id ?? null,
    $receipt_id: input.receipt_id ?? null,
    $updated_at: new Date().toISOString()
  });

  return findPullRequestByNumber(repo, pr.number) as PullRequest;
}

export function mergePullRequest(repo: Repository, pr: PullRequest, actor: string): {
  pull_request: PullRequest;
  merge: PullRequestMerge;
} {
  if (pr.status !== "open") throw new Error("pull request is not open");
  if (pr.require_verification === 1 && pr.verification_status !== "passed") {
    throw new Error("pull request requires passed verification before merge");
  }

  const oldBaseSha = resolveRef(repo, pr.base_ref);
  const headSha = resolveRef(repo, pr.head_ref);
  if (!isAncestor(repo, oldBaseSha, headSha)) {
    throw new Error("pull request is not fast-forwardable; rebase head branch first");
  }

  updateRef(repo, pr.base_ref, headSha, oldBaseSha);
  recordRefUpdate(repo, oldBaseSha, headSha, pr.base_ref, actor);
  syncMirrors(repo, "pull-request-merge");

  const now = new Date().toISOString();
  const merge: PullRequestMerge = {
    id: `pr_merge_${randomUUID()}`,
    repo_id: repo.id,
    pull_request_id: pr.id,
    old_base_sha: oldBaseSha,
    head_sha: headSha,
    new_base_sha: headSha,
    merge_method: "fast_forward",
    actor,
    created_at: now
  };

  const db = ensureStorage();
  db.transaction(() => {
    db.query(`
      INSERT INTO pull_request_merges
        (id, repo_id, pull_request_id, old_base_sha, head_sha, new_base_sha,
         merge_method, actor, created_at)
      VALUES
        ($id, $repo_id, $pull_request_id, $old_base_sha, $head_sha, $new_base_sha,
         $merge_method, $actor, $created_at)
    `).run({
      $id: merge.id,
      $repo_id: merge.repo_id,
      $pull_request_id: merge.pull_request_id,
      $old_base_sha: merge.old_base_sha,
      $head_sha: merge.head_sha,
      $new_base_sha: merge.new_base_sha,
      $merge_method: merge.merge_method,
      $actor: merge.actor,
      $created_at: merge.created_at
    });

    db.query(`
      UPDATE pull_requests
      SET status = 'merged',
          base_sha = $old_base_sha,
          head_sha = $head_sha,
          merge_method = $merge_method,
          merge_commit_sha = $merge_commit_sha,
          merged_by = $merged_by,
          merged_at = $merged_at,
          updated_at = $updated_at
      WHERE id = $id
    `).run({
      $id: pr.id,
      $old_base_sha: oldBaseSha,
      $head_sha: headSha,
      $merge_method: "fast_forward",
      $merge_commit_sha: headSha,
      $merged_by: actor,
      $merged_at: now,
      $updated_at: now
    });
  })();

  return {
    pull_request: findPullRequestByNumber(repo, pr.number) as PullRequest,
    merge
  };
}

export function closePullRequest(repo: Repository, pr: PullRequest, actor: string): PullRequest {
  if (pr.status !== "open") throw new Error("pull request is not open");
  const now = new Date().toISOString();
  ensureStorage().query(`
    UPDATE pull_requests
    SET status = 'closed',
        closed_by = $closed_by,
        closed_at = $closed_at,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: pr.id,
    $closed_by: actor,
    $closed_at: now,
    $updated_at: now
  });

  return findPullRequestByNumber(repo, pr.number) as PullRequest;
}

export function pullRequestToJson(repo: Repository, pr: PullRequest): Record<string, unknown> {
  return {
    id: pr.id,
    repo_id: pr.repo_id,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    status: pr.status,
    base_ref: pr.base_ref,
    head_ref: pr.head_ref,
    base_sha: pr.base_sha,
    head_sha: pr.head_sha,
    commit_range: `${pr.base_sha}..${pr.head_sha}`,
    issue_id: pr.issue_id,
    require_verification: pr.require_verification === 1,
    verification_status: pr.verification_status,
    verification_summary: pr.verification_summary,
    preview_url: pr.preview_url,
    deployment_id: pr.deployment_id,
    receipt_id: pr.receipt_id,
    diff_stat: diffStat(repo, pr),
    commits: commits(repo, pr),
    merge_method: pr.merge_method,
    merge_commit_sha: pr.merge_commit_sha,
    merged_by: pr.merged_by,
    merged_at: pr.merged_at,
    closed_by: pr.closed_by,
    closed_at: pr.closed_at,
    created_by: pr.created_by,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    merges: listPullRequestMerges(repo, pr)
  };
}

function listPullRequestMerges(repo: Repository, pr: PullRequest): PullRequestMerge[] {
  return ensureStorage().query<PullRequestMerge, [string, string]>(`
    SELECT id, repo_id, pull_request_id, old_base_sha, head_sha, new_base_sha,
           merge_method, actor, created_at
    FROM pull_request_merges
    WHERE repo_id = ? AND pull_request_id = ?
    ORDER BY created_at ASC
  `).all(repo.id, pr.id);
}

function linkIssueToPullRequest(repo: Repository, issue: Issue, pr: PullRequest, actor: string): void {
  addIssueLink(repo, issue, {
    link_type: "pull_request",
    target_id: pr.id,
    target_ref: pr.head_ref,
    target_sha: pr.head_sha,
    metadata: { pull_request_number: pr.number }
  }, actor);
}

function diffStat(repo: Repository, pr: PullRequest): string {
  const result = spawnSync("git", [
    "--git-dir",
    repo.storage_path,
    "diff",
    "--stat",
    `${pr.base_sha}..${pr.head_sha}`
  ], { encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}

function commits(repo: Repository, pr: PullRequest): Array<{ sha: string; subject: string }> {
  const result = spawnSync("git", [
    "--git-dir",
    repo.storage_path,
    "log",
    "--reverse",
    "--format=%H%x00%s",
    `${pr.base_sha}..${pr.head_sha}`
  ], { encoding: "utf8" });
  if (result.status !== 0) return [];

  return result.stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha, subject] = line.split("\u0000");
      return { sha, subject };
    });
}

function requireText(value: string | undefined, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
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

function validateVerificationStatus(value: string | undefined): string {
  if (!value || !["passed", "failed", "pending"].includes(value)) {
    throw new Error("invalid verification status");
  }
  return value;
}

function optionalPreviewUrl(value: string | null): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("preview_url must be http or https");
  }
  return value;
}

function normalizeBranchRef(value: string): string {
  const ref = value.startsWith("refs/heads/") ? value : `refs/heads/${value}`;
  if (!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,240}$/.test(ref) || ref.includes("..")) {
    throw new Error("invalid branch ref");
  }
  return ref;
}

function resolveRef(repo: Repository, ref: string): string {
  const result = spawnSync("git", ["--git-dir", repo.storage_path, "rev-parse", "--verify", ref], {
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(`cannot resolve ${ref}`);
  return result.stdout.trim();
}

function isAncestor(repo: Repository, ancestor: string, descendant: string): boolean {
  const result = spawnSync("git", ["--git-dir", repo.storage_path, "merge-base", "--is-ancestor", ancestor, descendant], {
    encoding: "utf8"
  });
  return result.status === 0;
}

function updateRef(repo: Repository, ref: string, newSha: string, oldSha: string): void {
  const result = spawnSync("git", ["--git-dir", repo.storage_path, "update-ref", ref, newSha, oldSha], {
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(`git update-ref failed: ${result.stderr}`);
}
