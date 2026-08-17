import { backendPathInfo, type Repository } from "./repos";
import { config } from "./config";

export type GitBackendOptions = {
  request: Request;
  repo: Repository;
  suffix: string;
  actor?: string;
  scopes?: string[];
};

export async function runGitHttpBackend(options: GitBackendOptions): Promise<Response> {
  const url = new URL(options.request.url);
  const requestBody = new Uint8Array(await options.request.arrayBuffer());
  const env: Record<string, string> = {
    ...process.env,
    GIT_PROJECT_ROOT: config.reposRoot,
    PATH_INFO: backendPathInfo(options.repo, options.suffix),
    REQUEST_METHOD: options.request.method,
    QUERY_STRING: url.search.slice(1),
    CONTENT_TYPE: options.request.headers.get("content-type") ?? "",
    CONTENT_LENGTH: String(requestBody.byteLength),
    GIT_HTTP_EXPORT_ALL: "1"
  };

  if (options.actor) {
    env.REMOTE_USER = options.actor;
    env.BITTERGIT_ACTOR = options.actor;
  }
  if (options.scopes) {
    env.BITTERGIT_SCOPES = JSON.stringify(options.scopes);
  }
  env.BITTERGIT_REPO_ID = options.repo.id;

  const proc = Bun.spawn(["git", "http-backend"], {
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe"
  });

  proc.stdin.write(requestBody);
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    return new Response(`git-http-backend failed\n${stderr}`, { status: 500 });
  }

  return parseCgiResponse(new Uint8Array(stdout));
}

function parseCgiResponse(output: Uint8Array): Response {
  const separator = findHeaderSeparator(output);
  if (!separator) {
    return new Response("git-http-backend returned no CGI headers", { status: 500 });
  }

  const headerBytes = output.slice(0, separator.headerEnd);
  const body = output.slice(separator.bodyStart);
  const headerText = new TextDecoder().decode(headerBytes);
  const headers = new Headers();
  let status = 200;

  for (const rawLine of headerText.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;
    const index = line.indexOf(":");
    if (index === -1) continue;

    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();

    if (name.toLowerCase() === "status") {
      const parsed = Number(value.split(/\s+/)[0]);
      if (!Number.isNaN(parsed)) status = parsed;
      continue;
    }

    headers.append(name, value);
  }

  return new Response(body, { status, headers });
}

function findHeaderSeparator(output: Uint8Array): { headerEnd: number; bodyStart: number } | undefined {
  for (let i = 0; i < output.length - 3; i += 1) {
    if (output[i] === 13 && output[i + 1] === 10 && output[i + 2] === 13 && output[i + 3] === 10) {
      return { headerEnd: i, bodyStart: i + 4 };
    }
  }

  for (let i = 0; i < output.length - 1; i += 1) {
    if (output[i] === 10 && output[i + 1] === 10) {
      return { headerEnd: i, bodyStart: i + 2 };
    }
  }

  return undefined;
}
