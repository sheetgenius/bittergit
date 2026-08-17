import { describe, expect, test } from "bun:test";
import {
  artifactSourcePathWithinRoot,
  reviewArtifactEntries,
  type ArtifactImportCandidateEntry
} from "../src/artifact-imports";

describe("artifact import policy", () => {
  test("separates importable, skipped, and blocked entries", () => {
    const plan = reviewArtifactEntries([
      file("index.html", 100),
      file("assets/logo.svg", 50),
      file(".DS_Store", 10),
      file("node_modules/pkg/index.js", 20),
      file("bundle.zip", 30),
      file(".env", 12),
      file("secrets/private.pem", 30),
      { path: "linked", size_bytes: 0, kind: "symlink" }
    ]);

    expect(plan.will_import.map((entry) => entry.path)).toEqual(["assets/logo.svg", "index.html"]);
    expect(plan.will_skip.map((entry) => entry.reason).sort()).toEqual([
      "dependency_directory",
      "macos_metadata",
      "nested_archive"
    ]);
    expect(plan.blocked.map((entry) => entry.reason).sort()).toEqual([
      "env_file",
      "private_key",
      "symlink"
    ]);
    expect(plan.blocked.find((entry) => entry.reason === "env_file")?.repair_action)
      .toContain("BitterPass secret grant flow");
    expect(plan.blocked.find((entry) => entry.reason === "private_key")?.repair_action)
      .toContain("BitterPass secret grant flow");
    expect(plan.blocked.find((entry) => entry.reason === "symlink")?.repair_action)
      .toBeUndefined();
  });

  test("blocks traversal and absolute paths before import", () => {
    const plan = reviewArtifactEntries([
      file("../escape.html", 10),
      file("/absolute.html", 10),
      file("safe/app.js", 10)
    ]);

    expect(plan.will_import.map((entry) => entry.path)).toEqual(["safe/app.js"]);
    expect(plan.blocked.map((entry) => entry.reason).sort()).toEqual([
      "absolute_path",
      "path_traversal"
    ]);
  });

  test("restricts server-local imports to the configured root", () => {
    expect(artifactSourcePathWithinRoot("/srv/bittergit/imports/app", "/srv/bittergit/imports")).toBe(true);
    expect(artifactSourcePathWithinRoot("/srv/bittergit/imports", "/srv/bittergit/imports")).toBe(true);
    expect(artifactSourcePathWithinRoot("/srv/bittergit/private", "/srv/bittergit/imports")).toBe(false);
  });
});

function file(path: string, size_bytes: number): ArtifactImportCandidateEntry {
  return { path, size_bytes, kind: "file" };
}
