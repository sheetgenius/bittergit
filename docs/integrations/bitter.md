# Bitter integration adapter

BitterGit includes optional contracts for a broader app-workcell stack:

- account/plan assertions;
- Grid-shaped terminal fulfillment;
- provider-agent readiness;
- delegated secret materialization posture;
- source-cited deploy callbacks.

These modules are examples of narrow integration boundaries. They are not
required for the core Git remote, and they do not make any particular account,
secret, terminal, model, or deployment service mandatory.

The central ownership rule is:

```text
BitterGit owns source custody and source-linked evidence.
Identity owns accounts.
A vault owns secret values.
A workcell system owns execution.
A deploy system owns runtime truth.
```

Self-hosters can implement equivalent adapters by preserving the same safety
properties: scoped assertions, token-free remotes, redacted support data, exact
commit references, explicit owner planes, and repairable failure states.
