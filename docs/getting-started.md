# Getting started

## Prerequisites

BitterGit currently supports macOS and Linux. Native Windows is not yet a
supported host because hooks and smoke tests assume POSIX shell behavior.

Install:

- Bun 1.3.13 or compatible;
- Git and `git-http-backend`;
- Bash and curl;
- ripgrep, zip, and unzip for the full verification suite.

## Install and run

```bash
git clone https://github.com/sheetgenius/bittergit.git
cd bittergit
bun install --frozen-lockfile
bun run dev
```

Confirm health:

```bash
curl -fsS http://127.0.0.1:7420/up
```

Loopback development enables the demo UI and the disposable bootstrap token
`dev-token`. Neither is suitable for a network bind.

## Create and use a repository

Create a repository through the local API:

```bash
curl -fsS -X POST http://127.0.0.1:7420/bittergit/v1/repos \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"owner":"demo","name":"hello"}'
```

The response includes one-time development read/write tokens. Keep them out of
shell history and remote URLs. A credential helper or an HTTP extra header can
provide a token to stock Git:

```bash
git -c http.extraHeader='Authorization: Bearer <read-token>' clone \
  http://127.0.0.1:7420/demo/hello.git
```

Configure an author, commit, and push using the returned write token. See the
Phase 1 smoke in `scripts/smoke-phase-1.sh` for a complete disposable example.

## Next steps

- Review every setting in `docs/configuration.md` before a non-loopback bind.
- Read `docs/security-model.md`; this is not yet a production-ready forge.
- Run `scripts/verify.sh` before proposing a change.
