export type ProductionSshMode = "disabled" | "read_only" | "operate";

export type ProductionSshPolicy = {
  enabled: boolean;
  mode: ProductionSshMode;
  read_only_diagnostics_enabled: boolean;
  write_enabled: boolean;
  write_reason_required: boolean;
  write_reason_present: boolean;
  write_reason: string | null;
  target: {
    service: string;
    host_ref: string;
  };
  owner_plane: string;
  credential_material_returned: false;
  key_material_returned: false;
  command_output_included: false;
  posture: string;
};

export function defaultProductionSshPolicy(): ProductionSshPolicy {
  return {
    enabled: true,
    mode: "read_only",
    read_only_diagnostics_enabled: true,
    write_enabled: false,
    write_reason_required: true,
    write_reason_present: false,
    write_reason: null,
    target: {
      service: "app",
      host_ref: "grid-host-01"
    },
    owner_plane: "BitterGrid",
    credential_material_returned: false,
    key_material_returned: false,
    command_output_included: false,
    posture: "mvp_prompt_boundary"
  };
}

export function normalizeProductionSsh(input: unknown): ProductionSshPolicy {
  const base = defaultProductionSshPolicy();
  if (!isRecord(input)) return base;

  const explicitDisabled = input.enabled === false || input.mode === "disabled";
  const writeRequested = input.write_enabled === true || input.mode === "operate" || input.mode === "write";
  if (explicitDisabled && writeRequested) {
    throw new Error("production SSH cannot be disabled and write-enabled in the same session");
  }

  const target = normalizeTarget(input.target, base.target);

  if (explicitDisabled) {
    return {
      ...base,
      enabled: false,
      mode: "disabled",
      read_only_diagnostics_enabled: false,
      write_enabled: false,
      write_reason_present: false,
      write_reason: null,
      target
    };
  }

  if (writeRequested) {
    const writeReason = stringValue(input.write_reason ?? input.reason);
    if (!writeReason) throw new Error("production SSH write/operate mode requires write_reason");
    return {
      ...base,
      mode: "operate",
      write_enabled: true,
      write_reason_present: true,
      write_reason: writeReason,
      target
    };
  }

  const readOnlyDiagnostics = input.allow_read_only_diagnostics !== false;
  return {
    ...base,
    enabled: readOnlyDiagnostics,
    mode: readOnlyDiagnostics ? "read_only" : "disabled",
    read_only_diagnostics_enabled: readOnlyDiagnostics,
    target
  };
}

export function productionSshFromJson(value: string | null | undefined): ProductionSshPolicy {
  if (!value) return defaultProductionSshPolicy();
  try {
    return normalizeProductionSsh(JSON.parse(value));
  } catch {
    return defaultProductionSshPolicy();
  }
}

export function serializeProductionSsh(policy: ProductionSshPolicy): string {
  return JSON.stringify(policy);
}

export function productionSshSessionJson(
  policy: ProductionSshPolicy,
  sessionStatus: string
): Record<string, unknown> {
  return {
    enabled: policy.enabled,
    mode: policy.mode,
    read_only_diagnostics_enabled: policy.read_only_diagnostics_enabled,
    write_enabled: policy.write_enabled,
    write_reason_required: policy.write_reason_required,
    write_reason_present: policy.write_reason_present,
    target: policy.target,
    owner_plane: policy.owner_plane,
    access_status: sessionStatus === "revoked" ? "revoked" : policy.enabled ? "available" : "disabled",
    credential_material_returned: false,
    key_material_returned: false,
    command_output_included: false,
    posture: policy.posture,
    guidance: productionSshGuidance(policy)
  };
}

export function productionSshSupportJson(
  policy: ProductionSshPolicy,
  sessionStatus: string
): Record<string, unknown> {
  return {
    enabled: policy.enabled,
    mode: policy.mode,
    read_only_diagnostics_enabled: policy.read_only_diagnostics_enabled,
    write_enabled: policy.write_enabled,
    write_reason_required: policy.write_reason_required,
    write_reason_present: policy.write_reason_present,
    target: policy.target,
    owner_plane: policy.owner_plane,
    access_status: sessionStatus === "revoked" ? "revoked" : policy.enabled ? "available" : "disabled",
    credential_material_returned: false,
    key_material_returned: false,
    command_output_included: false,
    private_logs_included: false
  };
}

export function productionSshGuidance(policy: ProductionSshPolicy): string[] {
  if (!policy.enabled) {
    return [
      "Production SSH is disabled for this session.",
      "Use support state, source history, deploy receipts, and Grid repair actions before requesting live access."
    ];
  }

  const base = [
    "Production SSH is an MVP break-glass and live-diagnostics capability.",
    "Prefer read-only commands for live runtime inspection when source, receipts, deploy state, and support-debug are insufficient.",
    "Do not paste, print, commit, or store SSH key material, tokens, credential refs, private runtime output, or secret values."
  ];

  if (policy.write_enabled) {
    return [
      ...base,
      "This session explicitly enables write/operate SSH. Use it only for the stated session reason and keep actions minimal, reversible, and receipt-backed."
    ];
  }

  return [
    ...base,
    "Write/operate SSH is disabled for this session. Do not run mutating production commands unless a later session explicitly enables write access."
  ];
}

function normalizeTarget(input: unknown, fallback: ProductionSshPolicy["target"]): ProductionSshPolicy["target"] {
  if (!isRecord(input)) return fallback;
  return {
    service: stringValue(input.service) ?? fallback.service,
    host_ref: stringValue(input.host_ref) ?? fallback.host_ref
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
