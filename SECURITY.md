# Security policy

BitterGit is alpha software. Only the current `main` branch receives security
fixes until the project publishes a supported release line.

## Report privately

Use GitHub's private vulnerability reporting:

<https://github.com/sheetgenius/bittergit/security/advisories/new>

Do not open a public issue with exploit steps, credentials, customer data,
private repository names, production topology, or unredacted logs.

Please include:

- the affected revision and configuration;
- impact and realistic attack conditions;
- minimal reproduction steps;
- whether credentials or private data may have been exposed;
- suggested mitigations, if known.

You should receive an acknowledgement within five business days. We will
coordinate validation, remediation, disclosure, and credit with the reporter.

## Deployment warning

Loopback defaults and the demo UI are development aids. Network-bound startup
has additional fail-closed checks, but BitterGit does not yet claim hardened
multi-tenant production readiness. See `docs/security-model.md`.
