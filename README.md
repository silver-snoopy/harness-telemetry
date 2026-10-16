# harness-telemetry

Portable telemetry modules for agent harnesses (Claude Code, GitHub Copilot CLI,
VS Code Copilot). First module: **tokenomics** — per-session tokens, real
dollars, time and work-item ids in a git-durable ledger, joined with delivered
work. Usable with or without sdlc-skills.

- Design spec: `docs/spec.md`
- Tests: `npm test` (Node ≥ 18.19, no dependencies)
- Gates (all must exit 0; the CI workflow targets ubuntu/macOS × Node 18.19.0/24;
  verified locally on macOS × Node 24 and 18.19 only, Linux git unverified):
  `npm test`, `node scripts/coverage.mjs`, `node scripts/diff-impl.mjs`,
  `node scripts/inventory.mjs`, `node scripts/migrations.mjs check`
- Never commit raw session data; see `corpus/README.md`.

## Engine (B1)

`tokenomics/` holds the engine extracted from the sdlc-skills reference
(`reference/49577c7`). With no `.agents/tokenomics/settings.json` it behaves
byte-identically to the reference on every corpus case
(`node scripts/diff-impl.mjs` → `differing 0`) — on what a replay observes: the
case's declared output roots byte-for-byte, every event's stdout/stderr
(diagnostics normalised: Node warnings, stack frames and source excerpts) and a
final-state summary of every other path change under the sandbox root, with
content digests, in `__sandbox__/changes.txt`: one JSON array per line,
`["A",path,digest]`, `["M",path,old,new]` or `["D",path,old]`, so a newline or
quote in a path or link target is escaped and one entry never reads as two
(`corpus/CASES.md` §"Replay infrastructure"). Not observed: transient writes
created and undone within the run, file modes, mtimes, empty directories, `.git`
directories, the manifest's `untracked` paths, and anything outside the sandbox
root (e.g. `os.tmpdir()`). A nested git directory is summarised by git plumbing
(HEAD target, and per ref its name, commit count and tip tree); its own commit
ids, dates, messages, index and reflogs are not observed. That summary has
preconditions and limits:

- git must be on `PATH`; without it, git directories are walked as ordinary
  files and `changes.txt` may vary between runs;
- it hashes git's raw committed blob ids, and committed content is not
  scrubbed, so fixtures must not commit sandbox paths or times;
- a detached HEAD contributes only `detached` (the tree it points at is not
  observed);
- it assumes the SHA-1 object format (a SHA-256 repository digests
  differently);
- gitlink (submodule) entries contribute their commit ids.

A ref git cannot read reads `ref <name> unavailable`, and a directory shaped
like a git dir whose summary git cannot take is walked as ordinary files
instead of collapsing. File digests hash the scrubbed content; paths and
symlink targets are scrubbed field by field, and targets outside the scrubbed
roots appear verbatim.
Test-automation behaviour lives
in `tokenomics/extensions/test-automation.mjs`; generic configuration in
`tokenomics/engine/config.mjs`. Inventory: `docs/inventory/B0-INVENTORY.md`.
B1 output is not port-conformant yet (no `writer`, spec §14.7) — that is B2.

## B2 entry (v0.2.1-rc.1)

The eleven spec §14.8 migrations are switchable by `TOKENOMICS_MIGRATIONS`
(`none`, a comma list, or unset = every landed one; none has landed yet).
`node scripts/migrations.mjs check` asserts each migration's diff equals exactly
its declared diff (`corpus/migrations/<id>/migration.json`). The contract and
migration map Plan 4 is written from: `docs/b2/MIGRATION-MAP.md`. Open owner
decisions: `docs/reviews/owner-signoff.md`. Engine record:
`tokenomics/ENGINE-B1.md`.

## B2 close (v0.3.0-rc.1)

All 17 B2 migrations have landed (the eleven spec §14.8 items, the required
`report-conflicts`, `role-dollars` and `report-revision`, and the grouped
`entry-points`, `capture-robustness` and `report-robustness`), so unset
`TOKENOMICS_MIGRATIONS` runs every one. Extension API 2 is frozen. The B2
settings contract (`TA_DEFAULTS`) no longer carries `ratioIntents`: the ratio
intents come from each line's manifest revision (map D1). `none` still merges
over the frozen `B1_DEFAULTS` and reproduces the reference goldens. Ledger:
`docs/plans/plan-4-ledger.md`.

## Install (B3)

Copying never activates. From the repository root, with `<package>` the checkout or package that carries
`tokenomics/`, `<skill>` the installed copy (`.claude/skills/tokenomics` or `.github/skills/tokenomics`) and `<host>`
`claude` or `copilot-cli`:

```
node <package>/bin/harness-telemetry.mjs install tokenomics --target <host>
node <skill>/scripts/install-hooks.mjs --host <host> --git-hook
node <skill>/scripts/doctor.mjs
node <skill>/scripts/doctor.mjs --probe --host <host>
```

1. copies the engine into the repository (changes no host settings, starts no hook);
2. activates: substrate, verified checkpoint, host hooks, git post-commit fallback, and the activation record last;
3. checks the install;
4. probes that the hooks fire in a real host session.

Notes from the B3 fix wave: `--force` on step 1 replaces whatever directory is at the destination, even one that is
not an engine copy. Activation never commits transient working state or a git-ignored / `*.local.json` host file to
the shared store (those are copied beside the checkpoint bundle instead), and its checkpoint holds the operator's
settings as they were. The post-commit hook holds no repository path: it resolves the committing checkout and its
installed copy at run time. The report CLIs that write (`batch-cost`, `build-tokenomics-export`, `team-report` with
`--batch`/`--out`) refuse to run from an inert or refused installed copy. After activation, commit the installed copy,
`.agents/tokenomics/settings.json`, the host config, `.gitignore`, `.gitmodules` and the pointer; to upgrade, copy
every target and then re-run step 2.

Step 1 runs from a clone of this repository:
`git clone https://github.com/silver-snoopy/harness-telemetry` and then
`node harness-telemetry/bin/harness-telemetry.mjs install tokenomics --target <claude|copilot> --repo <project>`.
The npx form (`npx github:silver-snoopy/harness-telemetry#<tag> install …`) is not yet tested or tagged. See
`tokenomics/SKILL.md` for each command and `tokenomics/ENGINE-B1.md` ("B3") for the engine record.
