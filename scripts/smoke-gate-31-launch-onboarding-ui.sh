#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
STAMP="$(date -u +%Y%m%d%H%M%S)-$$"
TMPROOT="$(mktemp -d /tmp/bittergit-gate-31.XXXXXX)"
HOME_HTML="$(mktemp /tmp/bittergit-gate-31-home-html.XXXXXX)"
BLANK_HEADERS="$(mktemp /tmp/bittergit-gate-31-blank-headers.XXXXXX)"
BLANK_HTML="$(mktemp /tmp/bittergit-gate-31-blank-html.XXXXXX)"
SAFE_HEADERS="$(mktemp /tmp/bittergit-gate-31-safe-headers.XXXXXX)"
SAFE_REVIEW_HTML="$(mktemp /tmp/bittergit-gate-31-safe-review-html.XXXXXX)"
SAFE_BUNDLE_HEADERS="$(mktemp /tmp/bittergit-gate-31-safe-bundle-headers.XXXXXX)"
SAFE_APP_HTML="$(mktemp /tmp/bittergit-gate-31-safe-app-html.XXXXXX)"
BLOCKED_HEADERS="$(mktemp /tmp/bittergit-gate-31-blocked-headers.XXXXXX)"
BLOCKED_REVIEW_HTML="$(mktemp /tmp/bittergit-gate-31-blocked-review-html.XXXXXX)"

cleanup() {
  rm -rf "$TMPROOT"
}
trap cleanup EXIT

curl -fsS "$BASE_URL/" >"$HOME_HTML"
for text in \
  "Create your app backstage" \
  "Start blank" \
  "Import folder or zip" \
  "Import Git repo" \
  "GitHub optional" \
  "No GitHub required" \
  "Advanced source options"; do
  rg "$text" "$HOME_HTML" >/dev/null
done
if rg "GitHub account required|Create GitHub account|GitHub is required" "$HOME_HTML" >/dev/null; then
  echo "default onboarding made GitHub required" >&2
  exit 1
fi

BLANK_ACCOUNT="acct-gate31-blank-$STAMP"
curl -fsS -D "$BLANK_HEADERS" -o /tmp/bittergit-gate-31-blank-body.html \
  -X POST "$BASE_URL/onboarding/blank-app" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "account_ref=$BLANK_ACCOUNT" \
  --data-urlencode "name=blank-ui"
rg "303" "$BLANK_HEADERS" >/dev/null
BLANK_LOCATION="$(awk 'tolower($1)=="location:" {print $2}' "$BLANK_HEADERS" | tr -d '\r')"
curl -fsS "$BASE_URL$BLANK_LOCATION" >"$BLANK_HTML"
for text in \
  "Backstage" \
  "Setup progress" \
  "First task" \
  "APP.md" \
  "GitHub" \
  "Optional later"; do
  rg "$text" "$BLANK_HTML" >/dev/null
done

SAFE_DIR="$TMPROOT/safe-import"
mkdir -p "$SAFE_DIR/css"
printf '<html><body><h1>Safe UI Import</h1></body></html>\n' >"$SAFE_DIR/index.html"
printf 'body { color: #222; }\n' >"$SAFE_DIR/css/site.css"
SAFE_ACCOUNT="acct-gate31-safe-$STAMP"
curl -fsS -D "$SAFE_HEADERS" -o /tmp/bittergit-gate-31-safe-review-body.html \
  -X POST "$BASE_URL/onboarding/artifact-imports/review" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "account_ref=$SAFE_ACCOUNT" \
  --data-urlencode "name=safe-import-ui" \
  --data-urlencode "source_kind=folder" \
  --data-urlencode "source_path=$SAFE_DIR"
rg "303" "$SAFE_HEADERS" >/dev/null
SAFE_REVIEW_LOCATION="$(awk 'tolower($1)=="location:" {print $2}' "$SAFE_HEADERS" | tr -d '\r')"
curl -fsS "$BASE_URL$SAFE_REVIEW_LOCATION" >"$SAFE_REVIEW_HTML"
for text in \
  "Ready to create app" \
  "Will import" \
  "Will skip" \
  "Blocked or needs attention" \
  "No GitHub required" \
  "Create app from import"; do
  rg "$text" "$SAFE_REVIEW_HTML" >/dev/null
done

SAFE_IMPORT_ID="$(printf '%s' "$SAFE_REVIEW_LOCATION" | sed -E 's#^/onboarding/artifact-imports/([^?]+).*#\1#')"
curl -fsS -D "$SAFE_BUNDLE_HEADERS" -o /tmp/bittergit-gate-31-safe-bundle-body.html \
  -X POST "$BASE_URL/onboarding/artifact-imports/$SAFE_IMPORT_ID/app-bundle" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "account_ref=$SAFE_ACCOUNT" \
  --data-urlencode "name=safe-import-ui"
rg "303" "$SAFE_BUNDLE_HEADERS" >/dev/null
SAFE_APP_LOCATION="$(awk 'tolower($1)=="location:" {print $2}' "$SAFE_BUNDLE_HEADERS" | tr -d '\r')"
curl -fsS "$BASE_URL$SAFE_APP_LOCATION" >"$SAFE_APP_HTML"
for text in \
  "Setup progress" \
  "Imported approved artifact files" \
  "Imported app bundle is ready" \
  "GitHub" \
  "Optional later"; do
  rg "$text" "$SAFE_APP_HTML" >/dev/null
done

BLOCKED_DIR="$TMPROOT/blocked-import"
mkdir -p "$BLOCKED_DIR"
printf '<html><body><h1>Blocked UI Import</h1></body></html>\n' >"$BLOCKED_DIR/index.html"
printf 'TOKEN=blocked\n' >"$BLOCKED_DIR/.env"
BLOCKED_ACCOUNT="acct-gate31-blocked-$STAMP"
curl -fsS -D "$BLOCKED_HEADERS" -o /tmp/bittergit-gate-31-blocked-review-body.html \
  -X POST "$BASE_URL/onboarding/artifact-imports/review" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "account_ref=$BLOCKED_ACCOUNT" \
  --data-urlencode "name=blocked-import-ui" \
  --data-urlencode "source_kind=folder" \
  --data-urlencode "source_path=$BLOCKED_DIR"
rg "303" "$BLOCKED_HEADERS" >/dev/null
BLOCKED_REVIEW_LOCATION="$(awk 'tolower($1)=="location:" {print $2}' "$BLOCKED_HEADERS" | tr -d '\r')"
curl -fsS "$BASE_URL$BLOCKED_REVIEW_LOCATION" >"$BLOCKED_REVIEW_HTML"
for text in \
  "Needs attention" \
  "Blocked files will not be committed" \
  "Repair action" \
  "env_file" \
  "No GitHub required"; do
  rg "$text" "$BLOCKED_REVIEW_HTML" >/dev/null
done

echo "Gate 31 smoke passed for launch onboarding UI flow"
