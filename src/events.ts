import { spawnSync } from "node:child_process";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";

const ZERO_SHA = "0000000000000000000000000000000000000000";

export type RefMap = Map<string, string>;

export function readRefs(repo: Repository): RefMap {
  const result = spawnSync("git", [
    "--git-dir",
    repo.storage_path,
    "for-each-ref",
    "--format=%(refname)%00%(objectname)"
  ], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`git for-each-ref failed: ${result.stderr}`);
  }

  const refs: RefMap = new Map();
  for (const line of result.stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const [ref, sha] = line.split("\u0000");
    if (ref && sha) refs.set(ref, sha);
  }

  return refs;
}

export function recordRefChanges(repo: Repository, before: RefMap, after: RefMap, actor: string): number {
  const db = ensureStorage();
  const refs = new Set([...before.keys(), ...after.keys()]);
  const insert = db.query(`
    INSERT INTO ref_events
      (type, repo_id, owner, repo, ref, old_sha, new_sha, actor, created_at)
    VALUES
      ($type, $repo_id, $owner, $repo, $ref, $old_sha, $new_sha, $actor, $created_at)
  `);

  let count = 0;
  for (const ref of refs) {
    const oldSha = before.get(ref) ?? ZERO_SHA;
    const newSha = after.get(ref) ?? ZERO_SHA;
    if (oldSha === newSha) continue;

    insert.run({
      $type: "ref_update",
      $repo_id: repo.id,
      $owner: repo.owner,
      $repo: repo.name,
      $ref: ref,
      $old_sha: oldSha,
      $new_sha: newSha,
      $actor: actor,
      $created_at: new Date().toISOString()
    });
    if (newSha === ZERO_SHA) {
      db.query("DELETE FROM repository_refs WHERE repo_id = ? AND ref = ?").run(repo.id, ref);
    } else {
      db.query(`
        INSERT INTO repository_refs (repo_id, ref, sha, updated_at)
        VALUES ($repo_id, $ref, $sha, $updated_at)
        ON CONFLICT(repo_id, ref) DO UPDATE SET
          sha = excluded.sha,
          updated_at = excluded.updated_at
      `).run({
        $repo_id: repo.id,
        $ref: ref,
        $sha: newSha,
        $updated_at: new Date().toISOString()
      });
    }
    count += 1;
  }

  return count;
}

export function recordRefUpdate(repo: Repository, oldSha: string, newSha: string, ref: string, actor: string): void {
  const db = ensureStorage();
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO ref_events
      (type, repo_id, owner, repo, ref, old_sha, new_sha, actor, created_at)
    VALUES
      ($type, $repo_id, $owner, $repo, $ref, $old_sha, $new_sha, $actor, $created_at)
  `).run({
    $type: "ref_update",
    $repo_id: repo.id,
    $owner: repo.owner,
    $repo: repo.name,
    $ref: ref,
    $old_sha: oldSha,
    $new_sha: newSha,
    $actor: actor,
    $created_at: now
  });

  if (newSha === ZERO_SHA) {
    db.query("DELETE FROM repository_refs WHERE repo_id = ? AND ref = ?").run(repo.id, ref);
  } else {
    db.query(`
      INSERT INTO repository_refs (repo_id, ref, sha, updated_at)
      VALUES ($repo_id, $ref, $sha, $updated_at)
      ON CONFLICT(repo_id, ref) DO UPDATE SET
        sha = excluded.sha,
        updated_at = excluded.updated_at
    `).run({
      $repo_id: repo.id,
      $ref: ref,
      $sha: newSha,
      $updated_at: now
    });
  }
}

export function listEvents(repo: Repository): unknown[] {
  const db = ensureStorage();
  return db.query(`
    SELECT type, repo_id, owner, repo, ref, old_sha, new_sha, actor, created_at
    FROM ref_events
    WHERE repo_id = ?
    ORDER BY id ASC
  `).all(repo.id);
}

export function listRefs(repo: Repository): unknown[] {
  const db = ensureStorage();
  return db.query(`
    SELECT ref, sha, updated_at
    FROM repository_refs
    WHERE repo_id = ?
    ORDER BY ref ASC
  `).all(repo.id);
}

export function syncRefIndex(repo: Repository, refs: RefMap): void {
  const db = ensureStorage();
  const now = new Date().toISOString();
  db.transaction(() => {
    const upsert = db.query(`
      INSERT INTO repository_refs (repo_id, ref, sha, updated_at)
      VALUES ($repo_id, $ref, $sha, $updated_at)
      ON CONFLICT(repo_id, ref) DO UPDATE SET
        sha = excluded.sha,
        updated_at = excluded.updated_at
    `);
    for (const [ref, sha] of refs) {
      upsert.run({
        $repo_id: repo.id,
        $ref: ref,
        $sha: sha,
        $updated_at: now
      });
    }
  })();
}
