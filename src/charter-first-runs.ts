import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { AccountAssertion } from "./assertions";
import { findAccountAppById } from "./apps";
import { listReceipts } from "./deployments";
import { findRepositoryById, type Repository } from "./repos";
import { ensureStorage } from "./storage";
import {
  findHostedAgentLaunch,
  type HostedAgentLaunch
} from "./agent-launches";

export type CharterFirstRun = {
  id: string;
  launch_id: string;
  session_id: string;
  app_id: string;
  repo_id: string;
  account_ref: string;
  workspace_ref: string;
  status: string;
  charter_status: string;
  source_kind: string;
  artifact_import_id: string | null;
  artifact_import_inspected: number;
  substantial_implementation_allowed: number;
  charter_summary_json: string;
  import_context_json: string;
  first_run_prompt: string;
  readiness_output: string;
  repair_action: string | null;
  sufficiency_recorded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CharterAnalysis = {
  status: "missing" | "placeholder" | "incomplete" | "sufficient";
  required_sections: Array<{ name: string; present: boolean; complete: boolean }>;
  axis_count: number;
  sufficient_axis_count: number;
  required_axes: Array<{ name: string; present: boolean; complete: boolean }>;
  verification_gate_count: number;
  has_verification_gates: boolean;
  missing: string[];
  sufficient: boolean;
};

type FirstRunContext = {
  repo: Repository;
  launch: HostedAgentLaunch;
  analysis: CharterAnalysis;
  importContext: Record<string, unknown>;
};

export class ImplementationBlockedError extends Error {
  firstRun: CharterFirstRun;

  constructor(firstRun: CharterFirstRun) {
    super("charter sufficiency is required before substantial implementation");
    this.firstRun = firstRun;
  }
}

const requiredSections = [
  "Purpose",
  "User",
  "First Useful Version",
  "Core Workflow",
  "Constraints",
  "Axes Of Excellence",
  "Verification Gates",
  "Non-Goals"
];

const requiredAxes = [
  "User Value",
  "First Encounter",
  "Workflow Fit",
  "UX",
  "Correctness",
  "Performance",
  "Security",
  "Ecosystem Awareness",
  "Verification"
];

export function createCharterFirstRun(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string,
  launchId: string
): CharterFirstRun {
  const context = buildContext(assertion, appId, sessionId, launchId);
  const status = firstRunStatus(context.analysis, context.importContext);
  const now = new Date().toISOString();
  const firstRun: CharterFirstRun = {
    id: `first_run_${randomUUID()}`,
    launch_id: context.launch.id,
    session_id: context.launch.session_id,
    app_id: context.launch.app_id,
    repo_id: context.launch.repo_id,
    account_ref: context.launch.account_ref,
    workspace_ref: context.launch.workspace_ref,
    status: status.status,
    charter_status: context.analysis.status,
    source_kind: String(context.importContext.source_kind),
    artifact_import_id: nullableString(context.importContext.artifact_import_id),
    artifact_import_inspected: context.importContext.artifact_import_inspected === true ? 1 : 0,
    substantial_implementation_allowed: status.allowed ? 1 : 0,
    charter_summary_json: JSON.stringify(context.analysis),
    import_context_json: JSON.stringify(context.importContext),
    first_run_prompt: firstRunPrompt(context),
    readiness_output: readinessOutput(context, status.allowed),
    repair_action: status.repair_action,
    sufficiency_recorded_at: status.allowed ? now : null,
    created_at: now,
    updated_at: now
  };

  insertFirstRun(firstRun);
  return findCharterFirstRun(assertion, appId, sessionId, launchId, firstRun.id) as CharterFirstRun;
}

export function findCharterFirstRun(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string,
  launchId: string,
  firstRunId: string
): CharterFirstRun | undefined {
  requireLaunch(assertion, appId, sessionId, launchId);
  return ensureStorage().query<CharterFirstRun, [string, string]>(`
    SELECT ${firstRunColumns()}
    FROM charter_first_runs
    WHERE id = ? AND launch_id = ?
  `).get(firstRunId, launchId) ?? undefined;
}

export function listCharterFirstRunsForRepo(repo: Repository): CharterFirstRun[] {
  return ensureStorage().query<CharterFirstRun, [string]>(`
    SELECT ${firstRunColumns()}
    FROM charter_first_runs
    WHERE repo_id = ?
    ORDER BY created_at ASC
  `).all(repo.id);
}

export function recordCharterSufficiency(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string,
  launchId: string,
  firstRunId: string
): CharterFirstRun {
  const existing = findCharterFirstRun(assertion, appId, sessionId, launchId, firstRunId);
  if (!existing) throw new Error("charter-first run not found");

  const context = buildContext(assertion, appId, sessionId, launchId);
  const status = firstRunStatus(context.analysis, context.importContext);
  const now = new Date().toISOString();
  ensureStorage().query(`
    UPDATE charter_first_runs
    SET status = $status,
        charter_status = $charter_status,
        source_kind = $source_kind,
        artifact_import_id = $artifact_import_id,
        artifact_import_inspected = $artifact_import_inspected,
        substantial_implementation_allowed = $substantial_implementation_allowed,
        charter_summary_json = $charter_summary_json,
        import_context_json = $import_context_json,
        first_run_prompt = $first_run_prompt,
        readiness_output = $readiness_output,
        repair_action = $repair_action,
        sufficiency_recorded_at = $sufficiency_recorded_at,
        updated_at = $updated_at
    WHERE id = $id
  `).run({
    $id: existing.id,
    $status: status.status,
    $charter_status: context.analysis.status,
    $source_kind: String(context.importContext.source_kind),
    $artifact_import_id: nullableString(context.importContext.artifact_import_id),
    $artifact_import_inspected: context.importContext.artifact_import_inspected === true ? 1 : 0,
    $substantial_implementation_allowed: status.allowed ? 1 : 0,
    $charter_summary_json: JSON.stringify(context.analysis),
    $import_context_json: JSON.stringify(context.importContext),
    $first_run_prompt: firstRunPrompt(context),
    $readiness_output: readinessOutput(context, status.allowed),
    $repair_action: status.repair_action,
    $sufficiency_recorded_at: status.allowed ? now : null,
    $updated_at: now
  });

  return findCharterFirstRun(assertion, appId, sessionId, launchId, firstRunId) as CharterFirstRun;
}

export function recordImplementationStart(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string,
  launchId: string,
  firstRunId: string
): { status: string; message: string; first_run: Record<string, unknown> } {
  const firstRun = findCharterFirstRun(assertion, appId, sessionId, launchId, firstRunId);
  if (!firstRun) throw new Error("charter-first run not found");
  if (firstRun.substantial_implementation_allowed !== 1) {
    throw new ImplementationBlockedError(firstRun);
  }

  return {
    status: "allowed",
    message: "Charter sufficiency is recorded. Substantial implementation may begin.",
    first_run: charterFirstRunToJson(firstRun)
  };
}

export function charterFirstRunToJson(firstRun: CharterFirstRun): Record<string, unknown> {
  return {
    id: firstRun.id,
    launch_id: firstRun.launch_id,
    session_id: firstRun.session_id,
    app_id: firstRun.app_id,
    repo_id: firstRun.repo_id,
    account_ref: firstRun.account_ref,
    workspace_ref: firstRun.workspace_ref,
    status: firstRun.status,
    charter_status: firstRun.charter_status,
    source_kind: firstRun.source_kind,
    artifact_import_id: firstRun.artifact_import_id,
    artifact_import_inspected: firstRun.artifact_import_inspected === 1,
    substantial_implementation_allowed: firstRun.substantial_implementation_allowed === 1,
    charter_summary: JSON.parse(firstRun.charter_summary_json),
    import_context: JSON.parse(firstRun.import_context_json),
    first_run_prompt: firstRun.first_run_prompt,
    readiness_output: firstRun.readiness_output,
    repair_action: firstRun.repair_action,
    sufficiency_recorded_at: firstRun.sufficiency_recorded_at,
    created_at: firstRun.created_at,
    updated_at: firstRun.updated_at
  };
}

export function charterFirstRunSupportJson(firstRun: CharterFirstRun): Record<string, unknown> {
  const json = charterFirstRunToJson(firstRun);
  return {
    ...json,
    policy: {
      includes_raw_source_contents: false,
      includes_secret_values: false,
      blocks_implementation_until_sufficient: true
    }
  };
}

export function analyzeCharter(text: string | null): CharterAnalysis {
  if (!text) {
    return emptyAnalysis("missing", requiredSections, requiredAxes);
  }

  const sections = sectionMap(text);
  const sectionStatuses = requiredSections.map((name) => {
    const body = sections.get(name.toLowerCase()) ?? "";
    return {
      name,
      present: body.length > 0,
      complete: meaningful(body)
    };
  });
  const axesText = sections.get("axes of excellence") ?? "";
  const axes = axisMap(axesText);
  const requiredAxisStatuses = requiredAxes.map((name) => {
    const body = axes.get(name.toLowerCase()) ?? "";
    return {
      name,
      present: body.length > 0,
      complete: axisComplete(body)
    };
  });
  const verificationGates = extractVerificationGates(sections.get("verification gates") ?? "");
  const sufficientAxisCount = Array.from(axes.values()).filter(axisComplete).length;
  const missing = [
    ...sectionStatuses.filter((section) => !section.complete).map((section) => `section:${section.name}`),
    ...requiredAxisStatuses.filter((axis) => !axis.complete).map((axis) => `axis:${axis.name}`),
    ...(verificationGates.length === 0 ? ["verification_gates"] : [])
  ];
  const sufficient = missing.length === 0 && sufficientAxisCount >= requiredAxes.length;

  return {
    status: sufficient ? "sufficient" : text.includes("TBD") ? "placeholder" : "incomplete",
    required_sections: sectionStatuses,
    axis_count: axes.size,
    sufficient_axis_count: sufficientAxisCount,
    required_axes: requiredAxisStatuses,
    verification_gate_count: verificationGates.length,
    has_verification_gates: verificationGates.length > 0,
    missing,
    sufficient
  };
}

function buildContext(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string,
  launchId: string
): FirstRunContext {
  const launch = requireLaunch(assertion, appId, sessionId, launchId);
  const repo = findRepositoryById(launch.repo_id);
  if (!repo) throw new Error("app repository missing");
  const charterText = existsSync(launch.charter_path) ? readFileSync(launch.charter_path, "utf8") : null;
  return {
    repo,
    launch,
    analysis: analyzeCharter(charterText),
    importContext: sourceImportContext(repo)
  };
}

function requireLaunch(
  assertion: AccountAssertion,
  appId: string,
  sessionId: string,
  launchId: string
): HostedAgentLaunch {
  const app = findAccountAppById(appId);
  if (!app || app.account_ref !== assertion.account_ref) throw new Error("app not found");
  const launch = findHostedAgentLaunch(assertion, appId, sessionId, launchId);
  if (!launch) throw new Error("hosted agent launch not found");
  if (launch.status !== "ready") throw new Error("hosted agent launch is not ready");
  return launch;
}

function sourceImportContext(repo: Repository): Record<string, unknown> {
  const receipts = listReceipts(repo) as Array<Record<string, unknown>>;
  const artifactReceipt = receipts.find((receipt) => receipt.receipt_type === "artifact_app_setup");
  if (!artifactReceipt) {
    return {
      source_kind: "blank_app",
      artifact_import_id: null,
      artifact_import_inspected: false,
      imported_artifact_summary: null
    };
  }

  const body = artifactReceipt.body as Record<string, unknown>;
  const summary = body.import_summary as Record<string, unknown> | undefined;
  return {
    source_kind: "artifact_import",
    artifact_import_id: body.artifact_import_id ?? null,
    artifact_import_inspected: true,
    detected_shape: body.detected_shape ?? null,
    imported_artifact_summary: summary ? {
      import_count: summary.import_count,
      skip_count: summary.skip_count,
      blocked_count: summary.blocked_count,
      detected_shape: summary.detected_shape,
      ready_to_commit: summary.ready_to_commit
    } : null
  };
}

function firstRunStatus(
  analysis: CharterAnalysis,
  importContext: Record<string, unknown>
): { status: string; allowed: boolean; repair_action: string | null } {
  const artifactNeedsInspection = importContext.source_kind === "artifact_import" && importContext.artifact_import_inspected !== true;
  if (analysis.sufficient && !artifactNeedsInspection) {
    return { status: "ready_for_implementation", allowed: true, repair_action: null };
  }

  const repair = artifactNeedsInspection
    ? "Review the artifact import plan and source shape before recording charter sufficiency."
    : "Complete APP.md with product intent, axes of excellence, and verification gates; then record charter sufficiency.";
  return { status: "charter_required", allowed: false, repair_action: repair };
}

function firstRunPrompt(context: FirstRunContext): string {
  const artifactInstruction = context.importContext.source_kind === "artifact_import"
    ? "\n\nThis app started from an imported artifact. Inspect the imported files and summarize what the artifact appears to do before changing behavior."
    : "";
  return `Read AGENTS.md and APP.md. Work with the user to complete the app charter before substantial implementation.

The charter must cover purpose, target user, first useful version, core workflow, constraints, axes of excellence, verification gates, and non-goals. Treat UX, first encounter, performance, reliability, security, ecosystem fit, and cold-user perception as first-class quality axes.

Do not begin substantial implementation until BitterGit records charter sufficiency for this first run.${artifactInstruction}`;
}

function readinessOutput(context: FirstRunContext, allowed: boolean): string {
  if (allowed) {
    return "Charter sufficiency is recorded. The hosted agent may begin substantial implementation from the BitterGit-backed source root.";
  }

  const sourceLine = context.importContext.source_kind === "artifact_import"
    ? "Imported artifact review is recorded; inspect the imported files before implementation."
    : "Blank app scaffold is ready.";
  return `Terminal ready. Source is saved in BitterGit. GitHub is optional. ${sourceLine} First run is charter-only: establish APP.md with axes of excellence and verification gates before substantial implementation.`;
}

function insertFirstRun(firstRun: CharterFirstRun): void {
  ensureStorage().query(`
    INSERT INTO charter_first_runs
      (id, launch_id, session_id, app_id, repo_id, account_ref, workspace_ref,
       status, charter_status, source_kind, artifact_import_id,
       artifact_import_inspected, substantial_implementation_allowed,
       charter_summary_json, import_context_json, first_run_prompt,
       readiness_output, repair_action, sufficiency_recorded_at, created_at,
       updated_at)
    VALUES
      ($id, $launch_id, $session_id, $app_id, $repo_id, $account_ref,
       $workspace_ref, $status, $charter_status, $source_kind,
       $artifact_import_id, $artifact_import_inspected,
       $substantial_implementation_allowed, $charter_summary_json,
       $import_context_json, $first_run_prompt, $readiness_output,
       $repair_action, $sufficiency_recorded_at, $created_at, $updated_at)
  `).run({
    $id: firstRun.id,
    $launch_id: firstRun.launch_id,
    $session_id: firstRun.session_id,
    $app_id: firstRun.app_id,
    $repo_id: firstRun.repo_id,
    $account_ref: firstRun.account_ref,
    $workspace_ref: firstRun.workspace_ref,
    $status: firstRun.status,
    $charter_status: firstRun.charter_status,
    $source_kind: firstRun.source_kind,
    $artifact_import_id: firstRun.artifact_import_id,
    $artifact_import_inspected: firstRun.artifact_import_inspected,
    $substantial_implementation_allowed: firstRun.substantial_implementation_allowed,
    $charter_summary_json: firstRun.charter_summary_json,
    $import_context_json: firstRun.import_context_json,
    $first_run_prompt: firstRun.first_run_prompt,
    $readiness_output: firstRun.readiness_output,
    $repair_action: firstRun.repair_action,
    $sufficiency_recorded_at: firstRun.sufficiency_recorded_at,
    $created_at: firstRun.created_at,
    $updated_at: firstRun.updated_at
  });
}

function firstRunColumns(): string {
  return `
    id, launch_id, session_id, app_id, repo_id, account_ref, workspace_ref,
    status, charter_status, source_kind, artifact_import_id,
    artifact_import_inspected, substantial_implementation_allowed,
    charter_summary_json, import_context_json, first_run_prompt,
    readiness_output, repair_action, sufficiency_recorded_at, created_at,
    updated_at
  `;
}

function sectionMap(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  const pattern = /^##\s+(.+)$/gm;
  const headings = Array.from(text.matchAll(pattern));
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const next = headings[index + 1];
    const name = heading[1].trim().toLowerCase();
    const start = (heading.index ?? 0) + heading[0].length;
    const end = next?.index ?? text.length;
    sections.set(name, text.slice(start, end).trim());
  }
  return sections;
}

function axisMap(text: string): Map<string, string> {
  const axes = new Map<string, string>();
  const pattern = /^###\s+(.+)$/gm;
  const headings = Array.from(text.matchAll(pattern));
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const next = headings[index + 1];
    const name = heading[1].trim().toLowerCase();
    const start = (heading.index ?? 0) + heading[0].length;
    const end = next?.index ?? text.length;
    axes.set(name, text.slice(start, end).trim());
  }
  return axes;
}

function extractVerificationGates(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-") || /^\d+\./.test(line))
    .filter((line) => meaningful(line));
}

function axisComplete(text: string): boolean {
  return /Intent:\s*\S/i.test(text) && /Verification:\s*\S/i.test(text) && meaningful(text);
}

function meaningful(text: string): boolean {
  const stripped = text
    .replace(/[`*_>#-]/g, "")
    .replace(/\bTBD\b/gi, "")
    .replace(/\bTODO\b/gi, "")
    .trim();
  return stripped.length >= 12;
}

function emptyAnalysis(status: "missing" | "placeholder" | "incomplete", sections: string[], axes: string[]): CharterAnalysis {
  return {
    status,
    required_sections: sections.map((name) => ({ name, present: false, complete: false })),
    axis_count: 0,
    sufficient_axis_count: 0,
    required_axes: axes.map((name) => ({ name, present: false, complete: false })),
    verification_gate_count: 0,
    has_verification_gates: false,
    missing: [
      ...sections.map((section) => `section:${section}`),
      ...axes.map((axis) => `axis:${axis}`),
      "verification_gates"
    ],
    sufficient: false
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
