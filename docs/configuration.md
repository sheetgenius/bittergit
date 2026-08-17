# Configuration

All settings are environment variables. Defaults are for disposable loopback
development unless stated otherwise.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BITTERGIT_HOST` | `127.0.0.1` | HTTP bind host. Network binds trigger fail-closed validation. |
| `BITTERGIT_PORT` | `7420` | HTTP port. |
| `BITTERGIT_PUBLIC_BASE_URL` | local service URL | Public clone URL base. Put TLS termination in front for hosted use. |
| `BITTERGIT_DATA_ROOT` | `.var/bittergit` | SQLite, bare repositories, workcells, and local operational data. |
| `BITTERGIT_DEV_TOKEN` | `dev-token` on loopback | Bootstrap API token. A network bind requires at least 32 characters. |
| `BITTERGIT_ASSERTION_SECRET` | development token on loopback | Local assertion signing secret. A network bind requires a distinct value of at least 32 characters. |
| `BITTERGIT_ASSERTION_AUDIENCE` | `bittergit` | Required account assertion audience. |
| `BITTERGIT_ASSERTION_TRUST_REGISTRY` | local development registry | JSON issuer/key registry. It contains signing material and must be supplied through a secret owner plane. |
| `BITTERGIT_ENABLE_DEMO_UI` | enabled only on loopback | Enables unauthenticated demo mutations. Network-bound startup rejects it. |
| `BITTERGIT_ARTIFACT_IMPORT_ROOT` | unrestricted on loopback; `<data-root>/imports` otherwise | Root for server-local folder/zip imports. Real paths outside it are rejected. |
| `BITTERGIT_ARTIFACT_IMPORT_MAX_FILE_BYTES` | `5242880` | Per-file artifact import limit. |
| `BITTERGIT_MAX_REQUEST_BYTES` | `1048576` | HTTP request body limit. |
| `BITTERGIT_RATE_LIMIT_PER_MINUTE` | `600` | Per-process request limit. This is not a substitute for edge abuse controls. |
| `BITTERGRID_API_URL` | unset | Optional Grid-compatible workcell API base. |
| `BITTERGRID_SERVICE_TOKEN` | unset | Optional Grid service credential; never put it in a URL. |
| `BITTERGIT_GRID_HOST_SLUG` | `grid-host-01` | Grid adapter host selector. |
| `BITTERGIT_GRID_TERMINAL_MODE` | `local_adapter` | Terminal fulfillment adapter mode. |
| `BITTERGIT_GRID_TERMINAL_PUBLIC_BASE_URL` | public BitterGit base | Public terminal route base for the Grid adapter. |
| `BITTERGIT_GRID_WORKCELLS_ROOT` | `/var/lib/bittergrid/workcells` | Grid adapter workspace-root projection. |
| `BITTERGIT_GRID_TERMINAL_IMAGE_REF` | unset | Optional terminal image reference. |
| `BITTERGIT_GRID_TERMINAL_IMAGE_SOURCE_REPO` | unset | Optional source repository cited by that image. |

## Network-bound minimum

At minimum, set strong and distinct `BITTERGIT_DEV_TOKEN` and
`BITTERGIT_ASSERTION_SECRET` values. Leave `BITTERGIT_ENABLE_DEMO_UI` unset or
false. Mount only intended artifacts below `BITTERGIT_ARTIFACT_IMPORT_ROOT`.

The startup guard is a last line of defense, not a complete production auth
story. Use TLS, a real identity/control plane, network isolation, off-host
backups, monitoring, and external rate limiting.
