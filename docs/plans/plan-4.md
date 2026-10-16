# harness-telemetry — Plan 4 (B2): repair the gate, then land the behaviour migrations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last harness holes (Codex P3P-01…P3P-06 plus parked items), then land every B2 behaviour migration behind its id, each with a reviewed declared diff. Then freeze the extension API at 2, close B2 with the `none` differential still green, and tag `v0.3.0-rc.1`.

**Architecture:** Three phases.
- **Phase A (Tasks 1–3), gate repair.** No migration lands until Task 3 is done:
  - safe path dictionaries and an honest recorder (Task 1);
  - unambiguous observation records and accurate observation wording (Task 2);
  - the map frozen to the owner's decisions, and the registry extended with items 22–24 and the three robustness groups (Task 3).
- **Phase B (Tasks 4–20), migrations in map §4 order.** Each task:
  - implements its behaviour behind `migrationOn('<id>')`, leaving the `none` path byte-identical;
  - flips `landed: true`;
  - records its after-files with `node scripts/migrations.mjs write <id> <case>…`;
  - records any interaction declarations its landing makes necessary.
- **Phase C (Tasks 21–23).** The API 2 freeze, the B2 close, and the single Codex milestone pass with its fix wave.

**Tech Stack:** Node ≥ 18.19, ESM, stdlib only, `node:test`. Repo `~/dev/harness-telemetry`, branch `main`, start `8dc84dd`. Latest tag `v0.2.1-rc.2` (local).

**Spec:** `~/dev/harness-telemetry/docs/spec.md` (v4.2): §3.2, §3.2.1, §3.5, §5.1–§5.5, §10, §12 (B2 gate), §14.4, §14.7, §14.8, §14.11, §18.2, §18.5.

The B2 contract is `docs/b2/MIGRATION-MAP.md`. Executors read **both** the spec and the map:
- §1 decisions D1–D7;
- §1.5 obligations O1–O11;
- §2 per-item specs. These give the engine change sites, before-cases, declared diff shapes and acceptance tests. The tasks below cite them rather than copy them;
- §3 defects;
- §4 order and interactions.

Other sources:
- Owner decisions: `docs/reviews/owner-decisions-2026-10-12.md`. Every Q1–Q16 is answered there, and the map's §2 "proposal" texts are now decisions.
- Latest review: `docs/reviews/plan-3-patch-codex-review.md`, findings P3P-01…06 and its §4.
- Parked items: `docs/plans/plan-3-ledger.md`, the patch section under "Final: parked".

**Not in this plan:**
- Ubuntu or Linux evidence, the GitHub remote, the branch-name rewrite and the hyperfactory guide. The owner parked these until publishing (decisions file, "Closed 2026-10-11"), so the matrix claim stays "macOS, Node 24 + 18.19 local".
- B3 installer, `ENGINE.json` and production switch enforcement.
- B4 rescue/rollback.
- C1 command receipts (O5).

## Global Constraints

- Node ≥ 18.19; `"type": "module"`; **no dependencies** (stdlib + `node:test`). Node 18.19 locally: `export npm_config_cache=<scratchpad>/npmcache; N18=$(npx -y node@18.19.0 -p process.execPath)` (`~/.npm` is not writable).
- Never modify `reference/`. Never read `~/dev/harness-telemetry-corpus-raw/`. Never push or add a remote.
- Goldens are never hand-edited. Baselines are regenerated only by `node scripts/goldens.mjs <case> 49577c7 reference/49577c7`, or `… engine tokenomics` for approved engine-only cases. Migration after-files come only from `node scripts/migrations.mjs write …`, and interaction after-files only from `write-interaction`.
- **Migrations off = pure extraction.** `TOKENOMICS_MIGRATIONS=none` equals the reference goldens byte-for-byte after every commit (`node scripts/diff-impl.mjs` → `differing 0`). Every behaviour change is behind `migrationOn('<id>')`, and the reference branch stays in place.
- Every gate is green after every commit:
  - `npm test`;
  - `node scripts/coverage.mjs` exits 0;
  - `node scripts/inventory.mjs` exits 0;
  - `node scripts/diff-impl.mjs` → `differing 0`;
  - `node scripts/migrations.mjs check` (the full check, never only `--only`) → `problems 0`.
- Never stub `process.stdout` in a test (Node 18's runner reports through it): spawn a child. `node --test <dir>` does not work; pass files.
- A landed migration declares **every** corpus case whose output it changes. The `write` run, not the map's prediction, is the authority: run `write <id>` over every candidate the map lists, keep only the cases that change, and give each a reason of at least 40 characters stating *why* it changes.
- Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on `main`.
- Subagent models: Opus for Tasks 1–3, 7, 9–12, 14–16, 21–23 and every final or harness review. Sonnet for Tasks 4–6, 8, 13, 17–20 and their reviews. Never switch a model silently. On a spend or quota stop, resume the same model or ask the owner.

## Owner decisions applied (binding; do not re-ask)

- **Scope.** The 11 spec items plus required items `report-conflicts` (22), `role-dollars` (23) and `report-revision` (24), each landing alone. The optional items land as three grouped migrations:
  - `entry-points` (items 12, 13);
  - `capture-robustness` (items 14–17, 21);
  - `report-robustness` (items 18–20).
- **Production switch set** = `{}` (Q3).
- **Process.** One Codex pass at the end of B2 (Task 23). Its findings are fixed and listed in the ledger, with no re-review loop.
- **Q2.** The kit ENOTDIR fix is kit maintenance (Task 20 carries it as a check finding). **Q4** whole-token, case-sensitive, boundary class `[A-Za-z0-9_-]`. **Q5** even `1/k` split, plus a `sources.sharedDispatches` note. **Q6** drop per-dispatch Copilot totals (dispatch `tokens: null`), plus a `sources.inclusiveSessions` note. **Q7** the map's null/labelled-allocation list; the parent role gets the full session minutes; dispatch roles are a separate breakdown.
- **Q8.**
  - (a) VS Code cache categories stay 0;
  - (b) a timestamp-less session gets `wallMin`/`activeMin` `null`;
  - (c) a missing `elapsedMs` stays 0;
  - (d) `unmeasured: {tokens, activeMin, wallMin, turns, toolCalls, toolErrors}` per bucket, rendered as "n unmeasured".
- **Q9.** The supplied strings are group slugs, `work_item_ref`, receipt paths and briefs. Match on a whole-token or path-segment boundary.
- **Q10.**
  - (a) the map's field names;
  - (b) one `endedAt` window for the whole report;
  - (c) a revisionless legacy receipt without `revision` is reference-era (its mtime may serve);
  - (d) a date-only argument maps to `T00:00:00Z`.
- **Q11.** (a) D1's legacy binding is immutable. (b) The strict rule: a missing archive means the line is unverified, and cases with a `module.json` ship `manifests/<N>.json`.
- **Q12.**
  - (a) a `--host` flag with an environment default;
  - (b) ambiguity reported both on stderr and as a kit finding;
  - (c) claims by atomic rename plus `.claim` recovery;
  - (d) R9 is inside item 9.
- **Q13.** (a) `.agents/telemetry/<dir>/reports/<group>/`. (b) The default is `"telemetry"` for a present settings file that omits the key, **for non-TA configurations only**. Spec §14.8 item 10 says "TA keeps its in-tree layout", so an effective extension of `test-automation` defaults to `"tree"`. (c) `cost.json` moves with the reports.
- **Q14.** The version comes from `package.json`, and the replay harness pins it (Task 14). **Q15** (a) and (b) as in the map. **Q16** `conflicts: n` plus a preview total from the lowest-canonical-JSON pick.
- **Coverage exclusions:** all 10 approved. #4's reason text is reworded in Task 3. **§18.2** is amended to the implemented scope in Task 2.

## Review Focus

1. **Prototype-named and newline-bearing paths in real replays.** A case whose implementation writes `__proto__`, `constructor` or `toString` under an output root, or a symlink whose target contains `\n`. A reasonable person expects the harness to observe each one exactly, and an undeclared one to fail. → Tasks 1 and 2 add end-to-end tests through `runCase`/`collect`, not only pure functions.
2. **Mixed-era ledgers.** One `usage-*.jsonl` holding reference-era lines, B1-era lines, inclusive Copilot lines and `writer` lines. A reasonable person expects every report to read each line by its own basis and era (O10), whatever `TOKENOMICS_MIGRATIONS` says. → Task 8 adds "inclusive line read correctly with `copilot-inclusive` disabled", and Task 14 adds a mixed-era period-report test.
3. **Sweep idempotency after new keys.** A second `--sweep --all` over sessions already captured, once lines carry `writer`/`manifestRevision`/`tokensBasis`/`null`s. A reasonable person expects no duplicate line. → Task 14 adds "sweep twice → one line per session" with every migration on. Task 7 adds the same for timestamp-less sessions now written with `null` minutes.
4. **Renderers fed `null`.** Markdown/HTML/live pages rendering a `null` minute, counter or token. A reasonable person expects "—" or "n unmeasured", never `null`, `NaN`, `undefined` or `$null`. → Tasks 7 and 10 each add a render test asserting none of those strings appears in any rendered output for a fixture containing nulls.
5. **An existing TA install with a `settings.json` that omits `reports.location`.** A reasonable person expects TA reports to stay in-tree after the upgrade. → Task 13 tests that a present TA settings file without the key keeps `tree`.

---

## Landing procedure (used by every Phase B task; each task lists its concrete values)

Every Phase B task runs these steps in order. They are spelled out here once because they are mechanical. Each task's steps name the exact ids, cases and files.

- **L1. Unit tests first (TDD).** Write the task's failing unit tests, run them, and see them fail for the stated reason. Tests that exercise new behaviour set `TOKENOMICS_MIGRATIONS=<id>`, or call the internal function with an explicit `migrations` set if the module already threads one. Every test that pins the *old* behaviour runs with `TOKENOMICS_MIGRATIONS=none` and must stay green.
- **L2. Implement** behind `migrationOn('<id>')` (`tokenomics/engine/migrations.mjs`). Leave the reference branch in place. Run the unit tests until they pass, then run `node scripts/diff-impl.mjs` → `differing 0`.
- **L3. Register.** Flip `landed: true` for the id in `tokenomics/engine/migrations.mjs`. In `corpus/migrations/<id>/migration.json`, write each case's `reason` (≥ 40 chars) and its intended `changed`/`removed`/`exits` keys under `declared`.
- **L4. Record.** Run `node scripts/migrations.mjs write <id> <case>…` over **every** candidate case the task lists. Remove any case the tool refuses with "no difference", and record that removal in the task report. Review every after-file with `node scripts/migrations.mjs show <id>` against the map's declared diff shape. A difference from the map is either a bug (fix the code, re-record) or a map error (fix the map text in the same commit and say why in the report).
- **L5. Interactions.** Run `node scripts/migrations.mjs check`. For every `needs an interaction declaration` or `interaction overrides … without naming it` problem:
  - write or extend `corpus/migrations/_interactions/<case>/interaction.json` by hand: `case`, every owning `migrations` id, a reason of at least 40 characters, and the keys;
  - run `node scripts/migrations.mjs write-interaction <case>`;
  - review it with `show-interaction <case>`.

  An interaction is never written to silence a difference you cannot explain.
- **L6. Gates.** Run `npm test`, `node scripts/coverage.mjs`, `node scripts/inventory.mjs`, `node scripts/diff-impl.mjs` and `node scripts/migrations.mjs check`, and check that each one is green.
  - If coverage reports a newly uncovered migration branch, add a unit test.
  - If inventory reports a new engine site (env var, TA default, extension call), add it to `engine-allowlist.json` with a reason.
- **L7. Docs.** Add a row for the landed migration to `tokenomics/ENGINE-B1.md` §"Migrations (B2)": id, item, summary, declared cases and interactions. Add the after-behaviour to `corpus/CASES.md` for each before-case it changes.
- **L8. Commit** with `feat(engine): <id> (B2 item <n>)`, listing the declared cases and interactions in the body.

---

## Phase A — gate repair (no migration lands before Task 3 is complete)

### Task 1: Safe path dictionaries and an honest interaction recorder (P3P-01, P3P-03, parked recorder polish)

**Files:**
- Modify: `scripts/migrations.mjs`: `goldenFiles`, `compareFiles`, `expectedFor`, `composeExpected`, `registryProblems`, `checkMigrations`, `writeDeclared`, `writeInteraction`
- Modify: `replay/collect.mjs`, `replay/runner.mjs` (`stdouts`, `collected`, `files`), `scripts/diff-impl.mjs` (any `{}` file map or `in` membership)
- Modify: `scripts/goldens.mjs`, only if it builds file maps with `{}`/`in`
- Test: `scripts/migrations.test.mjs`, `replay/runner.test.mjs`, `scripts/diff-impl.test.mjs`
- Docs: `corpus/README.md` (the `exit:<i>` ban), `corpus/migrations/_interactions/README.md`

**Interfaces:**
- Produces: every file map in the harness is a **null-prototype object** (`Object.create(null)`, filled by assignment, sorted with a `sortFiles` helper that also returns a null-prototype object). Every membership test uses `Object.hasOwn(map, key)`.
  - Public signatures are unchanged: `compareFiles(want, got, wantExits, gotExits) → string[]`, `expectedFor(base, d, read, caseId) → files`, `composeExpected(base, declarers, interaction, caseId) → { files, exits, problems, conflicts, owners }`, `collect(repoDir, outputs, scrub) → files`, `runCase(...) → { files, exits }`.
  - Add `export const fileMap = (entries = []) => …` in `replay/collect.mjs`, a null-prototype object from `[k, v]` pairs. `scripts/migrations.mjs` imports it.
- `writeInteraction` gains two refusals:
  - `<case>: interaction overrides <key> owned by <id> without naming it` is checked for **conflicted keys too**, before any write;
  - `<case>: listed key <key> shows no difference in the default run` replaces today's silent drop.

  On either refusal it writes nothing.

- [ ] **Step 1: Write the failing pure-function tests (Codex Reproduction E).** Add to `scripts/migrations.test.mjs`:

```js
test('P3P-01: prototype-named paths are ordinary paths everywhere', () => {
  const g = Object.create(null); g.toString = 'UNDECLARED';
  assert.deepEqual(compareFiles(Object.create(null), g), ['extra toString']);
  const want = expectedFor(Object.create(null), { changed: ['__proto__'] }, () => 'DECLARED', 'c');
  assert.equal(Object.hasOwn(want, '__proto__'), true);
  assert.equal(want['__proto__'], 'DECLARED');
  const base = { files: Object.assign(Object.create(null), { 'out/a.txt': 'base' }), exits: [0] };
  const r = composeExpected(base, [{ id: 'a', entry: null, d: { removed: ['toString'] } }], null, 'c');
  assert.ok(r.problems.includes('declares no change: c toString'), r.problems.join('\n'));
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const w = Object.create(null); w[name] = 'A';
    const x = Object.create(null); x[name] = 'B';
    assert.deepEqual(compareFiles(w, x), [`differs ${name}`]);
    assert.deepEqual(compareFiles(w, Object.create(null)), [`missing ${name}`]);
  }
});
```

  Run `node --test scripts/migrations.test.mjs`. Expected: FAIL. `compareFiles` returns `[]` for the extra `toString`, and `expectedFor` loses `__proto__`.

- [ ] **Step 2: Write the failing end-to-end test.** In `replay/runner.test.mjs`, use the file's existing temp-case helper. Build a case whose script writes `out/__proto__`, `out/toString` and `out/constructor` (contents `P`, `T`, `C`), with `outputs: ["out"]`. Assert `runCase(...).files` has own keys `out/__proto__`, `out/constructor` and `out/toString` with those contents.

  In `scripts/migrations.test.mjs`, add a full `checkMigrations` test using the existing fake-implementation fixture pattern (`scripts/fixtures/migrations/impl`, the one the Repro D regression uses). A fake migration `demo` declares `out/__proto__ = DECLARED`, but the fake implementation writes `WRONG`. Assert the `default` and `only:demo` modes each report `differs out/__proto__`. If the fixture cannot write a `__proto__` file, add a second fake script under `scripts/fixtures/migrations/impl/` that does. Run both files. Expected: FAIL (the collector drops the key).

- [ ] **Step 3: Implement.**
  - In `replay/collect.mjs`, add `fileMap`. `collect` builds `const files = Object.create(null)` and returns `fileMap(Object.entries(files).sort(…))`.
  - In `replay/runner.mjs`, make `stdouts` a null-prototype object, and build `collected`/`files` with `fileMap` (not spread into `{}`: object spread of a `__proto__` own key is safe, but `Object.fromEntries` is the clearer guard, and a literal `{ ...a }` must not be used where a later `x[k] = v` assignment can hit `__proto__`).
  - In `scripts/migrations.mjs`, replace every `{}` file map, `{ ...base.files }` and `Object.fromEntries` result with `fileMap`-built null-prototype objects, and every `k in obj`/`!(k in obj)` on a file map or `declared` with `Object.hasOwn`.
  - Do the same for `registryProblems`: the `c in declared` / `c in waived` checks, and `entries.get(id)?.declared?.[c]` → `Object.hasOwn(e.declared, c)`. JSON-parsed registry objects keep `Object.prototype`, so `declared.toString` would be truthy today.
  - Do the same in `scripts/diff-impl.mjs` and `scripts/goldens.mjs` wherever they compare or build file maps.

  Run Step 1 and Step 2's tests. Expected: PASS.

- [ ] **Step 4: Failing recorder tests (Codex Reproduction G, parked no-op key).** In `scripts/migrations.test.mjs`, use the existing in-memory or fake-impl `writeInteraction` pattern:
  - (a) A and B both change `out/a.txt`, C adds `out/c.txt`, and the interaction names `['a','c']`. `writeInteraction` must throw `interaction overrides out/a.txt owned by b without naming it`, and the interaction directory must be byte-identical before and after (compare a recursive listing plus contents).
  - (b) The interaction hand-lists `changed: ['out/z.txt']`, which shows no difference. It must throw `listed key out/z.txt shows no difference in the default run` and write nothing.

  Run them. Expected: FAIL.

- [ ] **Step 5: Implement the recorder.** In `writeInteraction`:
  - compute the full candidate declaration (keys, bytes and exits) in memory;
  - run the owner check over **all** overridden keys, including conflicted ones (delete the `!conflicted.has(k)` exemption);
  - refuse listed no-difference keys;
  - only then remove and write the after-files.

  Update its docstring and `composeExpected`'s docstring, which have been stale since Plan 3 patch Task 3. Run the tests. Expected: PASS.

- [ ] **Step 6: Docs.**
  - `corpus/README.md`: add a sentence that a path may not be spelled `exit:<i>` (that namespace is the exit keys').
  - `corpus/migrations/_interactions/README.md`: state the two new refusals.
  - `tokenomics/ENGINE-B1.md` §"Migrations (B2)": add one sentence that file maps are null-prototype, so any legal filename is an ordinary key (P3P-01).

- [ ] **Step 7: Gates and commit.** Run all five gates and check that each one is green. No golden changes: `git status --short corpus/cases` must be empty.

```bash
git add scripts/ replay/ corpus/README.md corpus/migrations/_interactions/README.md tokenomics/ENGINE-B1.md
git commit -m "fix(harness): null-prototype file maps; recorder validates conflicted owners and listed no-op keys (P3P-01, P3P-03)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Unambiguous observation records, accurate observation wording, spec §18.2 (P3P-02, P3P-04, parked)

**Files:**
- Modify: `replay/observe.mjs` (`treeChanges`, `snapshotTree`), `replay/runner.mjs` (only where `changes.txt` is joined)
- Test: `replay/observe.test.mjs`, `replay/runner.test.mjs`
- Regenerate (reference tooling): every case whose golden has `__sandbox__/changes.txt`. List them with `git ls-files 'corpus/cases/*/expected/*/__sandbox__/changes.txt'`. Engine-only cases use `… engine tokenomics`.
- Docs: `README.md` (observation boundary, plus `untracked` named), `corpus/CASES.md` §"Replay infrastructure", `tokenomics/ENGINE-B1.md`, `docs/spec.md` §18.2

**Interfaces:**
- `treeChanges(before, after) → string[]`. Each record is now one JSON array per line:
  - `["A","<path>","<digest>"]`;
  - `["M","<path>","<old>","<new>"]`;
  - `["D","<path>","<old>"]`.

  It is produced with `JSON.stringify`, so newlines, quotes and spaces in paths or link targets are escaped. Sort order is unchanged (by path). The runner joins records with `\n` and appends a final `\n`, as today. Scrubbing applies to each field **before** serialisation: pass the runner's scrub into `snapshotTree` for link targets, so the escaped JSON never hides a sandbox path from `scrub`.

- [ ] **Step 1: Failing tests (Codex Reproduction F).** In `replay/observe.test.mjs`:

```js
test('P3P-02: one link with a newline target is not two links', () => {
  const one = treeChanges(new Map(), new Map([['repo/link', 'l:x\nA repo/rogue l:y']]));
  const two = treeChanges(new Map(), new Map([['repo/link', 'l:x'], ['repo/rogue', 'l:y']]));
  assert.notEqual(one.join('\n'), two.join('\n'));
  assert.deepEqual(one.map((l) => JSON.parse(l)), [['A', 'repo/link', 'l:x\nA repo/rogue l:y']]);
});
test('records round-trip paths with spaces, quotes and arrows', () => {
  const p = 'repo/a "b" c→d';
  const [rec] = treeChanges(new Map([[p, 'f:1']]), new Map([[p, 'f:2']]));
  assert.deepEqual(JSON.parse(rec), ['M', p, 'f:1', 'f:2']);
});
```

  In `replay/runner.test.mjs`, add an end-to-end case whose script creates the symlink `repo/link` → `"x\nA repo/rogue l:y"`. Assert the `changes.txt` has exactly one record, and that it parses to that target. Run both. Expected: FAIL.

- [ ] **Step 2: Implement** the JSON-array records. Update the `treeChanges` docstring. Run the tests. Expected: PASS.

- [ ] **Step 3: Regenerate the affected goldens.** For each case from the `git ls-files` list, run `node scripts/goldens.mjs <case> 49577c7 reference/49577c7` (or `engine tokenomics` for engine-only cases). Then check `git diff --stat corpus/cases`: only `__sandbox__/changes.txt` files may change. Verify each one by parsing every new line as JSON and comparing the old line field by field (`A path digest` ↔ `["A",path,digest]`, `M path old→new` ↔ `["M",path,old,new]`). Put that check in the task report as a one-off script run, not a committed tool. Run `node scripts/diff-impl.mjs` → `differing 0`, and `node --test corpus/goldens.test.mjs`.

- [ ] **Step 4: Observation wording (P3P-04, parked).** In `README.md`, `corpus/CASES.md` and `tokenomics/ENGINE-B1.md`, state precisely:
  - **Git preconditions:** git on PATH. Without git, git dirs are walked as files and `changes.txt` may vary.
  - **Git summary:** it hashes raw committed blob ids (committed content is not scrubbed, so fixtures must not commit sandbox paths or times). A detached HEAD contributes only `detached`. It assumes SHA-1 object format. Gitlinks contribute commit ids.
  - **Matrix claim:** macOS + Node 24 and 18.19 verified locally; Linux git unverified (owner parked).
  - **Short exclusion list:** `README.md`'s list names `untracked` paths.
- [ ] **Step 5: Amend spec §18.2.** This is the owner's decision ("amend §18.2 to the implemented scope"). Replace "diffs every output byte-for-byte" with the implemented boundary in one paragraph. Copy the wording from `corpus/CASES.md` §"Replay infrastructure":
  - declared outputs byte-for-byte;
  - every event's stdout/stderr (diagnostics normalised);
  - final-state path changes with content digests under the sandbox root, excluding `.git`, `untracked` paths and writes outside the sandbox;
  - not observed: modes, mtimes, empty directories, transient writes.

  Add a changelog line at the spec's version history, if it has one: "v4.2.1: §18.2 scoped to the implemented observation boundary (owner decision 2026-10-11)".
- [ ] **Step 6: Gates and commit.** Run all five gates and check that each one is green.

```bash
git add replay/ corpus/cases README.md corpus/CASES.md tokenomics/ENGINE-B1.md docs/spec.md
git commit -m "fix(replay): JSON-array change records; precise observation wording; spec 18.2 scoped (P3P-02, P3P-04)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Freeze the map to the owner's decisions; extend the registry (P3P-05, P3P-06, parked, exclusion #4)

**Files:**
- Modify: `docs/b2/MIGRATION-MAP.md`
- Modify: `tokenomics/engine/migrations.mjs` (`MIGRATIONS`)
- Create: `corpus/migrations/{report-conflicts,role-dollars,report-revision,entry-points,capture-robustness,report-robustness}/migration.json`
- Modify: `corpus/coverage/exclusions.json` (row #4's reason)
- Test: `tokenomics/engine/migrations.test.mjs`, `corpus/migrations.test.mjs`
- Docs: `tokenomics/ENGINE-B1.md`, `docs/reviews/owner-signoff.md` (mark §1 rows approved)

**Interfaces:**
- `MIGRATIONS` becomes, in landing order (map §4), with each `item` as given:

```js
['exact-ids', 1], ['anon-complete', 5], ['fold-flags', 6], ['null-unobservable', 4],
['copilot-inclusive', 3], ['shared-allocation', 2], ['active-minutes', 7], ['report-windows', 8],
['scope-resolution', 9], ['reports-location', 10], ['writer', 11],
['report-conflicts', 22], ['role-dollars', 23], ['report-revision', 24],
['entry-points', 12], ['capture-robustness', 14], ['report-robustness', 18],
```

  Registry order is the composition order (`declarersOf` follows `MIGRATIONS`), so it must equal the landing order. A grouped entry's `item` is its lowest item number. Its `migration.json` adds `"items": [12, 13]` / `[14, 15, 16, 17, 21]` / `[18, 19, 20]`.
- `registryProblems` accepts an optional `items` (an array of integers that includes `item`). Any other shape is a problem.

- [ ] **Step 1: Failing tests.**
  - In `tokenomics/engine/migrations.test.mjs`: the ids and items above, in this order, all with `landed: false`.
  - In `corpus/migrations.test.mjs`: every `MIGRATIONS` id has a registry entry. For each group entry, `items` is as above and `beforeCases` is non-empty:
    - `entry-points`: `before-entry-symlink`;
    - `capture-robustness`: `cov-capture-vscode-edges`, `cov-capture-dispatch-edges`, `cov-copilot-dispatch`;
    - `report-robustness`: `fault-batch-cost-empty-repo`, `cov-team-report-batches`, `cov-export-submission-edges`.

  Run them. Expected: FAIL.
- [ ] **Step 2: Implement the registry.** Change `MIGRATIONS` as above and update the comment so it no longer says "each lands alone" (the groups amend §14.8; owner Q1b). Create the six `migration.json` files with `spec`, `summary`, `beforeCases` as listed, and `declared: {}`:
  - `report-conflicts`: before-case `cov-team-report-rollup`;
  - `role-dollars`: `cov-dispatch-batch`;
  - `report-revision`: `cov-team-report-rollup` and `cov-dispatch-batch`.

  Extend `registryProblems` for `items`. Run the tests and `node scripts/migrations.mjs check`. Expected: PASS, problems 0.
- [ ] **Step 3: P3P-06 resolution, written into the map.** Items 13 and 14 have no corpus diff (the replay normalises both). They land inside the `entry-points` and `capture-robustness` groups. Each group declares real corpus cases from its other items (`before-entry-symlink` for 12; the VS Code, dispatch-dir and live-host cases for 15–17 and 21), so the registry's "a landed migration declares a case" rule holds without a vacuous diff.

  Their own evidence is a unit test:
  - item 13: an unpreloaded child process writing more than 1 MB to a pipe, then exiting, with every byte received;
  - item 14: a `readdirSync` stub returning an unsorted listing, with sorted `subagents[]` and receipt search asserted.

  The group's commit and `ENGINE-B1.md` row name those tests. No change to the "landed declares a case" rule. Write this into map §3 (after the R17 note) and §5 Q1.
- [ ] **Step 4: Freeze the map.**
  - Replace §5's question list with a short "§5 Owner decisions (2026-10-11/12)" section that points to `docs/reviews/owner-decisions-2026-10-12.md` and lists Q1–Q16 with the decided answer, one line each (copy them from this plan's "Owner decisions applied").
  - In §2, change every "proposal (Qn)" / "proposal (map); owner question Q11b" to "decided (Qn)". Do this in particular at the two P3P-05 residues (item 8's "Engine change sites" "unverified on a missing archive" and its acceptance list, which are lines ~907 and ~940 at `d827b2e`).
  - Item 10: add the TA-default rule from this plan's Q13 line.
  - §4: add items 22–24 and the three groups to the numbered order, exactly as `MIGRATIONS`.
  - §1 D3's table: unchanged.
- [ ] **Step 5: Exclusion #4.** In `corpus/coverage/exclusions.json`, reword the reason of `scripts/work-scope.mjs#(anonymous)@17884` to name the waived failure: "Rejection handler of `main().then(…, onRejected)` (work-scope.mjs:335-338): reached only if `main()` rejects outside its own try/catch, i.e. a host/runtime failure such as an exception thrown by the Node runtime or a stdio write error escaping main; no CLI input reaches it; owner-approved 2026-10-11". Run `node scripts/coverage.mjs` → exit 0. In `docs/reviews/owner-signoff.md` §1, tick "approve" on all 10 rows, and add "(owner, 2026-10-11)".
- [ ] **Step 6: Gates and commit.** Run all five gates and check that each one is green.

```bash
git add docs/b2/MIGRATION-MAP.md tokenomics/engine/migrations.mjs tokenomics/engine/migrations.test.mjs corpus/migrations corpus/migrations.test.mjs corpus/coverage/exclusions.json docs/reviews/owner-signoff.md tokenomics/ENGINE-B1.md scripts/migrations.mjs
git commit -m "docs(b2): map frozen to owner decisions; registry gains items 22-24 and three robustness groups (P3P-05, P3P-06)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Phase A exit:**
- no undeclared-output pass is demonstrable for prototype names or newline records;
- the original Repro A–D regressions still pass;
- `none` = reference;
- every map choice is decided.

Tag `v0.2.1-rc.3` (local) on the Task 3 commit.

---

## Phase B — migrations (map §4 order)

Map section references below are to `docs/b2/MIGRATION-MAP.md` §2 "Item n". Line numbers in the map refer to `d827b2e`. Re-locate them by function name.

### Task 4: `exact-ids` (item 1)

**Files:** `tokenomics/scripts/batch-cost.mjs` (`matchIds`, `classify` fallback, `lineMatchesBatch`, the `mentionsKey` closure); tests in `tokenomics/scripts/batch-cost.test.mjs`; `corpus/migrations/exact-ids/`.

**Interfaces:** Produces `export function namesToken(text, token) → boolean` in `tokenomics/scripts/batch-cost.mjs`. It is true iff `token` occurs in `text` with no `[A-Za-z0-9_-]` character immediately before or after it, compared case-sensitively. Tasks 5 and 9 reuse it.

- [ ] **Step 1 (L1): failing tests.**

```js
test('exact-ids: namesToken whole-token, case-sensitive', () => {
  assert.equal(namesToken('implement TC-1,', 'TC-1'), true);
  assert.equal(namesToken('TC-1:', 'TC-1'), true);
  for (const t of ['implement TC-10', 'review tc-1', 'xTC-1', 'TC-1-2', 'TC-1_a']) assert.equal(namesToken(t, 'TC-1'), false, t);
});
```

  Also add, each under `TOKENOMICS_MIGRATIONS=exact-ids`, with the same fixture under `none` asserting today's substring result:
  - "matchIds: whole-token, case-sensitive";
  - "lineMatchesBatch: structured ids exact" (`cases: ['TC-1']` vs scope `cases: ['tc-1']` → no match);
  - "classify: declared fallback exact".
- [ ] **Step 2 (L2):** implement it. The `none` branch keeps `toLowerCase().includes`.
- [ ] **Step 3 (L3–L4):** record over these candidates: `before-ids-substring`, `cov-dispatch-batch`, `cov-reports-ledger`, `cov-team-report-batches`, `cov-team-report-rollup`, `cov-batch-cost-edges`, `seed-receipts-waves`, `cov-copilot-dispatch`, `foreign-settings`, `cov-work-scope-close-faults`, `seed-receipts-shared-id`. Check `before-ids-substring` against the map: `cases[TC-1].direct.dispatches` 2 → 0, both dispatches in `overhead.stages`.
- [ ] **Step 4 (L5–L8):** no interactions are possible (first landing). Then the gates, the docs, and the commit `feat(engine): exact-ids (B2 item 1)`.

### Task 5: `anon-complete` (item 5)

**Files:** `tokenomics/scripts/build-tokenomics-export.mjs` (`anonymizeDoc`); `tokenomics/extensions/test-automation.mjs` (`exportRow:anonymize`); tests in `tokenomics/scripts/build-tokenomics-export.test.mjs` and `tokenomics/extensions/test-automation.test.mjs`; `corpus/migrations/anon-complete/`.

**Interfaces:**
- Consumes `namesToken` (Task 4) for the token boundary.
- Produces `export function scrubSet(doc, rows, extraFromExt) → string[]`: the union of group slugs, `work_item_ref` values, receipt paths and briefs over every row and the document.
- Produces `export function scrubStrings(value, set) → value`: a deep copy where every string has every set member replaced by `anonymised`, matched as a whole token or a whole path segment, longest members first.

- [ ] **Step 1 (L1): failing tests** (each under `TOKENOMICS_MIGRATIONS=anon-complete`):
  - "anonymised doc contains no supplied identifier in any string": walk every string of the doc and of `submission.md`, against the union set;
  - "cross-row: row A's note names row B's slug and row B's `work_item_ref` → both scrubbed";
  - "nested and extension-returned string fields scrubbed";
  - "a short slug `b1` does not corrupt `claude-b1x`, `sha:ab1`, or a model name": boundary;
  - TA: "anonymize scrubs the cost.json path".
- [ ] **Step 2 (L2):** implement it. The engine applies `scrubStrings` after the extension's hook. `--batch` is unchanged.
- [ ] **Step 3 (L3–L4):** candidates `before-export-anon-batch`, `cov-export-submission-edges`, `cov-export-cli`.
- [ ] **Step 4 (L5–L8):** commit `feat(engine): anon-complete (B2 item 5)`.

### Task 6: `fold-flags` (item 6)

**Files:** `tokenomics/hooks/telemetry-capture.mjs` (`foldDispatchLog`); tests in `tokenomics/hooks/telemetry-capture.test.mjs`; `corpus/migrations/fold-flags/`.

**Interfaces:** Produces `export function attributionOf(line) → undefined | 'partial' | 'none'`, the flag computed over the parent and every dispatch. Tasks 7 and 8 reuse it.

- [ ] **Step 1 (L1): failing tests** (each under `fold-flags`):
  - "fold: unmeasured folded dispatch → tokens null + tokensAttributed false + line partial";
  - "fold: models = sorted union with folded tokensByModel keys";
  - "fold: complete stays flag-free";
  - "fold: folded entry key order equals a captured entry's": compare `Object.keys` with a captured dispatch from the same test.
- [ ] **Step 2 (L2):** implement it per map item 6 "Target behaviour".
- [ ] **Step 3 (L3–L4):** candidates `cov-capture-pricing`, `seed-claude-folded`, `cov-dispatch-batch`, `cov-capture-sync`. `cov-capture-sync` is included because its committed ledger feeds the `g:` digest.
- [ ] **Step 4 (L5–L8):** commit `feat(engine): fold-flags (B2 item 6)`.

### Task 7: `null-unobservable` (item 4), capture half and reader half (O1)

**Files:**
- `tokenomics/hooks/telemetry-capture.mjs`: `captureCopilotSession`, `captureCopilotDispatches`, `parseVsCodeChatSession`/`captureVsCodeSession`, `timeStats` consumers.
- `tokenomics/scripts/team-report.mjs`: `bucket`, `addLine`, `addTok`, by-role, renderers.
- `tokenomics/scripts/batch-cost.mjs`: `addTo`, `bucketOut`, `roleAdd`, renderers.
- `tokenomics/extensions/test-automation.mjs`: render parts that print counters.
- Tests in `telemetry-capture.test.mjs`, `team-report.test.mjs`, `batch-cost.test.mjs` and `test-automation.test.mjs`.
- New case `corpus/cases/before-report-unknowns/`.
- `corpus/migrations/null-unobservable/`.

**Interfaces:**
- Produces, in `tokenomics/scripts/team-report.mjs`, `export const UNMEASURED_KEYS = ['tokens','activeMin','wallMin','turns','toolCalls','toolErrors']`.
- Produces `export function addMeasured(bucket, key, value)`: a `null` or absent value increments `bucket.unmeasured[key]`; otherwise it adds to the sum.
- Every aggregate bucket gains `unmeasured: {…}` **only when the migration is on**. Markdown/HTML render a non-zero count as `n unmeasured` beside the sum.

- [ ] **Step 1: Build the before-case first, against the reference.** `before-report-unknowns` holds one parent line with `tokens: null` and `activeMin: null` and no dispatches, plus one ordinary priced line, followed by `team-report --json` and `batch-cost` events. Use `scripts/build-case.mjs` the way the other `before-*` cases do. Record its baseline with `node scripts/goldens.mjs before-report-unknowns 49577c7 reference/49577c7`. Add its row to `corpus/CASES.md`. Add it to `null-unobservable`'s `beforeCases`. Commit `test(corpus): before-report-unknowns baseline (O1)` with gates green.
- [ ] **Step 2 (L1): failing tests**, each under `null-unobservable`, mirrored under `none` for old behaviour:
  - "copilot usage-less shutdown → tokens null + tokensAttribution none";
  - "copilot dispatch toolErrors null; activeMin/toolCalls null when absent";
  - "vscode toolCalls/skills null";
  - "vscode usage-less → tokens null + attribution none";
  - "timestamp-less session → wallMin/activeMin null";
  - "null tokens / activeMin / counters are counted as unmeasured per quantity, never added as 0": `team-report`, one `tokens:null, activeMin:null` line; the totals carry the counts and contain no zero quad;
  - "null activeMin / toolCalls / toolErrors counted, not zeroed" (`batch-cost`);
  - Review Focus 4: "renders with nulls contain no `null`, `NaN`, `undefined`, `$null`" across `renderMarkdown`, `renderTeamHtml`, `renderBatchMarkdown`/`Html`, `renderBatchTokenomics*` and the live page;
  - Review Focus 3: "sweep twice over a timestamp-less session → one line".
- [ ] **Step 3 (L2):** implement it. Run the kit `check` over a fixture ledger of after-lines, and assert no `error` findings.
- [ ] **Step 4 (L3–L4):** candidates are the map item 4 list (`seed-copilot-no-usage`, `seed-vscode-credits`, `seed-vscode-no-credits`, `before-vscode-no-usage`, `seed-copilot-cli`, `cov-copilot-dispatch`, `cov-capture-copilot-edges`, `cov-capture-vscode-edges`, `cov-capture-claude-parse`, `cov-capture-scope-live`, `cov-reports-ledger`, `before-report-unknowns`), plus every report case: `cov-dispatch-batch`, `cov-team-report-batches`, `cov-team-report-rollup`, `cov-batch-cost-edges`, `seed-receipts-waves`, `seed-receipts-shared-id`, `foreign-settings`, `foreign-null-extension`, `cov-work-scope-close-faults`, `cov-capture-sync`.
- [ ] **Step 5 (L5):** expect interactions with `fold-flags` on shared ledger files (`cov-dispatch-batch`, `cov-capture-pricing` if declared, `cov-capture-sync`) and with `exact-ids` on report streams. Record each one.
- [ ] **Step 6 (L6–L8):** the TA render-part change is an API 2 contract item: note it in ENGINE-B1's API table draft. Commit `feat(engine): null-unobservable with unmeasured counts (B2 item 4, O1)`.

### Task 8: `copilot-inclusive` (item 3)

**Files:**
- `tokenomics/hooks/telemetry-capture.mjs`: `captureCopilotSession`, `captureCopilotDispatches`.
- `tokenomics/scripts/team-report.mjs`: `lineTokens`, by-role tokens.
- `tokenomics/scripts/batch-cost.mjs`: parent/dispatch token handling, and `sources.inclusiveSessions`.
- New fixture `tokenomics/fixtures/join/copilot-inclusive-session/`, plus its dispatch-grain negative variant `…-dispatch-split/`.
- Tests in `telemetry-capture.test.mjs`, `team-report.test.mjs`, `batch-cost.test.mjs` and `tokenomics/kit/conservation.test.mjs` (fixture list).
- `corpus/migrations/copilot-inclusive/`.

**Interfaces:** Readers decide by `line.tokensBasis === 'inclusive'`, **never** by `migrationOn` (O10: readers never drop formats). Only the writers are gated.

- [ ] **Step 1 (L1): failing tests:**
  - "copilot session: inclusive basis, un-netted totals, null dispatch split";
  - "copilot live record: null tokens";
  - "lineTokens ignores dispatch tokens of an inclusive line": run it **twice**, once with `TOKENOMICS_MIGRATIONS=copilot-inclusive` and once with `TOKENOMICS_MIGRATIONS=exact-ids` (migration off), with the same result both times (Review Focus 2);
  - "batch-cost allocates an inclusive line's tokens at session grain; `sources.inclusiveSessions` counted";
  - the join fixtures: `checkConservation` reports zero violations on `copilot-inclusive-session`, and `inclusive-dispatch-split` on the negative variant.
- [ ] **Step 2 (L2):** implement it. `tokensBasis` goes right after `tokens`.
- [ ] **Step 3 (L3–L4):** candidates `seed-copilot-cli`, `seed-copilot-no-usage`, `cov-copilot-dispatch`, `cov-capture-copilot-edges`, `cov-reports-ledger`, `cov-team-report-rollup`. The last two are expected to show no change; the tool refuses them, and the report says so.
- [ ] **Step 4 (L5):** interactions with `null-unobservable` on the four Copilot cases. Record each one, naming both ids.
- [ ] **Step 5 (L6–L8):** commit `feat(engine): copilot-inclusive (B2 item 3)`.

### Task 9: `shared-allocation` (item 2)

**Files:** `tokenomics/scripts/batch-cost.mjs` (`updateBatchCosts` computes `k` across receipts, excluding rollups; `buildBatchCost`'s partition takes it; `sources.sharedDispatches`); new fixture `tokenomics/fixtures/join/shared-dispatch-split/`; tests in `batch-cost.test.mjs` and `conservation.test.mjs`; `corpus/migrations/shared-allocation/`.

**Interfaces:** Consumes `namesToken` (Task 4). Produces `export function sharedDispatchCounts(groups) → Map<dispatchKey, k>`, where `dispatchKey = \`${line.host}:${line.id}:${dispatch.id}\``.

- [ ] **Step 1 (L1): failing tests:**
  - "a dispatch mine in k groups gets 1/k in each": two groups give 205/205 of 410 tokens, `dispatches` 0.5;
  - "k = 1 unchanged";
  - "sources.sharedDispatches counts dispatches with k > 1";
  - fixture `shared-dispatch-split` (`grain: 'dispatch'`) has zero violations.
- [ ] **Step 2 (L2):** implement it.
- [ ] **Step 3 (L3–L4):** candidates `seed-receipts-shared-id`, `before-dispatch-two-groups`, `cov-reports-ledger` (predicted to show no change), and every batch case in Task 4's list.
- [ ] **Step 4 (L5):** interactions with `exact-ids`/`null-unobservable` on shared `cost.json`, renders and export rows. Record them.
- [ ] **Step 5 (L6–L8):** commit `feat(engine): shared-allocation (B2 item 2)`.

### Task 10: `active-minutes` (item 7)

**Files:** `tokenomics/scripts/batch-cost.mjs` (`buildBatchCost`); `tokenomics/scripts/team-report.mjs` (by-role minutes); renderers; `tokenomics/extensions/test-automation.mjs` (`render-md` `cost` part renders `null` minutes); new fixture `tokenomics/fixtures/join/activemin-session-grain/`; tests in `batch-cost.test.mjs`, `team-report.test.mjs`, `test-automation.test.mjs` and `conservation.test.mjs`; `corpus/migrations/active-minutes/`.

- [ ] **Step 1 (L1): failing tests:**
  - "activeMin allocated at session grain; dispatch-partition fields null": these are `cases[].direct.activeMin`, `overhead.stages.activeMin`, `byStage.*.activeMin`, `rework.activeMin`, the dispatch-role `byRole` minutes and `stats.directActiveMin`, all `null`;
  - "loaded.activeMin = group time ÷ cases";
  - "by-role parent minutes inclusive; dispatch roles a separate breakdown; parent/dispatch role-name collision kept apart";
  - "render-md cost part with null minutes" (TA);
  - Review Focus 4 render test, extended to these fields;
  - fixture `activemin-session-grain` has zero violations, and `grain-activemin-dispatch` stays the negative control.
- [ ] **Step 2 (L2):** implement it.
- [ ] **Step 3 (L3–L4):** candidates are the map item 7 list (`cov-dispatch-batch`, `seed-receipts-shared-id`, `cov-reports-ledger`, `cov-team-report-batches`, `cov-team-report-rollup`, `cov-batch-cost-edges`, `seed-receipts-waves`, `cov-copilot-dispatch`, `cov-work-scope-close-faults`, `fault-batch-cost-sizing-locked`, `foreign-settings`, `foreign-null-extension`).
- [ ] **Step 4 (L5):** expect the most interactions here, on `cost.json` and period-report streams with items 1, 2 and 4. Record each one, naming every owner.
- [ ] **Step 5 (L6–L8):** commit `feat(engine): active-minutes (B2 item 7)`.

### Task 11: `report-windows` (item 8), with D1 manifest binding and `B1_DEFAULTS` (O4, O8)

**Files:**
- Create: `tokenomics/engine/manifest.mjs`.
- `tokenomics/engine/config.mjs`: frozen `B1_DEFAULTS`, the validation split.
- `tokenomics/scripts/team-report.mjs`: `filterWindow`, `loadCases`, `buildReport`, `main`, renderers.
- `tokenomics/hooks/scope-hook.mjs` (`suggestedIntents`).
- Tests in `tokenomics/engine/config.test.mjs`, `team-report.test.mjs` and a new `tokenomics/engine/manifest.test.mjs`.
- New case `corpus/cases/before-ratio-revisions/`.
- `corpus/migrations/report-windows/`.

**Interfaces** (`tokenomics/engine/manifest.mjs`):
- `export function manifestFor(telemetryDir, line) → { revision, ratioIntents, deliveredOutcomes, receiptPolicy, verified: boolean, finding?: string }` implements D1's reading rule:
  - a revisionless line → the implied legacy manifest (`IMPLIED_MANIFEST` from `tokenomics/kit/load.mjs`), `verified: true`;
  - `manifestRevision: N` → `<dir>/manifests/N.json`;
  - N = 1 with neither `module.json` nor `manifests/` → the implied manifest;
  - a missing archive → `verified: false`, with `finding` `manifest-archive-missing: revision N`.
- `export function currentManifest(telemetryDir) → { revision, ...manifest }`: `module.json`, else the implied manifest (revision 1). Tasks 14 and 17 use it.
- `config.mjs` exports `B1_DEFAULTS`, a deep-frozen copy of today's `TA_DEFAULTS` literal including `ratioIntents`. `loadSettings` merges over `B1_DEFAULTS` and validates with the B1 rules whenever `!migrationOn('report-windows')`.

- [ ] **Step 1: Build `before-ratio-revisions` against the reference first.** Its contents:
  - `manifests/1.json` (`['automation']`) and `manifests/2.json` (`['story']`);
  - `module.json` at revision 3 (`['spike']`);
  - priced lines with revisions 1, 2 and none, plus one naming revision 4 (no archive);
  - delivered receipts with `at`;
  - a `team-report --json` event.

  Record the baseline (`goldens.mjs … reference/49577c7`). Add its `CASES.md` row and add it to `beforeCases`. Commit `test(corpus): before-ratio-revisions baseline (O4)`.
- [ ] **Step 2 (L1): failing tests.** These are the map item 8 acceptance list verbatim:
  - window `[since, until)` UTC on `endedAt`;
  - default `since` = earliest `endedAt`;
  - §5.2 ordering, including reopened items and conflicting revisions;
  - the unwindowed count;
  - `null` vs `$0` vs partial;
  - O4: the historical-binding set, five tests;
  - O8 in `config.test.mjs`: "`none` with a foreign settings.json lacking ratioIntents loads and reports as today", and "`B1_DEFAULTS` has `ratioIntents`";
  - a date-only `--since 2026-10-01` → `2026-10-01T00:00:00Z`.
- [ ] **Step 3 (L2):** implement it. The report states the current-state semantics and the cumulative-line limitation in JSON (`semantics`) and in Markdown/HTML.
- [ ] **Step 4 (L3–L4):** candidates `cov-team-report-rollup`, `before-report-windows`, `before-ratio-manifest`, `before-ratio-revisions`, `cov-reports-ledger`, `cov-team-report-batches`, `foreign-settings`.
  - `foreign-settings` event 4's ratio becomes `null` (D1). This is intended; say so in its reason.
  - `before-ratio-manifest`'s numerator stays $0.50.
- [ ] **Step 5 (L5–L8):** interactions on the period-report streams with items 1, 2, 4 and 7. Commit `feat(engine): report-windows with manifest-bound ratio (B2 item 8, D1, O4, O8)`.

### Task 12: `scope-resolution` (item 9)

**Files:**
- `tokenomics/hooks/telemetry-capture.mjs`: `sessionScope`, `scopeForLine`, `captureDispatches`, `renderLiveReport`.
- `tokenomics/scripts/work-scope.mjs`: `scopesDir`, `scopePath`, `openScope`, `recordOutcomes`, `closeScope`, `listScopes`, `main`, plus the new `restamp`, `--host` and `--role`.
- `tokenomics/hooks/scope-hook.mjs` (`scopesDir`).
- `tokenomics/kit/` gains an `ambiguous-scope` finding.
- Tests in `work-scope.test.mjs`, `telemetry-capture.test.mjs`, `scope-hook.test.mjs` and `tokenomics/kit/check.test.mjs`.
- `corpus/migrations/scope-resolution/`.

**Interfaces:**
- `export function resolveScope(telemetryDir, host, sessionId, startedAtMs) → { scope|null, ambiguous: string[], claimedFrom?: string }` in `telemetry-capture.mjs`. It implements:
  - host-qualified records, with the legacy flat fallback;
  - precedence handoff > claimed pending > other;
  - claims by `renameSync(pending, '<host>/<id>.json.claim')` → write the merged record → `unlinkSync(claim)`, completing a leftover `.claim` on the next resolution;
  - an unreadable store → `{ scope: null, ambiguous: [] }`.
- `work-scope restamp --host <h> --session <id>`: its rejection paths land here. The success path lands in Task 14.

- [ ] **Step 1 (L1): failing tests.** These are the map item 9 acceptance list, except the `writer`-winner restamp test (Task 14):
  - handle on stdout;
  - `outcome`/`close` resolve the handle before and after the claim;
  - `auto` is accepted only on `open`;
  - restamp: no prior line → error; reference-era winner → error naming `capture --force`;
  - host-qualified read, legacy flat read, ambiguous id reported on stderr **and** as a kit finding;
  - precedence;
  - claim crash recovery: simulate a crash by leaving a `.claim` file and no session record, then assert the next resolution completes it and that a second session cannot claim;
  - an unreadable scopes store → the line is written without `scope` (R9);
  - `scope.role` is stamped;
  - `--host` defaults: `claude` when `CLAUDE_SESSION_ID`/`CLAUDE_PROJECT_DIR` is set, else a usage error on `open` without `--session auto`.
- [ ] **Step 2 (L2):** implement it.
- [ ] **Step 3 (L3–L4):** candidates `seed-scope-self`, `seed-scope-pending`, `seed-scope-handoff`, `fault-capture-sweep`, `before-scope-precedence`, `before-scope-handle`, `fault-pending-write`, `cov-dispatch-batch`, `cov-copilot-dispatch`, `cov-work-scope-lifecycle`, `fault-work-scope-usage`, every `cov-scope-hook*`, `seed-receipts-shared-id`, `cov-capture-vscode-edges`, `cov-capture-scope-live`, `foreign-settings`, `foreign-null-extension`. List further candidates with `grep -l '"work-scope\|scope-hook' corpus/cases/*/replay.json` and include every one.
- [ ] **Step 4 (L5–L8):** interactions on ledger files with items 4, 6 and 3, and on reports. Commit `feat(engine): scope-resolution (B2 item 9)`.

### Task 13: `reports-location` (item 10)

**Files:** `tokenomics/engine/config.mjs` (`groupReportsDir`, `validateSettings`, default merge); `tokenomics/scripts/batch-cost.mjs` (the `cost.json` write path, and the read path for the period report's `byBatch`); `tokenomics/scripts/work-scope.mjs` (`generateBatchReports`, the stderr path line); tests in `config.test.mjs`, `work-scope.test.mjs` and `batch-cost.test.mjs`; `corpus/migrations/reports-location/`.

**Interfaces:** `groupReportsDir(repo, settings, group) → string`. Under `telemetry` it returns `<repo>/.agents/telemetry/<dir>/reports/<group path>/`. `effectiveReportsLocation(settings, present) → 'tree'|'telemetry'`: the explicit value if one is given; else `'tree'` when there is no settings file or the effective extension is `test-automation`; else `'telemetry'`.

- [ ] **Step 1 (L1): failing tests:**
  - "reports.location telemetry accepted; default telemetry for a present non-TA file";
  - Review Focus 5: "present TA settings file without reports.location keeps tree";
  - "close writes reports and cost.json under the telemetry dir";
  - "the period report reads relocated cost.json";
  - "stderr path line names the new path".
- [ ] **Step 2 (L2):** implement it.
- [ ] **Step 3 (L3–L4):** candidates `foreign-settings`, `foreign-null-extension`, plus every TA case. TA cases are predicted unchanged; the tool refuses them, and the report says so.
- [ ] **Step 4 (L5–L8):** interactions with the allocation migrations on the moved `cost.json`. A relocation is `removed` + `changed` at the new path, so the interaction names every owner of the old path. Commit `feat(engine): reports-location (B2 item 10)`.

### Task 14: `writer` (item 11), with the restamp success path (O7)

**Files:**
- Create: `tokenomics/engine/version.mjs`.
- `tokenomics/hooks/telemetry-capture.mjs`: the measurement line builders, and `appendLine` with a restamp path.
- `tokenomics/scripts/work-scope.mjs`: the restamp success path.
- `replay/runner.mjs`: pins the version.
- `engine-allowlist.json`: the new env var site.
- Tests in `telemetry-capture.test.mjs`, `work-scope.test.mjs`, `tokenomics/engine/version.test.mjs` and `replay/runner.test.mjs`.
- `corpus/migrations/writer/`.

**Interfaces** (`tokenomics/engine/version.mjs`): `export function engineVersion(env = process.env) → string`. It returns `env.TOKENOMICS_ENGINE_VERSION_PIN`, else `package.json`'s `version`, read from `new URL('../../package.json', import.meta.url)`. If that file is absent (a copied install before B3's `ENGINE.json`), it returns `'0.0.0+unknown'`. `export const writerId = (env) => \`tokenomics-engine@${engineVersion(env)}\``.
- The replay runner sets `TOKENOMICS_ENGINE_VERSION_PIN=0.0.0-replay` for every event, so goldens never churn on a version bump.
- Line field order: `writer` and `manifestRevision` come right after `v`.
- A restamp append keeps the winner's `writer` and `manifestRevision` and sets `restampedBy: writerId()`.

- [ ] **Step 1 (L1): failing tests:**
  - "engineVersion: pin, package.json, missing file → 0.0.0+unknown";
  - "appendLine stamps writer + manifestRevision; module.json revision; implied → 1";
  - "restamp a line written by an older writer": the winner has `writer: tokenomics-engine@0.9.0` and `manifestRevision: 1`; the pin is `1.2.0` and `module.json` is at revision 2 (with `manifests/2.json`). The appended line has 0.9.0, revision 1 and `restampedBy` `tokenomics-engine@1.2.0`; it has the corrected `scope`; its measured fields and `endedAt` are unchanged; `capturedAt` = now;
  - Review Focus 3: "sweep twice with every migration on → one line per session";
  - Review Focus 2: "a mixed-era ledger (reference-era, inclusive Copilot, writer lines) gives the same period report under `TOKENOMICS_MIGRATIONS` unset and with `copilot-inclusive` excluded";
  - kit: `check --mode mixed` on an after-ledger → no error; `--mode port` on the writer lines only → no error;
  - runner test: an event's environment carries the pin.
- [ ] **Step 2 (L2):** implement it. Use `currentManifest` from Task 11.
- [ ] **Step 3 (L3–L4):** the 40 candidate cases in map item 11, plus every case Task 12 declared that appends a line. `cov-capture-sync`'s `changes.txt` is declared.
- [ ] **Step 4 (L5):** this produces the bulk of ledger interactions, with `fold-flags`, `null-unobservable`, `copilot-inclusive` and `scope-resolution`. Record each one, naming every owner. Update `before-scope-precedence`'s restamp event: exit 0 with `writer` lines.
- [ ] **Step 5 (L6–L8):** commit `feat(engine): writer + manifestRevision; restamp keeps provenance (B2 item 11, D4, O7)`.

### Task 15: `report-conflicts` (item 22, O2)

**Files:** `tokenomics/scripts/team-report.mjs` (`dedupLines` → a §3.5 dedup; `conflicts: n`; preview total); `tokenomics/scripts/batch-cost.mjs` (group cost uses the same dedup); renderers; tests in `team-report.test.mjs` and `batch-cost.test.mjs`; `corpus/migrations/report-conflicts/`.

**Interfaces:** Produces `export function dedupConflicts(lines) → { winners, duplicates: n, conflicts: [{ key, lines }], preview: line[] }`. The canonical JSON is the kit's (`tokenomics/kit/` canonicaliser, the same one `aggregate` uses; import it, do not copy it).

- [ ] **Step 1 (L1): failing tests:**
  - "exact tie, identical payload → one duplicate";
  - "exact tie, different payload → conflict: excluded from verified totals; preview total picks the lowest canonical JSON; conflicts: 1";
  - "forward = reversed input order";
  - the same three for the `batch-cost` group cost.
- [ ] **Step 2–4 (L2–L8):** candidates `cov-team-report-rollup` plus every period-report and batch case. Record the interactions on the shared streams. Commit `feat(engine): report-conflicts (B2 item 22, O2)`.

### Task 16: `role-dollars` (item 23, O3)

**Files:** `tokenomics/scripts/batch-cost.mjs` (`byRole` dollars; a new `byDispatchRole` breakdown); `tokenomics/scripts/team-report.mjs` (by-role dollars, if rendered); renderers; tests in `batch-cost.test.mjs`; `corpus/migrations/role-dollars/`.

**Interfaces:** `cost.json.byRole.<parent role>.costUsd` = the session-inclusive `costUsd` / div. `cost.json.byDispatchRole.<role>.costUsd` is the measured per-dispatch dollars, never summed into `byRole` or `totals`.

- [ ] **Step 1 (L1): failing test.** "byRole dollars: parent role = session-inclusive; dispatch-role dollars in a separate measured breakdown": $10 / $4 → `byRole.lead` 10, `byDispatchRole.worker` 4, `totals.costUsd` 10.
- [ ] **Step 2–4 (L2–L8):** candidates `cov-dispatch-batch`, `seed-receipts-shared-id` plus every batch case. Record the interactions with items 2, 4 and 7 on `cost.json`. Commit `feat(engine): role-dollars (B2 item 23, O3)`.

### Task 17: `report-revision` (item 24, O6)

**Files:** every report writer: `cost.json` (`batch-cost.mjs`), the batch renders and period report JSON/Markdown/HTML (`team-report.mjs`), the live page (`telemetry-capture.mjs` `renderLiveReport`), and the export (`build-tokenomics-export.mjs`). Tests in `team-report.test.mjs`, `batch-cost.test.mjs`, `work-scope.test.mjs` and `build-tokenomics-export.test.mjs`. `corpus/migrations/report-revision/`.

**Interfaces:** Consumes `currentManifest` (Task 11). JSON reports get a top-level `manifestRevision` after their first key. Markdown/HTML get a footer line `manifest revision N`.

- [ ] **Step 1 (L1): failing test.** "every engine-written report records the current manifest's manifestRevision; implied manifest → 1", one assertion per report kind.
- [ ] **Step 2–4 (L2–L8):** candidates are every report case. Record the interactions. Commit `feat(engine): report-revision (B2 item 24, O6)`.

### Task 18: `entry-points` group (items 12 `entry-guard`, 13 `stdout-drain`)

**Files:** every entry point's main guard and exit path: `tokenomics/hooks/telemetry-capture.mjs`, `tokenomics/hooks/scope-hook.mjs`, `tokenomics/scripts/work-scope.mjs`, `batch-cost.mjs`, `team-report.mjs`, `build-tokenomics-export.mjs`. Create `tokenomics/engine/entry.mjs`. Tests in `tokenomics/engine/entry.test.mjs`. `corpus/migrations/entry-points/`.

**Interfaces:**
- `export function isMain(importMetaUrl, argv1 = process.argv[1]) → boolean` compares `realpathSync(fileURLToPath(importMetaUrl))` with `realpathSync(argv1)`.
- `export async function exitAfterDrain(code)` waits for `process.stdout`/`process.stderr` to drain (`writableNeedDrain` → `once('drain')`), then calls `process.exit(code)`.
- With the group off, the reference guard and exit stay as they are.

- [ ] **Step 1 (L1): failing tests.**
  - "isMain true through a symlinked path" (create a temp symlink to a temp module).
  - "stdout-drain: unpreloaded child writing 2 MB to a pipe then exiting delivers every byte". Spawn `team-report.mjs` with a large synthetic ledger, **without** `NODE_OPTIONS=--import=<preload>`, and with `TOKENOMICS_MIGRATIONS=entry-points`. Assert the received byte length equals the length the same run writes to a file. The R17 note applies: claim no more than Node's documentation.
- [ ] **Step 2–4 (L2–L8):**
  - The corpus candidate is `before-entry-symlink`.
  - Record the `entry-points` + `writer` interaction on `before-entry-symlink` (the stamped line): `entry-points` declares the case, and the interaction names both.
  - The commit body names the item-13 unit test as that item's evidence (P3P-06, Task 3).
  - Commit `feat(engine): entry-points group (B2 items 12, 13)`.

### Task 19: `capture-robustness` group (items 14 `stable-enumeration`, 15 `dispatch-dir`, 16 `vscode-oplog-holes`, 17 `vscode-end-guard`, 21 `live-host`)

**Files:** `tokenomics/hooks/telemetry-capture.mjs` (sub-agent enumeration sort; the dispatch transcript `EISDIR` guard; VS Code op-log hole handling; the VS Code end-advance guard); `tokenomics/extensions/test-automation.mjs` (receipt search sort); `tokenomics/scripts/batch-cost.mjs` (provisional live line `host` from the live log); tests in `telemetry-capture.test.mjs`, `batch-cost.test.mjs` and `test-automation.test.mjs`; `corpus/migrations/capture-robustness/`.

- [ ] **Step 1 (L1): failing tests:**
  - 14: a `readdirSync` stub injected via the module's existing test seam returns `['b','a','c']`. Assert `subagents[]` and the receipt search order are sorted. If there is no seam, add an optional `fs` parameter on the two functions only.
  - 15: "a directory transcript path → that dispatch skipped with a stderr note, remaining dispatches recorded".
  - 16: "op-log update two past the end → session captured, holes ignored".
  - 17: "timestamp-less VS Code session appended once across three sweeps".
  - 21: "Copilot live log → provisional line host copilot".
- [ ] **Step 2–4 (L2–L8):** candidates `cov-capture-vscode-edges`, `cov-capture-dispatch-edges`, `cov-copilot-dispatch`, `cov-dispatch-batch`. Record the interactions with the ledger owners. The commit names the item-14 unit test as its evidence. Commit `feat(engine): capture-robustness group (B2 items 14-17, 21)`.

### Task 20: `report-robustness` group (items 18 `empty-repo-sizing`, 19 `zero-session-share`, 20 `submission-identity`) and the kit ENOTDIR fix (Q2)

**Files:** `tokenomics/scripts/work-scope.mjs` (`--repo ""` → the usage error, or `repo` resolved); `tokenomics/scripts/team-report.mjs` (`pct(0/0)` → `—`); `tokenomics/extensions/test-automation.mjs` and `build-tokenomics-export.mjs` (no `undefined`/`$null` in `submission.md`); `tokenomics/kit/load.mjs` (ENOTDIR → a `scopes-not-directory` finding: kit maintenance, not gated); tests in `work-scope.test.mjs`, `team-report.test.mjs`, `build-tokenomics-export.test.mjs` and `tokenomics/kit/load.test.mjs`; `corpus/migrations/report-robustness/`.

- [ ] **Step 1 (L1): failing tests:**
  - 18: "close --repo '' → exit 1 usage error naming --repo" (decision: an empty `--repo` is a usage error, the simplest correct behaviour);
  - 19: "zero-session group renders — not NaN%";
  - 20: "incomplete segment → title and Stop · owner row omit the missing value; overflowing sum renders 'n/a', never `$null`";
  - kit: "scopes path is a file → finding, no throw".
- [ ] **Step 2–4 (L2–L8):** candidates `fault-batch-cost-empty-repo`, `cov-team-report-batches`, `cov-export-submission-edges`, `fault-scope-dir-blocked` (kit only; the engine output is predicted unchanged). Commit `feat(engine): report-robustness group (B2 items 18-20); kit ENOTDIR finding (Q2)`.

---

## Phase C — freeze, close, review

### Task 21: Extension API 2 freeze (D3)

**Files:** `tokenomics/engine/extension.mjs`, `tokenomics/extensions/test-automation.mjs`, `tokenomics/ENGINE-B1.md`, `tokenomics/engine/extension.test.mjs`.

- [ ] **Step 1: failing tests.**
  - "a hook returning a Promise throws `tokenomics: extension hook <name> returned a Promise (hooks are synchronous)`".
  - "every HOOK_CALLS entry's documented part set equals the parts the corpus trace records". Use the existing `HT_EXT_TRACE_FILE` trace over the corpus, the way the current name:phase test does, extended to `part`.
- [ ] **Step 2:** implement it. Set `EXTENSION_API = 2` and TA `extensionApi = 2`. Rewrite the ENGINE-B1 table as the API 2 contract (calls, parts, input, ctx, return contract), with every change Tasks 4–20 made. These include the unmeasured count fields (Task 7), null minutes (Task 10), host-qualified scope records with `role` (Task 12), `ctx.dir` under `telemetry` (Task 13), and the `exportRow:anonymize` contract (Task 5).
- [ ] **Step 3:** gates, then commit `feat(engine): freeze extension API 2 (D3)`.

### Task 22: B2 close (O8)

**Files:** `tokenomics/engine/config.mjs`, `tokenomics/engine/config.test.mjs`, `tokenomics/ENGINE-B1.md`, `README.md`, `docs/plans/plan-4-ledger.md` (copied from `.superpowers/sdd/`), `docs/plans/plan-4.md`.

- [ ] **Step 1: failing test.** "after B2 close, `TA_DEFAULTS` has no `ratioIntents`; `B1_DEFAULTS` still has it; `none` with a settings.json lacking ratioIntents reports as today".
- [ ] **Step 2:** remove `ratioIntents` from `TA_DEFAULTS` and the B2 validator only. Run `node scripts/diff-impl.mjs` → `differing 0` **after** this change.
- [ ] **Step 3: clean-clone verification.** Clone to `<scratchpad>/ht-b2`. On Node 24 and on Node 18.19 (`$N18`), run all five gates. `git status --short` must be empty afterwards. Record the counts in the ledger.
- [ ] **Step 4:** copy the ledger and plan, then commit `chore(b2): close B2 — ratioIntents leaves the B2 settings contract; ledger`. Tag `v0.3.0-rc.1` (local).

### Task 23: The single Codex milestone review and its fix wave

- [ ] **Step 1:** run one Codex review of `v0.2.1-rc.2..v0.3.0-rc.1` (`codex:rescue` / companion `gpt-6-astra --effort high`; memory `codex-gpt-astra-reviewer.md`). Write it to `docs/reviews/b2-codex-review.md`. If the provider flags content after writing the file, keep the file and proceed.
- [ ] **Step 2:** fix every Blocker/Major finding (one task each, TDD, all gates green). List every finding in `docs/plans/plan-4-ledger.md` with its disposition: fixed (commit), or parked (reason, with an owner milestone). **No re-review** (owner decision): the owner checks the fix list.
- [ ] **Step 3:** move the tag `v0.3.0-rc.1` to the final ledger commit (local), and report the gate counts to the owner.
