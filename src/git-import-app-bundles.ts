import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import type { AccountAssertion } from "./assertions";
import type { AccountApp } from "./apps";
import { createCustomerApp, PlanLimitError } from "./apps";
import { findSetupStateForApp, setupStateToJson, setupStep, writeSetupState } from "./app-bundles";
import { blankAgentsMd, blankAppMd, blankGitignore, listSourceFiles } from "./blank-app";
import { createCheckpoint, type Checkpoint } from "./checkpoints";
import { config } from "./config";
import { createSourceReceipt } from "./deployments";
import { importFromGitRemote, type ImportRecord, type ImportSourceAuth } from "./import-export";
import type { Repository } from "./repos";
import { updateRepositoryDefaultBranch } from "./repos";
import { tokenCanWriteRef } from "./tokens";
import {
  bitterGridDeploymentContractMd,
  sourceContextFileReport,
  type ContextFileReport
} from "./agent-context";

export type GitImportAppBundleResult = {
  app: AccountApp;
  repo: Repository;
  tokens: unknown;
  setup_state: Record<string, unknown>;
  checkpoint: Checkpoint;
  receipt: Record<string, unknown>;
  source_tree: string[];
  context_files: ContextFileReport;
  source_contract: Record<string, unknown>;
  git_import: Record<string, unknown>;
};

export function createGitImportAppBundle(
  assertion: AccountAssertion,
  input: {
    name?: string;
    display_name?: string | null;
    source_url?: string;
    provider?: string;
    default_branch?: string;
    source_auth?: ImportSourceAuth | null;
  }
): GitImportAppBundleResult {
  const source = normalizeGitImportSource(input.source_url);
  const provider = input.provider ?? providerForSource(source);
  const defaultBranch = normalizeBranch(input.default_branch ?? detectRemoteDefaultBranch(source.url) ?? "main");

  const result = createCustomerApp(assertion, input);
  if (result.existing) {
    const setupState = findSetupStateForApp(result.app.id);
    if (setupState?.status !== "repair_required") {
      throw new PlanLimitError("git import app already exists");
    }
  }

  const { app } = result;
  let repo = result.repo;
  writeSetupState(app, repo, "in_progress", "git_import", [
    setupStep("account_app", "done"),
    setupStep("bittergit_repo", "done"),
    setupStep("git_import", "pending"),
    setupStep("charter_scaffold", "pending"),
    setupStep("initial_checkpoint", "pending"),
    setupStep("setup_receipt", "pending")
  ], null, null, null, "Created account app record and BitterGit repository for Git import.");

  try {
    const importRecord = importFromGitRemote(repo, {
      provider,
      source_url: source.url,
      default_branch: defaultBranch,
      source_auth: input.source_auth
    }, "system:git-import-app-bundle", {
      authorizeRef: (ref) => tokenCanWriteRef(["repo:admin"], ref)
    });

    if (importRecord.status !== "ok") {
      throw new Error(importRecord.error ?? "git import failed");
    }

    repo = updateRepositoryDefaultBranch(repo, defaultBranch);
    writeSetupState(app, repo, "in_progress", "git_import", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("git_import", "done"),
      setupStep("charter_scaffold", "pending"),
      setupStep("initial_checkpoint", "pending"),
      setupStep("setup_receipt", "pending")
    ], null, null, null, "Imported Git refs into BitterGit custody. The upstream source is detached; no background sync is active.");

    const scaffold = ensureGitImportScaffold(repo, defaultBranch);
    writeSetupState(app, repo, "in_progress", "charter_scaffold", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("git_import", "done"),
      setupStep("charter_scaffold", "done"),
      setupStep("initial_checkpoint", "pending"),
      setupStep("setup_receipt", "pending")
    ], null, null, null, scaffold.added.length > 0
      ? "Added missing AGENTS.md, APP.md, deployment contract, and .gitignore scaffolding."
      : "Preserved existing AGENTS.md, APP.md, deployment contract, and .gitignore scaffolding.");

    const checkpointResult = createCheckpoint(repo, {
      label: "Imported public Git source",
      checkpoint_type: "git_import_initial",
      actor: "system:git-import-app-bundle",
      ref: `refs/heads/${defaultBranch}`
    });
    const checkpoint = checkpointResult.checkpoint;
    writeSetupState(app, repo, "in_progress", "initial_checkpoint", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("git_import", "done"),
      setupStep("charter_scaffold", "done"),
      setupStep("initial_checkpoint", "done"),
      setupStep("setup_receipt", "pending")
    ], null, null, checkpoint.id, "Created initial Git import checkpoint.");

    const sourceTree = listSourceFiles(repo, `refs/heads/${defaultBranch}`);
    const contextFiles = sourceContextFileReport(sourceTree, scaffold);
    const sourceContract = gitImportSourceContract();
    const importSummary = gitImportSummary(source, importRecord, defaultBranch, scaffold, contextFiles, sourceContract, Boolean(input.source_auth));
    const receipt = createSourceReceipt(repo, "git_import_app_setup", {
      app_id: app.id,
      account_ref: app.account_ref,
      workspace_ref: app.workspace_ref,
      repo_id: repo.id,
      commit_sha: checkpoint.commit_sha,
      checkpoint_id: checkpoint.id,
      source_tree: sourceTree,
      context_files: contextFiles,
      source_contract: sourceContract,
      github_required: false,
      setup_status: "ready",
      import_summary: importSummary,
      terminal_prompt_disabled: true
    });

    const setupState = writeSetupState(app, repo, "ready", "setup_complete", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("git_import", "done"),
      setupStep("charter_scaffold", "done"),
      setupStep("initial_checkpoint", "done"),
      setupStep("setup_receipt", "done")
    ], null, String(receipt.id), checkpoint.id, "Imported Git app bundle is ready.");

    return {
      app,
      repo,
      tokens: result.tokens,
      setup_state: setupStateToJson(setupState),
      checkpoint,
      receipt,
      source_tree: sourceTree,
      context_files: contextFiles,
      source_contract: sourceContract,
      git_import: importSummary
    };
  } catch (error) {
    writeSetupState(app, repo, "repair_required", "failed", [
      setupStep("account_app", "done"),
      setupStep("bittergit_repo", "done"),
      setupStep("git_import", "unknown"),
      setupStep("charter_scaffold", "unknown"),
      setupStep("initial_checkpoint", "unknown"),
      setupStep("setup_receipt", "unknown")
    ], error instanceof Error ? error.message : "unknown Git import app setup failure", null, null, "Git import app setup failed and needs repair.");
    throw error;
  }
}

function normalizeGitImportSource(value: string | undefined): {
  url: string;
  kind: "http_git" | "local_git";
  host: string | null;
  path: string;
} {
  if (!value || value.trim().length === 0 || value.length > 2048) throw new Error("source_url is required");
  const sourceUrl = value.trim();
  if (/[\u0000-\u001f\s]/.test(sourceUrl) || sourceUrl.startsWith("-")) throw new Error("invalid source_url");

  if (sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://")) {
    const parsed = new URL(sourceUrl);
    if (parsed.username || parsed.password) throw new Error("credentials must not be embedded in source_url");
    return {
      url: sourceUrl,
      kind: "http_git",
      host: parsed.host,
      path: parsed.pathname
    };
  }

  if (sourceUrl.startsWith("/")) {
    return {
      url: sourceUrl,
      kind: "local_git",
      host: null,
      path: sourceUrl
    };
  }

  throw new Error("unsupported source_url");
}

function providerForSource(source: { kind: string; host: string | null }): string {
  if (source.host === "github.com" || source.host?.endsWith(".github.com")) return "github";
  if (source.host === "gitlab.com" || source.host?.endsWith(".gitlab.com")) return "gitlab";
  if (source.kind === "local_git") return "local_git";
  return "generic_git";
}

function detectRemoteDefaultBranch(sourceUrl: string): string | null {
  const result = spawnSync("git", ["ls-remote", "--symref", sourceUrl, "HEAD"], {
    encoding: "utf8",
    env: gitEnv()
  });
  if (result.status !== 0) return null;

  const symrefLine = result.stdout.split("\n").find((line) => line.startsWith("ref: refs/heads/"));
  const branch = symrefLine?.match(/^ref: refs\/heads\/(.+)\s+HEAD$/)?.[1];
  return branch ? normalizeBranch(branch) : null;
}

function normalizeBranch(value: string): string {
  const branch = value.replace(/^refs\/heads\//, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/.test(branch) || branch.includes("..")) {
    throw new Error("invalid default_branch");
  }
  return branch;
}

function ensureGitImportScaffold(repo: Repository, defaultBranch: string): {
  commit_sha: string;
  added: string[];
  preserved: string[];
} {
  const tmpRoot = join(config.dataRoot, "tmp");
  mkdirSync(tmpRoot, { recursive: true });
  const worktree = mkdtempSync(join(tmpRoot, "git-import-app-"));

  try {
    runGit(["clone", repo.storage_path, worktree]);
    runGit(["-C", worktree, "checkout", defaultBranch]);
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
      if (existsSync(destination)) {
        preserved.push(path);
      } else {
        mkdirSync(join(worktree, path.split("/").slice(0, -1).join("/")), { recursive: true });
        writeFileSync(destination, content, { encoding: "utf8" });
        added.push(path);
      }
    }

    if (added.length > 0) {
      runGit(["-C", worktree, "config", "user.email", "system@bittergit.local"]);
      runGit(["-C", worktree, "config", "user.name", "BitterGit"]);
      runGit(["-C", worktree, "add", "-A"]);
      runGit(["-C", worktree, "commit", "-m", "Add Bitter app charter scaffold"]);
      runGit(["-C", worktree, "push", "origin", `HEAD:${defaultBranch}`], {
        BITTERGIT_ACTOR: "system:git-import-app-bundle",
        BITTERGIT_SCOPES: JSON.stringify(["repo:admin"])
      });
    }

    return {
      commit_sha: gitOutput(["-C", worktree, "rev-parse", "HEAD"]).trim(),
      added,
      preserved
    };
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
}

function gitImportSummary(
  source: { kind: "http_git" | "local_git"; host: string | null; path: string },
  record: ImportRecord,
  defaultBranch: string,
  scaffold: { commit_sha: string; added: string[]; preserved: string[] },
  contextFiles: ContextFileReport,
  sourceContract: Record<string, unknown>,
  ephemeralSourceAuthUsed = false
): Record<string, unknown> {
  return {
    source_kind: "git_url_import",
    source_contract: sourceContract,
    canonical_source: "bittergit",
    source_of_truth: "bittergit",
    upstream_relationship: "import_then_detach",
    sync_contract: "one_time_import_no_background_sync",
    upstream_after_import: {
      status: "detached",
      background_sync: false,
      user_message: "Pushes to the upstream Git provider after this import are not synced into BitterGit. Re-import explicitly or use external-primary mode to keep that provider canonical."
    },
    source_url: {
      kind: source.kind,
      host: source.host,
      path: source.path
    },
    provider: record.provider,
    import_id: record.id,
    status: record.status,
    default_branch: defaultBranch,
    branch_count: record.branch_count,
    tag_count: record.tag_count,
    head_sha: record.head_sha,
    scaffold_commit_sha: scaffold.commit_sha,
    scaffold_added: scaffold.added,
    scaffold_preserved: scaffold.preserved,
    context_files: contextFiles,
    terminal_prompt_disabled: true,
    credential_material_returned: false,
    ephemeral_source_auth_used: ephemeralSourceAuthUsed,
    repairable: record.status !== "ok",
    skipped: [],
    blocked: []
  };
}

function gitImportSourceContract(): Record<string, unknown> {
  return {
    mode: "bittergit_import",
    canonical_source: "bittergit",
    source_of_truth: "bittergit",
    upstream_relationship: "import_then_detach",
    sync_contract: "one_time_import_no_background_sync",
    background_sync: false,
    external_mutation_policy: "external pushes after import are not consumed automatically",
    recovery_action: "re-import explicitly or choose external-primary mode before continuing work on the upstream provider"
  };
}

function runGit(args: string[], env: Record<string, string> = {}): void {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    env: { ...gitEnv(), ...env }
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function gitOutput(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8", env: gitEnv() });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function gitEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  env.GIT_TERMINAL_PROMPT = "0";
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GIT_QUARANTINE_PATH;
  return env;
}
