#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate14-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-14-${REPO}}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-14-create-json.XXXXXX)"
ALICE_JSON="$(mktemp /tmp/bittergit-gate-14-alice-json.XXXXXX)"
BOB_JSON="$(mktemp /tmp/bittergit-gate-14-bob-json.XXXXXX)"
ISSUE_JSON="$(mktemp /tmp/bittergit-gate-14-issue-json.XXXXXX)"
PR_JSON="$(mktemp /tmp/bittergit-gate-14-pr-json.XXXXXX)"
WORKCELL_JSON="$(mktemp /tmp/bittergit-gate-14-workcell-json.XXXXXX)"
REVOKE_JSON="$(mktemp /tmp/bittergit-gate-14-revoke-json.XXXXXX)"
COLLABS_JSON="$(mktemp /tmp/bittergit-gate-14-collabs-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$WORKDIR"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"
READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$CREATE_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/collaborators" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","role":"admin"}' >"$ALICE_JSON"
curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/collaborators" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"bob","role":"member"}' >"$BOB_JSON"
ALICE_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.token);' "$ALICE_JSON")"
BOB_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.token);' "$BOB_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/issues" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Alice-created collaboration issue"}' >"$ISSUE_JSON"
ISSUE_NUMBER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.issue.number);' "$ISSUE_JSON")"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.issue.created_by !== "user:alice") throw new Error("issue actor was not alice");
' "$ISSUE_JSON"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"
git config user.email "gate14@bittergit.local"
git config user.name "BitterGit Gate 14"
git checkout -b bob/member-branch
echo "bob branch" > bob.txt
git add bob.txt
git commit -m "Bob branch change"
git -c http.extraHeader="Authorization: Bearer $BOB_TOKEN" push origin bob/member-branch
BOB_SHA="$(git rev-parse HEAD)"

git checkout main
echo "bob main attempt" > bob-main.txt
git add bob-main.txt
git commit -m "Bob main attempt"
if git -c http.extraHeader="Authorization: Bearer $BOB_TOKEN" push origin main 2>/tmp/bittergit-gate-14-bob-main-error.txt; then
  echo "member token unexpectedly pushed main" >&2
  exit 1
fi
rg "cannot write refs/heads/main" /tmp/bittergit-gate-14-bob-main-error.txt >/dev/null

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/pull-requests" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Alice opens PR for Bob branch\",\"base_ref\":\"main\",\"head_ref\":\"bob/member-branch\",\"issue_number\":$ISSUE_NUMBER,\"require_verification\":false}" >"$PR_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.pull_request.created_by !== "user:alice") throw new Error("PR actor was not alice");
if (data.pull_request.head_sha !== process.argv[2]) throw new Error("PR head SHA wrong");
' "$PR_JSON" "$BOB_SHA"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/collaborators/bob/workcells" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$WORKCELL_JSON"
WORKCELL_PATH="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.workcell.checkout_path);' "$WORKCELL_JSON")"
WORKCELL_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.workcell.id);' "$WORKCELL_JSON")"
git -C "$WORKCELL_PATH" config user.email "bob@bittergit.local"
git -C "$WORKCELL_PATH" config user.name "Bob Workcell"
git -C "$WORKCELL_PATH" checkout -b bob/workcell-before-revoke
echo "bob workcell before revoke" > "$WORKCELL_PATH/workcell-before.txt"
git -C "$WORKCELL_PATH" add workcell-before.txt
git -C "$WORKCELL_PATH" commit -m "Bob workcell before revoke" >/dev/null
git -C "$WORKCELL_PATH" push origin bob/workcell-before-revoke >/dev/null

curl -fsS -X DELETE "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/collaborators/bob" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$REVOKE_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.collaborator.revoked_at) throw new Error("bob was not revoked");
' "$REVOKE_JSON"

git checkout -B bob/revoked-user-attempt origin/main
echo "bob revoked user" > revoked-user.txt
git add revoked-user.txt
git commit -m "Bob revoked user attempt" >/dev/null
if git -c http.extraHeader="Authorization: Bearer $BOB_TOKEN" push origin bob/revoked-user-attempt 2>/tmp/bittergit-gate-14-bob-revoked-error.txt; then
  echo "revoked member token unexpectedly pushed" >&2
  exit 1
fi
rg "Authentication failed|could not read Username" /tmp/bittergit-gate-14-bob-revoked-error.txt >/dev/null

git -C "$WORKCELL_PATH" checkout -b bob/workcell-after-revoke
echo "bob workcell after revoke" > "$WORKCELL_PATH/workcell-after.txt"
git -C "$WORKCELL_PATH" add workcell-after.txt
git -C "$WORKCELL_PATH" commit -m "Bob workcell after revoke" >/dev/null
if git -C "$WORKCELL_PATH" push origin bob/workcell-after-revoke 2>/tmp/bittergit-gate-14-workcell-revoked-error.txt; then
  echo "revoked collaborator workcell unexpectedly pushed" >&2
  exit 1
fi
rg "Authentication failed|could not read Username" /tmp/bittergit-gate-14-workcell-revoked-error.txt >/dev/null

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/collaborators" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$COLLABS_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const alice = data.collaborators.find((entry) => entry.username === "alice");
const bob = data.collaborators.find((entry) => entry.username === "bob");
if (!alice || alice.role !== "admin" || alice.revoked_at) throw new Error("alice collaborator wrong");
if (!bob || bob.role !== "member" || !bob.revoked_at) throw new Error("bob collaborator revoke missing");
' "$COLLABS_JSON"

curl -fsS "$BASE_URL/bittergit/v1/workcells/$WORKCELL_ID" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >/tmp/bittergit-gate-14-workcell-state.json
bun -e '
const data = await Bun.file("/tmp/bittergit-gate-14-workcell-state.json").json();
if (!data.revoked_at || data.actor !== "user:bob") throw new Error("workcell revoke/actor missing");
'

echo "Gate 14 smoke passed for collaborators alice and bob in $BASE_URL/$OWNER/$REPO.git"
