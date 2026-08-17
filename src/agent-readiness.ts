import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cloneUrl } from "./config";
import { ensureStorage } from "./storage";
import type { Repository } from "./repos";

export type AgentReadinessCheck = {
  id: string;
  session_id: string;
  app_id: string;
  repo_id: string;
  check_name: string;
  status: string;
  required: number;
  message: string;
  created_at: string;
};

export type ReadinessSessionInput = {
  id: string;
  app_id: string;
  repo_id: string;
  source_root: string;
};

export function recordAgentReadinessChecks(session: ReadinessSessionInput, repo: Repository): AgentReadinessCheck[] {
  ensureStorage().query("DELETE FROM agent_readiness_checks WHERE session_id = ?").run(session.id);
  const checks = buildChecks(session, repo);
  const insert = ensureStorage().query(`
    INSERT INTO agent_readiness_checks
      (id, session_id, app_id, repo_id, check_name, status, required, message, created_at)
    VALUES
      ($id, $session_id, $app_id, $repo_id, $check_name, $status, $required, $message, $created_at)
  `);

  for (const check of checks) {
    insert.run({
      $id: check.id,
      $session_id: check.session_id,
      $app_id: check.app_id,
      $repo_id: check.repo_id,
      $check_name: check.check_name,
      $status: check.status,
      $required: check.required,
      $message: check.message,
      $created_at: check.created_at
    });
  }

  return listAgentReadinessChecks(session.id);
}

export function listAgentReadinessChecks(sessionId: string): AgentReadinessCheck[] {
  return ensureStorage().query<AgentReadinessCheck, [string]>(`
    SELECT id, session_id, app_id, repo_id, check_name, status, required, message, created_at
    FROM agent_readiness_checks
    WHERE session_id = ?
    ORDER BY created_at ASC, check_name ASC
  `).all(sessionId);
}

export function readinessSummary(sessionId: string): Record<string, unknown> {
  const checks = listAgentReadinessChecks(sessionId);
  const required = checks.filter((check) => check.required === 1);
  const failedRequired = required.filter((check) => check.status !== "passed");
  return {
    status: failedRequired.length === 0 ? "ready" : "blocked",
    required_passed: failedRequired.length === 0,
    required_count: required.length,
    failed_required_count: failedRequired.length,
    check_count: checks.length
  };
}

export function readinessCheckToJson(check: AgentReadinessCheck): Record<string, unknown> {
  return {
    check_name: check.check_name,
    status: check.status,
    required: check.required === 1,
    message: check.message,
    created_at: check.created_at
  };
}

function buildChecks(session: ReadinessSessionInput, repo: Repository): AgentReadinessCheck[] {
  const now = new Date().toISOString();
  const expectedOrigin = cloneUrl(repo.owner, repo.name);
  const sourceRoot = session.source_root;
  const origin = gitOutput(sourceRoot, ["remote", "get-url", "origin"]);
  const status = gitOutput(sourceRoot, ["status", "--porcelain"]);
  const credentialHelper = gitOutput(sourceRoot, ["config", "--get", "credential.helper"]);

  return [
    check(session, "source_root_exists", existsSync(join(sourceRoot, ".git")), true, "Source root is a Git checkout.", now),
    check(session, "origin_is_bittergit", origin.trim() === expectedOrigin, true, "origin points at the BitterGit remote.", now),
    check(session, "origin_has_no_token", !origin.includes("bgt_") && !origin.includes("@"), true, "origin does not embed credential material.", now),
    check(session, "agents_file_present", existsSync(join(sourceRoot, "AGENTS.md")), true, "AGENTS.md is present.", now),
    check(session, "app_charter_present", existsSync(join(sourceRoot, "APP.md")), true, "APP.md is present.", now),
    check(session, "credential_helper_configured", credentialHelper.trim().length > 0, true, "Git credential helper is configured.", now),
    check(session, "git_status_clean", status.trim().length === 0, true, "Working tree is clean.", now),
    optionalCommand(session, "codex_cli_detected", "codex", now),
    optionalCommand(session, "claude_cli_detected", "claude", now)
  ];
}

function check(
  session: ReadinessSessionInput,
  name: string,
  passed: boolean,
  required: boolean,
  message: string,
  createdAt: string
): AgentReadinessCheck {
  return {
    id: `ready_${randomUUID()}`,
    session_id: session.id,
    app_id: session.app_id,
    repo_id: session.repo_id,
    check_name: name,
    status: passed ? "passed" : "failed",
    required: required ? 1 : 0,
    message,
    created_at: createdAt
  };
}

function optionalCommand(session: ReadinessSessionInput, name: string, command: string, createdAt: string): AgentReadinessCheck {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return {
    id: `ready_${randomUUID()}`,
    session_id: session.id,
    app_id: session.app_id,
    repo_id: session.repo_id,
    check_name: name,
    status: result.status === 0 ? "passed" : "optional_missing",
    required: 0,
    message: result.status === 0 ? `${command} CLI detected.` : `${command} CLI not detected in local prototype environment.`,
    created_at: createdAt
  };
}

function gitOutput(sourceRoot: string, args: string[]): string {
  const result = spawnSync("git", ["-C", sourceRoot, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}
