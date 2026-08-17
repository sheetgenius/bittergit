#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate12-$(date -u +%Y%m%d%H%M%S)-$$}"
SEED_DIR="${BITTERGIT_IMPORT_SEED_DIR:-/tmp/bittergit-gate-12-${REPO}-seed}"
SOURCE_DIR="${BITTERGIT_IMPORT_SOURCE_DIR:-/tmp/bittergit-gate-12-${REPO}-source.git}"
EXPORT_DIR="${BITTERGIT_EXPORT_DIR:-/tmp/bittergit-gate-12-${REPO}-export.git}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-12-create-json.XXXXXX)"
IMPORT_JSON="$(mktemp /tmp/bittergit-gate-12-import-json.XXXXXX)"
REFS_JSON="$(mktemp /tmp/bittergit-gate-12-refs-json.XXXXXX)"
EXPORT_JSON="$(mktemp /tmp/bittergit-gate-12-export-json.XXXXXX)"
REMOTE_JSON="$(mktemp /tmp/bittergit-gate-12-remote-json.XXXXXX)"
REMOTES_JSON="$(mktemp /tmp/bittergit-gate-12-remotes-json.XXXXXX)"
REMOTE_DELETE_JSON="$(mktemp /tmp/bittergit-gate-12-remote-delete-json.XXXXXX)"
PROVIDERS_JSON="$(mktemp /tmp/bittergit-gate-12-providers-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$SEED_DIR" "$SOURCE_DIR" "$EXPORT_DIR"
mkdir -p "$SEED_DIR"
git -C "$SEED_DIR" init --initial-branch=main >/dev/null
git -C "$SEED_DIR" config user.email "gate12@bittergit.local"
git -C "$SEED_DIR" config user.name "BitterGit Gate 12"
echo "main import source" > "$SEED_DIR/README.md"
git -C "$SEED_DIR" add README.md
git -C "$SEED_DIR" commit -m "Initial import source" >/dev/null
MAIN_SHA="$(git -C "$SEED_DIR" rev-parse HEAD)"
git -C "$SEED_DIR" checkout -b feature/import-proof >/dev/null
echo "feature import source" > "$SEED_DIR/feature.txt"
git -C "$SEED_DIR" add feature.txt
git -C "$SEED_DIR" commit -m "Add import feature branch" >/dev/null
FEATURE_SHA="$(git -C "$SEED_DIR" rev-parse HEAD)"
git -C "$SEED_DIR" tag v1-import
TAG_SHA="$(git -C "$SEED_DIR" rev-parse v1-import)"
git init --bare --initial-branch=main "$SOURCE_DIR" >/dev/null
git -C "$SEED_DIR" remote add origin "$SOURCE_DIR"
git -C "$SEED_DIR" push origin main feature/import-proof --tags >/dev/null
git init --bare --initial-branch=main "$EXPORT_DIR" >/dev/null

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"
MAIN_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.main_token);' "$CREATE_JSON")"
READ_TOKEN="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.tokens.read_token);' "$CREATE_JSON")"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/imports" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"generic_git\",\"source_url\":\"$SOURCE_DIR\",\"default_branch\":\"main\"}" >"$IMPORT_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const imp = data.import;
if (imp.status !== "ok") throw new Error(`import status ${imp.status}`);
if (imp.provider !== "generic_git") throw new Error("import provider wrong");
if (imp.branch_count !== 2 || imp.tag_count !== 1) throw new Error("import did not preserve branch/tag counts");
if (imp.head_sha !== process.argv[2]) throw new Error("import head SHA wrong");
' "$IMPORT_JSON" "$MAIN_SHA"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/refs" \
  -H "Authorization: Bearer $READ_TOKEN" >"$REFS_JSON"
bun -e '
const refs = (await Bun.file(process.argv[1]).json()).refs;
const expected = new Map([
  ["refs/heads/main", process.argv[2]],
  ["refs/heads/feature/import-proof", process.argv[3]],
  ["refs/tags/v1-import", process.argv[4]]
]);
for (const [ref, sha] of expected) {
  if (!refs.some((entry) => entry.ref === ref && entry.sha === sha)) {
    throw new Error(`missing imported ${ref}`);
  }
}
' "$REFS_JSON" "$MAIN_SHA" "$FEATURE_SHA" "$TAG_SHA"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/exports" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"generic_git\",\"destination_url\":\"$EXPORT_DIR\"}" >"$EXPORT_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const exp = data.export;
if (exp.status !== "ok") throw new Error(`export status ${exp.status}`);
if (exp.branch_count !== 2 || exp.tag_count !== 1) throw new Error("export did not record branch/tag counts");
if (exp.head_sha !== process.argv[2]) throw new Error("export head SHA wrong");
' "$EXPORT_JSON" "$MAIN_SHA"
test "$(git --git-dir "$EXPORT_DIR" rev-parse refs/heads/main)" = "$MAIN_SHA"
test "$(git --git-dir "$EXPORT_DIR" rev-parse refs/heads/feature/import-proof)" = "$FEATURE_SHA"
test "$(git --git-dir "$EXPORT_DIR" rev-parse refs/tags/v1-import)" = "$TAG_SHA"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/remotes" \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"backup\",\"provider\":\"generic_git\",\"remote_url\":\"$EXPORT_DIR\",\"role\":\"export\"}" >"$REMOTE_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.remote.name !== "backup" || data.remote.removed_at !== null) throw new Error("remote add failed");
' "$REMOTE_JSON"

curl -fsS "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/remotes" \
  -H "Authorization: Bearer $READ_TOKEN" >"$REMOTES_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.remotes.some((remote) => remote.name === "backup" && remote.role === "export")) {
  throw new Error("remote list missing backup");
}
' "$REMOTES_JSON"

curl -fsS -X DELETE "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/remotes/backup" \
  -H "Authorization: Bearer $MAIN_TOKEN" >"$REMOTE_DELETE_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.remote.removed_at) throw new Error("remote was not marked removed");
' "$REMOTE_DELETE_JSON"

curl -fsS "$BASE_URL/bittergit/v1/providers" >"$PROVIDERS_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.providers.some((provider) => provider.id === "generic_git" && provider.status === "active")) {
  throw new Error("generic_git provider not active");
}
if (!data.providers.some((provider) => provider.id === "gitlab" && provider.status === "next_provider")) {
  throw new Error("next provider was not defined as gitlab");
}
' "$PROVIDERS_JSON"

echo "Gate 12 smoke passed for import $SOURCE_DIR and export $EXPORT_DIR"
