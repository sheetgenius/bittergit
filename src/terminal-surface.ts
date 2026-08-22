import { cloneUrl } from "./config";
import { findRepositoryById } from "./repos";
import { findHostedWorkcellSession, type HostedWorkcellSession } from "./hosted-sessions";
import { listAgentReadinessChecks, readinessCheckToJson, readinessSummary } from "./agent-readiness";
import { productionSshFromJson, productionSshSupportJson } from "./production-ssh";
import { gridTerminalFulfillmentFromJson, gridTerminalFulfillmentSupportJson } from "./grid-terminal";

export function findTerminalSession(sessionId: string): HostedWorkcellSession | undefined {
  return findHostedWorkcellSession(sessionId);
}

export function terminalPage(session: HostedWorkcellSession): Response {
  const repo = findRepositoryById(session.repo_id);
  const remote = repo ? cloneUrl(repo.owner, repo.name) : "unknown";
  const readiness = readinessSummary(session.id);
  const checks = listAgentReadinessChecks(session.id).map(readinessCheckToJson);
  const productionSsh = productionSshSupportJson(productionSshFromJson(session.production_ssh_json), session.status);
  const terminalFulfillment = gridTerminalFulfillmentSupportJson(gridTerminalFulfillmentFromJson(session.terminal_fulfillment_json, {
    id: session.terminal_fulfillment_id ?? `grid_terminal_${session.id}`,
    provider: session.terminal_provider,
    route: session.terminal_route ?? `/terminals/${encodeURIComponent(session.id)}`,
    url: session.terminal_url,
    status: session.terminal_status,
    lifecycle: session.terminal_lifecycle ?? "fulfilled_local_contract",
    source_root: session.source_root,
    app_id: session.app_id,
    repo_id: session.repo_id,
    account_ref: session.account_ref
  }));
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BitterGit Terminal</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #181818; background: #fbfbfa; }
    main { width: min(920px, calc(100vw - 32px)); margin: 32px auto; display: grid; gap: 16px; }
    section { background: #fff; border: 1px solid #d8d8d4; border-radius: 8px; padding: 18px; }
    h1 { margin: 0; font-size: 24px; }
    h2 { margin: 0 0 10px; font-size: 17px; }
    p { margin: 0; color: #555; }
    dl { display: grid; gap: 8px; margin: 0; }
    div { display: grid; grid-template-columns: 150px 1fr; gap: 12px; padding-top: 8px; border-top: 1px solid #e4e4e0; }
    div:first-child { border-top: 0; padding-top: 0; }
    dt { color: #666; }
    dd { margin: 0; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    pre { margin: 0; white-space: pre-wrap; background: #f5f5f2; border: 1px solid #dfdfda; border-radius: 6px; padding: 12px; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Terminal ready</h1>
      <p>Source is saved in BitterGit. GitHub is optional. First task: establish the app charter in APP.md and record charter sufficiency before implementation.</p>
    </section>
    <section>
      <h2>Session</h2>
      <dl>
        <div><dt>Status</dt><dd>${escapeHtml(session.status)}</dd></div>
        <div><dt>Terminal provider</dt><dd>${escapeHtml(session.terminal_provider)}</dd></div>
        <div><dt>Terminal status</dt><dd>${escapeHtml(session.terminal_status)}</dd></div>
        <div><dt>Terminal route configured</dt><dd>${escapeHtml(String(terminalFulfillment.route_configured))}</dd></div>
        <div><dt>Terminal lifecycle</dt><dd>${escapeHtml(session.terminal_lifecycle ?? "")}</dd></div>
        <div><dt>Terminal mode</dt><dd>${escapeHtml(String(terminalFulfillment.mode ?? "local_adapter"))}</dd></div>
        <div><dt>Origin</dt><dd><code>${escapeHtml(remote)}</code></dd></div>
      </dl>
    </section>
    <section>
      <h2>Production SSH</h2>
      <dl>
        <div><dt>Mode</dt><dd>${escapeHtml(String(productionSsh.mode))}</dd></div>
        <div><dt>Read-only diagnostics</dt><dd>${escapeHtml(String(productionSsh.read_only_diagnostics_enabled))}</dd></div>
        <div><dt>Write/operate</dt><dd>${escapeHtml(String(productionSsh.write_enabled))}</dd></div>
        <div><dt>Target configured</dt><dd>${escapeHtml(String(productionSsh.target_configured))}</dd></div>
        <div><dt>Owner plane</dt><dd>${escapeHtml(String(productionSsh.owner_plane))}</dd></div>
      </dl>
      <p>Use production SSH only for live diagnostics or explicit break-glass work. Write/operate commands require explicit session enablement.</p>
    </section>
    <section>
      <h2>Suggested first prompt</h2>
      <pre>Read AGENTS.md and APP.md. Work with the user to establish the app charter, including axes of excellence and verification gates, before starting substantial implementation.</pre>
    </section>
    <section>
      <h2>Agent readiness</h2>
      <p>Status: ${escapeHtml(String(readiness.status))}</p>
      <dl>
        ${checks.map((check) => `
          <div><dt>${escapeHtml(String(check.check_name))}</dt><dd>${escapeHtml(String(check.status))}: ${escapeHtml(String(check.message))}</dd></div>
        `).join("")}
      </dl>
    </section>
  </main>
</body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char] as string));
}
