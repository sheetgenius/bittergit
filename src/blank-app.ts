import { readdirSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { config } from "./config";
import type { Repository } from "./repos";
import {
  bitterGridDeploymentContractMd,
  sourceContextFileReport,
  type ContextFileReport
} from "./agent-context";

export function initializeBlankAppSource(repo: Repository): { commit_sha: string; files: string[]; context_files: ContextFileReport } {
  const tmpRoot = join(config.dataRoot, "tmp");
  mkdirSync(tmpRoot, { recursive: true });
  const worktree = mkdtempSync(join(tmpRoot, "blank-app-"));

  try {
    runGit(["clone", repo.storage_path, worktree]);
    runGit(["-C", worktree, "checkout", "-B", "main"]);
    clearWorktree(worktree);
    writeFileSync(join(worktree, "AGENTS.md"), blankAgentsMd(), { encoding: "utf8" });
    writeFileSync(join(worktree, "APP.md"), blankAppMd(), { encoding: "utf8" });
    mkdirSync(join(worktree, "docs"), { recursive: true });
    writeFileSync(join(worktree, "docs", "BITTERGRID_DEPLOYMENT_CONTRACT.md"), bitterGridDeploymentContractMd(), { encoding: "utf8" });
    writeFileSync(join(worktree, ".gitignore"), blankGitignore(), { encoding: "utf8" });
    runGit(["-C", worktree, "config", "user.email", "system@bittergit.local"]);
    runGit(["-C", worktree, "config", "user.name", "BitterGit"]);
    runGit(["-C", worktree, "add", "-A"]);

    const status = gitOutput(["-C", worktree, "status", "--porcelain"]);
    if (status.trim().length > 0) {
      runGit(["-C", worktree, "commit", "-m", "Initialize blank Bitter app"]);
      runGit(["-C", worktree, "push", "--force", "origin", "main"], {
        BITTERGIT_ACTOR: "system:app-bundle",
        BITTERGIT_SCOPES: JSON.stringify(["repo:admin"])
      });
    }

    const files = listSourceFiles(repo);
    return {
      commit_sha: gitOutput(["-C", worktree, "rev-parse", "HEAD"]).trim(),
      files,
      context_files: sourceContextFileReport(files, {
        added: ["AGENTS.md", "APP.md", "docs/BITTERGRID_DEPLOYMENT_CONTRACT.md"],
        preserved: []
      })
    };
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
}

export function listSourceFiles(repo: Repository, ref = "refs/heads/main"): string[] {
  const output = gitOutput(["--git-dir", repo.storage_path, "ls-tree", "-r", "--name-only", ref]);
  return output.split("\n").map((line) => line.trim()).filter(Boolean).sort();
}

function clearWorktree(worktree: string): void {
  for (const entry of readdirSync(worktree)) {
    if (entry === ".git") continue;
    rmSync(join(worktree, entry), { recursive: true, force: true });
  }
}

export function blankAgentsMd(): string {
  return `# AGENTS.md

You are working in a Bitter app workspace.

## Environment

- Source is backed by BitterGit and \`origin\` should point at the BitterGit remote.
- The hosted workcell is app-scoped and account-scoped.
- Claude, Codex, and other coding agents should work through normal files,
  shell commands, Git history, checkpoints, receipts, and the \`bitter\` CLI.

## Bitter CLI

Use the \`bitter\` CLI, the Bitter command line interface, for app, history,
secret, deploy, verification, and support workflows when those commands are
available in the environment. Treat this as the bitter CLI surface for the app.

Useful workflow categories:

- \`bitter app\` for app context and status.
- \`bitter history\` for source history, checkpoints, restore, and diffs.
- \`bitter secrets\` for secret references and credential grants.
- \`bitter deploy\` for publish, preview, verification, rollback, and receipts.
- \`bitter support\` for support/debug bundles.

## Deployment

If the task involves deployment, hosting, production readiness, DNS, Docker,
Kamal, or BitterGrid, read \`docs/BITTERGRID_DEPLOYMENT_CONTRACT.md\` before
changing deployment behavior. BitterGrid owns build, release, deploy,
verification, edge bindings, backup, and recovery for hosted apps.

Do not commit secret values, tokens, private keys, local credential files,
browser session material, or provider credentials. Store only secret references
or documented setup requirements.

## Production SSH

Some hosted sessions may expose production SSH as a break-glass or live
diagnostics capability. Read-only diagnostics may be available by default so an
agent can inspect live runtime truth when source history, receipts, deploy
state, and support output are insufficient.

Write or operate access is off by default. Do not run mutating production
commands unless the current session explicitly enables write/operate access and
states the reason. Prefer read-only commands first, keep any live inspection
minimal, and never print, paste, commit, or store SSH key material, tokens,
credential refs, private runtime output, or secret values.

## Work Style

Keep work small, reviewable, and checkpointable. Prefer a sequence of coherent
changes over one large speculative implementation.

The first task is to establish the app charter with the user in \`APP.md\`.
Do not begin substantial implementation until \`APP.md\` has enough product
intent, user context, constraints, axes of excellence, and verification
standards to guide long-horizon work.

Long-horizon autonomous work naturally falls into local optima. This is not a
weakness. It is useful pressure when the charter defines many axes of
excellence and high-level verification gates. The job is to make the local
optimum excellent across the important axes, not just easy for the builder.

Inspect the app as a cold end user who knows nothing about the repo, previous
conversation, implementation, or founder context. If the first encounter is
confusing, generic, misleading, visually untrustworthy, or too internal, the
work is not done.
`;
}

export function blankAppMd(): string {
  const axes = [
    "User Value",
    "First Encounter",
    "Workflow Fit",
    "UX",
    "Visual Design",
    "Interaction Design",
    "Simplicity",
    "Correctness",
    "Performance",
    "Reliability",
    "Operability",
    "Security",
    "Privacy",
    "Data Ownership",
    "Accessibility",
    "Content And Copy",
    "Domain Fit",
    "Ecosystem Awareness",
    "Platform Fit",
    "Distribution",
    "Interoperability",
    "Competitive Position",
    "Economics",
    "Maintainability",
    "Verification"
  ];

  return `# App Charter

This placeholder must be completed with the user before substantial
implementation begins.

## Purpose

TBD.

## User

TBD.

## First Useful Version

TBD.

## Core Workflow

TBD.

## Constraints

TBD.

## Axes Of Excellence

${axes.map((axis) => `### ${axis}

- Intent: TBD.
- Verification: TBD.`).join("\n\n")}

## Verification Gates

- TBD.

## Non-Goals

TBD.
`;
}

export function blankGitignore(): string {
  return [
    ".env",
    ".env.*",
    "!.env.example",
    "*.pem",
    "*.key",
    ".DS_Store",
    "node_modules/",
    ".var/",
    "tmp/",
    ""
  ].join("\n");
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
