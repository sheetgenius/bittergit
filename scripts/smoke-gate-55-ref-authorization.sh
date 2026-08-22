#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
SUFFIX="$(date -u +%Y%m%d%H%M%S)-$$"
PUSH_REPO="gate55-push-$SUFFIX"
IMPORT_REPO="gate55-import-$SUFFIX"
WORK_ROOT="$(mktemp -d /tmp/bittergit-gate-55.XXXXXX)"
PUSH_CREATE_JSON="$WORK_ROOT/push-create.json"
IMPORT_CREATE_JSON="$WORK_ROOT/import-create.json"
DENIED_IMPORT_JSON="$WORK_ROOT/denied-import.json"
ALLOWED_IMPORT_JSON="$WORK_ROOT/allowed-import.json"
BEFORE_REFS_JSON="$WORK_ROOT/before-refs.json"
REFS_JSON="$WORK_ROOT/refs.json"
FEATURE_PR_JSON="$WORK_ROOT/feature-pr.json"
FEATURE_MERGE_JSON="$WORK_ROOT/feature-merge.json"
MAIN_PR_JSON="$WORK_ROOT/main-pr.json"
MAIN_MERGE_JSON="$WORK_ROOT/main-merge.json"
PUSH_WORKTREE="$WORK_ROOT/push-worktree"
IMPORT_SEED="$WORK_ROOT/import-seed"
IMPORT_SOURCE="$WORK_ROOT/import-source.git"

trap 'rm -rf "$WORK_ROOT"' EXIT
export GIT_TERMINAL_PROMPT=0

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$PUSH_REPO\"}" >"$PUSH_CREATE_JSON"

PUSH_READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$PUSH_CREATE_JSON")"
PUSH_WRITE_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.write_token);' "$PUSH_CREATE_JSON")"
PUSH_MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$PUSH_CREATE_JSON")"

git -c http.extraHeader="Authorization: Bearer $PUSH_READ_TOKEN" \
  clone "$BASE_URL/$OWNER/$PUSH_REPO.git" "$PUSH_WORKTREE" >/dev/null
git -C "$PUSH_WORKTREE" config user.email "gate55@bittergit.local"
git -C "$PUSH_WORKTREE" config user.name "BitterGit Gate 55"
printf 'main\n' >"$PUSH_WORKTREE/main.txt"
git -C "$PUSH_WORKTREE" add main.txt
git -C "$PUSH_WORKTREE" commit -m "Add Gate 55 main" >/dev/null
git -C "$PUSH_WORKTREE" checkout -b feature/gate55 >/dev/null
printf 'feature\n' >"$PUSH_WORKTREE/feature.txt"
git -C "$PUSH_WORKTREE" add feature.txt
git -C "$PUSH_WORKTREE" commit -m "Add Gate 55 feature" >/dev/null
git -C "$PUSH_WORKTREE" tag gate55-v1
git -C "$PUSH_WORKTREE" -c http.extraHeader="Authorization: Bearer $PUSH_MAIN_TOKEN" \
  push origin main feature/gate55 refs/tags/gate55-v1 >/dev/null

git -C "$PUSH_WORKTREE" checkout -b feature/gate55-head >/dev/null
printf 'feature pull request\n' >"$PUSH_WORKTREE/feature-pr.txt"
git -C "$PUSH_WORKTREE" add feature-pr.txt
git -C "$PUSH_WORKTREE" commit -m "Add Gate 55 feature pull request" >/dev/null
git -C "$PUSH_WORKTREE" -c http.extraHeader="Authorization: Bearer $PUSH_MAIN_TOKEN" \
  push origin feature/gate55-head >/dev/null

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$PUSH_REPO/pull-requests" \
  -H "Authorization: Bearer $PUSH_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Gate 55 feature-base authorization","base_ref":"feature/gate55","head_ref":"feature/gate55-head","require_verification":false}' >"$FEATURE_PR_JSON"

FEATURE_PR_NUMBER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.pull_request.number);' "$FEATURE_PR_JSON")"
FEATURE_HEAD_SHA="$(git -C "$PUSH_WORKTREE" rev-parse feature/gate55-head)"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$PUSH_REPO/pull-requests/$FEATURE_PR_NUMBER/merge" \
  -H "Authorization: Bearer $PUSH_WRITE_TOKEN" >"$FEATURE_MERGE_JSON"

bun -e '
const result = await Bun.file(process.argv[1]).json();
if (result.pull_request.status !== "merged") throw new Error("feature-base pull request did not merge");
if (result.pull_request.base_ref !== "refs/heads/feature/gate55") throw new Error("feature-base ref changed");
if (result.merge.new_base_sha !== process.argv[2]) throw new Error("feature-base merge did not advance to head");
' "$FEATURE_MERGE_JSON" "$FEATURE_HEAD_SHA"

FEATURE_REMOTE_SHA="$(git -c http.extraHeader="Authorization: Bearer $PUSH_READ_TOKEN" \
  ls-remote "$BASE_URL/$OWNER/$PUSH_REPO.git" refs/heads/feature/gate55 | cut -f1)"
if [ "$FEATURE_REMOTE_SHA" != "$FEATURE_HEAD_SHA" ]; then
  echo "branch writer feature-base merge did not update the expected ref" >&2
  exit 1
fi

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$PUSH_REPO/pull-requests" \
  -H "Authorization: Bearer $PUSH_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Gate 55 protected-main authorization","base_ref":"main","head_ref":"feature/gate55","require_verification":false}' >"$MAIN_PR_JSON"

MAIN_PR_NUMBER="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.pull_request.number);' "$MAIN_PR_JSON")"
MAIN_BEFORE_SHA="$(git -c http.extraHeader="Authorization: Bearer $PUSH_READ_TOKEN" \
  ls-remote "$BASE_URL/$OWNER/$PUSH_REPO.git" refs/heads/main | cut -f1)"
MAIN_MERGE_STATUS="$(curl -sS -o "$MAIN_MERGE_JSON" -w '%{http_code}' -X POST \
  "$BASE_URL/bittergit/v1/repos/$OWNER/$PUSH_REPO/pull-requests/$MAIN_PR_NUMBER/merge" \
  -H "Authorization: Bearer $PUSH_WRITE_TOKEN")"
if [ "$MAIN_MERGE_STATUS" != "401" ]; then
  echo "branch writer unexpectedly received HTTP $MAIN_MERGE_STATUS when merging into main" >&2
  exit 1
fi

bun -e '
const result = await Bun.file(process.argv[1]).json();
if (result.error !== "token cannot merge into refs/heads/main") {
  throw new Error("main-base merge denial did not identify the actual protected ref");
}
' "$MAIN_MERGE_JSON"

MAIN_AFTER_SHA="$(git -c http.extraHeader="Authorization: Bearer $PUSH_READ_TOKEN" \
  ls-remote "$BASE_URL/$OWNER/$PUSH_REPO.git" refs/heads/main | cut -f1)"
if [ "$MAIN_AFTER_SHA" != "$MAIN_BEFORE_SHA" ]; then
  echo "denied main-base merge changed refs/heads/main" >&2
  exit 1
fi

if git -C "$PUSH_WORKTREE" -c http.extraHeader="Authorization: Bearer $PUSH_WRITE_TOKEN" \
  push origin :refs/heads/main :refs/tags/gate55-v1; then
  echo "branch writer unexpectedly deleted a protected ref" >&2
  exit 1
fi

PROTECTED_REFS="$(git -c http.extraHeader="Authorization: Bearer $PUSH_READ_TOKEN" \
  ls-remote "$BASE_URL/$OWNER/$PUSH_REPO.git" refs/heads/main refs/tags/gate55-v1)"
printf '%s\n' "$PROTECTED_REFS" | rg 'refs/heads/main' >/dev/null
printf '%s\n' "$PROTECTED_REFS" | rg 'refs/tags/gate55-v1' >/dev/null

git -C "$PUSH_WORKTREE" -c http.extraHeader="Authorization: Bearer $PUSH_WRITE_TOKEN" \
  push origin :refs/heads/feature/gate55 >/dev/null
if git -c http.extraHeader="Authorization: Bearer $PUSH_READ_TOKEN" \
  ls-remote --exit-code "$BASE_URL/$OWNER/$PUSH_REPO.git" refs/heads/feature/gate55 >/dev/null 2>&1; then
  echo "branch writer could not delete an authorized feature ref" >&2
  exit 1
fi

mkdir -p "$IMPORT_SEED"
git -C "$IMPORT_SEED" init --initial-branch=main >/dev/null
git -C "$IMPORT_SEED" config user.email "gate55@bittergit.local"
git -C "$IMPORT_SEED" config user.name "BitterGit Gate 55"
printf 'import main\n' >"$IMPORT_SEED/main.txt"
git -C "$IMPORT_SEED" add main.txt
git -C "$IMPORT_SEED" commit -m "Add import main" >/dev/null
git -C "$IMPORT_SEED" checkout -b feature/import-proof >/dev/null
printf 'import feature\n' >"$IMPORT_SEED/feature.txt"
git -C "$IMPORT_SEED" add feature.txt
git -C "$IMPORT_SEED" commit -m "Add import feature" >/dev/null
git -C "$IMPORT_SEED" tag gate55-import-v1
git init --bare --initial-branch=main "$IMPORT_SOURCE" >/dev/null
git -C "$IMPORT_SEED" remote add origin "$IMPORT_SOURCE"
git -C "$IMPORT_SEED" push origin main feature/import-proof refs/tags/gate55-import-v1 >/dev/null

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$IMPORT_REPO\"}" >"$IMPORT_CREATE_JSON"

IMPORT_READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$IMPORT_CREATE_JSON")"
IMPORT_WRITE_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.write_token);' "$IMPORT_CREATE_JSON")"
IMPORT_MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$IMPORT_CREATE_JSON")"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$IMPORT_REPO/refs" \
  -H "Authorization: Bearer $IMPORT_READ_TOKEN" >"$BEFORE_REFS_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$IMPORT_REPO/imports" \
  -H "Authorization: Bearer $IMPORT_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"local_git\",\"source_url\":\"$IMPORT_SOURCE\",\"default_branch\":\"main\"}" >"$DENIED_IMPORT_JSON"

bun -e '
const record = (await Bun.file(process.argv[1]).json()).import;
if (record.status !== "failed") throw new Error("limited import was not denied");
if (!String(record.error).includes("not authorized to import")) throw new Error("limited import failure was not actionable");
if (record.branch_count !== 0 || record.tag_count !== 0 || record.head_sha !== null) {
  throw new Error("denied import recorded mutated refs");
}
' "$DENIED_IMPORT_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$IMPORT_REPO/refs" \
  -H "Authorization: Bearer $IMPORT_READ_TOKEN" >"$REFS_JSON"
bun -e '
const before = (await Bun.file(process.argv[1]).json()).refs;
const after = (await Bun.file(process.argv[2]).json()).refs;
const normalized = (refs) => refs.map((entry) => `${entry.ref}:${entry.sha}`).sort();
if (JSON.stringify(normalized(before)) !== JSON.stringify(normalized(after))) {
  throw new Error("denied import mutated destination refs");
}
' "$BEFORE_REFS_JSON" "$REFS_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$IMPORT_REPO/imports" \
  -H "Authorization: Bearer $IMPORT_MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"local_git\",\"source_url\":\"$IMPORT_SOURCE\",\"default_branch\":\"main\"}" >"$ALLOWED_IMPORT_JSON"

bun -e '
const record = (await Bun.file(process.argv[1]).json()).import;
if (record.status !== "ok" || record.branch_count !== 2 || record.tag_count !== 1) {
  throw new Error("main-capable import contract regressed");
}
' "$ALLOWED_IMPORT_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$IMPORT_REPO/refs" \
  -H "Authorization: Bearer $IMPORT_READ_TOKEN" >"$REFS_JSON"
bun -e '
const refs = (await Bun.file(process.argv[1]).json()).refs;
for (const expected of ["refs/heads/main", "refs/heads/feature/import-proof", "refs/tags/gate55-import-v1"]) {
  if (!refs.some((entry) => entry.ref === expected)) throw new Error(`authorized import missed ${expected}`);
}
' "$REFS_JSON"

rg "scripts/smoke-gate-55-ref-authorization.sh" scripts/smoke-all.sh >/dev/null

echo "Gate 55 smoke passed for actual PR-base, protected deletion, and atomic import authorization"
