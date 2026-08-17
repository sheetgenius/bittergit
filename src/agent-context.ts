export type ContextFileLifecycle = {
  added?: readonly string[];
  preserved?: readonly string[];
};

export type ContextFileReport = {
  schema: string;
  canonical_instructions: string;
  policy: string;
  files: Array<{
    path: string;
    role: string;
    status: "added" | "preserved" | "missing";
    source_owned: boolean;
    note: string;
  }>;
  added: string[];
  preserved: string[];
  missing: string[];
};

const CONTEXT_FILES = [
  {
    path: "AGENTS.md",
    role: "canonical_agent_instructions",
    source_owned: true,
    note: "Shared app and agent instructions live here."
  },
  {
    path: "APP.md",
    role: "app_charter",
    source_owned: true,
    note: "Product intent, constraints, axes of excellence, and verification gates live here."
  },
  {
    path: "docs/BITTERGRID_DEPLOYMENT_CONTRACT.md",
    role: "bittergrid_deployment_contract",
    source_owned: true,
    note: "BitterGrid build, deploy, verify, and recovery instructions live here when Bitter creates them."
  },
  {
    path: "CLAUDE.md",
    role: "claude_project_memory",
    source_owned: true,
    note: "If present, preserve it. Bitter-created Claude files should stay thin pointers to AGENTS.md."
  },
  {
    path: "GEMINI.md",
    role: "gemini_project_memory",
    source_owned: true,
    note: "If present, preserve it. Bitter-created Gemini files should stay thin pointers to AGENTS.md."
  },
  {
    path: ".claude/",
    role: "claude_project_settings",
    source_owned: true,
    note: "If present, preserve Claude project settings without exposing file contents in support surfaces."
  }
] as const;

export function sourceContextFileReport(
  sourceFiles: readonly string[],
  lifecycle: ContextFileLifecycle = {}
): ContextFileReport {
  const sourceSet = new Set(sourceFiles);
  const addedSet = new Set(lifecycle.added ?? []);
  const preservedSet = new Set(lifecycle.preserved ?? []);
  const files = CONTEXT_FILES.map((entry) => {
    const present = entry.path.endsWith("/")
      ? sourceFiles.some((path) => path.startsWith(entry.path))
      : sourceSet.has(entry.path);
    const status: ContextFileReport["files"][number]["status"] = addedSet.has(entry.path)
      ? "added"
      : preservedSet.has(entry.path) || present
        ? "preserved"
        : "missing";
    return { ...entry, status };
  });

  return {
    schema: "bittergit.agent_context.v1",
    canonical_instructions: "AGENTS.md",
    policy: "Keep shared instructions DRY in AGENTS.md. Provider-specific files are source-owned and should be thin pointers when Bitter creates them.",
    files,
    added: files.filter((file) => file.status === "added").map((file) => file.path),
    preserved: files.filter((file) => file.status === "preserved").map((file) => file.path),
    missing: files.filter((file) => file.status === "missing").map((file) => file.path)
  };
}

export function workcellParentAgentsMd(): string {
  return `# Bitter Workcell Agent Context

You are in a Bitter hosted workcell.

The child app repository owns its own source and app-specific instructions.
Start in the app repo and read repo-local \`AGENTS.md\` and \`APP.md\`.

Keep this parent workcell context out of source commits. Do not commit files
from the parent workspace directory into the app repository.

## Instruction Shape

\`AGENTS.md\` is the canonical shared instruction file. Provider-specific files
such as \`CLAUDE.md\` and \`GEMINI.md\` should stay small and point back to
\`AGENTS.md\` unless the app intentionally owns more specific provider context.

## Deployment Work

If the task involves deployment, hosting, production readiness, DNS, Docker,
Kamal, or BitterGrid, read the repo-local deployment contract if present:

\`docs/BITTERGRID_DEPLOYMENT_CONTRACT.md\`

Do not infer deploy behavior from GitHub Actions, Vercel, local dev defaults,
or framework conventions when a BitterGrid contract is present.

## Safety

Do not commit secret values, tokens, private keys, local credential files,
browser session material, or provider credentials. Store only secret references
or documented setup requirements.
`;
}

export function bitterGridDeploymentContractMd(): string {
  return `# BitterGrid Deployment Contract

This app is prepared for BitterGrid-hosted deployment.

## Source Of Truth

- The app repository owns product source, app-local instructions, and release
  inputs.
- BitterGit records source history, checkpoints, receipts, and support state.
- BitterGrid owns runtime execution: build, release, placement, deploy,
  verification, edge bindings, backup, and recovery.

## Deployment Rules

- Do not assume GitHub Actions, Vercel, Netlify, local dev servers, or framework
  defaults are the deploy executor.
- Do not push images to GHCR as the primary deploy path.
- Do not target Factory hosts or localhost ports as the production runtime.
- If deployment is requested, produce source changes and verification evidence
  that BitterGrid can build and deploy from the repo.
- Keep runtime config as documented requirements or secret references. Do not
  commit secret values, tokens, private keys, or local credential files.

## Expected Agent Workflow

1. Read \`AGENTS.md\` and \`APP.md\`.
2. Identify the app's build/start/test commands from repo files.
3. Add or update deployment docs/config only when the app actually needs them.
4. Verify locally where possible without assuming local success means production
   readiness.
5. Record gaps plainly when external credentials, DNS, billing, or operator
   approval are needed.

## Production Readiness Checklist

- Source builds from a clean checkout.
- Runtime command and required environment variables are documented.
- Health or smoke verification path is documented.
- Secrets are referenced, not committed.
- Rollback or recovery assumptions are explicit.
`;
}

export function claudePointerMd(): string {
  return `# CLAUDE.md

This file intentionally stays small.

Read \`../AGENTS.md\` for the Bitter workcell context. That AGENTS.md file is
canonical; this file is only a provider-specific pointer.
`;
}

export function geminiPointerMd(): string {
  return `# GEMINI.md

This file intentionally stays small.

Read AGENTS.md in this directory for the Bitter workcell context.
`;
}
