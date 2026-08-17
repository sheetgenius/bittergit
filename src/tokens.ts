import { createHash, randomUUID } from "node:crypto";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";

export type TokenRecord = {
  id: string;
  repo_id: string | null;
  token_hash: string;
  token_hint: string;
  actor: string;
  scopes_json: string;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
};

export type TokenBundle = {
  read_token: string;
  write_token: string;
  main_token: string;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function findToken(token: string): TokenRecord | undefined {
  const db = ensureStorage();
  return db.query<TokenRecord, [string]>(`
    SELECT id, repo_id, token_hash, token_hint, actor, scopes_json, created_at, revoked_at, expires_at
    FROM git_tokens
    WHERE token_hash = ?
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).get(hashToken(token)) ?? undefined;
}

export function tokenScopes(token: TokenRecord): string[] {
  return JSON.parse(token.scopes_json) as string[];
}

export function tokenAllows(token: TokenRecord, repoId: string | undefined, requiredScope: string): boolean {
  if (token.repo_id && repoId && token.repo_id !== repoId) return false;
  if (token.repo_id && !repoId) return false;

  const scopes = tokenScopes(token);
  return scopes.includes("repo:admin") || scopes.includes(requiredScope);
}

export function tokenAllowsAny(token: TokenRecord, repoId: string | undefined, requiredScopes: string[]): boolean {
  return requiredScopes.some((scope) => tokenAllows(token, repoId, scope));
}

export function tokenCanWriteRef(scopes: string[], ref: string): boolean {
  if (scopes.includes("repo:admin")) return true;
  if (!scopes.includes("repo:write")) return false;

  if (ref === "refs/heads/main") {
    return scopes.includes("ref:write:refs/heads/main");
  }

  if (ref.startsWith("refs/heads/")) {
    return scopes.includes("ref:write:refs/heads/*");
  }

  if (ref.startsWith("refs/tags/")) {
    return scopes.includes("ref:write:refs/tags/*");
  }

  return scopes.includes(`ref:write:${ref}`);
}

export function createRepoTokenBundle(repo: Repository): TokenBundle {
  return {
    read_token: createToken(repo, "read", ["repo:read"]),
    write_token: createToken(repo, "write", ["repo:read", "repo:write", "ref:write:refs/heads/*"]),
    main_token: createToken(repo, "main", [
      "repo:read",
      "repo:write",
      "ref:write:refs/heads/*",
      "ref:write:refs/heads/main",
      "ref:write:refs/tags/*"
    ])
  };
}

export function createWorkcellToken(
  repo: Repository,
  workcellId: string,
  actor?: string,
  options: { allowMainPush?: boolean } = {}
): { token: string; token_id: string } {
  const scopes = [
    "repo:read",
    "repo:write",
    "ref:write:refs/heads/*"
  ];
  if (options.allowMainPush) scopes.push("ref:write:refs/heads/main");
  return createTokenRecord(repo, `workcell:${workcellId}`, scopes, {
    actor: actor ? `workcell:${workcellId}:${actor}` : `workcell:${workcellId}`
  });
}

export function createScopedToken(repo: Repository, role: string, actor: string, scopes: string[]): { token: string; token_id: string } {
  return createTokenRecord(repo, role, scopes, { actor });
}

export function revokeToken(tokenId: string): void {
  const db = ensureStorage();
  db.query("UPDATE git_tokens SET revoked_at = $revoked_at WHERE id = $id").run({
    $id: tokenId,
    $revoked_at: new Date().toISOString()
  });
}

function createToken(repo: Repository, role: string, scopes: string[]): string {
  return createTokenRecord(repo, role, scopes).token;
}

function createTokenRecord(
  repo: Repository,
  role: string,
  scopes: string[],
  options: { actor?: string; expiresAt?: string | null } = {}
): { token: string; token_id: string } {
  const token = `bgt_${role}_${randomUUID().replaceAll("-", "")}`;
  const tokenId = `token_${randomUUID()}`;
  const now = new Date().toISOString();
  const db = ensureStorage();

  db.query(`
    INSERT INTO git_tokens
      (id, repo_id, token_hash, token_hint, actor, scopes_json, created_at, revoked_at, expires_at)
    VALUES
      ($id, $repo_id, $token_hash, $token_hint, $actor, $scopes_json, $created_at, NULL, $expires_at)
  `).run({
    $id: tokenId,
    $repo_id: repo.id,
    $token_hash: hashToken(token),
    $token_hint: `${role}:...${token.slice(-6)}`,
    $actor: options.actor ?? `${role}-token`,
    $scopes_json: JSON.stringify(scopes),
    $created_at: now,
    $expires_at: options.expiresAt ?? null
  });

  return { token, token_id: tokenId };
}
