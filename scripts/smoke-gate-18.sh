#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
BOOTSTRAP_TOKEN="${BITTERGIT_TOKEN:-dev-token}"
OWNER="${BITTERGIT_OWNER:-test}"
RUN_ID="${BITTERGIT_RUN_ID:-gate18-$(date -u +%Y%m%d%H%M%S)-$$}"
COUNT="${BITTERGIT_SCALE_REPO_COUNT:-3}"
ROOT="${BITTERGIT_WORKDIR:-/tmp/bittergit-gate-18-${RUN_ID}}"
PERFORMANCE_JSON="$(mktemp /tmp/bittergit-gate-18-performance-json.XXXXXX)"
SUMMARY_JSON="$(mktemp /tmp/bittergit-gate-18-summary-json.XXXXXX)"
RUN_JSON="$(mktemp /tmp/bittergit-gate-18-run-json.XXXXXX)"

export GIT_TERMINAL_PROMPT=0

rm -rf "$ROOT"
mkdir -p "$ROOT"

now_ms() {
  perl -MTime::HiRes=time -e 'printf "%.0f\n", time() * 1000'
}

create_repo() {
  local name="$1"
  local output="$2"
  curl -fsS -X POST "$BASE_URL/bittergit/v1/repos" \
    -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"owner\":\"$OWNER\",\"name\":\"$name\"}" >"$output"
}

json_value() {
  bun -e 'const data = await Bun.file(process.argv[1]).json(); console.log(process.argv[2].split(".").reduce((value, key) => value[key], data));' "$1" "$2"
}

declare -a REPOS
declare -a READ_TOKENS
declare -a MAIN_TOKENS
declare -a WORKDIRS

for i in $(seq 1 "$COUNT"); do
  repo="${RUN_ID}-repo-${i}"
  create_json="$ROOT/create-${i}.json"
  create_repo "$repo" "$create_json"
  REPOS[$i]="$repo"
  READ_TOKENS[$i]="$(json_value "$create_json" "tokens.read_token")"
  MAIN_TOKENS[$i]="$(json_value "$create_json" "tokens.main_token")"
  WORKDIRS[$i]="$ROOT/work-${i}"
  git -c http.extraHeader="Authorization: Bearer ${READ_TOKENS[$i]}" clone "$BASE_URL/$OWNER/$repo.git" "${WORKDIRS[$i]}" >/dev/null
done

push_start="$(now_ms)"
declare -a PUSH_PIDS
for i in $(seq 1 "$COUNT"); do
  (
    cd "${WORKDIRS[$i]}"
    git config user.email "gate18@bittergit.local"
    git config user.name "BitterGit Gate 18"
    echo "scale push $i" > "scale-${i}.txt"
    git add "scale-${i}.txt"
    git commit -m "Scale push ${i}" >/dev/null
    git -c http.extraHeader="Authorization: Bearer ${MAIN_TOKENS[$i]}" push origin main >"$ROOT/push-${i}.log" 2>&1
    git rev-parse HEAD >"$ROOT/head-${i}.txt"
  ) &
  PUSH_PIDS[$i]=$!
done

for i in $(seq 1 "$COUNT"); do
  wait "${PUSH_PIDS[$i]}"
done
push_ms="$(( $(now_ms) - push_start ))"

for i in $(seq 1 "$COUNT"); do
  remote_head="$(git -c http.extraHeader="Authorization: Bearer ${READ_TOKENS[$i]}" ls-remote "$BASE_URL/$OWNER/${REPOS[$i]}.git" refs/heads/main | awk '{print $1}')"
  test "$remote_head" = "$(cat "$ROOT/head-${i}.txt")"
done

fetch_start="$(now_ms)"
declare -a FETCH_PIDS
for i in $(seq 1 "$COUNT"); do
  (
    cd "${WORKDIRS[$i]}"
    git -c http.extraHeader="Authorization: Bearer ${READ_TOKENS[$i]}" fetch origin >"$ROOT/fetch-${i}.log" 2>&1
  ) &
  FETCH_PIDS[$i]=$!
done
for i in $(seq 1 "$COUNT"); do
  wait "${FETCH_PIDS[$i]}"
done
fetch_ms="$(( $(now_ms) - fetch_start ))"

contention_repo="${RUN_ID}-contention"
contention_create="$ROOT/contention-create.json"
create_repo "$contention_repo" "$contention_create"
contention_read="$(json_value "$contention_create" "tokens.read_token")"
contention_main="$(json_value "$contention_create" "tokens.main_token")"
git -c http.extraHeader="Authorization: Bearer $contention_read" clone "$BASE_URL/$OWNER/$contention_repo.git" "$ROOT/contention-a" >/dev/null
git -c http.extraHeader="Authorization: Bearer $contention_read" clone "$BASE_URL/$OWNER/$contention_repo.git" "$ROOT/contention-b" >/dev/null

for side in a b; do
  (
    cd "$ROOT/contention-$side"
    git config user.email "gate18-$side@bittergit.local"
    git config user.name "BitterGit Gate 18 $side"
    echo "contention $side" > "contention-${side}.txt"
    git add "contention-${side}.txt"
    git commit -m "Contention ${side}" >/dev/null
  )
done

set +e
(
  cd "$ROOT/contention-a"
  git -c http.extraHeader="Authorization: Bearer $contention_main" push origin main >"$ROOT/contention-a.log" 2>&1
  echo $? >"$ROOT/contention-a.status"
) &
pid_a=$!
(
  cd "$ROOT/contention-b"
  git -c http.extraHeader="Authorization: Bearer $contention_main" push origin main >"$ROOT/contention-b.log" 2>&1
  echo $? >"$ROOT/contention-b.status"
) &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
set -e

status_a="$(cat "$ROOT/contention-a.status")"
status_b="$(cat "$ROOT/contention-b.status")"
success_count=0
failure_count=0
if [ "$status_a" = "0" ]; then success_count=$((success_count + 1)); else failure_count=$((failure_count + 1)); fi
if [ "$status_b" = "0" ]; then success_count=$((success_count + 1)); else failure_count=$((failure_count + 1)); fi
test "$success_count" = "1"
test "$failure_count" = "1"
rg "rejected|failed to push|fetch first|non-fast-forward|stale info|cannot lock ref" "$ROOT/contention-a.log" "$ROOT/contention-b.log" >/dev/null

bad_mirror_repo="${RUN_ID}-mirror"
bad_mirror_create="$ROOT/bad-mirror-create.json"
create_repo "$bad_mirror_repo" "$bad_mirror_create"
bad_mirror_status="$(curl -sS -o "$ROOT/bad-mirror.json" -w "%{http_code}" \
  -X POST "$BASE_URL/bittergit/v1/repos/$OWNER/$bad_mirror_repo/mirrors" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"local_git\",\"remote_url\":\"$ROOT/missing-downstream.git\"}")"
test "$bad_mirror_status" = "201"

curl -fsS "$BASE_URL/bittergit/v1/operations/performance" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" >"$PERFORMANCE_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const performance = data.performance;
if (performance.repository_count < Number(process.argv[2]) + 2) throw new Error("repo count visibility missing");
if (performance.storage_growth.data_root_bytes <= 0) throw new Error("data root storage size missing");
if (performance.storage_growth.repos_root_bytes <= 0) throw new Error("repos root storage size missing");
if (performance.mirror_backpressure.pending_or_attention_count < 1) throw new Error("mirror backlog/attention was not visible");
if (performance.mirror_backpressure.source_push_blocking !== false) throw new Error("mirror backpressure blocks source pushes");
if (performance.git_gc.mode !== "manual-per-repository") throw new Error("git gc scheduling signal missing");
if (performance.repeatable_harness !== "scripts/smoke-gate-18.sh") throw new Error("repeatable harness not named");
' "$PERFORMANCE_JSON" "$COUNT"

bun -e '
const performance = (await Bun.file(process.argv[1]).json()).performance;
const summary = {
  status: "passed",
  summary: {
    run_id: process.argv[2],
    repo_count_created: Number(process.argv[3]),
    concurrent_push_ms: Number(process.argv[4]),
    concurrent_fetch_ms: Number(process.argv[5]),
    same_ref_successes: Number(process.argv[6]),
    same_ref_failures: Number(process.argv[7]),
    repository_count_visible: performance.repository_count,
    mirror_attention_visible: performance.mirror_backpressure.pending_or_attention_count >= 1,
    storage_growth_visible: performance.storage_growth.data_root_bytes > 0,
    git_gc_mode: performance.git_gc.mode
  }
};
await Bun.write(process.argv[8], JSON.stringify(summary, null, 2) + "\n");
' "$PERFORMANCE_JSON" "$RUN_ID" "$COUNT" "$push_ms" "$fetch_ms" "$success_count" "$failure_count" "$SUMMARY_JSON"

curl -fsS -X POST "$BASE_URL/bittergit/v1/operations/performance-runs" \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "@$SUMMARY_JSON" >"$RUN_JSON"
bun -e '
const data = await Bun.file(process.argv[1]).json();
const run = data.performance_run;
if (run.status !== "passed") throw new Error("performance run was not persisted as passed");
if (run.summary.same_ref_successes !== 1 || run.summary.same_ref_failures !== 1) {
  throw new Error("same-ref contention result was not persisted");
}
if (run.summary.concurrent_push_ms <= 0 || run.summary.concurrent_fetch_ms <= 0) {
  throw new Error("operation latency metrics missing");
}
' "$RUN_JSON"

echo "Gate 18 smoke passed with ${COUNT} concurrent repos, push ${push_ms}ms, fetch ${fetch_ms}ms"
