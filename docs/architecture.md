# Architecture

BitterGit is a standalone logical source-custody service. Its stable boundary
is ordinary Git smart HTTP plus a JSON API.

```text
Git client or workcell
        |
        v
HTTP auth and ref policy
        |
        v
system git-http-backend ---- bare Git repositories
        |
        v
hooks and event capture ---- SQLite metadata
```

## Owned by BitterGit

- bare repositories and their storage mapping;
- repository/ref/token metadata;
- append-only ref events;
- checkpoints and restore transitions;
- import/export and mirror records;
- source-linked issue, pull request, deployment, and receipt metadata;
- redacted support state.

## Deliberately outside the boundary

- account signup and billing;
- secret values and provider credentials;
- terminal/container execution;
- model execution;
- build and deployment execution;
- customer runtime state.

Optional adapters consume assertions or record owner-plane references for
those systems. A commit SHA anchors cross-service metadata, but BitterGit does
not become the source of truth for the external system.

## Storage

Local development uses SQLite and bare repositories below the configured data
root. Human slugs map to internal repository IDs and hashed storage paths;
slugs are not filesystem authority. Hooks record ref transitions and enforce
write policy.

Hosted operation needs durable volumes, independent backups, integrity checks,
off-host copies, and tested restore. The local store is a reference
implementation, not a claim of production multi-tenancy.

## Source postures

- **BitterGit primary:** BitterGit is canonical; external remotes are optional
  export or mirrors.
- **External primary:** another Git provider is canonical; BitterGit records
  linked workflow evidence.
- **Import then detach:** history is imported, then BitterGit becomes canonical.

One app must have one canonical source of truth at a time. Bidirectional sync
requires explicit divergence detection and recovery policy.
