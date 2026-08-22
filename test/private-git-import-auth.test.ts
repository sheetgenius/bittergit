import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRepository, type Repository } from "../src/repos";
import { importFromGitRemote, listImports } from "../src/import-export";
import { createGitImportAppBundle } from "../src/git-import-app-bundles";
import type { AccountAssertion } from "../src/assertions";
import { activeAppCount } from "../src/apps";

const fixtureId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const tmpRoot = mkdtempSync(join(tmpdir(), "bittergit-private-import-test-"));
setDefaultTimeout(60_000);
let server: ChildProcessWithoutNullStreams | undefined;
let serverPort: number | undefined;
let sourceRepo: Repository;

describe("private Git import source auth", () => {
  beforeAll(async () => {
    sourceRepo = createRepository(`auth-source-${fixtureId}`, "private");
    seedSourceRepo(sourceRepo);
    ({ process: server, port: serverPort } = await startPrivateGitServer(
      sourceRepo,
      "x-access-token",
      "gho_private_fixture_token"
    ));
  });

  afterAll(() => {
    server?.kill();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("imports a private HTTP Git remote with askpass credentials and prompt suppression", () => {
    const destRepo = createRepository(`auth-dest-${fixtureId}`, "imported");
    const record = importFromGitRemote(destRepo, {
      provider: "github",
      source_url: privateRemoteUrl(),
      default_branch: "main",
      source_auth: {
        type: "github_oauth",
        username: "x-access-token",
        password: "gho_private_fixture_token"
      }
    }, "test:private-import", {
      authorizeRef: () => true
    });

    expect(record.status).toBe("ok");
    expect(record.error).toBeNull();
    expect(record.source_url).toBe(privateRemoteUrl());
    expect(JSON.stringify(listImports(destRepo))).not.toContain("gho_private_fixture_token");
    expect(git(["--git-dir", destRepo.storage_path, "cat-file", "-e", "refs/heads/main:private.txt"]).status)
      .toBe(0);
    expect(git(["--git-dir", destRepo.storage_path, "cat-file", "-e", "refs/heads/main:CLAUDE.md"]).status)
      .toBe(0);
  });

  test("redacts credential material from failed private import errors", () => {
    const destRepo = createRepository(`auth-fail-${fixtureId}`, "imported");
    const record = importFromGitRemote(destRepo, {
      provider: "github",
      source_url: privateRemoteUrl(),
      default_branch: "main",
      source_auth: {
        type: "github_oauth",
        username: "x-access-token",
        password: "wrong-private-token"
      }
    }, "test:private-import", {
      authorizeRef: () => true
    });

    expect(record.status).toBe("failed");
    expect(record.error ?? "").not.toContain("wrong-private-token");
    expect(record.error ?? "").not.toContain("gho_private_fixture_token");
    expect(JSON.stringify(listImports(destRepo))).not.toContain("wrong-private-token");
  });

  test("repairs an existing failed private import app bundle with the same app slot", () => {
    const assertion = testAssertion(`account:private-repair-${fixtureId}`);

    expect(() => createGitImportAppBundle(assertion, {
      name: "repair-app",
      display_name: "Repair App",
      source_url: privateRemoteUrl(),
      default_branch: "main",
      source_auth: {
        type: "github_oauth",
        username: "x-access-token",
        password: "wrong-private-token"
      }
    })).toThrow();

    const repaired = createGitImportAppBundle(assertion, {
      name: "repair-app",
      display_name: "Repair App",
      source_url: privateRemoteUrl(),
      default_branch: "main",
      source_auth: {
        type: "github_oauth",
        username: "x-access-token",
        password: "gho_private_fixture_token"
      }
    });

    expect(repaired.setup_state.status).toBe("ready");
    expect(activeAppCount(assertion.account_ref)).toBe(1);
    expect(repaired.git_import.ephemeral_source_auth_used).toBe(true);
    expect(repaired.git_import.source_of_truth).toBe("bittergit");
    expect(repaired.git_import.upstream_relationship).toBe("import_then_detach");
    expect(repaired.git_import.sync_contract).toBe("one_time_import_no_background_sync");
    expect(repaired.source_contract.sync_contract).toBe("one_time_import_no_background_sync");
    expect(repaired.source_tree).toContain("private.txt");
    expect(repaired.source_tree).toContain("CLAUDE.md");
    expect(repaired.source_tree).toContain("docs/BITTERGRID_DEPLOYMENT_CONTRACT.md");
    const contextFiles = (repaired.git_import.context_files as {
      files: Array<{ path: string; status: string }>;
    }).files;
    expect(contextFiles.find((file) => file.path === "docs/BITTERGRID_DEPLOYMENT_CONTRACT.md")?.status).toBe("added");
    expect(contextFiles.find((file) => file.path === "CLAUDE.md")?.status).toBe("preserved");
    expect(contextFiles.find((file) => file.path === "GEMINI.md")?.status).toBe("missing");
  });
});

function privateRemoteUrl(): string {
  if (!serverPort) throw new Error("private git server not started");
  return `http://127.0.0.1:${serverPort}/${sourceRepo.owner}/${sourceRepo.name}.git`;
}

async function startPrivateGitServer(
  repo: Repository,
  username: string,
  password: string
): Promise<{ process: ChildProcessWithoutNullStreams; port: number }> {
  const serverScript = join(tmpRoot, "private-git-server.cjs");
  writeFileSync(serverScript, privateGitServerScript(), "utf8");
  const child = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      TEST_REPO_OWNER: repo.owner,
      TEST_REPO_NAME: repo.name,
      TEST_REPO_STORAGE_PATH: repo.storage_path,
      TEST_EXPECTED_BASIC: Buffer.from(`${username}:${password}`).toString("base64")
    }
  });

  const port = await new Promise<number>((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`private git server did not start: ${stderr}`)), 5000);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.once("data", (chunk) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(String(chunk)).port);
      } catch (error) {
        reject(error);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`private git server exited before ready: ${code}; ${stderr}`));
    });
  });

  return { process: child, port };
}

function seedSourceRepo(repo: Repository): void {
  const worktree = join(tmpRoot, "source-worktree");
  assertGit(["clone", repo.storage_path, worktree]);
  assertGit(["-C", worktree, "config", "user.email", "test@bittergit.local"]);
  assertGit(["-C", worktree, "config", "user.name", "BitterGit Test"]);
  writeFileSync(join(worktree, "private.txt"), "private import fixture\n", "utf8");
  writeFileSync(join(worktree, "CLAUDE.md"), "# Claude instructions\n\nUse project context.\n", "utf8");
  assertGit(["-C", worktree, "add", "private.txt", "CLAUDE.md"]);
  assertGit(["-C", worktree, "commit", "-m", "Add private fixture"]);
  assertGit(["-C", worktree, "push", "origin", "main"], {
    BITTERGIT_ACTOR: "test:seed-source",
    BITTERGIT_SCOPES: JSON.stringify([
      "repo:write",
      "ref:write:refs/heads/main"
    ])
  });
}

function assertGit(args: string[], env: Record<string, string> = {}): void {
  const result = git(args, env);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function git(args: string[], env: Record<string, string> = {}): ReturnType<typeof spawnSync> {
  return spawnSync("git", args, { encoding: "utf8", env: { ...process.env, ...env } });
}

function testAssertion(accountRef: string): AccountAssertion {
  return {
    format: "bga2",
    issuer: "factory.local",
    audience: "bittergit",
    subject: `${accountRef}:user:test`,
    assertion_id: `test-${fixtureId}`,
    key_ref: "factory-dev-key-1",
    authority_kind: "factory_hub_account_plan_bridge",
    account_ref: accountRef,
    workspace_ref: `factory:${accountRef}`,
    plan_key: "one_app",
    plan_status: "active",
    included_apps: 1,
    github_required: false,
    source: "test",
    asserted_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString(),
    hosted_workcell_limit: 1,
    monthly_hosted_run_limit: null,
    storage_limit_mb: null,
    mirror_export_allowed: true,
    trust: {
      format: "bga2",
      issuer: "factory.local",
      audience: "bittergit",
      subject: `${accountRef}:user:test`,
      assertion_id: `test-${fixtureId}`,
      key_ref: "factory-dev-key-1",
      key_status: "active",
      audience_verified: true,
      subject_verified: true,
      expiry_verified: true,
      assertion_id_verified: true,
      replay_status: "first_seen",
      revocation_status: "not_revoked",
      use_count: 1
    }
  };
}

function privateGitServerScript(): string {
  return String.raw`
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const { basename, dirname } = require("node:path");

const owner = process.env.TEST_REPO_OWNER;
const name = process.env.TEST_REPO_NAME;
const storagePath = process.env.TEST_REPO_STORAGE_PATH;
const expectedAuth = "Basic " + process.env.TEST_EXPECTED_BASIC;

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== expectedAuth) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="BitterGit test"' });
    res.end("authentication required");
    return;
  }

  const url = new URL(req.url, "http://127.0.0.1");
  const prefix = "/" + owner + "/" + name + ".git/";
  if (!url.pathname.startsWith(prefix)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const suffix = url.pathname.slice(prefix.length);
    const result = spawnSync("git", ["http-backend"], {
      input: body,
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: dirname(storagePath),
        PATH_INFO: "/" + basename(storagePath) + "/" + suffix,
        REQUEST_METHOD: req.method,
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers["content-type"] || "",
        CONTENT_LENGTH: String(body.length),
        GIT_HTTP_EXPORT_ALL: "1",
        REMOTE_USER: "test-private-source"
      }
    });
    if (result.status !== 0) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("git-http-backend failed\n" + result.stderr.toString("utf8"));
      return;
    }

    const parsed = parseCgi(result.stdout);
    res.writeHead(parsed.status, parsed.headers);
    res.end(parsed.body);
  });
});

server.listen(0, "127.0.0.1", () => {
  console.log(JSON.stringify({ port: server.address().port }));
});

function parseCgi(output) {
  let index = output.indexOf(Buffer.from("\r\n\r\n"));
  let separatorLength = 4;
  if (index === -1) {
    index = output.indexOf(Buffer.from("\n\n"));
    separatorLength = 2;
  }
  if (index === -1) {
    return { status: 500, headers: { "content-type": "text/plain" }, body: Buffer.from("missing CGI headers") };
  }

  const headerText = output.slice(0, index).toString("utf8");
  const headers = {};
  let status = 200;
  for (const rawLine of headerText.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key.toLowerCase() === "status") {
      const parsedStatus = Number(value.split(/\s+/)[0]);
      if (!Number.isNaN(parsedStatus)) status = parsedStatus;
    } else {
      headers[key] = value;
    }
  }
  return { status, headers, body: output.slice(index + separatorLength) };
}
`;
}
