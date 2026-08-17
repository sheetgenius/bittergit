import { randomUUID } from "node:crypto";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import { createScopedToken, revokeToken } from "./tokens";
import { createWorkcell } from "./workcells";

export type Collaborator = {
  id: string;
  repo_id: string;
  username: string;
  role: string;
  token_id: string;
  created_at: string;
  revoked_at: string | null;
};

export function addCollaborator(repo: Repository, input: { username?: string; role?: string }): {
  collaborator: Collaborator;
  token: string;
} {
  const username = validateUsername(input.username);
  const role = validateRole(input.role ?? "member");
  const scopedToken = createScopedToken(repo, `collaborator:${role}`, `user:${username}`, scopesForRole(role));
  const id = `collab_${randomUUID()}`;
  const now = new Date().toISOString();

  ensureStorage().query(`
    INSERT INTO repo_collaborators
      (id, repo_id, username, role, token_id, created_at, revoked_at)
    VALUES
      ($id, $repo_id, $username, $role, $token_id, $created_at, NULL)
    ON CONFLICT(repo_id, username) DO UPDATE SET
      role = excluded.role,
      token_id = excluded.token_id,
      created_at = excluded.created_at,
      revoked_at = NULL
  `).run({
    $id: id,
    $repo_id: repo.id,
    $username: username,
    $role: role,
    $token_id: scopedToken.token_id,
    $created_at: now
  });

  return {
    collaborator: findCollaborator(repo, username) as Collaborator,
    token: scopedToken.token
  };
}

export function listCollaborators(repo: Repository): Collaborator[] {
  return ensureStorage().query<Collaborator, [string]>(`
    SELECT id, repo_id, username, role, token_id, created_at, revoked_at
    FROM repo_collaborators
    WHERE repo_id = ?
    ORDER BY username ASC
  `).all(repo.id);
}

export function findCollaborator(repo: Repository, usernameInput: string): Collaborator | undefined {
  const username = validateUsername(usernameInput);
  return ensureStorage().query<Collaborator, [string, string]>(`
    SELECT id, repo_id, username, role, token_id, created_at, revoked_at
    FROM repo_collaborators
    WHERE repo_id = ? AND username = ?
  `).get(repo.id, username) ?? undefined;
}

export function revokeCollaborator(repo: Repository, usernameInput: string): Collaborator {
  const username = validateUsername(usernameInput);
  const collaborator = findCollaborator(repo, username);
  if (!collaborator) throw new Error("collaborator not found");
  const now = new Date().toISOString();
  const db = ensureStorage();

  revokeToken(collaborator.token_id);
  const workcells = db.query<{ token_id: string }, [string, string]>(`
    SELECT token_id
    FROM workcells
    WHERE repo_id = ? AND actor = ? AND revoked_at IS NULL
  `).all(repo.id, `user:${username}`);
  for (const workcell of workcells) revokeToken(workcell.token_id);

  db.query(`
    UPDATE workcells
    SET revoked_at = $revoked_at
    WHERE repo_id = $repo_id AND actor = $actor AND revoked_at IS NULL
  `).run({
    $repo_id: repo.id,
    $actor: `user:${username}`,
    $revoked_at: now
  });

  db.query(`
    UPDATE repo_collaborators
    SET revoked_at = $revoked_at
    WHERE repo_id = $repo_id AND username = $username
  `).run({
    $repo_id: repo.id,
    $username: username,
    $revoked_at: now
  });

  return findCollaborator(repo, username) as Collaborator;
}

export function createCollaboratorWorkcell(repo: Repository, usernameInput: string) {
  const username = validateUsername(usernameInput);
  const collaborator = findCollaborator(repo, username);
  if (!collaborator || collaborator.revoked_at) throw new Error("active collaborator not found");
  return createWorkcell(repo, `user:${username}`);
}

function scopesForRole(role: string): string[] {
  if (role === "owner" || role === "admin") {
    return [
      "repo:read",
      "repo:write",
      "repo:admin",
      "ref:write:refs/heads/*",
      "ref:write:refs/heads/main",
      "ref:write:refs/tags/*"
    ];
  }

  return [
    "repo:read",
    "repo:write",
    "ref:write:refs/heads/*"
  ];
}

function validateRole(role: string): string {
  if (!["owner", "admin", "member"].includes(role)) throw new Error("invalid collaborator role");
  return role;
}

function validateUsername(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value)) throw new Error("invalid username");
  return value;
}
