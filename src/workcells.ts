import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { cloneUrl, config } from "./config";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import { createWorkcellToken, revokeToken } from "./tokens";
import { claudePointerMd, geminiPointerMd, workcellParentAgentsMd } from "./agent-context";

export type Workcell = {
  id: string;
  repo_id: string;
  token_id: string;
  checkout_path: string;
  actor: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type WorkcellCreation = {
  workcell: Workcell;
  token: string;
  token_id: string;
};

export function createWorkcell(
  repo: Repository,
  actor: string | null = null,
  options: { id?: string; allowMainPush?: boolean } = {}
): Workcell {
  return createWorkcellWithToken(repo, actor, options).workcell;
}

export function createWorkcellWithToken(
  repo: Repository,
  actor: string | null = null,
  options: { id?: string; allowMainPush?: boolean } = {}
): WorkcellCreation {
  const id = options.id ?? `wc_${randomUUID()}`;
  const token = createWorkcellToken(repo, id, actor ?? undefined, {
    allowMainPush: options.allowMainPush === true
  });
  const root = join(config.workcellsRoot, id);
  const checkoutPath = join(root, "workspace");
  const helperPath = join(root, "credential-helper.sh");
  const now = new Date().toISOString();

  mkdirSync(root, { recursive: true });
  runGit(["clone", repo.storage_path, checkoutPath]);
  runGit(["-C", checkoutPath, "remote", "set-url", "origin", cloneUrl(repo.owner, repo.name)]);
  writeWorkcellParentContext(root);

  writeFileSync(helperPath, credentialHelperScript(token.token), { encoding: "utf8" });
  chmodSync(helperPath, 0o700);
  runGit(["-C", checkoutPath, "config", "credential.helper", helperPath]);

  const db = ensureStorage();
  db.query(`
    INSERT INTO workcells
      (id, repo_id, token_id, checkout_path, actor, created_at, revoked_at)
    VALUES
      ($id, $repo_id, $token_id, $checkout_path, $actor, $created_at, NULL)
  `).run({
    $id: id,
    $repo_id: repo.id,
    $token_id: token.token_id,
    $checkout_path: checkoutPath,
    $actor: actor,
    $created_at: now
  });

  return {
    workcell: findWorkcell(id) as Workcell,
    token: token.token,
    token_id: token.token_id
  };
}

export function findWorkcell(id: string): Workcell | undefined {
  const db = ensureStorage();
  return db.query<Workcell, [string]>(`
    SELECT id, repo_id, token_id, checkout_path, actor, created_at, revoked_at
    FROM workcells
    WHERE id = ?
  `).get(id) ?? undefined;
}

export function revokeWorkcell(id: string): Workcell | undefined {
  const workcell = findWorkcell(id);
  if (!workcell) return undefined;

  revokeToken(workcell.token_id);
  ensureStorage().query(`
    UPDATE workcells SET revoked_at = $revoked_at WHERE id = $id
  `).run({
    $id: id,
    $revoked_at: new Date().toISOString()
  });

  return findWorkcell(id);
}

export function workcellToJson(workcell: Workcell, repo: Repository): Record<string, string | null> {
  return {
    id: workcell.id,
    repo_id: workcell.repo_id,
    checkout_path: workcell.checkout_path,
    actor: workcell.actor,
    remote_url: cloneUrl(repo.owner, repo.name),
    revoked_at: workcell.revoked_at
  };
}

function credentialHelperScript(token: string): string {
  return `#!/usr/bin/env bash
case "$1" in
  get)
    echo username=bittergit
    echo password=${token}
    ;;
esac
`;
}

function writeWorkcellParentContext(root: string): void {
  writeFileSync(join(root, "AGENTS.md"), workcellParentAgentsMd(), { encoding: "utf8" });
  writeFileSync(join(root, "CLAUDE.md"), claudePointerMd(), { encoding: "utf8" });
  writeFileSync(join(root, "GEMINI.md"), geminiPointerMd(), { encoding: "utf8" });
}

function runGit(args: string[]): void {
  const result = spawnSync("git", args, { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}
