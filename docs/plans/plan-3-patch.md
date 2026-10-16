# harness-telemetry — Plan 3 patch (v0.2.1-rc.2): make the B2 entry gate's claims true

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Codex milestone findings that make `v0.2.1-rc.1` unsafe to build Plan 4 on, and re-tag as `v0.2.1-rc.2`. The findings are P3-01…P3-12 in `docs/reviews/plan-3-codex-review.md`:
- a cumulative checker that blesses undeclared bytes (P3-01, P3-12);
- a host-contaminated baseline (P3-02);
- a change summary that drops file contents (P3-03);
- a "default" mode that never tests the real default (P3-04);
- an async-frame leak (P3-11);
- map defects (P3-05…P3-10).

**Architecture:** Six tasks.
1. The stage-locked case untracks exactly the host's `xcrun_db` cache file.
2. `__sandbox__/changes.txt` carries content digests and a deterministic summary for git directories.
3. The migration harness replaces recorded `expected/b2` goldens with a cumulative expectation *composed* from the declarations:
   - a path declared by one landed migration takes that migration's after-content;
   - a path touched by several needs an explicit, reviewed interaction declaration;
   - "default" runs with the variable genuinely unset, alongside an explicit-all mode.
4. The diagnostics normaliser handles `at async` frames.
5. The migration map is corrected so every spec-required outcome has an owner, and so no option violates the spec.
6. Close and re-tag.

**Tech Stack:** Node ≥ 18.19, ESM, stdlib only, `node:test`. Repo `~/dev/harness-telemetry`, branch `main`, starting at `75151e5`. Tag `v0.2.1-rc.1` = `ab146c1`.

**Spec:** `~/dev/harness-telemetry/docs/spec.md` (v4.2): §3.2.1, §3.5, §5.4, §12 (B2 gate), §14.4, §14.7, §14.11, §18.2, §18.5.
- Findings and reproductions A–E: `docs/reviews/plan-3-codex-review.md`.
- Record: `docs/plans/plan-3-ledger.md`. Its parked items are folded in: R13, async frames, and writeB2 exits.
- Map: `docs/b2/MIGRATION-MAP.md`.

**Not in this patch:**
- Owner decisions: Q1–Q16 and the 10 exclusions on `docs/reviews/owner-signoff.md`.
- Running Ubuntu or Node 18.19 in CI. There is no remote; Task 6 runs Node 18.19 locally.
- Any behaviour migration. Their after-files land with each migration in Plan 4.

## Global Constraints

- Node ≥ 18.19; `"type": "module"`; **no dependencies** (stdlib + `node:test`).
- Never modify `reference/`; never read or copy from `~/dev/harness-telemetry-corpus-raw/`; never push; no remote.
- Goldens are never hand-edited. Regenerate them only with `node scripts/goldens.mjs <case> 49577c7 reference/49577c7`, or `node scripts/goldens.mjs <case> engine tokenomics` for approved engine-only cases. A regeneration may change only the files its task names, and the task's report proves which files changed.
- **Migrations off = pure extraction.** With `TOKENOMICS_MIGRATIONS=none`, the engine equals the reference goldens byte-for-byte for every reference case after every commit (`node scripts/diff-impl.mjs` → `differing 0`). No migration lands in this patch.
- Every gate is green after every commit: `npm test`; `node scripts/coverage.mjs` exits 0; `node scripts/inventory.mjs` exits 0; `node scripts/diff-impl.mjs` exits 0; `node scripts/migrations.mjs check` exits 0.
- Never stub `process.stdout` inside a test. Node 18's test runner reports through stdout, so spawn child processes instead.
- `node --test <dir>` does not work; pass explicit test files.
- Commits are conventional and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on `main`, never on a detached HEAD.

## Review Focus

1. **Cumulative false passes inside declared paths** (Codex Reproduction A). The checker must reject all of these: changed bytes on a declared path, a cancelled declared change, a changed→removed path, and an overlap between two declarers with no interaction declaration. → Task 3 adds a fake-implementation test for each.
2. **A migration that works only when named** (Reproduction D, with the committed fake `w.mjs`). The default mode must fail it. → Task 3 tests it.
3. **Digests that make goldens nondeterministic.** Git object ids and commit times are the risk: `cov-capture-sync`'s git dir is written by a real `git` with a real clock. → Task 2 replays that case twice, and also on Node 18.19, and the two `changes.txt` files must be identical.
4. **An untrack entry that hides more than the host cache.** → Task 1 tests that other writes under `repo/stage-tmp/` still appear.
5. **Map corrections that still leave a spec-required outcome without an owner.** The outcomes are: unknown counts (§3.2.1), reader conflicts (§3.5), inclusive by-role dollars (§3.2.1), and historical manifest binding (§14.4). → Task 5 adds an "Obligations" table, and its self-check fails on any spec-required row without an owner.

---

### Task 1: The stage-locked case untracks exactly the host's xcrun cache (P3-02)

**Files:**
- Modify: `corpus/cases/fault-capture-stage-locked/replay.json`
- Modify: `replay/runner.test.mjs`
- Modify: `corpus/CASES.md`

**Background.** The case sets `TMPDIR=stage-tmp`, a repo-relative path, so the meter's staging dir lands inside the sandbox. Apple's `/usr/bin/git` shim calls `xcrun`, which may create its cache `$TMPDIR/xcrun_db`. Whether it does depends on host state, so Codex saw `A repo/stage-tmp/xcrun_db` and we did not. The runner's `untracked` entries are exact path prefixes (`under(rel, roots)`, normalised). An entry for the file itself hides only that file.

- [ ] **Step 1: Write a failing runner test.** Add to `replay/runner.test.mjs`, using the file's existing temp-case helper style, for example the `repo/./x/` untracked test from Plan 3 Task 4. Build a temp case whose script writes:
  - `stage-tmp/xcrun_db`;
  - `stage-tmp/other.txt`.

  The manifest has `untracked: [{ "path": "repo/stage-tmp/xcrun_db", "reason": "<≥40 chars>" }]`. Assert that `__sandbox__/changes.txt` lists `stage-tmp/other.txt` and not `xcrun_db`. A changes line now looks like `A repo/stage-tmp/other.txt …` if Task 2 has landed; this task runs first, so match the path, not the whole line.

  The test should pass with the current runner (prefix semantics already exist), so it pins the behaviour rather than driving new code. Run `node --test replay/runner.test.mjs`. Expected: PASS. If it fails, fix `under()` so that an exact file path matches only that file.

- [ ] **Step 2: Add the untrack entry.** In `corpus/cases/fault-capture-stage-locked/replay.json`, add:

```json
"untracked": [{ "path": "repo/stage-tmp/xcrun_db", "reason": "Apple's /usr/bin/git shim may create its xcrun cache in $TMPDIR (here repo/stage-tmp) depending on host state; it is host tooling, not reference or engine output (Codex P3-02)" }]
```

No golden changes, because our host never produced the file. Run `node scripts/diff-impl.mjs` and `node --test corpus/goldens.test.mjs`. Expected: `differing 0` and PASS.

- [ ] **Step 3: Document and commit.** In `corpus/CASES.md`'s `fault-capture-stage-locked` row, add the untrack entry and its reason.

```bash
git add corpus/cases/fault-capture-stage-locked/replay.json replay/runner.test.mjs corpus/CASES.md
git commit -m "fix(corpus): stage-locked untracks exactly the host xcrun cache (P3-02)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `changes.txt` carries content evidence (P3-03)

**Files:**
- Modify: `replay/observe.mjs`, `replay/observe.test.mjs`
- Modify: `replay/runner.mjs`, only if the line format is built there
- Regenerate: the two goldens with a `__sandbox__/changes.txt`, `cov-capture-sync` and `fault-capture-dispatch-race`, plus `before-entry-symlink`'s. Regenerate only those `changes.txt` files.
- Modify: `corpus/CASES.md`, `README.md` (the observation-boundary paragraph)

**Interfaces:**
- `treeChanges(before, after) → string[]` changes its line format:
  - `A <path> <digest>`;
  - `M <path> <oldDigest>→<newDigest>`;
  - `D <path> <oldDigest>`.

  A digest is the snapshot value: `f:<sha256-16>` for a file, `l:<target>` for a symlink, `u` for unreadable.
- Git directories: the `g:` digest must be deterministic across runs and Node versions. Today it hashes inner entries, including object files whose ids depend on real commit times. Replace it with `g:` + sha256-16 of a normalised summary:
  - the sorted list of ref names under `refs/` (names only, not ids);
  - the `HEAD` symbolic target, or `detached`;
  - the sorted list of top-level non-object entries.

  Document that object contents and ids are not observed.

**Background.** Codex Reproduction C: two different extra files both render `A repo/extra.txt`, so `changes.txt` proves which paths changed but not what changed. Snapshot-based observation also cannot see transient create-and-delete, modes, mtimes or empty directories. Those limits must be stated, not claimed away.

- [ ] **Step 1: Write the failing tests.** In `replay/observe.test.mjs`:
  - (a) `treeChanges(new Map(), new Map([['x','f:aaa']]))` gives `['A x f:aaa']`, and `f:bbb` gives a different line;
  - (b) a modification gives `M x f:aaa→f:bbb`;
  - (c) a deletion gives `D x f:aaa`;
  - (d) a symlink retarget gives `M ln l:a→l:b`;
  - (e) two git dirs with identical ref names but different object files and different `refs/heads/main` content give the same `g:` digest. Build them with plain files: `HEAD`, `objects/ab/cdef…`, `refs/heads/main`.

  Run `node --test replay/observe.test.mjs`. Expected: FAIL.

- [ ] **Step 2: Implement** the line format and the git-dir summary in `replay/observe.mjs`.

- [ ] **Step 3: Check determinism first.** Replay `cov-capture-sync` twice against `reference/49577c7` into scratch dirs and diff the two `changes.txt` files. Then do it once more under Node 18.19:

  ```
  export npm_config_cache=<scratch>/npmcache
  N18=$(npx -y node@18.19.0 -p process.execPath)
  ```

  Run a small script with `$N18` that calls `runCase`. All three must be byte-identical. If they are not, the git summary still contains something that varies between runs; fix it before going on.

- [ ] **Step 4: Regenerate only the affected goldens.**
  - For each case whose golden has `__sandbox__/changes.txt`, run `node scripts/goldens.mjs corpus/cases/<case> 49577c7 reference/49577c7`. Find the cases with `ls corpus/cases/*/expected/*/__sandbox__/changes.txt`; for engine-only cases use `engine tokenomics`.
  - Then run `git status --short corpus/cases`. Only `__sandbox__/changes.txt` files may be modified. Paste the output into the report.
  - Run `node scripts/diff-impl.mjs` (`differing 0`), `npm test` and `node scripts/migrations.mjs check`.

- [ ] **Step 5: Document and commit.** In `README.md` and `corpus/CASES.md`, change "every write" wording to say what is observed: a final-state path change summary with content digests. Say what is not: transient writes within the run, modes, mtimes, empty directories, git object contents and ids, `.git` directories, and anything outside the sandbox root.

```bash
git add replay corpus README.md
git commit -m "fix(replay): changes.txt records content digests; deterministic git-dir summary (P3-03)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Composed cumulative expectations, an unset-default mode, interaction declarations (P3-01, P3-04, P3-12)

**Files:**
- Modify: `scripts/migrations.mjs`, `scripts/migrations.test.mjs`
- Create: `corpus/migrations/_interactions/` with a `README.md` stating the format. Leave it otherwise empty; nothing has landed yet.
- Modify: `corpus/migrations.test.mjs`, if it enumerates registry dirs (it must skip `_interactions`)
- Modify: `tokenomics/ENGINE-B1.md` ("Migrations (B2)"), `corpus/README.md` (registry layout and commands)

**Interfaces:**
- **Removed:** `expected/b2` goldens, `writeB2`, the `b2` CLI command and `b2Problems`. Ruling: a cumulative golden recorded from the implementation under test gives that implementation authority over its own oracle (Codex P3-01). The cumulative expectation is computed from reviewed declarations instead. Cost if wrong: Plan 4 loses one review artifact per case, and `show` replaces it.
- **New:** `composeExpected(base, declarers, interaction, caseId) → { files, exits, problems }`, built in this order:
  1. Start from `base.files` and `base.exits`.
  2. For each declarer `{id, entry, d}` in registry order, and each `p` in `d.changed`: if another declarer already set `p`, record a conflict on `p`; otherwise `files[p] = after-content`.
  3. Each `p` in `d.removed` follows the same conflict rule and deletes `p`.
  4. For exits, per event index `i`: if `d.exits?.[i] !== undefined && d.exits[i] !== base.exits[i]`, set `exits[i]`. Two declarers setting different non-baseline values at the same `i` is a conflict on `exit:<i>`. A declared exit vector must have the baseline's length.
  5. If an `interaction` exists for the case, apply it after the composition. Its `changed`, `removed` and `exits` override, and every conflict must be covered by the interaction's paths or `exit:<i>` entries. An interaction path whose content equals what composition alone gives is a vacuous declaration: `interaction declares no change: <case> <path>`.
  6. An uncovered conflict is a problem: `<case>: <path> is declared by <id1> and <id2> — needs an interaction declaration`.
- **Interaction declaration:** `corpus/migrations/_interactions/<case>/interaction.json` is `{ "case": "<case>", "migrations": ["<id>", …], "reason": "<≥ 40 chars>", "changed": [...], "removed": [...]?, "exits": [...]? }`. After-files live at `_interactions/<case>/expected/<path>`.
  - It may also declare paths that no single migration changes. This is the legitimate entry-guard + writer case from Codex Reproduction A: writer alone does not change `before-entry-symlink`, but together they produce a stamped line.
  - `registryProblems` validates it:
    - the case exists with `replay.json`;
    - `migrations` has at least 2 known ids, and all of them are landed (an interaction naming an unlanded migration is a problem);
    - the reason is at least 40 characters;
    - the paths are valid and each after-file exists;
    - it is not empty.
  - It applies only in `default` and `all` modes, and only when all its migrations are enabled, which in those modes means all are landed.
- **Modes:**
  - `none`;
  - `only:<id>` for each landed migration, unchanged;
  - `default`: replay with `TOKENOMICS_MIGRATIONS` **unset**. This is the genuine default (P3-04).
  - `all`: replay with the explicit comma list of landed ids. It runs only when at least one migration is landed.

  Both `default` and `all` compare the run against `composeExpected`. When no migration is landed, `default` still runs and must equal the baseline.
- **CLI:** `write-interaction <case>`:
  - requires `interaction.json` with a reason and `migrations` to exist;
  - replays `default`;
  - records as after-files exactly the paths where the output differs from the composition without the interaction, and updates `changed`, `removed` and `exits`;
  - refuses when nothing differs, writes nothing on refusal, and never writes into `corpus/cases`.

  `show <id>` gains `show-interaction <case>`. P3-12 disappears with `writeB2`. `write` (single migration) checks the declared `exits` vector too.

- [ ] **Step 1: Write the failing adversarial tests** in `scripts/migrations.test.mjs`. Use fake implementations built in temp dirs, plus the committed `scripts/fixtures/migrations/` where it fits. Use a fake implementation whose output depends only on `TOKENOMICS_MIGRATIONS`, with two landed fake migrations `a` and `b` passed through the `migrations` parameter. Write one test per item:
  1. `a` declares `out/a.txt` = `A`, `b` declares `out/b.txt` = `B`, and the combined run writes `out/a.txt` = `UNDECLARED`. Expect: the default and all modes report `differs out/a.txt`.
  2. Same declarations, but the combined run leaves `out/a.txt` = `base` (cancellation). Expect: `differs out/a.txt`.
  3. Same declarations, but the combined run removes `out/a.txt`. Expect: `missing out/a.txt`.
  4. `a` and `b` both declare `out/a.txt`, with no interaction. Expect: a registry or composition problem `needs an interaction declaration`.
  5. As 4, with an interaction declaring `out/a.txt` = `AB` and the run writing `AB`. Expect: no problems. With the run writing `A`: `differs out/a.txt`.
  6. An interaction naming an unlanded migration. Expect: a registry problem.
  7. An interaction path equal to the plain composition. Expect: `interaction declares no change`.
  8. The committed fake `w.mjs`, which enables `demo` only when named, with `demo` landed and declared. Expect: `all` passes and `default` fails, reporting `differs out/a.txt` and `missing out/b.txt`.
  9. Per-event exits: `a` changes event 0's exit and `b` changes event 1's. Expect: the composed exits carry both. Conflicting values at the same event without an interaction is a conflict problem.
  10. `write` refuses a run whose exits differ from what its declaration would record, or records them. Pin which behaviour you chose.
  11. An approved engine-only case participates in default and all against `expected/engine`.
  12. `write-interaction` refuses when nothing differs, and writes nothing on refusal.

  Run `node --test scripts/migrations.test.mjs`. Expected: the new tests FAIL.

- [ ] **Step 2: Implement** `composeExpected`, the interaction loading and validation, the four modes, the `write-interaction` and `show-interaction` CLI, and the removals. Keep `compareFiles`, `expectedFor` and `loadRegistry` signatures stable for their callers, and make `loadRegistry` ignore `_interactions`. Move all Task 8 tests that used `expected/b2` and `b2` to the new semantics; delete none without a replacement.

- [ ] **Step 3: Run the gates.** Run `node --test scripts/migrations.test.mjs corpus/migrations.test.mjs scripts/diff-impl.test.mjs`, then `npm test`, `node scripts/migrations.mjs check` and `node scripts/diff-impl.mjs`.
  - Expected: `check` with nothing landed runs `none` and `default`, both against baselines, with `problems 0`.
  - Run `grep -rn "expected/b2\|writeB2\|b2Problems" --include=*.mjs --include=*.md . | grep -v '^./reference' | grep -v docs/reviews | grep -v docs/plans`. Expected: no stale references, except history in ledgers and reviews.

- [ ] **Step 4: Document and commit.** In `ENGINE-B1.md` "Migrations (B2)" and `corpus/README.md`, document:
  - the four modes;
  - composition;
  - interactions;
  - that cumulative bytes are never recorded from the implementation except through an explicit, reasoned interaction declaration that is reviewed with `show-interaction`.

  Write `corpus/migrations/_interactions/README.md` with the same format summary.

```bash
git add scripts corpus tokenomics/ENGINE-B1.md
git commit -m "fix(b2): compose cumulative expectations from declarations; unset default mode; interaction declarations (P3-01, P3-04, P3-12)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Normalise anonymous async frames (P3-11)

**Files:**
- Modify: `replay/observe.mjs`, `replay/observe.test.mjs`

- [ ] **Step 1: Write a failing test.** `normalizeDiagnostics('Error: boom\n    at async file:///impl/a.mjs:15:4\n    at async file:///impl/a.mjs:2:1\n', { stream: 'stderr' })` must return `'Error: boom\n    at <frame>\n'` (the run collapses). Also cover `    at async Promise.all (index 0)` and `    at async main (file:///impl/a.mjs:3:9)`. On `stdout` (or with `stream` omitted, whatever the current call convention for stdout is), an indented `at async something` line must stay unchanged. Run `node --test replay/observe.test.mjs`. Expected: FAIL.

- [ ] **Step 2: Implement.** Add an optional `async ` prefix to the `FRAME` pattern, covering both the location form and the `name (location)` form, plus V8's `Promise.all (index N)` form. Then run `node --test replay/observe.test.mjs` and `npm test`. Check `git status --short corpus/cases`: no golden may change. If one does, it must be a stderr file changing only by this normalisation; list it and regenerate it with `goldens.mjs`.

- [ ] **Step 3: Commit.**

```bash
git add replay
git commit -m "fix(replay): normalise anonymous async stack frames (P3-11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Correct the migration map (P3-05…P3-10)

**Files:**
- Modify: `docs/b2/MIGRATION-MAP.md`
- Modify: `docs/reviews/owner-signoff.md`, where a Q changes
- Modify: `corpus/migrations/*/migration.json`, `summary` fields only, if needed

**Background.** Codex: the map offers spec-violating behaviour as ordinary options, and leaves spec-required reader outcomes without an owner. Its §5 assessment and Reproduction E give the concrete behaviours. The map is Plan 4's source, so each required outcome needs a home: an existing migration, a proposed new item, or an explicitly approved later milestone.

- [ ] **Step 1: Add §1.5 "Obligations".** This is a table with these columns: obligation, spec citation, today's behaviour (`reference/49577c7` file:line plus the pinning case), owner (migration id, proposed item number, or milestone), required/optional, acceptance test. At least these rows:
  - **Unknown counts (§3.2.1, "aggregates carry unknowns as counts").** Today a report over `tokens:null`/`activeMin:null` emits zeros (Reproduction E).
  - **Reader conflict handling (§3.5).** Today `dedupLines` is first-wins and order-dependent (Reproduction E).
  - **Inclusive parent-role dollars (§3.2.1).** Today `byRole` splits the parent's dollars by dispatch role (Reproduction E). The map attributed an inclusive by-role *minutes* rule to text that speaks of dollars; fix that citation.
  - **Historical manifest binding (§14.4, §14.7):** below.
  - **Command receipts (§5.6):** D7 assigns this to C1. Name the milestone and its acceptance.

  Spec-required rows may not offer "keep as is" as an option. Where the obligation falls outside the eleven §14.8 items, the owner is a proposed item that Q1 asks the owner to approve as **required by spec**. It is not optional.

- [ ] **Step 2: P3-05, rewrite the affected options.** In items 4 and 8, and in Q8 and Q-conflict, remove every option that keeps unknown→zero aggregation or first-wins conflicts as an end state. Re-point them to the Obligations rows.

- [ ] **Step 3: P3-06, historical binding.** Rewrite Q11 and D1's reading rule:
  - a line without `manifestRevision` binds to the implied legacy manifest (revision 1, TA `ratioIntents: ['automation']`, legacy receipt policy), never to the current `module.json`;
  - a line naming a revision whose archive `<dir>/manifests/<rev>.json` is missing is read as unverified, with a finding, not reinterpreted.

  Add acceptance tests to item 8: current-manifest change leaves historical lines' eligibility unchanged, and missing archive.

- [ ] **Step 4: P3-07, B1 defaults.** In D1 and item 8, specify that the migrations-off (`none`) path keeps a frozen `B1_DEFAULTS` that includes `ratioIntents`. Removing `ratioIntents` from `TA_DEFAULTS` at B2 close must not change `none` behaviour, and must not reject minimally configured foreign settings. Add an acceptance test.

- [ ] **Step 5: P3-08, restamp.** In item 11, the writer stamp applies to measurement appends. A restamp append (item 9) preserves the original `writer` and measurement provenance, and sets `restampedBy` (§14.11, §3.2). State the exception in both items, and add an acceptance test: restamp a line written by an older writer.

- [ ] **Step 6: P3-09, cross-row anonymisation.** In item 5, the scrub set is the union of every supplied identifier across all rows and the submission, applied to every output string. Add an acceptance test where row A's note mentions row B's slug, and update the declared-diff prediction.

- [ ] **Step 7: P3-10, R13 and R17.**
  - R13: Node's `readdir` is strcmp-sorted on POSIX (libuv `uv__fs_scandir`). The reference relies on that undocumented order, which can differ on Windows. Evidence is a unit test with an unsorted readdir stub, not `cov-dispatch-batch`. Re-frame proposed item 14 in Q1 accordingly.
  - R17: state precisely, against Node's documented stdio semantics, what happens on Linux pipes when `process.exit()` is called after a large stdout write. Do not claim more than the documentation says.
  - Also make the "production-switchable" column agree with the constraint cells (the Task 9 deferred minor).

- [ ] **Step 8: Self-check and commit.**
  - Every new or changed reference citation resolves: write a small node script and paste its output.
  - Every Obligations row marked required has an owner.
  - No option in §2 or §5 keeps a spec-required outcome unmet.
  - The owner sheet's Q summaries match the map.

  Then run `npm test`.

```bash
git add docs corpus/migrations
git commit -m "docs(b2): map obligations table; spec-required outcomes owned; historical binding, B1 defaults, restamp, cross-row anonymisation, R13/R17 (P3-05..P3-10)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Close — ledger and docs, Node 18.19 and clean-clone verification, tag `v0.2.1-rc.2`

**Files:**
- Modify: `tokenomics/ENGINE-B1.md` (add a section "Plan 3 patch (v0.2.1-rc.2)": one bullet per task, plus the P3-01…P3-12 dispositions)
- Modify: `docs/reviews/owner-signoff.md` (open items updated)
- `docs/plans/plan-3-ledger.md`: the controller appends the patch section after the final review.

- [ ] **Step 1: Write the docs.** In `ENGINE-B1.md`, give the disposition of each P3 finding: fixed (task and commit), or decided in the map (section).

- [ ] **Step 2: Verify on Node 18.19.** Set `npm_config_cache=<scratch>/npmcache` and `N18=$(npx -y node@18.19.0 -p process.execPath)`, then run `$N18 scripts/test.mjs`, `$N18 scripts/diff-impl.mjs` and `$N18 scripts/migrations.mjs check`. Paste the summary lines.

- [ ] **Step 3: Verify in a clean clone.**

```bash
rm -rf /tmp/ht-rc3b && git clone -q ~/dev/harness-telemetry /tmp/ht-rc3b && cd /tmp/ht-rc3b && npm test && node scripts/coverage.mjs && node scripts/diff-impl.mjs && node scripts/inventory.mjs && node scripts/migrations.mjs check; echo "exit $?"; git -C /tmp/ht-rc3b status --short
```

Expected: every command passes, the output ends with `exit 0`, and the clone's status shows no changes.

- [ ] **Step 4: Commit and tag.**

```bash
cd ~/dev/harness-telemetry
git add tokenomics/ENGINE-B1.md docs/reviews/owner-signoff.md
git commit -m "docs: Plan 3 patch close — P3 dispositions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag v0.2.1-rc.2
git status --short && git tag --points-at HEAD
```
