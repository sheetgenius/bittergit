export function supportImportSourceUrl(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const kind = value.kind === "http_git" || value.kind === "local_git"
    ? value.kind
    : "unknown";
  const hostConfigured = nonEmptyString(value.host);
  const pathConfigured = nonEmptyString(value.path);
  return {
    kind,
    host: null,
    host_configured: hostConfigured,
    host_returned: false,
    path: null,
    path_configured: pathConfigured,
    path_returned: false,
    source_configured: hostConfigured || pathConfigured,
    projection: "support_safe_v1"
  };
}

export function supportSourceContract(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return {
    mode: allowedString(value.mode, ["bittergit_import"]),
    canonical_source: allowedString(value.canonical_source, ["bittergit"]),
    source_of_truth: allowedString(value.source_of_truth, ["bittergit"]),
    upstream_relationship: allowedString(value.upstream_relationship, ["import_then_detach"]),
    sync_contract: allowedString(value.sync_contract, ["one_time_import_no_background_sync"]),
    background_sync: value.background_sync === true,
    projection: "support_safe_v1"
  };
}

export function supportImportSummary(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return {
    source_kind: allowedString(value.source_kind, ["git_url_import", "artifact_import", "blank_app"]),
    source_contract: supportSourceContract(value.source_contract),
    canonical_source: allowedString(value.canonical_source, ["bittergit"]),
    source_of_truth: allowedString(value.source_of_truth, ["bittergit"]),
    upstream_relationship: allowedString(value.upstream_relationship, ["import_then_detach"]),
    sync_contract: allowedString(value.sync_contract, ["one_time_import_no_background_sync"]),
    upstream_after_import: {
      status: isRecord(value.upstream_after_import)
        ? allowedString(value.upstream_after_import.status, ["detached"])
        : null,
      background_sync: isRecord(value.upstream_after_import)
        ? value.upstream_after_import.background_sync === true
        : false
    },
    source_url: supportImportSourceUrl(value.source_url),
    provider: safeLabel(value.provider),
    import_id: safeIdentifier(value.import_id),
    status: safeLabel(value.status),
    default_branch: safeRefName(value.default_branch),
    branch_count: safeCount(value.branch_count),
    tag_count: safeCount(value.tag_count),
    head_sha: safeSha(value.head_sha),
    scaffold_commit_sha: safeSha(value.scaffold_commit_sha),
    scaffold_added_count: safeArrayCount(value.scaffold_added),
    scaffold_preserved_count: safeArrayCount(value.scaffold_preserved),
    terminal_prompt_disabled: value.terminal_prompt_disabled === true,
    credential_material_returned: false,
    ephemeral_source_auth_used: value.ephemeral_source_auth_used === true,
    repairable: value.repairable === true,
    import_count: safeCount(value.import_count),
    skip_count: safeCount(value.skip_count),
    blocked_count: safeCount(value.blocked_count),
    detected_shape: safeLabel(value.detected_shape),
    ready_to_commit: value.ready_to_commit === true,
    projection: "support_safe_v1"
  };
}

export function safeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,240}$/.test(trimmed) ? trimmed : null;
}

export function safeSha(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{7,64}$/i.test(trimmed) ? trimmed : null;
}

export function safeLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/.test(trimmed) ? trimmed : null;
}

export function safeRefName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.includes("..")) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/.test(trimmed) ? trimmed : null;
}

export function safeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function allowedString(value: unknown, allowed: string[]): string | null {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function safeArrayCount(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}
