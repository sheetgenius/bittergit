import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { config } from "./config";
import { ensureStorage } from "./storage";
import type { AccountAssertion } from "./assertions";

export type ArtifactImportIntake = {
  id: string;
  account_ref: string;
  workspace_ref: string;
  source_kind: string;
  source_label: string;
  source_path: string;
  status: string;
  detected_shape: string;
  summary_json: string;
  plan_json: string;
  created_at: string;
  updated_at: string;
};

export type ArtifactImportReviewItem = {
  path: string;
  action: "import" | "skip" | "block";
  reason: string;
  repair_action?: string;
  family: string | null;
  size_bytes: number | null;
};

export type ArtifactImportPlan = {
  will_import: ArtifactImportReviewItem[];
  will_skip: ArtifactImportReviewItem[];
  blocked: ArtifactImportReviewItem[];
};

export type ArtifactImportSummary = {
  import_count: number;
  skip_count: number;
  blocked_count: number;
  total_import_bytes: number;
  detected_shape: string;
  ready_to_commit: boolean;
};

export type ArtifactImportCandidateEntry = {
  path: string;
  size_bytes: number;
  kind: "file" | "directory" | "symlink" | "other";
};

const supportedFamilies: Record<string, string> = {
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".js": "javascript",
  ".mjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".txt": "text",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".avif": "image",
  ".ico": "image",
  ".svg": "svg",
  ".woff": "font",
  ".woff2": "font",
  ".ttf": "font",
  ".otf": "font"
};

const nestedArchiveExtensions = new Set([
  ".zip",
  ".tar",
  ".tgz",
  ".gz",
  ".rar",
  ".7z",
  ".bz2",
  ".xz"
]);

export function createArtifactImportReview(
  assertion: AccountAssertion,
  input: { source_kind?: string; source_path?: string }
): ArtifactImportIntake {
  const sourceKind = normalizeSourceKind(input.source_kind);
  const sourcePath = requiredString(input.source_path, "source_path");
  const resolvedSourcePath = resolveArtifactSourcePath(sourcePath);
  if (!existsSync(resolvedSourcePath)) throw new Error("artifact source not found");

  const candidates = sourceKind === "folder"
    ? entriesFromFolder(resolvedSourcePath)
    : entriesFromZip(resolvedSourcePath);
  const plan = reviewArtifactEntries(candidates);
  const summary = summarizePlan(plan);
  const now = new Date().toISOString();
  const intake: ArtifactImportIntake = {
    id: `artifact_import_${randomUUID()}`,
    account_ref: assertion.account_ref,
    workspace_ref: assertion.workspace_ref,
    source_kind: sourceKind,
    source_label: basename(resolvedSourcePath),
    source_path: resolvedSourcePath,
    status: summary.ready_to_commit ? "ready" : "blocked",
    detected_shape: summary.detected_shape,
    summary_json: JSON.stringify(summary),
    plan_json: JSON.stringify(plan),
    created_at: now,
    updated_at: now
  };

  ensureStorage().query(`
    INSERT INTO artifact_import_intakes
      (id, account_ref, workspace_ref, source_kind, source_label, source_path,
       status, detected_shape, summary_json, plan_json, created_at, updated_at)
    VALUES
      ($id, $account_ref, $workspace_ref, $source_kind, $source_label, $source_path,
       $status, $detected_shape, $summary_json, $plan_json, $created_at, $updated_at)
  `).run({
    $id: intake.id,
    $account_ref: intake.account_ref,
    $workspace_ref: intake.workspace_ref,
    $source_kind: intake.source_kind,
    $source_label: intake.source_label,
    $source_path: intake.source_path,
    $status: intake.status,
    $detected_shape: intake.detected_shape,
    $summary_json: intake.summary_json,
    $plan_json: intake.plan_json,
    $created_at: intake.created_at,
    $updated_at: intake.updated_at
  });

  return intake;
}

export function findArtifactImportIntake(assertion: AccountAssertion, id: string): ArtifactImportIntake | undefined {
  return ensureStorage().query<ArtifactImportIntake, [string, string]>(`
    SELECT id, account_ref, workspace_ref, source_kind, source_label, source_path,
           status, detected_shape, summary_json, plan_json, created_at, updated_at
    FROM artifact_import_intakes
    WHERE id = ? AND account_ref = ?
  `).get(id, assertion.account_ref) ?? undefined;
}

export function artifactImportIntakeToJson(intake: ArtifactImportIntake): Record<string, unknown> {
  return {
    id: intake.id,
    account_ref: intake.account_ref,
    workspace_ref: intake.workspace_ref,
    source_kind: intake.source_kind,
    source_label: intake.source_label,
    status: intake.status,
    detected_shape: intake.detected_shape,
    summary: JSON.parse(intake.summary_json),
    plan: JSON.parse(intake.plan_json),
    ready_to_commit: intake.status === "ready",
    github_required: false,
    created_at: intake.created_at,
    updated_at: intake.updated_at
  };
}

export function artifactImportSupportJson(intake: ArtifactImportIntake): Record<string, unknown> {
  const summary = JSON.parse(intake.summary_json) as ArtifactImportSummary;
  const plan = JSON.parse(intake.plan_json) as ArtifactImportPlan;
  return {
    id: intake.id,
    account_ref: intake.account_ref,
    workspace_ref: intake.workspace_ref,
    source_kind: intake.source_kind,
    source_label: intake.source_label,
    status: intake.status,
    detected_shape: intake.detected_shape,
    summary,
    policy: {
      scanned_before_commit: true,
      commits_blocked_until_blockers_resolved: true,
      includes_raw_file_contents: false,
      github_required: false
    },
    sample_paths: {
      will_import: plan.will_import.slice(0, 10).map((entry) => entry.path),
      will_skip: plan.will_skip.slice(0, 10).map((entry) => ({ path: entry.path, reason: entry.reason })),
      blocked: plan.blocked.slice(0, 10).map((entry) => ({
        path: entry.path,
        reason: entry.reason,
        repair_action: entry.repair_action
      }))
    },
    created_at: intake.created_at,
    updated_at: intake.updated_at
  };
}

export function artifactImportPlan(intake: ArtifactImportIntake): ArtifactImportPlan {
  return JSON.parse(intake.plan_json) as ArtifactImportPlan;
}

export function reviewArtifactEntries(entries: ArtifactImportCandidateEntry[]): ArtifactImportPlan {
  const plan: ArtifactImportPlan = {
    will_import: [],
    will_skip: [],
    blocked: []
  };

  for (const entry of entries) {
    const normalized = normalizeArtifactPath(entry.path);
    if (!normalized.ok) {
      plan.blocked.push(item(entry.path, "block", normalized.reason, null, entry.size_bytes));
      continue;
    }

    const path = normalized.path;
    if (entry.kind === "symlink") {
      plan.blocked.push(item(path, "block", "symlink", null, entry.size_bytes));
      continue;
    }
    if (entry.kind === "other") {
      plan.blocked.push(item(path, "block", "device_or_special_file", null, entry.size_bytes));
      continue;
    }
    if (entry.kind === "directory") continue;

    const lowRiskSkip = lowRiskSkipReason(path);
    if (lowRiskSkip) {
      plan.will_skip.push(item(path, "skip", lowRiskSkip, null, entry.size_bytes));
      continue;
    }

    const blockReason = hardBlockReason(path, entry.size_bytes);
    if (blockReason) {
      plan.blocked.push(item(path, "block", blockReason, null, entry.size_bytes));
      continue;
    }

    const family = supportedFamily(path);
    if (!family) {
      plan.will_skip.push(item(path, "skip", "unsupported_file_type", null, entry.size_bytes));
      continue;
    }

    plan.will_import.push(item(path, "import", "supported_file", family, entry.size_bytes));
  }

  plan.will_import.sort(byPath);
  plan.will_skip.sort(byPath);
  plan.blocked.sort(byPath);
  return plan;
}

function entriesFromFolder(root: string): ArtifactImportCandidateEntry[] {
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory()) throw new Error("folder import source must be a directory");

  const entries: ArtifactImportCandidateEntry[] = [];
  walk(root, root, entries);
  return entries;
}

function walk(root: string, current: string, entries: ArtifactImportCandidateEntry[]): void {
  for (const name of readdirSync(current)) {
    const absolute = join(current, name);
    const rel = relative(root, absolute).split(sep).join("/");
    const stat = lstatSync(absolute);

    if (stat.isSymbolicLink()) {
      entries.push({ path: rel, size_bytes: 0, kind: "symlink" });
      continue;
    }

    if (stat.isDirectory()) {
      if (lowRiskSkipReason(`${rel}/`)) {
        entries.push({ path: `${rel}/`, size_bytes: 0, kind: "file" });
        continue;
      }
      entries.push({ path: `${rel}/`, size_bytes: 0, kind: "directory" });
      walk(root, absolute, entries);
      continue;
    }

    if (stat.isFile()) {
      entries.push({ path: rel, size_bytes: stat.size, kind: "file" });
      continue;
    }

    entries.push({ path: rel, size_bytes: 0, kind: "other" });
  }
}

function entriesFromZip(sourcePath: string): ArtifactImportCandidateEntry[] {
  const sourceStat = lstatSync(sourcePath);
  if (sourceStat.isSymbolicLink()) throw new Error("zip import source must not be a symlink");
  if (!sourceStat.isFile()) throw new Error("zip import source must be a file");
  if (!sourcePath.toLowerCase().endsWith(".zip")) throw new Error("zip import source must end with .zip");

  const result = spawnSync("zipinfo", ["-l", sourcePath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`zip scan failed: ${result.stderr.trim()}`);

  const entries: ArtifactImportCandidateEntry[] = [];
  for (const line of result.stdout.split("\n")) {
    if (!/^[dl-][rwx-]{9}\s/.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10) continue;
    const mode = parts[0];
    const size = Number(parts[3]);
    const path = parts.slice(9).join(" ");
    if (!path) continue;
    entries.push({
      path,
      size_bytes: Number.isFinite(size) ? size : 0,
      kind: mode.startsWith("d") || path.endsWith("/")
        ? "directory"
        : mode.startsWith("l")
          ? "symlink"
          : mode.startsWith("-")
            ? "file"
            : "other"
    });
  }

  if (entries.length === 0) throw new Error("zip import source has no scannable entries");
  return entries;
}

export function artifactSourcePathWithinRoot(sourcePath: string, allowedRoot: string): boolean {
  const relativePath = relative(allowedRoot, sourcePath);
  return relativePath === "" || !relativePath.startsWith("..") && !relativePath.startsWith(sep) && !relativePath.split(sep).includes("..");
}

function resolveArtifactSourcePath(sourcePath: string): string {
  const resolvedSourcePath = resolve(sourcePath);
  if (!existsSync(resolvedSourcePath)) throw new Error("artifact source not found");
  if (lstatSync(resolvedSourcePath).isSymbolicLink()) throw new Error("artifact source must not be a symlink");

  if (!config.artifactImportRoot) return resolvedSourcePath;

  const allowedRoot = realpathSync(config.artifactImportRoot);
  const realSourcePath = realpathSync(resolvedSourcePath);
  if (!artifactSourcePathWithinRoot(realSourcePath, allowedRoot)) {
    throw new Error("artifact source must be inside BITTERGIT_ARTIFACT_IMPORT_ROOT");
  }
  return realSourcePath;
}

function normalizeArtifactPath(path: string): { ok: true; path: string } | { ok: false; reason: string } {
  const raw = path.replaceAll("\\", "/").trim();
  if (!raw || raw.includes("\0")) return { ok: false, reason: "invalid_path" };
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) return { ok: false, reason: "absolute_path" };

  const segments = raw.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return { ok: false, reason: "path_traversal" };
  }

  return { ok: true, path: segments.join("/") + (raw.endsWith("/") ? "/" : "") };
}

function summarizePlan(plan: ArtifactImportPlan): ArtifactImportSummary {
  const detectedShape = detectShape(plan.will_import);
  return {
    import_count: plan.will_import.length,
    skip_count: plan.will_skip.length,
    blocked_count: plan.blocked.length,
    total_import_bytes: plan.will_import.reduce((sum, entry) => sum + (entry.size_bytes ?? 0), 0),
    detected_shape: detectedShape,
    ready_to_commit: plan.blocked.length === 0 && plan.will_import.length > 0
  };
}

function detectShape(importable: ArtifactImportReviewItem[]): string {
  const html = importable.filter((entry) => entry.family === "html");
  const media = importable.filter((entry) => entry.family === "image" || entry.family === "svg" || entry.family === "font");
  const cssOrJs = importable.filter((entry) => entry.family === "css" || entry.family === "javascript");
  const hasIndex = html.some((entry) => basename(entry.path).toLowerCase() === "index.html");

  if (html.length === 1 && cssOrJs.length === 0 && media.length === 0) return "single_html_artifact";
  if (hasIndex || html.length > 0 && cssOrJs.length > 0) return "static_html_site";
  if (media.length > 0 && html.length === 0 && cssOrJs.length === 0) return "media_bundle";
  if (importable.length > 0) return "unknown_safe_source_folder";
  return "no_importable_files";
}

function lowRiskSkipReason(path: string): string | null {
  const lower = path.toLowerCase();
  const base = basename(lower.replace(/\/$/, ""));
  const segments = lower.split("/").filter(Boolean);

  if (segments.includes("__macosx")) return "macos_archive_metadata";
  if (base === ".ds_store") return "macos_metadata";
  if (segments.includes("node_modules")) return "dependency_directory";
  if (base.endsWith("~") || base.endsWith(".tmp") || base.endsWith(".temp") || base.endsWith(".swp")) return "temporary_file";
  if (nestedArchiveExtensions.has(extension(lower))) return "nested_archive";
  return null;
}

function hardBlockReason(path: string, sizeBytes: number): string | null {
  const lower = path.toLowerCase();
  const base = basename(lower);
  const segments = lower.split("/").filter(Boolean);

  if (sizeBytes > config.maxArtifactImportFileBytes) return "oversized_file";
  if (base === ".env" || base.startsWith(".env.") && base !== ".env.example") return "env_file";
  if (base.endsWith(".pem") || base.endsWith(".key") || base === "id_rsa" || base === "id_ed25519") return "private_key";
  if (segments.join("/").includes(".aws/credentials")) return "cloud_credentials";
  if (base.includes("token")) return "token_file";
  if (base.includes("secret")) return "credential_dump";
  if (base.includes("credential")) return "credential_dump";
  if (base.includes("service-account") || base.includes("service_account")) return "cloud_credentials";
  if (base === ".npmrc" || base === ".pypirc") return "token_file";
  return null;
}

function supportedFamily(path: string): string | null {
  if (basename(path) === ".gitignore") return "gitignore";
  return supportedFamilies[extension(path.toLowerCase())] ?? null;
}

function extension(path: string): string {
  const base = basename(path);
  const index = base.lastIndexOf(".");
  return index === -1 ? "" : base.slice(index);
}

function item(
  path: string,
  action: "import" | "skip" | "block",
  reason: string,
  family: string | null,
  sizeBytes: number | null
): ArtifactImportReviewItem {
  return {
    path,
    action,
    reason,
    ...(action === "block" && secretGrantRepairReason(reason) ? {
      repair_action: "Remove this file from the artifact and declare the needed secret through the BitterPass secret grant flow."
    } : {}),
    family,
    size_bytes: sizeBytes
  };
}

function secretGrantRepairReason(reason: string): boolean {
  return [
    "env_file",
    "private_key",
    "cloud_credentials",
    "token_file",
    "credential_dump"
  ].includes(reason);
}

function byPath(left: ArtifactImportReviewItem, right: ArtifactImportReviewItem): number {
  return left.path.localeCompare(right.path);
}

function normalizeSourceKind(value: unknown): "folder" | "zip" {
  if (value === "folder" || value === "zip") return value;
  throw new Error("source_kind must be folder or zip");
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value.trim();
}
