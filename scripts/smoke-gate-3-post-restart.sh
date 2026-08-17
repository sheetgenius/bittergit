#!/usr/bin/env bash
set -euo pipefail

CONTEXT_FILE="${BITTERGIT_GATE3_CONTEXT:-/tmp/bittergit-gate-3-context.env}"

if [ ! -f "$CONTEXT_FILE" ]; then
  echo "missing Gate 3 context file: $CONTEXT_FILE" >&2
  exit 1
fi

source "$CONTEXT_FILE"

REFS_JSON="$(mktemp /tmp/bittergit-gate-3-restart-refs-json.XXXXXX)"
EVENTS_JSON="$(mktemp /tmp/bittergit-gate-3-restart-events-json.XXXXXX)"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/refs" \
  -H "Authorization: Bearer $READ_TOKEN" >"$REFS_JSON"
curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/events" \
  -H "Authorization: Bearer $READ_TOKEN" >"$EVENTS_JSON"
curl -fsS "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >/tmp/bittergit-gate-3-restart-repos.json

bun -e '
const refs = (await Bun.file(process.argv[1]).json()).refs;
const events = (await Bun.file(process.argv[2]).json()).events;
const expected = process.argv[3];
const main = refs.find((ref) => ref.ref === "refs/heads/main");
if (!main || main.sha !== expected) {
  console.error("main ref did not persist across restart");
  process.exit(1);
}
if (!events.some((event) => event.ref === "refs/heads/main" && event.new_sha === expected)) {
  console.error("event log did not persist across restart");
  process.exit(1);
}
' "$REFS_JSON" "$EVENTS_JSON" "$HEAD_SHA"

echo "Gate 3 post-restart smoke passed for $BASE_URL/$OWNER/$REPO.git"
