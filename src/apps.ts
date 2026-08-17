import { randomUUID } from "node:crypto";
import { ensureStorage } from "./storage";
import { accountOwnerSlug, planSummary, type AccountAssertion, type PlanSummary } from "./assertions";
import { createRepository, findRepositoryById, repoToJson, validateSlug, type Repository } from "./repos";
import { createRepoTokenBundle, type TokenBundle } from "./tokens";

export type AccountApp = {
  id: string;
  repo_id: string;
  account_ref: string;
  workspace_ref: string;
  app_slug: string;
  display_name: string | null;
  status: string;
  source_posture: string;
  plan_key: string;
  plan_source: string;
  created_at: string;
  updated_at: string;
};

export type CustomerAppCreateResult = {
  app: AccountApp;
  repo: Repository;
  tokens: TokenBundle;
  plan: PlanSummary;
  existing: boolean;
};

export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

export function createCustomerApp(
  assertion: AccountAssertion,
  input: { name?: string; display_name?: string | null }
): CustomerAppCreateResult {
  if (!input.name) throw new Error("name is required");
  const appSlug = validateSlug(input.name, "name").toLowerCase();
  const owner = validateSlug(accountOwnerSlug(assertion.account_ref), "owner");
  const existing = findAccountApp(assertion.account_ref, appSlug);
  if (existing) {
    const repo = findRepositoryById(existing.repo_id);
    if (!repo) throw new Error("app repository missing");
    const activeCount = activeAppCount(assertion.account_ref);
    return {
      app: existing,
      repo,
      tokens: createRepoTokenBundle(repo),
      plan: planSummary(assertion, activeCount),
      existing: true
    };
  }

  const activeCount = activeAppCount(assertion.account_ref);
  if (activeCount >= assertion.included_apps) {
    throw new PlanLimitError("one-app plan already has an active app");
  }

  const repo = createRepository(owner, appSlug);
  const now = new Date().toISOString();
  const app: AccountApp = {
    id: `app_${randomUUID()}`,
    repo_id: repo.id,
    account_ref: assertion.account_ref,
    workspace_ref: assertion.workspace_ref,
    app_slug: appSlug,
    display_name: input.display_name ?? null,
    status: "active",
    source_posture: "bittergit_primary",
    plan_key: assertion.plan_key,
    plan_source: assertion.source,
    created_at: now,
    updated_at: now
  };

  ensureStorage().query(`
    INSERT INTO account_apps
      (id, repo_id, account_ref, workspace_ref, app_slug, display_name, status,
       source_posture, plan_key, plan_source, created_at, updated_at)
    VALUES
      ($id, $repo_id, $account_ref, $workspace_ref, $app_slug, $display_name, $status,
       $source_posture, $plan_key, $plan_source, $created_at, $updated_at)
  `).run({
    $id: app.id,
    $repo_id: app.repo_id,
    $account_ref: app.account_ref,
    $workspace_ref: app.workspace_ref,
    $app_slug: app.app_slug,
    $display_name: app.display_name,
    $status: app.status,
    $source_posture: app.source_posture,
    $plan_key: app.plan_key,
    $plan_source: app.plan_source,
    $created_at: app.created_at,
    $updated_at: app.updated_at
  });

  return {
    app,
    repo,
    tokens: createRepoTokenBundle(repo),
    plan: planSummary(assertion, activeCount + 1),
    existing: false
  };
}

export function listAccountApps(assertion: AccountAssertion): AccountApp[] {
  return ensureStorage().query<AccountApp, [string]>(`
    SELECT id, repo_id, account_ref, workspace_ref, app_slug, display_name, status,
           source_posture, plan_key, plan_source, created_at, updated_at
    FROM account_apps
    WHERE account_ref = ?
    ORDER BY created_at ASC
  `).all(assertion.account_ref);
}

export function activeAppCount(accountRef: string): number {
  const row = ensureStorage().query<{ count: number }, [string]>(`
    SELECT COUNT(*) AS count
    FROM account_apps
    WHERE account_ref = ? AND status = 'active'
  `).get(accountRef);
  return Number(row?.count ?? 0);
}

export function findAccountApp(accountRef: string, appSlug: string): AccountApp | undefined {
  return ensureStorage().query<AccountApp, [string, string]>(`
    SELECT id, repo_id, account_ref, workspace_ref, app_slug, display_name, status,
           source_posture, plan_key, plan_source, created_at, updated_at
    FROM account_apps
    WHERE account_ref = ? AND app_slug = ?
  `).get(accountRef, appSlug) ?? undefined;
}

export function findAccountAppById(appId: string): AccountApp | undefined {
  return ensureStorage().query<AccountApp, [string]>(`
    SELECT id, repo_id, account_ref, workspace_ref, app_slug, display_name, status,
           source_posture, plan_key, plan_source, created_at, updated_at
    FROM account_apps
    WHERE id = ?
  `).get(appId) ?? undefined;
}

export function findAccountAppByRepo(repo: Repository): AccountApp | undefined {
  return ensureStorage().query<AccountApp, [string]>(`
    SELECT id, repo_id, account_ref, workspace_ref, app_slug, display_name, status,
           source_posture, plan_key, plan_source, created_at, updated_at
    FROM account_apps
    WHERE repo_id = ?
  `).get(repo.id) ?? undefined;
}

export function accountAppToJson(app: AccountApp, repo: Repository): Record<string, unknown> {
  return {
    id: app.id,
    account_ref: app.account_ref,
    workspace_ref: app.workspace_ref,
    app_slug: app.app_slug,
    display_name: app.display_name,
    status: app.status,
    source_posture: app.source_posture,
    plan_key: app.plan_key,
    repo: repoToJson(repo),
    created_at: app.created_at,
    updated_at: app.updated_at
  };
}
