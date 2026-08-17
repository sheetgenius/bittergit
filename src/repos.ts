import { randomUUID, createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { cloneUrl, config } from "./config";
import { ensureStorage } from "./storage";
import { recordRefUpdate } from "./events";

export type Repository = {
  id: string;
  owner: string;
  name: string;
  default_branch: string;
  storage_path: string;
  created_at: string;
  updated_at: string;
};

const slugPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export function validateSlug(value: string, label: string): string {
  if (!slugPattern.test(value) || value === "." || value === ".." || value.endsWith(".git")) {
    throw new Error(`invalid ${label}`);
  }

  return value;
}

export function repoToJson(repo: Repository): Record<string, string> {
  return {
    id: repo.id,
    owner: repo.owner,
    name: repo.name,
    default_branch: repo.default_branch,
    clone_url: cloneUrl(repo.owner, repo.name),
    storage_state: repositoryStorageState(repo)
  };
}

export function createRepository(ownerInput: string, nameInput: string): Repository {
  const owner = validateSlug(ownerInput, "owner");
  const name = validateSlug(nameInput, "name");
  const db = ensureStorage();

  const existing = findRepository(owner, name);
  if (existing) return existing;

  const id = `repo_${randomUUID()}`;
  const now = new Date().toISOString();
  const storagePath = storagePathForId(id);

  mkdirSync(storagePath.substring(0, storagePath.lastIndexOf(sep)), { recursive: true });
  runGit(["init", "--bare", storagePath]);
  runGit(["--git-dir", storagePath, "symbolic-ref", "HEAD", "refs/heads/main"]);
  const starterSha = seedStarterCommit(storagePath);
  installHooks(storagePath, id);

  db.query(`
    INSERT INTO repositories
      (id, owner, name, default_branch, storage_path, created_at, updated_at)
    VALUES
      ($id, $owner, $name, $default_branch, $storage_path, $created_at, $updated_at)
  `).run({
    $id: id,
    $owner: owner,
    $name: name,
    $default_branch: "main",
    $storage_path: storagePath,
    $created_at: now,
    $updated_at: now
  });

  const repo = findRepository(owner, name) as Repository;
  recordRefUpdate(repo, "0000000000000000000000000000000000000000", starterSha, "refs/heads/main", "system:starter");
  return repo;
}

export function findRepository(ownerInput: string, nameInput: string): Repository | undefined {
  const owner = validateSlug(ownerInput, "owner");
  const name = validateSlug(nameInput, "name");
  const db = ensureStorage();

  return db.query<Repository, [string, string]>(`
    SELECT id, owner, name, default_branch, storage_path, created_at, updated_at
    FROM repositories
    WHERE owner = ? AND name = ?
  `).get(owner, name) ?? undefined;
}

export function findRepositoryById(id: string): Repository | undefined {
  const db = ensureStorage();
  return db.query<Repository, [string]>(`
    SELECT id, owner, name, default_branch, storage_path, created_at, updated_at
    FROM repositories
    WHERE id = ?
  `).get(id) ?? undefined;
}

export function updateRepositoryDefaultBranch(repo: Repository, defaultBranch: string): Repository {
  const branch = validateDefaultBranch(defaultBranch);
  const now = new Date().toISOString();
  ensureStorage().query(`
    UPDATE repositories
    SET default_branch = $default_branch, updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: repo.id,
    $default_branch: branch,
    $updated_at: now
  });

  return findRepositoryById(repo.id) as Repository;
}

export function listRepositories(): Repository[] {
  const db = ensureStorage();
  return db.query<Repository, []>(`
    SELECT id, owner, name, default_branch, storage_path, created_at, updated_at
    FROM repositories
    ORDER BY owner ASC, name ASC
  `).all();
}

export function repositoryStorageState(repo: Repository): "present" | "missing" {
  return existsSync(repo.storage_path) ? "present" : "missing";
}

export function backendPathInfo(repo: Repository, suffix: string): string {
  const rel = relative(config.reposRoot, repo.storage_path).split(sep).join("/");
  if (rel.startsWith("..") || rel.startsWith("/") || rel.length === 0) {
    throw new Error("repository storage path escaped repos root");
  }

  return `/${rel}/${suffix}`;
}

function storagePathForId(id: string): string {
  const digest = createHash("sha256").update(id).digest("hex");
  return join(config.reposRoot, "@hashed", digest.slice(0, 2), digest.slice(2, 4), `${id}.git`);
}

function validateDefaultBranch(value: string): string {
  const branch = value.replace(/^refs\/heads\//, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/.test(branch) || branch.includes("..")) {
    throw new Error("invalid default_branch");
  }
  return branch;
}

function runGit(args: string[]): void {
  const result = spawnSync("git", args, { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function installHooks(storagePath: string, repoId: string): void {
  const hooksDir = join(storagePath, "hooks");
  const hook = (name: string) => `#!/usr/bin/env bash
set -euo pipefail
export BITTERGIT_ROOT="${config.root}"
export BITTERGIT_DATA_ROOT="${config.dataRoot}"
export BITTERGIT_REPO_ID="${repoId}"
exec bun "${config.root}/src/hook.ts" ${name}
`;

  for (const name of ["pre-receive", "post-receive"]) {
    const path = join(hooksDir, name);
    writeFileSync(path, hook(name), { encoding: "utf8" });
    chmodSync(path, 0o755);
  }
}

function seedStarterCommit(storagePath: string): string {
  const tmpRoot = join(config.dataRoot, "tmp");
  mkdirSync(tmpRoot, { recursive: true });
  const worktree = mkdtempSync(join(tmpRoot, "starter-"));

  try {
    writeFileSync(join(worktree, ".gitignore"), starterGitignore(), { encoding: "utf8" });
    runGit(["-C", worktree, "init"]);
    runGit(["-C", worktree, "config", "user.email", "system@bittergit.local"]);
    runGit(["-C", worktree, "config", "user.name", "BitterGit"]);
    runGit(["-C", worktree, "add", ".gitignore"]);
    runGit(["-C", worktree, "commit", "-m", "Initialize BitterGit starter"]);
    runGit(["-C", worktree, "branch", "-M", "main"]);
    runGit(["-C", worktree, "remote", "add", "origin", storagePath]);
    runGit(["-C", worktree, "push", "origin", "main"]);

    const result = spawnSync("git", ["-C", worktree, "rev-parse", "HEAD"], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git rev-parse failed: ${result.stderr}`);
    return result.stdout.trim();
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
}

function starterGitignore(): string {
  return [
    ".env",
    ".env.*",
    "!.env.example",
    "*.pem",
    "*.key",
    ".DS_Store",
    "node_modules/",
    ".var/",
    "tmp/",
    ""
  ].join("\n");
}
