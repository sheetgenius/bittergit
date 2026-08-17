import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { mkdtempSync } from "node:fs";
import type { AccountAssertion } from "./assertions";
import type { AccountApp } from "./apps";
import { createCustomerApp, PlanLimitError } from "./apps";
import type { Repository } from "./repos";
import { artifactImportPlan, type ArtifactImportIntake } from "./artifact-imports";
import { blankAgentsMd, blankAppMd, blankGitignore, listSourceFiles } from "./blank-app";
import { config } from "./config";
import { createCheckpoint, type Checkpoint } from "./checkpoints";
import { createSourceReceipt } from "./deployments";
import { setupStateToJson, setupStep, writeSetupState } from "./app-bundles";
import {
  bitterGridDeploymentContractMd,
  sourceContextFileReport,
  type ContextFileReport
} from "./agent-context";

export type ArtifactImportAppBundleResult = {
  app: AccountApp;
  repo: Repository;
  tokens: unknown;
  setup_state: Record<string, unknown>;
  checkpoint: Checkpoint;
  receipt: Record<string, unknown>;
  source_tree: string[];
  context_files: ContextFileReport;
  artifact_import: Record<string, unknown>;
};

export function createArtifactImportAppBundle(
  assertion: AccountAssertion,
  intake: ArtifactImportIntake,
  input: { name?: string; display_name?: string | null }
): ArtifactImportAppBundleResult {
  if (intake.status !== "ready") throw new Error("artifact import has blockers");

  const result = createCustomerApp(assertion, input);
  if (result.existing) throw new PlanLimitError("artifact app already exists");

  const { app, repo } = result;
  writeSetupState(app, repo, "in_progress", "artifact_import_review", [
    setupStep("account_app", "done"),
    setupStep("bittergit_repo", "done"),
    setupStep("artifact_import_review", "done"),
    setupStep("imported_source", "pending"),
    setupStep("initial_checkpoint", "pending"),
    setupStep("setup_receipt", "pending")
  ], null, null, null, "Accepted reviewed artifact import plan.");

  try {
    const source = initializeImportedAppSource(repo, intake);
    writeSetupState(app, repo, "in_progress", "imported_source", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("artifact_import_review", "done"),
      setupStep("imported_source", "done"),
      setupStep("initial_checkpoint", "pending"),
      setupStep("setup_receipt", "pending")
    ], null, null, null, "Imported approved artifact files and charter scaffolding.");

    const checkpointResult = createCheckpoint(repo, {
      label: "Imported app artifact",
      checkpoint_type: "artifact_import_initial",
      actor: "system:artifact-import",
      ref: "refs/heads/main"
    });
    const checkpoint = checkpointResult.checkpoint;
    writeSetupState(app, repo, "in_progress", "initial_checkpoint", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("artifact_import_review", "done"),
      setupStep("imported_source", "done"),
      setupStep("initial_checkpoint", "done"),
      setupStep("setup_receipt", "pending")
    ], null, null, checkpoint.id, "Created initial artifact import checkpoint.");

    const receipt = createSourceReceipt(repo, "artifact_app_setup", {
      app_id: app.id,
      account_ref: app.account_ref,
      workspace_ref: app.workspace_ref,
      repo_id: repo.id,
      artifact_import_id: intake.id,
      detected_shape: intake.detected_shape,
      import_summary: JSON.parse(intake.summary_json),
      commit_sha: source.commit_sha,
      checkpoint_id: checkpoint.id,
      source_tree: source.files,
      context_files: source.context_files,
      github_required: false,
      setup_status: "ready"
    });

    const setupState = writeSetupState(app, repo, "ready", "setup_complete", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("artifact_import_review", "done"),
      setupStep("imported_source", "done"),
      setupStep("initial_checkpoint", "done"),
      setupStep("setup_receipt", "done")
    ], null, String(receipt.id), checkpoint.id, "Imported app bundle is ready.");

    return {
      app,
      repo,
      tokens: result.tokens,
      setup_state: setupStateToJson(setupState),
      checkpoint,
      receipt,
      source_tree: source.files,
      context_files: source.context_files,
      artifact_import: {
        id: intake.id,
        status: intake.status,
        detected_shape: intake.detected_shape,
        summary: JSON.parse(intake.summary_json)
      }
    };
  } catch (error) {
    writeSetupState(app, repo, "repair_required", "failed", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("artifact_import_review", "done"),
      setupStep("imported_source", "unknown"),
      setupStep("initial_checkpoint", "unknown"),
      setupStep("setup_receipt", "unknown")
    ], error instanceof Error ? error.message : "unknown artifact app setup failure", null, null, "Artifact app setup failed and needs repair.");
    throw error;
  }
}

function initializeImportedAppSource(repo: Repository, intake: ArtifactImportIntake): { commit_sha: string; files: string[]; context_files: ContextFileReport } {
  const plan = artifactImportPlan(intake);
  if (plan.blocked.length > 0) throw new Error("artifact import has blockers");
  if (plan.will_import.length === 0) throw new Error("artifact import has no importable files");

  const tmpRoot = join(config.dataRoot, "tmp");
  mkdirSync(tmpRoot, { recursive: true });
  const worktree = mkdtempSync(join(tmpRoot, "artifact-app-"));

  try {
    runGit(["clone", repo.storage_path, worktree]);
    runGit(["-C", worktree, "checkout", "-B", "main"]);
    clearWorktree(worktree);

    for (const entry of plan.will_import) {
      const destination = safeDestination(worktree, entry.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readImportFile(intake, entry.path));
    }

    const scaffold = writeMissingScaffold(worktree);
    runGit(["-C", worktree, "config", "user.email", "system@bittergit.local"]);
    runGit(["-C", worktree, "config", "user.name", "BitterGit"]);
    runGit(["-C", worktree, "add", "-A"]);
    runGit(["-C", worktree, "commit", "-m", "Import app artifact"]);
    runGit(["-C", worktree, "push", "--force", "origin", "main"], {
      BITTERGIT_ACTOR: "system:artifact-import",
      BITTERGIT_SCOPES: JSON.stringify(["repo:admin"])
    });

    const files = listSourceFiles(repo);
    return {
      commit_sha: gitOutput(["-C", worktree, "rev-parse", "HEAD"]).trim(),
      files,
      context_files: sourceContextFileReport(files, scaffold)
    };
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
}

function readImportFile(intake: ArtifactImportIntake, relativePath: string): Buffer {
  if (intake.source_kind === "folder") {
    const root = resolve(intake.source_path);
    const absolute = resolve(root, relativePath);
    const rel = relative(root, absolute);
    if (rel.startsWith("..") || rel.startsWith("/") || rel.split(sep).includes("..")) {
      throw new Error("artifact import path escaped source root");
    }
    return readFileSync(absolute);
  }

  const result = spawnSync("unzip", ["-p", intake.source_path, relativePath], {
    encoding: "buffer",
    maxBuffer: config.maxArtifactImportFileBytes + 1024
  });
  if (result.status !== 0) {
    throw new Error(`zip extraction failed for ${relativePath}: ${result.stderr.toString("utf8").trim()}`);
  }
  return Buffer.from(result.stdout);
}

function writeMissingScaffold(worktree: string): { added: string[]; preserved: string[] } {
  const added: string[] = [];
  const preserved: string[] = [];
  const required = [
    ["AGENTS.md", blankAgentsMd()],
    ["APP.md", blankAppMd()],
    ["docs/BITTERGRID_DEPLOYMENT_CONTRACT.md", bitterGridDeploymentContractMd()],
    [".gitignore", blankGitignore()]
  ] as const;

  for (const [path, content] of required) {
    const destination = join(worktree, path);
    try {
      readFileSync(destination);
      preserved.push(path);
    } catch {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content, { encoding: "utf8" });
      added.push(path);
    }
  }

  return { added, preserved };
}

function safeDestination(root: string, relativePath: string): string {
  const destination = resolve(root, relativePath);
  const rel = relative(root, destination);
  if (rel.startsWith("..") || rel.startsWith("/") || rel.split(sep).includes("..")) {
    throw new Error("artifact import destination escaped worktree");
  }
  return destination;
}

function clearWorktree(worktree: string): void {
  const result = spawnSync("find", [worktree, "-mindepth", "1", "-maxdepth", "1", "!", "-name", ".git", "-exec", "rm", "-rf", "{}", "+"], {
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(`clear worktree failed: ${result.stderr}`);
}

function runGit(args: string[], env: Record<string, string> = {}): void {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function gitOutput(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}
