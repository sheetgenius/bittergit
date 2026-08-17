#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BITTERGIT_BASE_URL:-http://127.0.0.1:7420}"
STAMP="$(date -u +%Y%m%d%H%M%S)-$$"
TMPROOT="$(mktemp -d /tmp/bittergit-gate-45.XXXXXX)"
HOME_HTML="$TMPROOT/home.html"
BLANK_HEADERS="$TMPROOT/blank.headers"
BLANK_HTML="$TMPROOT/blank.html"
SAFE_HEADERS="$TMPROOT/safe.headers"
SAFE_REVIEW_HTML="$TMPROOT/safe-review.html"
SAFE_BUNDLE_HEADERS="$TMPROOT/safe-bundle.headers"
SAFE_APP_HTML="$TMPROOT/safe-app.html"
BLOCKED_HEADERS="$TMPROOT/blocked.headers"
BLOCKED_REVIEW_HTML="$TMPROOT/blocked-review.html"

cleanup() {
  rm -rf "$TMPROOT"
}
trap cleanup EXIT

curl -fsS "$BASE_URL/" >"$HOME_HTML"
for text in \
  "Create your app backstage" \
  "One-app plan active" \
  "Continue with Bitter account" \
  "github_required=false" \
  "Start blank" \
  "Import folder or zip" \
  "Import Git repo" \
  "Advanced source options" \
  "GitHub optional" \
  "No GitHub required"; do
  rg "$text" "$HOME_HTML" >/dev/null
done
for forbidden in \
  "GitHub account required" \
  "Create GitHub account" \
  "GitHub is required" \
  "Factory" \
  "Grid" \
  "source custody recorder" \
  "internal architecture"; do
  if rg "$forbidden" "$HOME_HTML" >/dev/null; then
    echo "cold onboarding leaked confusing copy: $forbidden" >&2
    exit 1
  fi
done

BLANK_ACCOUNT="acct-gate45-blank-$STAMP"
curl -fsS -D "$BLANK_HEADERS" -o "$TMPROOT/blank-body.html" \
  -X POST "$BASE_URL/onboarding/blank-app" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "account_ref=$BLANK_ACCOUNT" \
  --data-urlencode "name=gate45-blank"
rg "303" "$BLANK_HEADERS" >/dev/null
BLANK_LOCATION="$(awk 'tolower($1)=="location:" {print $2}' "$BLANK_HEADERS" | tr -d '\r')"
curl -fsS "$BASE_URL$BLANK_LOCATION" >"$BLANK_HTML"
for text in \
  "App created" \
  "Backstage" \
  "Setup progress" \
  "Hosted terminal is ready" \
  "Source is saved in BitterGit" \
  "GitHub is optional" \
  "Start by chartering the app" \
  "APP.md" \
  "Open hosted terminal" \
  "First task"; do
  rg "$text" "$BLANK_HTML" >/dev/null
done
if rg "GitHub account required|GitHub is required|token=|bgt_|dev-token|private log|Factory|Grid" "$BLANK_HTML" >/dev/null; then
  echo "blank onboarding result leaked required GitHub, token, or internal runtime copy" >&2
  exit 1
fi

SAFE_DIR="$TMPROOT/safe-import"
mkdir -p "$SAFE_DIR/assets"
printf '<html><body><h1>Safe imported artifact</h1><img src="assets/logo.svg"></body></html>\n' >"$SAFE_DIR/index.html"
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>\n' >"$SAFE_DIR/assets/logo.svg"
SAFE_ACCOUNT="acct-gate45-safe-$STAMP"
curl -fsS -D "$SAFE_HEADERS" -o "$TMPROOT/safe-review-body.html" \
  -X POST "$BASE_URL/onboarding/artifact-imports/review" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "account_ref=$SAFE_ACCOUNT" \
  --data-urlencode "name=gate45-safe-import" \
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
curl -fsS -D "$SAFE_BUNDLE_HEADERS" -o "$TMPROOT/safe-bundle-body.html" \
  -X POST "$BASE_URL/onboarding/artifact-imports/$SAFE_IMPORT_ID/app-bundle" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "account_ref=$SAFE_ACCOUNT" \
  --data-urlencode "name=gate45-safe-import"
rg "303" "$SAFE_BUNDLE_HEADERS" >/dev/null
SAFE_APP_LOCATION="$(awk 'tolower($1)=="location:" {print $2}' "$SAFE_BUNDLE_HEADERS" | tr -d '\r')"
curl -fsS "$BASE_URL$SAFE_APP_LOCATION" >"$SAFE_APP_HTML"
for text in \
  "Imported approved artifact files" \
  "Imported app bundle is ready" \
  "Hosted terminal is ready" \
  "Source is saved in BitterGit" \
  "GitHub is optional" \
  "Open hosted terminal" \
  "First task"; do
  rg "$text" "$SAFE_APP_HTML" >/dev/null
done
if rg "GitHub account required|GitHub is required|token=|bgt_|dev-token|private log|Factory|Grid" "$SAFE_APP_HTML" >/dev/null; then
  echo "artifact onboarding result leaked required GitHub, token, or internal runtime copy" >&2
  exit 1
fi

BLOCKED_DIR="$TMPROOT/blocked-import"
mkdir -p "$BLOCKED_DIR"
printf '<html><body><h1>Blocked import</h1></body></html>\n' >"$BLOCKED_DIR/index.html"
printf 'SECRET=blocked\n' >"$BLOCKED_DIR/.env"
BLOCKED_ACCOUNT="acct-gate45-blocked-$STAMP"
curl -fsS -D "$BLOCKED_HEADERS" -o "$TMPROOT/blocked-review-body.html" \
  -X POST "$BASE_URL/onboarding/artifact-imports/review" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "account_ref=$BLOCKED_ACCOUNT" \
  --data-urlencode "name=gate45-blocked-import" \
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
if rg "Create app from import" "$BLOCKED_REVIEW_HTML" >/dev/null; then
  echo "blocked import exposed app creation action" >&2
  exit 1
fi

echo "Gate 45 smoke passed for one-app onboarding UI wiring"
