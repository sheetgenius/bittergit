import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { config } from "../src/config";
import { backendPathInfo, validateSlug, type Repository } from "../src/repos";

describe("Phase 1 path safety", () => {
  test("validates owner and repository slugs", () => {
    expect(validateSlug("test-owner_1", "owner")).toBe("test-owner_1");

    for (const value of ["", ".", "..", "../repo", "repo/git", "repo.git"]) {
      expect(() => validateSlug(value, "repo")).toThrow();
    }
  });

  test("maps storage paths to git-http-backend PATH_INFO under repos root", () => {
    const repo = fakeRepo(join(config.reposRoot, "@hashed", "aa", "bb", "repo_1.git"));

    expect(backendPathInfo(repo, "info/refs")).toBe("/@hashed/aa/bb/repo_1.git/info/refs");
  });

  test("rejects storage paths outside repos root", () => {
    const repo = fakeRepo("/tmp/repo_1.git");

    expect(() => backendPathInfo(repo, "info/refs")).toThrow("escaped");
  });
});

function fakeRepo(storagePath: string): Repository {
  return {
    id: "repo_1",
    owner: "test",
    name: "hello",
    default_branch: "main",
    storage_path: storagePath,
    created_at: "2026-05-21T00:00:00Z",
    updated_at: "2026-05-21T00:00:00Z"
  };
}
