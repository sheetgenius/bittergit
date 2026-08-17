import { createHash, createHmac } from "node:crypto";
import { config } from "./config";
import {
  recordAssertionUse,
  requireAssertionNotRevoked,
  requireTrustedAssertionKey,
  signIssuerPayload,
  type AssertionTrustProof
} from "./assertion-trust";

export type AccountAssertion = {
  format: "bga1" | "bga2";
  issuer: string;
  audience: string;
  subject: string;
  assertion_id: string | null;
  key_ref: string | null;
  authority_kind: string;
  account_ref: string;
  workspace_ref: string;
  plan_key: string;
  plan_status: string;
  included_apps: number;
  github_required: false;
  source: string;
  asserted_at: string;
  expires_at: string | null;
  hosted_workcell_limit: number;
  monthly_hosted_run_limit: number | null;
  storage_limit_mb: number | null;
  mirror_export_allowed: boolean;
  trust: AssertionTrustProof;
};

export type PlanSummary = {
  assertion_issuer: string;
  assertion_subject: string;
  assertion_id: string | null;
  assertion_key_ref: string | null;
  authority_kind: string;
  account_ref: string;
  workspace_ref: string;
  plan_key: string;
  plan_status: string;
  included_apps: number;
  active_app_count: number;
  remaining_app_slots: number;
  github_required: false;
  source: string;
  hosted_workcell_limit: number;
  monthly_hosted_run_limit: number | null;
  storage_limit_mb: number | null;
  mirror_export_allowed: boolean;
  assertion_trust: AssertionTrustProof;
};

export function parseAccountAssertion(request: Request): AccountAssertion {
  const header = request.headers.get("x-bitter-account-assertion");
  if (!header) throw new Error("account assertion required");

  const parts = header.split(".");
  if (parts.length !== 3 || (parts[0] !== "bga1" && parts[0] !== "bga2")) {
    throw new Error("invalid account assertion format");
  }

  const [format, payload, signature] = parts as ["bga1" | "bga2", string, string];
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid account assertion payload");
  }

  const expected = signAssertionPayload(payload, format, decoded);
  if (!timingSafeEqualHex(signature, expected)) {
    throw new Error("invalid account assertion signature");
  }

  return normalizeAssertion(decoded, format);
}

export function signLocalAssertion(input: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
  return `bga1.${payload}.${signAssertionPayload(payload, "bga1")}`;
}

export function signIssuerAssertion(input: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
  return `bga2.${payload}.${signAssertionPayload(payload, "bga2", input)}`;
}

export function planSummary(assertion: AccountAssertion, activeAppCount: number): PlanSummary {
  return {
    assertion_issuer: assertion.issuer,
    assertion_subject: assertion.subject,
    assertion_id: assertion.assertion_id,
    assertion_key_ref: assertion.key_ref,
    authority_kind: assertion.authority_kind,
    account_ref: assertion.account_ref,
    workspace_ref: assertion.workspace_ref,
    plan_key: assertion.plan_key,
    plan_status: assertion.plan_status,
    included_apps: assertion.included_apps,
    active_app_count: activeAppCount,
    remaining_app_slots: Math.max(0, assertion.included_apps - activeAppCount),
    github_required: false,
    source: assertion.source,
    hosted_workcell_limit: assertion.hosted_workcell_limit,
    monthly_hosted_run_limit: assertion.monthly_hosted_run_limit,
    storage_limit_mb: assertion.storage_limit_mb,
    mirror_export_allowed: assertion.mirror_export_allowed,
    assertion_trust: assertion.trust
  };
}

export function accountOwnerSlug(accountRef: string): string {
  const lowered = accountRef.toLowerCase();
  const normalized = lowered
    .replace(/^account[:/_-]?/, "")
    .replace(/^acct[:/_-]?/, "acct-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");

  const digest = createHash("sha256").update(accountRef).digest("hex").slice(0, 8);
  const base = normalized.length > 0 ? normalized : `acct-${digest}`;
  if (base.length <= 54) return base;
  return `${base.slice(0, 54)}-${digest}`;
}

function normalizeAssertion(value: unknown, format: "bga1" | "bga2"): AccountAssertion {
  if (!isRecord(value)) throw new Error("invalid account assertion payload");

  const accountRef = requiredString(value.account_ref, "account_ref");
  const workspaceRef = requiredString(value.workspace_ref ?? accountRef, "workspace_ref");
  const issuer = format === "bga2"
    ? requiredString(value.iss ?? value.issuer, "issuer")
    : optionalString(value.iss ?? value.issuer) ?? "local_assertion";
  const audience = optionalString(value.aud ?? value.audience) ?? config.assertionAudience;
  const subject = format === "bga2"
    ? requiredString(value.sub ?? value.subject, "subject")
    : optionalString(value.sub ?? value.subject) ?? accountRef;
  if (audience !== config.assertionAudience) {
    throw new Error("account assertion audience mismatch");
  }
  const assertionId = format === "bga2"
    ? requiredString(value.jti ?? value.assertion_id, "assertion_id")
    : optionalString(value.jti ?? value.assertion_id) ?? null;
  const keyRef = format === "bga2"
    ? requiredString(value.kid ?? value.key_ref, "key_ref")
    : optionalString(value.kid ?? value.key_ref) ?? null;

  const planKey = requiredString(value.plan_key, "plan_key");
  const planStatus = optionalString(value.plan_status ?? value.status) ?? "active";
  const includedApps = positiveInteger(value.included_apps ?? value.app_limit ?? 1, "included_apps");
  const githubRequired = value.github_required === undefined ? false : value.github_required;
  if (githubRequired !== false) throw new Error("account assertion must not require GitHub");
  if (value.secret_material_returned !== undefined && value.secret_material_returned !== false) {
    throw new Error("account assertion must not include secret material");
  }
  if (planStatus !== "active" && planStatus !== "trialing") {
    throw new Error("plan is not active");
  }

  const expiresAt = optionalString(value.expires_at);
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    throw new Error("account assertion expired");
  }

  const assertion: AccountAssertion = {
    format,
    issuer,
    audience,
    subject,
    assertion_id: assertionId,
    key_ref: keyRef,
    authority_kind: optionalString(value.authority_kind) ?? "account_plan_assertion",
    account_ref: accountRef,
    workspace_ref: workspaceRef,
    plan_key: planKey,
    plan_status: planStatus,
    included_apps: includedApps,
    github_required: false,
    source: optionalString(value.source) ?? "local_assertion",
    asserted_at: optionalString(value.asserted_at) ?? new Date().toISOString(),
    expires_at: expiresAt ?? null,
    hosted_workcell_limit: positiveInteger(value.hosted_workcell_limit ?? 1, "hosted_workcell_limit"),
    monthly_hosted_run_limit: nullablePositiveInteger(value.monthly_hosted_run_limit),
    storage_limit_mb: nullablePositiveInteger(value.storage_limit_mb),
    mirror_export_allowed: value.mirror_export_allowed === undefined ? true : value.mirror_export_allowed === true,
    trust: undefined as unknown as AssertionTrustProof
  };

  requireAssertionNotRevoked(assertion);
  assertion.trust = recordAssertionUse(assertion);
  return assertion;
}

function signAssertionPayload(payload: string, format: "bga1" | "bga2", decoded?: unknown): string {
  if (format === "bga1") {
    return createHmac("sha256", config.devToken).update(payload).digest("hex");
  }

  if (!isRecord(decoded)) throw new Error("invalid account assertion payload");
  const issuer = requiredString(decoded.iss ?? decoded.issuer, "issuer");
  const audience = optionalString(decoded.aud ?? decoded.audience) ?? config.assertionAudience;
  const keyRef = requiredString(decoded.kid ?? decoded.key_ref, "key_ref");
  requireTrustedAssertionKey(issuer, audience, keyRef);
  return signIssuerPayload(payload, issuer, audience, keyRef);
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || left.length !== right.length) return false;
  return createHash("sha256").update(left).digest("hex") === createHash("sha256").update(right).digest("hex")
    && left.toLowerCase() === right.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  const stringValue = optionalString(value);
  if (!stringValue) throw new Error(`${label} is required`);
  return stringValue;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function positiveInteger(value: unknown, label: string): number {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return numberValue;
}

function nullablePositiveInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  return positiveInteger(value, "limit");
}
