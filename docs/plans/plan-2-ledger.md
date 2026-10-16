# SDD ledger — plan: ~/dev/sdlc-skills/docs/superpowers/plans/2026-10-10-harness-telemetry-plan-2-inventory-coverage-extraction.md

Spec: ~/dev/harness-telemetry/docs/spec.md (v4.2). Start: main @ 794cc73 (tag v0.1.0-rc.1).
Working on `main` of the unpushed, remote-less repo — Plan 1 ruling + owner handoff; no worktree.

## Pre-flight conflict scan

| tasks | shared file/interface | produced vs consumed | finding |
|---|---|---|---|
| T1↔T2 | scripts/inventory.mjs (scanReference, checkAssignments, id format `<file>:<cat>:<sha10>`) | T1 produces, T2 consumes + may tighten regexes | consistent; T2 may edit inventory.mjs → must re-run T1 tests (plan says so) |
| T1↔T9/T10 | docs/inventory/b0-assignments.json | T2 writes; T9 reads engine-config targets; T10 reads ta-extension targets | consistent; T2 HOOKS list == T10 HOOKS list (7); T2 CONFIG regex ⊇ T9 Settings keys |
| T3↔T4–7 | coverage.mjs measure()/branchGate, report.md "## Branch blocks", branch-exclusions.json | T3 produces gate + report section; T4–7 consume via awk on report.md | consistent |
| T3 internal | branch gate file scope | plan expects ~470 open (225+135+57+43+13) but measure() also sees build-tokenomics-export.mjs (40/82 dead), whole-file excluded at function level | CONFLICT → Ruling P1 |
| T3 internal | budget kinds | Review Focus 4 says approved-reachable+unreachable ≤15%; branchGate code counts all kinds | CONFLICT (minor) → Ruling P2 |
| T4–7↔goldens.mjs | writeGoldens throws on any non-zero exit | fault cases may exit non-zero by design (assert.json `exits`) | CONFLICT → Ruling P3 |
| T4–7↔T10 | corpus case list | T10 adds implOnly filter to goldens/targeted/a4/coverage | consistent (T10 owns the filter) |
| T8↔T9/T10 | tokenomics/{hooks,scripts} engine copy, diffImpl(implDir,{cases}) | T8 produces; T9/T10 run after each commit; T10 extends diffImpl with traceHooks + runCase extraEnv | consistent; T10 changes diffImpl return shape only when traceHooks=true |
| T8↔npm test | copied reference *.test.mjs under tokenomics/ | scripts/test.mjs skips only reference/; copies now run | plan anticipates (fix test path assumptions only) |
| T8↔existing tokenomics/ | tokenomics/{kit,spec,fixtures} already exist | copy adds hooks/scripts/templates/references | no name collision (checked) |
| T9↔T10 | config.mjs `extension` key, loadSettings | T9 produces; T10 loadExtension consumes | consistent |
| T10↔T11 | ENGINE-B1.md, ci.yml | T11 appends | consistent |
| T1 self | tests vs code | planted lines vs regexes | plan says fix regex not test if a planted line misses |
| T2 self | creates assignments; may edit inventory.mjs | ok |
| T3 self | tests vs code | blockId col = start - lastIndexOf('\n') → 1-based; test `if (x) {` off 7 in line 2 → col 8 ✓ | ok |
| T4–7 self | procedure | ok; time-box >25 cases/file → controller rules |
| T8 self | test expects 'ccusage-metered' literal in hooks/telemetry-capture.mjs | verify at task time |
| T9 self | test `receiptsRoot` join(r,'.agents/automation') == join(r,'.agents','automation') ✓ | ok |
| T10 self | "all reference entry points have an async main" — unverified | implementer verifies; rule if false |
| T11 self | clean clone into /tmp/ht-b1 (plan text) | ok |

Ruling P1: branch gate scope excludes files carrying a whole-file (`fn: "*"`) function-level exclusion (build-tokenomics-export, install-hooks, otel-report, otel-sink), and dead blocks lying inside a function that has a function-level exclusion count as covered by that exclusion (reported, not open, not in budget) — those already carry an owner-reviewed reason and the plan's ~470 target is exactly the 5 in-scope files — if wrong: 40 export blocks stay unclosed until A5 revisits export.
Ruling P2: the 15% budget counts every branch exclusion kind (plan's branchGate code), stricter than Review Focus 4's wording — the spec is silent; stricter is safer for "closure by exclusion" — if wrong: a few extra fault cases get written.
Ruling P3: if a fault case needs a deliberate non-zero exit, `scripts/goldens.mjs` honours the case's assert.json `exits` (one-line change, allowed in Tasks 4–7) — goldens.test.mjs already honours it; goldens.mjs is the only consumer that doesn't — if wrong: trivial revert.

## Progress
Task 1: minor (deferred): isComment skips only line-leading comments; trailing `// …` comments become sites (inventory.mjs:34)
Task 1: minor (deferred): same-snippet dedupe per file/category has no test (inventory.mjs:44-46)
Task 1: minor (deferred): "every category fires" checks the union, not line→category (inventory.test.mjs:21-26)
Task 1: minor (deferred): renderMarkdown / --write CLI untested
Task 1: complete (commits 794cc73..a87b03d, review clean; trailer amended pre-review; 238 sites)
Task 2: dispatched (base a87b03d, opus)
Task 2: Ruling: scanner misses real TA surfaces (batch-cost OVERHEAD_STAGE/FIX_STAGE/STAGE_KIND regex literals — `\btriage` defeats the stage-words word boundary; loadSizings/applySizing — `sizing` regex is case-sensitive; join(repo,'.agents','estimation') — split path) → widen the scanner now with planted tests for each missed real snippet, regenerate and assign — Review Focus 5 + spec B0 "no unassigned item"; Task 10 builds on a complete TA surface — if wrong: some extra sites to assign (cheap).
Task 2: note for Task 10: spec §14.3 has no render hook; rendering of TA-produced fields (sizing, gate/drift, fix rounds, byStage) is assigned to the producing hook — Task 10 must decide how those render (carry this pointer into Task 10 dispatch)
Task 2: Ruling: vocabulary.group gets a narrow scanner category (`group-wording`: a quoted/markup string containing the word batch/batches as rendered wording — not `.batch` property access, not the `batch-cost` filename) so spec §14.4's key has sites to lift — spec names the key; B1 must lift what it names — if wrong: a handful of extra sites; FP cap 10% still applies.
Task 2: Ruling: the duplicated three-way campaign/wave batch resolve (work-scope:216, telemetry-capture:1443) gets ONE owner, `enrichGroup`, with a note "interface gap: Task 10 decides the signature that lets the hook select matching receipts" — spec §14.3 has no scope-matching hook; one owner prevents two divergent copies — if wrong: Task 10 re-homes two sites.
Task 2: review r0 found 4 Important (receipt.gate missed; rule-4 wording/outcome vocab missed; vocabulary.group no sites; batch resolve split over two hooks) + minors (rework consistency, export:253 should be exportRow, notes on embedded config / dual-owned literals / unscanned lines in anchored functions) — all sent to round 1
Task 2: fix round 1/5 (5 addressed, 0 open — receipt.gate, rule-4 wording, group-wording, batch-resolve owner, minors; commits ad69729..2697270)
Task 2: minor (deferred): judgement calls accepted — team-report:151 default 'not-started' → receipts.deliveredOutcomes (no dedicated key); batch-cost:62 / team-report:132 `_`/telemetry dir skips → receipts.root
Task 2: complete (commits a87b03d..2697270, review clean; 371 sites: engine-config 172, ta-extension 194, retired 5 FP)
Task 3: dispatched (base 2697270, sonnet)
Task 3: minor (deferred): blockRanges keyed by start-end — two dead blocks with same start/different end would share an id (none today; 473 unique) — dedupe or assert uniqueness
Task 3: minor (deferred): plan-mandated weak-citation regex /:\d+/ accepts any ":digits" (e.g. "ratio 1:2")
Task 3: minor (deferred): measure()'s inFns computation untested directly (exercised by real gate run); no captured RED run
Task 3: complete (commits 2697270..e81ed1a, review clean; branch open 473 = tc 225, tr 135, bc 57, ws 43, sh 13)
Task 4: dispatched (base e81ed1a, sonnet)
Task 4: review r0: 1 Important (approved-reachable work-scope:224:49 reason wrong — dangling symlink reaches it) + 7 minors; all sent to round 1
Task 4: fix round 1/5 (9 addressed, 0 open — symlink fault case replaces wrong approved-reachable; stronger facts; hermetic {impl} cwd; reclass 182:7; shared expectedExits; commits 05a6db6..cc1e456)
Task 4: minor (deferred): sandbox symlink validation is lexical — chained links could theoretically escape (hostile manifest only)
Task 4: minor (deferred): `{impl}` token expands only in args/stdin, not stores — a stores use would keep the literal silently
Task 4: complete (commits e81ed1a..cc1e456, review clean; 7 cases; exclusions: 1 unreachable (work-scope:329:54), 1 approved-reachable (scope-hook:182:7 — OWNER SIGN-OFF); branch open 389)
Task 5: dispatched (base cc1e456, sonnet)
Task 5: review r0: 2 Important (634:45 "unreachable" is reachable via work-scope close --repo ""; fault event 2 exit 1 indistinguishable from crash → add captureStderr) + minors; sent to round 1
Reference finding (for Plan 3 / B2): `work-scope.mjs close --repo ""` (or CLAUDE_PROJECT_DIR="") passes repo '' via `??` (work-scope.mjs:256) → buildBatchCost silently skips sizing (batch-cost.mjs:634).
Task 5: fix round 1/5 (5 addressed, 0 open — 634:45 now a case (fault-batch-cost-empty-repo); opt-in captureStderr; 181 sort observable; commits 8426b98..d23d068)
Task 5: minor (deferred): captureStderr must only capture designed messages — an uncaught-throw stack would embed impl line:col in goldens; add a CASES.md note
Task 5: minor (deferred): 105:23 and 616:31 executed-only (no observable fact possible), documented in CASES.md
Task 5: complete (commits cc1e456..d23d068, review clean; 3 cases; 16 unreachable + 1 approved-reachable (batch-cost:359:77 — OWNER SIGN-OFF); branch open 334)
Task 6: dispatched (base d23d068, sonnet)
Task 6: review r0: 1 Important (658:267, 721:111 "unreachable" reachable via negative token counts) + minors (7 approved-reachable should be unreachable for consistency; adversarial re-check of renderer-fallback unreachables); sent to round 1
Task 6: Ruling: `--receipts /dev/null` (cov-team-report-rollup ev 17) stays — read-only char device on macOS+ubuntu, no in-sandbox input can produce an existing non-file non-readable-dir node without chmod; disclosed in CASES.md — if wrong: one event is non-hermetic in a read-only way.
Reference finding (Plan 3 / B2): team-report tokenomics markdown prints `NaN%` shares for a batch with zero sessions (team-report.mjs:605-611, pct(0/0)); pinned by cov-team-report-batches.
Task 6: fix round 1/5 (3 addressed, 0 open — negative-token + overflow cases replace 3 false unreachables; 7 approved-reachable reclassified unreachable; commits 80ed9be..3282a4c)
Task 6: complete (commits d23d068..3282a4c, review clean; 2 cases; 44 unreachable (7.7%); 0 new approved-reachable; branch open 215 = telemetry-capture only)
Task 7: dispatched (base 3282a4c, opus)
Task 7: Ruling: the darwin-only branch telemetry-capture.mjs:1014 (vscodeStorageRoots) gets an opt-in replay facility — preload honours event env `HT_PLATFORM` by overriding process.platform — set on the covering case's events so it is covered identically on macOS and ubuntu CI — the coverage gate must be platform-independent and an exclusion would be stale on macOS — if wrong: a tiny preload shim to remove.
Task 7: minor (deferred, Plan 1 case): reference lists sub-agents in readdir order; cov-dispatch-batch's 8-sub golden is in macOS (sorted) order — may differ on Linux CI. Reference finding for Plan 3 (unsorted sub-agent enumeration). Triage at final review.
Reference findings (Plan 3 / B2, from Task 7): VS Code op-log update ≥2 past end crashes & silently drops the session; VS Code session with no timestamps re-appended every sweep; sub-agent transcript path that is a directory crashes --dispatch; a `scopes` file loses sessions for all three hosts.
Task 7: review r0: 3 Important (approved-reachable 428:47, 601:73 drivable via an in-sandbox meter stub — TOKENOMICS_CCUSAGE_BIN=node + repo script; 1200:40/1201:90 drivable via otel enabled + HOME=/dev/null/x so the sink child exits before binding) + minors; sent to round 1 together with the HT_PLATFORM ruling
Task 7: Ruling: the "meter stub" lever (event env TOKENOMICS_CCUSAGE_BIN=node + an in-repo CommonJS script that mutates sandbox files) is a legitimate input for fault cases — it is the documented meter override, deterministic and in-sandbox — if wrong: two fault cases rely on a test double the owner may find too clever (they still only replay reference code).
Task 7: Ruling: 601:73 via chmod 0500 inside the stub is accepted with a CASES.md caveat (root ignores modes; GitHub ubuntu runners are non-root) — if wrong: the case fails under root CI and reverts to an exclusion.
Task 7: Ruling: tag v0.1.1-rc.1 is moved (git tag -f, local/unpushed) to the fix-round commit once coverage exits 0 again — the tag must mark the gate commit — if wrong: none (never pushed).
Task 7: minor (deferred): A4 kit check does not read nested `<sub>/.agents/telemetry` ledgers (cov-capture-identity w1/, alt/) — extend A4 later
Task 7: fix round 1/5 (5 addressed, 0 open — 3 fault/cov cases replace 4 approved-reachable; HT_PLATFORM preload; 544:32 reworded; commits 379fbd0..97af294)
Task 7: minor (deferred): fault-capture-stage-locked leaves a 0500 dir if event 2 never runs (runner abort) → sandbox rmSync could fail and leak under tmpdir
Task 7: minor (deferred): spawned otel-sink child now writes V8 coverage (function uncovered 12→19, all in whole-file-excluded otel-sink; open 0)
Task 7: complete (commits 3282a4c..97af294, review clean; 13 cases; 27 unreachable + 5 approved-reachable (705:51, 1278:53, 544:32, 1328:30, 1331:5 — OWNER SIGN-OFF); coverage exit 0; tag v0.1.1-rc.1 @97af294 = B1 entry gate)
Task 8: Ruling: diffImpl uses replay/exits.mjs `expectedExits` (Task 4's shared rule) instead of the plan's inline exits code — same behaviour, one rule — if wrong: none.
Task 8: dispatched (base 97af294, sonnet)
Task 8: Ruling: plan-mandated isDiffable filter silently skips a case dir lacking expected/49577c7 → change to skip ONLY implOnly:'engine' and report `no golden` / bad manifest as a problem; engine.test compares the diffed set to all case dirs minus implOnly instead of `>= 26` — spec §18.2 "zero diff on the corpus" means every case — if wrong: none (stricter gate).
Task 8: review r0: 2 Important (silent skip; weak floor) + minors (clean tmp-copy test, tmp cleanup, missing/extra/exit paths untested); sent to round 1
Task 8: fix round 1/5 (5 addressed, 0 open — every case dir diffed, set equality in engine.test, problem-path tests; commits 759f769..a6180b5)
Task 8: minor (deferred): `no golden` branch untested (needs a casesDir option); test title overclaims
Task 8: complete (commits 97af294..a6180b5, review clean; cases 51, differing 0)
Task 9: Ruling: engine-config sites in files the corpus does not replay (install-hooks, otel-sink, otel-report, build-tokenomics-export — whole-file coverage exclusions) ARE lifted too (B0 assignment is binding) but guarded only by their copied unit tests — lift them with literal-preserving minimal edits — if wrong: an unverified byte change in an unreplayed file; final review should look at those diffs specifically.
Task 9: dispatched (base a6180b5, opus)
Task 9: Ruling: vocabulary.item / vocabulary.group stay SCALAR words (spec §14.4 example `"item": "story"`); rendered forms (plural, capitalised, plural-capitalised) are derived by one small engine helper (plural: +es after s/x/z/ch/sh, else +s) so TA defaults 'case'/'batch' reproduce 'cases'/'Cases'/'batches'/'Batch' byte-for-byte; any site whose wording cannot be derived this way keeps its literal and is listed in ENGINE-B1.md as "not lifted: <why>" — spec shape wins over a per-phrase table — if wrong: a foreign project with an irregular plural gets a wrong plural until B2 adds an override.
Task 9: controller verified da4c533 (committed before gate re-run) → `cases 51, differing 0`
Task 9: review r0: 1 Important (settings half-threaded; ledgerPath kept unthreaded for a test anchor) + minors (validate settings up front, multi-root note, --compare cwd settings, ENGINE-B1 not-lifted markers, foreign-value lift tests, HTML escaping); sent to round 1
Task 9: minor (deferred): vocabulary words are interpolated into HTML unescaped while ratioIntents are escaped — pick one rule (B2)
Task 9: Ruling: plural helper also maps consonant+y → -ies (accepted extension of the vocabulary ruling; TA words unaffected, gate unchanged) — 'stories' is the spec's own example word — if wrong: one helper branch.
Task 9: fix round 1/5 (6 addressed, 0 open — settings threaded once; validation; --compare TA defaults; ENGINE-B1 markers; lift tests; commits f60fe3e..cfabc78)
Task 9: minor (deferred): lift.test telemetryDir test checks only the helper, not call sites honouring settings.dir
Task 9: minor (deferred): ENGINE-B1.md cites source line numbers that will drift
Task 9: complete (commits a6180b5..cfabc78, review clean; 172 engine-config sites handled, 8 not lifted with reasons; differing 0)
Task 10: Ruling: hook NAMES are fixed (7, contract test) but signatures are indicative (spec §14.3 "signatures indicative, B0 finalises") — every hook takes (input, ctx) where ctx = { repo, settings, phase?, … }; render of TA-produced fields (Task 2's render gap) and the three-way campaign/wave scope match are served by the producing hook with a `ctx.phase` ('render-md' | 'render-html' | 'match' …) returning the fragment/decision, engine default = '' / no extra fields / exact `c.batch === scope.batch`; every final signature + phase documented in ENGINE-B1.md "Extension API" — keeps the 7-name contract while closing the gap — if wrong: B2 re-splits phases into named hooks (API version bump).
Task 10: Ruling: entry points with a sync main (batch-cost.mjs:752, build-tokenomics-export.mjs:270) load the extension via top-level await in the main guard or make main async — whichever keeps exit codes/outputs identical; imported functions take `ext = null` trailing param per the plan.
Task 10: Ruling: `exportRow` is exempt from the corpus trace assertion (the export script is whole-file coverage-excluded and not replayed; A5 revisits export) — instead a unit test compares the TA extension's exportRow-driven export output with the reference export function on the same synthetic input (unit-level differential) — if wrong: export TA behaviour is unit-verified only, as it already was.
Task 10: dispatched (base cfabc78, opus)
Task 10: review r0: 2 Important (engine still renders TA gate/drift columns in by-group rollup; export segment still emits QA identity stop/owner_group/factory_type under extension null and the foreign golden pins it) + minors (generic §7 checks vanish with null ext; work_item_level profile fallback; shadowed hook local; temp leaks; duplicate corpus replay; trace append try; widen Step 6 grep); all sent to round 1
Task 10: fix round 1/5 (9 addressed, 0 open — gate/drift render via enrichGroup; export QA identity via exportRow; generic §7 checks kept; single traced replay; commits a0d5a94..ef603df)
Task 10: minor (deferred): by-group columns under extension null have no dedicated test (only export is asserted in the null test)
Task 10: minor (deferred): exportRow turned out to be reached on the corpus via work-scope close → appendRun, so the trace assertion covers it with no exemption; the "exempt" wording in test-automation.test.mjs and ENGINE-B1.md is stale
Task 10: minor (deferred): install-hooks.mjs:582 "block the gate" wording unassigned by the inventory — B2 installer work
Task 10: complete (commits cfabc78..ef603df, review clean; 193/194 TA sites moved (1 already a setting); all 7 hooks traced on corpus; differing 0)
Task 11: dispatched (base ef603df, sonnet)
Task 11: minor (deferred): README "every corpus case" — the implOnly foreign-null-extension case is exempt (51 of 52 diffed); plan-mandated wording
Task 11: complete (commits ef603df..a39b0f2, review clean; tag v0.2.0-rc.1 @a39b0f2; clean clone: 419/419, coverage 0 open, differing 0, inventory 0)
Final review: dispatched (794cc73..a39b0f2, opus)
Final review: With fixes — 4 Important (foreign settings.json silently inherits TA extension + relative extension path resolves against engine root; hook trace name-only + spy case lacks sub-agent; inventory gate scans only the reference, `other-batch` literal leak at team-report:393/:575; function exclusions bypass branch gate + export `*` reason false) + minors
Final: Ruling: when `.agents/tokenomics/settings.json` EXISTS it must state `extension` explicitly (string or null) — validation error otherwise; a settings-supplied relative extension path resolves against the repo root (spec §14.4), while the built-in TA default (absent file) still resolves against the engine root — absent-file behaviour stays TA (B1), a present file can no longer silently inherit TA behaviour — if wrong: porters must add one key.
Final: Ruling: export whole-file function exclusion is NOT narrowed in Plan 2 (narrowing pulls build-tokenomics-export into the branch gate, ~40 blocks to close) — its reason is corrected to the truth (reached via work-scope close → appendRun) and narrowing + branch closure becomes Plan 3 Task 1 — if wrong: export's close-path branches stay unmeasured until Plan 3.
Final: Ruling: function-level exclusions get the same reason rules as branch ones (≥ 40 chars; `unreachable` cites a line) and a whole-file `*` exclusion must carry `"wholeFile": true`; no budget (function counts are small) — closes the single-entry bypass — if wrong: cheap to relax.
Final: Ruling: park (record only) — mixed defaults on exported functions (B5), thin settings validation/silent hook failure (B3 doctor), implOnly unrestricted, {impl} touches checkout (event 8 read-only today), maturity default in engine, top-level await vs require(esm), multi-root roots[0] ext (B2), all T1–T8/T10/T11 parked minors per final triage.
Final: fix wave dispatched (base a39b0f2, opus)
Final: fix wave (a39b0f2..27f0bc5, 7 commits) — re-review: 9/9 addressed, no new breakage; npm test 433/433, cases 52 differing 0, coverage exit 0, inventory exit 0 (engine sites 57, unlisted 0)
Final: parked — foreign-settings cost.json perDelivered.note still names TA outcome words (recorded not-lifted site batch-cost delivered-vocab:4984fbacc4) + `.oc-automated` CSS class — B2
Final: parked — engine allowlist: ~25 false-positive entries share a boilerplate reason; scanSource same-line dedupe could hide an exact copy of an allowlisted line; tokenomics/engine/ not scanned
Final: parked — fault-batch-cost-sizing-locked leaves a mode-000 dir if it fails before its last event (runner rmSync would throw); root runners ignore chmod (CASES.md caveat)
Final: Ruling: tag v0.2.0-rc.1 moved (local, never pushed) from a39b0f2 to the ledger commit after the fix wave — the candidate must include the final-review fixes — if wrong: none.
Plan 3 Task 1 carry-overs: narrow build-tokenomics-export `*` exclusion to CLI-only functions + close its branches; owner sign-off on approved-reachable list.

---

# Plan 2 patch (v0.2.0-rc.2) — ledger


Spec: docs/spec.md (v4.2); findings: docs/reviews/plan-2-codex-review.md. Start: main @ bbe4867. Work on main (unpushed repo, Plan 1/2 ruling).

## Pre-flight conflict scan
| tasks | shared file/interface | produced vs consumed | finding |
|---|---|---|---|
| T2↔T4 | extension.mjs CORPUS_UNREACHED (exportRow submission) | T2 keeps `submission` unreached; T4 removes reached export phases | consistent |
| T3↔T4 | whole-file-scope.json, exclusions.json export `*` | T3 pins export temporarily; T4 removes exclusion + pin | consistent |
| T3↔T4 | branch budget now counts function waivers | T4's per-function exclusions waive blocks → count in budget | consistent (intended Review Focus 4) |
| T1↔T3 | coverage.mjs | T1 only reads coverage output (601:73 still covered) | consistent |
| T5↔T3/T4 | implOnly case foreign-mixed-roots | coverage/goldens skip implOnly | consistent |
| T2↔T4 | export submission rendering | T4's incomplete-segment CLI case pins T2's fix on the corpus | consistent; T4 after T2 |
| T6↔all | ENGINE-B1.md, ledger | appends | consistent |
| T1 self | stub env names (TMPDIR/CLAUDE_CONFIG_DIR) "check and adjust" | implementer verifies against reference | ok |
| T2 self | engine writeSubmission(repo,{anon},settings,ext) | matches engine main call | ok |
| T3 self | old 3-arg branchGate calls in existing tests | new 4th arg optional | ok |
| T4 self | procedure task, time-box 15 cases | ok |
| T5 self | test settings {dir, extension:null, vocabulary} pass validation | merge over TA_DEFAULTS keeps required keys | ok |
| T6 self | clean clone at /tmp/ht-rc2 | ok |
Scan clean; no rulings needed.

## Progress
Task 1: dispatched (base bbe4867, sonnet)
Task 1: review r0: 1 Important (stage observation tautological — stub removes the locked stage before checking it; plan-mandated text, ruling: fix — Review Focus 1 requires the facts to fail) + minors (symlink test for removeSandbox, test cleanup); sent to round 1
Task 1: fix round 1/5 (3 addressed, 0 open — pre-cleanup locked-stage facts; symlink-safe removeSandbox test; commits 776d725..8204b64)
Task 1: complete (commits bbe4867..8204b64, review clean)
Task 2: dispatched (base 8204b64, sonnet)
Task 2: Ruling: plan text said null-extension submission has no stop/owner text at all — that drops a foreign profile's own owner_group/stop (user data). Engine default for the two parts = the previous engine rendering (omit absent values, render present ones); the TA extension's parts override it (reference bytes). Engine call: hook(...) ?? default, not ?? [] — if wrong: foreign submissions show profile identity, which is the user's own data.
Task 2: minor (deferred): `sub` duplicates `part`'s hook call (sub = p => part(p, [])); null-ext title suffix with present stop has no direct assertion; new differential runs anon=false only
Task 2: complete (commits 8204b64..4589900, review clean; ruling applied pre-review)
Task 3: dispatched (base 4589900, sonnet)
Task 3: review r0: 1 Important (whole-file pin list unvalidated: reason ≥40, unique, file exists, matching fn:'*' exclusion) + minors (line 0, '..' escape, stale report heading, function-level duplicates, export reason task number); sent to round 1
Task 3: fix round 1/5 (6 addressed, 0 open — pinProblems, citation hardening, dup function exclusions; commits 01eca22..d2d9c49)
Task 3: minor (deferred): pin reason checked for length only (content not compared with the exclusion reason)
Task 3: complete (commits 4589900..d2d9c49, review clean; no existing reason needed changing — all citations already resolve)
Task 4: dispatched (base d2d9c49, opus)
Task 4: first implementer (opus) terminated by API weekly limit mid-task — left uncommitted: export * exclusion + pin removed, 4 draft replay.json (cov-export-cli, cov-export-compare, cov-export-submission-edges, fault-export-usage; no assert/goldens). Re-dispatched fresh on sonnet with the partial state (opus subagent quota exhausted until 08:00 Zurich).
Task 4: user asked for opus — sonnet re-dispatch stopped immediately (no tree changes); resuming the original opus implementer
Task 4: minor (deferred): cov-export-compare uses hand-written cmp/a.json,b.json — no compare of a real buildBatchCost output; s1 event branches pinned only by golden, not a named fact
Task 4: complete (commits d2d9c49..2baf427, review clean; 4 cases; export 9/194 excluded (4.6%) all unreachable + 1 fn; no new approved-reachable; CORPUS_UNREACHED empty; cases 56 differing 0)
Task 5: dispatched (base 2baf427, opus — user asked for opus)
Task 5: review r0: 1 Important (JSON-equal settings can load different extension modules; B-A order crashes with ERR_MODULE_NOT_FOUND) + minors (batch mode rejects unused roots; case lacks captureStdout; indexOf)
Task 5: Ruling: batch mode (`--batch`/`--batches`) uses only roots[0] — the compatibility check runs only in period-report mode, preserving prior batch behaviour — if wrong: a multi-root batch invocation silently ignores extra roots, as the reference always did.
Task 5: fix round 1/5 (4 addressed, 0 open — extension module identity across roots; batch mode skips check; stdout pinned; index lookup; commits 94e4ed0..2f79a2a)
Task 5: minor (deferred): rootsConflict byte comparison throws EISDIR/EACCES (uncaught, exit 1) when the extension path is a dir/unreadable — broken config; single-root also crashes in loadExtension; wrap reads → clean exit 2
Task 5: complete (commits 2baf427..2f79a2a, review clean)
Codex dispositions: P2-01 fixed (Task 1) · P2-02 fixed (Task 2; pinned on corpus by Task 4) · P2-03 fixed (Tasks 3+4: pinned whole-file scope, waivers budgeted, export narrowed) · P2-04 fixed (Task 3) · P2-05 fixed (Task 5) · P2-06..P2-12 + Plan 1 grain check + chmod/root prerequisites + Node 18.19 matrix → Plan 3 Task 1.
Task 6: dispatched (base 2f79a2a, opus)
Task 6: minor (deferred): ENGINE-B1 P2-04 line omits duplicate-function detection + citation hardening
Task 6: complete (commits 2f79a2a..5e8d8a5, review clean; tag v0.2.0-rc.2 @5e8d8a5; clean clone 463/463, cases 56 differing 0)
Final review: dispatched (bbe4867..5e8d8a5, opus)
Final review: With fixes — P2-01/02/04/05 closed; P2-03 partial: 1 Important (V8 emits no block ranges for uncalled functions → function-waiver budget always 0; `fn: '(never loaded)'` bypasses the pin rule) + minors (stale root caveat CASES.md:79; non-repo roots get TA_DEFAULTS → doc; key-order-dependent settings comparison; old Plan 1 bullet CASES.md:119; extension returning [] for unknown submission parts suppresses identity → doc; T2 null-ext title assertion)
Final: Ruling: an excluded UNCALLED function is weighted by a lexical count of branch points in its source range (if/else/?:/??/||/&&/case/catch/loops — one documented scanner) and that weight counts against the 15% budget; `fn: '(never loaded)'` is treated like `*` (must be pinned) — closes the zero-cost waiver without needing V8 data that does not exist — if wrong: the weight over- or under-counts a little; budget headroom is large (≤ 4.6% today).
Final: Ruling: tag v0.2.0-rc.2 moved (local, unpushed) to the fix-wave/ledger commit — candidate must include final-review fixes — if wrong: none.
Final: fix wave dispatched (base 5e8d8a5, opus)
Final: fix wave (5e8d8a5..70094f1, 3 commits) — re-review: 8/8 addressed, no new breakage; 468/468, cases 56 differing 0, coverage/inventory exit 0
Final: parked — branchPointWeight scans regex literals as code (a backtick or `/*` inside a regex can zero the count); no current excluded function has one — Plan 3 Task 1
Final: parked — per-file max(weight, byFunction) could under-count if V8 ever attributed blocks to an excluded function; byFunction is always 0 today — sum per-function maxima if that changes
Final: parked — T5 rootsConflict EISDIR/EACCES crash on a broken extension path → Plan 3 Task 1 (with P2-11)
