import { ensureStorage } from "./storage";
import type { Repository } from "./repos";
import { repoToJson } from "./repos";
import { listEvents, listRefs } from "./events";
import { listCheckpoints } from "./checkpoints";
import { listDeployments, listReceipts, receiptSupportJson } from "./deployments";
import { listMirrorTargets, mirrorSupportJson } from "./mirrors";
import { listRepoRemotes } from "./import-export";
import { listIssues, issueToJson } from "./issues";
import { listPullRequests, pullRequestToJson } from "./pull-requests";
import { listSecretRefs, secretRefSupportJson } from "./secrets";
import { findAccountAppByRepo } from "./apps";
import {
  findSetupStateForRepo,
  setupProgressSupportJson,
  setupStateSupportJson
} from "./app-bundles";
import { hostedWorkcellSessionSupportJson, listHostedWorkcellSessionsForRepo } from "./hosted-sessions";
import {
  assertionRevocationToSupportJson,
  assertionUseToSupportJson,
  listAssertionRevocationsForAccount,
  listAssertionUsesForAccount
} from "./assertion-trust";
import { hostedAgentLaunchSupportJson, listHostedAgentLaunchesForRepo } from "./agent-launches";
import { charterFirstRunSupportJson, listCharterFirstRunsForRepo } from "./charter-first-runs";
import {
  listSecretGrantRequestsForRepo,
  listSecretMaterializationRequestsForRepo,
  secretGrantRequestSupportJson,
  secretMaterializationReadinessForRepo,
  secretMaterializationRequestSupportJson
} from "./secret-grants";
import { gridPublishSupportJson, listGridPublishRequestsForRepo } from "./grid-publish";

export function supportBundle(repo: Repository): Record<string, unknown> {
  const events = listEvents(repo);
  const deployments = listDeployments(repo);
  const receipts = listReceipts(repo);
  const supportReceipts = receipts.map(receiptSupportJson);
  const app = findAccountAppByRepo(repo);
  const setupState = findSetupStateForRepo(repo);
  return {
    account: app ? {
      account_ref: app.account_ref,
      workspace_ref: app.workspace_ref,
      plan_key: app.plan_key,
      plan_source: app.plan_source
    } : null,
    account_assertions: app
      ? listAssertionUsesForAccount(app.account_ref).map(assertionUseToSupportJson)
      : [],
    account_assertion_revocations: app
      ? listAssertionRevocationsForAccount(app.account_ref).map(assertionRevocationToSupportJson)
      : [],
    app: app ? {
      id: app.id,
      app_slug: app.app_slug,
      status: app.status,
      source_posture: app.source_posture
    } : null,
    plan: app ? {
      plan_key: app.plan_key,
      github_required: false
    } : null,
    setup_state: setupState ? setupStateSupportJson(setupState) : null,
    setup_progress: setupState ? setupProgressSupportJson(setupState) : null,
    hosted_workcell_sessions: listHostedWorkcellSessionsForRepo(repo).map(hostedWorkcellSessionSupportJson),
    hosted_agent_launches: listHostedAgentLaunchesForRepo(repo).map(hostedAgentLaunchSupportJson),
    charter_first_runs: listCharterFirstRunsForRepo(repo).map(charterFirstRunSupportJson),
    repo: repoToJson(repo),
    refs: listRefs(repo),
    source_history: {
      ref_event_count: events.length,
      latest_events: events.slice(-10)
    },
    checkpoints: listCheckpoints(repo),
    deployments,
    grid_publish_requests: listGridPublishRequestsForRepo(repo).map(gridPublishSupportJson),
    receipts: supportReceipts,
    issues: listIssues(repo).map((issue) => issueToJson(repo, issue)),
    pull_requests: listPullRequests(repo).map((pr) => pullRequestToJson(repo, pr)),
    mirrors: listMirrorTargets(repo).map(mirrorSupportJson),
    remotes: listRepoRemotes(repo).map(repoRemoteSupportJson),
    secret_refs: listSecretRefs(repo).map(secretRefSupportJson),
    secret_grants: listSecretGrantRequestsForRepo(repo).map(secretGrantRequestSupportJson),
    pass_materializations: listSecretMaterializationRequestsForRepo(repo).map(secretMaterializationRequestSupportJson),
    pass_materialization_readiness: secretMaterializationReadinessForRepo(repo, "production", app?.id ?? null),
    workcells: workcellSummary(repo),
    support_policy: {
      requires_ssh: false,
      includes_secret_values: false,
      includes_tokens: false,
      includes_credential_refs: false,
      includes_grant_tokens: false,
      includes_materialized_secret_files: false
    },
    debug_summary: {
      deployment_count: deployments.length,
      grid_publish_count: listGridPublishRequestsForRepo(repo).length,
      receipt_count: receipts.length,
      secret_ref_count: listSecretRefs(repo).length,
      secret_grant_count: listSecretGrantRequestsForRepo(repo).length
    }
  };
}

function repoRemoteSupportJson(remote: ReturnType<typeof listRepoRemotes>[number]): Record<string, unknown> {
  return {
    id: remote.id,
    repo_id: remote.repo_id,
    name: remote.name,
    provider: remote.provider,
    remote_url: null,
    remote_url_returned: false,
    remote_configured: Boolean(remote.remote_url),
    role: remote.role,
    created_at: remote.created_at,
    removed_at: remote.removed_at,
    projection: "support_safe_v1"
  };
}

function workcellSummary(repo: Repository): Record<string, unknown> {
  const rows = ensureStorage().query<{ active: number; revoked: number }, [string]>(`
    SELECT
      SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END) AS revoked
    FROM workcells
    WHERE repo_id = ?
  `).get(repo.id);

  return {
    active: Number(rows?.active ?? 0),
    revoked: Number(rows?.revoked ?? 0)
  };
}
