# BitterGit

BitterGit is an open-source, self-hosted Git service for AI coding agents. It
keeps ordinary Git repositories as the source of truth and adds scoped
credentials, checkpoints, restore, import review, and source-linked records
around them.

This repository contains the Apache-2.0 server implementation.
BitterGit is the source-custody layer in [Bitter](https://bitter.sh/), a
prepared workspace and CLI for agentic coding, but it can also run on its own.
[BitterGit.com](https://bittergit.com/) describes the product and its hosted
direction, which is currently in early access. Bitter's account, workspace,
agent, secret, deployment, and support services are not bundled in this
repository.

> [!WARNING]
> BitterGit is alpha software. It has strong local verification coverage, but
> it is not yet a hardened multi-tenant forge. Do not expose the demo UI or the
> development credentials to a network, and do not entrust irreplaceable source
> to it without independent backups.

## Why it exists

Starting an app in Bitter should not require creating or connecting a GitHub
account first. For someone who does not already use GitHub, that adds another
account and another setup step before an agent can do useful work. BitterGit
gives each app an ordinary Git repository from the beginning, so its source
stays cloneable, exportable, and compatible with standard Git tools. GitHub and
other providers can still be connected later as mirrors or external sources;
they are options, not prerequisites.

AI tools can create code quickly, but keeping that code under your control
still requires scoped write access, recoverable history, and an exact commit
behind every deploy. BitterGit handles that layer without replacing Git with a
custom version-control protocol.

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
docker run --rm -p 127.0.0.1:7420:7420 \
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
