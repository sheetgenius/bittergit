#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
REPO="${BITTERGIT_REPO:-gate15-$(date -u +%Y%m%d%H%M%S)-$$}"
WORKDIR="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-15-${REPO}}"
BAD_MIRROR_DIR="${BITTERGIT_BAD_MIRROR_DIR:-/tmp/bittergit-gate-15-${REPO}-missing.git}"
CREATE_JSON="$(mktemp /tmp/bittergit-gate-15-create-json.XXXXXX)"
MIRROR_JSON="$(mktemp /tmp/bittergit-gate-15-mirror-json.XXXXXX)"
BACKUP_JSON="$(mktemp /tmp/bittergit-gate-15-backup-json.XXXXXX)"
RESTORE_JSON="$(mktemp /tmp/bittergit-gate-15-restore-json.XXXXXX)"
BACKUPS_JSON="$(mktemp /tmp/bittergit-gate-15-backups-json.XXXXXX)"
HEALTH_JSON="$(mktemp /tmp/bittergit-gate-15-health-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$WORKDIR" "$BAD_MIRROR_DIR"

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"name\":\"$REPO\"}" >"$CREATE_JSON"

git -c http.extraHeader="Authorization: Bearer $BOOTSTRAP_TOKEN" clone "$BASE_URL/$OWNER/$REPO.git" "$WORKDIR"
cd "$WORKDIR"
git config user.email "gate15@bittergit.local"
git config user.name "BitterGit Gate 15"
git checkout main
echo "backup proof" > backup.txt
git add backup.txt
git commit -m "Add backup proof"
git -c http.extraHeader="Authorization: Bearer $BOOTSTRAP_TOKEN" push origin main

curl -fsS -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$REPO/mirrors" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"local_git\",\"remote_url\":\"$BAD_MIRROR_DIR\"}" >"$MIRROR_JSON"
MIRROR_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.mirror.id);' "$MIRROR_JSON")"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (data.mirror.status !== "failed") throw new Error("bad mirror did not fail visibly");
' "$MIRROR_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/operations/backups" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$BACKUP_JSON"
BACKUP_ID="$(bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(data.backup.id);' "$BACKUP_JSON")"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const backup = data.backup;
if (backup.status !== "ok") throw new Error(`backup status ${backup.status}`);
if (backup.repo_count < 1) throw new Error("backup did not include repositories");
if (!backup.backup_path || !backup.metadata_path) throw new Error("backup paths missing");
' "$BACKUP_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/operations/backups/$BACKUP_ID/restore-rehearsal" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$RESTORE_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const restore = data.restore_rehearsal;
if (restore.status !== "passed") throw new Error(`restore status ${restore.status}`);
if (restore.fsck_repo_count < 1) throw new Error("restore did not fsck repos");
if (restore.metadata_repo_count < 1 || restore.metadata_ref_count < 1 || restore.metadata_event_count < 1) {
  throw new Error("restore metadata counts were not useful");
}
' "$RESTORE_JSON"

curl -fsS "$BASE_URL/bittergit/v1/operations/backups" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$BACKUPS_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
if (!data.backups.some((backup) => backup.id === process.argv[2] && backup.status === "ok")) {
  throw new Error("backup list missing new backup");
}
' "$BACKUPS_JSON" "$BACKUP_ID"

curl -fsS "$BASE_URL/bittergit/v1/operations/health" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$HEALTH_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const health = data.health;
if (!health.latest_backup || health.latest_backup.id !== process.argv[2]) throw new Error("latest backup missing");
if (!health.disk || health.disk.available_kb <= 0) throw new Error("disk capacity missing");
if (!Array.isArray(health.hook_failures)) throw new Error("hook failure signal missing");
if (!health.mirror_attention.some((mirror) => mirror.id === process.argv[3] && mirror.status === "failed")) {
  throw new Error("mirror attention did not include failed mirror");
}
if (!health.garbage_collection_policy.includes("git gc")) throw new Error("gc policy missing");
' "$HEALTH_JSON" "$BACKUP_ID" "$MIRROR_ID"

echo "Gate 15 smoke passed for backup $BACKUP_ID"
