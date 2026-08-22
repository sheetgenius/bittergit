import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRepository, type Repository } from "../src/repos";
import { readRefs } from "../src/events";
import { importFromGitRemote } from "../src/import-export";
import { unauthorizedUpdateRefs } from "../src/ref-authorization";
import { tokenCanWriteRef } from "../src/tokens";

const tmpRoot = mkdtempSync(join(tmpdir(), "bittergit-ref-authorization-test-"));
setDefaultTimeout(60_000);

const ZERO_SHA = "0000000000000000000000000000000000000000";
const fixtureId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("ref authorization preflight", () => {
  test("includes protected ref deletions in pre-receive authorization", () => {
    const denied = unauthorizedUpdateRefs([
      { ref: "refs/heads/main", newSha: ZERO_SHA },
      { ref: "refs/heads/feature", newSha: ZERO_SHA }
    ], (ref) => tokenCanWriteRef([
      "repo:write",
      "ref:write:refs/heads/*"
    ], ref));

    expect(denied).toEqual(["refs/heads/main"]);
  });

  test("checks every import target before fetching or updating refs", () => {
    const source = createRepository(`ref-auth-source-${fixtureId}`, "source");
    seedSource(source.storage_path);
    const deniedDelete = git([
      "-C",
      join(tmpRoot, "source-worktree"),
      "push",
      "origin",
      ":refs/tags/v1"
    ], {
      BITTERGIT_ACTOR: "test:limited-delete",
      BITTERGIT_SCOPES: JSON.stringify([
        "repo:write",
        "ref:write:refs/heads/*"
      ])
    });
    expect(deniedDelete.status).not.toBe(0);
    expect(String(deniedDelete.stderr)).toContain("cannot write refs/tags/v1");
    expect(git(["--git-dir", source.storage_path, "rev-parse", "--verify", "refs/tags/v1"]).status).toBe(0);

    const destination = createRepository(`ref-auth-dest-${fixtureId}`, "destination");
    const before = sortedRefs(destination);
    const checked: string[] = [];
    const deniedRecord = importFromGitRemote(destination, {
      provider: "local_git",
      source_url: source.storage_path,
      default_branch: "main"
    }, "test:limited-import", {
      authorizeRef: (ref) => {
        checked.push(ref);
        return tokenCanWriteRef([
          "repo:write",
          "ref:write:refs/heads/*"
        ], ref);
      }
    });

    expect(deniedRecord.status).toBe("failed");
    expect(deniedRecord.error).toContain("not authorized to import");
    expect(checked.sort()).toEqual([
      "refs/heads/feature",
      "refs/heads/main",
      "refs/tags/v1"
    ]);
    expect(sortedRefs(destination)).toEqual(before);
    expect(String(git([
      "--git-dir",
      destination.storage_path,
      "for-each-ref",
      "--format=%(refname)",
      "refs/bittergit/import"
    ]).stdout).trim()).toBe("");

    const mainDestination = createRepository(`ref-auth-main-${fixtureId}`, "destination");
    const mainRecord = importFromGitRemote(mainDestination, {
      provider: "local_git",
      source_url: source.storage_path,
      default_branch: "main"
    }, "test:main-import", {
      authorizeRef: (ref) => tokenCanWriteRef([
        "repo:read",
        "repo:write",
        "ref:write:refs/heads/*",
        "ref:write:refs/heads/main",
        "ref:write:refs/tags/*"
      ], ref)
    });

    expect(mainRecord.status).toBe("ok");
    expect(sortedRefs(mainDestination).map(([ref]) => ref)).toEqual([
      "refs/heads/feature",
      "refs/heads/main",
      "refs/tags/v1"
    ]);

    const adminDestination = createRepository(`ref-auth-admin-${fixtureId}`, "destination");
    const adminRecord = importFromGitRemote(adminDestination, {
      provider: "local_git",
      source_url: source.storage_path,
      default_branch: "main"
    }, "system:test-admin-import", {
      authorizeRef: (ref) => tokenCanWriteRef(["repo:admin"], ref)
    });

    expect(adminRecord.status).toBe("ok");
  });
});

function seedSource(storagePath: string): void {
  const worktree = join(tmpRoot, "source-worktree");
  assertGit(["clone", storagePath, worktree]);
  assertGit(["-C", worktree, "config", "user.email", "test@bittergit.local"]);
  assertGit(["-C", worktree, "config", "user.name", "BitterGit Test"]);
  writeFileSync(join(worktree, "main.txt"), "main\n", "utf8");
  assertGit(["-C", worktree, "add", "main.txt"]);
  assertGit(["-C", worktree, "commit", "-m", "Add main fixture"]);
  assertGit(["-C", worktree, "checkout", "-b", "feature"]);
  writeFileSync(join(worktree, "feature.txt"), "feature\n", "utf8");
  assertGit(["-C", worktree, "add", "feature.txt"]);
  assertGit(["-C", worktree, "commit", "-m", "Add feature fixture"]);
  assertGit(["-C", worktree, "tag", "v1"]);
  assertGit(["-C", worktree, "push", "origin", "main", "feature", "refs/tags/v1"], {
    BITTERGIT_ACTOR: "test:seed-source",
    BITTERGIT_SCOPES: JSON.stringify(["repo:admin"])
  });
}

function sortedRefs(repo: Repository): Array<[string, string]> {
  return [...readRefs(repo).entries()]
    .sort(([left], [right]) => left.localeCompare(right));
}

function assertGit(args: string[], env: Record<string, string> = {}): void {
  const result = git(args, env);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function git(args: string[], env: Record<string, string> = {}): ReturnType<typeof spawnSync> {
  return spawnSync("git", args, { encoding: "utf8", env: { ...process.env, ...env } });
}
