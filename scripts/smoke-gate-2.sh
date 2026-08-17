#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate2-$(date -u +%Y%m%d%H%M%S)-$$}"
OTHER_REPO="${BITTERGIT_OTHER_REPO:-gate2-other-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-2-${REPO}}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-2-create-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$WORKDIR"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$OTHER_REPO\"}" >/tmp/bittergit-gate-2-other-create.json

READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$CREATE_JSON")"
WRITE_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.write_token);' "$CREATE_JSON")"
MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$CREATE_JSON")"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"

git config user.email "gate2@bittergit.local"
git config user.name "BitterGit Gate 2"
git checkout -B main

echo "main $(date -u +%Y-%m-%dT%H:%M:%SZ)" > main.txt
git add main.txt
git commit -m "Add main content"

if git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" push origin main; then
  echo "read token push unexpectedly succeeded" >&2
  exit 1
fi

if git -c http.extraHeader="Authorization: Bearer $WRITE_TOKEN" push origin main; then
  echo "write token unexpectedly pushed protected main" >&2
  exit 1
fi

git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main

git checkout -B issue-1
echo "feature $(date -u +%Y-%m-%dT%H:%M:%SZ)" > feature.txt
git add feature.txt
git commit -m "Add feature branch content"
git -c http.extraHeader="Authorization: Bearer $WRITE_TOKEN" push origin issue-1

echo "feature update $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> feature.txt
git add feature.txt
git commit -m "Update feature branch content"
git -c http.extraHeader="Authorization: Bearer $WRITE_TOKEN" push origin issue-1

git -c http.extraHeader="Authorization: Bearer $WRITE_TOKEN" push origin :issue-1

git checkout main
git tag v1
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin v1
echo "tag update $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> main.txt
git add main.txt
git commit -m "Update tag target"
git tag -f v1
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push --force origin v1

if git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" ls-remote "$BASE_URL/$OWNER/$OTHER_REPO.git"; then
  echo "repo-scoped token unexpectedly read another repo" >&2
  exit 1
fi

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" fetch origin
git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" ls-remote origin >/tmp/bittergit-gate-2-ls-remote.txt

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/events" \
  -H "Authorization: Bearer $READ_TOKEN" >/tmp/bittergit-gate-2-events.json

bun -e '
const data = await Bun.file("/tmp/bittergit-gate-2-events.json").json();
const refs = data.events.map((event) => event.ref);
for (const required of ["refs/heads/main", "refs/heads/issue-1", "refs/tags/v1"]) {
  if (!refs.includes(required)) {
    console.error(`missing ref event for ${required}`);
    process.exit(1);
  }
}
console.log(`Gate 2 event count: ${data.events.length}`);
'

echo "Gate 2 smoke passed for $BASE_URL/$OWNER/$REPO.git"
