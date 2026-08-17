import { Buffer } from "node:buffer";
import { findToken, tokenAllowsAny, tokenScopes, type TokenRecord } from "./tokens";

export type AuthResult = {
  ok: boolean;
  actor?: string;
  token?: TokenRecord;
  scopes?: string[];
};

export type AuthOptions = {
  repoId?: string;
  require?: string | string[];
};

export function authenticate(request: Request, options: AuthOptions = {}): AuthResult {
  const header = request.headers.get("authorization") ?? "";
  const tokenValue = bearerToken(header);

  if (!tokenValue) {
    return { ok: false };
  }

  const token = findToken(tokenValue);
  if (!token) return { ok: false };

  const requiredScopes = Array.isArray(options.require) ? options.require : options.require ? [options.require] : [];
  if (requiredScopes.length > 0 && !tokenAllowsAny(token, options.repoId, requiredScopes)) {
    return { ok: false };
  }

  return { ok: true, actor: token.actor, token, scopes: tokenScopes(token) };
}

export function unauthorized(message = "Unauthorized"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": "Basic realm=\"BitterGit\""
    }
  });
}

function bearerToken(header: string): string | undefined {
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();

  const basic = header.match(/^Basic\s+(.+)$/i);
  if (!basic) return undefined;

  const decoded = Buffer.from(basic[1], "base64").toString("utf8");
  const index = decoded.indexOf(":");
  if (index === -1) return undefined;
  return decoded.slice(index + 1);
}
