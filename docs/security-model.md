# Security model

BitterGit holds source, so its first obligation is to preserve integrity and
fail closed when custody is ambiguous.

## Current protections

- repository IDs map untrusted slugs to bounded storage paths;
- Git writes require repository/ref-scoped token policy;
- tokens are stored as hashes and omitted from clone URLs;
- pre-receive checks reject unsafe paths and high-confidence secret patterns;
- artifact intake reviews import, skip, and blocked files before commit;
- network-bound startup rejects known development credentials;
- API bootstrap and assertion signing secrets must be distinct on a network
  bind;
- the unauthenticated demo UI is loopback-only;
- terminal handoff pages require repository-read authorization outside that
  loopback demo surface;
- non-loopback server-local artifact imports stay under an allowed root;
- support/debug surfaces are designed to omit values, raw private logs, and
  provider auth material.
- support and terminal projections omit server paths, Grid topology refs,
  production SSH targets, credential references, and raw downstream failures;
- protected-ref authorization applies to deletions, pull-request base refs, and
  every destination ref in a generic Git import before mutation begins.

## Development-only surfaces

The local demo UI creates self-signed example account assertions and performs
mutations without a user login. It exists to exercise product contracts on
loopback. It is not an authentication system and startup rejects it on a
non-loopback bind.

The default `dev-token` and assertion secret are also loopback-only. Source
that depends on those defaults must not be deployed to a shared network.

## Known gaps

- no stable standalone identity/session implementation;
- no hardened multi-tenant isolation claim;
- process-local rate limiting only;
- SQLite/local filesystem deployment is not horizontally coordinated;
- no bundled TLS termination;
- server-local artifact paths remain an integration bridge rather than an
  upload service;
- operational backup scheduling and off-host copy are deployment concerns;
- optional external adapters need their own threat models.

## Reporting

Do not open public issues containing exploit details, credentials, private
repository names, or customer data. Follow `SECURITY.md` for private reporting.
