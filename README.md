# BitterGit

BitterGit is an experimental Git-compatible source-custody service for
AI-assisted app workflows. It uses ordinary Git repositories underneath and
adds app-oriented history, checkpoints, restore, workcell credentials, import
review, and source-linked receipts around them.

> [!WARNING]
> BitterGit is alpha software. It has strong local verification coverage, but
> it is not yet a hardened multi-tenant forge. Do not expose the demo UI or the
> development credentials to a network, and do not entrust irreplaceable source
> to it without independent backups.

## Why it exists

AI tools can create source quickly, but durable custody still requires a real
repository, scoped credentials, recoverable history, and an exact source
revision for every deploy. BitterGit explores that layer without requiring
GitHub as the first step and without inventing a new version-control protocol.

The project currently includes:

- Git smart HTTP through the system `git-http-backend`;
- repository-scoped read, write, and ref policy;
- ref events, checkpoints, diff, restore, and export;
- local and hosted-workcell contracts with token-free remotes;
- conservative folder/zip and Git import review;
- issues, pull requests, mirrors, and source-linked receipts;
- optional account, terminal, secret, agent, and deploy integration contracts;
- redacted support/debug projections;
- an executable gate suite covering the current behavior.

BitterGit is deliberately not a full GitHub clone. Actions, packages, social
features, broad API compatibility, and a custom Git protocol are out of scope.

## Quick start

Prerequisites:

- macOS or Linux;
- [Bun](https://bun.sh/) 1.3.13 or compatible;
- Git with `git-http-backend`;
- Bash and curl.

```bash
bun install --frozen-lockfile
bun run dev
```

The local service listens on `http://127.0.0.1:7420`. The loopback-only demo UI
is available at that address, and `/up` returns service health.

Local development intentionally permits the disposable `dev-token`. A
non-loopback bind refuses to start with that credential, refuses shared API and
assertion secrets, disables the demo UI, and confines server-local imports to a
configured root. See [Getting started](docs/getting-started.md) and
[Configuration](docs/configuration.md) before running anything beyond
loopback.

## Verify

Fast checks:

```bash
bun test
bun run typecheck
bun run build
```

The complete isolated verification run owns a temporary server, data root, and
cleanup:

```bash
scripts/verify.sh
```

It requires curl, ripgrep, zip/unzip, and standard POSIX utilities in addition
to Bun and Git. The verification philosophy and contracts are documented in
[Verification gates](docs/VERIFICATION_GATES.md).

## Run in a container

The image runs as a non-root user and intentionally fails closed until two
strong, distinct secrets are supplied for its network bind:

```bash
docker build -t bittergit .
docker run --rm -p 7420:7420 \
  -e BITTERGIT_DEV_TOKEN="$(openssl rand -hex 32)" \
  -e BITTERGIT_ASSERTION_SECRET="$(openssl rand -hex 32)" \
  -e BITTERGIT_PUBLIC_BASE_URL='http://localhost:7420' \
  -v bittergit-data:/data \
  bittergit
```

This makes the API reachable; it does not turn the demo UI into production
authentication. Put BitterGit behind TLS and a real identity/control plane,
keep the demo UI disabled, restrict `/data/imports`, and maintain off-host
backups.

## Documentation

- [Getting started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Security model](docs/security-model.md)
- [API overview](docs/api.md)
- [Testing](docs/testing.md)
- [Bitter integration adapter](docs/integrations/bitter.md)
- [Roadmap](ROADMAP.md)

## Community

Bug reports and focused contributions are welcome. Please read
[Contributing](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md), and
[Governance](GOVERNANCE.md) before opening a pull request. Security issues must
be reported privately according to [SECURITY.md](SECURITY.md).

## License

BitterGit is licensed under the [Apache License 2.0](LICENSE).
