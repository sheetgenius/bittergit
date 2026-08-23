# BitterGit

**Open-source Git for coding agents, without another signup.**

[Product site](https://bittergit.com/) · [Experience it in Bitter](https://bitter.sh/) · [Quick start](#quick-start) · [Apache 2.0](LICENSE)

[![CI](https://github.com/sheetgenius/bittergit/actions/workflows/ci.yml/badge.svg)](https://github.com/sheetgenius/bittergit/actions/workflows/ci.yml) [![CodeQL](https://github.com/sheetgenius/bittergit/actions/workflows/codeql.yml/badge.svg)](https://github.com/sheetgenius/bittergit/actions/workflows/codeql.yml)

BitterGit is an experimental, self-hostable Git server built for AI coding
agents. It keeps ordinary Git repositories as the source of truth, then adds
scoped access, checkpoints, restore, safer imports, and records tied to exact
commits.

BitterGit also runs on its own. Inside [Bitter](https://bitter.sh/), it provides
ordinary Git custody beneath the workspace and CLI for AI-built software.

> [!WARNING]
> BitterGit is alpha software, not a hardened multi-tenant forge. Keep the demo
> UI and development credentials on loopback. Maintain independent backups and
> test restore before relying on it for important source.

## Why it exists

A GitHub account should not be step zero.

Bitter exists to remove the setup that stands between an idea and a capable
coding agent. For someone who does not already use GitHub, creating and
connecting another account first is an avoidable obstacle.

BitterGit is designed to give each app ordinary Git history from the beginning.
Source stays cloneable, exportable, and compatible with standard Git tools.
Public Git repositories can be imported today. Generic mirrors are optional,
and provider-specific adapters can be added later; none is a prerequisite.

AI tools can create code quickly, but keeping that code under your control
still requires scoped write access, recoverable history, and an exact commit
behind every deploy. BitterGit handles the source side of that contract without
replacing Git with a custom version-control protocol or becoming the deployment
system.

## What ships today

- Standard `git clone`, `fetch`, `push`, and `ls-remote` over smart HTTP.
- Repository- and ref-scoped read and write policy.
- Append-only ref events, checkpoints, diff, restore, and export.
- Folder/zip intake review and policy-checked Git imports.
- Remote URLs without embedded tokens, with scoped credentials supplied
  separately to each working session.
- Lightweight issues and pull requests, plus mirrors, deployment records, and
  receipts that can link back to source commits.
- Clean separation from the systems that own identity, secret values, agent
  execution, and deployment.
- Support diagnostics designed to omit secrets and infrastructure details.
- An executable suite covering stock Git behavior, recovery, imports, and
  security boundaries.

BitterGit is deliberately not a full GitHub clone. Actions, packages, social
features, broad API compatibility, and a custom Git protocol are out of scope.

## How it works

```text
Git client or agent workcell
        |
        v
HTTP authentication
        |
        v
system git-http-backend ---- bare Git repositories
        |
        v
pre-receive ref policy
post-receive event capture ---- SQLite metadata
```

BitterGit owns repositories, source policy, history, and recovery. Commit SHAs
anchor records shared with other systems, while identity, secret values, agent
execution, terminals, and deployment runtimes remain outside its boundary. See
[Architecture](docs/architecture.md) for the full design.

## Quick start

Prerequisites:

- macOS or Linux;
- [Bun](https://bun.sh/) 1.3.13 or newer;
- Git with `git-http-backend`;
- Bash and curl.

```bash
git clone https://github.com/sheetgenius/bittergit.git
cd bittergit
bun install --frozen-lockfile
bun run dev
```

In another terminal, confirm the service is healthy:

```bash
curl -fsS http://127.0.0.1:7420/up
```

The loopback-only demo UI is available at `http://127.0.0.1:7420`.

Local development intentionally permits the disposable `dev-token`. A
non-loopback bind refuses to start with that credential, refuses shared API and
assertion secrets, disables the demo UI, and confines server-local imports to a
configured root. Read [Getting started](docs/getting-started.md) and
[Configuration](docs/configuration.md) before running anything beyond
loopback.

## Verify

Fast checks:

```bash
bun test
bun run typecheck
bun run build
```

The complete isolated run owns a temporary server, data root, and cleanup:

```bash
scripts/verify.sh
```

It requires curl, ripgrep, zip/unzip, and standard POSIX utilities in addition
to Bun and Git. The suite runs every locally reproducible contract through Gate
55. See [Verification gates](docs/VERIFICATION_GATES.md) for the design and
[Testing](docs/testing.md) for prerequisites.

## Run in a container

The included Dockerfile builds a non-root image. A network bind fails
closed until two strong, distinct secrets are supplied:

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
keep the demo UI disabled, restrict `/data/imports`, limit outbound network
access for Git imports according to your trust model, and maintain off-host
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
- [Support](SUPPORT.md)

## Community

Bug reports, focused contributions, and design discussions are welcome. Useful
areas include stock-Git interoperability, backup and recovery, importer
hardening, and accessible history and restore tools. Start in
[Discussions](https://github.com/sheetgenius/bittergit/discussions) or read
[Contributing](CONTRIBUTING.md) before opening a pull request.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md) and
[Governance](GOVERNANCE.md). Report security issues privately according to
[SECURITY.md](SECURITY.md).

## Stewardship

BitterGit is part of [Bitter](https://bitter.sh/). Bitter is built by
[SheetGenius, Inc.](https://company.sheetgenius.com/), founded by
[Michael Ruescher](https://ruemic.com/).

## License

BitterGit is licensed under the [Apache License 2.0](LICENSE).
