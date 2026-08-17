import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import { recordRefUpdate } from "./events";

export type Checkpoint = {
  id: string;
  repo_id: string;
  commit_sha: string;
  previous_sha: string | null;
  label: string;
  checkpoint_type: string;
  actor: string;
  created_at: string;
};

export function createCheckpoint(
  repo: Repository,
  input: { label: string; checkpoint_type: string; actor: string; ref?: string }
): { checkpoint: Checkpoint; created: boolean } {
  const commitSha = resolveRef(repo, input.ref ?? "refs/heads/main");
  const db = ensureStorage();
  const existing = db.query<Checkpoint, [string, string, string]>(`
    SELECT id, repo_id, commit_sha, previous_sha, label, checkpoint_type, actor, created_at
    FROM checkpoints
    WHERE repo_id = ? AND checkpoint_type = ? AND commit_sha = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(repo.id, input.checkpoint_type, commitSha);

  if (existing) return { checkpoint: existing, created: false };

  const previous = db.query<{ commit_sha: string }, [string]>(`
    SELECT commit_sha FROM checkpoints
    WHERE repo_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(repo.id);

  const checkpoint: Checkpoint = {
    id: `chk_${randomUUID()}`,
    repo_id: repo.id,
    commit_sha: commitSha,
    previous_sha: previous?.commit_sha ?? null,
    label: input.label,
    checkpoint_type: input.checkpoint_type,
    actor: input.actor,
    created_at: new Date().toISOString()
  };

  db.query(`
    INSERT INTO checkpoints
      (id, repo_id, commit_sha, previous_sha, label, checkpoint_type, actor, created_at)
    VALUES
      ($id, $repo_id, $commit_sha, $previous_sha, $label, $checkpoint_type, $actor, $created_at)
  `).run({
    $id: checkpoint.id,
    $repo_id: checkpoint.repo_id,
    $commit_sha: checkpoint.commit_sha,
    $previous_sha: checkpoint.previous_sha,
    $label: checkpoint.label,
    $checkpoint_type: checkpoint.checkpoint_type,
    $actor: checkpoint.actor,
    $created_at: checkpoint.created_at
  });

  return { checkpoint, created: true };
}

export function listCheckpoints(repo: Repository): Checkpoint[] {
  return ensureStorage().query<Checkpoint, [string]>(`
    SELECT id, repo_id, commit_sha, previous_sha, label, checkpoint_type, actor, created_at
    FROM checkpoints
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id);
}

export function findCheckpoint(repo: Repository, id: string): Checkpoint | undefined {
  return ensureStorage().query<Checkpoint, [string, string]>(`
    SELECT id, repo_id, commit_sha, previous_sha, label, checkpoint_type, actor, created_at
    FROM checkpoints
    WHERE repo_id = ? AND id = ?
  `).get(repo.id, id) ?? undefined;
}

export function findCheckpointForCommit(repo: Repository, commitSha: string): Checkpoint | undefined {
  return ensureStorage().query<Checkpoint, [string, string]>(`
    SELECT id, repo_id, commit_sha, previous_sha, label, checkpoint_type, actor, created_at
    FROM checkpoints
    WHERE repo_id = ? AND commit_sha = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(repo.id, commitSha) ?? undefined;
}

export function commitExists(repo: Repository, commitSha: string): boolean {
  const result = spawnSync("git", ["--git-dir", repo.storage_path, "cat-file", "-e", `${commitSha}^{commit}`], {
    encoding: "utf8"
  });
  return result.status === 0;
}

export function diffCheckpoints(repo: Repository, from: Checkpoint, to: Checkpoint): string {
  const result = spawnSync("git", [
    "--git-dir",
    repo.storage_path,
    "diff",
    "--stat",
    `${from.commit_sha}..${to.commit_sha}`
  ], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`git diff failed: ${result.stderr}`);
  }

  return result.stdout;
}

export function restoreCheckpoint(repo: Repository, checkpoint: Checkpoint, actor: string): { old_sha: string; new_sha: string } {
  const ref = "refs/heads/main";
  const oldSha = resolveRef(repo, ref);
  if (oldSha === checkpoint.commit_sha) {
    return { old_sha: oldSha, new_sha: checkpoint.commit_sha };
  }

  const result = spawnSync("git", [
    "--git-dir",
    repo.storage_path,
    "update-ref",
    ref,
    checkpoint.commit_sha,
    oldSha
  ], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`git update-ref failed: ${result.stderr}`);
  }

  recordRefUpdate(repo, oldSha, checkpoint.commit_sha, ref, actor);
  return { old_sha: oldSha, new_sha: checkpoint.commit_sha };
}

function resolveRef(repo: Repository, ref: string): string {
  const result = spawnSync("git", ["--git-dir", repo.storage_path, "rev-parse", "--verify", ref], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(`cannot resolve ${ref}: ${result.stderr}`);
  }

  return result.stdout.trim();
}
