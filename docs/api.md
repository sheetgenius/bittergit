# API overview

BitterGit exposes JSON under `/bittergit/v1` and Git smart HTTP at
`/<owner>/<repo>.git`.

## Authentication classes

- bootstrap/admin API calls use `Authorization: Bearer <token>`;
- repository Git and JSON calls use repository-scoped bearer/basic tokens;
- terminal handoff pages require a repository-read bearer token whenever the
  loopback demo UI is disabled;
- customer/app calls use `X-Bitter-Account-Assertion`;
- integration callbacks require their configured owner-plane authority.

Development examples use `dev-token` only on loopback. Tokens must be sent in
headers or a credential helper, never embedded in a URL.

## Core routes

| Method and path | Purpose |
| --- | --- |
| `GET /up` | Process health. |
| `POST /bittergit/v1/repos` | Create a development repository and token bundle. |
| `GET /bittergit/v1/repos` | List repositories. |
| `GET /bittergit/v1/repos/:owner/:repo` | Repository metadata and storage posture. |
| `GET /bittergit/v1/repos/:owner/:repo/events` | Ref transition history. |
| `GET/POST /bittergit/v1/repos/:owner/:repo/checkpoints` | List or create checkpoints. |
| `POST /bittergit/v1/repos/:owner/:repo/checkpoints/:id/restore` | Record and perform a controlled restore. |
| `POST /bittergit/v1/customer/app-bundles` | Create an assertion-scoped blank app bundle. |
| `POST /bittergit/v1/customer/artifact-imports/review` | Review a folder/zip before commit. |
| `POST /bittergit/v1/customer/git-import-app-bundles` | Import Git history into BitterGit-primary custody. |
| `GET /bittergit/v1/providers` | List source provider shapes. |

Additional issue, pull request, mirror, workcell, secret-ref, support, and
integration routes remain experimental. Read `src/server.ts` and the matching
smoke script for the exact current contract; a versioned OpenAPI document is a
roadmap item.

## Git smart HTTP

Stock Git uses:

- `GET /:owner/:repo.git/info/refs`
- `POST /:owner/:repo.git/git-upload-pack`
- `POST /:owner/:repo.git/git-receive-pack`

The implementation delegates protocol handling to the system
`git-http-backend` and records accepted ref changes through hooks.
