import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import { readRefs, recordRefChanges, syncRefIndex, type RefMap } from "./events";
import { scanUnsafeSource } from "./source-safety";

export type ImportSourceAuth = {
  type?: "basic" | "github_oauth" | "token";
  username?: string;
  password?: string;
  token?: string;
};

export type ImportRecord = {
  id: string;
  repo_id: string;
  provider: string;
  source_url: string;
  default_branch: string;
  status: string;
  branch_count: number;
  tag_count: number;
  head_sha: string | null;
  actor: string;
  error: string | null;
  created_at: string;
};

type ExportRecord = {
  id: string;
  repo_id: string;
  provider: string;
  destination_url: string;
  status: string;
  branch_count: number;
  tag_count: number;
  head_sha: string | null;
  actor: string;
  error: string | null;
  created_at: string;
};

type RemoteRecord = {
  id: string;
  repo_id: string;
  name: string;
  provider: string;
  remote_url: string;
  role: string;
  created_by: string;
  created_at: string;
  removed_at: string | null;
};

export function importFromGitRemote(repo: Repository, input: {
  provider?: string;
  source_url?: string;
  default_branch?: string;
  source_auth?: ImportSourceAuth | null;
}, actor: string): ImportRecord {
  const sourceUrl = requireRemote(input.source_url, "source_url");
  const provider = validateProvider(input.provider ?? "generic_git");
  const defaultBranch = validateBranch(input.default_branch ?? "main");
  const sourceAuth = normalizeImportSourceAuth(input.source_auth);
  const id = `import_${randomUUID()}`;
  const now = new Date().toISOString();

  try {
    return withGitCredentialEnv(sourceAuth, (env) => {
      const remoteRefs = readRemoteRefs(sourceUrl, env);
      fetchIntoImportNamespace(repo, sourceUrl, id, env);
      for (const [ref, sha] of remoteRefs) {
        if (ref.startsWith("refs/heads/")) scanUnsafeSource(repo.storage_path, sha);
      }

      const before = readRefs(repo);
      for (const [ref, sha] of remoteRefs) {
        updateRef(repo, ref, sha);
      }
      cleanupImportNamespace(repo, id);
      setHead(repo, `refs/heads/${defaultBranch}`);
      const after = readRefs(repo);
      recordRefChanges(repo, before, after, `import:${actor}`);
      syncRefIndex(repo, remoteRefs);

      const importRecord = insertImport(repo, {
        id,
        provider,
        sourceUrl,
        defaultBranch,
        status: "ok",
        branchCount: countRefs(remoteRefs, "refs/heads/"),
        tagCount: countRefs(remoteRefs, "refs/tags/"),
        headSha: remoteRefs.get(`refs/heads/${defaultBranch}`) ?? null,
        actor,
        error: null,
        createdAt: now
      });
      return importRecord;
    });
  } catch (error) {
    cleanupImportNamespace(repo, id);
    return insertImport(repo, {
      id,
      provider,
      sourceUrl,
      defaultBranch,
      status: "failed",
      branchCount: 0,
      tagCount: 0,
      headSha: null,
      actor,
      error: scrubError(error instanceof Error ? error.message : String(error), sourceAuth),
      createdAt: now
    });
  }
}

export function exportToGitRemote(repo: Repository, input: {
  provider?: string;
  destination_url?: string;
}, actor: string): ExportRecord {
  const destinationUrl = requireRemote(input.destination_url, "destination_url");
  const provider = validateProvider(input.provider ?? "generic_git");
  const refs = readRefs(repo);
  const id = `export_${randomUUID()}`;
  const now = new Date().toISOString();

  const result = spawnSync("git", ["--git-dir", repo.storage_path, "push", "--mirror", destinationUrl], {
    encoding: "utf8",
    env: gitEnv()
  });

  return insertExport(repo, {
    id,
    provider,
    destinationUrl,
    status: result.status === 0 ? "ok" : "failed",
    branchCount: countRefs(refs, "refs/heads/"),
    tagCount: countRefs(refs, "refs/tags/"),
    headSha: refs.get("refs/heads/main") ?? null,
    actor,
    error: result.status === 0 ? null : scrubError(result.stderr),
    createdAt: now
  });
}

export function addRepoRemote(repo: Repository, input: {
  name?: string;
  provider?: string;
  remote_url?: string;
  role?: string;
}, actor: string): RemoteRecord {
  const name = validateRemoteName(input.name);
  const provider = validateProvider(input.provider ?? "generic_git");
  const remoteUrl = requireRemote(input.remote_url, "remote_url");
  const role = validateRemoteRole(input.role ?? "external");
  const now = new Date().toISOString();
  const id = `remote_${randomUUID()}`;

  ensureStorage().query(`
    INSERT INTO repo_remotes
      (id, repo_id, name, provider, remote_url, role, created_by, created_at, removed_at)
    VALUES
      ($id, $repo_id, $name, $provider, $remote_url, $role, $created_by, $created_at, NULL)
    ON CONFLICT(repo_id, name) DO UPDATE SET
      provider = excluded.provider,
      remote_url = excluded.remote_url,
      role = excluded.role,
      created_by = excluded.created_by,
      created_at = excluded.created_at,
      removed_at = NULL
  `).run({
    $id: id,
    $repo_id: repo.id,
    $name: name,
    $provider: provider,
    $remote_url: remoteUrl,
    $role: role,
    $created_by: actor,
    $created_at: now
  });

  return findRepoRemote(repo, name) as RemoteRecord;
}

export function removeRepoRemote(repo: Repository, nameInput: string): RemoteRecord {
  const name = validateRemoteName(nameInput);
  const existing = findRepoRemote(repo, name);
  if (!existing) throw new Error("remote not found");

  ensureStorage().query(`
    UPDATE repo_remotes
    SET removed_at = $removed_at
    WHERE repo_id = $repo_id AND name = $name
  `).run({
    $repo_id: repo.id,
    $name: name,
    $removed_at: new Date().toISOString()
  });

  return findRepoRemote(repo, name) as RemoteRecord;
}

export function listRepoRemotes(repo: Repository): RemoteRecord[] {
  return ensureStorage().query<RemoteRecord, [string]>(`
    SELECT id, repo_id, name, provider, remote_url, role, created_by, created_at, removed_at
    FROM repo_remotes
    WHERE repo_id = ?
    ORDER BY name ASC
  `).all(repo.id);
}

export function listImports(repo: Repository): ImportRecord[] {
  return ensureStorage().query<ImportRecord, [string]>(`
    SELECT id, repo_id, provider, source_url, default_branch, status,
           branch_count, tag_count, head_sha, actor, error, created_at
    FROM repo_imports
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id);
}

export function listExports(repo: Repository): ExportRecord[] {
  return ensureStorage().query<ExportRecord, [string]>(`
    SELECT id, repo_id, provider, destination_url, status,
           branch_count, tag_count, head_sha, actor, error, created_at
    FROM repo_exports
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id);
}

function findRepoRemote(repo: Repository, name: string): RemoteRecord | undefined {
  return ensureStorage().query<RemoteRecord, [string, string]>(`
    SELECT id, repo_id, name, provider, remote_url, role, created_by, created_at, removed_at
    FROM repo_remotes
    WHERE repo_id = ? AND name = ?
  `).get(repo.id, name) ?? undefined;
}

function insertImport(repo: Repository, input: {
  id: string;
  provider: string;
  sourceUrl: string;
  defaultBranch: string;
  status: string;
  branchCount: number;
  tagCount: number;
  headSha: string | null;
  actor: string;
  error: string | null;
  createdAt: string;
}): ImportRecord {
  ensureStorage().query(`
    INSERT INTO repo_imports
      (id, repo_id, provider, source_url, default_branch, status, branch_count,
       tag_count, head_sha, actor, error, created_at)
    VALUES
      ($id, $repo_id, $provider, $source_url, $default_branch, $status, $branch_count,
       $tag_count, $head_sha, $actor, $error, $created_at)
  `).run({
    $id: input.id,
    $repo_id: repo.id,
    $provider: input.provider,
    $source_url: input.sourceUrl,
    $default_branch: input.defaultBranch,
    $status: input.status,
    $branch_count: input.branchCount,
    $tag_count: input.tagCount,
    $head_sha: input.headSha,
    $actor: input.actor,
    $error: input.error,
    $created_at: input.createdAt
  });

  return listImports(repo).find((entry) => entry.id === input.id) as ImportRecord;
}

function insertExport(repo: Repository, input: {
  id: string;
  provider: string;
  destinationUrl: string;
  status: string;
  branchCount: number;
  tagCount: number;
  headSha: string | null;
  actor: string;
  error: string | null;
  createdAt: string;
}): ExportRecord {
  ensureStorage().query(`
    INSERT INTO repo_exports
      (id, repo_id, provider, destination_url, status, branch_count, tag_count,
       head_sha, actor, error, created_at)
    VALUES
      ($id, $repo_id, $provider, $destination_url, $status, $branch_count, $tag_count,
       $head_sha, $actor, $error, $created_at)
  `).run({
    $id: input.id,
    $repo_id: repo.id,
    $provider: input.provider,
    $destination_url: input.destinationUrl,
    $status: input.status,
    $branch_count: input.branchCount,
    $tag_count: input.tagCount,
    $head_sha: input.headSha,
    $actor: input.actor,
    $error: input.error,
    $created_at: input.createdAt
  });

  return listExports(repo).find((entry) => entry.id === input.id) as ExportRecord;
}

function readRemoteRefs(remoteUrl: string, env: Record<string, string | undefined> = gitEnv()): RefMap {
  const result = spawnSync("git", ["ls-remote", "--heads", "--tags", "--refs", remoteUrl], {
    encoding: "utf8",
    env
  });
  if (result.status !== 0) throw new Error(`git ls-remote failed: ${result.stderr}`);

  const refs: RefMap = new Map();
  for (const line of result.stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const [sha, ref] = line.split(/\s+/);
    if (sha && ref) refs.set(ref, sha);
  }
  return refs;
}

function fetchIntoImportNamespace(repo: Repository, remoteUrl: string, importId: string, env: Record<string, string | undefined> = gitEnv()): void {
  const namespace = importNamespace(importId);
  const result = spawnSync("git", [
    "--git-dir",
    repo.storage_path,
    "fetch",
    "--prune",
    remoteUrl,
    `+refs/heads/*:${namespace}/heads/*`,
    `+refs/tags/*:${namespace}/tags/*`
  ], {
    encoding: "utf8",
    env
  });
  if (result.status !== 0) throw new Error(`git fetch import failed: ${result.stderr}`);
}

function cleanupImportNamespace(repo: Repository, importId: string): void {
  const namespace = importNamespace(importId);
  const result = spawnSync("git", [
    "--git-dir",
    repo.storage_path,
    "for-each-ref",
    "--format=%(refname)",
    namespace
  ], {
    encoding: "utf8",
    env: gitEnv()
  });
  if (result.status !== 0) return;

  for (const ref of result.stdout.split("\n").filter((line) => line.length > 0)) {
    spawnSync("git", ["--git-dir", repo.storage_path, "update-ref", "-d", ref], {
      encoding: "utf8",
      env: gitEnv()
    });
  }
}

function updateRef(repo: Repository, ref: string, sha: string): void {
  const result = spawnSync("git", ["--git-dir", repo.storage_path, "update-ref", ref, sha], {
    encoding: "utf8",
    env: gitEnv()
  });
  if (result.status !== 0) throw new Error(`git update-ref failed: ${result.stderr}`);
}

function setHead(repo: Repository, ref: string): void {
  const result = spawnSync("git", ["--git-dir", repo.storage_path, "symbolic-ref", "HEAD", ref], {
    encoding: "utf8",
    env: gitEnv()
  });
  if (result.status !== 0) throw new Error(`git symbolic-ref failed: ${result.stderr}`);
}

function importNamespace(importId: string): string {
  return `refs/bittergit/import/${importId}`;
}

function countRefs(refs: RefMap, prefix: string): number {
  return [...refs.keys()].filter((ref) => ref.startsWith(prefix)).length;
}

function validateProvider(value: string): string {
  if (!["generic_git", "github", "gitlab", "local_git"].includes(value)) throw new Error("unsupported provider");
  return value;
}

function validateBranch(value: string): string {
  const branch = value.replace(/^refs\/heads\//, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/.test(branch) || branch.includes("..")) {
    throw new Error("invalid default_branch");
  }
  return branch;
}

function validateRemoteName(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value)) throw new Error("invalid remote name");
  return value;
}

function validateRemoteRole(value: string): string {
  if (!["import", "export", "mirror", "external"].includes(value)) throw new Error("invalid remote role");
  return value;
}

function requireRemote(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  if (value.length === 0 || value.length > 2048) throw new Error(`invalid ${label}`);
  if (/[\u0000-\u001f\s]/.test(value) || value.startsWith("-")) throw new Error(`invalid ${label}`);
  if (value.startsWith("/")) return value;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) throw new Error("credentials must not be embedded in remote URL");
    return value;
  }
  if (value.startsWith("ssh://")) return value;
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:.+/.test(value)) return value;
  throw new Error(`unsupported ${label}`);
}

export function gitEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GIT_QUARANTINE_PATH;
  return env;
}

function normalizeImportSourceAuth(value: ImportSourceAuth | null | undefined): ImportSourceAuth | null {
  if (!value) return null;
  const password = stringCredential(value.password ?? value.token);
  if (!password) throw new Error("source_auth requires password or token");
  const username = stringCredential(value.username) ?? "x-access-token";
  const type = value.type ?? "basic";
  if (!["basic", "github_oauth", "token"].includes(type)) throw new Error("unsupported source_auth type");
  return { type, username, password };
}

function stringCredential(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > 4096) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  return value;
}

function withGitCredentialEnv<T>(
  sourceAuth: ImportSourceAuth | null,
  callback: (env: Record<string, string | undefined>) => T
): T {
  if (!sourceAuth) return callback(gitEnv());

  const root = mkdtempSync(join(tmpdir(), "bittergit-import-auth-"));
  const usernamePath = join(root, "username");
  const passwordPath = join(root, "password");
  const askpassPath = join(root, "askpass.sh");

  try {
    writeFileSync(usernamePath, sourceAuth.username ?? "x-access-token", { encoding: "utf8", mode: 0o600 });
    writeFileSync(passwordPath, sourceAuth.password ?? sourceAuth.token ?? "", { encoding: "utf8", mode: 0o600 });
    writeFileSync(askpassPath, [
      "#!/bin/sh",
      "case \"$1\" in",
      "  *Username*) cat \"$BITTERGIT_IMPORT_USERNAME_FILE\" ;;",
      "  *) cat \"$BITTERGIT_IMPORT_PASSWORD_FILE\" ;;",
      "esac",
      ""
    ].join("\n"), { encoding: "utf8", mode: 0o700 });
    chmodSync(askpassPath, 0o700);

    return callback({
      ...gitEnv(),
      GIT_ASKPASS: askpassPath,
      BITTERGIT_IMPORT_USERNAME_FILE: usernamePath,
      BITTERGIT_IMPORT_PASSWORD_FILE: passwordPath
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scrubError(message: string, sourceAuth: ImportSourceAuth | null = null): string {
  let scrubbed = message.replace(/(https?:\/\/)([^/\s:@]+):([^@\s/]+)@/g, "$1***:***@");
  for (const sensitive of [sourceAuth?.username, sourceAuth?.password, sourceAuth?.token]) {
    if (sensitive) scrubbed = scrubbed.split(sensitive).join("[redacted]");
  }
  return scrubbed;
}
