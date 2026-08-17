import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import { commitExists, findCheckpoint } from "./checkpoints";
import { findDeployment, findReceipt } from "./deployments";
import { assertSafeTextForStorage } from "./source-safety";

export type Issue = {
  id: string;
  repo_id: string;
  number: number;
  title: string;
  body: string | null;
  status: string;
  external_provider: string | null;
  external_id: string | null;
  created_by: string;
  closed_by: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type IssueComment = {
  id: string;
  repo_id: string;
  issue_id: string;
  actor: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type IssueLink = {
  id: string;
  repo_id: string;
  issue_id: string;
  link_type: string;
  target_id: string | null;
  target_ref: string | null;
  target_sha: string | null;
  metadata_json: string;
  actor: string;
  created_at: string;
};

type LinkInput = {
  link_type?: string;
  target_id?: string | null;
  target_ref?: string | null;
  target_sha?: string | null;
  metadata?: unknown;
};

const ISSUE_STATUSES = new Set(["open", "closed"]);
const LINK_TYPES = new Set([
  "agent_run",
  "branch",
  "checkpoint",
  "commit",
  "deployment",
  "mirror",
  "pull_request",
  "receipt",
  "ref"
]);

export function createIssue(repo: Repository, input: {
  title?: string;
  body?: string | null;
  external_provider?: string | null;
  external_id?: string | null;
}, actor: string): Issue {
  const title = requireText(input.title, "title", 240);
  const body = optionalText(input.body ?? null, "body", 20_000);
  const externalProvider = optionalIdentifier(input.external_provider ?? null, "external_provider");
  const externalId = optionalIdentifier(input.external_id ?? null, "external_id");
  if ((externalProvider && !externalId) || (!externalProvider && externalId)) {
    throw new Error("external_provider and external_id must be provided together");
  }

  const db = ensureStorage();
  const now = new Date().toISOString();
  const issue: Issue = db.transaction(() => {
    const next = db.query<{ number: number }, [string]>(`
      SELECT COALESCE(MAX(number), 0) + 1 AS number
      FROM issues
      WHERE repo_id = ?
    `).get(repo.id)?.number ?? 1;
    const id = `issue_${randomUUID()}`;

    db.query(`
      INSERT INTO issues
        (id, repo_id, number, title, body, status, external_provider, external_id,
         created_by, closed_by, created_at, updated_at, closed_at)
      VALUES
        ($id, $repo_id, $number, $title, $body, 'open', $external_provider, $external_id,
         $created_by, NULL, $created_at, $updated_at, NULL)
    `).run({
      $id: id,
      $repo_id: repo.id,
      $number: next,
      $title: title,
      $body: body,
      $external_provider: externalProvider,
      $external_id: externalId,
      $created_by: actor,
      $created_at: now,
      $updated_at: now
    });

    return findIssueByNumber(repo, next) as Issue;
  })();

  return issue;
}

export function listIssues(repo: Repository): Issue[] {
  return ensureStorage().query<Issue, [string]>(`
    SELECT id, repo_id, number, title, body, status, external_provider, external_id,
           created_by, closed_by, created_at, updated_at, closed_at
    FROM issues
    WHERE repo_id = ?
    ORDER BY number ASC
  `).all(repo.id);
}

export function findIssueByNumber(repo: Repository, number: number): Issue | undefined {
  return ensureStorage().query<Issue, [string, number]>(`
    SELECT id, repo_id, number, title, body, status, external_provider, external_id,
           created_by, closed_by, created_at, updated_at, closed_at
    FROM issues
    WHERE repo_id = ? AND number = ?
  `).get(repo.id, number) ?? undefined;
}

export function updateIssue(repo: Repository, issue: Issue, input: {
  title?: string;
  body?: string | null;
  status?: string;
}, actor: string): Issue {
  const title = input.title === undefined ? issue.title : requireText(input.title, "title", 240);
  const body = input.body === undefined ? issue.body : optionalText(input.body, "body", 20_000);
  const status = input.status === undefined ? issue.status : validateStatus(input.status);
  const now = new Date().toISOString();
  const closedBy = status === "closed" ? (issue.closed_by ?? actor) : null;
  const closedAt = status === "closed" ? (issue.closed_at ?? now) : null;

  ensureStorage().query(`
    UPDATE issues
    SET title = $title,
        body = $body,
        status = $status,
        closed_by = $closed_by,
        updated_at = $updated_at,
        closed_at = $closed_at
    WHERE id = $id
  `).run({
    $id: issue.id,
    $title: title,
    $body: body,
    $status: status,
    $closed_by: closedBy,
    $updated_at: now,
    $closed_at: closedAt
  });

  return findIssueByNumber(repo, issue.number) as Issue;
}

export function closeIssue(repo: Repository, issue: Issue, input: {
  comment?: string | null;
  evidence?: LinkInput[];
}, actor: string): Issue {
  if (input.comment) addIssueComment(repo, issue, input.comment, actor);
  for (const link of input.evidence ?? []) addIssueLink(repo, issue, link, actor);
  return updateIssue(repo, issue, { status: "closed" }, actor);
}

export function addIssueComment(repo: Repository, issue: Issue, bodyInput: string, actor: string): IssueComment {
  const body = requireText(bodyInput, "comment", 20_000);
  const now = new Date().toISOString();
  const comment: IssueComment = {
    id: `issue_comment_${randomUUID()}`,
    repo_id: repo.id,
    issue_id: issue.id,
    actor,
    body,
    created_at: now,
    updated_at: now
  };

  ensureStorage().query(`
    INSERT INTO issue_comments
      (id, repo_id, issue_id, actor, body, created_at, updated_at)
    VALUES
      ($id, $repo_id, $issue_id, $actor, $body, $created_at, $updated_at)
  `).run({
    $id: comment.id,
    $repo_id: comment.repo_id,
    $issue_id: comment.issue_id,
    $actor: comment.actor,
    $body: comment.body,
    $created_at: comment.created_at,
    $updated_at: comment.updated_at
  });

  touchIssue(issue.id);
  return comment;
}

export function addIssueLink(repo: Repository, issue: Issue, input: LinkInput, actor: string): IssueLink {
  const linkType = validateLinkType(input.link_type);
  const normalized = normalizeLink(repo, linkType, input);
  const metadataJson = metadataToJson(input.metadata ?? {});
  const now = new Date().toISOString();
  const link: IssueLink = {
    id: `issue_link_${randomUUID()}`,
    repo_id: repo.id,
    issue_id: issue.id,
    link_type: linkType,
    target_id: normalized.target_id,
    target_ref: normalized.target_ref,
    target_sha: normalized.target_sha,
    metadata_json: metadataJson,
    actor,
    created_at: now
  };

  ensureStorage().query(`
    INSERT INTO issue_links
      (id, repo_id, issue_id, link_type, target_id, target_ref, target_sha,
       metadata_json, actor, created_at)
    VALUES
      ($id, $repo_id, $issue_id, $link_type, $target_id, $target_ref, $target_sha,
       $metadata_json, $actor, $created_at)
  `).run({
    $id: link.id,
    $repo_id: link.repo_id,
    $issue_id: link.issue_id,
    $link_type: link.link_type,
    $target_id: link.target_id,
    $target_ref: link.target_ref,
    $target_sha: link.target_sha,
    $metadata_json: link.metadata_json,
    $actor: link.actor,
    $created_at: link.created_at
  });

  touchIssue(issue.id);
  return link;
}

export function createIssueAgentRun(repo: Repository, issue: Issue, input: {
  run_id?: string;
  instruction?: string;
  branch?: string;
}, actor: string): IssueLink {
  const runId = optionalIdentifier(input.run_id ?? null, "run_id") ?? `run_${randomUUID()}`;
  const instruction = input.instruction ?? issue.title;
  const branch = input.branch ? normalizeBranchRef(input.branch) : null;
  return addIssueLink(repo, issue, {
    link_type: "agent_run",
    target_id: runId,
    target_ref: branch,
    metadata: { instruction }
  }, actor);
}

export function issueToJson(repo: Repository, issue: Issue): Record<string, unknown> {
  return {
    id: issue.id,
    repo_id: issue.repo_id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    status: issue.status,
    external_provider: issue.external_provider,
    external_id: issue.external_id,
    canonical: {
      provider: "bittergit",
      issue_id: issue.id,
      number: issue.number
    },
    created_by: issue.created_by,
    closed_by: issue.closed_by,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
    comments: listIssueComments(repo, issue),
    links: listIssueLinks(repo, issue).map(issueLinkToJson)
  };
}

export function listIssueComments(repo: Repository, issue: Issue): IssueComment[] {
  return ensureStorage().query<IssueComment, [string, string]>(`
    SELECT id, repo_id, issue_id, actor, body, created_at, updated_at
    FROM issue_comments
    WHERE repo_id = ? AND issue_id = ?
    ORDER BY created_at ASC
  `).all(repo.id, issue.id);
}

export function listIssueLinks(repo: Repository, issue: Issue): IssueLink[] {
  return ensureStorage().query<IssueLink, [string, string]>(`
    SELECT id, repo_id, issue_id, link_type, target_id, target_ref, target_sha,
           metadata_json, actor, created_at
    FROM issue_links
    WHERE repo_id = ? AND issue_id = ?
    ORDER BY created_at ASC
  `).all(repo.id, issue.id);
}

function issueLinkToJson(link: IssueLink): Record<string, unknown> {
  return {
    id: link.id,
    repo_id: link.repo_id,
    issue_id: link.issue_id,
    link_type: link.link_type,
    target_id: link.target_id,
    target_ref: link.target_ref,
    target_sha: link.target_sha,
    metadata: JSON.parse(link.metadata_json),
    actor: link.actor,
    created_at: link.created_at
  };
}

function normalizeLink(repo: Repository, linkType: string, input: LinkInput): {
  target_id: string | null;
  target_ref: string | null;
  target_sha: string | null;
} {
  if (linkType === "branch") {
    const ref = normalizeBranchRef(requireText(input.target_ref ?? input.target_id ?? undefined, "target_ref", 300));
    if (!refExists(repo, ref)) throw new Error(`branch ${ref} does not exist`);
    return { target_id: input.target_id ?? null, target_ref: ref, target_sha: resolveRef(repo, ref) };
  }

  if (linkType === "ref") {
    const ref = requireText(input.target_ref ?? undefined, "target_ref", 300);
    if (!refExists(repo, ref)) throw new Error(`ref ${ref} does not exist`);
    return { target_id: input.target_id ?? null, target_ref: ref, target_sha: resolveRef(repo, ref) };
  }

  if (linkType === "commit") {
    const sha = requireText(input.target_sha ?? input.target_id ?? undefined, "target_sha", 80);
    if (!commitExists(repo, sha)) throw new Error(`commit ${sha} does not exist`);
    return { target_id: input.target_id ?? null, target_ref: input.target_ref ?? null, target_sha: sha };
  }

  if (linkType === "checkpoint") {
    const id = requireText(input.target_id ?? undefined, "target_id", 160);
    const checkpoint = findCheckpoint(repo, id);
    if (!checkpoint) throw new Error(`checkpoint ${id} does not exist`);
    return { target_id: id, target_ref: input.target_ref ?? null, target_sha: checkpoint.commit_sha };
  }

  if (linkType === "deployment") {
    const id = requireText(input.target_id ?? undefined, "target_id", 160);
    const deployment = findDeployment(repo, id);
    if (!deployment) throw new Error(`deployment ${id} does not exist`);
    return { target_id: id, target_ref: input.target_ref ?? null, target_sha: deployment.commit_sha };
  }

  if (linkType === "receipt") {
    const id = requireText(input.target_id ?? undefined, "target_id", 160);
    const receipt = findReceipt(repo, id);
    if (!receipt) throw new Error(`receipt ${id} does not exist`);
    return { target_id: id, target_ref: input.target_ref ?? null, target_sha: input.target_sha ?? null };
  }

  return {
    target_id: input.target_id ?? null,
    target_ref: input.target_ref ?? null,
    target_sha: input.target_sha ?? null
  };
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

function optionalIdentifier(value: string | null, label: string): string | null {
  if (value === null || value === "") return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/.test(value.replaceAll("_", "-"))) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function validateStatus(status: string): string {
  if (!ISSUE_STATUSES.has(status)) throw new Error("invalid issue status");
  return status;
}

function validateLinkType(linkType: string | undefined): string {
  if (!linkType || !LINK_TYPES.has(linkType)) throw new Error("invalid link_type");
  return linkType;
}

function normalizeBranchRef(value: string): string {
  const ref = value.startsWith("refs/heads/") ? value : `refs/heads/${value}`;
  if (!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,240}$/.test(ref) || ref.includes("..")) {
    throw new Error("invalid branch ref");
  }
  return ref;
}

function metadataToJson(value: unknown): string {
  const json = JSON.stringify(value ?? {});
  if (json.length > 20_000) throw new Error("metadata is too large");
  assertSafeTextForStorage("metadata", json);
  return json;
}

function refExists(repo: Repository, ref: string): boolean {
  const result = spawnSync("git", ["--git-dir", repo.storage_path, "show-ref", "--verify", "--quiet", ref], {
    encoding: "utf8"
  });
  return result.status === 0;
}

function resolveRef(repo: Repository, ref: string): string {
  const result = spawnSync("git", ["--git-dir", repo.storage_path, "rev-parse", "--verify", ref], {
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(`cannot resolve ${ref}`);
  return result.stdout.trim();
}

function touchIssue(issueId: string): void {
  ensureStorage().query("UPDATE issues SET updated_at = $updated_at WHERE id = $id").run({
    $id: issueId,
    $updated_at: new Date().toISOString()
  });
}
