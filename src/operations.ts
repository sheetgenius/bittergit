import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Database } from "bun:sqlite";
import { config } from "./config";
import { ensureStorage } from "./storage";
import { listRepositories } from "./repos";

type BackupRecord = {
  id: string;
  status: string;
  backup_path: string;
  metadata_path: string;
  repo_count: number;
  error: string | null;
  created_at: string;
};

type RestoreRehearsal = {
  id: string;
  backup_id: string;
  status: string;
  restore_path: string;
  fsck_repo_count: number;
  metadata_repo_count: number;
  metadata_ref_count: number;
  metadata_event_count: number;
  error: string | null;
  created_at: string;
};

type PerformanceRun = {
  id: string;
  status: string;
  summary_json: string;
  created_at: string;
};

export function createBackup(): BackupRecord {
  const id = `backup_${timestamp()}_${randomUUID()}`;
  const backupPath = join(config.dataRoot, "backups", id);
  const reposBackupPath = join(backupPath, "repos");
  const metadataPath = join(backupPath, "dev.sqlite");
  const db = ensureStorage();
  const now = new Date().toISOString();

  mkdirSync(backupPath, { recursive: true });

  try {
    db.run("PRAGMA wal_checkpoint(FULL)");
    cpSync(config.dbPath, metadataPath);
    cpSync(config.reposRoot, reposBackupPath, { recursive: true });
    const record = insertBackup({
      id,
      status: "ok",
      backupPath,
      metadataPath,
      repoCount: listRepositories().length,
      error: null,
      createdAt: now
    });
    return record;
  } catch (error) {
    return insertBackup({
      id,
      status: "failed",
      backupPath,
      metadataPath,
      repoCount: 0,
      error: error instanceof Error ? error.message : String(error),
      createdAt: now
    });
  }
}

export function listBackups(): BackupRecord[] {
  return ensureStorage().query<BackupRecord, []>(`
    SELECT id, status, backup_path, metadata_path, repo_count, error, created_at
    FROM backups
    ORDER BY created_at ASC
  `).all();
}

export function findBackup(id: string): BackupRecord | undefined {
  return ensureStorage().query<BackupRecord, [string]>(`
    SELECT id, status, backup_path, metadata_path, repo_count, error, created_at
    FROM backups
    WHERE id = ?
  `).get(id) ?? undefined;
}

export function rehearseRestore(backup: BackupRecord): RestoreRehearsal {
  const id = `restore_${timestamp()}_${randomUUID()}`;
  const restorePath = join(config.dataRoot, "restore-rehearsals", id);
  const now = new Date().toISOString();

  try {
    cpSync(backup.backup_path, restorePath, { recursive: true });
    const repoPaths = findBareRepos(join(restorePath, "repos"));
    for (const repoPath of repoPaths) runGitFsck(repoPath);

    const metadata = readMetadataCounts(join(restorePath, "dev.sqlite"));
    return insertRestore({
      id,
      backupId: backup.id,
      status: "passed",
      restorePath,
      fsckRepoCount: repoPaths.length,
      metadataRepoCount: metadata.repos,
      metadataRefCount: metadata.refs,
      metadataEventCount: metadata.events,
      error: null,
      createdAt: now
    });
  } catch (error) {
    return insertRestore({
      id,
      backupId: backup.id,
      status: "failed",
      restorePath,
      fsckRepoCount: 0,
      metadataRepoCount: 0,
      metadataRefCount: 0,
      metadataEventCount: 0,
      error: error instanceof Error ? error.message : String(error),
      createdAt: now
    });
  }
}

export function operationsHealth(): Record<string, unknown> {
  const latestBackup = ensureStorage().query<BackupRecord, []>(`
    SELECT id, status, backup_path, metadata_path, repo_count, error, created_at
    FROM backups
    ORDER BY created_at DESC
    LIMIT 1
  `).get() ?? null;

  return {
    latest_backup: latestBackup,
    disk: diskCapacity(),
    hook_failures: hookFailures(),
    mirror_attention: mirrorAttention(),
    garbage_collection_policy: "manual git gc per repository until repository count or disk pressure requires scheduled maintenance"
  };
}

export function performancePosture(): Record<string, unknown> {
  const repos = listRepositories();
  const db = ensureStorage();

  return {
    repository_count: repos.length,
    ref_event_count: countRows("ref_events"),
    workcell_count: countRows("workcells"),
    mirror_backpressure: mirrorBackpressure(),
    storage_growth: storageGrowth(repos.length),
    git_gc: gitGcSchedule(repos),
    recent_runs: listPerformanceRuns(10).map(performanceRunToJson),
    repeatable_harness: "scripts/smoke-gate-18.sh"
  };
}

export function recordPerformanceRun(input: {
  status?: string;
  summary?: unknown;
}): PerformanceRun {
  const status = validateRunStatus(input.status ?? "passed");
  const summaryJson = JSON.stringify(input.summary ?? {});
  if (summaryJson.length > 100_000) throw new Error("performance summary too large");
  const id = `performance_run_${timestamp()}_${randomUUID()}`;
  const createdAt = new Date().toISOString();

  ensureStorage().query(`
    INSERT INTO performance_runs (id, status, summary_json, created_at)
    VALUES ($id, $status, $summary_json, $created_at)
  `).run({
    $id: id,
    $status: status,
    $summary_json: summaryJson,
    $created_at: createdAt
  });

  return findPerformanceRun(id) as PerformanceRun;
}

export function listPerformanceRuns(limit = 50): PerformanceRun[] {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  return ensureStorage().query<PerformanceRun, [number]>(`
    SELECT id, status, summary_json, created_at
    FROM performance_runs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(boundedLimit);
}

export function performanceRunToJson(run: PerformanceRun): Record<string, unknown> {
  return {
    id: run.id,
    status: run.status,
    summary: JSON.parse(run.summary_json),
    created_at: run.created_at
  };
}

function insertBackup(input: {
  id: string;
  status: string;
  backupPath: string;
  metadataPath: string;
  repoCount: number;
  error: string | null;
  createdAt: string;
}): BackupRecord {
  ensureStorage().query(`
    INSERT INTO backups
      (id, status, backup_path, metadata_path, repo_count, error, created_at)
    VALUES
      ($id, $status, $backup_path, $metadata_path, $repo_count, $error, $created_at)
  `).run({
    $id: input.id,
    $status: input.status,
    $backup_path: input.backupPath,
    $metadata_path: input.metadataPath,
    $repo_count: input.repoCount,
    $error: input.error,
    $created_at: input.createdAt
  });
  return findBackup(input.id) as BackupRecord;
}

function insertRestore(input: {
  id: string;
  backupId: string;
  status: string;
  restorePath: string;
  fsckRepoCount: number;
  metadataRepoCount: number;
  metadataRefCount: number;
  metadataEventCount: number;
  error: string | null;
  createdAt: string;
}): RestoreRehearsal {
  ensureStorage().query(`
    INSERT INTO restore_rehearsals
      (id, backup_id, status, restore_path, fsck_repo_count, metadata_repo_count,
       metadata_ref_count, metadata_event_count, error, created_at)
    VALUES
      ($id, $backup_id, $status, $restore_path, $fsck_repo_count, $metadata_repo_count,
       $metadata_ref_count, $metadata_event_count, $error, $created_at)
  `).run({
    $id: input.id,
    $backup_id: input.backupId,
    $status: input.status,
    $restore_path: input.restorePath,
    $fsck_repo_count: input.fsckRepoCount,
    $metadata_repo_count: input.metadataRepoCount,
    $metadata_ref_count: input.metadataRefCount,
    $metadata_event_count: input.metadataEventCount,
    $error: input.error,
    $created_at: input.createdAt
  });

  return ensureStorage().query<RestoreRehearsal, [string]>(`
    SELECT id, backup_id, status, restore_path, fsck_repo_count, metadata_repo_count,
           metadata_ref_count, metadata_event_count, error, created_at
    FROM restore_rehearsals
    WHERE id = ?
  `).get(input.id) as RestoreRehearsal;
}

function findBareRepos(root: string): string[] {
  if (!existsSync(root)) return [];
  const results: string[] = [];
  const visit = (path: string) => {
    const entries = readdirSync(path, { withFileTypes: true });
    if (entries.some((entry) => entry.name === "HEAD") && entries.some((entry) => entry.name === "objects")) {
      results.push(path);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) visit(join(path, entry.name));
    }
  };
  visit(root);
  return results;
}

function runGitFsck(repoPath: string): void {
  const result = spawnSync("git", ["--git-dir", repoPath, "fsck", "--no-progress"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git fsck failed for ${repoPath}: ${result.stderr}`);
}

function readMetadataCounts(path: string): { repos: number; refs: number; events: number } {
  const db = new Database(path);
  try {
    return {
      repos: Number(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM repositories").get()?.count ?? 0),
      refs: Number(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM repository_refs").get()?.count ?? 0),
      events: Number(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM ref_events").get()?.count ?? 0)
    };
  } finally {
    db.close();
  }
}

function diskCapacity(): Record<string, unknown> {
  const result = spawnSync("df", ["-k", config.dataRoot], { encoding: "utf8" });
  if (result.status !== 0) return { status: "unknown", error: result.stderr };
  const lines = result.stdout.trim().split("\n");
  const parts = lines[lines.length - 1]?.split(/\s+/) ?? [];
  return {
    status: "ok",
    filesystem: parts[0] ?? null,
    size_kb: Number(parts[1] ?? 0),
    used_kb: Number(parts[2] ?? 0),
    available_kb: Number(parts[3] ?? 0),
    capacity: parts[4] ?? null
  };
}

function hookFailures(): unknown[] {
  const failures: unknown[] = [];
  for (const repo of listRepositories()) {
    for (const hook of ["pre-receive", "post-receive"]) {
      const path = join(repo.storage_path, "hooks", hook);
      if (!existsSync(path)) {
        failures.push({ repo_id: repo.id, hook, error: "missing" });
        continue;
      }
      if ((statSync(path).mode & 0o111) === 0) {
        failures.push({ repo_id: repo.id, hook, error: "not executable" });
      }
    }
  }
  return failures;
}

function mirrorAttention(): unknown[] {
  return ensureStorage().query(`
    SELECT id, repo_id, provider, remote_url, status, last_error, updated_at
    FROM mirror_targets
    WHERE status IN ('failed', 'diverged')
    ORDER BY updated_at DESC
  `).all();
}

function mirrorBackpressure(): Record<string, unknown> {
  const db = ensureStorage();
  const total = Number(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM mirror_targets").get()?.count ?? 0);
  const attention = Number(db.query<{ count: number }, []>(`
    SELECT COUNT(*) AS count
    FROM mirror_targets
    WHERE enabled = 1 AND status IN ('failed', 'diverged')
  `).get()?.count ?? 0);
  return {
    mode: "synchronous-source-trigger-with-visible-status",
    source_push_blocking: false,
    pending_or_attention_count: attention,
    target_count: total,
    bounded_by: "mirror_targets table; no unbounded in-memory queue"
  };
}

function storageGrowth(repoCount: number): Record<string, unknown> {
  return {
    data_root: config.dataRoot,
    data_root_bytes: directorySize(config.dataRoot),
    repos_root_bytes: directorySize(config.reposRoot),
    repo_count: repoCount,
    metadata_bytes: existsSync(config.dbPath) ? statSync(config.dbPath).size : 0
  };
}

function gitGcSchedule(repos: ReturnType<typeof listRepositories>): Record<string, unknown> {
  const sample = repos.slice(0, 25).map((repo) => {
    const result = spawnSync("git", ["--git-dir", repo.storage_path, "count-objects", "-v"], { encoding: "utf8" });
    if (result.status !== 0) {
      return { repo_id: repo.id, owner: repo.owner, name: repo.name, status: "unknown", error: result.stderr };
    }

    const fields = Object.fromEntries(result.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [key, value] = line.split(":").map((part) => part.trim());
        return [key, Number(value)];
      }));

    return {
      repo_id: repo.id,
      owner: repo.owner,
      name: repo.name,
      loose_objects: fields.count ?? 0,
      size_pack_kb: fields["size-pack"] ?? 0,
      gc_candidate: Number(fields.count ?? 0) > 1000
    };
  });

  return {
    mode: "manual-per-repository",
    trigger_policy: "schedule when loose object count, repo count, or disk pressure crosses launch thresholds",
    sampled_repo_count: sample.length,
    total_repo_count: repos.length,
    sample
  };
}

function directorySize(path: string): number {
  if (!existsSync(path)) return 0;
  const result = spawnSync("du", ["-sk", path], { encoding: "utf8" });
  if (result.status === 0) {
    const kb = Number(result.stdout.trim().split(/\s+/)[0] ?? 0);
    return kb * 1024;
  }

  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.size;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    total += directorySize(join(path, entry.name));
  }
  return total;
}

function countRows(table: string): number {
  return Number(ensureStorage().query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0);
}

function findPerformanceRun(id: string): PerformanceRun | undefined {
  return ensureStorage().query<PerformanceRun, [string]>(`
    SELECT id, status, summary_json, created_at
    FROM performance_runs
    WHERE id = ?
  `).get(id) ?? undefined;
}

function validateRunStatus(status: string): string {
  if (!["passed", "failed"].includes(status)) throw new Error("invalid performance run status");
  return status;
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(/[-:.]/g, "").replace("T", "").replace("Z", "");
}
