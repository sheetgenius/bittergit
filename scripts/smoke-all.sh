#!/usr/bin/env bash
set -euo pipefail

scripts/smoke-phase-1.sh
scripts/smoke-gate-2.sh
scripts/smoke-gate-3.sh
scripts/smoke-gate-4.sh
scripts/smoke-gate-5.sh
scripts/smoke-gate-6.sh
scripts/smoke-gate-7.sh
scripts/smoke-gate-8.sh
scripts/smoke-gate-9.sh
scripts/smoke-gate-10.sh
scripts/smoke-gate-11.sh
scripts/smoke-gate-12.sh
scripts/smoke-gate-13.sh
scripts/smoke-gate-14.sh
scripts/smoke-gate-15.sh
scripts/smoke-gate-16.sh
scripts/smoke-gate-17.sh
scripts/smoke-gate-18.sh
scripts/smoke-gate-19.sh
scripts/smoke-gate-20.sh
scripts/smoke-gate-21-account-plan.sh
scripts/smoke-gate-22-app-bundle.sh
scripts/smoke-gate-23-hosted-workcell-session.sh
scripts/smoke-gate-24-issuer-assertion.sh
scripts/smoke-gate-25-setup-progress.sh
scripts/smoke-gate-26-terminal-handoff.sh
scripts/smoke-gate-27-agent-readiness.sh
scripts/smoke-gate-28-production-issuer-trust.sh
scripts/smoke-gate-29-artifact-import-intake.sh
scripts/smoke-gate-30-artifact-import-app-bundle.sh
scripts/smoke-gate-31-launch-onboarding-ui.sh
scripts/smoke-gate-32-grid-terminal-fulfillment.sh
scripts/smoke-gate-33-hosted-agent-launch.sh
scripts/smoke-gate-34-charter-first-first-run.sh
scripts/smoke-gate-35-bitterpass-secret-grant.sh
scripts/smoke-gate-36-bittergrid-publish-verify.sh
scripts/smoke-gate-37-unified-support-repair.sh
scripts/smoke-gate-38-end-to-end-one-app-launch.sh
scripts/smoke-gate-39-production-ssh-session.sh
scripts/smoke-gate-40-issuer-discovery-rotation.sh
scripts/smoke-gate-41-dedicated-box-workcell.sh
scripts/smoke-gate-42-hosted-agent-auth-launch.sh
scripts/smoke-gate-43-bitterpass-materialization-handoff.sh
scripts/smoke-gate-44-grid-publish-callback.sh
scripts/smoke-gate-45-one-app-onboarding-ui.sh
scripts/smoke-gate-46-live-setup-progress.sh
scripts/smoke-gate-47-production-one-app-rehearsal.sh
scripts/smoke-gate-48-hub-factory-account-bridge.sh
scripts/smoke-gate-49-public-git-url-import-app-bundle.sh
# Gate 50 is a cross-repository Factory contract and runs in the Factory suite.
scripts/smoke-gate-51-real-grid-terminal-fulfillment.sh
scripts/smoke-gate-52-real-provider-readiness-charter-launch.sh
scripts/smoke-gate-53-public-runtime-safety.sh
scripts/smoke-gate-54-support-disclosure-boundary.sh
scripts/smoke-gate-55-ref-authorization.sh
bun test

echo "All locally reproducible BitterGit smoke gates passed"
