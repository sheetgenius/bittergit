import { ensureStorage } from "./storage";
import { config } from "./config";

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function requestContentLength(request: Request): number {
  const header = request.headers.get("content-length");
  if (!header) return 0;
  const value = Number(header);
  return Number.isFinite(value) ? value : 0;
}

export function oversizedRequest(request: Request): boolean {
  return requestContentLength(request) > config.maxRequestBytes;
}

export function rateLimitExceeded(request: Request): boolean {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > config.rateLimitPerMinute;
}

export function recordAuditEvent(request: Request, response: Response): void {
  const url = new URL(request.url);
  ensureStorage().query(`
    INSERT INTO audit_events
      (event_type, method, path, status, actor_hint, content_length, created_at)
    VALUES
      ($event_type, $method, $path, $status, $actor_hint, $content_length, $created_at)
  `).run({
    $event_type: "http_request",
    $method: request.method,
    $path: url.pathname,
    $status: response.status,
    $actor_hint: actorHint(request),
    $content_length: requestContentLength(request),
    $created_at: new Date().toISOString()
  });
}

export function listAuditEvents(limit: number): unknown[] {
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  return ensureStorage().query(`
    SELECT event_type, method, path, status, actor_hint, content_length, created_at
    FROM audit_events
    ORDER BY id DESC
    LIMIT ?
  `).all(boundedLimit);
}

export function securityPosture(): Record<string, unknown> {
  return {
    request_size_limit_bytes: config.maxRequestBytes,
    rate_limit_per_minute: config.rateLimitPerMinute,
    git_wire_protocol: "git-http-backend",
    path_policy: "validated owner/repo slugs plus hashed internal storage paths",
    audit_log: "sqlite:audit_events",
    token_transport: "Authorization header or Git Basic password; tokens are hashed at rest",
    dependency_scan: {
      package_json: true,
      lockfile: false,
      status: "local dependency scan not configured"
    },
    quota_policy: {
      repo_storage: "not enforced in local spike",
      request_body: "enforced"
    }
  };
}

function actorHint(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  if (authorization.startsWith("Bearer ")) return "bearer";
  if (authorization.startsWith("Basic ")) return "basic";
  return "present";
}
