import { randomUUID } from "node:crypto";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import { assertSafeTextForStorage } from "./source-safety";

export type AppSecretRef = {
  id: string;
  repo_id: string;
  name: string;
  credential_ref: string;
  environment: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export function createSecretRef(repo: Repository, input: {
  name?: string;
  credential_ref?: string;
  environment?: string;
  value?: string;
  credential_value?: string;
}, actor: string): AppSecretRef {
  if (input.value || input.credential_value) {
    throw new Error("secret values are not accepted; store values in BitterPass and pass credential_ref");
  }

  const name = validateSecretName(input.name);
  const credentialRef = validateCredentialRef(input.credential_ref);
  const environment = validateEnvironment(input.environment ?? "production");
  const now = new Date().toISOString();
  const existing = findSecretRef(repo, name, environment);

  if (existing) {
    ensureStorage().query(`
      UPDATE app_secret_refs
      SET credential_ref = $credential_ref,
          created_by = $created_by,
          updated_at = $updated_at,
          revoked_at = NULL
      WHERE id = $id
    `).run({
      $id: existing.id,
      $credential_ref: credentialRef,
      $created_by: actor,
      $updated_at: now
    });
    return findSecretRef(repo, name, environment) as AppSecretRef;
  }

  const id = `secret_ref_${randomUUID()}`;
  ensureStorage().query(`
    INSERT INTO app_secret_refs
      (id, repo_id, name, credential_ref, environment, created_by,
       created_at, updated_at, revoked_at)
    VALUES
      ($id, $repo_id, $name, $credential_ref, $environment, $created_by,
       $created_at, $updated_at, NULL)
  `).run({
    $id: id,
    $repo_id: repo.id,
    $name: name,
    $credential_ref: credentialRef,
    $environment: environment,
    $created_by: actor,
    $created_at: now,
    $updated_at: now
  });

  return findSecretRef(repo, name, environment) as AppSecretRef;
}

export function listSecretRefs(repo: Repository): AppSecretRef[] {
  return ensureStorage().query<AppSecretRef, [string]>(`
    SELECT id, repo_id, name, credential_ref, environment, created_by,
           created_at, updated_at, revoked_at
    FROM app_secret_refs
    WHERE repo_id = ?
    ORDER BY environment ASC, name ASC
  `).all(repo.id);
}

export function revokeSecretRef(repo: Repository, id: string, actor: string): AppSecretRef {
  const secret = findSecretRefById(repo, id);
  if (!secret) throw new Error("secret ref not found");
  ensureStorage().query(`
    UPDATE app_secret_refs
    SET revoked_at = $revoked_at,
        updated_at = $updated_at,
        created_by = $created_by
    WHERE id = $id
  `).run({
    $id: id,
    $revoked_at: new Date().toISOString(),
    $updated_at: new Date().toISOString(),
    $created_by: actor
  });
  return findSecretRefById(repo, id) as AppSecretRef;
}

export function secretRefToJson(secret: AppSecretRef): Record<string, unknown> {
  return {
    id: secret.id,
    repo_id: secret.repo_id,
    name: secret.name,
    environment: secret.environment,
    has_credential_ref: secret.credential_ref.length > 0,
    credential_ref_returned: false,
    has_value: false,
    value_stored_in_bittergit: false,
    created_by: secret.created_by,
    created_at: secret.created_at,
    updated_at: secret.updated_at,
    revoked_at: secret.revoked_at
  };
}

export function secretRefSupportJson(secret: AppSecretRef): Record<string, unknown> {
  return {
    id: secret.id,
    name: secret.name,
    environment: secret.environment,
    has_credential_ref: secret.credential_ref.length > 0,
    value_stored_in_bittergit: false,
    revoked_at: secret.revoked_at
  };
}

function findSecretRef(repo: Repository, name: string, environment: string): AppSecretRef | undefined {
  return ensureStorage().query<AppSecretRef, [string, string, string]>(`
    SELECT id, repo_id, name, credential_ref, environment, created_by,
           created_at, updated_at, revoked_at
    FROM app_secret_refs
    WHERE repo_id = ? AND name = ? AND environment = ?
  `).get(repo.id, name, environment) ?? undefined;
}

function findSecretRefById(repo: Repository, id: string): AppSecretRef | undefined {
  return ensureStorage().query<AppSecretRef, [string, string]>(`
    SELECT id, repo_id, name, credential_ref, environment, created_by,
           created_at, updated_at, revoked_at
    FROM app_secret_refs
    WHERE repo_id = ? AND id = ?
  `).get(repo.id, id) ?? undefined;
}

function validateSecretName(value: string | undefined): string {
  if (!value || !/^[A-Z][A-Z0-9_]{1,120}$/.test(value)) {
    throw new Error("invalid secret name");
  }
  return value;
}

function validateCredentialRef(value: string | undefined): string {
  if (!value || value.length > 500) throw new Error("credential_ref is required");
  if (!value.startsWith("bitterpass://") && !value.startsWith("credential://")) {
    throw new Error("credential_ref must point to BitterPass or a credential ref");
  }
  assertSafeTextForStorage("credential_ref", value);
  return "reference_held_by_bitterpass";
}

function validateEnvironment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value)) {
    throw new Error("invalid secret environment");
  }
  return value;
}
