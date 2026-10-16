Not approvable

# Plan 3 patch independent re-review — v0.2.1-rc.2

Reviewed `v0.2.1-rc.1` (`ab146c128b2d91e696b11804553c6b7b89ccd9b5`) → `v0.2.1-rc.2` / HEAD (`952ebe57aec91199f5ca5eca8897132acaa4234d`) on `main`, 2026-10-11. Line citations below refer to this HEAD. This verdict concerns using the candidate as the accepted foundation for Plan 4. A bounded corrective Task 1 can proceed; behavioral migrations should wait for its exit conditions.

The patch fixes the original cumulative-oracle reproduction, restores the local baseline, exercises the actual unset default, and substantially repairs the map. Nevertheless, an accepted filename can still defeat the central checker: prototype-inherited object keys let undeclared files pass and silently discard declared `__proto__` contents. A separate, reproducible serialization collision makes two different sandbox filesystem states indistinguishable. Neither is exercised by today's corpus. Passing the current suite therefore does not establish the advertised exactness.

## 1. Findings

Severity is relative to accepting this gate for migration work: **Blocker** means the checker can certify undeclared output; **Major** means a material observation failure; **Minor** means a bounded recorder, documentation, or planning correction. Some underlying predicates predate this patch; the review distinguishes that from newly introduced code.

| ID | Severity | Area | File:line | Finding | Evidence | Fix |
|---|---|---|---|---|---|---|
| P3P-01 | Blocker | Exact declared composition | `scripts/migrations.mjs:54`, `:55`, `:99`, `:178`, `:218`, `:230`, `:233`; `replay/collect.mjs:5`, `:10` | File dictionaries use ordinary objects and membership uses `in`. Accepted root filenames such as `toString` inherit membership; assignment to `__proto__` discards string contents. A declared `__proto__` after-file can have arbitrary actual contents while every mode passes. A nonexistent `toString` removal is also accepted as a nonempty migration. | New reproduction E below. Full unchanged `checkMigrations`, with in-memory filesystem/replay dependencies, returned no registry or mode problems for declared `__proto__ = DECLARED`, actual `__proto__ = WRONG`. Direct exported-function probes reproduce the loss. The real collector also drops that filename, and the runner excludes the declared output from its supplemental observation. | Use `Map` or safe dictionaries consistently, with own-property membership throughout collection, golden loading, expectation construction, comparison and recording. Cover `__proto__`, `constructor`, `toString`, extra files, missing files and vacuous removals through the full gate. Rejecting only `__proto__` is insufficient. |
| P3P-02 | Major | Sandbox observation | `replay/observe.mjs:66`, `:87`, `:91`; `replay/runner.mjs:114` | Paths and symlink targets are interpolated into newline-delimited records without escaping. One valid symlink target containing a newline can impersonate an additional filesystem entry. Digests did not make this representation unambiguous. | New reproduction F: one link with target `x\nA repo/rogue l:y` and two links with targets `x` / `y` serialize identically. No hash collision is involved. | Serialize escaped, unambiguous records, such as JSON tuples; scrub the individual fields before serialization. Add path/target newline and delimiter cases. Regenerate only affected observations through authorized tooling. |
| P3P-03 | Minor | Interaction recorder validation | `scripts/migrations.mjs:413`, `:422`; `corpus/migrations/_interactions/README.md:42` | `writeInteraction` exempts conflicted keys from its missing-owner rejection. It can erase/replace the interaction after-files and record a conflict while omitting a conflicting owner, contrary to the documented refusal. The subsequent checker rejects it, so this is **not** a second cumulative-check false pass. | New reproduction G: A/B own the same path; the interaction names A/C. Recording succeeds; default/all then report `interaction overrides out/a.txt owned by b without naming it`. | Validate all owners, including conflicted keys, and validate the completed candidate interaction before any filesystem mutation. Add a refusal/no-write regression. |
| P3P-04 | Minor | Git observation claims | `replay/observe.mjs:19`, `:32`, `:38`; `corpus/CASES.md:170`; `README.md:28`; `tokenomics/ENGINE-B1.md:1107` | The summary is conditionally deterministic, not generally host-independent after sandbox normalization. It hashes raw committed blob IDs, so equivalent scrubbed content containing different sandbox paths still differs. Detached HEAD contributes only `detached`, so its otherwise-unreferenced tree is invisible. The blanket claim that commit IDs are never included also needs a gitlink exception if submodules are supported. | The raw-blob caveat was already parked at `docs/plans/plan-3-ledger.md:144`. `git hash-object --stdin` gives different IDs for `/tmp/replay-A/repo/file\n` and `/tmp/replay-B/repo/file\n`; `ls-tree` IDs enter the digest without the runner's scrub. Detached-HEAD behavior follows directly from the summary code. Current `cov-capture-sync` was stable twice locally. | State the precise preconditions and exclusions, including raw committed content, detached HEAD, object format, and Git availability. Decide whether future fixtures must avoid volatile committed bytes or whether committed content must be normalized. Narrow the commit-ID claim; obtain Linux/Git evidence before claiming matrix portability. |
| P3P-05 | Minor | Proposal versus requirement | `docs/b2/MIGRATION-MAP.md:907`, `:940`; compare `:85`, `:325`, `:1375` | The missing-archive → unverified/excluded policy is still unconditional in the implementation and acceptance instructions although it is correctly labeled a proposal elsewhere. This is the ledger's acknowledged residue, not a renewed mutable-history defect. | `docs/plans/plan-3-ledger.md:179`; Q11b still offers the same-revision current-manifest alternative. | Carry the proposal/Q11b qualification into both passages, then replace it with the owner's decision when freezing the contract. |
| P3P-06 | Minor | Normalized-only migration acceptance | `docs/b2/MIGRATION-MAP.md:1251`, `:1332`; `scripts/migrations.mjs:129`, `:131` | The map says items 13/14 have no corpus diff and need `beforeCasesWaived`, but waiving every before-case does not satisfy the harness's separate requirement that a landed migration declare at least one case. The proposed registry route cannot land those optional migrations as described. | Direct `registryProblems` call with a landed `stdout-drain`, one valid waived before-case, and `declared: {}` returns `stdout-drain: landed but declares no case`. `write` also refuses no-difference cases (`:361`). | Before approving these optional items, define a narrowly reviewed non-corpus evidence mechanism or an explicit grouping/spec amendment. Do not manufacture a vacuous corpus diff or globally remove the landed-evidence requirement. |

### Re-runs of the previous review's Reproductions A–D

**A — undeclared cumulative bytes, cancellation, removal: fixed for ordinary path keys.** `b2Problems` and `writeB2` no longer exist; I reran the equivalent attack against the replacement composer and full checker. The original module and its registry/exit helpers were evaluated with `vm.SourceTextModule`, substituting filesystem operations with an in-memory map and replay with deterministic results. A declares `out/a.txt = A`; B declares `out/b.txt = B`; baseline contains `out/a.txt = base`; exits are `[0]`. Registry reasons, item numbers and before-cases are valid.

| Combined output | `none`, `only:a`, `only:b` | `default` and `all` |
|---|---|---|
| `a = UNDECLARED`, `b = B` | No problems | `differs out/a.txt` |
| `a = base`, `b = B` | No problems | `differs out/a.txt` |
| Only `b = B` | No problems | `missing out/a.txt` |

The corresponding real fake-implementation tests also passed in the full suite (`scripts/migrations.test.mjs:231`, `:239`, `:246`). No implementation-generated cumulative golden can now override these expectations. P3P-01 is a distinct surviving path-dictionary flaw, not a recurrence of the old two-declarer branch.

**B — stage-locked host cache: fixed locally.** Reran `fault-capture-stage-locked` sequentially twice against `reference/49577c7` and twice against `tokenomics`, with `TOKENOMICS_MIGRATIONS=none`. Every run returned exits `[0,0]`, no `__sandbox__/changes.txt`, and `compareFiles(...) = []`. The exclusion names exactly `repo/stage-tmp/xcrun_db` (`corpus/cases/fault-capture-stage-locked/replay.json:47`). The passing sibling-write test proves `stage-tmp/other.txt` remains observed (`replay/runner.test.mjs:336`). No stage-directory-wide exemption was introduced.

**C — fingerprint loss and anonymous async frames: original examples fixed.** Running the former probe now gives:

```text
['A repo/extra.txt f:aaa']
['A repo/extra.txt f:bbb']
"Error: boom\n    at <frame>\n"
```

Added/modified/deleted fingerprints and symlink targets are retained (`replay/observe.mjs:83`); anonymous async frames normalize (`:97`). The complete observation guarantee remains partial for P3P-02 and the documented boundaries below.

**D — explicit selection versus unset default: bad implementation still differs, and is now rejected.** Real replay of the committed `scripts/fixtures/migrations/impl` with `demo` returned `out/a.txt = demo\n`, `out/b.txt = added\n`, exits `[0]`; unset returned only `out/a.txt = base\n`, exits `[0]`. The passing regression at `scripts/migrations.test.mjs:56` asserts that `all` passes while the genuine default reports `missing out/b.txt` and `differs out/a.txt`. The checker sets `null` for default (`scripts/migrations.mjs:324`), and the runner deletes null environment values (`replay/runner.mjs:92`).

### New reproduction E — legal filenames defeat exactness

This minimal reproduction uses only direct imports and writes no files:

```sh
node --input-type=module <<'NODE'
import {compareFiles, expectedFor, composeExpected} from './scripts/migrations.mjs';
console.log(compareFiles({}, {toString: 'UNDECLARED'}, [0], [0]));
console.log(expectedFor({}, {changed: ['__proto__']}, () => 'DECLARED', 'c'));
console.log(composeExpected(
  {files: {'out/a.txt': 'base'}, exits: [0]},
  [{id: 'a', d: {removed: ['toString']}}], null, 'c').problems);
NODE
```

Actual output: `[]`, `{}`, `[]`. The extra file is missed; the declared content disappears; removal of a nonexistent file is accepted. These names satisfy `isPathList` (`scripts/migrations.mjs:99`); they are not reserved by the contract.

I also ran the unchanged full checker with an in-memory valid registry: migration A is landed, declares case C, and changes `__proto__`; its after-file contains `DECLARED`. Baseline is `{'out/a.txt':'base'}`. Replay returns the baseline under `none`, and an own-property `__proto__: 'WRONG'` plus the baseline under A/default/all. **Every result has `problems: []`; no registry problem is emitted.** A second run with ordinary disjoint A/B declarations and an extra own `toString` file in every replay likewise passes all five modes.

This is not dependent on an impossible replay object: `replay/collect.mjs:10` assigns root filenames into `{}`, so a real selected `__proto__` file is itself lost during collection. `replay/runner.mjs:75` skips selected outputs from supplemental observation. The comparator/collector predicates are inherited code; the new composer repeats the unsafe construction. No current corpus filename is claimed to exercise this bypass.

### New reproduction F — two filesystem states, one observation

```sh
node --input-type=module <<'NODE'
import {treeChanges} from './replay/observe.mjs';
const one = treeChanges(new Map(), new Map([
  ['repo/link', 'l:x\nA repo/rogue l:y'],
]));
const two = treeChanges(new Map(), new Map([
  ['repo/link', 'l:x'], ['repo/rogue', 'l:y'],
]));
console.log(one.join('\n') === two.join('\n'));
console.log(one.join('\n'));
NODE
```

Output is `true`, followed by:

```text
A repo/link l:x
A repo/rogue l:y
```

Both describe valid POSIX link states, including dangling links. The runner joins these records with exactly this delimiter. Neither state contains a volatile scrub root. A golden for one state cannot distinguish the other, even though the link target and number of paths differ. This was a pure observation probe, not a claim about a landed migration or existing corpus fixture.

### New reproduction G — recorder skips conflict-owner validation

In the same in-memory checker/recorder harness, A changes `out/a.txt` to `A`, B changes it to `B`, and C adds `out/c.txt = C`. The interaction header names `['a','c']`, has a valid reason, and initially lists no paths. Default replay returns `out/a.txt = AB`, `out/c.txt = C`.

`writeInteraction` succeeds and records `changed: ['out/a.txt']` and its bytes. It leaves `migrations: ['a','c']`. Both default/all composition checks then reject it with:

```text
c: interaction overrides out/a.txt owned by b without naming it
```

The cause is the explicit `!conflicted.has(k)` filter at `scripts/migrations.mjs:413`. Conflicts may be recorded without a hand-listed path, but that should not waive owner validation. The completed declaration must still be independently reviewed; the recorder currently fails its promised no-write refusal.

### Cumulative-design attack results

| Attack | Result and boundary |
|---|---|
| Disjoint contents, additions, removal, cancellation | Exact comparison for ordinary keys; original A variants rejected. Composition starts from baseline and carries each after-file/removal (`scripts/migrations.mjs:217`). Prototype keys are P3P-01. |
| Overlapping file declarations, even identical after-bytes | Conflict until an interaction covers the path (`:223`, `:281`). The interaction can explicitly choose one owner's bytes, remove the path, or restore baseline; those are declared outcomes, not silent cancellation. Tests at `scripts/migrations.test.mjs:297`, `:305`, `:467` passed. |
| Per-event exits | Disjoint changes compose per index; different non-baseline values conflict; equal non-baseline values retain every owner without a conflict. Length and no-op checks exist. Whole interaction exit vectors pin all events; an overridden exit requires its owners (`scripts/migrations.mjs:236`, `:267`). Two-event and 2/5/2 owner tests passed (`scripts/migrations.test.mjs:356`, `:550`). |
| Wrong/missing migration names | Unknown/unlanded/duplicate names fail registry validation; at least one named migration must declare the case (`scripts/migrations.mjs:150`). Overriding any owned key without naming its owner fails composition (`:252`). Recorder defect remains P3P-03. |
| Extra known, landed names | Accepted. The gate checks declared bytes under its four mode classes; it cannot prove that every listed migration causally contributes. No subset mode demonstrates an A/B interaction independently of another landed C. This is a stated scope limit, not evidence that undeclared bytes pass in default/all. |
| Interaction on an unowned path | Allowed intentionally, supporting entry-guard + writer. After-files still pin exact bytes. Recording an unlisted nonconflicted difference is refused; listing the intended key first permits recording (`:415`; passing tests `scripts/migrations.test.mjs:434`, `:449`). The reason and bytes need review; the tool cannot establish semantic intent. |
| `write-interaction` authority | The former automatic discovery of arbitrary unowned differences is fixed. It records conflicted or hand-listed keys, with P3P-03's remaining invalid-owner exception. A listed no-difference key is silently dropped, as parked at ledger `:180`. It may record an explicitly listed cancellation/removal; reviewers must inspect the resulting declaration. |
| `exit:<n>` path keys | Literal integer-index keys are rejected by registry validation (`scripts/migrations.mjs:99`; passing test `scripts/migrations.test.mjs:541`). This closes the reproduced exit-namespace collision. It does not address prototype names. |
| Engine-only cases | Use `expected/engine` after approval validation (`scripts/migrations.mjs:190`, `:298`). The positive and engine-baseline-vacuity tests at `scripts/migrations.test.mjs:392` passed. |
| Later-added cases | `checkMigrations` enumerates all case directories each time (`scripts/migrations.mjs:302`). An independent in-memory later-case probe rejected undeclared changes in both isolation modes, default and all. A later owner of an already-overridden path must be added to the interaction; the passing regression at `scripts/migrations.test.mjs:490` covers that. |
| Unset default versus explicit all | Distinct executions against the same composed expectation; Repro D proves the distinction is enforced. With nothing landed, only none/default run; the current 68-case gate therefore does not itself exercise real cumulative migrations. |
| `check --only` | Intentionally runs only that migration's isolation mode (`scripts/migrations.mjs:304`). Its success must not substitute for the full landing gate. |

### Observation and portability assessment

Ordinary extra files now have sorted final-state records containing 64-bit truncated SHA-256 fingerprints. Valid UTF-8 is scrubbed before hashing, invalid UTF-8 is hashed raw, and a leading BOM is preserved (`replay/runner.mjs:78`). Link targets are scrubbed when the final observation text is scrubbed. Repeated current-corpus observations are stable on the tested host. P3P-02 concerns unescaped serialization, not the intentional use of a digest.

The Git plumbing summary is a substantial improvement over hashing Git's top-level implementation files: loose/packed refs are enumerated, each ref has a reachable commit count and tip tree, lines are sorted, inherited `GIT_*` and system/global configuration are suppressed, and one unreadable ref degrades individually (`replay/observe.mjs:13`, `:28`). A directory that Git rejects is walked as files rather than hidden under a universal unavailable marker. This avoids the prior content-hiding fallback.

It is **not a demonstrated host/Git-version-independent oracle in general**. The fixed corpus's SHA-1 repos and nonvolatile committed bytes matter. Raw committed content, object-format differences, detached HEAD and Git-less fallback are P3P-04. Repository-local configuration is still local input; the helper is not claiming to remove it. Gitlink entries, if admitted, contain commit object IDs rather than ordinary blob IDs; the implementation copies each raw `ls-tree` line. No submodule or detached-HEAD replay experiment was performed here.

For `cov-capture-sync`, two actual reference replays produced the identical line and matched the committed golden:

```text
M repo/tgit/ g:00532a77df7bd13f→g:04099c91317522c4
```

README/CASES now correctly explain most exclusions: snapshots are before the first and after the last event, so transient create/delete and write/restore are invisible; ordinary modes, mtimes and empty directories are absent; `.git`, explicit `untracked` paths, and writes outside the sandbox are excluded. Selected outputs and event streams are compared separately after their documented scrubs/diagnostic normalization. Unreadable entries have `u`, not content. The Git summary omits ordinary commit metadata, history beyond count/tip tree, index, reflogs, hooks, config and loose control files. Git tree modes are included even though ordinary filesystem modes are not. README's short exclusion list should also name `untracked` explicitly; CASES does (`README.md:25`, `corpus/CASES.md:170`). These intentional boundaries still require the owner's §18.2 disposition (`docs/reviews/owner-signoff.md:38`).

## 2. P3-01…P3-12 dispositions

“Closed” for a map finding means the planning defect is corrected, not that a B2 migration has landed or the owner has approved its options.

| Finding | Disposition | Evidence at HEAD |
|---|---|---|
| P3-01 cumulative false passes | **Partly** | Original two-declarer bypass closed: `composeExpected` and default/all comparison (`scripts/migrations.mjs:217`, `:325`), Repro A above. New path-key false pass P3P-01 prevents accepting the broader exactness claim. |
| P3-02 stage-cache contamination | **Closed** | Exact untrack at `corpus/cases/fault-capture-stage-locked/replay.json:47`; four clean sequential replays; sibling write remains observed (`replay/runner.test.mjs:336`); full local baseline green. |
| P3-03 content-free observation | **Partly** | Fingerprints now survive (`replay/observe.mjs:83`); original C fixed and broad boundary documented. P3P-02 gives another exact observation collision; P3P-04 qualifies the determinism claims. |
| P3-04 fake default mode | **Closed** | Default uses null/unset, explicit all is separate (`scripts/migrations.mjs:304`, `:324`); actual bad named-only implementation is rejected by the passing Repro D regression. |
| P3-05 unowned reader obligations | **Closed (map)** | O1 → item 4's reader half, O2 → proposed 22, O3 → proposed 23 (`docs/b2/MIGRATION-MAP.md:322`). Q1a/Q8d/Q16 disallow keeping the defects (`:1318`, `:1355`, `:1399`); minutes are distinguished from dollars (`:775`). |
| P3-06 mutable historical binding | **Closed (map)** | Revisionless lines bind to implied legacy policy; revisioned lines bind to their archive; current/different revisions cannot reinterpret them (`docs/b2/MIGRATION-MAP.md:65`). Q11b's same-revision edge needs a decision; proposal-label residue is P3P-05. |
| P3-07 loss of B1 defaults | **Closed (map)** | Frozen `B1_DEFAULTS`, old validation and post-B2-cleanup none differential are explicit (`docs/b2/MIGRATION-MAP.md:96`, `:329`). None supplies the rescue writer half, not the complete mixed-reader rescue. |
| P3-08 capture/restamp conflict | **Closed (map)** | Restamp is excepted from capture stamping and preserves original writer; original manifest revision preservation is labeled a proposal, with older-writer/current-manifest acceptance (`docs/b2/MIGRATION-MAP.md:222`, `:328`, `:1395`). |
| P3-09 per-row anonymization hole | **Closed (map)** | Whole-submission union of identifiers, cross-row/nested/extension strings and acceptance are explicit (`docs/b2/MIGRATION-MAP.md:676`, `:709`, `:1361`). Q9 must still fix the identifier set and match boundary. |
| P3-10 false R13/R17 premises | **Closed (prose/evidence design)** | R13 withdraws the macOS/Linux divergence and uses an unsorted stub; R17 requires an unpreloaded subprocess (`docs/b2/MIGRATION-MAP.md:1229`, `:1233`, `:1240`; `corpus/CASES.md:179`). Registry admission of these normalized-only fixes remains P3P-06. |
| P3-11 anonymous async frames | **Closed** | Optional async prefix and direct anonymous/internal/ordinary-text tests (`replay/observe.mjs:97`, `replay/observe.test.mjs:205`, `:211`); original C now normalizes. |
| P3-12 B2 recorder exit omission | **Closed** | `writeB2` removed. `write` deliberately records the actual complete exit vector, clears stale baseline-equal exits, and checks event count (`scripts/migrations.mjs:358`, `:371`); tests at `scripts/migrations.test.mjs:379` passed. This is a reviewed recorder, not enforcement of a previously hand-written exit vector. |

### Map ownership and proposed requirements

Within the reviewed B2/adjacent obligations, every required outcome now has an owner (`docs/b2/MIGRATION-MAP.md:320`): O1 item 4; O2 proposed 22; O3 proposed 23; O4 item 8 plus B3 archive retention; O5 the first C1 command-receipts task; O6 proposed 24 or an explicitly approved B3 move; O7 items 9/11; O8 the frozen B1 path; O9 item 5; O10 item 3's persisted-format reader plus B4 recovery. O11 is explicitly optional robustness.

Q1(a)'s items 22–24 are proposed migration slots for existing requirements, not invented requirements. The previous keep-first/unknown-as-zero options are gone. A proposed explicit spec/milestone amendment is an owner decision with retained ownership, not a silent waiver. The inclusive-by-role **minutes**, missing-archive handling, legacy mtime classification and restamp manifest-revision details are identified as derived proposals rather than quotations of binding text, except for P3P-05's residue. Q11a/b should be finalized together so the accepted same-revision edge cannot be mistaken for the old mutable-current fallback.

This remains a map ready for decisions, not an approved implementation contract: `docs/reviews/owner-signoff.md:3` says nothing is approved, and `:40` / `docs/b2/MIGRATION-MAP.md:1316` require the questions answered before Plan 4 is written. This review supplies no owner answers.

## 3. Patch-ledger ruling verdicts

One line per explicit ruling in the patch section; line numbers are in `docs/plans/plan-3-ledger.md`.

| Ruling | Verdict |
|---|---|
| `:130` — replace retired `expected/b2` / `writeB2` map references | **Agree.** Composition/interactions are the actual interface, so the map must use them. |
| `:141` — read-only Git plumbing summary | **Agree with qualification.** Better than implementation-file hashing, but raw blob bytes, detached HEAD, object format and Git availability limit the guarantee; the original `g:unavailable` whole-directory fallback has correctly been superseded. |
| `:150` — every overridden key's owners named; unowned paths allowed; one named case declarer | **Agree with the rule; disagree that recording fully enforces it.** The checker does, but conflicted-owner recording still violates it (P3P-03). |
| `:167` — correct POSIX pipe prose in CASES/preload | **Agree.** The repository no longer treats a Linux run that happened to drain as a synchronous-pipe guarantee. |
| `:175` — bounded fix wave and scoped independent re-review | **Agree as a process decision.** Model assignment is not evidence of correctness; the residual findings require their own regressions. |
| `:179` — park missing-archive proposal labels for Task 1 | **Agree only as an explicit Task 1 edit.** The residue is real (P3P-05), and must be fixed before freezing instructions. |
| `:180` — recorder no-op-key feedback and missing main README exit-key ban are polish | **Agree for those two items.** They are not silent check passes; P3P-03 is a separate recorder-validation correction. |
| `:181` — document Git as a host precondition | **Agree.** Raw fallback preserves visibility but cannot promise stable object/index bytes; also retain the raw-blob caveat parked at `:144`. |
| `:182` — Ubuntu/Linux-Git evidence before Plan 4 lands migrations | **Agree.** Local Apple Git success and a CI matrix file are insufficient evidence of that matrix. |
| `:183` — candidate tag includes final fixes and ledger | **Agree.** The requested tag and HEAD both resolve to `952ebe57aec91199f5ca5eca8897132acaa4234d`; no tag was moved by this review. |

The controller clarification at `:149` is also sound: requiring every named migration to change the case alone would forbid the legitimate entry-guard/writer interaction. The `:178` “all addressed” re-review is historical evidence, not sufficient closure of P3P-03.

## 4. Recommended Plan 4 Task 1 scope

**Repair the remaining gate defects, obtain the missing evidence, and freeze the owner-approved migration contracts before recording new migration after-files.** Most of the previous review's repair work is now complete; do not repeat it wholesale.

1. **Close P3P-01 and P3P-02 with adversarial end-to-end coverage.** Make all file-key dictionaries safe, verify no-op/removal semantics, and use unambiguous observation records. Exercise actual collection as well as pure comparison. Require wrong/missing prototype-named files and the one-link/two-link collision to fail. Preserve the passing original A–D regressions, exact compositions, exit ownership, engine-only participation and later-case checks.
2. **Finish recorder and normalized-only evidence policy.** Close P3P-03 before any destructive replacement of after-files; report dropped hand-listed no-op keys; document the reserved `exit:<i>` path rule in `corpus/README.md`. Resolve P3P-06 if items 13/14 are approved: identify their executable evidence and how the registry admits it without weakening ordinary migration evidence. Full `check`, not `--only`, remains the landing gate. State whether subset interaction modes are outside scope or add them if switch combinations will be claimed supported.
3. **Complete observation wording and portability evidence.** Close P3P-04, name `untracked` in the short README boundary, state Git/non-root preconditions, and obtain the owner's concrete §18.2 scope decision. Run the supported Ubuntu/macOS × Node 18.19/24 matrix, including repeated `cov-capture-sync` observations on Linux Git. Keep restricted-environment OTel skips separate from service acceptance. Current local gates need no baseline repair; rerun them after the actual changes.
4. **Resolve owner dependencies and freeze the map.** Obtain the Q1–Q16 and ten reachable-exclusion dispositions; approve slots 22–24 or explicit owned amendments, and separately decide optional 12–21/grouping. Resolve Q11a/b, Q10c and Q15b together with P3P-05's labels. Update registry/landing order and implementation acceptance after these decisions. Item 4 explicitly includes aggregate unknown-count work. Keep frozen B1 settings/validation and a post-B2-cleanup none differential; distinguish the B1 writer from the later B4 mixed-reader rescue.
5. **Specify the missing acceptance evidence before implementation.** Assign `before-report-unknowns` to item 4 and `before-ratio-revisions` to item 8; record each baseline before implementing its behavior, then land its after-diff with that migration. Require real engine-generated full-cohort allocation traces, null/zero/partial distinctions, conflict-order independence, inclusive parent-role dollars, historical-manifest stability, older-writer restamp, cross-row/nested anonymization, and mixed-era reading independent of current capture switches. Preserve the per-part API2 input/context/return and Promise-rejection contract work; a phase-name trace alone is insufficient.
6. **Keep later obligations explicitly assigned.** B3 owns archives/installer, production switch/provenance enforcement and foreign-install wording; B4 owns mixed-reader rescue/rollback; the first C1 command-receipts task owns engine command-receipt integration. Optional stdout-drain and stable-enumeration need unpreloaded/substituted-listing evidence because replay intentionally masks them. Do not turn these deferrals into claims of B2 completion.

Task 1 exit: no demonstrated undeclared-output pass within the agreed boundary; bad-implementation regressions fail as intended; supported-environment evidence or a precisely accepted limitation is recorded; unset/default and all share exact declared expectations; none remains reference-equivalent; every map choice needed for implementation is decided, and every deferred required outcome has its approved owner and acceptance. No after-golden should be fabricated merely to satisfy a nonempty-declaration rule.

## 5. What was checked and could not be checked

Environment: macOS, Node `v24.14.1`, Git `2.50.1 (Apple Git-155)`, non-root, restricted local filesystem/network environment. The working tree was initially clean. Both endpoints, HEAD and branch were checked; all 27 changed paths were identified. Source, tests, prior review, patch plan, patch ledger, dispositions, map, binding spec sections and owner sheet were reviewed. Independent read-only standards/observation and spec reviews supplemented the primary adversarial review; no stylistic heuristic was elevated to a finding.

| Check | Observed result |
|---|---|
| `npm test` | Exit 0: **619 tests, 615 pass, 0 fail, 4 skipped**, 0 cancelled. |
| `node scripts/diff-impl.mjs` | Exit 0: **65 cases, differing 0**. |
| `node scripts/inventory.mjs` | Exit 0: **371 reference sites, 72 engine sites**; unassigned/unlisted, stale, invalid and count problems all zero. |
| `node scripts/migrations.mjs check` | Exit 0: **2 modes, 68 cases, problems 0**. All real migrations remain unlanded. |
| Imported coverage functions | **474 functions, 13 uncovered**; function open/stale/weak/duplicate all zero; invalid whole-file pins zero; branch open/stale/weak/duplicate/over-budget all zero; replay-exit problems zero. No coverage CLI/report writer ran. |
| Reproductions A–D | A rejected in default/all; B clean in all four sequential replays; C retains distinct fingerprints and normalizes async frames; D still exposes the bad fixture and its checker regression rejects the unset mode. |
| New checker/recorder probes | Reproduced P3P-01's full-mode false passes and P3P-03's successful invalid recording in memory; independently rejected undeclared behavior on a later-added case. |
| New pure observation/registry probes | Reproduced P3P-02's exact record collision and P3P-06's waived-but-unlandable migration. Raw Git blob-hash probe confirmed different sandbox strings retain different object IDs. |
| Repeated `cov-capture-sync` | Two actual reference runs matched each other and the golden; exact digest line above. |
| `node --test tokenomics/hooks/otel-sink.test.mjs` | Four skips, each `local listen unavailable (EPERM)`; explains the full-suite skips, not proof of live service correctness. |

I did not run Ubuntu/Linux Git, Windows, Node 18.19, a fresh-clone matrix, real B2 migrations, a live OTel listener, installation, B4 rollback/shadow, or every subset of migration switches. The ledger's Node 18.19/clean-clone results are historical reports, not this review's execution. I did not rerun Reproduction E from the prior review: those intentionally preserved B1 accounting defects are assessed here by their map ownership and unchanged implementation scope. Gitlink/detached-HEAD observations above are source deductions, not real repository mutation experiments. The full-checker attacks substitute a deterministic replay boundary and virtual filesystem, so they prove checker/recorder logic; B, D and repeated Git-case checks use real child processes.

No raw-corpus directory was read or copied. `reference/` remained read-only. No source, fixture, golden, plan, ledger, coverage report, commit, branch, tag, remote or push was changed. Authorized tests/replays used their ordinary temporary runtime sandboxes; additional adversarial fixtures were held in memory. The only authored repository artifact is this review.
