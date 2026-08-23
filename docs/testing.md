# Testing

## Fast checks

```bash
bun test
bun run typecheck
bun run build
bun run check:shell
```

Unit tests should use an explicit temporary `BITTERGIT_DATA_ROOT` whenever they
touch storage.

## Full verification

```bash
scripts/verify.sh
```

The wrapper:

1. creates an isolated data root;
2. starts BitterGit on a configurable local port;
3. runs every locally reproducible gate through Gate 55;
4. restarts the service and verifies Gate 3 persistence;
5. removes temporary state.

The scripts intentionally exercise rejected pushes and invalid credentials, so
some `fatal` or `remote rejected` lines are expected before a gate reports
success.

## Adding a gate

Update `docs/VERIFICATION_GATES.md`, add the smallest focused test or smoke
script, include it in the wrapper, and report the observed command/result in
the pull request. Do not commit generated transcripts or live operational IDs.
