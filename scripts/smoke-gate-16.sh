#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate16-$(date -u +%Y%m%d%H%M%S)-$$}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-16-create-json.XXXXXX)"
BIG_BODY="$(mktemp /tmp/bittergit-gate-16-big-body.XXXXXX)"
SECURITY_JSON="$(mktemp /tmp/bittergit-gate-16-security-json.XXXXXX)"
AUDIT_JSON="$(mktemp /tmp/bittergit-gate-16-audit-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"

perl -e 'print "x" x (1024 * 1024 + 1)' >"$BIG_BODY"
OVERSIZED_STATUS="$(curl -sS -o /tmp/bittergit-gate-16-oversized-response.json -w "%{http_code}" \
  -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Content-Type: application/json" \
  --data-binary "@$BIG_BODY")"
test "$OVERSIZED_STATUS" = "413"

UNAUTH_STATUS="$(curl -sS -o /tmp/bittergit-gate-16-unauth-response.json -w "%{http_code}" \
  "$BASE_URL/bittergit/v1/repos")"
test "$UNAUTH_STATUS" = "401"

if git ls-remote "$BASE_URL/$OWNER/$REPO.git" >/tmp/bittergit-gate-16-ls-remote.txt 2>/tmp/bittergit-gate-16-ls-remote-error.txt; then
  echo "unauthenticated git ls-remote unexpectedly succeeded" >&2
  exit 1
fi
rg "Authentication failed|could not read Username" /tmp/bittergit-gate-16-ls-remote-error.txt >/dev/null

TRAVERSAL_STATUS="$(curl -sS -o /tmp/bittergit-gate-16-traversal-response.json -w "%{http_code}" \
  "$BASE_URL/bittergit/v1/repos/%2e%2e/$REPO")"
if [ "$TRAVERSAL_STATUS" = "200" ]; then
  echo "path traversal-like API request unexpectedly succeeded" >&2
  exit 1
fi

curl -fsS "$BASE_URL/bittergit/v1/operations/security" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$SECURITY_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const security = data.security;
if (security.request_size_limit_bytes < 1024 * 1024) throw new Error("request size limit missing");
if (security.git_wire_protocol !== "git-http-backend") throw new Error("git backend posture missing");
if (security.audit_log !== "sqlite:audit_events") throw new Error("audit log posture missing");
if (security.quota_policy.request_body !== "enforced") throw new Error("request quota posture missing");
' "$SECURITY_JSON"

curl -fsS "$BASE_URL/bittergit/v1/operations/audit?limit=200" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$AUDIT_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const events = data.audit_events;
if (!events.some((event) => event.status === 413 && event.path === "/bittergit/v1/repos")) {
  throw new Error("audit log missing oversized request");
}
if (!events.some((event) => event.status === 401 && event.path === "/bittergit/v1/repos")) {
  throw new Error("audit log missing unauthorized request");
}
if (!events.some((event) => event.path.includes("/operations/security") && event.status === 200)) {
  throw new Error("audit log missing security posture read");
}
' "$AUDIT_JSON"

echo "Gate 16 smoke passed for security posture and audit controls"
