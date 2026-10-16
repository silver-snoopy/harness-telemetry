# harness-telemetry — Plan 5 (B3): install path, activation gate, probe, git fallback

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A foreign repo can copy the engine, activate it behind a verified checkpoint, prove its hooks fire, and fall back to a git post-commit sweep. The B3 gate runs the documented commands on a vendored LeRisque fixture, and LeRisque's wiring test passes unchanged. Tag `v0.4.0-rc.1`.

**Architecture:** Three phases.
- **Phase A (Tasks 1–3), foundations.**
  - Task 1 closes the parked harness items.
  - Task 2 adds `ENGINE.json` (the version source and hash baseline) and the skill's `SKILL.md`.
  - Task 3 adds the `install` copy command.
- **Phase B (Tasks 4–10), activation and verification.**
  - Task 4: the activation gate.
  - Tasks 5–7: substrate, checkpoint and the activation flow.
  - Tasks 8–10: git fallback, `doctor`, probe.
- **Phase C (Tasks 11–12).** The LeRisque fixture with the B3 gate test, then the close.

**What stays fixed.**
- The corpus replays the engine from the source checkout. The source checkout is never gated, so `TOKENOMICS_MIGRATIONS=none` stays byte-identical to the reference, and every B2 declared diff stays exact.
- Nothing in B3 is a migration. The installer is outside the corpus (owner sign-off row 1, tied to B3). The activation gate only engages in a copied install.

**Tech Stack:** Node ≥ 18.19, ESM, stdlib only, `node:test`, git ≥ 2.30 on PATH. `python3` on PATH for the LeRisque wiring test. Repo `~/dev/harness-telemetry`, branch `main`, start `60d8982` (tag `v0.3.0`).

**Spec:** `~/dev/harness-telemetry/docs/spec.md` (v4.2).
- **Sections:** §2, §3.1, §3.7, §12 (the B3 row), §14.1, §14.2, §14.4, §14.9, §14.10, §14.12, §15.1, §18.5, §18.6.
- **Also binding:**
  - `docs/reviews/owner-decisions-2026-10-12.md`: Q3 (production switch set `{}`) and Q14 (B3 moves the version source to `ENGINE.json`);
  - `docs/reviews/owner-signoff.md`: row 1, and the README-wording deferral at `:57`;
  - `docs/b2/MIGRATION-MAP.md` `:89`, `:101`, `:224`, `:272-309`;
  - `docs/plans/plan-4-ledger.md` `:289` (the parked B3 items).

**Not in this plan:**
- The published `npx github:<owner>/…` form. There is no GitHub owner or remote, and publishing is parked (spec §13 Q2). The commands run from a local package copy, and the docs show the npx form as "when published".
- The contents of the `tokenomics-port` skill (C1).
- The sdlc-skills external, the immutable cache and the TA extension's install path (B5).
- Shadow run, rescue release and rollback (B4).
- LeRisque's `_run.sh` convention for Node hooks (C1 glue).

## Global Constraints

- **Runtime.** Node ≥ 18.19; `"type": "module"`; **no dependencies** (stdlib plus `node:test`).
  - Node 18.19 locally: `export npm_config_cache=<scratchpad>/npmcache; N18=$(npx -y node@18.19.0 -p process.execPath)` (`~/.npm` is not writable).
- **Never:**
  - modify `reference/`;
  - read `~/dev/harness-telemetry-corpus-raw/`;
  - push or add a remote;
  - write to `~/dev/LeRisque` (read-only; Task 11 vendors from it).
- **Goldens are never hand-edited.** Regenerate only with the sanctioned tools: `scripts/goldens.mjs`, `scripts/migrations.mjs write` and `write-interaction`.
- **Migrations off = pure extraction.** After every commit, `node scripts/diff-impl.mjs` reports `differing 0`, and `node scripts/migrations.mjs check` (the full check) reports `problems 0`. B3 adds no migration and changes no landed migration's output.
- **Every gate is green after every commit, on Node 24 and Node 18.19:**
  - `npm test`;
  - `node scripts/coverage.mjs`;
  - `node scripts/inventory.mjs`;
  - `node scripts/diff-impl.mjs`;
  - `node scripts/migrations.mjs check` (about 14 minutes: run both Node versions in the background, in clean clones).

  Each new `TOKENOMICS_*` name, TA word or path site is added to `docs/inventory/engine-allowlist.json` with a reason and exact counts.
- **Tests.**
  - Never stub `process.stdout`: spawn a child.
  - `node --test <dir>` does not work; pass files.
  - Every git-using test isolates git: `GIT_CONFIG_GLOBAL=<temp file>`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_ALLOW_PROTOCOL=file`, a test identity through `-c` or env, and no network.
  - Pattern: `sdlc-skills/skills/delivery-monitor/scripts/installed.test.mjs:12-29`.
- **Hermetic install tests** (spec §14.2):
  - copy the package's published files to a temp directory;
  - run `install` from there into a temp consumer repo;
  - **delete the temp package**;
  - run every later documented command from the installed copy only.
- **Hooks never fail the host.**
  - An inert, refused or erroring hook exits 0.
  - It writes one stderr line that names the cause and the remedy (spec §2: sync failure never fails a hook).
  - "Inert" is never silent: `doctor` reports it as a failure.
- **Commits.**
  - Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Work on `main`.
  - Tags are local `-rc.N`.
- **Subagent models.**
  - **Opus:** Tasks 4–7, 10 and 12, and every final or milestone review.
  - **Sonnet:** Tasks 1–3, 8, 9 and 11, and their task reviews.
  - Never switch a model silently. On a spend or quota stop, resume the same model or ask the owner.

## Owner decisions applied (binding; do not re-ask)

- **2026-10-14, install URL.** "Skip only the npx/published part."
  - B3 builds the `install` copy command and runs it locally: `node <package>/bin/harness-telemetry.mjs install tokenomics --target <claude|copilot>`.
  - The npx form is documented for when the package is published, and is not gated.
- **2026-10-14, LeRisque fixture.** Vendor a minimal copy, pinned to LeRisque commit `50615f1`:
  - `.claude/settings.json`;
  - the `.claude/hooks/` file names as stubs;
  - `_run.sh`;
  - `.claude/tests/_assert_hook_wiring.py`, verbatim;
  - the `commit-msg` hook.

  The wiring script runs byte-for-byte unchanged.
- **2026-10-14, `tokenomics-port`.** Reserve the name only. `install tokenomics-port` exits 2 with "the tokenomics-port skill ships in milestone C1".
- **2026-10-14, probe.** Automated tests use fake `claude` and `copilot` binaries. At close, the controller runs one real Claude probe on a throwaway LeRisque clone, with a cheap model and the 120 s cap, and records the result.
- **Q3:** the production switch set is `{}`.
- **Q14:** the engine version source moves to `ENGINE.json`. The replay keeps pinning `TOKENOMICS_ENGINE_VERSION_PIN`.
- **Process (as B2):** one Codex milestone pass at close (Task 12). Its findings are fixed and listed in the ledger, with no re-review loop.

## Design decisions fixed by this plan (spec: "fixed in the plan")

- **D-ENG. `tokenomics/ENGINE.json`.**
  - Shape: `{"engine": "<semver>", "extensionApi": 2, "files": {"<path relative to tokenomics/>": "sha256:<hex>", …}, "installed": null}`, with `files` sorted.
  - **Baseline set:** every file under `tokenomics/` except `ENGINE.json`, `*.test.mjs`, `fixtures/**`, `extensions/**` and `ENGINE-B1.md`. A standalone install has no extension (spec §14.1).
  - `scripts/engine-manifest.mjs` writes the file, and `--check` fails when it is stale. A test runs `--check`, so a stale baseline fails `npm test`.
  - `engine` starts at `0.4.0`, and `package.json` `version` equals it (also tested).
- **D-INST. The copy marks itself.**
  - `install` copies exactly the baseline files, plus `ENGINE.json` with `installed: {"target", "from", "at"}`. `from` is the package's `git describe --tags --always` when available, else `"unknown"`.
  - The source checkout's `ENGINE.json` keeps `installed: null`. That is the only thing that distinguishes the two.
- **D-ACT. Activation state** (`tokenomics/engine/activation.mjs`, `activationState(engineRoot, repo, env)`):
  - `source`: `ENGINE.json` is absent, or `installed` is null. No gate, which keeps reference-era copies and the corpus unchanged.
  - `active`: an installed copy, and the repo's `.agents/tokenomics/settings.json` has `engine` equal to `ENGINE.json.engine`.
  - `inert`: an installed copy whose activation is missing or names another version. This covers an interrupted upgrade.
  - `refused`: an installed copy with `TOKENOMICS_MIGRATIONS` set to any value (Q3: production switch set `{}`; the harness lever is not a production switch).

  Every writer entry point calls it first: `telemetry-capture`, `scope-hook`, `otel-sink` and the writing `work-scope` commands. Only `source` and `active` proceed.
- **D-REC. The activation record** is `settings.json` `"engine": "<version>"` (spec §14.4 example), written last.
- **D-SUB. Substrate.**
  - The submodule form follows spec §2: branch `telemetry`, `url = ./`, `ignore = all`, materialised.
  - **Verify** means all four, checked through git: `git config -f .gitmodules`, `submodule status`, and the branch in the submodule.
  - If it fails and `substrate.required === "submodule"`, activation fails.
  - Otherwise activation also fails, unless the operator passes `--plain-folder`, which records `substrate: {"form": "plain-folder"}`. The plain-folder form is never chosen silently.
  - No git repository at all also fails activation, because no verified checkpoint is possible.
- **D-CKPT. Verified checkpoint.**
  - **Store.** Every file under `.agents/telemetry/` (tracked, modified or untracked) is committed on the store's history: the `telemetry` branch, or for the plain-folder form an orphan ref `refs/tokenomics/store` built through a temporary index, so the main working tree is untouched. Transient working-state markers (`.pending-*`, `.nagged-*`, `.unclosed-*`) are excluded.
  - **Main tree.** A record `.agents/telemetry/.checkpoints/pre-engine-<version>/checkpoint.json` holds `{version, at, mainTreeCommit, copied: [...]}`. Every main-tree file in scope (`.agents/tokenomics/**`, plus each harness wrapper the installer will touch) that is clean and tracked is named by `mainTreeCommit`. Every one that is uncommitted or untracked is copied under `…/main-tree/<path>` in the same commit.
  - **Tag and bundle.** The commit is tagged `pre-engine-<version>` in the store's repository. A bundle of that tag is written to `$(git rev-parse --git-common-dir)/tokenomics/pre-engine-<version>.bundle` and checked with `git bundle verify`.
  - **Re-run.** If the tag already exists, the checkpoint is reused only when its bundle verifies. The tag is never moved.
  - **Offline:** no fetch and no push; the checkpoint is local and valid.
- **D-HOST. Targets and hosts.**
  - `install-hooks --host <claude|copilot-cli|vscode>` is required. `copilot` is accepted as an alias of `copilot-cli`. A missing `--host` is a usage error listing the targets (spec §14.4 names).
  - Each host is wired to the copy the script runs from.
  - `settings.targets` records every activated target.
  - The Stop gate is wired only when `enforcement.stopGate === "on"`. A fresh settings file is written with `{"announce": true, "stopGate": "off"}` (§14.12).
- **D-MAN. `module.json`.**
  - On a fresh activation, `install-hooks` writes `<telemetry dir>/module.json` and `manifests/1.json` (the same document) if neither exists:
    - `module`: `"tokenomics"`;
    - `schema_version`: `"1"`;
    - `domain`: `settings.dir`;
    - `manifestRevision`: `1`;
    - `receipts`: `{source: "files", root, file, deliveredOutcomes}` from settings;
    - `ratioIntents`: `[settings.intents.default]`.
  - Both are validated against `tokenomics/kit/schemas/module.json`.
  - An existing revision is never rewritten. A mismatch with settings is reported and left for `--update-manifest`, which writes revision N+1 and its archive.
- **D-PROBE. Probe transport.**
  - Variables:
    - `TOKENOMICS_PROBE=<nonce>`, a 32-hex nonce;
    - `TOKENOMICS_STATE_DIR=<temp dir>`, where the telemetry directory, scopes, markers and the fired log all resolve, so the probe never touches the repo's store;
    - `TOKENOMICS_NO_SYNC=1` and `TOKENOMICS_NO_CCUSAGE=1`.
  - **Fired record.** Every hook entry, before any other work, appends `{"event", "host", "at"}` to `$TOKENOMICS_STATE_DIR/probe/<nonce>.jsonl` when it sees `TOKENOMICS_PROBE`.
  - **Guard.** A probe child with `TOKENOMICS_PROBE` already set never starts a probe.
  - **Host commands** (overridable for tests through `TOKENOMICS_PROBE_CLAUDE_BIN` and `TOKENOMICS_PROBE_COPILOT_BIN`):
    - Claude: `claude -p <prompt> --model <cheap>`;
    - Copilot: `copilot -p <prompt>`.

    The prompt asks for one sub-agent dispatch.
  - **Bound.** The default is 120 s (`--timeout <s>`), after which the child is killed.
- **D-GIT. Git fallback.**
  - The hooks directory comes from `git rev-parse --git-path hooks`, run in the repo, which honours `core.hooksPath` and worktrees.
  - An existing foreign `post-commit` is moved to `post-commit.pre-tokenomics`. Our hook runs it first, preserves its exit code, then starts the sweep detached. `--remove` restores the original.
  - The sweep never delays or fails a commit.

## Review Focus

1. **Re-running activation on an activated repo** (the same version). A reasonable person expects:
   - no new checkpoint commit;
   - no tag moved;
   - no duplicate host hooks;
   - exit 0 with "already active".

   → Task 7 adds "install-hooks twice → identical tree, tags and settings".
2. **A repo that already has a telemetry store from the reference writer, and a delivery-monitor module.** A reasonable person expects:
   - the existing submodule is verified, not recreated;
   - every module's files are inside the checkpoint;
   - nothing is rewritten.

   → Tasks 5 and 6 add a fixture with an `automation/` ledger and a `delivery/` directory on an existing `telemetry` branch.
3. **A repo path containing spaces, and a git worktree.** A reasonable person expects working hook commands and the right hooks directory. → Task 8 adds a worktree test plus a spaced-path test, and Task 7 adds a spaced-path host-wiring test that runs the wired command.
4. **A host CLI that is missing, unauthenticated or hangs.** A reasonable person expects a named `unavailable`, or `not-fired` within the bound, never a hang or a false `fired`. → Task 10 adds fake binaries for all three cases and asserts the wall-clock bound.
5. **A foreign `post-commit` that exits non-zero, or is not executable.** A reasonable person expects:
   - its exit code to stay git's exit code;
   - our sweep never to block;
   - removal to restore it byte-for-byte.

   → Task 8 adds the tests.

---

## Phase A — foundations

### Task 1: Parked harness hardening (plan-4 ledger 38, 188, 238)

**Files:**
- Modify: `replay/observe.mjs` (`gitDirSummary`), `replay/runner.mjs` (content scrub), `tokenomics/engine/entry.mjs` (`drained`)
- Test: `replay/observe.test.mjs` (create if absent), `replay/runner.test.mjs`, `tokenomics/engine/entry.test.mjs`, `tokenomics/hooks/otel-sink.test.mjs`

- [ ] **Step 1: Failing tests.**
  - **38.** A committed path containing `\n` (and one containing `"`) inside a replayed git directory is summarised exactly. Today `ls-tree -r` C-quotes it and the newline split breaks it.
  - **188.**
    - (a) A stream whose `write` throws synchronously: `drained` resolves, and no timer or listener is left behind (assert with `getActiveResourcesInfo()`, or with listener counts plus a short exit-time check in a spawned child).
    - (b) A spawned `otel-sink.mjs` reached through a symlinked path runs its main. This is the B2 item-12 guard, and it was never spawned for this entry.
  - **238.** A replayed output file whose raw content literally contains a scrub token (`<REPO>`, `<HOME>`, or any other token `scrub` emits) is a replay problem `content contains scrub token <T>`. It is never silently equated with the sandbox path.
- [ ] **Step 2: Implement.**
  - `gitDirSummary` uses `ls-tree -r -z` and splits on `\0`.
  - `drained` installs its timer and listeners only after a successful `write` call, and clears them in every exit path.
  - The runner checks raw content for every token before scrubbing.
- [ ] **Step 3: Audit.**
  - Run `node scripts/diff-impl.mjs` and `node scripts/migrations.mjs check`.
  - If any corpus case legitimately contains a token literally, stop and record a ruling: refuse, or allowlist per case with a reason. Never change a golden to pass.
- [ ] **Step 4: Gates, then docs.**
  - `corpus/README.md`: the token refusal.
  - `tokenomics/ENGINE-B1.md`: the `:1215` "parked" note becomes "closed in B3".
- [ ] **Step 5: Commit.** `fix(replay): exact git-dir summaries, drained cleanup, scrub-token refusal (B3 parks 38, 188, 238)`.

### Task 2: `ENGINE.json`, version source, `SKILL.md`, package files

**Files:**
- Create: `scripts/engine-manifest.mjs`, `scripts/engine-manifest.test.mjs`, `tokenomics/ENGINE.json`, `tokenomics/SKILL.md`
- Modify: `tokenomics/engine/version.mjs`, `tokenomics/engine/version.test.mjs`, `package.json`

**Interfaces (produced):**
- `scripts/engine-manifest.mjs`:
  - `export function baselineFiles(root) → string[]`: sorted, relative to `tokenomics/`, applying the D-ENG baseline set.
  - `export function buildManifest(root, { engine }) → object`: the D-ENG shape, with `installed: null`.
  - CLI: `node scripts/engine-manifest.mjs [--check]`. `--check` exits 1 naming each stale or missing path.
- `tokenomics/engine/version.mjs`:
  - `engineVersion(env)` reads, in order: `TOKENOMICS_ENGINE_VERSION_PIN`, then `../ENGINE.json` `engine`, then `'0.0.0+unknown'`.
  - Also export `readEngineJson(engineRoot) → object | null`.

- [ ] **Step 1: Failing tests.**
  - `--check` passes on the committed tree.
  - Editing any baseline file makes `--check` fail, naming it.
  - Adding `engine/x.mjs` fails ("not in baseline").
  - A `*.test.mjs` or `fixtures/` change does not fail.
  - `engineVersion()` with no pin reads `ENGINE.json`.
  - A copy without `ENGINE.json` reads `0.0.0+unknown`.
  - `package.json` `version` equals `ENGINE.json` `engine`.
- [ ] **Step 2: Implement.**
  - Set `engine` to `0.4.0` and `package.json` `version` to `0.4.0`.
  - Add `"files": ["bin/", "tokenomics/", "README.md", "LICENSE"]` to `package.json`, minus the excluded subtrees. Verify with `npm pack --dry-run` in a test, offline.
  - `SKILL.md` frontmatter is `name: tokenomics` plus a description. The body covers what the skill does, the three commands (copy, activate, doctor/probe), that copying never activates, and the D-ACT states, written for a foreign repo (no TA wording).
- [ ] **Step 3:** Run `node scripts/diff-impl.mjs`. It must report differing 0, because the replay pins the version. Then run all gates, adding allowlist entries.
- [ ] **Step 4: Docs.** ENGINE-B1's version-source note (`:1132`) points to `ENGINE.json`, and map Q14 gets an "As landed" note.
- [ ] **Step 5: Commit.** `feat(engine): ENGINE.json version source and hash baseline; tokenomics SKILL.md (B3)`.

### Task 3: The `install` copy command

**Files:**
- Create: `tokenomics/engine/install-copy.mjs`, `tokenomics/engine/install-copy.test.mjs`
- Modify: `bin/harness-telemetry.mjs`, `bin/harness-telemetry.test.mjs` (or create it)

**Interfaces:**
- Consumes: `baselineFiles` and `readEngineJson` (Task 2).
- Produces:
  - `export function installCopy({ packageRoot, repo, target, skill, from }) → { dest, status: 'installed'|'upgraded'|'unchanged', files }`;
  - CLI: `harness-telemetry install <tokenomics|tokenomics-port> --target <claude|copilot> [--repo <dir>] [--force]`.
- Destinations: `claude` → `<repo>/.claude/skills/tokenomics/`; `copilot` → `<repo>/.github/skills/tokenomics/` (§15.1).

- [ ] **Step 1: Failing tests** (hermetic; see Global Constraints):
  - (a) The copy contains exactly the baseline files plus `ENGINE.json`, with `installed.target` set.
  - (b) It never activates: there is no `settings.json` `engine`, and no host config is touched.
  - (c) `tokenomics-port` exits 2 with the C1 message.
  - (d) An unknown target, or a missing `--target`, exits 2 with usage.
  - (e) `--symlink` exits 2 with "symlink installs are rejected until the immutable revision cache (spec §18.6)". A destination that is a symlink is also refused.
  - (f) **Upgrade:**
    - copying a newer version over an older install replaces the engine files only;
    - `settings.json`, glue and host config stay byte-identical;
    - a locally modified or unexpected file in the old install refuses, naming each path, unless `--force`.
  - (g) Re-copying the same version reports `unchanged`, with no writes (mtimes are unchanged).
  - (h) From the copy, with the temp package deleted, every hook and script imports cleanly. Spawn each entry with `--help`, or with its no-op argument, and assert none fails on a missing module.
- [ ] **Step 2: Implement.** The copy is written to a temp sibling directory, then renamed into place, so an interrupted copy never leaves a half tree. Report `unchanged` by comparing hashes.
- [ ] **Step 3: Gates.** The inventory allowlist is updated for the new engine file.
- [ ] **Step 4: Commit.** `feat(cli): install copy command — never activates; tokenomics-port reserved; --symlink rejected (B3, spec §14.2 step 1, §18.6)`.

---

## Phase B — activation and verification

### Task 4: Activation gate and production switch enforcement

**Files:**
- Create: `tokenomics/engine/activation.mjs`, `tokenomics/engine/activation.test.mjs`
- Modify: `tokenomics/hooks/telemetry-capture.mjs`, `tokenomics/hooks/scope-hook.mjs`, `tokenomics/hooks/otel-sink.mjs`, `tokenomics/scripts/work-scope.mjs` (writing commands only)

**Interfaces:**
- `export function activationState(engineRoot, repo, env = process.env) → { state: 'source'|'active'|'inert'|'refused', engine, recorded, reason }` (D-ACT).
- `export function gateOrExplain(engineRoot, repo, env) → boolean`:
  - true for `source` and `active`;
  - otherwise one stderr line, then false. For example: `tokenomics: inactive — engine 0.4.0 copied but not activated (run: node <skill>/scripts/install-hooks.mjs --host <h>)`, or `tokenomics: refused — TOKENOMICS_MIGRATIONS is set in an installed engine (production switch set is {}; unset it)`.
- Hooks call `gateOrExplain` first. On false they exit 0 without reading stores or writing anything.

- [ ] **Step 1: Failing tests** (spawned hooks on a copied engine from Task 3):
  - (a) Copied and not activated: a full Claude Stop, plus a scope-hook event, writes nothing under `.agents/`, exits 0, and prints the inert line.
  - (b) After a hand-written `settings.json` `engine` of `0.4.0` (Task 7 automates this): the same events write the ledger line.
  - (c) An `engine` of `0.3.0` (an interrupted upgrade) is inert again.
  - (d) An installed copy with `TOKENOMICS_MIGRATIONS=none` is refused, writes nothing, and exits 0.
  - (e) From the **source** checkout, with no settings: behaviour is unchanged. `diff-impl` and `migrations check` stay green; this is the real assertion.
  - (f) A copy whose `ENGINE.json` is unreadable is `inert`, with reason `engine manifest unreadable`, never `source`.
- [ ] **Step 2: Implement.** Resolve `engineRoot` from each entry's `import.meta.url`: realpath, then two levels up to `tokenomics/`. Read `settings.json` raw: the gate must not throw where `loadSettings` would.
- [ ] **Step 3:** All gates. The inventory gets the new `TOKENOMICS_MIGRATIONS` read site in `activation.mjs`, with a reason.
- [ ] **Step 4: Docs.**
  - ENGINE-B1: a new section "Activation (B3)" with the four states.
  - Map `:284` / `:307`: enforcement "As landed": installed copies refuse any set.
- [ ] **Step 5: Commit.** `feat(engine): activation gate — copied engines are inert until activated; installed copies refuse migration switches (B3, spec §18.5, Q3)`.

### Task 5: Substrate create, verify, never-silent plain folder

**Files:**
- Create: `tokenomics/engine/substrate.mjs`, `tokenomics/engine/substrate.test.mjs`
- Modify: `tokenomics/scripts/install-hooks.mjs` (`installTelemetrySubmodule` → delegates; `pullTelemetry` unchanged)

**Interfaces:**
- `export function ensureSubstrate(repo, settings, { plainFolder = false }) → { form: 'submodule'|'plain-folder', created: boolean }`. It throws `SubstrateError` (with `code` and a remedy) when the form cannot be verified and plain-folder is not allowed.
- `export function verifySubstrate(repo, settings) → { ok, form, problems: string[] }`, used by `doctor` (Task 9).

- [ ] **Step 1: Failing tests** (isolated git, temp repos):
  - (a) A fresh repo with no remote gets a submodule on branch `telemetry`, with `url = ./`, `ignore = all`, materialised, and the main tree has only `.gitmodules` plus the pointer staged.
  - (b) A repo with an existing `telemetry` branch, carrying `automation/usage-x.jsonl` and `delivery/…` (Review Focus 2), is verified, not recreated. The branch head is unchanged.
  - (c) `commit-tree` succeeds with no global git identity. Today `install-hooks.mjs:370` fails here; fix it as delivery-monitor's installer does (`sdlc-skills/skills/delivery-monitor/scripts/install-hooks.mjs:82,94-104`).
  - (d) An existing branch leaves no dirty submodule checkout. The seed commit is unconditional when files are pending (`:408`).
  - (e) A submodule failure (simulate one, e.g. a `telemetry` path that is a file) with `substrate.required: "submodule"` throws, naming the cause. Without `required` and without `--plain-folder` it also throws, and the message names `--plain-folder`. With `--plain-folder` it returns `plain-folder`.
  - (f) No git repo throws `no-git`.
  - (g) `verifySubstrate` reports each of: wrong branch, `ignore` other than `all`, not materialised, and plain folder not recorded.
- [ ] **Step 2: Implement.** `ensureSubstrate` never falls back silently. Every throw carries a remedy line.
- [ ] **Step 3: Gates.**
- [ ] **Step 4: Commit.** `feat(install): substrate created and verified first; plain folder only by explicit choice (B3, spec §2, §14.2)`.

### Task 6: Verified checkpoint

**Files:**
- Create: `tokenomics/engine/checkpoint.mjs`, `tokenomics/engine/checkpoint.test.mjs`

**Interfaces:**
- `export function takeCheckpoint(repo, settings, { version, form, wrappers }) → { tag, commit, bundle, reused: boolean, copied: string[] }` (D-CKPT). It throws `CheckpointError` on any failed verification.
- `wrappers`: repo-relative paths of the host config files activation will touch (from Task 7's planner).

- [ ] **Step 1: Failing tests:**
  - (a) **Dirty store:** a modified tracked ledger, an untracked new ledger, and a `.pending-x` marker. After the checkpoint, the first two are in the tagged commit and the marker is not.
  - (b) **Offline:** no remote, and separately an unreachable `file:///nonexistent` remote. Both succeed, with no network attempt; assert that `GIT_TRACE` shows no fetch or push.
  - (c) **Main tree:**
    - a clean tracked `.agents/tokenomics/settings.json` is named by `mainTreeCommit`, and the file is not copied;
    - an uncommitted edit to it, plus an untracked wrapper `.github/hooks/tokenomics.json`, are copied under `main-tree/` in the commit.
  - (d) **Bundle:** written under `<git-common-dir>/tokenomics/`; `git bundle verify` passes; cloning the bundle restores the tagged tree byte-for-byte.
  - (e) **Re-run:** the same version is `reused`, and the tag has not moved. A deleted bundle with an existing tag throws `checkpoint-bundle-missing`, naming the remedy (restore the bundle or delete the tag) and never moving the tag.
  - (f) **Plain-folder form:**
    - the orphan ref `refs/tokenomics/store` holds the store;
    - the main working tree and index are untouched (`git status --porcelain` before equals after);
    - the tag and bundle exist.
  - (g) A store holding another module's data (`delivery/`) is fully in the checkpoint.
- [ ] **Step 2: Implement.**
  - Use plumbing with a temporary `GIT_INDEX_FILE`, so the operator's index is never touched.
  - Commit through `-c user.name=tokenomics -c user.email=tokenomics@localhost` when no identity is configured.
- [ ] **Step 3: Gates.**
- [ ] **Step 4: Commit.** `feat(install): verified checkpoint — store committed and tagged pre-engine-<v>, bundle verified, main-tree snapshot (B3, spec §18.5)`.

### Task 7: Activation flow (`install-hooks`)

**Files:**
- Modify: `tokenomics/scripts/install-hooks.mjs` (`main`, `installClaude`, `installCopilot`, `installVsCode`, `seedConfig`, the README text at `:294-306`, the doctor wording at `:584`), `tokenomics/scripts/install-hooks.test.mjs`
- Create: `tokenomics/engine/module-manifest.mjs`, `tokenomics/engine/module-manifest.test.mjs`

**Interfaces:**
- The order of `main` for activation (spec §14.2 step 2):
  1. parse and validate `--host`;
  2. load or create `settings.json`;
  3. `ensureSubstrate`;
  4. `takeCheckpoint`;
  5. module manifest;
  6. host hooks;
  7. ignore lines;
  8. `--git-hook` (Task 8; additive);
  9. **record `engine` last**.
- Each step's failure stops the run with a nonzero exit and leaves activation unrecorded, so hooks stay inert.
- The other modes (`--remove`, `--doctor`, `--pull`, `--otel`) keep working.
- `module-manifest.mjs`:
  - `export function ensureModuleManifest(telemetryDir, settings, { update = false }) → { revision, written: boolean, mismatch: string[] }` (D-MAN).
  - `--update-manifest` writes N+1.
- A fresh `settings.json`:

  ```json
  {"engine": null, "dir": "tokenomics", "extension": null,
   "substrate": {"required": null, "form": "<submodule|plain-folder>"},
   "enforcement": {"announce": true, "stopGate": "off"},
   "targets": [], "receipts": {…TA defaults…}}
  ```

  `dir` defaults to `tokenomics` for a standalone install. `--dir <name>` overrides it. An existing file is merged: only `engine`, `targets`, `substrate.form` and absent `enforcement` keys are written.

- [ ] **Step 1: Failing tests** (hermetic copy from Task 3; spawned CLI):
  - (a) Fresh repo, `--host claude`: the order is observable. Make the hook-wiring step fail via a read-only `.claude/settings.json`; the checkpoint tag exists, and `engine` is not recorded. On a successful re-run, everything is present and `engine` is `0.4.0`.
  - (b) Missing `--host` exits 2 with the list. `--host copilot` equals `--host copilot-cli`.
  - (c) The Stop gate is not wired when `stopGate` is `off`, and is wired after the setting is changed to `on` and activation re-runs.
  - (d) Activating twice is a no-op the second time (Review Focus 1): tree, tags and settings are identical, and the run reports `already active`.
  - (e) **Interrupted upgrade, end to end:**
    1. activate 0.4.0;
    2. copy a synthetic 0.4.1 (a test-built package with `ENGINE.json` `engine` set to 0.4.1);
    3. hooks are inert and capture nothing, with the session's transcript left in the fake store;
    4. run `install-hooks`: a checkpoint `pre-engine-0.4.1` is taken and `engine` is 0.4.1;
    5. the next sweep captures the missed session exactly once.
  - (f) `module.json` and `manifests/1.json` are written once and valid against the kit schema. A changed `deliveredOutcomes` is reported as a mismatch and never rewritten. `--update-manifest` writes `manifests/2.json` and module.json revision 2.
  - (g) A spaced repo path (Review Focus 3): the wired Claude command, run by the test exactly as written in `settings.json` through `sh -c`, reaches the hook.
  - (h) The generated README and doctor text contain no "test-automation factory" and no "cases" (owner-signoff `:57`). Read `settings.vocabulary` where a noun is needed.
- [ ] **Step 2: Implement.** Keep `installClaude`, `installCopilot` and `installVsCode` as the wiring primitives, and plan the wrapper paths for Task 6's `wrappers` before the checkpoint.
- [ ] **Step 3: Gates.** The installer's coverage exclusion (row 1) stays whole-file. Record in the report that B3 now tests the installer directly through these tests.
- [ ] **Step 4: Docs.** `SKILL.md` gets the activation section, ENGINE-B1 gets an "Activation (B3)" flow table, and the map gets "As landed" for `:89`, `:101` and `:224`.
- [ ] **Step 5: Commit.** `feat(install): activation — substrate, checkpoint, manifest, hooks, record last; stop gate installed off (B3, spec §14.2, §14.4, §14.12)`.

### Task 8: Git fallback

**Files:**
- Modify: `tokenomics/scripts/install-hooks.mjs` (`gitHooksDir`, `installGitHook`, the `--git-hook` branch of `main`), `tokenomics/scripts/install-hooks.test.mjs`

- [ ] **Step 1: Failing tests:**
  - (a) `--host claude --git-hook` wires the host **and** the git hook. The early return at `:745-750` is gone. `--git-hook` alone on an active install adds only the git hook.
  - (b) `core.hooksPath=.githooks`: the hook lands there.
  - (c) A linked worktree: the hook lands in the common hooks directory git actually runs, and a commit in the worktree triggers it.
  - (d) **Foreign hook:**
    - an existing executable `post-commit` that writes a marker and exits 3 is chained;
    - after a commit the marker exists, git still reports the commit, our sweep ran, and the hook's exit status (`sh .git/hooks/post-commit; echo $?`) is 3;
    - `--remove` restores the original byte-for-byte.
  - (e) A non-executable foreign hook is chained and left non-executable, and the report says git would not have run it.
  - (f) **A real git-triggered run:**
    - a completed fixture Claude session in a fake store (`TOKENOMICS_CLAUDE_ROOT`) on an activated install;
    - `git commit` produces the session's ledger line, within a bounded wait of at most 20 s that polls the ledger file;
    - the commit returns before the sweep finishes, so the hook never blocks.
  - (g) A spaced repo path.
- [ ] **Step 2: Implement** (D-GIT).
- [ ] **Step 3: Gates. Docs:** `SKILL.md` "git fallback", with the limitation in spec §14.9's words (a session that ends after the last commit is captured only by a later sweep).
- [ ] **Step 4: Commit.** `feat(install): git post-commit fallback — effective hooks path, chains foreign hooks, additive (B3, spec §14.9)`.

### Task 9: `doctor.mjs`

**Files:**
- Create: `tokenomics/scripts/doctor.mjs`, `tokenomics/scripts/doctor.test.mjs`
- Modify: `tokenomics/scripts/install-hooks.mjs` (`--doctor` becomes an alias that runs `doctor.mjs`; the existing warn checks move into it as warnings)

**Interfaces:**
- `node <skill>/scripts/doctor.mjs [--repo <dir>] [--json] [--probe [--host h] [--timeout s]]`. `--probe` is a stub that exits 2 ("Task 10") until Task 10 lands.
- Output: one line per check, `ok` / `warn` / `fail`. Exit 1 on any `fail`. `--json` emits `{checks: [{id, status, detail}]}`.

- [ ] **Step 1: Failing tests.** One test per `fail` check:
  - `integrity`: per installed copy found under `.claude/skills/tokenomics` and `.github/skills/tokenomics`, against that copy's `ENGINE.json`. A changed file, a missing file, or an unexpected file inside an engine directory fails (§14.10).
  - `activation`: `inert` or `refused` fails, naming the remedy.
  - `substrate`: `verifySubstrate` problems fail (§14.2: wrong branch, `ignore` not `all`, not materialised, unrecorded plain folder).
  - `settings`: `loadSettings` throws; a missing or invalid `module.json`, or a missing `manifests/<current>.json`.
  - `targets`: each `settings.targets` host has its hooks wired to an installed copy whose version equals `engine`. The Stop gate's wiring matches `enforcement.stopGate`.
  - `claims` (plan-4 ledger 125): an unreadable `.claim` file under scopes is a `fail` naming the file. A flat-record claim older than the crash window is a `warn`.
  - `switches`: `TOKENOMICS_MIGRATIONS` is set for an installed copy.

  A healthy activated fixture is all `ok`.
- [ ] **Step 2: Implement.** It reads only and never writes (the old `--fix` stays on `install-hooks --doctor --fix` for otel only).
- [ ] **Step 3: Gates. Docs:** the `SKILL.md` doctor section.
- [ ] **Step 4: Commit.** `feat(doctor): integrity, activation, substrate, settings, targets, claims checks — fails, not warns (B3, spec §14.2, §14.10)`.

### Task 10: `doctor --probe`

**Files:**
- Create: `tokenomics/engine/probe.mjs`, `tokenomics/engine/probe.test.mjs`, `tokenomics/fixtures/probe/fake-claude.mjs`, `tokenomics/fixtures/probe/fake-copilot.mjs`
- Modify: `tokenomics/scripts/doctor.mjs`, every hook entry (the fired record), `tokenomics/engine/config.mjs` (`telemetryDir` and scope paths honour `TOKENOMICS_STATE_DIR`)

**Interfaces:**
- `export async function runProbe(repo, { host, timeoutMs = 120000, env }) → { host, result: 'fired'|'not-fired'|'unavailable', reason?, events: {[event]: 'fired'|'not-fired'}, expected: {ledgerLine: 'present'|'missing', scopeStamp: 'present'|'missing'}, mode: 'hooks'|'sweep-only (partial)' }` (D-PROBE).
- Hosts probed: each `settings.targets` host whose CLI is found on PATH, or the one named by `--host h`. `vscode` is always reported as `unavailable: no hooks; verify with a real sidebar session and a sweep (C2)`, never inferred.
- Expected events:
  - Claude: SessionStart, SubagentStop, Stop;
  - Copilot: sessionStart, agentStop.

  The final list comes from `installClaude` and `installCopilot`. Read it from the wired config, not from a constant.
- `sweep-only (partial)`: the session-end events did not fire, a git hook is installed, and a sweep run by the probe after the session produces the expected line.

- [ ] **Step 1: Failing tests.** The fake CLIs read the repo's wired hook config and run the hooks as the host would, with env inherited. Modes are chosen by flag env:
  - (a) Every event fires, the line is written, and the scope is stamped: `fired`, `hooks`.
  - (b) A crashing Stop hook: Stop is `fired` with `expected.ledgerLine: missing`, and the overall result is not success.
  - (c) The binary is missing from PATH: `unavailable: claude CLI not found`.
  - (d) An auth failure (the fake exits 1 with a "not logged in" message): `unavailable: auth`.
  - (e) The binary hangs: the child is killed at `--timeout 3`, the wall clock stays under 5 s, the affected events are `not-fired`, and the result is not `fired`.
  - (f) Session-end hooks are suppressed with a git hook installed: `sweep-only (partial)`.
  - (g) Probe isolation: the repo's `.agents/telemetry` is byte-identical before and after (checked against a git status and tree hash), and every write lands under the state directory.
  - (h) Recursion guard: `TOKENOMICS_PROBE` is already set, so `--probe` exits 2 with "a probe never triggers another probe".
  - (i) With `TOKENOMICS_STATE_DIR` unset, `diff-impl` and `migrations check` stay green.
- [ ] **Step 2: Implement.** The fired record is the first statement after argument parsing in each hook entry, and comes before the activation gate, so an inert hook still proves it fired. The probe prints that the hook is inert.
- [ ] **Step 3: Gates.** The inventory allowlist gets `TOKENOMICS_PROBE`, `TOKENOMICS_STATE_DIR` and `TOKENOMICS_PROBE_*_BIN`.
- [ ] **Step 4: Docs.** The `SKILL.md` probe section, and ENGINE-B1's probe transport table (variables, files, defaults).
- [ ] **Step 5: Commit.** `feat(doctor): --probe — isolated nonce session per host, fired vs expected result, bounded, sweep-only partial (B3, spec §14.9)`.

---

## Phase C — gate and close

### Task 11: LeRisque fixture and the B3 gate test

**Files:**
- Create:
  - `corpus/fixtures/lerisque/` containing:
    - `PROVENANCE.md` (source repo, commit `50615f1`, the file list, what is verbatim and what is a stub);
    - `.claude/settings.json` (verbatim);
    - `.claude/hooks/*.py` (stubs named as at `50615f1`, each a one-line comment);
    - `.claude/hooks/_run.sh` (verbatim);
    - `.claude/hooks/_shell_lex.py` (stub);
    - `.claude/tests/_assert_hook_wiring.py` (verbatim);
    - `githooks/commit-msg` (a stub that exits 0);
    - `.agents/tokenomics/settings.json` (`substrate.required: "submodule"`, `extension: null`);
  - `scripts/b3-gate.test.mjs`
- Modify: `tokenomics/SKILL.md` (the commands block)

**Interfaces:**
- `SKILL.md` carries the documented commands between `<!-- b3-commands:begin -->` and `<!-- b3-commands:end -->`, one per line, using the placeholders `<package>`, `<skill>` and `<host>`. The gate test parses the block and runs exactly those lines, substituting only the placeholders. That is what "exact published commands" means here.

- [ ] **Step 1: Copy the vendored files.** Read them from `~/dev/LeRisque` at `50615f1` with `git -C … show 50615f1:<path>`, read-only. Never write there. Each verbatim file's sha256 is recorded in `PROVENANCE.md`, and a test checks the hashes.
- [ ] **Step 2: Failing gate test** (`scripts/b3-gate.test.mjs`):
  1. Build a temp git repo from the fixture, install `githooks/commit-msg` as `.git/hooks/commit-msg`, and commit.
  2. Run `python3 .claude/tests/_assert_hook_wiring.py` and record its exit code, stdout and stderr.
  3. Run the documented commands for `<host>=claude`: copy, activate with `--git-hook`, `doctor`, and `doctor --probe` with the fake Claude.
  4. Re-run the wiring script. Exit code, stdout and stderr must be identical, and the exit code is 0.
  5. `doctor` is all `ok`, and the probe reports `fired`.
  6. LeRisque's 8 Python hook entries are unchanged in `.claude/settings.json`: deep-equal on their entries, with only our entries added.
  7. The `commit-msg` hook is untouched.
  8. The main tree has only the documented staged changes.
  9. Repeat for `<host>=copilot-cli` (target `copilot`) against the fake Copilot.
- [ ] **Step 3: Gate variants** on the same fixture:
  - **dirty** (an untracked ledger in an existing store before activation);
  - **offline** (an unreachable remote);
  - **interrupted upgrade** (Task 7 (e) through the documented commands).

  Each must pass with the wiring script unchanged.
- [ ] **Step 4: Gates.** If `python3` is missing, the test fails with "python3 is required for the B3 gate". It is never skipped.
- [ ] **Step 5: Commit.** `test(b3): LeRisque fixture gate — documented commands, wiring test unchanged, dirty/offline/interrupted (B3, spec §12)`.

### Task 12: B3 close

- [ ] **Step 1: Docs.**
  - The spec §14.2 and §14.9 "As implemented" notes, in the plan's design-decision terms.
  - `README.md` install section, with the local form and the "when published" npx form.
  - ENGINE-B1 renamed in place: keep the file and add a B3 chapter.
  - The ledger copied to `docs/plans/plan-5-ledger.md`.
- [ ] **Step 2: All gates** from clean clones on Node 24 and Node 18.19, with counts recorded in the ledger.
- [ ] **Step 3: Tag** `v0.4.0-rc.1` (annotated, local).
- [ ] **Step 4: Codex milestone review** of `v0.3.0..v0.4.0-rc.1`.
  - Use the B2 prompt shape, retargeted to the B3 deliverables.
  - Write to `docs/reviews/b3-codex-review.md`.
  - Run the fix wave under the B2 fix-wave rules. Each fix commit is `fix(<area>): <what> (Codex B3-NN)`.
  - Move the tag (annotated, local) to the final commit, and record dispositions in the ledger.
- [ ] **Step 5: Real probe** (owner decision). The controller runs it on a throwaway clone of `~/dev/LeRisque` in `/private/tmp`, with origin removed:
  1. the documented commands for `claude`;
  2. `doctor --probe --host claude` with the cheapest available Claude model and the 120 s cap.

  Record the full result in the ledger. If the result is `not-fired` or `unavailable`, that is a finding for the owner, not a gate failure, because B3's gate is the fixture. Delete the clone afterwards.
