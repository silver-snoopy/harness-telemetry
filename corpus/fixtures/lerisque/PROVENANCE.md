# LeRisque fixture (vendored, minimal)

Source: the LeRisque repository (a local checkout, read-only), commit `50615f1`, read with
`git show 50615f1:<path>`. Owner decision 2026-10-14: a minimal copy pinned to that commit; the wiring script
(`.claude/tests/_assert_hook_wiring.py`) runs byte-for-byte unchanged.

Purpose: the B3 gate (`scripts/b3-gate.test.mjs`) activates tokenomics on this repository shape and proves
LeRisque's own hook-wiring test still passes, with its output unchanged.

## Verbatim (sha256 checked by the gate test)

| path | sha256 |
|---|---|
| `.claude/settings.json` | `44d1f89394aea3f621f46394468d5c8888edf29daf8fa43ff42b42d7cd15e8fb` |
| `.claude/hooks/_run.sh` | `3f233692f590813363ffe81cb288a196d2abfc26304cd15f969c6bafa9fbdb40` |
| `.claude/tests/_assert_hook_wiring.py` | `a596f3a3e523e023d00f551d994ef645d8054f6d119740a9f31c95e9af289c86` |

## Stubs (one-line comment; names as at `50615f1`)

`.claude/hooks/block-firewall.py`, `block-unmanaged-issue-create.py`, `check-doc-rot.py`, `check-file-budget.py`,
`check-non-null-assertion.py`, `check-silent-catch.py`, `check-stub-patterns.py`, `py-syntax-check.py`, `_shell_lex.py`.
The wiring script only needs the files to exist and be wired.

## Not from LeRisque

- `githooks/commit-msg`: a stub that exits 0. LeRisque has no such file at `50615f1`; it stands in for a foreign
  git hook that activation must leave untouched.
- `.agents/tokenomics/settings.json`: `substrate.required: "submodule"`, `extension: null`.
