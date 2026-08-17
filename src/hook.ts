import { findRepositoryById } from "./repos";
import { recordRefUpdate } from "./events";
import { tokenCanWriteRef } from "./tokens";
import { scanUnsafeSource } from "./source-safety";
import { syncMirrors } from "./mirrors";

const ZERO_SHA = "0000000000000000000000000000000000000000";

async function main(): Promise<void> {
  const mode = process.argv[2];
  const repoId = process.env.BITTERGIT_REPO_ID;
  const actor = process.env.BITTERGIT_ACTOR ?? process.env.REMOTE_USER ?? "unknown";
  const scopes = parseScopes(process.env.BITTERGIT_SCOPES);

  if (!repoId) fail("BITTERGIT_REPO_ID is required");

  const repo = findRepositoryById(repoId);
  if (!repo) fail(`repository ${repoId} not found`);

  const input = await Bun.stdin.text();
  const updates = input.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [oldSha, newSha, ref] = line.split(/\s+/);
      return { oldSha, newSha, ref };
    });

  if (mode === "pre-receive") {
    for (const update of updates) {
      if (!update.oldSha || !update.newSha || !update.ref) fail("invalid ref update input");
      if (update.newSha === ZERO_SHA) continue;
      if (!tokenCanWriteRef(scopes, update.ref)) {
        fail(`token ${actor} cannot write ${update.ref}`);
      }
      if (update.ref.startsWith("refs/heads/")) {
        scanUnsafeSource(repo.storage_path, update.newSha);
      }
    }
    return;
  }

  if (mode === "post-receive") {
    for (const update of updates) {
      if (!update.oldSha || !update.newSha || !update.ref) fail("invalid ref update input");
      recordRefUpdate(repo, update.oldSha, update.newSha, update.ref, actor);
    }
    syncMirrors(repo, "post-receive");
    return;
  }

  fail(`unknown hook mode ${mode}`);
}

function parseScopes(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function fail(message: string): never {
  console.error(`bittergit hook: ${message}`);
  process.exit(1);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
