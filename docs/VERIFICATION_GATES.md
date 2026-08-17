# BitterGit Verification Gates

Status: public engineering contract

## Purpose

This document defines what good looks like for BitterGit over a long horizon.

It is not a promise to build every feature immediately. It is a gate sequence
for agents to follow without drifting into a full GitHub clone or skipping the
hard protocol proofs.

The current implementation goal advances one gate at a time after executable
proof is recorded. Later gates are requirements for future capability, not
permission to skip the next incomplete gate.

## Global Invariants

These invariants apply to every gate:

- Stock Git compatibility must never regress.
- Do not implement the Git wire protocol manually.
- One app has one canonical source of truth at a time.
- Every source mutation has an actor, ref, old SHA, new SHA, repository, and
  timestamp.
- Every deploy points to a commit SHA.
- Every agent run that changes source produces or references a checkpoint.
- Secrets and credential grants never enter Git, mirrors, receipts, logs, or
  user-visible API responses.
- GitHub is never required to create a new BitterGit-primary app.
- GitHub/GitLab/etc. are adapters, mirrors, or external-primary providers, not
  prerequisites.
- Beginner surfaces may explain Git concepts gently, but source primitives keep
  standard names: repository, issue, branch, commit, pull request, merge,
  remote, mirror.

## Gate Advancement Rules

Do not mark a gate complete with prose alone.

Each completed gate must leave:

- an executable smoke or integration test where practical
- an updated gate contract
- the command used to verify it
- known gaps or consciously deferred scope

CI and pull requests carry observed results. The public repository does not
commit generated proof transcripts because they can accidentally preserve
machine paths, customer identifiers, or operational references.

## Current Hard Stop

Every locally reproducible gate through Gate 53 has executable smoke coverage
under `scripts/`. Gate 50 is a cross-repository Factory contract and remains in
the Factory test suite rather than the standalone BitterGit runner.

The initial source-custody and integration contract sequence is complete
through Gate 52. Gate 53 adds the public runtime safety boundary.

Run `scripts/verify.sh` before treating further changes as safe.

Do not implement post-gate broad forge work, SSH Git, LFS, OAuth, teams, review
comments, full GitHub API compatibility, `gh` compatibility, Actions, packages,
federation, or broader forge features without adding a new narrow gate contract
and smoke proof.

See `ROADMAP.md` for the next community-facing milestones.

## Gate 0: Repo Contract And Scope Fence

Purpose:

Establish the product boundary and prevent future agents from building a forge
before a Git remote works.

Required proof:

- `AGENTS.md` names the current hard stop.
- `README.md` states the product boundary and maturity.
- `docs/getting-started.md` has a stock-Git demo.
- `ROADMAP.md` names the current community priorities.
- `docs/VERIFICATION_GATES.md` exists.

Acceptance:

- A new agent can answer "what do I build next?" by reading `AGENTS.md`.
- The answer is Gate 1, not issues, PRs, mirrors, UI, or provider adapters.

Stop conditions:

- The repo invites broad implementation before Git remote proof.
- The docs hedge between "Tasks or Issues" or "Proposed Changes or Pull
  Requests" instead of using standard source nouns.

## Gate 1: Stock Git Smart HTTP Remote

Purpose:

Prove BitterGit can behave like a normal Git remote.

Required capability:

- create bare repo
- serve repo over Git smart HTTP
- authenticate clone/fetch/push
- support `git clone`, `git push`, `git fetch`, `git ls-remote`
- record ref update events

Executable proof:

- `scripts/smoke-phase-1.sh`

Acceptance:

- The smoke script creates a repo through the API.
- Stock `git clone` works.
- Stock `git push origin main` works with a valid token.
- Invalid token cannot push.
- Stock `git fetch origin` works after push.
- Stock `git ls-remote origin` returns refs.
- Event API returns old SHA, new SHA, ref, repo id, actor, and timestamp.
- Repo storage stays under `.var/bittergit`.

Stop conditions:

- Any custom Git client is required.
- `git-http-backend` response headers are hand-waved instead of parsed.
- Repo slug can escape the storage root.
- Ref updates are not recorded.

## Gate 2: Auth, Ref Policy, And Hook Safety

Purpose:

Turn the Git remote from a dev spike into a minimally safe source-custody
surface.

Required capability:

- token records with read/write/admin distinction
- repo-scoped tokens
- ref-scoped write policy
- pre-receive auth enforcement
- post-receive ref event capture
- clear unauthorized response behavior for Git clients

Acceptance:

- read token can clone/fetch but cannot push.
- write token can push authorized refs.
- token scoped to one repo cannot read or write another repo.
- protected ref write is rejected without the required scope.
- post-receive event capture works for branch creation, branch update, branch
  delete, and tag update.
- auth failures are visible to stock Git as failures, not partial successes.

Stop conditions:

- generic dev token remains the only path.
- protected refs are documented but not enforced.
- hook failures can silently allow writes.

## Gate 3: Durable Repository Metadata And Event Log

Purpose:

Make repository custody inspectable and recoverable beyond in-memory state.

Required capability:

- SQLite metadata store or equivalent local durable store
- repository records
- ref records
- token records
- append-only ref event log
- idempotent repo creation behavior
- storage path recovery from metadata

Acceptance:

- server restart preserves repos, refs, events, and tokens.
- duplicate repo create returns existing repo or clear conflict.
- deleted or missing repo path is detected as storage drift.
- event log can answer latest head per ref.
- a repo can be listed and inspected through the API.

Stop conditions:

- source custody depends on process memory.
- storage paths are derived only from user slugs.
- event records cannot be joined back to repository records.

## Gate 4: Local Workcell Checkout Contract

Purpose:

Prove an agent can work inside a normal checkout without knowing BitterGit
internals.

Required capability:

- create repo for app/workcell
- issue workcell-scoped token
- configure Git credential helper without token in URL
- clone repo into a workcell path
- set `origin` to BitterGit canonical remote
- let stock Git commands commit and push

Acceptance:

- workcell opens in a clean working tree.
- `git remote -v` shows BitterGit origin without embedded secret.
- agent-run token can push only authorized refs.
- token expires or is revoked after the run.
- workcell can be rebuilt from repo source and metadata.

Stop conditions:

- tokens are embedded in clone URLs.
- workcell state is treated as source truth without Git ref proof.
- agent can write every repo.

## Gate 5: Checkpoints, History, And Restore

Purpose:

Make source history understandable and recoverable for a non-expert operator.

Required capability:

- checkpoint records anchored to commit SHA or commit range
- before/after agent-run checkpoints
- before/after deploy checkpoints
- diff view or API between checkpoints
- restore path
- no-op run handling

Acceptance:

- agent run with source changes creates after-run checkpoint.
- no-op agent run does not fabricate a checkpoint.
- checkpoint list shows label, actor, commit, timestamp, and linked run/deploy.
- checkpoint diff can be generated with stock Git data.
- restore creates an auditable source transition by policy.
- restore can be verified with `git log` and event records.

Stop conditions:

- checkpoint is used as a replacement word for commit.
- restore mutates source without recording old/new SHA.
- checkpoint labels exist without source anchors.

## Gate 6: Deploy And Receipt Provenance

Purpose:

Tie source custody to BitterGrid deployment truth and Bitter receipts.

Required capability:

- deploy request requires commit SHA
- deploy receipt cites repository and commit
- verification result cites repository and commit
- rollback cites previous commit/checkpoint
- production deploy refuses unknown or unaccepted source state by policy

Acceptance:

- every deploy can be traced to a commit.
- deploy UI/API can show source ref, commit, checkpoint, and verification.
- failed deploy still records attempted source state.
- rollback records old deployed commit and new deployed commit.
- BitterGrid remains deploy truth; BitterGit remains source truth.

Stop conditions:

- deploys consume "latest" without recording SHA.
- Factory, workcell, or runtime checkout is treated as source truth without a
  repository ref.
- receipt cannot cite the exact source revision.

## Gate 7: Secret And Unsafe Source Protection

Purpose:

Prevent the beginner-plus-agent workflow from committing secrets or dangerous
local artifacts.

Required capability:

- default `.gitignore` template
- pre-receive high-confidence secret scan
- protected path policy
- blocked-push repair guidance
- receipt and event redaction policy

Acceptance:

- `.env` and common local credential paths are ignored by starter repos.
- high-confidence secret commit is rejected.
- blocked push names the file/rule without leaking secret value.
- mirror/export never includes BitterPass vault material.
- secret-safety test fixtures prove allowed and blocked cases.

Stop conditions:

- source custody accepts obvious private keys or token files.
- repair guidance tells users to paste secrets into prompts or logs.
- rejected pushes leave ambiguous repo state.

## Gate 8: Server-Side Source Mirroring

Purpose:

Provide portability and trust without making GitHub required to start.

Required capability:

- configure downstream mirror target
- store mirror credential through approved secret storage
- push branches/tags server-side
- record mirror runs
- detect divergence
- expose mirror health
- offer repair/import/disable actions

Acceptance:

- agent pushes only to BitterGit `origin`.
- server mirrors successful source updates to GitHub.
- mirror status records last mirrored SHA and time.
- mirror failure is visible and retryable.
- direct GitHub mutation marks mirror diverged.
- destructive repair requires explicit action.

Stop conditions:

- agents are responsible for double-pushing.
- mirror is silently treated as canonical.
- bidirectional sync appears before divergence policy is proven.

## Gate 9: Minimal Issues

Purpose:

Add the standard task container without pulling in a whole tracker.

Required capability:

- create/edit/close issue
- comment
- link issue to branch, commits, checkpoint, agent run, deploy, receipt
- issue numbers scoped per repo/app
- basic status

Acceptance:

- issue can drive an agent run.
- issue shows linked source and receipt artifacts.
- closing issue records actor and source/deploy evidence when present.
- issue remains useful without GitHub.
- external-provider issue IDs can be stored but do not replace Bitter IDs in
  BitterGit-primary mode.

Stop conditions:

- issue system becomes Jira.
- issue events are noisier than the source/workcell loop.
- GitHub issue mirroring is required for local issue usefulness.

## Gate 10: Minimal Pull Requests

Purpose:

Support proposed-change review for safer or collaborative work.

Required capability:

- base branch
- head branch
- commit range
- diff
- linked issue
- verification summary
- preview deploy URL
- receipt links
- merge/close through Bitter policy

Acceptance:

- agent can create branch, commit, and open PR.
- PR shows diff and commits.
- PR can require verification before merge.
- merge records old base, head, merge result, actor, and timestamp.
- protected main policy routes risky changes through PR.
- direct-to-main fast path can still exist by policy.

Stop conditions:

- elaborate review UI appears before minimal PR works.
- PR is mandatory for every small beginner change.
- merge can occur without recording source transition.

## Gate 11: External-Primary GitHub Adapter

Purpose:

Let Bitter work against an existing GitHub repo without taking source custody.

Required capability:

- connect GitHub repo
- clone with provider credential
- create branch
- push branch
- open/update GitHub PR
- read issue/PR metadata
- link external source objects to Bitter receipts

Acceptance:

- external repo remains canonical.
- Bitter workcell can make branch and PR through GitHub.
- Bitter deploy/verification receipts cite GitHub commit and PR.
- direct external merge is detected and imported into Bitter's state.
- provider API errors do not corrupt local source metadata.

Stop conditions:

- Bitter silently assumes canonical ownership of external source.
- GitHub PR number becomes the only canonical ID inside Bitter.
- provider credential appears in logs, remotes, or receipts.

## Gate 12: Generic Git Import, Export, And Provider Expansion

Purpose:

Keep GitHub optional and preserve escape hatches.

Required capability:

- import from arbitrary Git remote where credentials are available
- export BitterGit repo to a new remote
- add/remove remotes by policy
- support generic Git-over-HTTPS as source-only provider
- define next provider adapter after GitHub

Acceptance:

- user can leave with a normal Git repo.
- imported repo preserves branches/tags selected by policy.
- export records destination, actor, and resulting remote head SHA.
- generic Git provider works without issue/PR assumptions.

Stop conditions:

- export requires GitHub.
- import loses source history without explicit user approval.
- generic Git is forced into GitHub-shaped workflow metadata.

## Gate 13: Backstage Product Surface

Purpose:

Make the beginner path usable without hiding the real source trail.

Required capability:

- app-first onboarding
- Backstage terminal/workcell entry
- Issues
- Pull Requests
- History
- Deploys
- Secrets
- Settings
- plain-language explanations of Git concepts

Acceptance:

- user can create app without GitHub.
- user can see history and restore without using Git commands.
- user can find clone URL and export controls in settings.
- UI shows source/deploy/receipt linkage without jargon overload.
- no feature requires a terminal unless it is explicitly a terminal workflow.

Stop conditions:

- first screen is "create repository" for beginner path.
- UI invents parallel terms that obscure standard source concepts.
- source custody becomes invisible enough that ownership feels unclear.

## Gate 14: Multi-User Collaboration And Permissions

Purpose:

Support real collaboration without enterprise sprawl.

Required capability:

- owner/admin/member roles
- repo/app permissions
- issue/PR actor attribution
- token revocation
- protected refs by role
- workcell access boundaries

Acceptance:

- two users can collaborate on one app without sharing credentials.
- a revoked user cannot push or access workcell source.
- PR/issue/deploy actions show actor.
- protected main blocks unauthorized direct writes.
- audit records are sufficient for support/debugging.

Stop conditions:

- enterprise SSO becomes a launch dependency.
- team permissions are broader than the product needs.
- shared machine credentials obscure actor identity.

## Gate 15: Operations, Backup, And Recovery

Purpose:

Make source custody operationally credible.

Required capability:

- repository backup
- metadata backup
- restore rehearsal
- repository integrity checks
- hook failure monitoring
- disk capacity monitoring
- garbage collection policy

Acceptance:

- repo and metadata can restore onto a clean target.
- restored repo passes `git fsck`.
- restored metadata can answer latest refs and event history.
- backup freshness is visible.
- failed hooks or mirror workers surface as operator attention.

Stop conditions:

- "artifact exists" is treated as recovery proof.
- backup excludes either Git object data or metadata.
- restore cannot prove clone/fetch/push after recovery.

## Gate 16: Production Security Hardening

Purpose:

Prepare BitterGit for hosted customer source custody.

Required capability:

- TLS termination posture
- request size limits
- process isolation for Git backend
- slug/path traversal tests
- auth bypass tests
- rate limits
- audit log durability
- dependency/security scan
- abuse and storage quota policy

Acceptance:

- invalid paths cannot access repositories outside storage root.
- unauthenticated clone/push behavior matches policy.
- large push limits are enforced or explicitly configured.
- audit logs survive restart.
- security tests cover auth, pathing, ref policy, and secret scanning.

Stop conditions:

- public service accepts arbitrary filesystem path input.
- Git subprocesses run with broader permissions than needed.
- logs include tokens or secrets.

## Gate 17: Workflow Projection To GitHub

Purpose:

Project Bitter issues/PRs to GitHub when useful, without making GitHub
canonical by accident.

Required capability:

- optional issue projection
- optional PR projection
- sparse comments for major transitions
- canonical Bitter IDs in GitHub bodies/comments
- divergence detection for direct GitHub edits

Acceptance:

- BitterGit-primary mode keeps Bitter issue/PR canonical.
- GitHub issue/PR body names Bitter source of truth.
- projection is quiet and useful.
- direct GitHub edits are imported or marked divergent by policy.
- GitHub merge button is not the default canonical merge path in
  BitterGit-primary mode.

Stop conditions:

- projection creates noisy comments for every tiny event.
- GitHub numbers become canonical Bitter IDs.
- GitHub API compatibility expands beyond proven workflow need.

## Gate 18: Scale And Performance

Purpose:

Keep the service boring as repository count, push volume, and workcell count
grow.

Required capability:

- concurrent clone/fetch/push tests
- repo count/load tests
- hook throughput tests
- mirror worker backpressure
- storage growth visibility
- Git GC scheduling

Acceptance:

- concurrent pushes to different repos do not block globally.
- concurrent writes to the same ref resolve with Git's normal semantics.
- mirror backlog is visible and bounded.
- common operations have measured latency.
- performance tests run in CI or an equivalent repeatable harness.

Stop conditions:

- global locks serialize unrelated repositories.
- mirror failure blocks source pushes.
- unbounded event or hook queues can consume disk unnoticed.

## Gate 19: Customer Launch Readiness

Purpose:

Prove BitterGit supports the $49 app-backstage wedge.

Required capability:

- no-GitHub app creation
- hosted backstage entry
- source history
- restore
- publish/deploy path
- secret setup path
- clear export/mirror story
- support/debug receipts

Acceptance:

- first-time user can create an app and get to a usable workcell.
- app has source history automatically.
- user can undo an agent mistake.
- deploy cites source commit.
- user can export source or connect GitHub later.
- support can inspect source/deploy/receipt state without SSH.

Stop conditions:

- onboarding requires GitHub.
- source history exists only as hidden implementation detail.
- undo/restore requires manual Git expertise.

## Gate 20: Standalone Service Boundary

Purpose:

Decide whether BitterGit should remain embedded or become an independently
operated service.

Required decision inputs:

- source custody risk
- deploy coupling
- account/HUB coupling
- operational burden
- backup and recovery boundary
- API consumers
- failure domain

Acceptance:

- service boundary decision is documented.
- if standalone, API, storage, deploy, backup, and incident boundaries are
  explicit.
- if embedded, ownership and extraction triggers are explicit.

Stop conditions:

- service split occurs because the name exists, not because the boundary earns
  it.
- source custody and deploy truth are collapsed into one unclear service.

## Gate 21: Account And Plan Assertion

Purpose:

Prove BitterGit can consume account/app/plan authority without becoming the
account system.

Required capability:

- local signed account assertion accepted for customer app creation
- owner/account derived from assertion, not a free-form owner field
- one-app plan entitlement enforced before creating a second active app
- plan summary exposes `github_required=false`
- support/debug can show account, app, and plan refs without tokens, secrets,
  or billing internals

Acceptance:

- `POST /bittergit/v1/customer/apps` creates an app from assertion-shaped
  authority.
- a malicious or accidental `owner` field in the request body is ignored.
- a one-app assertion cannot create a second active app.
- `GET /bittergit/v1/customer/plan` returns a sanitized plan summary.
- legacy local dev-token repo creation still works for internal smokes.

Stop conditions:

- customer onboarding accepts free-form owner authority.
- GitHub becomes required for plan or app creation.
- plan/support responses expose secret material, token values, Stripe details,
  card details, or billing internals.

## Gate 22: App Bundle Creation

Purpose:

Create the paid-user app bundle as one orchestrated operation.

Required capability:

- one API operation creates the account-scoped app record, BitterGit repo,
  blank source scaffold, initial checkpoint, setup/support receipt, and setup
  state
- blank source contains only `AGENTS.md`, `APP.md`, and `.gitignore`
- `AGENTS.md` explains the Bitter environment, `bitter` CLI, BitterGit-backed
  source, no-secret-commit rule, small checkpointable work, and first charter
  task
- `APP.md` starts as a placeholder charter with purpose, user, first useful
  version, workflow, constraints, axes of excellence, and non-goals
- setup state is visible through API, support-debug, and the app UI
- GitHub remains optional and does not appear as a required default choice

Acceptance:

- `POST /bittergit/v1/customer/app-bundles` produces the complete bundle.
- the repository tree contains exactly `AGENTS.md`, `APP.md`, and `.gitignore`.
- the initial checkpoint is anchored to the blank scaffold commit.
- the setup receipt cites app/account/repo/checkpoint/source tree evidence.
- support-debug includes setup state without token or secret material.

Stop conditions:

- default app creation creates a fake framework, fake README, or placeholder app
  before chartering.
- GitHub is required or presented as a default onboarding choice.
- setup can fail without a persisted repairable state.

## Gate 23: Hosted Workcell Session Contract

Purpose:

Replace local checkout-as-proof with a hosted terminal/workcell session
contract that Factory/Grid can later fulfill.

Required capability:

- assertion-scoped request creates an app-scoped and account-scoped session
- session records source root, repo id, app id, account ref, workspace ref,
  status, terminal URL or local placeholder, token ref, and agent readiness
- session uses a run-scoped credential helper, not a token embedded in the
  clone URL
- `origin` points to BitterGit, not GitHub
- readiness output tells the user the terminal is ready, source is saved,
  GitHub is optional, and the first task is chartering in `APP.md`
- revoke invalidates later Git write access
- support-debug includes hosted session state without token or secret values

Acceptance:

- `POST /bittergit/v1/customer/apps/:app_id/workcell-sessions` returns a ready
  hosted-session contract.
- the session checkout can push a normal Git branch before revoke.
- the same checkout cannot push after session revoke.
- support-debug shows the session status and readiness posture without token
  material.

Stop conditions:

- terminal/session state is not scoped to the app and account assertion.
- clone URLs contain token material.
- GitHub becomes the default origin.
- revoke only updates UI state and leaves Git write access active.

## Gate 24: Issuer-Shaped Account Assertion

Purpose:

Close the gap between local dev assertions and future Hub/Factory-issued
account authority without making BitterGit the account, OAuth, or billing
system.

Required capability:

- accept a second-generation assertion format with issuer, audience, subject,
  assertion id, key ref, authority kind, account refs, plan fields, and expiry
- reject unknown issuers
- reject audience mismatch
- keep the local dev-token assertion path for internal smoke tests
- plan summary exposes only sanitized authority and plan fields

Acceptance:

- `GET /bittergit/v1/customer/plan` accepts a trusted `bga2` assertion.
- customer app bundle creation works from trusted issuer-shaped authority.
- plan/app responses include issuer, subject, key ref, and authority kind.
- plan/app responses do not expose signatures, token values, secrets, card
  details, Stripe details, or billing internals.

Stop conditions:

- BitterGit owns identity lifecycle, checkout, billing, OAuth, or Stripe state.
- any untrusted issuer can create apps.
- assertions are accepted for the wrong audience.

## Gate 25: Setup Progress And Repair Posture

Purpose:

Make app setup inspectable as a progress flow instead of a final status only.

Required capability:

- setup writes an append-only event trail for each bundle step
- setup state exposes progress percentage, ordered steps, user-facing message,
  repairability, and repair action
- app UI shows setup progress and setup events
- support-debug includes setup progress and event trail without tokens or
  secrets

Acceptance:

- app bundle setup records account app, BitterGit repo, blank source, initial
  checkpoint, and setup receipt events.
- setup API returns `progress_percent=100` for a ready app.
- setup API returns `repairable=false` and a repair action for ready state.
- app UI renders setup progress, setup events, and repair action.
- support-debug includes the same setup progress and event trail.

Stop conditions:

- setup failures can only be diagnosed by SSHing into the host.
- setup state hides which step succeeded or failed.
- repair guidance is absent from API, UI, and support-debug.

## Gate 26: Terminal Handoff Surface

Purpose:

Replace the local terminal URL placeholder with a fetchable terminal handoff
surface and explicit terminal provider contract.

Required capability:

- hosted session returns an HTTP terminal URL
- terminal URL resolves to a redacted handoff page
- session records terminal provider, terminal status, and terminal message
- terminal handoff page shows ready status, source root, BitterGit origin,
  account/app refs, and first-charter prompt
- support-debug includes terminal URL/provider/status without token material

Acceptance:

- `terminal_url` starts with the local HTTP service origin.
- fetching `terminal_url` returns a terminal handoff page.
- terminal page says source is saved in BitterGit, GitHub is optional, and the
  first task is `APP.md` chartering.
- terminal page does not expose token values or GitHub as origin.

Stop conditions:

- terminal URLs are opaque placeholders that cannot be fetched.
- terminal URLs embed Git tokens.
- terminal surface implies GitHub is required.
- BitterGit starts owning production terminal execution instead of a narrow
  handoff contract.

## Gate 27: Agent Readiness Evidence

Purpose:

Replace declared agent readiness with executable evidence from the session
checkout and local environment.

Required capability:

- record readiness checks for source root, BitterGit origin, token-free remote,
  `AGENTS.md`, `APP.md`, Git credential helper, and clean Git status
- record optional detection of `codex` and `claude` CLIs without making either
  mandatory for local prototype success
- expose readiness summary and checks through session response, readiness API,
  terminal handoff page, and support-debug
- avoid exposing token material in readiness output

Acceptance:

- required readiness checks pass for a newly created app bundle session.
- optional CLI checks are present and marked passed or optional-missing.
- readiness API returns `ready` when all required checks pass.
- terminal handoff shows agent readiness evidence.
- support-debug includes readiness evidence without tokens or secrets.

Stop conditions:

- agent readiness is asserted without checking the workcell.
- GitHub is treated as the required origin.
- readiness output leaks credential helper secrets or Git tokens.
- missing optional CLIs block local source-custody proof.

## Gate 28: Production Issuer Trust Contract

Purpose:

Make account/app/plan assertions look like the production Hub/Factory trust
boundary without making BitterGit the account system, OAuth server, billing
system, or key-hosting service.

Required capability:

- trusted issuer configuration is explicit and inspectable without exposing
  signing secrets
- issuer key refs and rotation status are modeled
- active keys are accepted and retired or unknown keys fail closed
- audience, subject, expiry, assertion id, and replay posture are verified
- assertion use records are stored as sanitized metadata
- plan and support/debug surfaces show assertion refs and replay posture without
  signatures, tokens, billing internals, or secret material

Acceptance:

- `GET /bittergit/v1/operations/assertion-trust` returns trusted issuers,
  audiences, key refs, algorithms, and key status without secret values.
- `GET /bittergit/v1/customer/plan` accepts a trusted active-key `bga2`
  assertion and includes an `assertion_trust` proof.
- repeated use of the same assertion id increments use count and reports
  `replay_status=seen_before`.
- unknown issuer, wrong audience, missing subject, missing assertion id,
  expired assertion, retired key, and unknown key are rejected.
- support-debug includes sanitized assertion use records for the account.

Stop conditions:

- BitterGit owns Hub account lifecycle, checkout, billing, OAuth, Stripe state,
  or production key hosting.
- trusted issuer config exposes secret key material.
- assertions are accepted for the wrong audience, unknown issuer, expired
  assertion, missing subject, missing assertion id, retired key, or unknown
  key.
- signatures, tokens, card details, Stripe details, or secret material appear
  in plan/support/debug responses.

## Gate 29: Artifact Import Intake And Review

Purpose:

Let a one-app customer bring a folder or zip from a coding agent artifact into
BitterGit without making GitHub required and without committing unsafe source.

Required capability:

- account-scoped folder and zip import review endpoint
- import plan separates `will_import`, `will_skip`, and `blocked` files
- detected shape reports at least single HTML artifact, static HTML site,
  media bundle, unknown safe source folder, or no importable files
- conservative supported file families include html, css, js, mjs, json, md,
  txt, common images, svg, and fonts
- low-risk junk is skipped with visible feedback, including `.DS_Store`,
  `__MACOSX`, temp files, `node_modules`, and nested archives
- hard blockers include traversal, absolute paths, symlinks, device/special
  files, oversized files, `.env`, private keys, token files, credential dumps,
  and cloud credential material
- support/debug shows safe import metadata, counts, and policy without raw file
  contents or secret previews

Acceptance:

- `POST /bittergit/v1/customer/artifact-imports/review` scans a folder and
  returns importable, skipped, and blocked entries.
- the same endpoint scans a zip file without extracting or committing it.
- blocked reviews report `ready_to_commit=false` and do not create a repo or
  source commit.
- safe static HTML folders and zip files report `detected_shape=static_html_site`.
- traversal and absolute path policy is covered by focused tests.
- `GET /bittergit/v1/customer/artifact-imports/:id/support-debug` returns safe
  metadata only.

Stop conditions:

- source is committed before blockers are resolved.
- GitHub becomes required for artifact import.
- raw file contents, token values, private keys, env values, or full local
  source paths appear in support/debug output.
- unsafe files are silently skipped without feedback.
- a traversal, absolute path, symlink, special file, oversized file, env file,
  token file, credential dump, or cloud credential file is importable.

## Gate 30: Artifact Import App Bundle

Purpose:

Turn an accepted artifact import review into a BitterGit-backed app bundle
without requiring GitHub and without committing skipped or blocked files.

Required capability:

- one account-scoped operation creates app record, BitterGit repo, imported
  source commit, initial checkpoint, setup/support receipt, and ready setup
  state
- operation refuses blocked import reviews before app/repo/source creation
- committed source contains only approved import files plus required app
  scaffolding
- missing `AGENTS.md`, `APP.md`, and `.gitignore` are added
- existing imported `AGENTS.md`, `APP.md`, and `.gitignore` are preserved
- setup state is repairable if import bundle creation fails after app/repo
  creation
- support-debug shows setup and receipt state without raw file contents or
  secret material

Acceptance:

- `POST /bittergit/v1/customer/artifact-imports/:id/app-bundle` turns a ready
  review into a customer app bundle.
- blocked reviews return an error and do not become commit-ready.
- a safe static import with missing scaffold files commits the imported files
  plus `AGENTS.md`, `APP.md`, and `.gitignore`.
- an import that already contains `AGENTS.md`, `APP.md`, and `.gitignore`
  preserves those files exactly.
- source tree proof shows no fake README, fake framework, placeholder package,
  skipped files, or blocked files.
- GitHub remains optional and not part of the default import path.

Stop conditions:

- blocked or skipped files are committed.
- missing charter scaffolding is not added.
- existing charter scaffolding is overwritten.
- GitHub becomes required for artifact import app bundles.
- raw file contents, token values, private keys, env values, or full local
  source paths appear in setup/support/debug output.

## Gate 31: Launch Onboarding UI Flow

Purpose:

Make the default one-app customer path understandable from first page to app
backstage instead of exposing only repo-admin or API-test surfaces.

Required capability:

- root UI presents primary `Start blank` and `Import folder or zip` choices
- Git repo import is secondary/advanced
- no GitHub account, GitHub repo, or GitHub choice is required in the default
  path
- blank-app UI creates the real customer app bundle
- artifact-import UI scans first, shows import/skip/block feedback, and creates
  the real artifact app bundle only from a ready review
- blocked imports show repair language before any source commit
- app page shows setup progress, setup events, repair action, first-charter
  prompt, BitterGit source truth, and optional GitHub posture in plain language

Acceptance:

- `GET /` shows start blank, import folder/zip, and secondary Git import paths.
- posting the blank-app form reaches an app page with setup progress and
  `APP.md` first-task language.
- posting the artifact import review form reaches a review page showing
  `will_import`, `will_skip`, blockers, detected shape, and repair action.
- ready import review can be submitted from UI into an app bundle.
- blocked import review does not show a create-app action and says blocked
  files will not be committed.
- the default UI never asks for GitHub or says GitHub is required.

Stop conditions:

- the first screen feels like raw repo administration rather than app
  onboarding.
- default onboarding asks for GitHub.
- blocked imports can be committed from the UI.
- setup failure lacks visible repair language.
- the UI hides the first task of chartering in `APP.md`.

## Gate 32: Grid Terminal Fulfillment Adapter

Purpose:

Replace the local terminal placeholder posture with a narrow BitterGrid
fulfillment adapter contract while keeping production terminal execution out of
BitterGit.

Required capability:

- hosted session creation requests terminal fulfillment through a Grid-shaped
  adapter contract
- session response records terminal provider, fulfillment id, tokenless route,
  URL, lifecycle, status, source root, app/account refs, and readiness state
- terminal fulfillment can be refreshed through an app/session-scoped API
- terminal URL remains tokenless and points to BitterGit handoff route, not
  GitHub
- revoke updates both Git write authority and terminal lifecycle/status
- support-debug includes terminal fulfillment state without tokens or secrets

Acceptance:

- `POST /bittergit/v1/customer/apps/:app_id/workcell-sessions` returns
  `terminal_fulfillment.provider=bittergrid_adapter_local`.
- `POST /bittergit/v1/customer/apps/:app_id/workcell-sessions/:session_id/terminal-fulfillment`
  refreshes the same Grid-shaped fulfillment contract.
- terminal handoff page displays route and lifecycle.
- session checkout can push before revoke and cannot push after revoke.
- support-debug shows terminal fulfillment state and redacts token material.

Stop conditions:

- BitterGit starts owning production terminal runtime execution.
- terminal routes or clone URLs contain token material.
- terminal fulfillment points at GitHub as the default source.
- revoke only changes UI state while Git write authority remains active.
- support-debug leaks tokens, credential helper contents, or secret material.

## Gate 33: Hosted Agent Launch Envelope

Purpose:

Make Claude/Codex launch readiness concrete enough for first user work without
BitterGit executing the model process or brokering provider API keys.

Required capability:

- hosted agent launch envelope is app-scoped, session-scoped, account-scoped,
  and run-scoped
- launch records provider, source root, BitterGit origin, `AGENTS.md`, `APP.md`,
  first task, run scope, Git token ref, provider auth posture, readiness state,
  and repair action
- provider auth is represented as status/ref only and never as raw credential
  material
- supported providers include `claude` and `codex`
- unsupported provider or missing readiness produces actionable blocked state
- support-debug includes launch envelopes without token or secret values

Acceptance:

- `POST /bittergit/v1/customer/apps/:app_id/workcell-sessions/:session_id/agent-launches`
  creates a ready launch envelope for `codex` or `claude`.
- launch response points the first task to chartering in `APP.md`.
- launch response cites `AGENTS.md` and `APP.md` under the source root.
- unsupported provider creates a blocked launch with failure reason and repair
  action.
- launch can be fetched by id and listed through support-debug.

Stop conditions:

- BitterGit executes Claude/Codex directly as part of this gate.
- provider API keys, local auth files, or token values appear in launch or
  support output.
- launch is not scoped to app/account/session.
- first task skips chartering and jumps into substantial implementation.

## Gate 34: Charter-First First Run

Purpose:

Turn the first hosted agent run into a charter-first contract instead of a vague
prompt suggestion.

Required capability:

- first-run record attaches to a ready hosted agent launch envelope
- first-run prompt tells the agent to complete `APP.md` before substantial
  implementation
- readiness output states that source is saved, GitHub is optional, and the
  first run is charter-only until sufficiency is recorded
- charter analysis checks required sections, axes of excellence, and
  verification gates
- imported artifact apps carry reviewed import context into first-run output
- implementation-start is blocked until charter sufficiency is recorded
- support-debug exposes first-run state without raw source contents, token
  values, or secrets

Acceptance:

- `scripts/smoke-gate-34-charter-first-first-run.sh` proves a blank app first
  run is charter-required and implementation is not allowed.
- the same smoke proves an imported artifact app has inspected import context
  before implementation.
- updating `APP.md` to a sufficient charter and recording sufficiency changes
  the first run to `ready_for_implementation`.
- implementation-start returns blocked before sufficiency and allowed after
  sufficiency.
- terminal readiness copy includes charter sufficiency and verification gates.

Stop conditions:

- a hosted agent can start substantial implementation before charter
  sufficiency is recorded.
- imported source can bypass artifact inspection before first implementation.
- BitterGit forces internal Bitter doctrine into the customer app charter.
- support-debug includes raw `APP.md` contents, token values, or secret-looking
  material.

## Gate 35: BitterPass Secret Grant First Run

Purpose:

Let the first hosted app run declare needed secrets without committing values or
turning BitterGit into the credential vault.

Required capability:

- secret grant request is scoped to app, session, launch, first run, and account
- request creates or updates a repo secret ref without accepting raw values
- request commits a safe source manifest that names required secrets but not
  values, credential refs, or grant tokens
- materialization state is represented as delegated to BitterPass
- receipt/support state shows secret ref and grant status without values
- artifact import blockers for `.env`, keys, token files, and credential dumps
  point users toward the BitterPass secret grant flow

Acceptance:

- `scripts/smoke-gate-35-bitterpass-secret-grant.sh` creates a first-run secret
  grant request through an account-scoped workcell path.
- response, manifest, receipt, and support-debug do not contain secret values,
  Git tokens, credential refs, or grant tokens.
- source contains `.bitter/secrets/<environment>.json` with required secret
  names and explicit value refusal.
- sending a raw secret value is rejected without echoing the value.
- blocked artifact import feedback for `.env` points to the secret grant flow.

Stop conditions:

- BitterGit stores credential values, materialized secret values, or grant
  tokens.
- source manifests include credential refs or any secret-looking value.
- support-debug exposes credential refs, token material, or raw private logs.
- the flow requires GitHub.

## Gate 36: BitterGrid Publish And Verify Integration

Purpose:

Connect source custody to a first publish/verify path while keeping BitterGrid
responsible for runtime execution.

Required capability:

- publish request is account/app-scoped and points to an existing commit SHA
- production publish requires deployable checkpoint context through the existing
  deployment rules
- request records a deployment, Grid operation ref, owner plane, verification
  status, and preview URL when successful
- failed publish records attempted source state and repair action without
  private logs
- response/support output identifies deploy-linked checkpoint restore
  candidates
- receipts cite commit SHA, deployment id, environment, status, and
  verification state

Acceptance:

- `scripts/smoke-gate-36-bittergrid-publish-verify.sh` creates preview and
  production Grid publish requests for a checkpointed commit.
- response states `owner_plane=BitterGrid` and
  `bittergit_role=source_custody_recorder`.
- failed publish returns `repair_required` with a repair action and no private
  logs.
- support-debug includes Grid publish refs, deploy refs, restore candidates,
  and receipts without tokens, secrets, or private logs.

Stop conditions:

- BitterGit executes production deploys or claims runtime ownership.
- publish consumes "latest" without recording a commit SHA.
- production publish bypasses checkpoint/deploy source policy.
- support-debug exposes private deploy logs, token material, or secret values.

## Gate 37: Unified Support And Repair Surface

Purpose:

Make failed onboarding diagnosable from one app-scoped surface without SSH,
secret exposure, raw file dumps, or private logs.

Required capability:

- account, plan, app, repo, setup, import, workcell, terminal, agent,
  charter-first, secret, deploy, and repair states are summarized safely
- failures name owner plane and next repair action
- support surface is account assertion scoped
- support policy states whether tokens, credential refs, secret values, raw file
  contents, private logs, or SSH are required
- repair items cover at least agent launch, charter-first, and Grid publish
  failures when present

Acceptance:

- `scripts/smoke-gate-37-unified-support-repair.sh` creates an imported app,
  ready setup/workcell, blocked agent launch, charter-required first run,
  delegated secret grant, and repair-required Grid publish.
- app support-debug summarizes every plane and reports `needs_repair`.
- repair items include owner planes and non-empty repair actions.
- support-debug omits token values, credential refs, raw imported file contents,
  secret values, and private deploy logs.

Stop conditions:

- support-debug requires SSH for normal onboarding diagnosis.
- support-debug exposes credential values, credential refs, Git tokens, raw
  source contents, or private runtime logs.
- failures appear without owner plane or repair action.
- support surface requires GitHub.

## Gate 38: End-To-End One-App Launch Rehearsal

Purpose:

Prove the paid one-app onboarding path coheres across blank app creation,
folder/zip artifact import, terminal readiness, agent readiness, charter-first
first run, source history, restore, support, and export without requiring
GitHub.

Required capability:

- blank app path creates exactly the charter scaffold and reaches terminal-ready
  state
- zip artifact path scans, reviews, imports, creates the app bundle, and reaches
  terminal-ready state
- both paths keep `github_required=false`
- agent readiness and charter-first output are visible in both paths
- source history, checkpoint, restore, support-debug, and local Git export stay
  green
- `scripts/smoke-all.sh` includes every gate smoke through Gate 38

Acceptance:

- `scripts/smoke-gate-38-end-to-end-one-app-launch.sh` proves the blank path
  through app bundle, hosted session, agent launch, charter-first first run,
  source mutation, checkpoint, restore, support-debug, and export.
- the same smoke proves the zip import path through review, app bundle, hosted
  session, agent launch, and charter-first artifact context.
- no path requires GitHub.
- support-debug omits token values, credential refs, secret values, raw private
  logs, and unsafe file contents.
- the full `scripts/smoke-all.sh` wrapper passes.

Stop conditions:

- GitHub appears as a required default path.
- blank app creates fake implementation or framework files before chartering.
- artifact import commits before review.
- terminal or clone URLs include token material.
- restore/export/source history regress.

## Gate 39: Production SSH Session Option

Purpose:

Represent production SSH as an MVP session option for live diagnostics and
explicit break-glass operation without making production mutation the default.

Required capability:

- hosted workcell session includes `production_ssh` with mode, target,
  owner plane, write flag, and redacted credential posture
- default production SSH mode is read-only diagnostics with write/operate off
- write/operate mode requires explicit session choice and a reason
- session/readiness/terminal output explains production SSH as break-glass or
  live diagnostics
- generated blank app `AGENTS.md` explains read-only diagnostics, write-off
  default, and no key/token/secret exposure
- support-debug exposes mode, target, write flag, owner plane, and access
  status without key material, tokens, private logs, command output, or write
  reason text
- revoking the hosted session marks production SSH access revoked and still
  invalidates Git write access

Acceptance:

- `scripts/smoke-gate-39-production-ssh-session.sh` creates a blank app, opens
  a default hosted session, and proves production SSH defaults to read-only
  diagnostics with write disabled.
- the same smoke proves write/operate mode is rejected without `write_reason`
  and accepted only with an explicit reason.
- terminal output, app `AGENTS.md`, repository support-debug, and customer
  support-debug include the safe SSH posture.
- support/session output does not include token material, private key material,
  private logs, command output, or write reason text.
- revoking the default session sets production SSH access to revoked and a
  stock Git push from the revoked workcell fails.

Stop conditions:

- production SSH write/operate becomes enabled by default.
- SSH key material, tokens, credential refs, command output, private logs,
  secret values, or write reason text appear in source, support-debug,
  terminal output, receipts, or session JSON.
- the gate implements SSH Git or a broad SSH command policy engine.
- production SSH becomes required for normal support diagnosis.
- GitHub becomes required in the path.

## Gate 40: Hub/Factory Issuer Discovery And Rotation

Purpose:

Replace local-only issuer trust with a production-shaped issuer discovery,
rotation, replay accounting, and revocation projection contract.

Required capability:

- operations API exposes sanitized issuer discovery documents with issuer,
  discovery URL, audience, active key refs, retired key refs, algorithm, and key
  validity windows
- rotated active key refs are accepted
- retired, unknown, expired, wrong-audience, and revoked assertions fail closed
- assertion-id revocations and subject/account revocations can be projected
  into BitterGit without BitterGit owning account lifecycle
- plan summaries include key ref, key status, replay status, and revocation
  status while preserving `github_required=false`
- one-app plan enforcement remains active after issuer-discovery validation
- support-debug exposes issuer, key ref, account/app/plan refs,
  replay/revocation state, and revocation projection metadata without tokens,
  assertion bodies, signing secrets, secret values, or billing internals

Acceptance:

- `scripts/smoke-gate-40-issuer-discovery-rotation.sh` proves sanitized issuer
  discovery includes active, rotated, and retired key refs without signing
  secrets.
- the smoke proves a `hub-rotated-key-2` account assertion is accepted and
  reports `revocation_status=not_revoked`.
- the smoke creates assertion-id and subject/account revocations, then proves
  matching assertions fail with `account assertion revoked`.
- the smoke proves one-app plan enforcement still blocks a second active app.
- support-debug includes rotated-key assertion use with replay and revocation
  posture and no token, signature, secret, or billing material.

Stop conditions:

- signing secrets, assertion bodies, token material, secret values, credential
  refs, or billing internals appear in discovery, plan, support, or revocation
  output.
- revoked assertions are accepted.
- retired keys are accepted.
- one-app plan enforcement regresses.
- GitHub becomes required in the path.

## Gate 41: Dedicated Box Grid Workcell Fulfillment

Purpose:

Replace local placeholder fulfillment with a dedicated-box Grid workcell
fulfillment contract that records the production target and remains safe when
only the local adapter is available.

Required capability:

- hosted session creation accepts a Grid terminal fulfillment request for a
  dedicated box
- fulfillment records owner plane, provider, mode, box ref, source root, app id,
  repo id, account ref, origin remote, credential delivery, lifecycle, cleanup
  status, and timestamps
- local smoke can faithfully record dedicated-box intent and fallback to the
  local adapter when the real box is unavailable
- source checkout has `origin` pointing to BitterGit, not GitHub
- Git credential delivery is through a run-scoped credential helper, not a token
  in the clone URL
- fulfillment refresh preserves dedicated-box mode and box ref
- revoke marks fulfillment cleanup revoked and invalidates Git write access
- terminal and support-debug show fulfillment state without tokens, SSH key
  material, private logs, or host logs

Acceptance:

- `scripts/smoke-gate-41-dedicated-box-workcell.sh` creates a blank app and
  requests a dedicated-box terminal fulfillment for `grid-host-01`.
- the session records `provider=bittergrid_dedicated_box_contract`,
  `mode=dedicated_box_local_adapter`, `owner_plane=BitterGrid`,
  `dedicated_box_requested=true`, `dedicated_box_available=false`, and a
  fallback reason.
- the workcell checkout has a tokenless BitterGit `origin` and a credential
  helper.
- terminal fulfillment refresh preserves the dedicated-box contract.
- terminal output and support-debug include box/mode/lifecycle state without
  token/key/secret material.
- revoking the session records cleanup as revoked and a stock Git push from the
  revoked checkout fails.

Stop conditions:

- terminal or clone URLs include token material.
- origin points to GitHub in the default path.
- support-debug exposes tokens, SSH key material, credential refs, private host
  logs, command output, or secret values.
- BitterGit executes terminal runtime or production host operations instead of
  recording the Grid-owned fulfillment contract.
- GitHub becomes required in the path.

## Gate 42: Hosted Agent Auth Mount And Launch

Purpose:

Turn the hosted agent launch envelope into a production-shaped provider session
contract without making BitterGit own provider auth, agent runtime, or private
auth files.

Required capability:

- hosted agent launch records provider choice, provider CLI availability, auth
  source, and redacted readiness evidence
- launch readiness confirms `AGENTS.md` and `APP.md` are visible in the source
  root
- first launch prompt directs the provider agent to establish or improve the
  `APP.md` charter before substantial implementation
- missing provider auth produces a blocked, repairable launch state
- missing provider CLI produces a blocked, repairable launch state
- provider auth may record that a reference exists, but must not return the
  reference, auth file path, credential material, API key, or private auth
  output
- support-debug projects the same launch posture safely

Acceptance:

- `scripts/smoke-gate-42-hosted-agent-auth-launch.sh` creates a blank app and
  hosted workcell session, then creates a ready `codex` launch with explicit
  CLI availability and mounted auth source.
- the ready launch records provider CLI availability, provider auth source,
  source-root scaffold visibility, tokenless BitterGit origin, run-scoped
  credential-helper delivery, and a launch contract that blocks substantial
  implementation until `APP.md` has charter standards.
- the same smoke sends sentinel provider credential refs and auth file paths
  and proves they do not appear in launch JSON, support-debug, source, or
  terminal URLs.
- the smoke proves missing provider auth blocks with
  `provider_auth_not_mounted` and a repair action.
- the smoke proves missing provider CLI blocks with
  `provider_cli_unavailable` and a repair action.
- support-debug includes ready and blocked launch states without token
  material, provider API keys, auth file paths, credential refs, private auth
  material, or secret values.

Stop conditions:

- provider API keys, credential refs, auth file paths, token material, private
  auth output, secret values, or terminal tokens appear in launch JSON,
  support-debug, receipts, source, or terminal URLs.
- missing provider auth or CLI is treated as ready.
- first launch prompt allows substantial implementation before chartering.
- BitterGit starts brokering provider auth values or executing the provider
  runtime instead of recording the launch contract.
- GitHub becomes required in the path.

## Gate 43: BitterPass Materialization Handoff

Purpose:

Make first-run secret grants become delegated BitterPass materialization
requests for workcells and deploy lanes without letting BitterGit own secret
values, credential refs, grant tokens, or materialized secret files.

Required capability:

- BitterGit stores safe secret names, environments, grant status, and
  materialization status only
- app secret APIs do not return raw credential refs
- first-run secret grant creation creates workcell and deploy materialization
  requests delegated to BitterPass
- materialization requests expose owner plane, target plane, target ref, safe
  secret name, environment, request status, and repair action only
- app-level readiness shows whether workcell and deploy secret materialization
  requests exist for an environment
- missing grants produce repairable readiness states
- support-debug projects grants, materialization requests, and readiness safely

Acceptance:

- `scripts/smoke-gate-43-bitterpass-materialization-handoff.sh` creates a
  blank app, hosted session, agent launch, and charter-first run.
- before any grant, app materialization readiness reports `missing_grants` for
  both workcell and deploy targets with a repair action.
- creating a first-run secret grant sends sentinel credential refs, grant
  tokens, and private vault output, then proves they do not appear in grant
  response, secrets API, source manifest, support-debug, or customer
  support-debug.
- the secret grant response includes exactly two materialization requests:
  `workcell` and `deploy`, both delegated to BitterPass.
- readiness after the grant reports `ready`, names the required secret, and
  reports both workcell and deploy materialization as delegated to BitterPass.
- support-debug includes materialization request and readiness state without
  secret values, credential refs, grant tokens, private vault output, or
  materialized files.

Stop conditions:

- raw secret values, credential refs, grant tokens, private vault output, or
  materialized secret file contents appear in source, receipts, support-debug,
  setup progress, logs, terminal URLs, or user-visible API responses.
- BitterGit stores new raw credential refs for first-run grants.
- missing grants are reported as ready.
- workcell/deploy readiness cannot name the owner plane and repair action.
- BitterGit starts acting as BitterPass or materializing secret files itself.
- GitHub becomes required in the path.

## Gate 44: Grid Publish Callback And Receipt Intake

Purpose:

Turn publish/verify from a local immediate simulation into callback-driven Grid
receipt intake while keeping BitterGit responsible only for source-cited custody
records.

Required capability:

- publish requests can be created in callback mode, citing an existing commit
  SHA and checkpoint/deploy context
- each callback-mode publish records a Grid operation ref before the callback
- Grid callbacks update publish status, published URL where applicable,
  verification result, Grid receipt id, callback timestamp, and repair action
- successful callbacks create source-cited verification and callback receipts
- failed callbacks create repairable state without storing private deploy logs
- callback receipts expose restore candidates anchored to checkpoint/commit
- BitterGit rejects private deploy logs in callback payloads

Acceptance:

- `scripts/smoke-gate-44-grid-publish-callback.sh` creates a callback-mode
  publish request and proves it starts as `awaiting_grid_callback`.
- the smoke sends a successful Grid callback with matching Grid operation ref,
  commit SHA, published URL, verification status, and Grid receipt id.
- the successful callback updates the publish request to `verified`, records
  callback status, records the Grid receipt id, creates verification evidence,
  and returns a `grid_publish_callback` receipt.
- the smoke creates a second callback-mode publish, proves callbacks containing
  private logs are rejected without echoing the log content, then records a
  clean failed callback as `repair_required`.
- support-debug includes verified and failed callback state, source-cited
  callback receipts, and restore candidates without private logs, stack traces,
  token material, secret values, or deploy output dumps.

Stop conditions:

- private Grid logs, stack traces, token material, secret values, or deploy
  output dumps appear in callback responses, receipts, support-debug, logs, or
  setup progress.
- callbacks can update a publish request with mismatched commit SHA or Grid
  operation ref.
- failed callbacks are treated as verified.
- callback receipts are not anchored to commit SHA and checkpoint/deployment
  context.
- BitterGit executes deploys instead of recording Grid-owned callbacks.
- GitHub becomes required in the path.

## Gate 45: Factory/Bitter One-App Onboarding UI Wiring

Purpose:

Wire the product path a cold one-app customer will actually see: account/plan
state, blank or artifact app creation, setup result, hosted terminal readiness,
and charter-first guidance with GitHub optional.

Required capability:

- home/onboarding surface shows the one-app plan and account continuation
  posture
- primary choices are Start blank and Import folder or zip
- Import Git repo is visible only as a secondary/advanced path
- GitHub is never required in default onboarding copy
- blank app creation immediately creates a hosted workcell session and returns
  a result page with setup state and terminal readiness
- artifact import review shows import/skip/block feedback before commit
- artifact app bundle creation immediately creates a hosted workcell session
  and returns a result page with setup state and terminal readiness
- terminal readiness says source is saved, GitHub is optional, hosted terminal
  is ready, and the first task is chartering in `APP.md`
- cold-user copy avoids internal runtime architecture language

Acceptance:

- `scripts/smoke-gate-45-one-app-onboarding-ui.sh` proves the home page shows
  one-app plan state, account continuation, Start blank, Import folder or zip,
  advanced Git repo import, and no required-GitHub language.
- the smoke creates a blank app through the UI and verifies setup progress,
  hosted terminal readiness, source-saved copy, GitHub-optional copy,
  `APP.md` chartering guidance, and no token/internal-runtime leakage.
- the smoke reviews a safe folder artifact, creates the imported app, and
  verifies import result, hosted terminal readiness, source-saved copy,
  GitHub-optional copy, and charter-first guidance.
- the smoke reviews a blocked artifact and verifies blocked/repair feedback
  appears before source commit and no create-app action is shown.

Stop conditions:

- GitHub is required or presented as a default prerequisite.
- folder/zip import can commit blocked files.
- terminal readiness omits source saved, GitHub optional, hosted terminal ready,
  or charter-first guidance.
- token material, private logs, dev credentials, or internal runtime language
  appears in the cold onboarding flow.
- UI only exposes raw repo/admin concepts instead of the one-app customer path.

## Gate 46: Live Setup Progress Streaming

Purpose:

Expose setup/import/workcell progress through a stable polling contract that UI,
CLI, and support surfaces can follow without exposing private material.

Required capability:

- app setup progress can be fetched through a stable polling API
- progress payload includes status, current step, percent complete, polling
  posture, user-readable step labels, owner planes, events, and repair fields
- step labels are stable and understandable to a cold user
- failures can name owner plane and repair action through the same shape
- support-debug projects the same progress shape safely
- progress omits token material, secret values, raw source contents, private
  logs, credential refs, and setup internals that confuse the user

Acceptance:

- `scripts/smoke-gate-46-live-setup-progress.sh` creates a blank app bundle and
  fetches `/bittergit/v1/customer/apps/:app_id/setup/progress`.
- the progress payload reports `stable_poll`, complete progress for ready
  setup, user-readable labels, owner planes, repair fields, and chartering
  guidance.
- setup events are projected with labels, owner planes, timestamps, messages,
  and repair fields.
- support-debug includes the same progress projection.
- progress and support payloads omit token material, secret values, raw source
  contents, private logs, and provider/auth material.

Stop conditions:

- progress requires SSH or private host access for normal onboarding diagnosis.
- progress payloads expose tokens, credential refs, secret values, raw source
  contents, private logs, or provider auth material.
- failures cannot name owner plane and repair action.
- setup steps are only internal jargon and not suitable for a cold user.
- GitHub becomes required in the path.

## Gate 47: Production One-App Rehearsal On Dedicated Box

Purpose:

Prove the production-shaped one-app path coheres across blank app creation,
artifact import, dedicated-box terminal fulfillment, hosted agent launch,
charter-first work, delegated secrets, Grid callbacks, source recovery, export,
support, and no-GitHub posture.

Required capability:

- blank app bundle reaches dedicated-box terminal/workcell readiness
- zip or folder import bundle reaches dedicated-box terminal/workcell readiness
- hosted agent launch reaches ready state, or a repairable blocked state with
  owner plane and repair action
- charter-first first run is visible and blocks substantial implementation
- production SSH defaults to read-only diagnostics with write/operate off
- secret materialization is delegated to BitterPass for workcell and deploy
  owner planes, or clearly repairable if grants are absent
- Grid publish/verify is callback-driven and records source-cited receipts
- source history, checkpoint, restore, support-debug, and export remain green
- GitHub is optional throughout the default onboarding paths

Acceptance:

- `scripts/smoke-gate-47-production-one-app-rehearsal.sh` creates a blank
  one-app bundle and a zip-import one-app bundle under separate one-app account
  assertions.
- both paths request dedicated-box terminal fulfillment and reach ready
  workcell/session state through the local dedicated-box adapter.
- both paths keep `origin` pointed at BitterGit without embedded token
  material, and production SSH defaults to read-only with write disabled.
- the blank path exercises ready hosted agent launch, charter-first first run,
  missing-secret repair posture, BitterPass materialization requests, Grid
  callback receipt intake, checkpoint creation, restore to the initial
  checkpoint, local Git export, source event visibility, and safe support-debug.
- the import path proves import review feedback, skipped junk feedback,
  imported source scaffold, dedicated terminal readiness, agent readiness,
  charter-first artifact context, setup progress, and safe support-debug.
- no support, progress, terminal, receipt, or app/session payload exposes
  token material, assertion bodies, credential refs, secret values, private
  SSH key material, provider auth files, raw source contents, or private logs.
- `scripts/smoke-all.sh` includes Gate 47 and remains green.

Stop conditions:

- GitHub becomes required for either default one-app path.
- a dedicated-box session embeds tokens in clone URLs or points `origin` at
  GitHub.
- production SSH write/operate is enabled without explicit opt-in.
- secret values, credential refs, grant tokens, provider auth files, private
  host logs, or key material leak into BitterGit surfaces.
- Grid publish/verify requires BitterGit to execute deploys.
- source restore/export or stock Git compatibility regresses.

## Gate 48: Hub/Factory To BitterGit Account Bridge

Purpose:

Make customer app creation use production-shaped account/plan authority from
Factory/Hub instead of local BitterGit-only assertions.

Required capability:

- Factory can mint a BitterGit `bga2` assertion from a Hub-backed Factory
  account and plan projection
- BitterGit validates the Factory bridge issuer, audience, key ref, assertion
  id, subject, expiry, account refs, and plan authority
- app creation derives owner/account from the assertion, not a free-form owner
  field
- one-app entitlement blocks a second active app
- plan summary states `github_required=false`
- support/debug shows account/app/plan/issuer refs without assertion bodies,
  tokens, billing internals, or secret material
- local dev-token paths remain only for internal smokes and stock-Git proof

Acceptance:

- Factory service test proves `Bittergit::AccountAssertionIssuer` emits a
  BitterGit-compatible `bga2` assertion from account subscription and
  entitlement state, with `github_required=false`, one-app limits, and a
  display-safe summary that excludes signing material and assertion bodies.
- `scripts/smoke-gate-48-hub-factory-account-bridge.sh` uses a Factory-shaped
  bridge assertion against BitterGit, fetches plan summary, creates one
  BitterGit-primary app bundle, verifies the owner/account came from the
  assertion, verifies app count/remaining slots, and verifies a second app is
  rejected by the one-app entitlement.
- customer and repo support-debug expose account refs, workspace refs, plan
  refs, issuer/key refs, replay state, and `github_required=false` without
  assertion bodies, token material, billing internals, or secret material.
- `scripts/smoke-all.sh` includes Gate 48 and remains green.

Stop conditions:

- GitHub becomes required for default customer app creation.
- app creation accepts customer-supplied owner authority for the account path.
- one-app entitlement can create two active apps.
- Factory bridge summaries, BitterGit plan summaries, support-debug, logs, or
  receipts expose assertion bodies, HMAC secrets, bearer tokens, billing
  internals, credential refs, or secret material.
- BitterGit becomes the account, billing, or Hub authority instead of consuming
  a narrow assertion.

## Gate 49: Public Git URL Import App Bundle

Purpose:

Let a customer create a BitterGit-primary app directly from a public GitHub or
Git URL without requiring a GitHub account.

Required capability:

- one customer API operation creates an account-scoped app record, BitterGit
  repo, imported Git refs, required `AGENTS.md`, `APP.md`, `.gitignore`,
  initial checkpoint, setup/import receipt, and setup state
- source import uses `GIT_TERMINAL_PROMPT=0`
- URLs with embedded credentials are rejected before app creation
- import summary shows safe source URL host/path, source kind, provider,
  default branch, imported branch/tag counts, HEAD SHA, scaffold added or
  preserved state, and repairable posture
- missing `AGENTS.md`, `APP.md`, and `.gitignore` are added without
  overwriting existing imported files
- no GitHub account is required for public import
- support/debug includes safe import metadata only

Acceptance:

- `scripts/smoke-gate-49-public-git-url-import-app-bundle.sh` builds a local
  public-Git-shaped source remote, imports it through
  `POST /bittergit/v1/customer/git-import-app-bundles`, and verifies the
  resulting app is BitterGit-primary with `github_required=false`.
- the smoke verifies imported source files and the required charter scaffold
  are present in the resulting source tree.
- the smoke verifies default branch, branch count, tag count, HEAD SHA,
  scaffold-added state, and `terminal_prompt_disabled=true` appear in the
  import summary.
- setup progress shows user-readable Git import and charter-file steps.
- support/debug projects safe Git import metadata without token material,
  assertion bodies, private key material, raw source contents, or credential
  material.
- the smoke posts an embedded-credential URL and verifies it is rejected
  without consuming the one-app entitlement.
- `scripts/smoke-all.sh` includes Gate 49 and remains green.

Stop conditions:

- GitHub account/OAuth becomes required for public Git import.
- import can prompt for credentials or hang on terminal auth.
- source URLs with embedded credentials are accepted or recorded.
- rejected credential URLs consume an app slot.
- missing `AGENTS.md`, `APP.md`, or `.gitignore` leaves the app without
  charter-first scaffolding.
- support/debug, setup progress, receipts, logs, or responses expose assertion
  bodies, token material, credential refs, raw source contents, secret values,
  private key material, or private logs.

## Gate 50: Factory Create-App Source Modes

Purpose:

Make the real Factory Create App API and UI support BitterGit-primary source
creation while keeping GitHub optional in the default onboarding path.

Required capability:

- Factory Create App offers `Start blank`, `Import GitHub/public Git URL`,
  `Import folder/zip`, and `Advanced existing GitHub/Git provider`
- default source mode is BitterGit blank app creation, not GitHub
- public Git URL import posts to BitterGit as the canonical source custodian
- Factory uses the production-shaped BitterGit account assertion bridge
- Factory stores BitterGit app/repo refs, clone URL, setup status, and safe
  import source metadata on the app record
- folder/zip is visible as a local artifact path but remains blocked until an
  artifact is attached/reviewed
- connected GitHub is only required for the advanced provider path
- dry-run plan and success responses are display-safe and cold-user friendly

Acceptance:

- Factory controller tests prove dry-run source-mode offers without GitHub,
  embedded-credential Git URL rejection before app creation, and confirmed
  public Git URL creation through the BitterGit client with persisted app/repo
  refs.
- Factory UI component tests prove the Create App page defaults to blank
  BitterGit creation without requiring GitHub, supports public Git URL import
  without a GitHub connection, keeps GitHub OAuth warnings limited to the
  advanced provider path, and preserves the existing connected-GitHub provider
  workflow.
- default Create App copy says BitterGit is the app source home and GitHub is
  optional.
- the source plan displays status, custody, and whether GitHub is optional
  without exposing tokens, assertion bodies, billing internals, credential
  refs, raw source contents, or secret material.

Stop conditions:

- GitHub becomes required for blank app or public Git URL onboarding.
- Factory stores token-bearing clone URLs or source URLs with embedded
  credentials.
- Factory sends customer-created app authority to BitterGit without a
  production-shaped account/plan assertion.
- folder/zip import commits source before review.
- Create App responses, UI, logs, or support surfaces expose assertion bodies,
  token material, credential refs, private logs, provider auth files, or secret
  material.

## Gate 51: Real Grid Terminal Fulfillment

Purpose:

Replace the local Grid-shaped terminal adapter as the only proof with a real
BitterGrid API fulfillment path for the test workcell.

Required capability:

- hosted session creation can request Grid API fulfillment
- BitterGit issues a run-scoped Git token for the app session
- BitterGit sends Grid a tokenless BitterGit repo URL plus credential-helper
  material, not a token-bearing clone URL
- Grid workcell creation/upsert is app-scoped and account-scoped
- Grid ensure and execution-session attachment are requested
- terminal URL, Grid workcell refs, execution-session refs, source root, status,
  lifecycle, and repair action are recorded in the hosted-session contract
- revoke invalidates BitterGit write access and asks Grid to destroy/cleanup
  the workcell
- support/debug shows terminal/workcell state without token, secret, provider
  auth, private log, or credential material

Acceptance:

- `scripts/smoke-gate-51-real-grid-terminal-fulfillment.sh` starts a fake Grid
  API and an isolated BitterGit server with Grid API mode enabled.
- the smoke imports a public-Git-shaped app bundle into BitterGit-primary
  custody, requests a hosted workcell session with `mode=grid_api`, and verifies
  the session uses provider `bittergrid_api`.
- the fake Grid API receives workcell create/upsert, ensure, execution-session,
  and terminal-plan requests.
- Grid receives `repo_url` pointing to BitterGit without token material or
  GitHub, and receives credential-helper username/password material out of band
  from the URL.
- session/support/revoke responses omit BitterGit tokens, Grid service tokens,
  private keys, provider auth material, and secret values.
- revoking the session revokes BitterGit write authority and requests Grid
  workcell cleanup.
- `scripts/smoke-all.sh` includes Gate 51 and remains green.

Stop conditions:

- the Grid workcell clone URL embeds a token or points at GitHub as the
  canonical origin.
- Grid fulfillment is not app/account scoped.
- support/debug, terminal, session, receipt, log, or revoke payloads expose
  token material, provider auth files, credential refs, private logs, private
  key material, or secret values.
- BitterGit starts owning terminal runtime execution instead of calling Grid.
- failed Grid fulfillment leaves no repairable status.

## Gate 52: Real Provider Readiness And Charter-First Launch

Purpose:

Make hosted agent launch readiness come from the fulfilled workcell and
BitterPass-backed provider bootstrap posture instead of request-body
declarations.

Required capability:

- Grid-backed hosted sessions check source and provider CLI readiness through
  the Grid executor
- the readiness command verifies `AGENTS.md`, `APP.md`, BitterGit `origin`, and
  provider CLI availability/version
- provider auth readiness is checked through Grid terminal provider-bootstrap
  dry-run with a short-lived BitterPass bundle id
- missing provider bundle or missing provider CLI produces a repairable blocked
  launch
- launch records safe mappings between BitterGit session/run refs, Grid
  workcell/session refs, and optional Factory/Bitter refs
- the first prompt remains charter-first and blocks substantial implementation
  until `APP.md` sufficiency is recorded by the first-run gate
- support/debug omits provider auth bundles, token material, provider auth
  files, private logs, and credential material

Acceptance:

- `scripts/smoke-gate-52-real-provider-readiness-charter-launch.sh` starts a
  fake Grid API and isolated BitterGit server with Grid API mode enabled.
- the smoke creates a BitterGit-primary blank app bundle, requests a Grid API
  workcell session, then creates a hosted `codex` launch with a safe provider
  bundle ref.
- the fake Grid API receives a `/workcells/:id/exec` call for provider/source
  readiness and a terminal provider-bootstrap dry-run call for BitterPass
  readiness.
- the ready launch reports executor-derived CLI source, provider version,
  BitterGit origin, `AGENTS.md`/`APP.md` presence, Grid refs, and
  BitterPass-provider-bootstrap auth posture without returning bundle ids.
- missing provider bundle blocks with `provider_auth_not_mounted` and a
  BitterPass repair action.
- missing provider CLI blocks with `provider_cli_unavailable` while preserving
  safe bundle-ready auth posture.
- support/debug shows ready and blocked launch states without token, bundle,
  provider auth file, private key, or secret material.
- `scripts/smoke-all.sh` includes Gate 52 and remains green.

Stop conditions:

- provider readiness can be marked ready solely from customer request JSON.
- provider auth readiness depends on raw `/auth-src` file paths or raw provider
  credential material.
- launch/support/receipt/terminal payloads expose bundle ids, token material,
  provider auth files, private logs, private key material, or secret values.
- the launch contract allows substantial implementation before charter
  sufficiency or explicit charter-first terminal guidance.
- BitterGit starts owning provider credential custody or provider process
  execution instead of consuming narrow Grid/Pass/Bitter contracts.

## Gate 53: Public Runtime Safety

Purpose:

Make the published service fail closed when it is bound beyond loopback.

Required capability:

- loopback development may use the documented disposable defaults
- non-loopback startup requires distinct explicit bootstrap and assertion
  secrets of sufficient length
- the unauthenticated demo UI is unavailable on non-loopback binds
- terminal handoff routes require authorization when the demo UI is disabled
- server-local folder and zip imports are restricted to a configured root
- the container runs as a non-root user and exposes a health check
- public documentation labels the service experimental and does not imply that
  the demo UI is a production authentication boundary

Acceptance:

- `test/runtime-safety.test.ts` covers loopback and non-loopback policy
- `test/artifact-import-policy.test.ts` covers import-root containment
- `scripts/smoke-gate-53-public-runtime-safety.sh` proves unsafe network startup
  fails and a configured network startup disables the demo UI and protects
  terminal handoff routes
- `scripts/verify.sh` includes Gate 53 and remains green

Stop conditions:

- a network-bound process accepts `dev-token`
- API authorization and assertion signing share the same production secret
- the demo UI can mutate state over a non-loopback bind
- a terminal handoff page is readable without authorization outside the demo UI
- an account-scoped artifact request can read arbitrary server-local paths
- the Docker image runs the service as root

## Long-Horizon Done State

BitterGit is healthy when:

- a user can create an app without GitHub
- the app has a normal Git repository
- agents can use stock Git
- source changes are checkpointed and restorable
- issues and pull requests exist when the app needs them
- externally hosted repos can remain canonical
- GitHub mirroring/export preserves portability
- every deploy cites a commit
- every receipt can trace source, actor, run, verification, deploy, and mirror
  state
- operators can debug custody, mirror, deploy, and receipt issues from product
  surfaces before falling back to SSH

That is the target. Every locally reproducible gate through Gate 53 has
executable smoke coverage; Gate 50 remains a cross-repository Factory proof.
