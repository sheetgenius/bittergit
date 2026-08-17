# Gate Evidence

The public repository keeps verification contracts in
`docs/VERIFICATION_GATES.md` and executable proof under `scripts/` and `test/`.

Generated proof transcripts are intentionally not committed. They often contain
temporary IDs, absolute machine paths, or operational references that are not
useful to contributors and are inappropriate for a public source repository.

For a change that advances a gate:

- update the gate contract;
- add or amend an executable test;
- record the verification command and result in the pull request;
- state known gaps plainly.
