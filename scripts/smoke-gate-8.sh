#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate8-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-8-${REPO}}"
MIRROR_DIR="${BITTERGIT_MIRROR_DIR:-/tmp/bittergit-gate-8-${REPO}-mirror.git}"
BAD_MIRROR_DIR="${BITTERGIT_BAD_MIRROR_DIR:-/tmp/bittergit-gate-8-${REPO}-missing.git}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-8-create-json.XXXXXX)"
MIRROR_JSON="$(mktemp /tmp/bittergit-gate-8-mirror-json.XXXXXX)"
MIRRORS_JSON="$(mktemp /tmp/bittergit-gate-8-mirrors-json.XXXXXX)"
REPAIR_JSON="$(mktemp /tmp/bittergit-gate-8-repair-json.XXXXXX)"
BAD_JSON="$(mktemp /tmp/bittergit-gate-8-bad-json.XXXXXX)"
BAD_SYNC_JSON="$(mktemp /tmp/bittergit-gate-8-bad-sync-json.XXXXXX)"
BAD_DISABLE_JSON="$(mktemp /tmp/bittergit-gate-8-bad-disable-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$WORKDIR" "$WORKDIR-diverge" "$MIRROR_DIR" "$BAD_MIRROR_DIR"
git init --bare --initial-branch=main "$MIRROR_DIR" >/dev/null

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"

READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$CREATE_JSON")"
MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$CREATE_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/mirrors" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"local_git\",\"remote_url\":\"$MIRROR_DIR\"}" >"$MIRROR_JSON"

MIRROR_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.mirror.id);' "$MIRROR_JSON")"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.mirror.status !== "ok") {
  console.error(`expected configured mirror status ok, got ${data.mirror.status}`);
  process.exit(1);
}
' "$MIRROR_JSON"

git -c http.extraHeader="Authorization: Bearer $READ_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"
git config user.email "gate8@bittergit.local"
git config user.name "BitterGit Gate 8"
git checkout main

echo "mirrored once" > mirror.txt
git add mirror.txt
git commit -m "Add mirrored file"
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main
BITTER_SHA="$(git rev-parse HEAD)"
MIRROR_SHA="$(git --git-dir "$MIRROR_DIR" rev-parse refs/heads/main)"
test "$BITTER_SHA" = "$MIRROR_SHA"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/mirrors" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$MIRRORS_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const mirror = data.mirrors.find((entry) => entry.id === process.argv[2]);
if (!mirror) throw new Error("mirror missing");
if (mirror.status !== "ok") throw new Error(`mirror status ${mirror.status}`);
if (mirror.last_mirrored_sha !== process.argv[3]) throw new Error("last mirrored SHA did not match source");
if (!mirror.last_success_at) throw new Error("missing last_success_at");
' "$MIRRORS_JSON" "$MIRROR_ID" "$BITTER_SHA"

git clone "$MIRROR_DIR" "$WORKDIR-diverge"
cd "$WORKDIR-diverge"
git config user.email "downstream@bittergit.local"
git config user.name "Downstream Direct"
echo "direct downstream mutation" > downstream.txt
git add downstream.txt
git commit -m "Mutate downstream directly"
git push origin main
DIVERGED_SHA="$(git rev-parse HEAD)"

cd "$WORKDIR"
echo "canonical after divergence" >> mirror.txt
git add mirror.txt
git commit -m "Advance BitterGit canonical"
git -c http.extraHeader="Authorization: Bearer $MAIN_TOKEN" push origin main
CANONICAL_SHA="$(git rev-parse HEAD)"
MIRROR_AFTER_DIVERGENCE="$(git --git-dir "$MIRROR_DIR" rev-parse refs/heads/main)"
test "$MIRROR_AFTER_DIVERGENCE" = "$DIVERGED_SHA"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/mirrors" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$MIRRORS_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const mirror = data.mirrors.find((entry) => entry.id === process.argv[2]);
if (!mirror) throw new Error("mirror missing");
if (mirror.status !== "diverged") throw new Error(`expected diverged, got ${mirror.status}`);
for (const action of ["repair", "import", "disable"]) {
  if (!mirror.actions.includes(action)) throw new Error(`missing ${action} action`);
}
if (!mirror.last_error.includes("moved outside BitterGit")) throw new Error("missing divergence reason");
' "$MIRRORS_JSON" "$MIRROR_ID"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/mirrors/$MIRROR_ID/repair" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$REPAIR_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.mirror.status !== "ok") throw new Error(`repair status ${data.mirror.status}`);
if (data.mirror.last_mirrored_sha !== process.argv[2]) throw new Error("repair did not record canonical SHA");
' "$REPAIR_JSON" "$CANONICAL_SHA"
test "$(git --git-dir "$MIRROR_DIR" rev-parse refs/heads/main)" = "$CANONICAL_SHA"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/mirrors" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"local_git\",\"remote_url\":\"$BAD_MIRROR_DIR\"}" >"$BAD_JSON"
BAD_MIRROR_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.mirror.id);' "$BAD_JSON")"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.mirror.status !== "failed") throw new Error(`expected failed mirror, got ${data.mirror.status}`);
if (!data.mirror.actions.includes("sync")) throw new Error("failed mirror did not offer sync");
const expected = "mirror sync failed; verify remote reachability, credentials, and ref permissions";
if (data.mirror.last_error !== expected) throw new Error("failed mirror exposed an unexpected error");
if (data.mirror.last_error.includes(process.argv[2])) throw new Error("failed mirror exposed the remote path");
' "$BAD_JSON" "$BAD_MIRROR_DIR"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/mirrors/$BAD_MIRROR_ID/sync" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$BAD_SYNC_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.mirror.status !== "failed") throw new Error("retry did not preserve visible failure");
if (data.run.status !== "failed") throw new Error("retry run was not recorded as failed");
const expected = "mirror sync failed; verify remote reachability, credentials, and ref permissions";
if (data.mirror.last_error !== expected || data.run.error !== expected) {
  throw new Error("retry exposed an unexpected error");
}
if (data.mirror.last_error.includes(process.argv[2]) || data.run.error.includes(process.argv[2])) {
  throw new Error("retry exposed the remote path");
}
' "$BAD_SYNC_JSON" "$BAD_MIRROR_DIR"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/mirrors/$BAD_MIRROR_ID/disable" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$BAD_DISABLE_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.mirror.status !== "disabled") throw new Error("disable did not mark mirror disabled");
' "$BAD_DISABLE_JSON"

echo "Gate 8 smoke passed for $BASE_URL/$OWNER/$REPO.git with mirror $MIRROR_DIR"
