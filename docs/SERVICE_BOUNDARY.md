# Service Boundary

## Decision

BitterGit is a standalone logical service for Git source custody and the
workflow records that must stay attached to that source. This boundary reduces
source custody risk without turning BitterGit into a broad forge. It is not permission to build a broad forge.

The service remains deliberately narrow. Issues, pull requests, mirrors, and
deployment receipts exist only where they support the app and workcell loop.

## API Boundary

API consumers use the documented HTTP and stock-Git interfaces. Consumers should not read BitterGit
SQLite files or repository storage paths directly.
This keeps authorization and compatibility policy inside the service.

## Storage Boundary

BitterGit owns bare Git repositories, its metadata database, and source-linked
receipts. BitterPass owns secret values. Source commits may name a required
secret, but they must never contain its value.

## Deploy Boundary

BitterGrid owns runtime deploy execution. BitterGit records commit-cited deploy
and verification receipts; it does not become the deployment engine. This
separation limits deploy coupling.

## Backup And Recovery Boundary

The backup and recovery boundary includes both the metadata database and every
bare repository under the configured data root. A valid recovery proves Git
object integrity, metadata counts, and a restored clone before serving traffic.

## Incident Boundary

BitterGit is its own failure domain for source access, Git writes, metadata,
and restore operations. Integration failures should remain visible and
repairable without exposing provider credentials or private runtime logs.

## Consumers

API consumers include app creation, hosted workcells, support tooling, and
deployment receipt producers. Account and entitlement decisions arrive through
assertions; BitterGit does not own billing. Keeping that contract explicit
limits account/HUB coupling.

## Ownership

Maintainers own the service, its data safety, stock-Git compatibility, security
posture, and operational burden. Integrating systems retain ownership of their
accounts, secrets, execution environments, and user interfaces.

## Extraction Triggers

Revisit physical service extraction when source custody risk, independent
scaling, regulatory isolation, or a measured failure domain requires it. The
decision must include the migration, API, observability, and backup plan.

## Non-Triggers

Do not split or expand the service because a provider exposes more forge APIs,
because a UI could display more collaboration features, or because another
system already uses GitHub-shaped nouns. New surface area requires a narrow
customer or workcell need and a verification gate.
