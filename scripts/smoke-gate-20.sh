#!/usr/bin/env bash
set -euo pipefail

DOC="docs/SERVICE_BOUNDARY.md"

test -f "$DOC"

rg "^## Decision" "$DOC" >/dev/null
rg "standalone logical service" "$DOC" >/dev/null
rg "not permission to build a broad forge" "$DOC" >/dev/null

for phrase in \
  "source custody risk" \
  "deploy coupling" \
  "account/HUB coupling" \
  "operational burden" \
  "backup and recovery boundary" \
  "API consumers" \
  "failure domain"
do
  rg "$phrase" "$DOC" >/dev/null
done

for section in \
  "## API Boundary" \
  "## Storage Boundary" \
  "## Deploy Boundary" \
  "## Backup And Recovery Boundary" \
  "## Incident Boundary" \
  "## Consumers" \
  "## Ownership" \
  "## Extraction Triggers" \
  "## Non-Triggers"
do
  rg "^$section$" "$DOC" >/dev/null
done

rg "BitterPass owns secret values" "$DOC" >/dev/null
rg "BitterGrid owns runtime deploy execution" "$DOC" >/dev/null
rg "Consumers should not read BitterGit" "$DOC" >/dev/null
rg "SQLite files or repository storage paths directly" "$DOC" >/dev/null
rg "Do not split or expand the service because" "$DOC" >/dev/null

echo "Gate 20 smoke passed for standalone service boundary decision"
