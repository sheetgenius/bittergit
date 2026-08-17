# AGENTS.md

Start here for BitterGit work.

BitterGit is an experimental Git-compatible source-custody service for
AI-assisted app workflows. It is not a GitHub clone, a production-ready forge,
an identity provider, a secret vault, or a deployment runtime.

Read these before making product, architecture, or implementation changes:

1. `README.md`
2. `ROADMAP.md`
3. `docs/architecture.md`
4. `docs/security-model.md`
5. `docs/VERIFICATION_GATES.md`
6. `CONTRIBUTING.md`

## Current hard stop

Every locally reproducible gate through Gate 53 has executable coverage. Gate
50 is a cross-repository Factory contract and is not part of the standalone
BitterGit suite. Run `scripts/verify.sh` before treating a meaningful change
as safe.

Do not expand into broad forge work without adding a narrow verification gate.
In particular, do not add SSH Git, LFS, Actions, packages, federation, teams,
review comments, full GitHub API compatibility, or `gh` compatibility without
a gate contract and smoke proof.

Keep these invariants green:

- stock Git clone, fetch, push, and `ls-remote` compatibility;
- one canonical source of truth per app;
- source custody, checkpoints, restore, and export;
- token-free remote URLs and run-scoped credential helpers;
- refusal to store secret values;
- support/debug redaction;
- non-loopback startup safety;
- repository-read authorization for terminal handoff pages outside the demo;
- server-local artifact imports restricted to an allowed root.

## Development posture

- Prefer boring Git plumbing and `git-http-backend` over custom protocol code.
- Keep Git as the substrate while hiding unnecessary ceremony from beginners.
- Use standard nouns: repository, issue, branch, commit, pull request, merge,
  remote, and mirror.
- Keep account, terminal, secret, and deploy integrations behind narrow
  interfaces. BitterGit records source truth; it does not own those systems.
- Add an executable test for every new security or custody claim.
- Keep generated data under `.var/` or an explicit temporary data root.
- Never commit runtime proof transcripts, customer identifiers, production
  topology, private logs, credentials, or secret-shaped real values.
- Treat the local demo UI and `dev-token` as loopback-only development aids.
- Preserve unrelated working-tree changes and stage only the files you own.

## Verification

Fast checks:

```bash
bun test
bun run typecheck
bun run build
```

Full isolated verification:

```bash
scripts/verify.sh
```

The full wrapper owns its server, temporary data root, and cleanup. Gate
contracts live in `docs/VERIFICATION_GATES.md`; observed CI output belongs in
the pull request, not in committed proof transcripts.

## Security boundary

Loopback development may use disposable defaults. A non-loopback process must
fail startup unless strong, distinct bootstrap and assertion secrets are set.
The unauthenticated demo UI must never be exposed on a network bind. Artifact
imports must remain inside `BITTERGIT_ARTIFACT_IMPORT_ROOT` outside local
development.

If a change would weaken one of those rules, stop and explain the requirement
instead of adding a bypass.
