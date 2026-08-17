# Contributing

Thank you for helping make source custody safer and more understandable.

## Before opening an issue

- Search existing issues and discussions.
- Use a security advisory, not a public issue, for vulnerabilities or private
  operational details.
- Keep proposals inside BitterGit's source-custody boundary. Broad forge
  features need a concrete app/workcell use case and a verification gate.

## Development setup

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
```

Before requesting review, run the isolated suite:

```bash
scripts/verify.sh
```

See `docs/testing.md` for prerequisites and expected rejected-operation output.

## Change shape

- Make the smallest coherent change that proves the user or custody outcome.
- Add or update an executable test for behavior changes.
- Add a narrow gate to `docs/VERIFICATION_GATES.md` before broad capability.
- Do not commit generated runtime transcripts, customer data, production
  topology, credentials, private logs, or machine-specific paths.
- Preserve stock Git behavior and standard Git vocabulary.
- Keep optional integrations behind explicit boundaries.

## Pull requests

Explain the problem, the chosen boundary, verification commands, and known
gaps. Small pull requests are easier to review and safer to merge.

All commits must include a Developer Certificate of Origin sign-off:

```bash
git commit -s -m "Describe the change"
```

The sign-off certifies the [Developer Certificate of Origin 1.1](https://developercertificate.org/).
No contributor license agreement is currently required.

## Review

Maintainers may ask for a narrower gate, more adversarial tests, documentation,
or a different ownership boundary. Passing tests are necessary but do not
override security, privacy, or scope concerns.
