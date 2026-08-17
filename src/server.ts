import { config } from "./config";
import { validateRuntimeSafety } from "./runtime-safety";
import { authenticate, unauthorized } from "./auth";
import { createRepository, findRepository, findRepositoryById, listRepositories, repoToJson, validateSlug } from "./repos";
import { listEvents, listRefs } from "./events";
import { ensureStorage } from "./storage";
import { runGitHttpBackend } from "./git-http-backend";
import { createRepoTokenBundle, tokenCanWriteRef } from "./tokens";
import { createWorkcell, findWorkcell, revokeWorkcell, workcellToJson } from "./workcells";
import { createCheckpoint, diffCheckpoints, findCheckpoint, listCheckpoints, restoreCheckpoint } from "./checkpoints";
import {
  createDeployment,
  createRollback,
  createVerification,
  findDeployment,
  listDeployments,
  listReceipts
} from "./deployments";
import {
  createMirrorTarget,
  disableMirrorTarget,
  findMirrorTarget,
  importMirrorTarget,
  listMirrorRuns,
  listMirrorTargets,
  mirrorToJson,
  repairMirrorTarget,
  syncMirrorTarget
} from "./mirrors";
import {
  addIssueComment,
  addIssueLink,
  closeIssue,
  createIssue,
  createIssueAgentRun,
  findIssueByNumber,
  issueToJson,
  listIssues,
  updateIssue
} from "./issues";
import {
  closePullRequest,
  createPullRequest,
  findPullRequestByNumber,
  listPullRequests,
  mergePullRequest,
  pullRequestToJson,
  updatePullRequestVerification
} from "./pull-requests";
import {
  connectExternalSource,
  createExternalReceipt,
  createExternalWorkcell,
  externalPullRequestToJson,
  externalSourceToJson,
  externalWorkcellToJson,
  findExternalPullRequest,
  findExternalSource,
  listExternalEvents,
  listExternalPullRequests,
  listExternalSources,
  openExternalPullRequest,
  syncExternalSource
} from "./external-sources";
import {
  addRepoRemote,
  exportToGitRemote,
  importFromGitRemote,
  listExports,
  listImports,
  listRepoRemotes,
  removeRepoRemote
} from "./import-export";
import { sourceProviders } from "./providers";
import { handleUiRoute } from "./ui";
import {
  addCollaborator,
  createCollaboratorWorkcell,
  listCollaborators,
  revokeCollaborator
} from "./collaboration";
import {
  createBackup,
  findBackup,
  listBackups,
  listPerformanceRuns,
  operationsHealth,
  performancePosture,
  performanceRunToJson,
  recordPerformanceRun,
  rehearseRestore
} from "./operations";
import {
  listAuditEvents,
  oversizedRequest,
  rateLimitExceeded,
  recordAuditEvent,
  securityPosture
} from "./security";
import {
  addProjectionComment,
  createWorkflowProjection,
  findWorkflowProjection,
  listWorkflowProjections,
  projectIssue,
  projectedIssueToJson,
  projectedPullRequestToJson,
  projectPullRequest,
  simulateExternalIssueEdit,
  simulateExternalPullRequestEdit,
  syncWorkflowProjection,
  workflowProjectionToJson
} from "./workflow-projections";
import { createSecretRef, listSecretRefs, revokeSecretRef, secretRefToJson } from "./secrets";
import { supportBundle } from "./support";
import { parseAccountAssertion, planSummary } from "./assertions";
import { sanitizedAssertionTrustConfig } from "./assertion-trust";
import {
  assertionRevocationToSupportJson,
  createAssertionRevocation,
  listAssertionRevocations,
  sanitizedIssuerDiscovery
} from "./assertion-trust";
import {
  accountAppToJson,
  activeAppCount,
  createCustomerApp,
  findAccountAppById,
  listAccountApps,
  PlanLimitError
} from "./apps";
import { createAppBundle, findSetupStateForApp, setupProgressToJson, setupStateToJson } from "./app-bundles";
import {
  createHostedWorkcellSession,
  fulfillHostedWorkcellTerminal,
  hostedWorkcellSessionToJson,
  listHostedWorkcellSessionsForApp,
  revokeHostedWorkcellSession
} from "./hosted-sessions";
import { findTerminalSession, terminalPage } from "./terminal-surface";
import {
  artifactImportIntakeToJson,
  artifactImportSupportJson,
  createArtifactImportReview,
  findArtifactImportIntake
} from "./artifact-imports";
import { createArtifactImportAppBundle } from "./artifact-app-bundles";
import { createGitImportAppBundle } from "./git-import-app-bundles";
import {
  createHostedAgentLaunch,
  findHostedAgentLaunch,
  hostedAgentLaunchToJson,
  listHostedAgentLaunchesForSession
} from "./agent-launches";
import {
  charterFirstRunToJson,
  createCharterFirstRun,
  findCharterFirstRun,
  ImplementationBlockedError,
  recordCharterSufficiency,
  recordImplementationStart
} from "./charter-first-runs";
import {
  createFirstRunSecretGrant,
  listSecretGrantRequestsForFirstRun,
  secretGrantRequestToJson,
  secretMaterializationReadiness
} from "./secret-grants";
import {
  createGridPublishRequest,
  gridPublishRequestToJson,
  listGridPublishRequestsForApp,
  recordGridPublishCallback
} from "./grid-publish";
import { customerAppSupportDebug } from "./customer-support";

validateRuntimeSafety(config);
ensureStorage();

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  async fetch(request) {
    try {
      if (oversizedRequest(request)) {
        const response = json({ error: "request too large" }, 413);
        recordAuditEvent(request, response);
        return response;
      }
      if (rateLimitExceeded(request)) {
        const response = json({ error: "rate limit exceeded" }, 429);
        recordAuditEvent(request, response);
        return response;
      }
      const response = await route(request);
      recordAuditEvent(request, response);
      return response;
    } catch {
      const response = json({ error: "internal server error" }, 500);
      recordAuditEvent(request, response);
      return response;
    }
  }
});

console.log(`BitterGit listening on http://${server.hostname}:${server.port}`);

async function route(request: Request): Promise<Response> {
  if (config.demoUiEnabled) {
    const uiResponse = await handleUiRoute(request);
    if (uiResponse) return uiResponse;
  }

  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/up") {
    return json({
      ok: true,
      service: "bittergit",
      status: "ok",
      release: process.env.BITTERGIT_RELEASE_SHA ?? "local",
      secret_material_returned: false
    });
  }

  if (request.method === "GET" && url.pathname === "/bittergit/v1/providers") {
    return json({ providers: sourceProviders });
  }

  const terminalMatch = url.pathname.match(/^\/terminals\/([^/]+)$/);
  if (request.method === "GET" && terminalMatch) {
    if (!config.demoUiEnabled && !authenticate(request).ok) return unauthorized();
    const session = findTerminalSession(decodeURIComponent(terminalMatch[1]));
    if (!session) return json({ error: "terminal session not found" }, 404);
    if (!config.demoUiEnabled) {
      const auth = authenticate(request, { repoId: session.repo_id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
    }
    return terminalPage(session);
  }

  if (request.method === "GET" && url.pathname === "/bittergit/v1/customer/plan") {
    try {
      const assertion = parseAccountAssertion(request);
      return json({ plan: planSummary(assertion, activeAppCount(assertion.account_ref)) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }
  }

  if (url.pathname === "/bittergit/v1/customer/apps") {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    if (request.method === "GET") {
      const apps = listAccountApps(assertion).map((app) => {
        const repo = findRepositoryById(app.repo_id);
        if (!repo) return undefined;
        return accountAppToJson(app, repo);
      }).filter(Boolean);
      return json({ apps, plan: planSummary(assertion, activeAppCount(assertion.account_ref)) });
    }

    if (request.method === "POST") {
      try {
        const body = await request.json() as { name?: string; display_name?: string | null };
        const result = createCustomerApp(assertion, body);
        return json({
          app: accountAppToJson(result.app, result.repo),
          plan: result.plan,
          tokens: result.tokens,
          existing: result.existing
        }, result.existing ? 200 : 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid app";
        return json({ error: message }, error instanceof PlanLimitError ? 422 : 400);
      }
    }
  }

  if (url.pathname === "/bittergit/v1/customer/app-bundles") {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    if (request.method === "POST") {
      try {
        const body = await request.json() as { name?: string; display_name?: string | null };
        const result = createAppBundle(assertion, body);
        return json({
          app: accountAppToJson(result.app, result.repo),
          plan: result.app ? planSummary(assertion, activeAppCount(assertion.account_ref)) : undefined,
          tokens: result.tokens,
          setup_state: result.setup_state,
          checkpoint: result.checkpoint,
          receipt: result.receipt,
          source_tree: result.source_tree,
          context_files: result.context_files,
          existing: result.existing,
          github_required: false
        }, result.existing ? 200 : 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid app bundle";
        return json({ error: message }, error instanceof PlanLimitError ? 422 : 400);
      }
    }
  }

  if (url.pathname === "/bittergit/v1/customer/git-import-app-bundles") {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    if (request.method === "POST") {
      try {
        const body = await request.json() as {
          name?: string;
          display_name?: string | null;
          source_url?: string;
          provider?: string;
          default_branch?: string;
          source_auth?: {
            type?: "basic" | "github_oauth" | "token";
            username?: string;
            password?: string;
            token?: string;
          } | null;
        };
        const result = createGitImportAppBundle(assertion, body);
        return json({
          app: accountAppToJson(result.app, result.repo),
          plan: planSummary(assertion, activeAppCount(assertion.account_ref)),
          tokens: result.tokens,
          setup_state: result.setup_state,
          checkpoint: result.checkpoint,
          receipt: result.receipt,
          source_tree: result.source_tree,
          context_files: result.context_files,
          source_contract: result.source_contract,
          git_import: result.git_import,
          credential_material_returned: false,
          github_required: false
        }, 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid Git import app bundle";
        return json({ error: message }, error instanceof PlanLimitError ? 422 : 400);
      }
    }
  }

  if (url.pathname === "/bittergit/v1/customer/artifact-imports/review") {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    if (request.method === "POST") {
      try {
        const body = await request.json() as { source_kind?: string; source_path?: string };
        const intake = createArtifactImportReview(assertion, body);
        return json({ artifact_import: artifactImportIntakeToJson(intake) }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid artifact import" }, 422);
      }
    }
  }

  const artifactImportMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/artifact-imports\/([^/]+)$/);
  if (request.method === "GET" && artifactImportMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    const intake = findArtifactImportIntake(assertion, decodeURIComponent(artifactImportMatch[1]));
    if (!intake) return json({ error: "artifact import not found" }, 404);
    return json({ artifact_import: artifactImportIntakeToJson(intake) });
  }

  const artifactImportBundleMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/artifact-imports\/([^/]+)\/app-bundle$/);
  if (request.method === "POST" && artifactImportBundleMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    const intake = findArtifactImportIntake(assertion, decodeURIComponent(artifactImportBundleMatch[1]));
    if (!intake) return json({ error: "artifact import not found" }, 404);

    try {
      const body = await request.json() as { name?: string; display_name?: string | null };
      const result = createArtifactImportAppBundle(assertion, intake, body);
      return json({
        app: accountAppToJson(result.app, result.repo),
        plan: planSummary(assertion, activeAppCount(assertion.account_ref)),
        tokens: result.tokens,
        setup_state: result.setup_state,
        checkpoint: result.checkpoint,
        receipt: result.receipt,
        source_tree: result.source_tree,
        context_files: result.context_files,
        artifact_import: result.artifact_import,
        github_required: false
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid artifact app bundle";
      return json({ error: message }, error instanceof PlanLimitError ? 422 : 400);
    }
  }

  const artifactImportSupportMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/artifact-imports\/([^/]+)\/support-debug$/);
  if (request.method === "GET" && artifactImportSupportMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    const intake = findArtifactImportIntake(assertion, decodeURIComponent(artifactImportSupportMatch[1]));
    if (!intake) return json({ error: "artifact import not found" }, 404);
    return json({ support: { artifact_import: artifactImportSupportJson(intake) } });
  }

  const customerSetupMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/setup$/);
  if (request.method === "GET" && customerSetupMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    const app = findAccountAppById(decodeURIComponent(customerSetupMatch[1]));
    if (!app || app.account_ref !== assertion.account_ref) return json({ error: "app not found" }, 404);
    const setup = findSetupStateForApp(app.id);
    if (!setup) return json({ error: "setup state not found" }, 404);
    return json({ setup_state: setupStateToJson(setup) });
  }

  const customerSetupProgressMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/setup\/progress$/);
  if (request.method === "GET" && customerSetupProgressMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    const app = findAccountAppById(decodeURIComponent(customerSetupProgressMatch[1]));
    if (!app || app.account_ref !== assertion.account_ref) return json({ error: "app not found" }, 404);
    const setup = findSetupStateForApp(app.id);
    if (!setup) return json({ error: "setup state not found" }, 404);
    return json({ progress: setupProgressToJson(setup) });
  }

  const customerSupportMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/support-debug$/);
  if (request.method === "GET" && customerSupportMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    try {
      return json({ support: customerAppSupportDebug(assertion, decodeURIComponent(customerSupportMatch[1])) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid customer support debug" }, 422);
    }
  }

  const secretMaterializationReadinessMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/secret-materialization-readiness$/);
  if (request.method === "GET" && secretMaterializationReadinessMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    try {
      const environment = new URL(request.url).searchParams.get("environment");
      return json({
        readiness: secretMaterializationReadiness(
          assertion,
          decodeURIComponent(secretMaterializationReadinessMatch[1]),
          environment
        )
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid secret materialization readiness" }, 422);
    }
  }

  const gridPublishCollectionMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/grid-publish-requests$/);
  if (gridPublishCollectionMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    const appId = decodeURIComponent(gridPublishCollectionMatch[1]);
    try {
      if (request.method === "GET") {
        return json({
          grid_publish_requests: listGridPublishRequestsForApp(assertion, appId).map(gridPublishRequestToJson)
        });
      }

      if (request.method === "POST") {
        const body = await request.json().catch(() => ({})) as {
          commit_sha?: string;
          checkpoint_id?: string | null;
          environment?: string;
          simulate_status?: string;
          verification_status?: string;
          callback_mode?: boolean;
        };
        const publish = createGridPublishRequest(assertion, appId, body);
        return json({ grid_publish: gridPublishRequestToJson(publish) }, 201);
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid Grid publish request" }, 422);
    }
  }

  const gridPublishCallbackMatch = url.pathname.match(/^\/bittergit\/v1\/grid\/publish-requests\/([^/]+)\/callback$/);
  if (request.method === "POST" && gridPublishCallbackMatch) {
    const authorization = request.headers.get("authorization") ?? "";
    if (authorization !== `Bearer ${config.devToken}`) return unauthorized();

    try {
      const body = await request.json().catch(() => ({})) as {
        grid_operation_ref?: string;
        commit_sha?: string;
        status?: string;
        published_url?: string;
        verification_status?: string;
        grid_receipt_id?: string;
        private_logs?: unknown;
        logs?: unknown;
      };
      const result = recordGridPublishCallback(decodeURIComponent(gridPublishCallbackMatch[1]), body);
      return json({
        grid_publish: gridPublishRequestToJson(result.request),
        receipt: result.receipt
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid Grid publish callback" }, 422);
    }
  }

  const hostedSessionCollectionMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/workcell-sessions$/);
  if (hostedSessionCollectionMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    const appId = decodeURIComponent(hostedSessionCollectionMatch[1]);
    try {
      if (request.method === "GET") {
        return json({
          sessions: listHostedWorkcellSessionsForApp(assertion, appId).map(hostedWorkcellSessionToJson)
        });
      }

      if (request.method === "POST") {
        const body = await request.json().catch(() => ({})) as {
          production_ssh?: unknown;
          terminal_fulfillment?: unknown;
        };
        const result = await createHostedWorkcellSession(assertion, appId, {
          production_ssh: body.production_ssh,
          terminal_fulfillment: body.terminal_fulfillment
        });
        return json({
          app: accountAppToJson(result.app, result.repo),
          session: hostedWorkcellSessionToJson(result.session)
        }, 201);
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid hosted workcell session" }, 422);
    }
  }

  const hostedSessionReadinessMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/workcell-sessions\/([^/]+)\/readiness$/);
  if (request.method === "GET" && hostedSessionReadinessMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    try {
      const sessions = listHostedWorkcellSessionsForApp(assertion, decodeURIComponent(hostedSessionReadinessMatch[1]));
      const session = sessions.find((entry) => entry.id === decodeURIComponent(hostedSessionReadinessMatch[2]));
      if (!session) return json({ error: "hosted workcell session not found" }, 404);
      const payload = hostedWorkcellSessionToJson(session);
      return json({
        readiness: payload.agent_readiness,
        checks: payload.agent_readiness_checks
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid hosted workcell readiness" }, 422);
    }
  }

  const hostedSessionTerminalFulfillmentMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/workcell-sessions\/([^/]+)\/terminal-fulfillment$/);
  if (request.method === "POST" && hostedSessionTerminalFulfillmentMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    try {
      const session = await fulfillHostedWorkcellTerminal(
        assertion,
        decodeURIComponent(hostedSessionTerminalFulfillmentMatch[1]),
        decodeURIComponent(hostedSessionTerminalFulfillmentMatch[2])
      );
      return json({ session: hostedWorkcellSessionToJson(session) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid terminal fulfillment" }, 422);
    }
  }

  const hostedAgentLaunchCollectionMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/workcell-sessions\/([^/]+)\/agent-launches$/);
  if (hostedAgentLaunchCollectionMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    const appId = decodeURIComponent(hostedAgentLaunchCollectionMatch[1]);
    const sessionId = decodeURIComponent(hostedAgentLaunchCollectionMatch[2]);
    try {
      if (request.method === "GET") {
        return json({
          agent_launches: listHostedAgentLaunchesForSession(assertion, appId, sessionId).map(hostedAgentLaunchToJson)
        });
      }

      if (request.method === "POST") {
        const body = await request.json().catch(() => ({})) as { provider?: string };
        const launch = await createHostedAgentLaunch(assertion, appId, sessionId, body);
        return json({ agent_launch: hostedAgentLaunchToJson(launch) }, 201);
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid hosted agent launch" }, 422);
    }
  }

  const hostedAgentLaunchMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/workcell-sessions\/([^/]+)\/agent-launches\/([^/]+)$/);
  if (request.method === "GET" && hostedAgentLaunchMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    try {
      const launch = findHostedAgentLaunch(
        assertion,
        decodeURIComponent(hostedAgentLaunchMatch[1]),
        decodeURIComponent(hostedAgentLaunchMatch[2]),
        decodeURIComponent(hostedAgentLaunchMatch[3])
      );
      if (!launch) return json({ error: "hosted agent launch not found" }, 404);
      return json({ agent_launch: hostedAgentLaunchToJson(launch) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid hosted agent launch" }, 422);
    }
  }

  const charterFirstRunCollectionMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/workcell-sessions\/([^/]+)\/agent-launches\/([^/]+)\/first-runs$/);
  if (request.method === "POST" && charterFirstRunCollectionMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    try {
      const firstRun = createCharterFirstRun(
        assertion,
        decodeURIComponent(charterFirstRunCollectionMatch[1]),
        decodeURIComponent(charterFirstRunCollectionMatch[2]),
        decodeURIComponent(charterFirstRunCollectionMatch[3])
      );
      return json({ charter_first_run: charterFirstRunToJson(firstRun) }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid charter-first run" }, 422);
    }
  }

  const charterFirstRunMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/workcell-sessions\/([^/]+)\/agent-launches\/([^/]+)\/first-runs\/([^/]+)$/);
  if (request.method === "GET" && charterFirstRunMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    try {
      const firstRun = findCharterFirstRun(
        assertion,
        decodeURIComponent(charterFirstRunMatch[1]),
        decodeURIComponent(charterFirstRunMatch[2]),
        decodeURIComponent(charterFirstRunMatch[3]),
        decodeURIComponent(charterFirstRunMatch[4])
      );
      if (!firstRun) return json({ error: "charter-first run not found" }, 404);
      return json({ charter_first_run: charterFirstRunToJson(firstRun) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid charter-first run" }, 422);
    }
  }

  const charterFirstRunSufficiencyMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/workcell-sessions\/([^/]+)\/agent-launches\/([^/]+)\/first-runs\/([^/]+)\/charter-sufficiency$/);
  if (request.method === "POST" && charterFirstRunSufficiencyMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    try {
      const firstRun = recordCharterSufficiency(
        assertion,
        decodeURIComponent(charterFirstRunSufficiencyMatch[1]),
        decodeURIComponent(charterFirstRunSufficiencyMatch[2]),
        decodeURIComponent(charterFirstRunSufficiencyMatch[3]),
        decodeURIComponent(charterFirstRunSufficiencyMatch[4])
      );
      return json({ charter_first_run: charterFirstRunToJson(firstRun) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid charter sufficiency" }, 422);
    }
  }

  const implementationStartMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/workcell-sessions\/([^/]+)\/agent-launches\/([^/]+)\/first-runs\/([^/]+)\/implementation-start$/);
  if (request.method === "POST" && implementationStartMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    try {
      return json(recordImplementationStart(
        assertion,
        decodeURIComponent(implementationStartMatch[1]),
        decodeURIComponent(implementationStartMatch[2]),
        decodeURIComponent(implementationStartMatch[3]),
        decodeURIComponent(implementationStartMatch[4])
      ), 201);
    } catch (error) {
      if (error instanceof ImplementationBlockedError) {
        return json({
          status: "blocked",
          error: error.message,
          charter_first_run: charterFirstRunToJson(error.firstRun)
        }, 409);
      }
      return json({ error: error instanceof Error ? error.message : "invalid implementation start" }, 422);
    }
  }

  const secretGrantCollectionMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/workcell-sessions\/([^/]+)\/agent-launches\/([^/]+)\/first-runs\/([^/]+)\/secret-grants$/);
  if (secretGrantCollectionMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    const appId = decodeURIComponent(secretGrantCollectionMatch[1]);
    const sessionId = decodeURIComponent(secretGrantCollectionMatch[2]);
    const launchId = decodeURIComponent(secretGrantCollectionMatch[3]);
    const firstRunId = decodeURIComponent(secretGrantCollectionMatch[4]);
    try {
      if (request.method === "GET") {
        return json({
          secret_grants: listSecretGrantRequestsForFirstRun(assertion, appId, sessionId, launchId, firstRunId)
            .map(secretGrantRequestToJson)
        });
      }

      if (request.method === "POST") {
        const body = await request.json().catch(() => ({})) as {
          name?: string;
          environment?: string;
          purpose?: string;
          credential_ref?: string;
          value?: string;
          credential_value?: string;
        };
        const grant = createFirstRunSecretGrant(assertion, appId, sessionId, launchId, firstRunId, body);
        return json({ secret_grant: secretGrantRequestToJson(grant) }, 201);
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid secret grant" }, 422);
    }
  }

  const hostedSessionRevokeMatch = url.pathname.match(/^\/bittergit\/v1\/customer\/apps\/([^/]+)\/workcell-sessions\/([^/]+)\/revoke$/);
  if (request.method === "POST" && hostedSessionRevokeMatch) {
    let assertion;
    try {
      assertion = parseAccountAssertion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid account assertion" }, 401);
    }

    try {
      const session = await revokeHostedWorkcellSession(
        assertion,
        decodeURIComponent(hostedSessionRevokeMatch[1]),
        decodeURIComponent(hostedSessionRevokeMatch[2])
      );
      return json({ session: hostedWorkcellSessionToJson(session) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid hosted workcell revoke" }, 422);
    }
  }

  if (url.pathname === "/bittergit/v1/operations/backups") {
    if (request.method === "GET") {
      const auth = authenticate(request, { require: "repo:create" });
      if (!auth.ok) return unauthorized();
      return json({ backups: listBackups() });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { require: "repo:create" });
      if (!auth.ok) return unauthorized();
      return json({ backup: createBackup() }, 201);
    }
  }

  const restoreRehearsalMatch = url.pathname.match(/^\/bittergit\/v1\/operations\/backups\/([^/]+)\/restore-rehearsal$/);
  if (request.method === "POST" && restoreRehearsalMatch) {
    const auth = authenticate(request, { require: "repo:create" });
    if (!auth.ok) return unauthorized();
    const backup = findBackup(decodeURIComponent(restoreRehearsalMatch[1]));
    if (!backup) return json({ error: "backup not found" }, 404);
    return json({ restore_rehearsal: rehearseRestore(backup) }, 201);
  }

  if (request.method === "GET" && url.pathname === "/bittergit/v1/operations/health") {
    const auth = authenticate(request, { require: "repo:create" });
    if (!auth.ok) return unauthorized();
    return json({ health: operationsHealth() });
  }

  if (request.method === "GET" && url.pathname === "/bittergit/v1/operations/performance") {
    const auth = authenticate(request, { require: "repo:create" });
    if (!auth.ok) return unauthorized();
    return json({ performance: performancePosture() });
  }

  if (url.pathname === "/bittergit/v1/operations/performance-runs") {
    if (request.method === "GET") {
      const auth = authenticate(request, { require: "repo:create" });
      if (!auth.ok) return unauthorized();
      const limit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
      return json({ performance_runs: listPerformanceRuns(limit).map(performanceRunToJson) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { require: "repo:create" });
      if (!auth.ok) return unauthorized();
      try {
        const body = await request.json() as { status?: string; summary?: unknown };
        return json({ performance_run: performanceRunToJson(recordPerformanceRun(body)) }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid performance run" }, 422);
      }
    }
  }

  if (request.method === "GET" && url.pathname === "/bittergit/v1/operations/security") {
    const auth = authenticate(request, { require: "repo:create" });
    if (!auth.ok) return unauthorized();
    return json({ security: securityPosture() });
  }

  if (request.method === "GET" && url.pathname === "/bittergit/v1/operations/assertion-trust") {
    const auth = authenticate(request, { require: "repo:create" });
    if (!auth.ok) return unauthorized();
    return json({ assertion_trust: sanitizedAssertionTrustConfig() });
  }

  if (request.method === "GET" && url.pathname === "/bittergit/v1/operations/issuer-discovery") {
    const auth = authenticate(request, { require: "repo:create" });
    if (!auth.ok) return unauthorized();
    return json({ issuer_discovery: sanitizedIssuerDiscovery() });
  }

  if (url.pathname === "/bittergit/v1/operations/assertion-revocations") {
    const auth = authenticate(request, { require: "repo:create" });
    if (!auth.ok) return unauthorized();

    if (request.method === "GET") {
      return json({ assertion_revocations: listAssertionRevocations().map(assertionRevocationToSupportJson) });
    }

    if (request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({})) as {
          issuer?: string;
          assertion_id?: string | null;
          subject?: string | null;
          account_ref?: string | null;
          reason?: string | null;
          source?: string | null;
        };
        return json({
          assertion_revocation: assertionRevocationToSupportJson(createAssertionRevocation(body as {
            issuer: string;
            assertion_id?: string | null;
            subject?: string | null;
            account_ref?: string | null;
            reason?: string | null;
            source?: string | null;
          }))
        }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid assertion revocation" }, 422);
      }
    }
  }

  if (request.method === "GET" && url.pathname === "/bittergit/v1/operations/audit") {
    const auth = authenticate(request, { require: "repo:create" });
    if (!auth.ok) return unauthorized();
    const limit = Number(url.searchParams.get("limit") ?? "100");
    return json({ audit_events: listAuditEvents(limit) });
  }

  if (request.method === "POST" && url.pathname === "/bittergit/v1/repos") {
    const auth = authenticate(request, { require: "repo:create" });
    if (!auth.ok) return unauthorized();

    const body = await request.json() as { owner?: string; name?: string };
    if (!body.owner || !body.name) return json({ error: "owner and name are required" }, 422);

    const existing = findRepository(body.owner, body.name);
    if (existing) {
      return json({ ...repoToJson(existing), existing: true }, 200);
    }

    const repo = createRepository(body.owner, body.name);
    const tokens = createRepoTokenBundle(repo);
    return json({ ...repoToJson(repo), existing: false, tokens }, 201);
  }

  if (request.method === "GET" && url.pathname === "/bittergit/v1/repos") {
    const auth = authenticate(request, { require: "repo:create" });
    if (!auth.ok) return unauthorized();

    return json({ repositories: listRepositories().map(repoToJson) });
  }

  if (request.method === "POST" && url.pathname === "/bittergit/v1/workcells") {
    const body = await request.json() as { owner?: string; name?: string };
    if (!body.owner || !body.name) return json({ error: "owner and name are required" }, 422);

    const repo = findRepository(body.owner, body.name);
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: ["repo:admin", "repo:create"] });
    if (!auth.ok) return unauthorized();

    const workcell = createWorkcell(repo);
    return json(workcellToJson(workcell, repo), 201);
  }

  const workcellMatch = url.pathname.match(/^\/bittergit\/v1\/workcells\/([^/]+)$/);
  if (request.method === "GET" && workcellMatch) {
    const workcell = findWorkcell(decodeURIComponent(workcellMatch[1]));
    if (!workcell) return json({ error: "workcell not found" }, 404);

    const repo = findRepositoryById(workcell.repo_id);
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: ["repo:admin", "repo:create"] });
    if (!auth.ok) return unauthorized();

    return json(workcellToJson(workcell, repo));
  }

  const revokeWorkcellMatch = url.pathname.match(/^\/bittergit\/v1\/workcells\/([^/]+)\/revoke$/);
  if (request.method === "POST" && revokeWorkcellMatch) {
    const workcell = findWorkcell(decodeURIComponent(revokeWorkcellMatch[1]));
    if (!workcell) return json({ error: "workcell not found" }, 404);

    const repo = findRepositoryById(workcell.repo_id);
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: ["repo:admin", "repo:create"] });
    if (!auth.ok) return unauthorized();

    const revoked = revokeWorkcell(workcell.id);
    return json(workcellToJson(revoked as NonNullable<typeof revoked>, repo));
  }

  const eventsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/events$/);
  if (request.method === "GET" && eventsMatch) {
    const repo = findRepository(decodeURIComponent(eventsMatch[1]), decodeURIComponent(eventsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
    if (!auth.ok) return unauthorized();

    return json({ events: listEvents(repo) });
  }

  const refsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/refs$/);
  if (request.method === "GET" && refsMatch) {
    const repo = findRepository(decodeURIComponent(refsMatch[1]), decodeURIComponent(refsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
    if (!auth.ok) return unauthorized();

    return json({ refs: listRefs(repo) });
  }

  const checkpointsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/checkpoints$/);
  if (checkpointsMatch) {
    const repo = findRepository(decodeURIComponent(checkpointsMatch[1]), decodeURIComponent(checkpointsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ checkpoints: listCheckpoints(repo) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();

      const body = await request.json() as { label?: string; checkpoint_type?: string; ref?: string };
      if (!body.label || !body.checkpoint_type) {
        return json({ error: "label and checkpoint_type are required" }, 422);
      }

      const result = createCheckpoint(repo, {
        label: body.label,
        checkpoint_type: body.checkpoint_type,
        ref: body.ref,
        actor: auth.actor ?? "unknown"
      });
      return json({ ...result.checkpoint, created: result.created }, result.created ? 201 : 200);
    }
  }

  const diffMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/checkpoints\/([^/]+)\/diff$/);
  if (request.method === "GET" && diffMatch) {
    const repo = findRepository(decodeURIComponent(diffMatch[1]), decodeURIComponent(diffMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
    if (!auth.ok) return unauthorized();

    const from = findCheckpoint(repo, decodeURIComponent(diffMatch[3]));
    const toId = url.searchParams.get("to");
    if (!from || !toId) return json({ error: "from checkpoint and to query are required" }, 422);

    const to = findCheckpoint(repo, toId);
    if (!to) return json({ error: "to checkpoint not found" }, 404);

    return json({ diff_stat: diffCheckpoints(repo, from, to) });
  }

  const restoreMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/checkpoints\/([^/]+)\/restore$/);
  if (request.method === "POST" && restoreMatch) {
    const repo = findRepository(decodeURIComponent(restoreMatch[1]), decodeURIComponent(restoreMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();
    if (!tokenCanWriteRef(auth.scopes ?? [], "refs/heads/main")) {
      return unauthorized("token cannot restore refs/heads/main");
    }

    const checkpoint = findCheckpoint(repo, decodeURIComponent(restoreMatch[3]));
    if (!checkpoint) return json({ error: "checkpoint not found" }, 404);

    return json({ restored: restoreCheckpoint(repo, checkpoint, auth.actor ?? "unknown") });
  }

  const deploymentsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/deployments$/);
  if (deploymentsMatch) {
    const repo = findRepository(decodeURIComponent(deploymentsMatch[1]), decodeURIComponent(deploymentsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ deployments: listDeployments(repo) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();

      const body = await request.json() as { commit_sha?: string; environment?: string; checkpoint_id?: string };
      if (!body.commit_sha) return json({ error: "commit_sha is required" }, 422);

      try {
        const result = createDeployment(repo, {
          commit_sha: body.commit_sha,
          environment: body.environment ?? "production",
          checkpoint_id: body.checkpoint_id ?? null
        });
        return json(result, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid deployment" }, 422);
      }
    }
  }

  const rollbackMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/deployments\/rollback$/);
  if (request.method === "POST" && rollbackMatch) {
    const repo = findRepository(decodeURIComponent(rollbackMatch[1]), decodeURIComponent(rollbackMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const body = await request.json() as { checkpoint_id?: string; previous_commit_sha?: string; environment?: string };
    if (!body.checkpoint_id || !body.previous_commit_sha) {
      return json({ error: "checkpoint_id and previous_commit_sha are required" }, 422);
    }

    try {
      return json(createRollback(repo, {
        checkpoint_id: body.checkpoint_id,
        previous_commit_sha: body.previous_commit_sha,
        environment: body.environment ?? "production"
      }), 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid rollback" }, 422);
    }
  }

  const verifyMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/deployments\/([^/]+)\/verification$/);
  if (request.method === "POST" && verifyMatch) {
    const repo = findRepository(decodeURIComponent(verifyMatch[1]), decodeURIComponent(verifyMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const deployment = findDeployment(repo, decodeURIComponent(verifyMatch[3]));
    if (!deployment) return json({ error: "deployment not found" }, 404);

    const body = await request.json() as { status?: string; summary?: string };
    const status = body.status;
    if (!status) return json({ error: "status is required" }, 422);

    return json({ verification: createVerification(repo, deployment, { status, summary: body.summary }) }, 201);
  }

  const receiptsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/receipts$/);
  if (request.method === "GET" && receiptsMatch) {
    const repo = findRepository(decodeURIComponent(receiptsMatch[1]), decodeURIComponent(receiptsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
    if (!auth.ok) return unauthorized();

    return json({ receipts: listReceipts(repo) });
  }

  const mirrorsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/mirrors$/);
  if (mirrorsMatch) {
    const repo = findRepository(decodeURIComponent(mirrorsMatch[1]), decodeURIComponent(mirrorsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ mirrors: listMirrorTargets(repo).map(mirrorToJson) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: ["repo:admin", "repo:create"] });
      if (!auth.ok) return unauthorized();

      try {
        const body = await request.json() as {
          provider?: string;
          remote_url?: string;
          credential_ref?: string | null;
          credential_value?: string;
          sync_now?: boolean;
        };
        return json(createMirrorTarget(repo, body), 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid mirror target" }, 422);
      }
    }
  }

  const mirrorRunsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/mirrors\/([^/]+)\/runs$/);
  if (request.method === "GET" && mirrorRunsMatch) {
    const repo = findRepository(decodeURIComponent(mirrorRunsMatch[1]), decodeURIComponent(mirrorRunsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
    if (!auth.ok) return unauthorized();

    const mirror = findMirrorTarget(repo, decodeURIComponent(mirrorRunsMatch[3]));
    if (!mirror) return json({ error: "mirror not found" }, 404);

    return json({ runs: listMirrorRuns(repo, mirror) });
  }

  const mirrorActionMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/mirrors\/([^/]+)\/(sync|repair|import|disable)$/);
  if (request.method === "POST" && mirrorActionMatch) {
    const repo = findRepository(decodeURIComponent(mirrorActionMatch[1]), decodeURIComponent(mirrorActionMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: ["repo:admin", "repo:create"] });
    if (!auth.ok) return unauthorized();

    const mirror = findMirrorTarget(repo, decodeURIComponent(mirrorActionMatch[3]));
    if (!mirror) return json({ error: "mirror not found" }, 404);

    const action = mirrorActionMatch[4];
    if (action === "sync") return json(syncMirrorTarget(repo, mirror, "manual"));
    if (action === "repair") return json(repairMirrorTarget(repo, mirror));
    if (action === "import") return json(importMirrorTarget(repo, mirror, auth.actor ?? "unknown"));
    if (action === "disable") return json(disableMirrorTarget(repo, mirror));
  }

  const issuesMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/issues$/);
  if (issuesMatch) {
    const repo = findRepository(decodeURIComponent(issuesMatch[1]), decodeURIComponent(issuesMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ issues: listIssues(repo).map((issue) => issueToJson(repo, issue)) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();

      try {
        const body = await request.json() as {
          title?: string;
          body?: string | null;
          external_provider?: string | null;
          external_id?: string | null;
        };
        return json({ issue: issueToJson(repo, createIssue(repo, body, auth.actor ?? "unknown")) }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid issue" }, 422);
      }
    }
  }

  const issueMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([0-9]+)$/);
  if (issueMatch) {
    const repo = findRepository(decodeURIComponent(issueMatch[1]), decodeURIComponent(issueMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const issue = findIssueByNumber(repo, Number.parseInt(issueMatch[3], 10));
    if (!issue) return json({ error: "issue not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ issue: issueToJson(repo, issue) });
    }

    if (request.method === "PATCH") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();

      try {
        const body = await request.json() as { title?: string; body?: string | null; status?: string };
        return json({ issue: issueToJson(repo, updateIssue(repo, issue, body, auth.actor ?? "unknown")) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid issue update" }, 422);
      }
    }
  }

  const issueCommentMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([0-9]+)\/comments$/);
  if (request.method === "POST" && issueCommentMatch) {
    const repo = findRepository(decodeURIComponent(issueCommentMatch[1]), decodeURIComponent(issueCommentMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const issue = findIssueByNumber(repo, Number.parseInt(issueCommentMatch[3], 10));
    if (!issue) return json({ error: "issue not found" }, 404);

    try {
      const body = await request.json() as { body?: string };
      if (!body.body) return json({ error: "body is required" }, 422);
      return json({ comment: addIssueComment(repo, issue, body.body, auth.actor ?? "unknown") }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid issue comment" }, 422);
    }
  }

  const issueLinkMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([0-9]+)\/links$/);
  if (request.method === "POST" && issueLinkMatch) {
    const repo = findRepository(decodeURIComponent(issueLinkMatch[1]), decodeURIComponent(issueLinkMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const issue = findIssueByNumber(repo, Number.parseInt(issueLinkMatch[3], 10));
    if (!issue) return json({ error: "issue not found" }, 404);

    try {
      const body = await request.json() as {
        link_type?: string;
        target_id?: string | null;
        target_ref?: string | null;
        target_sha?: string | null;
        metadata?: unknown;
      };
      return json({ link: addIssueLink(repo, issue, body, auth.actor ?? "unknown") }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid issue link" }, 422);
    }
  }

  const issueAgentRunMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([0-9]+)\/agent-runs$/);
  if (request.method === "POST" && issueAgentRunMatch) {
    const repo = findRepository(decodeURIComponent(issueAgentRunMatch[1]), decodeURIComponent(issueAgentRunMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const issue = findIssueByNumber(repo, Number.parseInt(issueAgentRunMatch[3], 10));
    if (!issue) return json({ error: "issue not found" }, 404);

    try {
      const body = await request.json() as { run_id?: string; instruction?: string; branch?: string };
      return json({ link: createIssueAgentRun(repo, issue, body, auth.actor ?? "unknown") }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid agent run link" }, 422);
    }
  }

  const issueCloseMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([0-9]+)\/close$/);
  if (request.method === "POST" && issueCloseMatch) {
    const repo = findRepository(decodeURIComponent(issueCloseMatch[1]), decodeURIComponent(issueCloseMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const issue = findIssueByNumber(repo, Number.parseInt(issueCloseMatch[3], 10));
    if (!issue) return json({ error: "issue not found" }, 404);

    try {
      const body = await request.json() as {
        comment?: string | null;
        evidence?: Array<{
          link_type?: string;
          target_id?: string | null;
          target_ref?: string | null;
          target_sha?: string | null;
          metadata?: unknown;
        }>;
      };
      return json({ issue: issueToJson(repo, closeIssue(repo, issue, body, auth.actor ?? "unknown")) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid issue close" }, 422);
    }
  }

  const pullRequestsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/pull-requests$/);
  if (pullRequestsMatch) {
    const repo = findRepository(decodeURIComponent(pullRequestsMatch[1]), decodeURIComponent(pullRequestsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ pull_requests: listPullRequests(repo).map((pr) => pullRequestToJson(repo, pr)) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();

      try {
        const body = await request.json() as {
          title?: string;
          body?: string | null;
          base_ref?: string;
          head_ref?: string;
          issue_number?: number | null;
          require_verification?: boolean;
        };
        return json({ pull_request: pullRequestToJson(repo, createPullRequest(repo, body, auth.actor ?? "unknown")) }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid pull request" }, 422);
      }
    }
  }

  const pullRequestMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/pull-requests\/([0-9]+)$/);
  if (request.method === "GET" && pullRequestMatch) {
    const repo = findRepository(decodeURIComponent(pullRequestMatch[1]), decodeURIComponent(pullRequestMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
    if (!auth.ok) return unauthorized();

    const pr = findPullRequestByNumber(repo, Number.parseInt(pullRequestMatch[3], 10));
    if (!pr) return json({ error: "pull request not found" }, 404);
    return json({ pull_request: pullRequestToJson(repo, pr) });
  }

  const pullRequestVerificationMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/pull-requests\/([0-9]+)\/verification$/);
  if (request.method === "POST" && pullRequestVerificationMatch) {
    const repo = findRepository(decodeURIComponent(pullRequestVerificationMatch[1]), decodeURIComponent(pullRequestVerificationMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const pr = findPullRequestByNumber(repo, Number.parseInt(pullRequestVerificationMatch[3], 10));
    if (!pr) return json({ error: "pull request not found" }, 404);

    try {
      const body = await request.json() as {
        status?: string;
        summary?: string | null;
        preview_url?: string | null;
        deployment_id?: string | null;
        receipt_id?: string | null;
      };
      return json({ pull_request: pullRequestToJson(repo, updatePullRequestVerification(repo, pr, body)) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid pull request verification" }, 422);
    }
  }

  const pullRequestMergeMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/pull-requests\/([0-9]+)\/merge$/);
  if (request.method === "POST" && pullRequestMergeMatch) {
    const repo = findRepository(decodeURIComponent(pullRequestMergeMatch[1]), decodeURIComponent(pullRequestMergeMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();
    if (!tokenCanWriteRef(auth.scopes ?? [], "refs/heads/main")) {
      return unauthorized("token cannot merge into refs/heads/main");
    }

    const pr = findPullRequestByNumber(repo, Number.parseInt(pullRequestMergeMatch[3], 10));
    if (!pr) return json({ error: "pull request not found" }, 404);

    try {
      const result = mergePullRequest(repo, pr, auth.actor ?? "unknown");
      return json({
        pull_request: pullRequestToJson(repo, result.pull_request),
        merge: result.merge
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid pull request merge" }, 422);
    }
  }

  const pullRequestCloseMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/pull-requests\/([0-9]+)\/close$/);
  if (request.method === "POST" && pullRequestCloseMatch) {
    const repo = findRepository(decodeURIComponent(pullRequestCloseMatch[1]), decodeURIComponent(pullRequestCloseMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const pr = findPullRequestByNumber(repo, Number.parseInt(pullRequestCloseMatch[3], 10));
    if (!pr) return json({ error: "pull request not found" }, 404);

    try {
      return json({ pull_request: pullRequestToJson(repo, closePullRequest(repo, pr, auth.actor ?? "unknown")) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid pull request close" }, 422);
    }
  }

  const externalSourcesMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/external-sources$/);
  if (externalSourcesMatch) {
    const repo = findRepository(decodeURIComponent(externalSourcesMatch[1]), decodeURIComponent(externalSourcesMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ external_sources: listExternalSources(repo).map(externalSourceToJson) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();

      try {
        const body = await request.json() as {
          provider?: string;
          remote_url?: string;
          default_branch?: string;
          credential_ref?: string | null;
          credential_value?: string;
        };
        return json({
          external_source: externalSourceToJson(connectExternalSource(repo, body, auth.actor ?? "unknown"))
        }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid external source" }, 422);
      }
    }
  }

  const externalSourceActionMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/external-sources\/([^/]+)\/(sync|workcells|events)$/);
  if (externalSourceActionMatch) {
    const repo = findRepository(decodeURIComponent(externalSourceActionMatch[1]), decodeURIComponent(externalSourceActionMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const source = findExternalSource(repo, decodeURIComponent(externalSourceActionMatch[3]));
    if (!source) return json({ error: "external source not found" }, 404);

    const action = externalSourceActionMatch[4];

    if (request.method === "POST" && action === "sync") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();
      const result = syncExternalSource(repo, source, auth.actor ?? "unknown");
      return json({
        external_source: externalSourceToJson(result.source),
        event: result.event
      });
    }

    if (request.method === "POST" && action === "workcells") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();
      try {
        const workcell = createExternalWorkcell(repo, source);
        return json({ workcell: externalWorkcellToJson(source, workcell) }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid external workcell" }, 422);
      }
    }

    if (request.method === "GET" && action === "events") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ events: listExternalEvents(repo, source) });
    }
  }

  const externalPullRequestsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/external-sources\/([^/]+)\/pull-requests$/);
  if (externalPullRequestsMatch) {
    const repo = findRepository(decodeURIComponent(externalPullRequestsMatch[1]), decodeURIComponent(externalPullRequestsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const source = findExternalSource(repo, decodeURIComponent(externalPullRequestsMatch[3]));
    if (!source) return json({ error: "external source not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ pull_requests: listExternalPullRequests(repo, source).map(externalPullRequestToJson) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();

      try {
        const body = await request.json() as {
          external_number?: number;
          title?: string;
          body?: string | null;
          base_ref?: string;
          head_ref?: string;
          issue_external_id?: string | null;
          provider_url?: string | null;
        };
        return json({
          pull_request: externalPullRequestToJson(openExternalPullRequest(repo, source, body))
        }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid external pull request" }, 422);
      }
    }
  }

  const externalReceiptMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/external-sources\/([^/]+)\/pull-requests\/([0-9]+)\/receipt$/);
  if (request.method === "POST" && externalReceiptMatch) {
    const repo = findRepository(decodeURIComponent(externalReceiptMatch[1]), decodeURIComponent(externalReceiptMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const source = findExternalSource(repo, decodeURIComponent(externalReceiptMatch[3]));
    if (!source) return json({ error: "external source not found" }, 404);

    const pr = findExternalPullRequest(repo, source, Number.parseInt(externalReceiptMatch[4], 10));
    if (!pr) return json({ error: "external pull request not found" }, 404);

    try {
      const body = await request.json() as { receipt_type?: string; summary?: string | null };
      return json({ receipt: createExternalReceipt(repo, source, pr, body) }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid external receipt" }, 422);
    }
  }

  const importsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/imports$/);
  if (importsMatch) {
    const repo = findRepository(decodeURIComponent(importsMatch[1]), decodeURIComponent(importsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ imports: listImports(repo) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();
      try {
        const body = await request.json() as { provider?: string; source_url?: string; default_branch?: string };
        return json({ import: importFromGitRemote(repo, body, auth.actor ?? "unknown") }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid import" }, 422);
      }
    }
  }

  const exportsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/exports$/);
  if (exportsMatch) {
    const repo = findRepository(decodeURIComponent(exportsMatch[1]), decodeURIComponent(exportsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ exports: listExports(repo) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();
      try {
        const body = await request.json() as { provider?: string; destination_url?: string };
        return json({ export: exportToGitRemote(repo, body, auth.actor ?? "unknown") }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid export" }, 422);
      }
    }
  }

  const remotesMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/remotes$/);
  if (remotesMatch) {
    const repo = findRepository(decodeURIComponent(remotesMatch[1]), decodeURIComponent(remotesMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ remotes: listRepoRemotes(repo) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();
      try {
        const body = await request.json() as { name?: string; provider?: string; remote_url?: string; role?: string };
        return json({ remote: addRepoRemote(repo, body, auth.actor ?? "unknown") }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid remote" }, 422);
      }
    }
  }

  const remoteDeleteMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/remotes\/([^/]+)$/);
  if (request.method === "DELETE" && remoteDeleteMatch) {
    const repo = findRepository(decodeURIComponent(remoteDeleteMatch[1]), decodeURIComponent(remoteDeleteMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();
    try {
      return json({ remote: removeRepoRemote(repo, decodeURIComponent(remoteDeleteMatch[3])) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid remote delete" }, 422);
    }
  }

  const collaboratorsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/collaborators$/);
  if (collaboratorsMatch) {
    const repo = findRepository(decodeURIComponent(collaboratorsMatch[1]), decodeURIComponent(collaboratorsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ collaborators: listCollaborators(repo) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: ["repo:admin", "repo:create"] });
      if (!auth.ok) return unauthorized();
      try {
        const body = await request.json() as { username?: string; role?: string };
        return json(addCollaborator(repo, body), 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid collaborator" }, 422);
      }
    }
  }

  const collaboratorDeleteMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/collaborators\/([^/]+)$/);
  if (request.method === "DELETE" && collaboratorDeleteMatch) {
    const repo = findRepository(decodeURIComponent(collaboratorDeleteMatch[1]), decodeURIComponent(collaboratorDeleteMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: ["repo:admin", "repo:create"] });
    if (!auth.ok) return unauthorized();
    try {
      return json({ collaborator: revokeCollaborator(repo, decodeURIComponent(collaboratorDeleteMatch[3])) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid collaborator revoke" }, 422);
    }
  }

  const collaboratorWorkcellMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/collaborators\/([^/]+)\/workcells$/);
  if (request.method === "POST" && collaboratorWorkcellMatch) {
    const repo = findRepository(decodeURIComponent(collaboratorWorkcellMatch[1]), decodeURIComponent(collaboratorWorkcellMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: ["repo:admin", "repo:create"] });
    if (!auth.ok) return unauthorized();
    try {
      const workcell = createCollaboratorWorkcell(repo, decodeURIComponent(collaboratorWorkcellMatch[3]));
      return json({ workcell: workcellToJson(workcell, repo) }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid collaborator workcell" }, 422);
    }
  }

  const workflowProjectionsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/workflow-projections$/);
  if (workflowProjectionsMatch) {
    const repo = findRepository(decodeURIComponent(workflowProjectionsMatch[1]), decodeURIComponent(workflowProjectionsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ projections: listWorkflowProjections(repo).map((projection) => workflowProjectionToJson(repo, projection)) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: ["repo:admin", "repo:create"] });
      if (!auth.ok) return unauthorized();
      try {
        const body = await request.json() as { provider?: string; remote_url?: string | null };
        const projection = createWorkflowProjection(repo, body, auth.actor ?? "unknown");
        return json({ projection: workflowProjectionToJson(repo, projection) }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid workflow projection" }, 422);
      }
    }
  }

  const workflowProjectionMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/workflow-projections\/([^/]+)$/);
  if (request.method === "GET" && workflowProjectionMatch) {
    const repo = findRepository(decodeURIComponent(workflowProjectionMatch[1]), decodeURIComponent(workflowProjectionMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
    if (!auth.ok) return unauthorized();

    const projection = findWorkflowProjection(repo, decodeURIComponent(workflowProjectionMatch[3]));
    if (!projection) return json({ error: "workflow projection not found" }, 404);
    return json({ projection: workflowProjectionToJson(repo, projection) });
  }

  const workflowProjectionSyncMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/workflow-projections\/([^/]+)\/sync$/);
  if (request.method === "POST" && workflowProjectionSyncMatch) {
    const repo = findRepository(decodeURIComponent(workflowProjectionSyncMatch[1]), decodeURIComponent(workflowProjectionSyncMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const projection = findWorkflowProjection(repo, decodeURIComponent(workflowProjectionSyncMatch[3]));
    if (!projection) return json({ error: "workflow projection not found" }, 404);
    return json(syncWorkflowProjection(repo, projection));
  }

  const workflowProjectionIssueMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/workflow-projections\/([^/]+)\/issues\/([0-9]+)$/);
  if (request.method === "POST" && workflowProjectionIssueMatch) {
    const repo = findRepository(decodeURIComponent(workflowProjectionIssueMatch[1]), decodeURIComponent(workflowProjectionIssueMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const projection = findWorkflowProjection(repo, decodeURIComponent(workflowProjectionIssueMatch[3]));
    if (!projection) return json({ error: "workflow projection not found" }, 404);

    const issue = findIssueByNumber(repo, Number.parseInt(workflowProjectionIssueMatch[4], 10));
    if (!issue) return json({ error: "issue not found" }, 404);

    try {
      const result = projectIssue(repo, projection, issue);
      return json({
        projected_issue: projectedIssueToJson(result.projected_issue),
        created: result.created
      }, result.created ? 201 : 200);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid issue projection" }, 422);
    }
  }

  const workflowProjectionPullRequestMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/workflow-projections\/([^/]+)\/pull-requests\/([0-9]+)$/);
  if (request.method === "POST" && workflowProjectionPullRequestMatch) {
    const repo = findRepository(decodeURIComponent(workflowProjectionPullRequestMatch[1]), decodeURIComponent(workflowProjectionPullRequestMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const projection = findWorkflowProjection(repo, decodeURIComponent(workflowProjectionPullRequestMatch[3]));
    if (!projection) return json({ error: "workflow projection not found" }, 404);

    const pr = findPullRequestByNumber(repo, Number.parseInt(workflowProjectionPullRequestMatch[4], 10));
    if (!pr) return json({ error: "pull request not found" }, 404);

    try {
      const result = projectPullRequest(repo, projection, pr);
      return json({
        projected_pull_request: projectedPullRequestToJson(result.projected_pull_request),
        created: result.created
      }, result.created ? 201 : 200);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid pull request projection" }, 422);
    }
  }

  const workflowProjectionCommentMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/workflow-projections\/([^/]+)\/comments$/);
  if (request.method === "POST" && workflowProjectionCommentMatch) {
    const repo = findRepository(decodeURIComponent(workflowProjectionCommentMatch[1]), decodeURIComponent(workflowProjectionCommentMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const projection = findWorkflowProjection(repo, decodeURIComponent(workflowProjectionCommentMatch[3]));
    if (!projection) return json({ error: "workflow projection not found" }, 404);

    try {
      const body = await request.json() as {
        subject_type?: string;
        subject_number?: number;
        transition?: string;
        summary?: string | null;
      };
      const result = addProjectionComment(repo, projection, body);
      return json(result, result.created ? 201 : 200);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid projection comment" }, 422);
    }
  }

  const workflowProjectionIssueEditMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/workflow-projections\/([^/]+)\/projected-issues\/([0-9]+)\/external-edit$/);
  if (request.method === "POST" && workflowProjectionIssueEditMatch) {
    const repo = findRepository(decodeURIComponent(workflowProjectionIssueEditMatch[1]), decodeURIComponent(workflowProjectionIssueEditMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const projection = findWorkflowProjection(repo, decodeURIComponent(workflowProjectionIssueEditMatch[3]));
    if (!projection) return json({ error: "workflow projection not found" }, 404);

    try {
      const body = await request.json() as { title?: string; body?: string };
      const projected = simulateExternalIssueEdit(repo, projection, Number.parseInt(workflowProjectionIssueEditMatch[4], 10), body);
      return json({ projected_issue: projectedIssueToJson(projected) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid projected issue edit" }, 422);
    }
  }

  const workflowProjectionPullRequestEditMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/workflow-projections\/([^/]+)\/projected-pull-requests\/([0-9]+)\/external-edit$/);
  if (request.method === "POST" && workflowProjectionPullRequestEditMatch) {
    const repo = findRepository(decodeURIComponent(workflowProjectionPullRequestEditMatch[1]), decodeURIComponent(workflowProjectionPullRequestEditMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    const projection = findWorkflowProjection(repo, decodeURIComponent(workflowProjectionPullRequestEditMatch[3]));
    if (!projection) return json({ error: "workflow projection not found" }, 404);

    try {
      const body = await request.json() as { title?: string; body?: string };
      const projected = simulateExternalPullRequestEdit(repo, projection, Number.parseInt(workflowProjectionPullRequestEditMatch[4], 10), body);
      return json({ projected_pull_request: projectedPullRequestToJson(projected) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid projected pull request edit" }, 422);
    }
  }

  const secretsMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/secrets$/);
  if (secretsMatch) {
    const repo = findRepository(decodeURIComponent(secretsMatch[1]), decodeURIComponent(secretsMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    if (request.method === "GET") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
      if (!auth.ok) return unauthorized();
      return json({ secrets: listSecretRefs(repo).map(secretRefToJson) });
    }

    if (request.method === "POST") {
      const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
      if (!auth.ok) return unauthorized();
      try {
        const body = await request.json() as {
          name?: string;
          credential_ref?: string;
          environment?: string;
          value?: string;
          credential_value?: string;
        };
        return json({ secret: secretRefToJson(createSecretRef(repo, body, auth.actor ?? "unknown")) }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid secret ref" }, 422);
      }
    }
  }

  const secretRevokeMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/secrets\/([^/]+)\/revoke$/);
  if (request.method === "POST" && secretRevokeMatch) {
    const repo = findRepository(decodeURIComponent(secretRevokeMatch[1]), decodeURIComponent(secretRevokeMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:write" });
    if (!auth.ok) return unauthorized();

    try {
      return json({ secret: secretRefToJson(revokeSecretRef(repo, decodeURIComponent(secretRevokeMatch[3]), auth.actor ?? "unknown")) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid secret revoke" }, 422);
    }
  }

  const supportMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)\/support-debug$/);
  if (request.method === "GET" && supportMatch) {
    const repo = findRepository(decodeURIComponent(supportMatch[1]), decodeURIComponent(supportMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
    if (!auth.ok) return unauthorized();
    return json({ support: supportBundle(repo) });
  }

  const repoMatch = url.pathname.match(/^\/bittergit\/v1\/repos\/([^/]+)\/([^/]+)$/);
  if (request.method === "GET" && repoMatch) {
    const repo = findRepository(decodeURIComponent(repoMatch[1]), decodeURIComponent(repoMatch[2]));
    if (!repo) return json({ error: "repo not found" }, 404);

    const auth = authenticate(request, { repoId: repo.id, require: "repo:read" });
    if (!auth.ok) return unauthorized();

    return json(repoToJson(repo));
  }

  const gitMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/);
  if (gitMatch) {
    return handleGitRoute(request, gitMatch);
  }

  return json({ error: "not found" }, 404);
}

async function handleGitRoute(request: Request, match: RegExpMatchArray): Promise<Response> {
  const owner = validateSlug(decodeURIComponent(match[1]), "owner");
  const name = validateSlug(decodeURIComponent(match[2]), "name");
  const suffix = match[3];
  const repo = findRepository(owner, name);

  if (!repo) return json({ error: "repo not found" }, 404);

  const url = new URL(request.url);
  const service = url.searchParams.get("service");
  const isReceivePack = suffix === "git-receive-pack" || service === "git-receive-pack";
  const auth = authenticate(request, {
    repoId: repo.id,
    require: isReceivePack ? "repo:write" : "repo:read"
  });

  if (!auth.ok) {
    return unauthorized(isReceivePack ? "write token required" : "git token required");
  }

  return runGitHttpBackend({
    request,
    repo,
    suffix,
    actor: auth.actor,
    scopes: auth.scopes
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" }
  });
}
