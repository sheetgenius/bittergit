import { randomUUID } from "node:crypto";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import type { Issue } from "./issues";
import type { PullRequest } from "./pull-requests";
import { assertSafeTextForStorage } from "./source-safety";

export type WorkflowProjection = {
  id: string;
  repo_id: string;
  provider: string;
  remote_url: string | null;
  canonical_mode: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ProjectedIssue = {
  id: string;
  repo_id: string;
  projection_id: string;
  issue_id: string;
  external_number: number;
  external_title: string;
  external_body: string;
  status: string;
  divergence_status: string;
  last_projected_at: string;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectedPullRequest = {
  id: string;
  repo_id: string;
  projection_id: string;
  pull_request_id: string;
  external_number: number;
  external_title: string;
  external_body: string;
  status: string;
  divergence_status: string;
  last_projected_at: string;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectionComment = {
  id: string;
  repo_id: string;
  projection_id: string;
  subject_type: string;
  subject_id: string;
  external_number: number;
  transition: string;
  body: string;
  created_at: string;
};

const PROVIDERS = new Set(["github"]);
const TRANSITIONS = new Set([
  "agent_started",
  "pull_request_opened",
  "verification_passed",
  "verification_failed",
  "preview_deploy_available",
  "issue_closed"
]);

export function createWorkflowProjection(repo: Repository, input: {
  provider?: string;
  remote_url?: string | null;
}, actor: string): WorkflowProjection {
  const provider = validateProvider(input.provider ?? "github");
  const remoteUrl = optionalUrl(input.remote_url ?? null);
  const now = new Date().toISOString();
  const projection: WorkflowProjection = {
    id: `workflow_projection_${randomUUID()}`,
    repo_id: repo.id,
    provider,
    remote_url: remoteUrl,
    canonical_mode: "bittergit_primary",
    status: "active",
    created_by: actor,
    created_at: now,
    updated_at: now
  };

  ensureStorage().query(`
    INSERT INTO workflow_projections
      (id, repo_id, provider, remote_url, canonical_mode, status,
       created_by, created_at, updated_at)
    VALUES
      ($id, $repo_id, $provider, $remote_url, $canonical_mode, $status,
       $created_by, $created_at, $updated_at)
  `).run({
    $id: projection.id,
    $repo_id: projection.repo_id,
    $provider: projection.provider,
    $remote_url: projection.remote_url,
    $canonical_mode: projection.canonical_mode,
    $status: projection.status,
    $created_by: projection.created_by,
    $created_at: projection.created_at,
    $updated_at: projection.updated_at
  });

  return projection;
}

export function listWorkflowProjections(repo: Repository): WorkflowProjection[] {
  return ensureStorage().query<WorkflowProjection, [string]>(`
    SELECT id, repo_id, provider, remote_url, canonical_mode, status,
           created_by, created_at, updated_at
    FROM workflow_projections
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id);
}

export function findWorkflowProjection(repo: Repository, id: string): WorkflowProjection | undefined {
  return ensureStorage().query<WorkflowProjection, [string, string]>(`
    SELECT id, repo_id, provider, remote_url, canonical_mode, status,
           created_by, created_at, updated_at
    FROM workflow_projections
    WHERE repo_id = ? AND id = ?
  `).get(repo.id, id) ?? undefined;
}

export function projectIssue(repo: Repository, projection: WorkflowProjection, issue: Issue): {
  projected_issue: ProjectedIssue;
  created: boolean;
} {
  ensureActive(projection);
  const title = issue.title;
  const body = issueProjectionBody(repo, issue);
  const now = new Date().toISOString();
  const existing = findProjectedIssueByIssueId(repo, projection, issue.id);

  if (existing) {
    ensureStorage().query(`
      UPDATE workflow_projected_issues
      SET external_title = $external_title,
          external_body = $external_body,
          status = $status,
          divergence_status = 'in_sync',
          last_projected_at = $last_projected_at,
          updated_at = $updated_at
      WHERE id = $id
    `).run({
      $id: existing.id,
      $external_title: title,
      $external_body: body,
      $status: issue.status,
      $last_projected_at: now,
      $updated_at: now
    });
    return {
      projected_issue: findProjectedIssueByIssueId(repo, projection, issue.id) as ProjectedIssue,
      created: false
    };
  }

  const id = `projected_issue_${randomUUID()}`;
  const externalNumber = nextExternalNumber(projection);
  ensureStorage().query(`
    INSERT INTO workflow_projected_issues
      (id, repo_id, projection_id, issue_id, external_number, external_title,
       external_body, status, divergence_status, last_projected_at,
       last_checked_at, created_at, updated_at)
    VALUES
      ($id, $repo_id, $projection_id, $issue_id, $external_number, $external_title,
       $external_body, $status, 'in_sync', $last_projected_at,
       NULL, $created_at, $updated_at)
  `).run({
    $id: id,
    $repo_id: repo.id,
    $projection_id: projection.id,
    $issue_id: issue.id,
    $external_number: externalNumber,
    $external_title: title,
    $external_body: body,
    $status: issue.status,
    $last_projected_at: now,
    $created_at: now,
    $updated_at: now
  });

  return {
    projected_issue: findProjectedIssueByIssueId(repo, projection, issue.id) as ProjectedIssue,
    created: true
  };
}

export function projectPullRequest(repo: Repository, projection: WorkflowProjection, pr: PullRequest): {
  projected_pull_request: ProjectedPullRequest;
  created: boolean;
} {
  ensureActive(projection);
  const title = pr.title;
  const body = pullRequestProjectionBody(repo, pr);
  const now = new Date().toISOString();
  const existing = findProjectedPullRequestByPullRequestId(repo, projection, pr.id);

  if (existing) {
    ensureStorage().query(`
      UPDATE workflow_projected_pull_requests
      SET external_title = $external_title,
          external_body = $external_body,
          status = $status,
          divergence_status = 'in_sync',
          last_projected_at = $last_projected_at,
          updated_at = $updated_at
      WHERE id = $id
    `).run({
      $id: existing.id,
      $external_title: title,
      $external_body: body,
      $status: pr.status,
      $last_projected_at: now,
      $updated_at: now
    });
    return {
      projected_pull_request: findProjectedPullRequestByPullRequestId(repo, projection, pr.id) as ProjectedPullRequest,
      created: false
    };
  }

  const id = `projected_pr_${randomUUID()}`;
  const externalNumber = nextExternalNumber(projection);
  ensureStorage().query(`
    INSERT INTO workflow_projected_pull_requests
      (id, repo_id, projection_id, pull_request_id, external_number,
       external_title, external_body, status, divergence_status,
       last_projected_at, last_checked_at, created_at, updated_at)
    VALUES
      ($id, $repo_id, $projection_id, $pull_request_id, $external_number,
       $external_title, $external_body, $status, 'in_sync',
       $last_projected_at, NULL, $created_at, $updated_at)
  `).run({
    $id: id,
    $repo_id: repo.id,
    $projection_id: projection.id,
    $pull_request_id: pr.id,
    $external_number: externalNumber,
    $external_title: title,
    $external_body: body,
    $status: pr.status,
    $last_projected_at: now,
    $created_at: now,
    $updated_at: now
  });

  return {
    projected_pull_request: findProjectedPullRequestByPullRequestId(repo, projection, pr.id) as ProjectedPullRequest,
    created: true
  };
}

export function addProjectionComment(repo: Repository, projection: WorkflowProjection, input: {
  subject_type?: string;
  subject_number?: number;
  transition?: string;
  summary?: string | null;
}): {
  comment: ProjectionComment;
  created: boolean;
} {
  ensureActive(projection);
  const subjectType = validateSubjectType(input.subject_type);
  const transition = validateTransition(input.transition);
  const summary = optionalText(input.summary ?? null, "summary", 2000);
  const subject = findProjectedSubject(repo, projection, subjectType, input.subject_number);
  const body = projectionCommentBody(subjectType, subject.subject_id, subject.external_number, transition, summary);
  const existing = findProjectionComment(projection, subjectType, subject.subject_id, transition);
  if (existing) return { comment: existing, created: false };

  const now = new Date().toISOString();
  const comment: ProjectionComment = {
    id: `projection_comment_${randomUUID()}`,
    repo_id: repo.id,
    projection_id: projection.id,
    subject_type: subjectType,
    subject_id: subject.subject_id,
    external_number: subject.external_number,
    transition,
    body,
    created_at: now
  };

  ensureStorage().query(`
    INSERT INTO workflow_projection_comments
      (id, repo_id, projection_id, subject_type, subject_id, external_number,
       transition, body, created_at)
    VALUES
      ($id, $repo_id, $projection_id, $subject_type, $subject_id, $external_number,
       $transition, $body, $created_at)
  `).run({
    $id: comment.id,
    $repo_id: comment.repo_id,
    $projection_id: comment.projection_id,
    $subject_type: comment.subject_type,
    $subject_id: comment.subject_id,
    $external_number: comment.external_number,
    $transition: comment.transition,
    $body: comment.body,
    $created_at: comment.created_at
  });

  return { comment, created: true };
}

export function simulateExternalIssueEdit(repo: Repository, projection: WorkflowProjection, externalNumber: number, input: {
  title?: string;
  body?: string;
}): ProjectedIssue {
  const projected = findProjectedIssueByExternalNumber(repo, projection, externalNumber);
  if (!projected) throw new Error("projected issue not found");
  const title = input.title === undefined ? projected.external_title : requireText(input.title, "title", 240);
  const body = input.body === undefined ? projected.external_body : requireText(input.body, "body", 20_000);
  const now = new Date().toISOString();
  ensureStorage().query(`
    UPDATE workflow_projected_issues
    SET external_title = $external_title,
        external_body = $external_body,
        divergence_status = 'external_edit_unchecked',
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: projected.id,
    $external_title: title,
    $external_body: body,
    $updated_at: now
  });

  return findProjectedIssueByExternalNumber(repo, projection, externalNumber) as ProjectedIssue;
}

export function simulateExternalPullRequestEdit(repo: Repository, projection: WorkflowProjection, externalNumber: number, input: {
  title?: string;
  body?: string;
}): ProjectedPullRequest {
  const projected = findProjectedPullRequestByExternalNumber(repo, projection, externalNumber);
  if (!projected) throw new Error("projected pull request not found");
  const title = input.title === undefined ? projected.external_title : requireText(input.title, "title", 240);
  const body = input.body === undefined ? projected.external_body : requireText(input.body, "body", 20_000);
  const now = new Date().toISOString();
  ensureStorage().query(`
    UPDATE workflow_projected_pull_requests
    SET external_title = $external_title,
        external_body = $external_body,
        divergence_status = 'external_edit_unchecked',
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: projected.id,
    $external_title: title,
    $external_body: body,
    $updated_at: now
  });

  return findProjectedPullRequestByExternalNumber(repo, projection, externalNumber) as ProjectedPullRequest;
}

export function syncWorkflowProjection(repo: Repository, projection: WorkflowProjection): {
  projection: WorkflowProjection;
  checked_issues: number;
  checked_pull_requests: number;
  divergent: number;
} {
  ensureActive(projection);
  const db = ensureStorage();
  const now = new Date().toISOString();
  let divergent = 0;

  const issues = listProjectedIssues(projection);
  for (const projected of issues) {
    const issue = findIssueById(repo, projected.issue_id);
    const expectedBody = issue ? issueProjectionBody(repo, issue) : null;
    const expectedTitle = issue?.title ?? null;
    const status = expectedBody === projected.external_body && expectedTitle === projected.external_title
      ? "in_sync"
      : "diverged";
    if (status === "diverged") divergent += 1;
    db.query(`
      UPDATE workflow_projected_issues
      SET divergence_status = $divergence_status,
          last_checked_at = $last_checked_at,
          updated_at = $updated_at
      WHERE id = $id
    `).run({
      $id: projected.id,
      $divergence_status: status,
      $last_checked_at: now,
      $updated_at: now
    });
  }

  const pullRequests = listProjectedPullRequests(projection);
  for (const projected of pullRequests) {
    const pr = findPullRequestById(repo, projected.pull_request_id);
    const expectedBody = pr ? pullRequestProjectionBody(repo, pr) : null;
    const expectedTitle = pr?.title ?? null;
    const status = expectedBody === projected.external_body && expectedTitle === projected.external_title
      ? "in_sync"
      : "diverged";
    if (status === "diverged") divergent += 1;
    db.query(`
      UPDATE workflow_projected_pull_requests
      SET divergence_status = $divergence_status,
          last_checked_at = $last_checked_at,
          updated_at = $updated_at
      WHERE id = $id
    `).run({
      $id: projected.id,
      $divergence_status: status,
      $last_checked_at: now,
      $updated_at: now
    });
  }

  const status = divergent === 0 ? "active" : "diverged";
  db.query(`
    UPDATE workflow_projections
    SET status = $status,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: projection.id,
    $status: status,
    $updated_at: now
  });

  return {
    projection: findWorkflowProjection(repo, projection.id) as WorkflowProjection,
    checked_issues: issues.length,
    checked_pull_requests: pullRequests.length,
    divergent
  };
}

export function workflowProjectionToJson(repo: Repository, projection: WorkflowProjection): Record<string, unknown> {
  const projectedIssues = listProjectedIssues(projection);
  const projectedPullRequests = listProjectedPullRequests(projection);
  return {
    id: projection.id,
    repo_id: projection.repo_id,
    provider: projection.provider,
    remote_url: projection.remote_url,
    canonical_mode: projection.canonical_mode,
    source_of_truth: "bittergit",
    status: projection.status,
    created_by: projection.created_by,
    created_at: projection.created_at,
    updated_at: projection.updated_at,
    projected_issues: projectedIssues.map(projectedIssueToJson),
    projected_pull_requests: projectedPullRequests.map(projectedPullRequestToJson),
    comments: listProjectionComments(projection),
    policy: {
      github_numbers_canonical: false,
      default_merge_path: "bittergit",
      direct_external_edits: "mark_divergent"
    },
    repository: {
      owner: repo.owner,
      name: repo.name
    }
  };
}

export function projectedIssueToJson(projected: ProjectedIssue): Record<string, unknown> {
  return {
    id: projected.id,
    issue_id: projected.issue_id,
    external_number: projected.external_number,
    external_title: projected.external_title,
    external_body: projected.external_body,
    status: projected.status,
    divergence_status: projected.divergence_status,
    canonical: {
      provider: "bittergit",
      issue_id: projected.issue_id
    },
    external: {
      provider: "github",
      number: projected.external_number,
      canonical: false
    },
    last_projected_at: projected.last_projected_at,
    last_checked_at: projected.last_checked_at,
    created_at: projected.created_at,
    updated_at: projected.updated_at
  };
}

export function projectedPullRequestToJson(projected: ProjectedPullRequest): Record<string, unknown> {
  return {
    id: projected.id,
    pull_request_id: projected.pull_request_id,
    external_number: projected.external_number,
    external_title: projected.external_title,
    external_body: projected.external_body,
    status: projected.status,
    divergence_status: projected.divergence_status,
    canonical: {
      provider: "bittergit",
      pull_request_id: projected.pull_request_id
    },
    external: {
      provider: "github",
      number: projected.external_number,
      canonical: false
    },
    last_projected_at: projected.last_projected_at,
    last_checked_at: projected.last_checked_at,
    created_at: projected.created_at,
    updated_at: projected.updated_at
  };
}

function issueProjectionBody(repo: Repository, issue: Issue): string {
  const body = [
    "# Issue",
    "",
    issue.body ?? "",
    "",
    "## Bitter",
    "Source of truth: Bitter",
    `Repository: ${repo.owner}/${repo.name}`,
    `Canonical issue: ${issue.id}`,
    `Bitter issue number: #${issue.number}`,
    `Status: ${issue.status}`,
    "",
    `<!-- bitter:issue_id=${issue.id} -->`
  ].join("\n");
  assertSafeTextForStorage("projected issue body", body);
  return body;
}

function pullRequestProjectionBody(repo: Repository, pr: PullRequest): string {
  const body = [
    "# Pull Request",
    "",
    pr.body ?? "",
    "",
    "## Summary",
    `Base: ${pr.base_ref}`,
    `Head: ${pr.head_ref}`,
    `Commit range: ${pr.base_sha}..${pr.head_sha}`,
    pr.issue_id ? `Linked Bitter issue ID: ${pr.issue_id}` : "Linked Bitter issue ID: none",
    "",
    "## Verification",
    `Status: ${pr.verification_status ?? "not_reported"}`,
    pr.verification_summary ? `Summary: ${pr.verification_summary}` : "Summary: none",
    pr.preview_url ? `Preview deploy: ${pr.preview_url}` : "Preview deploy: none",
    pr.receipt_id ? `Receipt: ${pr.receipt_id}` : "Receipt: none",
    "",
    "## Bitter provenance",
    "Source of truth: Bitter",
    `Repository: ${repo.owner}/${repo.name}`,
    `Canonical PR: ${pr.id}`,
    `Bitter PR number: #${pr.number}`,
    "Default merge path: BitterGit",
    "GitHub merge button is not canonical in BitterGit-primary mode.",
    "",
    `<!-- bitter:pull_request_id=${pr.id} -->`
  ].join("\n");
  assertSafeTextForStorage("projected pull request body", body);
  return body;
}

function projectionCommentBody(
  subjectType: string,
  subjectId: string,
  externalNumber: number,
  transition: string,
  summary: string | null
): string {
  const subjectLabel = subjectType === "issue" ? "issue" : "pull request";
  const markerKey = subjectType === "issue" ? "issue_id" : "pull_request_id";
  const body = [
    `Bitter transition: ${transition}`,
    `Canonical ${subjectLabel}: ${subjectId}`,
    `Projected GitHub number: #${externalNumber}`,
    summary ? `Summary: ${summary}` : "Summary: none",
    "",
    `<!-- bitter:projection_comment transition=${transition} ${markerKey}=${subjectId} -->`
  ].join("\n");
  assertSafeTextForStorage("projection comment body", body);
  return body;
}

function listProjectedIssues(projection: WorkflowProjection): ProjectedIssue[] {
  return ensureStorage().query<ProjectedIssue, [string]>(`
    SELECT id, repo_id, projection_id, issue_id, external_number, external_title,
           external_body, status, divergence_status, last_projected_at,
           last_checked_at, created_at, updated_at
    FROM workflow_projected_issues
    WHERE projection_id = ?
    ORDER BY external_number ASC
  `).all(projection.id);
}

function listProjectedPullRequests(projection: WorkflowProjection): ProjectedPullRequest[] {
  return ensureStorage().query<ProjectedPullRequest, [string]>(`
    SELECT id, repo_id, projection_id, pull_request_id, external_number,
           external_title, external_body, status, divergence_status,
           last_projected_at, last_checked_at, created_at, updated_at
    FROM workflow_projected_pull_requests
    WHERE projection_id = ?
    ORDER BY external_number ASC
  `).all(projection.id);
}

function listProjectionComments(projection: WorkflowProjection): ProjectionComment[] {
  return ensureStorage().query<ProjectionComment, [string]>(`
    SELECT id, repo_id, projection_id, subject_type, subject_id, external_number,
           transition, body, created_at
    FROM workflow_projection_comments
    WHERE projection_id = ?
    ORDER BY created_at ASC
  `).all(projection.id);
}

function findProjectedIssueByIssueId(
  repo: Repository,
  projection: WorkflowProjection,
  issueId: string
): ProjectedIssue | undefined {
  return ensureStorage().query<ProjectedIssue, [string, string, string]>(`
    SELECT id, repo_id, projection_id, issue_id, external_number, external_title,
           external_body, status, divergence_status, last_projected_at,
           last_checked_at, created_at, updated_at
    FROM workflow_projected_issues
    WHERE repo_id = ? AND projection_id = ? AND issue_id = ?
  `).get(repo.id, projection.id, issueId) ?? undefined;
}

function findProjectedIssueByExternalNumber(
  repo: Repository,
  projection: WorkflowProjection,
  externalNumber: number
): ProjectedIssue | undefined {
  return ensureStorage().query<ProjectedIssue, [string, string, number]>(`
    SELECT id, repo_id, projection_id, issue_id, external_number, external_title,
           external_body, status, divergence_status, last_projected_at,
           last_checked_at, created_at, updated_at
    FROM workflow_projected_issues
    WHERE repo_id = ? AND projection_id = ? AND external_number = ?
  `).get(repo.id, projection.id, externalNumber) ?? undefined;
}

function findProjectedPullRequestByPullRequestId(
  repo: Repository,
  projection: WorkflowProjection,
  pullRequestId: string
): ProjectedPullRequest | undefined {
  return ensureStorage().query<ProjectedPullRequest, [string, string, string]>(`
    SELECT id, repo_id, projection_id, pull_request_id, external_number,
           external_title, external_body, status, divergence_status,
           last_projected_at, last_checked_at, created_at, updated_at
    FROM workflow_projected_pull_requests
    WHERE repo_id = ? AND projection_id = ? AND pull_request_id = ?
  `).get(repo.id, projection.id, pullRequestId) ?? undefined;
}

function findProjectedPullRequestByExternalNumber(
  repo: Repository,
  projection: WorkflowProjection,
  externalNumber: number
): ProjectedPullRequest | undefined {
  return ensureStorage().query<ProjectedPullRequest, [string, string, number]>(`
    SELECT id, repo_id, projection_id, pull_request_id, external_number,
           external_title, external_body, status, divergence_status,
           last_projected_at, last_checked_at, created_at, updated_at
    FROM workflow_projected_pull_requests
    WHERE repo_id = ? AND projection_id = ? AND external_number = ?
  `).get(repo.id, projection.id, externalNumber) ?? undefined;
}

function findProjectedSubject(
  repo: Repository,
  projection: WorkflowProjection,
  subjectType: string,
  subjectNumber: number | undefined
): { subject_id: string; external_number: number } {
  if (!Number.isInteger(subjectNumber) || Number(subjectNumber) <= 0) {
    throw new Error("subject_number is required");
  }

  if (subjectType === "issue") {
    const projected = findProjectedIssueByExternalNumber(repo, projection, Number(subjectNumber));
    if (!projected) throw new Error("projected issue not found");
    return { subject_id: projected.issue_id, external_number: projected.external_number };
  }

  const projected = findProjectedPullRequestByExternalNumber(repo, projection, Number(subjectNumber));
  if (!projected) throw new Error("projected pull request not found");
  return { subject_id: projected.pull_request_id, external_number: projected.external_number };
}

function findProjectionComment(
  projection: WorkflowProjection,
  subjectType: string,
  subjectId: string,
  transition: string
): ProjectionComment | undefined {
  return ensureStorage().query<ProjectionComment, [string, string, string, string]>(`
    SELECT id, repo_id, projection_id, subject_type, subject_id, external_number,
           transition, body, created_at
    FROM workflow_projection_comments
    WHERE projection_id = ? AND subject_type = ? AND subject_id = ? AND transition = ?
  `).get(projection.id, subjectType, subjectId, transition) ?? undefined;
}

function findIssueById(repo: Repository, issueId: string): Issue | undefined {
  return ensureStorage().query<Issue, [string, string]>(`
    SELECT id, repo_id, number, title, body, status, external_provider,
           external_id, created_by, closed_by, created_at, updated_at, closed_at
    FROM issues
    WHERE repo_id = ? AND id = ?
  `).get(repo.id, issueId) ?? undefined;
}

function findPullRequestById(repo: Repository, pullRequestId: string): PullRequest | undefined {
  return ensureStorage().query<PullRequest, [string, string]>(`
    SELECT id, repo_id, number, title, body, status, base_ref, head_ref, base_sha,
           head_sha, issue_id, require_verification, verification_status,
           verification_summary, preview_url, deployment_id, receipt_id,
           merge_method, merge_commit_sha, merged_by, merged_at, closed_by,
           closed_at, created_by, created_at, updated_at
    FROM pull_requests
    WHERE repo_id = ? AND id = ?
  `).get(repo.id, pullRequestId) ?? undefined;
}

function nextExternalNumber(projection: WorkflowProjection): number {
  return ensureStorage().query<{ number: number }, [string, string]>(`
    SELECT COALESCE(MAX(external_number), 0) + 1 AS number
    FROM (
      SELECT external_number FROM workflow_projected_issues WHERE projection_id = ?
      UNION ALL
      SELECT external_number FROM workflow_projected_pull_requests WHERE projection_id = ?
    )
  `).get(projection.id, projection.id)?.number ?? 1;
}

function validateProvider(provider: string): string {
  if (!PROVIDERS.has(provider)) throw new Error("invalid workflow projection provider");
  return provider;
}

function validateSubjectType(subjectType: string | undefined): string {
  if (subjectType !== "issue" && subjectType !== "pull_request") {
    throw new Error("invalid subject_type");
  }
  return subjectType;
}

function validateTransition(transition: string | undefined): string {
  if (!transition || !TRANSITIONS.has(transition)) {
    throw new Error("invalid projection transition");
  }
  return transition;
}

function requireText(value: string | undefined, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  if (value.length > maxLength) throw new Error(`${label} is too long`);
  assertSafeTextForStorage(label, value);
  return value;
}

function optionalText(value: string | null, label: string, maxLength: number): string | null {
  if (value === null || value.length === 0) return null;
  if (value.length > maxLength) throw new Error(`${label} is too long`);
  assertSafeTextForStorage(label, value);
  return value;
}

function optionalUrl(value: string | null): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("remote_url must be http or https");
  }
  return value;
}

function ensureActive(projection: WorkflowProjection): void {
  if (projection.status === "disabled") throw new Error("workflow projection is disabled");
}
