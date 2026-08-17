import { createHmac } from "node:crypto";
import { config } from "./config";
import { ensureStorage } from "./storage";

export type TrustedAssertionKey = {
  key_ref: string;
  algorithm: "HS256";
  secret: string;
  status: "active" | "retired";
  not_before: string | null;
  not_after: string | null;
};

export type TrustedAssertionIssuer = {
  issuer: string;
  audiences: string[];
  keys: TrustedAssertionKey[];
};

export type AssertionTrustProof = {
  format: "bga1" | "bga2";
  issuer: string;
  audience: string;
  subject: string;
  assertion_id: string | null;
  key_ref: string | null;
  key_status: string;
  audience_verified: boolean;
  subject_verified: boolean;
  expiry_verified: boolean;
  assertion_id_verified: boolean;
  replay_status: string;
  revocation_status: string;
  use_count: number | null;
};

export type AssertionUseInput = {
  format: "bga1" | "bga2";
  issuer: string;
  audience: string;
  subject: string;
  assertion_id: string | null;
  key_ref: string | null;
  authority_kind: string;
  account_ref: string;
  workspace_ref: string;
  expires_at: string | null;
};

export type AssertionRevocationRecord = {
  id: string;
  issuer: string;
  assertion_id: string | null;
  subject: string | null;
  account_ref: string | null;
  reason: string;
  source: string;
  revoked_at: string;
};

export type AssertionUseRecord = {
  issuer: string;
  assertion_id: string;
  audience: string;
  subject: string;
  account_ref: string;
  workspace_ref: string;
  key_ref: string | null;
  authority_kind: string;
  first_seen_at: string;
  last_seen_at: string;
  use_count: number;
  expires_at: string | null;
};

let registryCache: TrustedAssertionIssuer[] | undefined;

export function trustedAssertionIssuers(): TrustedAssertionIssuer[] {
  if (registryCache) return registryCache;

  const raw = process.env.BITTERGIT_ASSERTION_TRUST_REGISTRY;
  registryCache = raw ? parseRegistry(raw) : defaultRegistry();
  return registryCache;
}

export function sanitizedAssertionTrustConfig(): Record<string, unknown> {
  return {
    audience: config.assertionAudience,
    issuers: trustedAssertionIssuers().map((issuer) => ({
      issuer: issuer.issuer,
      audiences: issuer.audiences,
      keys: issuer.keys.map((key) => ({
        key_ref: key.key_ref,
        algorithm: key.algorithm,
        status: key.status,
        not_before: key.not_before,
        not_after: key.not_after
      }))
    }))
  };
}

export function sanitizedIssuerDiscovery(): Record<string, unknown> {
  return {
    audience: config.assertionAudience,
    discovery_status: "local_projection",
    documents: trustedAssertionIssuers().map((issuer) => ({
      issuer: issuer.issuer,
      discovery_url: `local://bittergit/assertion-issuers/${encodeURIComponent(issuer.issuer)}`,
      audiences: issuer.audiences,
      active_key_refs: issuer.keys.filter((key) => key.status === "active").map((key) => key.key_ref),
      retired_key_refs: issuer.keys.filter((key) => key.status === "retired").map((key) => key.key_ref),
      keys: issuer.keys.map((key) => ({
        key_ref: key.key_ref,
        algorithm: key.algorithm,
        status: key.status,
        not_before: key.not_before,
        not_after: key.not_after
      }))
    })),
    revocation_projection: listAssertionRevocations().map(assertionRevocationToSupportJson)
  };
}

export function signIssuerPayload(payload: string, issuer: string, audience: string, keyRef: string): string {
  const key = requireTrustedAssertionKey(issuer, audience, keyRef);
  return createHmac("sha256", key.secret).update(`bga2.${payload}`).digest("hex");
}

export function requireTrustedAssertionKey(
  issuer: string,
  audience: string,
  keyRef: string | null
): TrustedAssertionKey {
  const trustedIssuer = trustedAssertionIssuers().find((entry) => entry.issuer === issuer);
  if (!trustedIssuer) throw new Error("untrusted account assertion issuer");

  if (!trustedIssuer.audiences.includes(audience)) {
    throw new Error("account assertion audience mismatch");
  }

  if (!keyRef) throw new Error("account assertion key ref is required");

  const key = trustedIssuer.keys.find((entry) => entry.key_ref === keyRef);
  if (!key) throw new Error("untrusted account assertion key");

  const now = Date.now();
  if (key.status !== "active") throw new Error("account assertion key is not active");
  if (key.not_before && Date.parse(key.not_before) > now) throw new Error("account assertion key is not active");
  if (key.not_after && Date.parse(key.not_after) <= now) throw new Error("account assertion key is not active");

  return key;
}

export function recordAssertionUse(assertion: AssertionUseInput): AssertionTrustProof {
  if (!assertion.assertion_id) {
    return trustProof(assertion, "legacy", "not_recorded", "not_revoked", null);
  }

  const database = ensureStorage();
  const now = new Date().toISOString();
  const existing = database.query<AssertionUseRecord, [string, string]>(`
    SELECT issuer, assertion_id, audience, subject, account_ref, workspace_ref,
           key_ref, authority_kind, first_seen_at, last_seen_at, use_count,
           expires_at
    FROM account_assertion_uses
    WHERE issuer = ? AND assertion_id = ?
  `).get(assertion.issuer, assertion.assertion_id);

  const useCount = existing ? existing.use_count + 1 : 1;

  database.query(`
    INSERT INTO account_assertion_uses
      (issuer, assertion_id, audience, subject, account_ref, workspace_ref,
       key_ref, authority_kind, first_seen_at, last_seen_at, use_count,
       expires_at)
    VALUES
      ($issuer, $assertion_id, $audience, $subject, $account_ref, $workspace_ref,
       $key_ref, $authority_kind, $first_seen_at, $last_seen_at, $use_count,
       $expires_at)
    ON CONFLICT(issuer, assertion_id) DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      use_count = excluded.use_count
  `).run({
    $issuer: assertion.issuer,
    $assertion_id: assertion.assertion_id,
    $audience: assertion.audience,
    $subject: assertion.subject,
    $account_ref: assertion.account_ref,
    $workspace_ref: assertion.workspace_ref,
    $key_ref: assertion.key_ref,
    $authority_kind: assertion.authority_kind,
    $first_seen_at: existing?.first_seen_at ?? now,
    $last_seen_at: now,
    $use_count: useCount,
    $expires_at: assertion.expires_at
  });

  return trustProof(assertion, assertion.key_ref ? "active" : "legacy", useCount > 1 ? "seen_before" : "first_seen", "not_revoked", useCount);
}

export function requireAssertionNotRevoked(assertion: AssertionUseInput): void {
  const revocation = findMatchingAssertionRevocation(assertion);
  if (revocation) throw new Error("account assertion revoked");
}

export function listAssertionUsesForAccount(accountRef: string): AssertionUseRecord[] {
  return ensureStorage().query<AssertionUseRecord, [string]>(`
    SELECT issuer, assertion_id, audience, subject, account_ref, workspace_ref,
           key_ref, authority_kind, first_seen_at, last_seen_at, use_count,
           expires_at
    FROM account_assertion_uses
    WHERE account_ref = ?
    ORDER BY last_seen_at DESC
    LIMIT 20
  `).all(accountRef);
}

export function assertionUseToSupportJson(record: AssertionUseRecord): Record<string, unknown> {
  return {
    issuer: record.issuer,
    assertion_id: record.assertion_id,
    audience: record.audience,
    subject: record.subject,
    account_ref: record.account_ref,
    workspace_ref: record.workspace_ref,
    key_ref: record.key_ref,
    authority_kind: record.authority_kind,
    first_seen_at: record.first_seen_at,
    last_seen_at: record.last_seen_at,
    use_count: record.use_count,
    replay_status: record.use_count > 1 ? "seen_before" : "first_seen",
    revocation_status: "not_revoked",
    expires_at: record.expires_at
  };
}

export function createAssertionRevocation(input: {
  issuer: string;
  assertion_id?: string | null;
  subject?: string | null;
  account_ref?: string | null;
  reason?: string | null;
  source?: string | null;
}): AssertionRevocationRecord {
  const issuer = requiredString(input.issuer, "issuer");
  const assertionId = optionalString(input.assertion_id) ?? null;
  const subject = optionalString(input.subject) ?? null;
  if (!assertionId && !subject) throw new Error("assertion_id or subject is required");
  const record = {
    id: `assertion_revocation_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    issuer,
    assertion_id: assertionId,
    subject,
    account_ref: optionalString(input.account_ref) ?? null,
    reason: optionalString(input.reason) ?? "operator_revocation",
    source: optionalString(input.source) ?? "local_revocation_projection",
    revoked_at: new Date().toISOString()
  };

  ensureStorage().query(`
    INSERT INTO account_assertion_revocations
      (id, issuer, assertion_id, subject, account_ref, reason, source, revoked_at)
    VALUES
      ($id, $issuer, $assertion_id, $subject, $account_ref, $reason, $source, $revoked_at)
  `).run({
    $id: record.id,
    $issuer: record.issuer,
    $assertion_id: record.assertion_id,
    $subject: record.subject,
    $account_ref: record.account_ref,
    $reason: record.reason,
    $source: record.source,
    $revoked_at: record.revoked_at
  });

  return record;
}

export function listAssertionRevocations(): AssertionRevocationRecord[] {
  return ensureStorage().query<AssertionRevocationRecord, []>(`
    SELECT id, issuer, assertion_id, subject, account_ref, reason, source, revoked_at
    FROM account_assertion_revocations
    ORDER BY revoked_at DESC
    LIMIT 100
  `).all();
}

export function listAssertionRevocationsForAccount(accountRef: string): AssertionRevocationRecord[] {
  const subject = `account:${accountRef}`;
  return ensureStorage().query<AssertionRevocationRecord, [string, string]>(`
    SELECT id, issuer, assertion_id, subject, account_ref, reason, source, revoked_at
    FROM account_assertion_revocations
    WHERE account_ref = ? OR subject = ?
    ORDER BY revoked_at DESC
    LIMIT 20
  `).all(accountRef, subject);
}

export function assertionRevocationToSupportJson(record: AssertionRevocationRecord): Record<string, unknown> {
  return {
    id: record.id,
    issuer: record.issuer,
    assertion_id: record.assertion_id,
    subject: record.subject,
    account_ref: record.account_ref,
    reason: record.reason,
    source: record.source,
    revoked_at: record.revoked_at
  };
}

function trustProof(
  assertion: AssertionUseInput,
  keyStatus: string,
  replayStatus: string,
  revocationStatus: string,
  useCount: number | null
): AssertionTrustProof {
  return {
    format: assertion.format,
    issuer: assertion.issuer,
    audience: assertion.audience,
    subject: assertion.subject,
    assertion_id: assertion.assertion_id,
    key_ref: assertion.key_ref,
    key_status: keyStatus,
    audience_verified: assertion.audience === config.assertionAudience,
    subject_verified: assertion.subject.length > 0,
    expiry_verified: assertion.expires_at ? Date.parse(assertion.expires_at) > Date.now() : assertion.format === "bga1",
    assertion_id_verified: assertion.format === "bga1" || Boolean(assertion.assertion_id),
    replay_status: replayStatus,
    revocation_status: revocationStatus,
    use_count: useCount
  };
}

function findMatchingAssertionRevocation(assertion: AssertionUseInput): AssertionRevocationRecord | undefined {
  if (!assertion.assertion_id && !assertion.subject) return undefined;
  return ensureStorage().query<AssertionRevocationRecord, [string, string | null, string]>(`
    SELECT id, issuer, assertion_id, subject, account_ref, reason, source, revoked_at
    FROM account_assertion_revocations
    WHERE issuer = ?
      AND (
        (assertion_id IS NOT NULL AND assertion_id = ?)
        OR (subject IS NOT NULL AND subject = ?)
      )
    ORDER BY revoked_at DESC
    LIMIT 1
  `).get(assertion.issuer, assertion.assertion_id, assertion.subject) ?? undefined;
}

function defaultRegistry(): TrustedAssertionIssuer[] {
  const assertionSecret = config.assertionSecret;
  return [
    {
      issuer: "bitterhub.local",
      audiences: [config.assertionAudience],
      keys: [
        activeKey("hub-dev-key-1", assertionSecret),
        activeKey("hub-rotated-key-2", assertionSecret),
        retiredKey("hub-retired-key-1", assertionSecret)
      ]
    },
    {
      issuer: "factory.local",
      audiences: [config.assertionAudience],
      keys: [
        activeKey("factory-dev-key-1", assertionSecret)
      ]
    },
    {
      issuer: "local_assertion",
      audiences: [config.assertionAudience],
      keys: [
        activeKey("local-dev-key-1", assertionSecret)
      ]
    }
  ];
}

function activeKey(keyRef: string, secret: string): TrustedAssertionKey {
  return {
    key_ref: keyRef,
    algorithm: "HS256",
    secret,
    status: "active",
    not_before: null,
    not_after: null
  };
}

function retiredKey(keyRef: string, secret: string): TrustedAssertionKey {
  return {
    key_ref: keyRef,
    algorithm: "HS256",
    secret,
    status: "retired",
    not_before: null,
    not_after: null
  };
}

function parseRegistry(raw: string): TrustedAssertionIssuer[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("invalid assertion trust registry JSON");
  }

  if (!Array.isArray(decoded)) throw new Error("assertion trust registry must be an array");

  return decoded.map((issuerValue) => {
    if (!isRecord(issuerValue)) throw new Error("invalid assertion trust issuer");
    const issuer = requiredString(issuerValue.issuer, "issuer");
    const audiences = stringArray(issuerValue.audiences, "audiences");
    const keysValue = issuerValue.keys;
    if (!Array.isArray(keysValue) || keysValue.length === 0) throw new Error("issuer keys are required");
    return {
      issuer,
      audiences,
      keys: keysValue.map((keyValue) => {
        if (!isRecord(keyValue)) throw new Error("invalid assertion trust key");
        return {
          key_ref: requiredString(keyValue.key_ref, "key_ref"),
          algorithm: "HS256",
          secret: requiredString(keyValue.secret, "secret"),
          status: keyValue.status === "retired" ? "retired" : "active",
          not_before: optionalString(keyValue.not_before) ?? null,
          not_after: optionalString(keyValue.not_after) ?? null
        };
      })
    };
  });
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty string array`);
  return value.map((entry) => requiredString(entry, label));
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
