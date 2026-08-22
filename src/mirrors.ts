import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import { readRefs, recordRefChanges } from "./events";
import type { RefMap } from "./events";
import { scanUnsafeSource } from "./source-safety";

export type MirrorTarget = {
  id: string;
  repo_id: string;
  provider: string;
  remote_url: string;
  credential_ref: string | null;
  enabled: number;
  status: string;
  last_mirrored_sha: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  last_checked_at: string | null;
  diverged_at: string | null;
  created_at: string;
  updated_at: string;
};

type MirrorRef = {
  ref: string;
  sha: string;
};

type MirrorActionResult = {
  mirror: Record<string, unknown>;
  run: Record<string, unknown>;
};

const MIRRORABLE_REF_PREFIXES = ["refs/heads/", "refs/tags/"];

export function createMirrorTarget(repo: Repository, input: {
  provider?: string;
  remote_url?: string;
  credential_ref?: string | null;
  credential_value?: string;
  sync_now?: boolean;
}): MirrorActionResult {
  if (!input.remote_url) throw new Error("remote_url is required");
  if (input.credential_value) throw new Error("credential_value is not accepted; store secrets outside BitterGit and pass credential_ref");

  const provider = input.provider ?? "local_git";
  validateMirrorRemote(provider, input.remote_url);

  const db = ensureStorage();
  const now = new Date().toISOString();
  const id = `mirror_${randomUUID()}`;

  db.query(`
    INSERT INTO mirror_targets
      (id, repo_id, provider, remote_url, credential_ref, enabled, status,
       last_mirrored_sha, last_success_at, last_failure_at, last_error,
       last_checked_at, diverged_at, created_at, updated_at)
    VALUES
      ($id, $repo_id, $provider, $remote_url, $credential_ref, 1, 'pending',
       NULL, NULL, NULL, NULL, NULL, NULL, $created_at, $updated_at)
  `).run({
    $id: id,
    $repo_id: repo.id,
    $provider: provider,
    $remote_url: input.remote_url,
    $credential_ref: input.credential_ref ?? null,
    $created_at: now,
    $updated_at: now
  });

  const mirror = findMirrorTarget(repo, id) as MirrorTarget;
  if (input.sync_now === false) {
    const run = recordMirrorRun(repo, mirror, "pending", "configure", 0, null, null);
    return { mirror: mirrorToJson(mirror), run };
  }

  return syncMirrorTarget(repo, mirror, "configure");
}

export function listMirrorTargets(repo: Repository): MirrorTarget[] {
  const db = ensureStorage();
  return db.query<MirrorTarget, [string]>(`
    SELECT id, repo_id, provider, remote_url, credential_ref, enabled, status,
           last_mirrored_sha, last_success_at, last_failure_at, last_error,
           last_checked_at, diverged_at, created_at, updated_at
    FROM mirror_targets
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id);
}

export function findMirrorTarget(repo: Repository, id: string): MirrorTarget | undefined {
  const db = ensureStorage();
  return db.query<MirrorTarget, [string, string]>(`
    SELECT id, repo_id, provider, remote_url, credential_ref, enabled, status,
           last_mirrored_sha, last_success_at, last_failure_at, last_error,
           last_checked_at, diverged_at, created_at, updated_at
    FROM mirror_targets
    WHERE repo_id = ? AND id = ?
  `).get(repo.id, id) ?? undefined;
}

export function mirrorToJson(target: MirrorTarget): Record<string, unknown> {
  return {
    id: target.id,
    repo_id: target.repo_id,
    provider: target.provider,
    remote_url: target.remote_url,
    credential_ref: target.credential_ref,
    enabled: target.enabled === 1,
    status: target.status,
    last_mirrored_sha: target.last_mirrored_sha,
    last_success_at: target.last_success_at,
    last_failure_at: target.last_failure_at,
    last_error: publicMirrorError(target),
    last_checked_at: target.last_checked_at,
    diverged_at: target.diverged_at,
    actions: mirrorActions(target)
  };
}

export function mirrorSupportJson(target: MirrorTarget): Record<string, unknown> {
  return {
    id: target.id,
    repo_id: target.repo_id,
    provider: target.provider,
    remote_url: null,
    remote_url_returned: false,
    remote_configured: Boolean(target.remote_url),
    credential_ref: null,
    credential_ref_present: Boolean(target.credential_ref),
    credential_ref_returned: false,
    enabled: target.enabled === 1,
    status: target.status,
    last_mirrored_sha: target.last_mirrored_sha,
    last_success_at: target.last_success_at,
    last_failure_at: target.last_failure_at,
    last_error: target.last_error ? "Mirror synchronization needs repair." : null,
    last_error_details_returned: false,
    last_checked_at: target.last_checked_at,
    diverged_at: target.diverged_at,
    actions: mirrorActions(target),
    projection: "support_safe_v1"
  };
}

export function listMirrorRuns(repo: Repository, target: MirrorTarget): unknown[] {
  const db = ensureStorage();
  return db.query<Record<string, unknown>, [string, string]>(`
    SELECT id, repo_id, mirror_target_id, status, trigger, ref_count,
           last_mirrored_sha, error, created_at
    FROM mirror_runs
    WHERE repo_id = ? AND mirror_target_id = ?
    ORDER BY created_at ASC
  `).all(repo.id, target.id).map((run) => ({
    ...run,
    error: publicMirrorRunError(run)
  }));
}

export function syncMirrors(repo: Repository, trigger: string): void {
  for (const target of listMirrorTargets(repo)) {
    if (target.enabled !== 1) continue;
    syncMirrorTarget(repo, target, trigger);
  }
}

export function syncMirrorTarget(repo: Repository, target: MirrorTarget, trigger = "manual"): MirrorActionResult {
  if (target.enabled !== 1) {
    const run = recordMirrorRun(repo, target, "disabled", trigger, 0, target.last_mirrored_sha, "mirror disabled");
    return { mirror: mirrorToJson(target), run };
  }

  try {
    const localRefs = mirrorableRefs(readRefs(repo));
    const remoteRefs = readRemoteRefs(target.remote_url);
    const trackedRefs = readTrackedMirrorRefs(target.id);
    const divergence = detectDivergence(localRefs, remoteRefs, trackedRefs);

    markMirrorChecked(target.id);

    if (divergence) {
      const mirror = markMirrorDiverged(target.id, divergence);
      const run = recordMirrorRun(repo, mirror, "diverged", trigger, localRefs.size, mirror.last_mirrored_sha, divergence);
      return { mirror: mirrorToJson(mirror), run };
    }

    pushMirror(repo, target);
    writeTrackedMirrorRefs(target.id, localRefs);
    const mirror = markMirrorSuccess(target.id, localRefs.get("refs/heads/main") ?? null);
    const run = recordMirrorRun(repo, mirror, "ok", trigger, localRefs.size, mirror.last_mirrored_sha, null);
    return { mirror: mirrorToJson(mirror), run };
  } catch {
    const message = "mirror sync failed; verify remote reachability, credentials, and ref permissions";
    const mirror = markMirrorFailure(target.id, message);
    const run = recordMirrorRun(repo, mirror, "failed", trigger, 0, mirror.last_mirrored_sha, message);
    return { mirror: mirrorToJson(mirror), run };
  }
}

export function repairMirrorTarget(repo: Repository, target: MirrorTarget): MirrorActionResult {
  if (target.enabled !== 1) {
    const run = recordMirrorRun(repo, target, "disabled", "repair", 0, target.last_mirrored_sha, "mirror disabled");
    return { mirror: mirrorToJson(target), run };
  }

  try {
    const localRefs = mirrorableRefs(readRefs(repo));
    pushMirror(repo, target);
    writeTrackedMirrorRefs(target.id, localRefs);
    const mirror = markMirrorSuccess(target.id, localRefs.get("refs/heads/main") ?? null);
    const run = recordMirrorRun(repo, mirror, "repaired", "repair", localRefs.size, mirror.last_mirrored_sha, null);
    return { mirror: mirrorToJson(mirror), run };
  } catch {
    const message = "mirror repair failed; verify remote reachability, credentials, and ref permissions";
    const mirror = markMirrorFailure(target.id, message);
    const run = recordMirrorRun(repo, mirror, "failed", "repair", 0, mirror.last_mirrored_sha, message);
    return { mirror: mirrorToJson(mirror), run };
  }
}

export function importMirrorTarget(repo: Repository, target: MirrorTarget, actor: string): MirrorActionResult {
  if (target.enabled !== 1) {
    const run = recordMirrorRun(repo, target, "disabled", "import", 0, target.last_mirrored_sha, "mirror disabled");
    return { mirror: mirrorToJson(target), run };
  }

  try {
    const before = readRefs(repo);
    const remoteRefs = readRemoteRefs(target.remote_url);
    fetchMirrorObjects(repo, target);

    for (const [ref, sha] of remoteRefs) {
      if (ref.startsWith("refs/heads/")) {
        scanUnsafeSource(repo.storage_path, sha);
      }
    }

    const localRefs = mirrorableRefs(before);
    for (const [ref] of localRefs) {
      if (!remoteRefs.has(ref)) runGit(repo.storage_path, ["update-ref", "-d", ref]);
    }

    for (const [ref, sha] of remoteRefs) {
      runGit(repo.storage_path, ["update-ref", ref, sha]);
    }

    cleanupImportRefs(repo, target);
    const after = readRefs(repo);
    recordRefChanges(repo, before, after, `mirror-import:${actor}`);
    const importedRefs = mirrorableRefs(after);
    writeTrackedMirrorRefs(target.id, importedRefs);
    const mirror = markMirrorSuccess(target.id, importedRefs.get("refs/heads/main") ?? null);
    const run = recordMirrorRun(repo, mirror, "imported", "import", importedRefs.size, mirror.last_mirrored_sha, null);
    return { mirror: mirrorToJson(mirror), run };
  } catch {
    cleanupImportRefs(repo, target);
    const message = "mirror import failed; verify remote reachability, credentials, and ref permissions";
    const mirror = markMirrorFailure(target.id, message);
    const run = recordMirrorRun(repo, mirror, "failed", "import", 0, mirror.last_mirrored_sha, message);
    return { mirror: mirrorToJson(mirror), run };
  }
}

export function disableMirrorTarget(repo: Repository, target: MirrorTarget): MirrorActionResult {
  const db = ensureStorage();
  const now = new Date().toISOString();
  db.query(`
    UPDATE mirror_targets
    SET enabled = 0,
        status = 'disabled',
        updated_at = $updated_at
    WHERE id = $id
  `).run({ $id: target.id, $updated_at: now });

  const mirror = findMirrorTarget(repo, target.id) as MirrorTarget;
  const run = recordMirrorRun(repo, mirror, "disabled", "disable", 0, mirror.last_mirrored_sha, null);
  return { mirror: mirrorToJson(mirror), run };
}

function mirrorActions(target: MirrorTarget): string[] {
  if (target.enabled !== 1) return [];
  if (target.status === "diverged") return ["repair", "import", "disable"];
  if (target.status === "failed") return ["sync", "repair", "disable"];
  return ["sync", "disable"];
}

function publicMirrorError(target: MirrorTarget): string | null {
  if (!target.last_error) return null;
  if (target.status === "diverged") return "downstream mirror moved outside BitterGit";
  if (target.status === "disabled") return "mirror disabled";
  return "mirror sync failed; verify remote reachability, credentials, and ref permissions";
}

function publicMirrorRunError(run: Record<string, unknown>): string | null {
  if (!run.error) return null;
  if (run.status === "diverged") return "downstream mirror moved outside BitterGit";
  if (run.status === "disabled") return "mirror disabled";
  if (run.trigger === "repair") {
    return "mirror repair failed; verify remote reachability, credentials, and ref permissions";
  }
  if (run.trigger === "import") {
    return "mirror import failed; verify remote reachability, credentials, and ref permissions";
  }
  return "mirror sync failed; verify remote reachability, credentials, and ref permissions";
}

function validateMirrorRemote(provider: string, remoteUrl: string): void {
  if (remoteUrl.length === 0 || remoteUrl.length > 2048) throw new Error("invalid mirror remote_url");
  if (/[\u0000-\u001f\s]/.test(remoteUrl) || remoteUrl.startsWith("-")) {
    throw new Error("invalid mirror remote_url");
  }

  if (provider === "local_git") {
    if (!remoteUrl.startsWith("/")) throw new Error("local_git mirror remote_url must be an absolute path");
    return;
  }

  if (remoteUrl.startsWith("http://") || remoteUrl.startsWith("https://")) {
    const parsed = new URL(remoteUrl);
    if (parsed.username || parsed.password) {
      throw new Error("mirror credentials must not be embedded in remote_url");
    }
    return;
  }

  if (remoteUrl.startsWith("ssh://")) return;
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:.+/.test(remoteUrl)) return;

  throw new Error("unsupported mirror remote_url");
}

function mirrorableRefs(refs: RefMap): RefMap {
  const result: RefMap = new Map();
  for (const [ref, sha] of refs) {
    if (MIRRORABLE_REF_PREFIXES.some((prefix) => ref.startsWith(prefix))) {
      result.set(ref, sha);
    }
  }
  return result;
}

function readRemoteRefs(remoteUrl: string): RefMap {
  const result = spawnSync("git", ["ls-remote", "--heads", "--tags", "--refs", remoteUrl], {
    encoding: "utf8",
    env: gitEnv()
  });
  if (result.status !== 0) throw new Error(`git ls-remote mirror failed: ${result.stderr}`);

  const refs: RefMap = new Map();
  for (const line of result.stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const [sha, ref] = line.split(/\s+/);
    if (sha && ref && MIRRORABLE_REF_PREFIXES.some((prefix) => ref.startsWith(prefix))) {
      refs.set(ref, sha);
    }
  }
  return refs;
}

function readTrackedMirrorRefs(mirrorTargetId: string): RefMap {
  const db = ensureStorage();
  const refs = db.query<MirrorRef, [string]>(`
    SELECT ref, sha
    FROM mirror_refs
    WHERE mirror_target_id = ?
  `).all(mirrorTargetId);
  return new Map(refs.map((entry) => [entry.ref, entry.sha]));
}

function writeTrackedMirrorRefs(mirrorTargetId: string, refs: RefMap): void {
  const db = ensureStorage();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.query("DELETE FROM mirror_refs WHERE mirror_target_id = ?").run(mirrorTargetId);
    const insert = db.query(`
      INSERT INTO mirror_refs (mirror_target_id, ref, sha, updated_at)
      VALUES ($mirror_target_id, $ref, $sha, $updated_at)
    `);
    for (const [ref, sha] of refs) {
      insert.run({
        $mirror_target_id: mirrorTargetId,
        $ref: ref,
        $sha: sha,
        $updated_at: now
      });
    }
  })();
}

function detectDivergence(localRefs: RefMap, remoteRefs: RefMap, trackedRefs: RefMap): string | undefined {
  for (const [ref, remoteSha] of remoteRefs) {
    const trackedSha = trackedRefs.get(ref);
    const localSha = localRefs.get(ref);

    if (!trackedSha && !localSha) return `downstream has untracked ref ${ref}`;
    if (!trackedSha && localSha && remoteSha !== localSha) {
      return `downstream ref ${ref} differs before first mirror`;
    }
    if (trackedSha && remoteSha !== trackedSha) {
      return `downstream ref ${ref} moved outside BitterGit`;
    }
  }

  for (const [ref] of trackedRefs) {
    if (!remoteRefs.has(ref) && localRefs.has(ref)) {
      return `downstream ref ${ref} was deleted outside BitterGit`;
    }
  }

  return undefined;
}

function pushMirror(repo: Repository, target: MirrorTarget): void {
  const result = spawnSync("git", [
    "--git-dir",
    repo.storage_path,
    "push",
    "--mirror",
    target.remote_url
  ], {
    encoding: "utf8",
    env: gitEnv()
  });

  if (result.status !== 0) {
    throw new Error(`git push mirror failed: ${result.stderr}`);
  }
}

function fetchMirrorObjects(repo: Repository, target: MirrorTarget): void {
  const namespace = importNamespace(target.id);
  const result = spawnSync("git", [
    "--git-dir",
    repo.storage_path,
    "fetch",
    "--prune",
    target.remote_url,
    `+refs/heads/*:${namespace}/heads/*`,
    `+refs/tags/*:${namespace}/tags/*`
  ], {
    encoding: "utf8",
    env: gitEnv()
  });

  if (result.status !== 0) {
    throw new Error(`git fetch mirror failed: ${result.stderr}`);
  }
}

function cleanupImportRefs(repo: Repository, target: MirrorTarget): void {
  const namespace = importNamespace(target.id);
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
    runGit(repo.storage_path, ["update-ref", "-d", ref]);
  }
}

function importNamespace(mirrorTargetId: string): string {
  return `refs/bittergit/import/${mirrorTargetId}`;
}

function runGit(gitDir: string, args: string[]): string {
  const result = spawnSync("git", ["--git-dir", gitDir, ...args], {
    encoding: "utf8",
    env: gitEnv()
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function markMirrorChecked(mirrorTargetId: string): void {
  const db = ensureStorage();
  db.query(`
    UPDATE mirror_targets
    SET last_checked_at = $last_checked_at,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: mirrorTargetId,
    $last_checked_at: new Date().toISOString(),
    $updated_at: new Date().toISOString()
  });
}

function markMirrorSuccess(mirrorTargetId: string, lastMirroredSha: string | null): MirrorTarget {
  const db = ensureStorage();
  const now = new Date().toISOString();
  db.query(`
    UPDATE mirror_targets
    SET status = 'ok',
        last_mirrored_sha = $last_mirrored_sha,
        last_success_at = $last_success_at,
        last_error = NULL,
        diverged_at = NULL,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: mirrorTargetId,
    $last_mirrored_sha: lastMirroredSha,
    $last_success_at: now,
    $updated_at: now
  });
  return findMirrorById(mirrorTargetId);
}

function markMirrorDiverged(mirrorTargetId: string, error: string): MirrorTarget {
  const db = ensureStorage();
  const now = new Date().toISOString();
  db.query(`
    UPDATE mirror_targets
    SET status = 'diverged',
        last_error = $last_error,
        diverged_at = $diverged_at,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: mirrorTargetId,
    $last_error: scrubError(error),
    $diverged_at: now,
    $updated_at: now
  });
  return findMirrorById(mirrorTargetId);
}

function markMirrorFailure(mirrorTargetId: string, error: string): MirrorTarget {
  const db = ensureStorage();
  const now = new Date().toISOString();
  db.query(`
    UPDATE mirror_targets
    SET status = 'failed',
        last_failure_at = $last_failure_at,
        last_error = $last_error,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: mirrorTargetId,
    $last_failure_at: now,
    $last_error: scrubError(error),
    $updated_at: now
  });
  return findMirrorById(mirrorTargetId);
}

function findMirrorById(id: string): MirrorTarget {
  const db = ensureStorage();
  const mirror = db.query<MirrorTarget, [string]>(`
    SELECT id, repo_id, provider, remote_url, credential_ref, enabled, status,
           last_mirrored_sha, last_success_at, last_failure_at, last_error,
           last_checked_at, diverged_at, created_at, updated_at
    FROM mirror_targets
    WHERE id = ?
  `).get(id);
  if (!mirror) throw new Error(`mirror target ${id} not found`);
  return mirror;
}

function recordMirrorRun(
  repo: Repository,
  target: MirrorTarget,
  status: string,
  trigger: string,
  refCount: number,
  lastMirroredSha: string | null,
  error: string | null
): Record<string, unknown> {
  const db = ensureStorage();
  const id = `mirror_run_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  db.query(`
    INSERT INTO mirror_runs
      (id, repo_id, mirror_target_id, status, trigger, ref_count,
       last_mirrored_sha, error, created_at)
    VALUES
      ($id, $repo_id, $mirror_target_id, $status, $trigger, $ref_count,
       $last_mirrored_sha, $error, $created_at)
  `).run({
    $id: id,
    $repo_id: repo.id,
    $mirror_target_id: target.id,
    $status: status,
    $trigger: trigger,
    $ref_count: refCount,
    $last_mirrored_sha: lastMirroredSha,
    $error: error ? scrubError(error) : null,
    $created_at: createdAt
  });

  return {
    id,
    repo_id: repo.id,
    mirror_target_id: target.id,
    status,
    trigger,
    ref_count: refCount,
    last_mirrored_sha: lastMirroredSha,
    error: error ? scrubError(error) : null,
    created_at: createdAt
  };
}

function gitEnv(): NodeJS.ProcessEnv {
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
