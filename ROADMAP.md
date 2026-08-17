# Roadmap

BitterGit's current core proves Git smart HTTP, scoped credentials, durable
metadata, checkpoints and restore, safe import review, workcell contracts, and
source-linked integration receipts. The next work is public-release hardening,
not broader forge emulation.

## Near term

1. Replace the demo account/UI path with a documented standalone identity and
   authorization boundary.
2. Replace server-local artifact paths with streamed upload intake rooted in
   controlled temporary storage.
3. Add schema migration/version policy and clean installation upgrades.
4. Add scheduled backup, off-host copy, and restore-rehearsal tooling suitable
   for self-hosters.
5. Publish a stable API subset and compatibility policy.
6. Add release artifacts, checksums, SBOMs, and a supported container image.
7. Exercise Linux CI, container restart, and concurrent Git workloads on every
   release.

## Community priorities

- clearer stock-Git interoperability reports across clients and proxies;
- storage integrity, backup, and recovery improvements;
- safer token issuance and rotation interfaces;
- importer hardening and framework-neutral artifact support;
- accessible source history and restore UX;
- optional provider adapters that do not make a provider canonical by accident.

## Explicit non-goals

- implementing the Git wire protocol by hand;
- cloning the complete GitHub API or `gh` CLI;
- Actions, package registries, social discovery, stars, or a marketplace;
- bidirectional source sync without explicit divergence policy;
- making one deployment, identity, or secret platform mandatory.

New capabilities should begin as a narrow addition to
`docs/VERIFICATION_GATES.md` with executable proof.
