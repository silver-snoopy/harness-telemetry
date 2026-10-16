Not approvable

# Plan 3 independent milestone review — B2 entry gate

Reviewed `v0.2.0-rc.2` (`4913d979b036298eda428bbe27114e6f91d813f7`) → `v0.2.1-rc.1` (`ab146c128b2d91e696b11804553c6b7b89ccd9b5`), with `main` and HEAD at the latter. Review date: 2026-10-11. This verdict concerns building the migration implementation plan on this candidate. A bounded Plan 4 Task 1 to repair the gate and settle the map can proceed.

The most important defect is a reproduced false pass: with two migrations declaring a case, the cumulative gate checks a union of filenames, not the declared contents. Tool-generated `expected/b2` can therefore bless undeclared behavior. Separately, the local baseline is red again: the broader observation boundary captures `stage-tmp/xcrun_db` in both reference and engine. All eleven migrations now have meaningful before-evidence, and the inventory, configuration validation, engine-only pinning and grain checks are substantial improvements. They do not close these gate failures.

No §14.8 migration has landed. Findings about the map concern instructions that would produce an incomplete or contradictory B2 implementation, not demands to implement B2 behavior during this baseline milestone. Existing reference accounting defects remain legitimate B1 behavior until their declared migration.

## 1. Findings

Severity is relative to using this candidate as the Plan 4 foundation. **Blocker** means the central acceptance mechanism can certify an undeclared change. **Major** means a baseline or contract issue to resolve before dependent migration work. **Minor** means a bounded correction with a clear next task.

| ID | Severity | Area | File:line | Finding | Evidence / reproduction | Recommended fix |
|---|---|---|---|---|---|---|
| P3-01 | Blocker | Exact declared diffs | `scripts/migrations.mjs:153`, `:163`, `:211`, `:274` | Two declarers of a case disable exact content validation for **every** declared path, even paths owned by only one of them. Arbitrary cumulative bytes, cancellation of a declared change, or deletion of a path declared only as changed pass. `writeB2` generates the oracle that subsequently blesses these differences. | Repro A: actual `writeB2` and `checkMigrations`, with virtual filesystem/replay dependencies, accept all three variants; `none`, `only:a`, `only:b`, `default` all have zero problems. The direct `b2Problems` reproduction also returns `[]`. | Compose exact disjoint declarations; require explicit, reviewed byte-level interaction expectations when composition changes a path. Pin existence/deletion and cumulative exits too. Make recording validate against those expectations instead of supplying their authority. Add negative tests for changed bytes on an already-declared path, cancellation and changed→removed. |
| P3-02 | Major | Baseline portability | `corpus/cases/fault-capture-stage-locked/replay.json:54`, `:69`; `replay/runner.mjs:108` | P2-01 has resurfaced through `changes.txt`: macOS host tooling creates `repo/stage-tmp/xcrun_db`. Neither golden declares it. The candidate's full test/differential/migration gates fail locally. | `npm test`: 581 tests, 575 pass, 2 fail, 4 skip. `diff-impl`: 65 cases, 1 differing. `migrations check`: 68 cases, 2 problems. Repro B sequentially reproduces `A repo/stage-tmp/xcrun_db` twice per implementation, exits `[0,0]`, all other files equal. | Isolate/control the host Git/Xcode cache or narrowly justify excluding that exact infrastructure artifact. Preserve the locked-stage cleanup assertions and observation of other writes. Do not record the host cache as reference behavior or broadly exclude the entire stage directory. |
| P3-03 | Major | Observation completeness | `replay/observe.mjs:36`; `replay/runner.mjs:109`; `corpus/CASES.md:170` | Fingerprints detect a change but are discarded from the returned observation. Two implementations adding the same extra path with different contents both yield `A path`; two different modifications both yield `M path`. Thus even inside the stated sandbox boundary, output bytes are not compared. | Repro C: two different fingerprints give identical `changes.txt`. Existing `cov-capture-sync` reduces any secondary Git-store mutation to `M repo/tgit/`; map item 11 explicitly relies on that staying unchanged (`MIGRATION-MAP.md:1010`). | Include stable, normalized content or content digests and link targets in observable additions/modifications. Give Git metadata a precise normalization/exclusion policy. Amend the scope descriptions: the present observation is a final path-change summary, not every write's bytes. |
| P3-04 | Major | Actual default mode | `scripts/migrations.mjs:173`, `:176`, `:205` | Once anything lands, “default” supplies the explicit landed-id list instead of exercising the unset environment. A migration implemented as “enabled only when its name appears in the variable” passes despite doing nothing in an ordinary unset invocation. | Repro D uses the **committed** fake implementation (`scripts/fixtures/migrations/impl/scripts/w.mjs:3`): `demo` gives migrated files; unset gives baseline. The existing write/b2/default test nevertheless passes for that implementation. | Run a genuine unset-default mode with the engine's actual registry. Keep an explicit-all mode separately if useful. Test equivalence of unset and explicit-all after landing a fake migration; distinguish injected test registries from production default semantics. |
| P3-05 | Major | Missing B2 contract ownership | `docs/b2/MIGRATION-MAP.md:494`, `:641`, `:1126`, `:1150` | The map offers continued unknown→zero aggregation and first-wins conflict handling as ordinary B2 options, although §3.2.1 and §3.5 require otherwise. It also attributes an inclusive by-role **minutes** rule to text that specifies **dollars**, leaving current by-role dollars without a migration owner. | Repro E: unknown tokens/minutes become zero without unknown counts; reversing exact-rank conflicting lines changes the winner $10→$20; a $10 session with a measured $4 dispatch produces `byRole={lead:6,worker:4}`. Binding `docs/spec.md:234`, `:236`, `:273`. | Assign these requirements to named migrations and exact expectations, or explicitly request a spec/milestone amendment. Correct item 7's citation; decide the presentation of minutes separately. Q8d/Q16 cannot silently waive the reader contract. |
| P3-06 | Major | Historical manifest binding | `docs/b2/MIGRATION-MAP.md:1134`; `docs/spec.md:778` | Q11's fallback to the **current** `module.json` for revisionless historical lines can change those lines' eligible intents when the current manifest changes. That reintroduces the mutable historical interpretation D1 is meant to eliminate. Missing archived revisions and legacy receipt-policy binding are insufficiently specified. | D1's own rationale at `MIGRATION-MAP.md:43` rejects this effect; Q11 at `:1135` proposes it. The before-case has only one revision, so cannot distinguish stable from mutable binding. | Define an immutable legacy/implied revision policy, named behavior for a missing archive, and revision-bound receipt/outcome interpretation. Add a historical report case with archived revisions and a changed current manifest. |
| P3-07 | Minor | Preservation of `none` | `docs/b2/MIGRATION-MAP.md:36`; `tokenomics/engine/config.mjs:49`; `tokenomics/scripts/team-report.mjs:234` | D1 says the off path honors `settings.ratioIntents`, but removes it from `TA_DEFAULTS` when B2 closes. No separate frozen B1 default is specified. Straight implementation would reject minimally configured foreign settings or break the legacy report path. | Current validation requires the array and `buildReport` calls `.map` on it. This is a map inconsistency, not a current runtime regression. | Retain an explicit B1 configuration/context behind `none`; remove the key only from the B2 executable-settings contract. Keep the legacy differential green after the final B2 cleanup, not just between migrations. |
| P3-08 | Minor | Writer/restamp interaction | `docs/b2/MIGRATION-MAP.md:987`, `:992`, `:862` | Item 11 recommends stamping **every append** with the current package writer/current manifest, while restamp must preserve measurement provenance, including the original writer. The generic append-point instruction has no exception. | Compare item 11 with item 9 and `docs/spec.md:184`, `:931`. A restamp of an older engine's winner exposes the conflict; a same-version test would miss it. | Distinguish capture stamping from restamp append. Specify manifest-revision handling as well as original writer preservation; test an older-version winner after the current manifest advances. |
| P3-09 | Minor | Anonymization specification | `docs/b2/MIGRATION-MAP.md:555`, `:558`, `:580` | The target promises no supplied identifier in any output string, but the proposed algorithm/test scans each row only for that row's own identifiers. A note in row A can mention row B's slug or reference and survive. | Logical counterexample to the proposed per-row algorithm; the new single-row before-case does not exercise it. This is a future implementation trap, not a newly introduced leak in B1. | Collect the complete supplied-identifier set before replacement; test cross-row, nested and relevant document-level strings, including extension-returned fields. Resolve Q9's exact scope. |
| P3-10 | Minor | Reference-defect evidence | `docs/b2/MIGRATION-MAP.md:1045`, `:1049`, `:1054`; `replay/preload.mjs:25` | R13/item 14 still uses the macOS/Linux ordering premise the final ledger withdrew; its sorted replay anchor cannot exhibit a sorting fix. R17 also overstates that Linux pipes lose nothing / are synchronous. | Ledger `:103`; no golden changed with the sort patch. Node 18.19 documents POSIX pipe writes as asynchronous (source below). | Correct the map before asking Q1. Use an unsorted-listing stub for the sorting fix and unpreloaded subprocess evidence for stdout drain. Retain the legitimate blocking-stdio capture correction. |
| P3-11 | Minor | Diagnostic portability | `replay/observe.mjs:47`; `docs/plans/plan-3-ledger.md:104` | V8's anonymous `at async <location>:line:col` frame is not normalized. Future async error goldens can expose implementation/Node-dependent locations and frame runs. | Repro C preserves `at async file:///impl/a.mjs:15:4` verbatim. Already parked in the ledger. | Add the optional async prefix and regression tests before recording new diagnostics. Keep ordinary prose and stdout intact. |
| P3-12 | Minor | B2 recording exits | `scripts/migrations.mjs:158`, `:163`, `:274`; `docs/plans/plan-3-ledger.md:105` | `writeB2` accepts baseline exits even if a sole declarer requires different exits, because exit validation runs only when the actual exits differ from baseline. Full `check` subsequently rejects it, so this is not another silent check pass. | Source trace: baseline `[0]`, declaration `[1]`, actual `[0]`; the exit branch is skipped and single-declarer comparison compares only files. Already parked. | Validate the complete declared exit vector regardless of whether actual exits equal baseline. Prefer validating all requested recordings before changing any B2 tree. |

### Reproduction A — cumulative oracle can bless undeclared bytes

Small, read-only reproduction of the faulty predicate:

```sh
node --input-type=module <<'NODE'
import {b2Problems} from './scripts/migrations.mjs';
const base = {files: {a: 'base'}, exits: [0]};
const declarers = [
  {id: 'a', d: {changed: ['a']}},
  {id: 'b', d: {changed: ['b']}},
];
console.log(b2Problems('c', base, {a: 'UNDECLARED', b: 'B'}, declarers, [0]));
console.log(b2Problems('c', base, {b: 'B'}, declarers, [0]));
NODE
```

Actual output: `[]`, `[]`. The absence of `entry`/after-files here is intentional: the two-declarer branch never reads them.

I additionally evaluated the unchanged `scripts/migrations.mjs`, `scripts/engine-only.mjs`, `replay/exits.mjs` and migration registry module through `vm.SourceTextModule`, substituting only filesystem operations with an in-memory map and `runCase` with deterministic outputs. This exercised registry validation, recording and the whole mode loop without editing any fixture. Both migration entries had valid reasons, matching item numbers, `beforeCases: ['c']`, and exact after-files. A alone declared `out/a.txt = A`; B alone declared addition `out/b.txt = B`; baseline was `out/a.txt = base`; all exits were `[0]`.

| Combined replay returned | `writeB2` result | `checkMigrations` results |
|---|---|---|
| `a = UNDECLARED COMBINATION BYTES`, `b = B` | Wrote these bytes to virtual `expected/b2` | `none: []`, `only:a: []`, `only:b: []`, `default: []` |
| `a = base`, `b = B` | Wrote the cancelled A change | All four modes: `[]` |
| Only `b = B` | Wrote deletion of A's changed-only file | All four modes: `[]` |

This is a checker/recorder reproduction with a mocked replay boundary, not a claim that a bad migration is already landed. The committed tests cover a **new undeclared filename** (`scripts/migrations.test.mjs:212` onward); they do not cover these variants within declared filenames.

The replacement design must support legitimate interactions too. For example, proposed `entry-guard` enables a capture that was previously skipped through a symlink. `writer` alone cannot change `before-entry-symlink`, but together they must produce a stamped line. Today a single entry-guard declarer requires exact equality with its unstamped isolation result; a writer declaration for its no-op isolation result is forbidden. A separately declared interaction is needed for both sound acceptance and avoidance of false rejection.

### Reproduction B — actual baseline failure, sequentially

```sh
node --input-type=module <<'NODE'
import {runCase} from './replay/runner.mjs';
import {goldenFiles, compareFiles} from './scripts/migrations.mjs';
const c = 'corpus/cases/fault-capture-stage-locked';
for (const impl of ['reference/49577c7', 'tokenomics']) {
  for (let i = 0; i < 2; i++) {
    const r = await runCase(c, impl, {extraEnv: {TOKENOMICS_MIGRATIONS: 'none'}});
    console.log(impl, i, r.exits, r.files['__sandbox__/changes.txt'],
      compareFiles(goldenFiles(c + '/expected/49577c7'), r.files));
  }
}
NODE
```

Each run: exits `[0,0]`, changes `A repo/stage-tmp/xcrun_db\n`, problems `['extra __sandbox__/changes.txt']`. The stage fault and its cleanup still produce their expected observations. This is host contamination of the oracle, not a reference/engine algorithm difference. The old fix stopped collecting TMPDIR bytes; the new path observer sees the artifact again.

### Reproduction C — observations and async diagnostics

```sh
node --input-type=module <<'NODE'
import {treeChanges, normalizeDiagnostics} from './replay/observe.mjs';
for (const hash of ['f:aaa', 'f:bbb'])
  console.log(treeChanges(new Map(), new Map([['repo/extra.txt', hash]])));
console.log(normalizeDiagnostics(
  'Error: boom\n    at async file:///impl/a.mjs:15:4\n', {stream: 'stderr'}));
NODE
```

Both trees produce `['A repo/extra.txt']`; the async frame remains unnormalized. The same fingerprint-loss example applies to modifications and changed symlink targets. Snapshotting only before/after also does not observe a transient create-and-delete or write-and-restore within the event sequence; empty directories, modes and mtimes are not represented. These limits should be explicit when describing “every write.”

### Reproduction D — explicit-all is not unset-default

```sh
node --input-type=module <<'NODE'
import {runCase} from './replay/runner.mjs';
for (const value of ['demo', null]) {
  const r = await runCase('scripts/fixtures/migrations/cases/m1',
    'scripts/fixtures/migrations/impl',
    {extraEnv: {TOKENOMICS_MIGRATIONS: value}});
  console.log(value, r.files, r.exits);
}
NODE
```

`demo` produces `a=demo`, `b=added`; unset produces `a=base` only. The committed test named “write generates the declared files; b2 generates expected/b2; default then passes” accepts this fixture because default injects `demo`. The real `enabledMigrations` currently has the correct unset semantics; the gate does not require implementations to use them correctly once migrations land.

### Reproduction E — map obligations that still need owners

Read-only direct imports of `buildBatchCost`, `buildReport` and `dedupLines` confirmed:

- One matching Claude session with `costUsd:10`, role `lead`, one matching dispatch with `costUsd:4`, role `worker`, and one receipt produces `cost.byRole.lead.costUsd=6`, `worker.costUsd=4`. §3.2.1 requires inclusive parent-role dollars, with dispatch-role dollars a separate measured breakdown.
- Two otherwise identical lines with the same `host:id`, `endedAt` and `capturedAt`, differing only in costs 10/20, yield winner 10 in forward order and 20 in reverse. The kit's conflict implementation does not change the engine report's first-wins reader.
- A report over one line with `tokens:null`, `activeMin:null`, and no dispatches emits a zero token quad and `activeMin:0` without unknown counts. This is the concrete behavior Q8d proposes retaining.

These are preserved reference defects. P3-05 is the map's failure to assign their required post-B1 resolution, not an assertion that Plan 3 should already have changed their output.

### Harness soundness by requested attack

| Attack / boundary | Assessment |
|---|---|
| Migration ignores its switch and always changes output | Full `check`'s `none` mode compares against the frozen baseline and rejects observed changes. An always-inert migration cannot satisfy a nonempty, non-baseline declaration. Empty declarations, equal after-files, absent removals and baseline-equal exit declarations are rejected. `check --only` is intentionally narrower and must not substitute for the full gate. |
| Change only when combined with another migration | New filenames outside the declared union are rejected. New bytes, deletions or cancellation **inside** that union pass: P3-01. No intermediate subset modes are run; explicitly supported production subsets need their own coverage if Q3 ever allows any. |
| Real unset-default behavior | Not tested after a migration lands: P3-04. Explicit-all is not evidence about unset behavior. |
| Exits | Per-event values and vector length are compared (`scripts/migrations.mjs:43`). Undeclared changes are caught. Conflicting declared exit vectors fail. Valid combinations whose independent changes affect different events currently need an explicit cumulative exit design; the checker only accepts a single common vector. Recording has P3-12, but the full check fails afterward. Signals/timeouts yielding null status fail integer expectations. |
| Engine-only cases | They participate in every migration mode against `expected/engine` (`scripts/migrations.mjs:138`). The three approved IDs are pinned with reasons; reference goldens on an engine-only case are forbidden. The ordinary `diff-impl` skips them, but migration checks and engine tests cover them. |
| Cases added later without a declaration | Every case directory is enumerated in every mode. With no declaration, its output must equal baseline; missing replay/golden is a failure. An unauthorized engine-only flag also fails. A case is not required to declare migrations that do not change it. |
| Landed migration omits its before-case | Rejected unless a reasoned `beforeCasesWaived` entry exists. A reason's length is a mechanical guard, not independent approval of a waiver. Review changed registry/approval files. |
| Environment lost in nested processes | No loss found in current paths. `runCase` overlays the harness variable last (`replay/runner.mjs:80`); capture's meter spreads `env` (`tokenomics/hooks/telemetry-capture.mjs:549`), and sink spawn does too (`:1175`). Current sweep calls capture functions in-process (`:1198`, `:1352`, `:1391`), rather than starting a separate capture CLI. An in-memory variant of the existing stage-lock manifest made its real nested meter process report `migration:"none"`, preload present and the frozen event clock; exits remained `[0,0]`. Future subprocess paths need the same assertion. |
| Tool writes `expected/b2`, then check accepts it | Sound for sole-declarer file contents and undeclared filenames; unsound for multiple declarers (P3-01). Generated goldens are review artifacts, not independent evidence of intended behavior. |
| B1 / `none` rescue oracle | Structurally retained and backed by reference goldens, but currently red (P3-02) and only as complete as its observation boundary (P3-03). Keep B1 defaults (P3-07). `none` alone is **not** the §18.5 rescue release: B4 must pair its reference-shaped writer with an always-mixed reader and prove reading persisted inclusive/writer records after rollback. |

## 2. Previous Task 1 items and exit criteria

This assesses the previous review's §4, not just the narrower task numbering in Plan 3. Some fixes were already present in `v0.2.0-rc.2`; they count toward readiness but are not credited as new changes in this review range.

| Previous §4 item | Status | Evidence and remaining work |
|---|---|---|
| 1. Reproducible baseline | **Partly** | Exact Node 18.19.0/24 × Ubuntu/macOS matrix exists (`.github/workflows/ci.yml:8`); non-root requirements are enforced (`replay/runner.mjs:59`), cleanup restores directory modes (`replay/sandbox.mjs:126`), and unavailable OTel listening now skips promptly. Local complete run finished, but P3-02 fails it; Ubuntu execution has never occurred (`owner-signoff.md:36`). |
| 2. Export and exclusion holes | **Partly** | rc.2 restored TA export behavior and added CLI/submission/compare/anon cases; export is no longer whole-file waived (`ENGINE-B1.md:924`). Schema/citation/duplicate/pin checks and function-waiver budget accounting exist; Plan 3 improves regex weighting. Imported coverage gates are clean. Ten current approved-reachable exclusions still lack owner approval (`owner-signoff.md:3`, `:9`); the old eleventh export wildcard is gone. |
| 3. Safety gates | **Partly** | Engine-only IDs/reasons are pinned, inventory is recursive and duplicate-aware, coverage checks replay exits, missing/extra output comparison remains two-way, every stream is captured. P3-03 prevents claiming complete byte observation; P3-01/P3-04 compromise the new migration gate. V8 range totals are documented as runtime-dependent. |
| 4. Foreign isolation | **Partly** | Incompatible mixed roots reject in either order; compatible roots retain their tests (`tokenomics/scripts/team-report.roots.test.mjs`). JSON string values and configurable delivered prose are tested; nested settings validate at load. Positive TA/null hook control remains. Installer README wording and foreign installer coverage are deferred to B3, and phase/part argument/return validation is scheduled with API 2 rather than completed. |
| 5. Contract/migration map and grain evidence | **Partly** | D1 correctly moves ratio ownership to manifests; D2 decides imported helpers are internal; D3 lists the real provisional API and schedules the freeze; kit grain checks and five fixtures are present. P3-05–P3-09 and unresolved owner questions prevent treating the map as implementation-ready. Engine-generated allocation traces still need to be specified and tested with the actual joins. |
| 6. Register all changes | **Partly** | Eleven unlanded registry entries and meaningful before-cases exist. Empty `declared` objects are appropriate before migrations land; after-fixtures belong with each migration. Exact cumulative enforcement is not delivered (P3-01). Proposed extra items need owner disposition and corrected evidence. The sole existing reference golden modification is a justified capture correction, not wholesale regeneration. |

| Previous §4 exit criterion | Status | Evidence |
|---|---|---|
| Complete baseline test runs, limitations resolved/bounded | **Partly** | This complete macOS/Node 24 run ends with two failures; four OTel skips are now explicit and bounded. Ledger reports Node 18.19 runs, but this review did not execute that version. Ubuntu remains unexecuted. |
| Zero unexplained differences | **Not met** | `diff-impl` differs on one case; migration gate has two failing rows. Cause is explained as host cache output, but the candidate still has no correct portable oracle for it. |
| Zero open/stale/weak/over-budget in-scope coverage | **Met on this runtime** | Imported coverage: 474 measured functions, 13 uncovered, function and branch open/stale/weak/duplicate/over-budget all zero; invalid pins zero; replay problems zero. This is not cross-runtime execution evidence. |
| Independently approved exclusions and engine-only cases | **Partly** | Engine-only list is independently pinned and justified; three current cases are appropriate. Ten reachable exclusions await the owner. A file named `engine-only.json` and a reason do not themselves establish completed owner sign-off. |
| Clean recursive inventory | **Met** | 371 reference sites, 72 engine sites; all unassigned/unlisted/stale/invalid/overcount/undercount counts zero. Lexical inventory remains a backstop, not a semantic proof. |
| Foreign null isolation, including multi-root reporting | **Met for capture/report paths** | Three engine goldens pass; null-extension trace and TA positive control pass; mixed-policy roots explicitly reject. Foreign installer prose remains separately deferred. |
| Reviewed spec-to-migration map | **Partly** | Review completed here, with required corrections. The current map is not approved for direct implementation. |

| Prior finding | Disposition | Evidence / qualification |
|---|---|---|
| P2-06 | **Decided in D1; incomplete** | `MIGRATION-MAP.md:33`; correct ownership, deferred implementation in item 8. Resolve P3-06/P3-07 and receipt/revision binding before closing the design. |
| P2-07 | **Fixed** | Recursive scan plus occurrence counts (`scripts/inventory.mjs`); clean actual gate, planted nested/duplicate tests pass. |
| P2-08 | **Fixed** | `scripts/engine-only.mjs:9`, `corpus/engine-only.json`, migration participation and engine-only golden tests. Editing the approval list still requires review. |
| P2-09 | **Partly fixed; remainder decided/deferred** | Configured delivered-note and JSON value scan fixed. Installer prose remains open for B3 (`owner-signoff.md:57`), not “fixed” without that qualification. |
| P2-10 | **Decided** | D2 and `ENGINE-B1.md:7` explicitly restrict the supported import boundary to CLI/extension/kit; no reference-helper facade is promised. Agree. |
| P2-11 | **Fixed for consumed B1 structures** | `config.mjs:38` validates nested objects/values; extension import failures are named; entry-error tests pass. Scope hooks retain exit 0 intentionally, while emitting the named load error. |
| P2-12 | **Open, partly fixed** | Added streams and path observation are useful, but P3-03 leaves in-boundary content differences invisible. Known external-path/.git/metadata exclusions also await a truthful owner-approved scope statement. |

## 3. Ledger rulings, individually

Every literal `Ruling:` in `docs/plans/plan-3-ledger.md` is covered below. These are review opinions, not owner approval.

| Ledger line | Verdict |
|---|---|
| 35 — blocking stdio / one corrected golden | **Agree with the action.** Verified old 65,536 bytes are a strict prefix of new 67,931 bytes; correct the unsupported claim that Linux necessarily emits everything without the fix. |
| 54 — nonvacuous changes.txt determinism case / normalized exclusions | **Agree.** `cov-capture-sync` exercises a real path-change observation; this does not cure fingerprint loss (P3-03). |
| 55 — leave binding spec unchanged, send scope to owner | **Agree to preserve owner authority; disagree that the limitation is fully characterized.** The owner sheet must also disclose discarded content and transient writes, or the harness must cover them. |
| 61 — scope-hook load errors only | **Agree.** It names the new settings/extension failure without changing the reference's swallowed runtime-error behavior. |
| 87 — map corrections override Task 10 scenarios | **Agree.** The actual anon submission, two false ID matches, stronger fold/shared anchors and nine synthetic cases are better evidence than the superseded scenarios. |
| 99 — sorted readdir oracle / R13 premise | **Agree with the deterministic guard; disagree with the claimed macOS/Linux defect evidence.** Reverse that premise before Plan 4; the later parked correction recognizes it. |
| 103 — park/restate R13 and re-ask Q1 | **Agree with the required correction and Task 1 ownership.** Do it before owner approval/planning, and avoid asserting Windows behavior beyond the evidence; use an unsorted stub. |
| 104 — async-frame normalization in Task 1 | **Agree.** Reproduced; add the test before producing another diagnostic golden. |
| 105 — writeB2 exit validation in Task 1 | **Agree.** Full check fails closed, so a bounded deferral is acceptable; fix recording before using it for migrations. |
| 106 — move unpublished local tag to include fixes | **Agree for the stated unpublished candidate.** The requested tag resolves to `ab146c1` here; no tag was changed by this review. |

The two rationales to reverse are the original R13 platform-order claim and any claim that the documented narrow observation scope already guarantees byte equality within that scope. The three explicitly parked implementation/documentation items remain necessary; they are not a sufficient Task 1 by themselves.

## 4. Observation boundary and portability

The blocking-stdio correction is legitimate. The affected file is `corpus/cases/cov-team-report-batches/expected/49577c7/__events__/3.stdout`; comparing both tags confirms exactly 2,395 appended bytes and no changed prefix. Making both reference and engine flush their observable streams avoids treating a capture truncation as intended reference behavior. `_handle.setBlocking` is an internal API, so its large-output test and the exact runtime matrix are important guards.

The Linux rationale should be corrected: Node 18.19 documents pipes/sockets as asynchronous on POSIX, with output loss possible when `process.exit()` precedes completion. Linux success on a particular run is not a guarantee. [Node 18.19 process I/O documentation](https://nodejs.org/download/release/v18.19.0/docs/api/process.html#process_a_note_on_process_i_o).

The directory wrappers cover the sync, callback and promise forms used by the reference. Their explicit comparator avoids locale-sensitive sorting; `opendir`, Buffer names and raw OS enumeration are not covered. The ledger's own follow-up says POSIX libuv already sorts the relevant listings and records no changed golden. Keep the guard, but do not cite a macOS-order golden as proof of an Ubuntu defect. A production sorting fix needs evidence outside the pre-sorted oracle. I did not run Ubuntu or independently retrieve the pinned libuv source successfully during this review.

Diagnostics normalization now preserves ordinary `at ...` prose and stdout frame-like text, collapses recognized stderr frame runs, and drops the Node-version trailer. The async-frame hole is reproduced. Warning lines and uncaught source excerpts are deliberately discarded; therefore “all streams” means captured, normalized streams, not all original bytes. In particular, a newly emitted Node warning can be hidden. Normalization tests should pin exactly which diagnostic classes are intentionally non-semantic.

The sandbox observer checks final filesystem state. Its `.git`, explicit `untracked`, outside-sandbox and metadata exclusions are intentional, but content fingerprint loss is an additional limitation, and P3-02 demonstrates continuing host dependence. No current case needs an `untracked` entry according to the candidate docs; that assertion is false on this installation. A precise exclusion for a proven infrastructure artifact is different from weakening observation of arbitrary engine output.

Goldens therefore cannot yet be certified portable to Ubuntu/Node 18.19 merely from this macOS run. The matrix is correctly configured; the ledger's reported Node 18.19 execution supports compatibility, but the actual Ubuntu evidence is absent. Bounded OTel skips are an improvement, not proof of receiver behavior in this restricted environment.

## 5. Migration-map assessment

### Decisions D1–D7

| Decision | Assessment |
|---|---|
| D1 — manifest-bound ratio | **Sound direction, incomplete contract.** Corrects P2-06. Resolve stable legacy binding, missing revision archives, manifest-bound delivered-outcome/receipt reading policy and preservation of B1 defaults (P3-06/P3-07). The current single-revision before-case proves ownership changes, not historical stability. |
| D2 — public import boundary | **Agree.** CLI/extension/kit is a defensible supported boundary; exported engine helpers remain internal. B5 must audit real external callers before assuming none need a facade. |
| D3 — API 2 freeze last | **Agree with timing and synchronous returns.** Today's table is a useful inventory. Freeze actual per-part input/ctx/return contracts, with argument/return assertions and Promise rejection; tracing only `name:phase` or checking broad union types is insufficient. |
| D4 — writer and manifestRevision together | **Agree for captures.** Both are required for port lines. Add the restamp exception (P3-08). Q14c's report provenance deferral needs explicit milestone ownership; §14.4 already says reports record their revision. |
| D5 — grain evidence | **Agree, strengthen execution evidence.** Kit rules now cover the required dispatch constraints and retain legacy missing-grain semantics. Require traces returned by the real engine join over the full allocation cohort, including rollups/residual reasons. Merely adding a hand-authored `trace.json` that “mirrors” a before-case proves the checker, not the engine (`conservation.test.mjs:48`). |
| D6 — switches | **Agree with the corrected conclusion: no listed measurement-off combination is currently contract-valid with production provenance.** Change misleading “yes (per ruling)” cells to distinguish harness selection from effective production allowance. B3/B4 must prevent the harness environment variable from bypassing production validation. `none` remains a test/rescue-writer mode. |
| D7 — receipt command outside B2 | **Reasonable B2 scope decision.** File receipts can exercise B2 ordering/windows. Assign engine command-receipt integration to a concrete later task before porting/enforcement depends on it; the existing kit command reader does not make the engine use the abstraction automatically. |

### Eleven migrations and their before-cases

All eleven have at least one meaningful before-case. That is materially better than mere existence checks. Their after-diffs still require owner decisions, implementation, recording and independent review; the map currently gives shapes, not complete exact expectations.

| Item / id | Before-evidence assessment | Precision needed for implementation and declared diff |
|---|---|---|
| 1 `exact-ids` | **Meaningful.** `before-ids-substring/assert.json:9` pins two false dispatch matches (substring and case mismatch); map correctly predicts 2→0, not 1→0. | Resolve Q4 boundaries for punctuation, hyphens and Unicode; keep structured IDs verbatim and case-sensitive. Include branch/group-key matching, not just one label helper. |
| 2 `shared-allocation` | **Meaningful.** `seed-receipts-shared-id` plus `before-dispatch-two-groups/assert.json:24` demonstrate one dispatch's 410 tokens counted into two groups, including different IDs in the two receipts. | Resolve `1/k`, define the entire cohort and rollup exclusion, preserve measured grain, and test all groups together with engine-generated traces. Q5's `sources.sharedDispatches` is a real output-shape decision. |
| 3 `copilot-inclusive` | **Meaningful.** `seed-copilot-cli` and `cov-copilot-dispatch` pin netted session tokens and invented dispatch input categories; capture and report changes will be visible. | Resolve Q6 informative dispatch-total storage and cost representation. Reader behavior must follow a persisted line's `tokensBasis` independently of the current capture switch; add mixed-era/rollback reading evidence. |
| 4 `null-unobservable` | **Meaningful.** Existing no-usage cases plus `before-vscode-no-usage/assert.json:5` distinguish absent usage from priced credits and actual zero. | Resolve host-specific counters using source evidence. Unknown counts are required, not an optional Q8d enhancement. Define downstream rendering and interaction with inclusive attribution. |
| 5 `anon-complete` | **Meaningful after correction.** `before-export-anon-batch/assert.json:4` exposes the path slug in the anonymized submission. `--batch --anon` alone would not. | Resolve Q9 and P3-09; enforce the guarantee across all supplied identifiers/output strings, including extension fields. Preserve the project's non-anonymized accumulated record. |
| 6 `fold-flags` | **Meaningful.** `cov-capture-pricing` adds strong missing-usage/partial-flag evidence. `seed-claude-folded` is weak but predicts a nonempty `tokensByModel:{}` addition; it does not demonstrate flag repair alone. | Add a folded dispatch with actual per-model quads to test model union; existing before-cases lack that input (`map:628`). Check complete/partial/none across null and inclusive interactions. |
| 7 `active-minutes` | **Meaningful.** `cov-dispatch-batch` exposes the lead/dispatch partition and downstream direct/stage/loaded values. | Resolve Q7 output nulls/allocations, preserve unknown session minutes, handle parent/dispatch role collisions, and correct the dollars-versus-minutes contract attribution (P3-05). |
| 8 `report-windows` | **Meaningful.** New window and manifest cases cover stale deliveries, undated outcomes, conflicting receipt revision/mtime, spanning sessions and a different ratio intent. | Resolve field names, date-only bounds, reference-only mtime fallback and immutable revision policy. Add exact boundary, partial-priced, measured-zero and archived-manifest assertions. The REO-1 row alone does not change under the proposed target; other rows make the case meaningful. |
| 9 `scope-resolution` | **Meaningful.** Host collision/precedence/role and handle cases demonstrate actual reference failures; `before-scope-handle` correctly models orphan recreation after claim. | Specify host inference/absence, single-owner claim recovery and displaced-record merging. Add concurrency/crash tests. Positive restamp may follow writer, but must cover older provenance and conflict winners. |
| 10 `reports-location` | **Meaningful, engine-only.** `foreign-settings` currently writes cost/reports under the receipt tree and does **not** explicitly set `reports.location:tree`. The proposed present-file telemetry default will move them. | Resolve Q13 path/default and what each close-time artifact includes. Assert both new destinations and absence of new main-tree writes; retain read-only receipt access and TA's configured tree behavior. |
| 11 `writer` | **Meaningful.** `seed-claude-basic` and other capturing cases lack both provenance fields. | Resolve version source/replay policy, restamp exception and report provenance. Run port conformance on the **combined** after-ledger; writer-only isolation intentionally lacks measurement migrations. Historical pre-seeded records remain unchanged. |

### Landing order and interactions

The proposed order is generally sensible: exact matching/privacy first; fold/null/inclusive measurement changes before allocation; reports after accounting; writer after the original measurement migrations. Keeping the positive restamp test with writer is reasonable.

It is not a substitute for interaction declarations. Fold/null/inclusive touch the same ledger, several allocation/report migrations touch the same `cost.json`/rendered files, and writer adds provenance to those capture shapes. P3-01 is therefore a routine Plan 4 risk, not an exotic synthetic corner. Define cumulative expected bytes and exit vectors for those overlaps before recording them.

Extra entry-guard work can enable previously nonexistent captures after writer, as described in Repro A. Stdout-drain and stable-enumeration are masked by deliberate replay normalizations. Decide how their non-corpus evidence meets the declared-diff discipline rather than pretending each will produce a nonempty standard corpus diff. If normative conflict/by-role/unknown-count work becomes additional migrations, place it before final B2 conformance/API freeze and update the map/registry/landing order together.

### Proposed items 12–21

| Proposed item | Assessment |
|---|---|
| 12 `entry-guard` | Real defect; symlink before-case now exists. Owner must distinguish diagnostic symlink replay from the production symlink-install prohibition before B5 (§18.6). Account for its writer/capture interaction. |
| 13 `stdout-drain` | Real production robustness issue, deliberately masked by blocking replay. Use a large-output subprocess without the preload; correct the Linux claim. |
| 14 `stable-enumeration` | Reframe and re-ask Q1. Current claimed platform evidence is withdrawn and the oracle masks the change. Use unsorted stub evidence; do not fabricate a corpus diff. |
| 15 `dispatch-dir` | Concrete directory-as-transcript failure; retain its fault case and declare whether remaining dispatches continue. |
| 16 `vscode-oplog-holes` | Concrete dropped-session case. Specify skipped holes versus malformed entries and resulting attribution completeness. |
| 17 `vscode-end-guard` | Concrete repeated timestamp-less append. Specify changed-payload/force behavior so the fix does not suppress legitimate refresh. |
| 18 `empty-repo-sizing` | Concrete empty-string path behavior. Decide root resolution/validation and pin the resulting diagnostic and sizing output. |
| 19 `zero-session-share` | Concrete `NaN%` render defect. Define empty/unknown presentation consistently across JSON/Markdown/HTML. |
| 20 `submission-identity` | Concrete preserved P2-02 reference defect. Scope is broader than the name: R18 also mentions overflow `$null`; split or explicitly include both. |
| 21 `live-host` | Concrete provisional Copilot line mislabeling. Pin host choice from evidence and downstream host totals, not just one HTML label. |

R10 kit ENOTDIR is appropriately separate maintenance. R20 conflicts and the unowned by-role-dollar/unknown-count obligations cannot be treated as optional robustness improvements while claiming the binding reader contract. Grouping extras is an owner/spec amendment to the “each lands alone” list, not merely a way to reduce task count.

### Owner questions Q1–Q16

| Question | Review view |
|---|---|
| Q1 | Appropriate approval request for extending/regrouping §14.8. Correct item 14 first; distinguish mandatory contract work from optional robustness, and document the normalized-oracle exceptions for 13/14. |
| Q2 | Agree with kit maintenance outside engine migration ownership; fix and test the finding rather than a throw. |
| Q3 | Under the present spec the effective off-set is `{}`. A broader answer requires an explicit spec exemption, not just a settings choice. |
| Q4 | Legitimate matching-policy detail for free text. The exact/case-sensitive structured-ID requirement is already decided by the spec. |
| Q5 | Legitimate allocation-policy/output decision. Include rollup exclusion, cohort definition and residual accounting in the answer. |
| Q6 | Legitimate wire/output-shape question. Do not place an untyped informative total into a measured token category. |
| Q7 | Legitimate minutes presentation decision; correct its normative citation and separately own inclusive by-role dollars. |
| Q8 | Host observability needs evidence. Part (d) is not an ordinary choice: unknown counts are required by §3.2.1. Preserve the registry's actual elapsed-time definition rather than inferring it from generic null rules. |
| Q9 | Legitimate privacy scope decision. Once the set is fixed, absence across the complete intended output is testable and mandatory. |
| Q10 | Names/date-only inputs/report scope need decisions. Mtime-as-revision is already restricted to reference mode by §5.2; define how a mixed-era file receipt is classified. |
| Q11 | Reject mutable-current fallback as the default historical policy; settle P3-06 with immutable legacy binding and missing-archive behavior. |
| Q12 | Appropriate mechanics/output decisions. Specify host-less `open --session auto`, ambiguity and interrupted/concurrent claim behavior before implementation. |
| Q13 | Path/default choices are appropriate. Moving `cost.json` is consistent with required close-time relocation; leaving it behind needs a substantive reason, not just a filename preference. |
| Q14 | Version source and replay pinning are engineering decisions that can be proposed concretely. Prefer a controlled test version over erasing writer assertions. Part (c) is an explicit milestone deferral of required report provenance and needs ownership/approval. |
| Q15 | Agree with positive restamp coverage at writer; rejection tests belong in scope-resolution. Use an older-version writer to expose P3-08. |
| Q16 | Reframe as a reader-contract gap needing an implementation owner or explicit spec amendment. Keeping first-wins conflicts is not conformant merely because the kit has a different reader. |

None of these answers has been supplied by this review on the owner's behalf. `owner-signoff.md:40` explicitly requires the map questions answered before Plan 4 is written. Questions such as exact field names can be resolved by an authorized concrete design; requirements already fixed by the spec should not be offered as freely waivable implementation preferences.

## 6. Recommended Plan 4 Task 1

**Repair and verify the B2 gate, then freeze the implementable migration contracts.** Complete this before the first behavioral migration or new after-golden.

1. **Restore the portable B1 baseline.** Resolve P3-02 while preserving the cleanup fault evidence. Run the complete tests, differential, inventory, imported/CLI coverage as authorized, and migration gate on the actual candidate. Obtain Ubuntu × Node 18.19/24 evidence through an authorized runner; do not equate a CI YAML matrix with execution. Keep restricted-environment OTel skips explicit.
2. **Make cumulative expectations exact.** Fix P3-01 and P3-04. Define exact composition plus separately reviewed interactions, including overlapping files, additions/removals, cancellation, per-event exits and a migration newly enabling another's output. Add adversarial tests for all those paths, a genuine unset default, always-on/always-off implementations, later-added cases and engine-only participation. Ensure `writeB2` cannot create new authority by observing the implementation under test.
3. **Finish the observation contract.** Fix P3-03; preserve stable content evidence for non-selected paths, handle Git metadata deliberately, and document final-state versus transient observation and normalization exclusions. Include a case where both implementations create the same path with different bytes. Ask the owner about any remaining intentional departure from §18.2 only after presenting the concrete boundary.
4. **Complete all three parked items.** Correct R13/item 14 and Q1; add the anonymous async-frame regression/fix; enforce the declared exit vector during B2 recording. Include the related inaccurate Linux-stdio prose correction. These remain small, independent changes within the gate-repair task.
5. **Freeze the map's contract decisions.** Assign unknown counts, reader conflicts and inclusive by-role dollars; define immutable legacy/archived-manifest binding and B1 defaults; distinguish capture/restamp provenance; resolve report provenance and complete anonymization. Record owners and acceptance tests for every required outcome, including the command-receipt integration deferred beyond B2.
6. **Close evidence/approval dependencies.** Obtain the owner's disposition of the ten reachable exclusions and the Q1–Q16 decisions that affect scope. Design engine-generated allocation traces for items 2/3/7. Add planned acceptance evidence for historical manifests, cross-row anonymization, older-writer restamp, conflict-order independence and mixed-era readers. Rewrite the landing order/registry if additional contract migrations are approved.

Task 1 exit: no unexplained/undeclared differences; full supported-environment gates green or a precisely bounded, accepted environment limitation; cumulative false-pass tests fail for the bad implementations; unset default equals explicit-all; `none` remains reference-equivalent; every map target is either binding, explicitly decided, or assigned to an approved later milestone. After-fixtures for the eleven migrations should still land with each migration, not be fabricated during baseline repair.

## 7. Checks performed and limitations

Environment: macOS (`darwin`), Node `v24.14.1` at `/usr/local/bin/node`, UID 501, `/usr/bin/git` available through PATH, restricted filesystem/network environment. Both requested tags and HEAD resolved to the stated commits. The working tree was initially clean.

| Check | Observed result |
|---|---|
| `npm test` | **Completed, exit 1:** 581 tests; 575 pass, 2 fail, 4 skipped, 0 cancelled. Both failures are the stage-locked extra observation: B1 differential and reference golden. |
| `node scripts/diff-impl.mjs` | **Exit 1:** `cases 65, differing 1`; stage-locked extra `__sandbox__/changes.txt`. |
| `node scripts/migrations.mjs check` | **Exit 1:** `modes 2, cases 68, problems 2`; same case in `none` and `default`. Eleven migrations are all unlanded, so no real isolation modes run yet. |
| `node scripts/inventory.mjs` | **Exit 0:** 371 reference sites, 72 engine sites; all problem counts zero. |
| Imported coverage functions | **Clean current-runtime gates:** 474 functions, 13 uncovered; zero function open/stale/weak/duplicate, zero invalid whole-file pins, zero branch open/stale/weak/duplicate/over-budget, zero replay-exit problems. Did not run the report-writing coverage CLI. |
| Sequential stage-locked replay | Reference and engine, twice each: reproduced `xcrun_db`, exits `[0,0]`, no other differences. |
| `node --test tokenomics/hooks/otel-sink.test.mjs` | Four tests skipped promptly with `local listen unavailable (EPERM)`; no hang. Confirms the four full-suite skips, not service correctness. |
| In-memory cumulative checker/recorder | Reproduced all three P3-01 false passes through registry validation, recording and full mode loop. No repository fixtures changed. |
| Committed fake implementation with explicit/unset env | Reproduced P3-04 using real replay processes. |
| Nested meter environment probe | In-memory manifest variant, normal temporary replay sandbox: nested Node child received `none`, preload and frozen clock. |
| Pure observation/report probes | Reproduced fingerprint loss, async-frame leak, conflict order dependence, unknown→zero totals and parent-exclusive by-role dollars. |
| Blocking-stdio golden comparison | Verified 65,536→67,931 bytes, old bytes strict prefix of new. |

Read the binding sections, previous review, Plan 3 constraints/review focus/tasks and complete ledger, owner sheet, engine record, migration map/registry, new before-case assertions, replay/gate code and relevant reference implementations. Independent read-only standards/observation and spec/map reviews supplemented the primary review. The standards review's substantive finding was lost observation content; the spec review's principal findings were unowned reader requirements and mutable legacy binding. No stylistic smell was promoted to a blocking finding.

I did not run Ubuntu, Windows or Node 18.19, activate an installer, perform B4 rollback/shadow work, or claim real migration output correctness before migrations exist. The ledger's earlier 581/581 report is historical evidence, not this run's result. The cumulative harness reproduction substitutes a deterministic replay function, so it proves checker logic rather than a landed engine defect; the baseline and environment-propagation reproductions use actual child processes. Windows directory-order specifics were not independently established here. External documentation was used only to verify Node's POSIX pipe semantics; fetching pinned libuv source failed.

No private raw-corpus directory was read or copied. `reference/` remained read-only. No source, fixture, golden, plan, ledger, coverage report, branch, tag, remote or commit was changed. Authorized tests/replays used their ordinary temporary runtime sandboxes; additional checker fixtures were in memory. The only repository artifact created by this review is `docs/reviews/plan-3-codex-review.md`.
