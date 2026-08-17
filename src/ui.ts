import { randomUUID } from "node:crypto";
import { createRepository, findRepository, listRepositories, repoToJson, validateSlug, type Repository } from "./repos";
import { createWorkcell, workcellToJson } from "./workcells";
import { findCheckpoint, listCheckpoints, restoreCheckpoint } from "./checkpoints";
import { listDeployments, listReceipts } from "./deployments";
import { issueToJson, listIssues } from "./issues";
import { listPullRequests, pullRequestToJson } from "./pull-requests";
import { listMirrorTargets, mirrorToJson } from "./mirrors";
import { listExternalSources, externalSourceToJson } from "./external-sources";
import { listExports, listImports, listRepoRemotes } from "./import-export";
import { findSetupStateForRepo, setupStateToJson } from "./app-bundles";
import { parseAccountAssertion, signIssuerAssertion, type AccountAssertion } from "./assertions";
import { createAppBundle } from "./app-bundles";
import {
  artifactImportIntakeToJson,
  createArtifactImportReview,
  findArtifactImportIntake
} from "./artifact-imports";
import { createArtifactImportAppBundle } from "./artifact-app-bundles";
import {
  createHostedWorkcellSession,
  findHostedWorkcellSession,
  hostedWorkcellSessionToJson
} from "./hosted-sessions";

export async function handleUiRoute(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return html(homePage());
  }

  if (request.method === "POST" && url.pathname === "/onboarding/blank-app") {
    const form = await request.formData();
    const assertion = demoAssertionFromForm(form);
    const result = createAppBundle(assertion, {
      name: String(form.get("name") ?? ""),
      display_name: stringOrNull(form.get("display_name"))
    });
    const hosted = await createHostedWorkcellSession(assertion, result.app.id);
    return redirect(`/apps/${escapeUrl(result.repo.owner)}/${escapeUrl(result.repo.name)}?created=1&path=blank&account_ref=${escapeUrl(assertion.account_ref)}&app_id=${escapeUrl(result.app.id)}&session_id=${escapeUrl(hosted.session.id)}`);
  }

  if (request.method === "POST" && url.pathname === "/onboarding/artifact-imports/review") {
    const form = await request.formData();
    const assertion = demoAssertionFromForm(form);
    const intake = createArtifactImportReview(assertion, {
      source_kind: String(form.get("source_kind") ?? ""),
      source_path: String(form.get("source_path") ?? "")
    });
    const accountRef = encodeURIComponent(assertion.account_ref);
    const appName = encodeURIComponent(String(form.get("name") ?? ""));
    return redirect(`/onboarding/artifact-imports/${encodeURIComponent(intake.id)}?account_ref=${accountRef}&name=${appName}`);
  }

  const onboardingImportMatch = url.pathname.match(/^\/onboarding\/artifact-imports\/([^/]+)$/);
  if (request.method === "GET" && onboardingImportMatch) {
    const assertion = demoAssertionFromQuery(url.searchParams);
    const intake = findArtifactImportIntake(assertion, decodeURIComponent(onboardingImportMatch[1]));
    if (!intake) return html(errorPage("artifact import not found"), 404);
    return html(importReviewPage(assertion, intake, url.searchParams));
  }

  const onboardingImportBundleMatch = url.pathname.match(/^\/onboarding\/artifact-imports\/([^/]+)\/app-bundle$/);
  if (request.method === "POST" && onboardingImportBundleMatch) {
    const form = await request.formData();
    const assertion = demoAssertionFromForm(form);
    const intake = findArtifactImportIntake(assertion, decodeURIComponent(onboardingImportBundleMatch[1]));
    if (!intake) return html(errorPage("artifact import not found"), 404);
    const result = createArtifactImportAppBundle(assertion, intake, {
      name: String(form.get("name") ?? ""),
      display_name: stringOrNull(form.get("display_name"))
    });
    const hosted = await createHostedWorkcellSession(assertion, result.app.id);
    return redirect(`/apps/${escapeUrl(result.repo.owner)}/${escapeUrl(result.repo.name)}?created=1&path=artifact&account_ref=${escapeUrl(assertion.account_ref)}&app_id=${escapeUrl(result.app.id)}&session_id=${escapeUrl(hosted.session.id)}`);
  }

  if (request.method === "POST" && url.pathname === "/apps") {
    const form = await request.formData();
    const owner = validateSlug(String(form.get("owner") ?? ""), "owner");
    const name = validateSlug(String(form.get("name") ?? ""), "name");
    createRepository(owner, name);
    return redirect(`/apps/${encodeURIComponent(owner)}/${encodeURIComponent(name)}?created=1`);
  }

  const workcellMatch = url.pathname.match(/^\/apps\/([^/]+)\/([^/]+)\/workcells$/);
  if (request.method === "POST" && workcellMatch) {
    const repo = findUiRepo(workcellMatch);
    const workcell = createWorkcell(repo);
    return redirect(`/apps/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}?workcell=${encodeURIComponent(workcell.id)}`);
  }

  const restoreMatch = url.pathname.match(/^\/apps\/([^/]+)\/([^/]+)\/checkpoints\/([^/]+)\/restore$/);
  if (request.method === "POST" && restoreMatch) {
    const repo = findUiRepo(restoreMatch);
    const checkpoint = findCheckpoint(repo, decodeURIComponent(restoreMatch[3]));
    if (!checkpoint) return html(errorPage("checkpoint not found"), 404);
    restoreCheckpoint(repo, checkpoint, "ui");
    return redirect(`/apps/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}?restored=${encodeURIComponent(checkpoint.id)}`);
  }

  const appMatch = url.pathname.match(/^\/apps\/([^/]+)\/([^/]+)$/);
  if (request.method === "GET" && appMatch) {
    const repo = findUiRepo(appMatch);
    return html(appPage(repo, url.searchParams));
  }

  return undefined;
}

function homePage(): string {
  const repos = listRepositories();
  return layout("BitterGit", `
    <header class="topbar">
      <div>
        <p class="eyebrow">BitterGit</p>
        <h1>Create your app backstage</h1>
        <p class="lede">Start blank or bring in a folder/zip artifact. BitterGit creates the source repo automatically. No GitHub required.</p>
      </div>
    </header>
    <main class="shell">
      <section class="band">
        <div class="section-head">
          <div>
            <h2>Choose how to begin</h2>
            <p class="muted">One active app is included. Create source, save history, open the hosted terminal, then charter the app before building.</p>
          </div>
          <span class="badge">GitHub optional</span>
        </div>
        <div class="plan-strip">
          <span>One-app plan active</span>
          <span>Continue with Bitter account</span>
          <span>github_required=false</span>
        </div>
        <div class="choices">
          <form class="choice" method="post" action="/onboarding/blank-app">
            <h3>Start blank</h3>
            <p class="muted">Creates only <code>AGENTS.md</code>, <code>APP.md</code>, and <code>.gitignore</code> so the first run can establish the charter.</p>
            <label>Account ref <input name="account_ref" value="acct-ui-${Date.now()}" required /></label>
            <label>App name <input name="name" placeholder="my-app" required /></label>
            <button type="submit">Create blank app</button>
          </form>
          <form class="choice" method="post" action="/onboarding/artifact-imports/review">
            <h3>Import folder or zip</h3>
            <p class="muted">Scans first, shows what will import, skips junk, and blocks secrets before source is committed.</p>
            <label>Account ref <input name="account_ref" value="acct-ui-${Date.now() + 1}" required /></label>
            <label>App name <input name="name" placeholder="imported-app" required /></label>
            <label>Artifact type
              <select name="source_kind">
                <option value="folder">Folder</option>
                <option value="zip">Zip file</option>
              </select>
            </label>
            <label>Local path <input name="source_path" placeholder="/path/to/artifact" required /></label>
            <button type="submit">Review import</button>
          </form>
          <div class="choice secondary-choice">
            <h3>Import Git repo</h3>
            <p class="muted">Advanced path for existing repos. Use it later from app settings when a Git remote should remain part of the workflow.</p>
            <a class="button secondary" href="#advanced">View advanced source options</a>
          </div>
        </div>
      </section>
      <section class="band" id="advanced">
        <h2>Advanced source options</h2>
        <p class="muted">Developer path for direct Git remote setup. New users can ignore this until they want to connect an existing repository.</p>
        <form class="form-row" method="post" action="/apps">
          <label>Owner <input name="owner" value="test" required /></label>
          <label>App <input name="name" placeholder="my-app" required /></label>
          <button type="submit" class="secondary">Create raw repo</button>
        </form>
      </section>
      <section class="band">
        <h2>Apps</h2>
        <div class="list">${repos.map((repo) => `
          <a class="row" href="/apps/${escapeAttr(repo.owner)}/${escapeAttr(repo.name)}">
            <span>${escapeHtml(repo.owner)}/${escapeHtml(repo.name)}</span>
            <code>${escapeHtml(repo.id)}</code>
          </a>
        `).join("") || `<p class="muted">No apps yet.</p>`}</div>
      </section>
    </main>
  `);
}

function importReviewPage(assertion: AccountAssertion, intake: ReturnType<typeof findArtifactImportIntake>, params: URLSearchParams): string {
  if (!intake) return errorPage("artifact import not found");
  const review = artifactImportIntakeToJson(intake);
  const plan = review.plan as Record<string, Array<Record<string, unknown>>>;
  const summary = review.summary as Record<string, unknown>;
  const appName = params.get("name") ?? "imported-app";
  const ready = review.status === "ready";
  return layout("Review import", `
    <header class="topbar">
      <div>
        <p class="eyebrow">Import Review</p>
        <h1>${ready ? "Ready to create app" : "Needs attention"}</h1>
        <p class="lede">BitterGit scanned the artifact before committing source. No GitHub required.</p>
      </div>
      <a class="button secondary" href="/">Back</a>
    </header>
    <main class="shell">
      <section class="band">
        <div class="section-head">
          <div>
            <h2>${escapeHtml(String(review.source_label))}</h2>
            <p class="muted">Detected shape: ${escapeHtml(String(review.detected_shape))}</p>
          </div>
          <span class="badge">${ready ? "Ready" : "Blocked"}</span>
        </div>
        <dl class="facts">
          <div><dt>Will import</dt><dd>${escapeHtml(String(summary.import_count))} files</dd></div>
          <div><dt>Will skip</dt><dd>${escapeHtml(String(summary.skip_count))} files</dd></div>
          <div><dt>Blocked</dt><dd>${escapeHtml(String(summary.blocked_count))} files</dd></div>
          <div><dt>Repair action</dt><dd>${ready ? "Create the app bundle." : "Remove or replace blocked files, then review the import again."}</dd></div>
        </dl>
        ${ready ? `
          <form class="form-row top-gap" method="post" action="/onboarding/artifact-imports/${escapeAttr(String(review.id))}/app-bundle">
            <input type="hidden" name="account_ref" value="${escapeAttr(assertion.account_ref)}" />
            <label>App name <input name="name" value="${escapeAttr(appName)}" required /></label>
            <button type="submit">Create app from import</button>
          </form>
        ` : `<p class="notice">Blocked files will not be committed. Fix the artifact and run review again.</p>`}
      </section>
      <section class="band">
        <h2>Will import</h2>
        ${reviewRows(plan.will_import)}
      </section>
      <section class="band">
        <h2>Will skip</h2>
        ${reviewRows(plan.will_skip)}
      </section>
      <section class="band">
        <h2>Blocked or needs attention</h2>
        ${reviewRows(plan.blocked)}
      </section>
    </main>
  `);
}

function appPage(repo: Repository, params: URLSearchParams): string {
  const repoJson = repoToJson(repo);
  const checkpoints = listCheckpoints(repo);
  const deployments = listDeployments(repo);
  const receipts = listReceipts(repo) as Array<Record<string, unknown>>;
  const issues = listIssues(repo).map((issue) => issueToJson(repo, issue));
  const pullRequests = listPullRequests(repo).map((pr) => pullRequestToJson(repo, pr));
  const mirrors = listMirrorTargets(repo).map(mirrorToJson);
  const externalSources = listExternalSources(repo).map(externalSourceToJson);
  const imports = listImports(repo);
  const exports = listExports(repo);
  const remotes = listRepoRemotes(repo);
  const setupState = findSetupStateForRepo(repo);
  const setupJson = setupState ? setupStateToJson(setupState) : null;
  const hostedSession = params.get("session_id") ? findHostedWorkcellSession(params.get("session_id") as string) : undefined;
  const hostedSessionJson = hostedSession ? hostedWorkcellSessionToJson(hostedSession) : null;
  const notice = params.get("workcell")
    ? `Workcell ${params.get("workcell")} created.`
    : params.get("restored")
      ? `Restored checkpoint ${params.get("restored")}.`
      : params.get("created")
        ? "App created."
        : "";

  return layout(`${repo.owner}/${repo.name}`, `
    <header class="topbar">
      <div>
        <p class="eyebrow">App</p>
        <h1>${escapeHtml(repo.owner)}/${escapeHtml(repo.name)}</h1>
      </div>
      <a class="button secondary" href="/">All apps</a>
    </header>
    <nav class="tabs">
      ${["Backstage", "Issues", "Pull Requests", "History", "Deploys", "Secrets", "Settings"].map((item) => `
        <a href="#${slug(item)}">${escapeHtml(item)}</a>
      `).join("")}
    </nav>
    <main class="shell">
      ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
      <section class="band" id="backstage">
        <div class="section-head">
          <h2>Backstage</h2>
          <form method="post" action="/apps/${escapeAttr(repo.owner)}/${escapeAttr(repo.name)}/workcells">
            <button type="submit">Open workcell</button>
          </form>
        </div>
        ${hostedSessionJson ? terminalReadiness(hostedSessionJson) : ""}
        <dl class="facts">
          ${setupJson ? `
            <div><dt>Setup</dt><dd>${escapeHtml(String(setupJson.status))}</dd></div>
            <div><dt>Progress</dt><dd>${escapeHtml(String(setupJson.progress_percent))}%</dd></div>
            <div><dt>First task</dt><dd>Establish the app charter in <code>APP.md</code></dd></div>
          ` : ""}
          <div><dt>Clone URL</dt><dd><code>${escapeHtml(String(repoJson.clone_url))}</code></dd></div>
          <div><dt>Storage</dt><dd>${escapeHtml(String(repoJson.storage_state))}</dd></div>
          <div><dt>Source truth</dt><dd>BitterGit primary</dd></div>
          <div><dt>GitHub</dt><dd>Optional later through import, export, or mirror settings</dd></div>
        </dl>
        ${setupJson ? setupProgress(setupJson) : ""}
      </section>
      <section class="band" id="issues">
        <h2>Issues</h2>
        ${issues.length ? rows(issues.map((issue) => [
          `#${issue.number}`,
          String(issue.title),
          String(issue.status),
          `${(issue.links as unknown[]).length} links`
        ])) : empty("No issues.")}
      </section>
      <section class="band" id="pull-requests">
        <h2>Pull Requests</h2>
        ${pullRequests.length ? rows(pullRequests.map((pr) => [
          `#${pr.number}`,
          String(pr.title),
          String(pr.status),
          `${pr.base_ref} <- ${pr.head_ref}`
        ])) : empty("No pull requests.")}
      </section>
      <section class="band" id="history">
        <h2>History</h2>
        ${checkpoints.length ? `<div class="list">${checkpoints.map((checkpoint) => `
          <div class="row">
            <span>${escapeHtml(checkpoint.label)}</span>
            <code>${escapeHtml(checkpoint.commit_sha.slice(0, 12))}</code>
            <form method="post" action="/apps/${escapeAttr(repo.owner)}/${escapeAttr(repo.name)}/checkpoints/${escapeAttr(checkpoint.id)}/restore">
              <button type="submit" class="secondary">Restore</button>
            </form>
          </div>
        `).join("")}</div>` : empty("No checkpoints.")}
      </section>
      <section class="band" id="deploys">
        <h2>Deploys</h2>
        ${deployments.length ? rows(deployments.map((deployment) => [
          deployment.id,
          deployment.environment,
          deployment.status,
          deployment.commit_sha.slice(0, 12)
        ])) : empty("No deploys.")}
        <h3>Receipts</h3>
        ${receipts.length ? rows(receipts.map((receipt) => [
          String(receipt.id),
          String(receipt.receipt_type),
          String(receipt.deployment_id ?? "source"),
          truncate(JSON.stringify(receipt.body), 80)
        ])) : empty("No receipts.")}
      </section>
      <section class="band" id="secrets">
        <h2>Secrets</h2>
        <div class="row">
          <span>Credential refs</span>
          <code>No secret values stored in source custody.</code>
        </div>
      </section>
      <section class="band" id="settings">
        <h2>Settings</h2>
        <dl class="facts">
          <div><dt>Clone</dt><dd><code>${escapeHtml(String(repoJson.clone_url))}</code></dd></div>
          <div><dt>Import Source</dt><dd>${imports.length} imports recorded</dd></div>
          <div><dt>Export Source</dt><dd>${exports.length} exports recorded</dd></div>
          <div><dt>Mirrors</dt><dd>${mirrors.length} mirror targets</dd></div>
          <div><dt>External Sources</dt><dd>${externalSources.length} external sources</dd></div>
          <div><dt>Remotes</dt><dd>${remotes.length} configured remotes</dd></div>
        </dl>
      </section>
    </main>
  `);
}

function setupProgress(setup: Record<string, unknown>): string {
  const steps = Array.isArray(setup.steps) ? setup.steps as Array<Record<string, unknown>> : [];
  const events = Array.isArray(setup.events) ? setup.events as Array<Record<string, unknown>> : [];
  return `
    <div class="subpanel">
      <h3>Setup progress</h3>
      <p class="muted">${escapeHtml(String(setup.user_message ?? ""))}</p>
      <div class="list">${steps.map((entry) => `
        <div class="row">
          <span>${escapeHtml(String(entry.name ?? ""))}</span>
          <code>${escapeHtml(String(entry.status ?? ""))}</code>
        </div>
      `).join("")}</div>
      <h3>Setup events</h3>
      <div class="list">${events.map((event) => `
        <div class="row">
          <span>${escapeHtml(String(event.step ?? ""))}</span>
          <code>${escapeHtml(String(event.status ?? ""))}</code>
          <span>${escapeHtml(String(event.message ?? ""))}</span>
        </div>
      `).join("") || `<p class="muted">No setup events recorded.</p>`}</div>
      <p class="muted">Repair action: ${escapeHtml(String(setup.repair_action ?? ""))}</p>
    </div>
  `;
}

function terminalReadiness(session: Record<string, unknown>): string {
  const readiness = session.readiness as Record<string, unknown> | undefined;
  const terminalUrl = String(session.terminal_url ?? "");
  return `
    <div class="ready-panel">
      <div>
        <h3>Hosted terminal is ready</h3>
        <p class="muted">Source is saved in BitterGit. GitHub is optional. Start by chartering the app in <code>APP.md</code>.</p>
      </div>
      ${terminalUrl ? `<a class="button" href="${escapeHtml(terminalUrl)}">Open hosted terminal</a>` : ""}
    </div>
    <dl class="facts">
      <div><dt>Terminal</dt><dd>${escapeHtml(String(session.terminal_status ?? "ready"))}</dd></div>
      <div><dt>Source saved</dt><dd>${escapeHtml(String(readiness?.source_saved ?? true))}</dd></div>
      <div><dt>GitHub optional</dt><dd>${escapeHtml(String(readiness?.github_optional ?? true))}</dd></div>
      <div><dt>First task</dt><dd>Charter the app in <code>APP.md</code> before substantial implementation.</dd></div>
    </dl>
  `;
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink: #171717; --muted: #666; --line: #d7d7d7; --soft: #f7f7f5; --accent: #0f6b5f; --warn: #8a4b0f; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #fcfcfb; }
    .topbar { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 28px 32px 18px; border-bottom: 1px solid var(--line); background: #fff; }
    .eyebrow { margin: 0 0 4px; color: var(--accent); font-weight: 700; font-size: 13px; }
    .lede { max-width: 760px; margin: 10px 0 0; color: var(--muted); font-size: 16px; line-height: 1.45; }
    h1 { margin: 0; font-size: 28px; line-height: 1.15; }
    h2 { margin: 0 0 14px; font-size: 19px; }
    h3 { margin: 22px 0 10px; font-size: 15px; }
    .shell { width: min(1120px, calc(100vw - 32px)); margin: 22px auto 48px; display: grid; gap: 16px; }
    .tabs { display: flex; gap: 4px; padding: 10px 32px; border-bottom: 1px solid var(--line); background: #fff; overflow-x: auto; }
    .tabs a { color: var(--ink); text-decoration: none; padding: 8px 10px; border-radius: 6px; white-space: nowrap; }
    .tabs a:hover { background: var(--soft); }
    .band { padding: 18px; border: 1px solid var(--line); background: #fff; border-radius: 8px; }
    .subpanel { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
    .section-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
    .choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 16px; }
    .plan-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .plan-strip span { border: 1px solid var(--line); background: var(--soft); border-radius: 999px; padding: 6px 9px; font-size: 13px; }
    .choice { display: grid; align-content: start; gap: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
    .choice h3 { margin: 0; }
    .secondary-choice { background: var(--soft); }
    .badge { display: inline-flex; align-items: center; border: 1px solid #b8d8d1; background: #edf8f5; color: #0f5f55; border-radius: 999px; padding: 5px 9px; font-size: 13px; font-weight: 700; white-space: nowrap; }
    .form-row { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
    .top-gap { margin-top: 14px; }
    label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
    input, select { min-width: 220px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 6px; font: inherit; color: var(--ink); background: #fff; }
    button, .button { border: 0; border-radius: 6px; padding: 9px 12px; background: var(--accent); color: #fff; font: inherit; text-decoration: none; cursor: pointer; }
    button.secondary, .button.secondary { background: var(--soft); color: var(--ink); border: 1px solid var(--line); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; overflow-wrap: anywhere; }
    .list { display: grid; gap: 8px; }
    .row { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(120px, 1fr) minmax(90px, auto) minmax(90px, auto); align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); color: var(--ink); text-decoration: none; }
    .row:first-child { border-top: 0; }
    .facts { display: grid; gap: 10px; margin: 0; }
    .facts div { display: grid; grid-template-columns: 140px 1fr; gap: 12px; padding: 8px 0; border-top: 1px solid var(--line); }
    .facts div:first-child { border-top: 0; }
    dt { color: var(--muted); }
    dd { margin: 0; }
    .muted { color: var(--muted); margin: 0; }
    .notice { margin: 0; padding: 10px 12px; border: 1px solid #d6bd8a; background: #fff8e8; border-radius: 6px; color: var(--warn); }
    .ready-panel { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 14px; border: 1px solid #b8d8d1; border-radius: 8px; background: #f0faf7; margin: 12px 0; }
    .ready-panel h3 { margin: 0 0 6px; }
    @media (max-width: 760px) {
      .topbar { padding: 22px 16px 14px; align-items: flex-start; }
      .tabs { padding: 8px 16px; }
      .choices { grid-template-columns: 1fr; }
      .row { grid-template-columns: 1fr; }
      .ready-panel { align-items: flex-start; flex-direction: column; }
      .facts div { grid-template-columns: 1fr; }
      input, select { min-width: min(260px, calc(100vw - 64px)); }
    }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function rows(values: Array<Array<string>>): string {
  return `<div class="list">${values.map((row) => `
    <div class="row">${row.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>
  `).join("")}</div>`;
}

function reviewRows(values: Array<Record<string, unknown>> | undefined): string {
  if (!values || values.length === 0) return empty("None.");
  return `<div class="list">${values.map((entry) => `
    <div class="row">
      <span>${escapeHtml(String(entry.path ?? ""))}</span>
      <code>${escapeHtml(String(entry.reason ?? ""))}</code>
      <span>${escapeHtml(String(entry.family ?? ""))}</span>
      <span>${escapeHtml(String(entry.size_bytes ?? 0))} bytes</span>
    </div>
  `).join("")}</div>`;
}

function empty(value: string): string {
  return `<p class="muted">${escapeHtml(value)}</p>`;
}

function errorPage(message: string): string {
  return layout("BitterGit Error", `<main class="shell"><section class="band"><h1>Error</h1><p>${escapeHtml(message)}</p></section></main>`);
}

function findUiRepo(match: RegExpMatchArray): Repository {
  const owner = validateSlug(decodeURIComponent(match[1]), "owner");
  const name = validateSlug(decodeURIComponent(match[2]), "name");
  const repo = findRepository(owner, name);
  if (!repo) throw new Error("repo not found");
  return repo;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function redirect(location: string): Response {
  return new Response("", {
    status: 303,
    headers: { location }
  });
}

function demoAssertionFromForm(form: FormData): AccountAssertion {
  return demoAssertion(String(form.get("account_ref") ?? ""));
}

function demoAssertionFromQuery(params: URLSearchParams): AccountAssertion {
  return demoAssertion(params.get("account_ref") ?? "");
}

function demoAssertion(accountRefInput: string): AccountAssertion {
  const accountRef = validateSlug(accountRefInput || `acct-ui-${Date.now()}`, "account_ref");
  const payload = {
    iss: "bitterhub.local",
    aud: "bittergit",
    sub: `account:${accountRef}`,
    jti: `ui-${accountRef}-${randomUUID()}`,
    kid: "hub-dev-key-1",
    authority_kind: "account_plan_assertion",
    account_ref: accountRef,
    workspace_ref: `wrk-${accountRef}`,
    plan_key: "one_app",
    plan_status: "active",
    included_apps: 1,
    github_required: false,
    secret_material_returned: false,
    source: "local_onboarding_ui",
    asserted_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    hosted_workcell_limit: 1,
    monthly_hosted_run_limit: 100,
    storage_limit_mb: 512,
    mirror_export_allowed: true
  };
  const token = signIssuerAssertion(payload);
  return parseAccountAssertion(new Request("http://bittergit.local/ui", {
    headers: { "x-bitter-account-assertion": token }
  }));
}

function stringOrNull(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(" ", "-");
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 3)}...`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
  return encodeURIComponent(value);
}

function escapeUrl(value: string): string {
  return encodeURIComponent(value);
}
