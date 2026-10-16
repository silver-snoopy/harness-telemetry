# SDD ledger — plan: ~/dev/sdlc-skills/docs/superpowers/plans/2026-10-11-harness-telemetry-plan-3-b2-entry.md

Spec: ~/dev/harness-telemetry/docs/spec.md (v4.2). Start: main @ 4913d97 (tag v0.2.0-rc.2). Work on main (unpushed repo; Plan 1/2 ruling, user said "ok go"). All subagents on opus (user instruction). Node floor stays 18.19 (user agreed).

## Pre-flight conflict scan
| tasks | shared file/interface | produced vs consumed | finding |
|---|---|---|---|
| T1↔T4 | replay/runner.mjs | T1 adds requires/unmetRequirements; T4 adds observation + capture | consistent (T4 builds on T1) |
| T1↔T8 | ci.yml | T1 matrix; T8 appends migrations step | consistent |
| T2↔T8 | scripts/diff-impl.mjs | T2 engineOnlyProblems rows; T8 migrations option + compareFiles move | consistent; T8 must keep T2's (engine-only) rows |
| T2↔T6 | corpus/engine.test.mjs | T2 B1 expected list via approvals; T6 foreign-settings JSON walk | different tests, consistent |
| T2↔T8 | corpus/engine.test.mjs | T8 runs engine-only goldens with TOKENOMICS_MIGRATIONS=none | consistent |
| T3↔T6↔T8 | engine-allowlist.json | T3 recursive scan adds engine/ sites; T6 removes stale delivered-vocab; T8 adds migrations env-var | consistent in order |
| T4↔T6/T10 | goldens | T4 adds changes.txt/streams; later goldens regenerated include them | consistent |
| T5↔T8 | engine/config.mjs loadSettings, config.test.mjs | T5 nested validation; T8 adds enabledMigrations(env) first line | consistent |
| T7 | kit only | — | independent |
| T8↔T9↔T10 | corpus/migrations registry, map NEW list | T8 registry with existing beforeCases; T9 map names NEW cases; T10 builds them + links | consistent |
| T9↔T11 | map §5 owner questions | T11 sheet lists them | consistent |
| T1 self | npx node@18.19 may fail offline | report-only fallback stated | ok |
| T2 self | branchPointWeight tests vs code | traced all 8 assertions against the given code: match | ok |
| T3 self | scanSource count vs reference assignments | assignments keyed by id, unaffected | ok |
| T4 self | explicit captureStderr raw vs normalised | plan allows either, additive-only check decides | ok |
| T5 self | entry-errors test may expose silent hooks | fix in task, keep exit code | ok |
| T6 self | delivered-note phase must be reached on corpus | TA cost.json with priced delivered average exists | ok |
| T7 self | expected unallocated computed by implementer (table example given) | ok |
| T8 self | Review Focus 2 entry-point rejection via loadSettings | added in plan self-review | ok |
| T9 self | doc task, citations verified by node -e | ok |
| T10 self | depends on T9 NEW list; time-box 6 extra | ok |
| T11 self | clean clone /tmp/ht-rc3 | ok |
Scan clean; no rulings needed.

## Progress
Task 1: dispatched (base 4913d97, opus)
Task 1: implementer DONE_WITH_CONCERNS (00a65ab): Node 18.19 run (npx) fails 7/465 + differing 3 — reference scripts process.exit() after stdout writes; macOS async pipe truncates at 8192 (Node 18) / 65536 (Node 24); Linux pipes are synchronous → goldens host/Node-dependent; committed golden cov-team-report-batches/__events__/3.stdout is truncated at exactly 65536 (full 67931)
Task 1: Ruling: land the preload fix (stdout/stderr setBlocking(true) in replay/preload.mjs) and regenerate ONLY goldens whose bytes change because of it, each verified: old content is a strict prefix of the new and old length is a multiple of 8192 — a truncated golden is a capture artifact of the macOS pipe, not reference behaviour; Linux CI would already produce the full bytes — the "additions only" constraint targets absorbing failures, not correcting a host-dependent oracle (same class as P2-01) — if wrong: one golden carries 2395 more bytes than the macOS-piped reference emits; recorded as reference finding (stdout truncation on process.exit with a pipe) for the map §3
Task 1: fix (controller ruling) 1a13f62 — blocking stdio; only cov-team-report-batches/__events__/3.stdout changed (65536→67931, prefix-verified); Node 18.19 466/466 + differing 0; review dispatched (opus)
Task 1: minor (deferred): 200 KB truncation test only bites on macOS (Linux pipes sync) — add comment; preload relies on _handle.setBlocking internals (macOS test is the guard); root refusal has no direct test (uid not injectable); OTel listen-denied skip + ready() reject path not committed as tests
Task 1: ⚠️ resolved by controller → real gap: on Node 18.19 the 5 tests of tokenomics/scripts/team-report.roots.test.mjs are silently unreported (466 vs 471; file stubs process.stdout.write, Node 18 test runner reports via the child's stdout) → fix round 1
Task 1: fix round 1/5 (1 addressed, 0 open — CLI test mains run in child processes, no stream stubbing; 471 = 471 names on Node 24 and 18.19; commits 1a13f62..670585a)
Task 1: minor (deferred): child-wrapper tests don't check r.error/null status (fail closed, indirect message); 3-line wrapper duplicated in 3 test files; check.test.mjs:152 calls COMMANDS.check in-process — any stdout write would land in Node 18 reporter stream
Task 1: complete (commits 4913d97..670585a, review clean)
Task 2: dispatched (base 670585a, opus)
Task 2: implementer DONE_WITH_CONCERNS (e1257a7): waived figures unchanged; regex heuristic misreads '/' after postfix ++/-- or object-literal } (under-count ≤ rest of line; no such pattern in reference); coverage still skips by implOnly flag (drift caught by diff-impl/npm test); review dispatched (opus)
Task 2: ⚠️ resolved by controller: gate results present in task-2-report.md (coverage replay problems 0, differing 0, 476/476)
Task 2: minor (deferred): coverage.mjs parses replay.json twice (brief snippet); engineOnlyProblems misses an approved dir without replay.json (diffImpl backstops); engine-only.test leaks ht-eo-* temp dirs; coverage gate skips by implOnly flag, not the pinned list; no test for missing/non-string reason; diff-impl CLI counts (engine-only) rows as cases; branchPointWeight misreads '/' after postfix ++/-- or object-literal } (under-count ≤ rest of line)
Task 2: complete (commits 670585a..e1257a7, review clean)
Task 3: dispatched (base e1257a7, opus)
Task 3: implementer DONE (c5460a9): 14 new engine/ sites (10 ta-default, 4 extension-call), no leaks, no overcounts; review dispatched (opus)
Task 3: minor (deferred): ta-default kind not enforced to engine/config.mjs ids; ENGINE-B1 Plan 2 paragraph still says hooks/scripts scope + 57 sites; scanEngine test leaks a temp dir (plan-mandated code); symlinked engine dirs would be skipped silently (none exist)
Task 3: complete (commits e1257a7..c5460a9, review clean)
Task 4: dispatched (base c5460a9, opus)
Task 4: implementer DONE (d6196de): +2 changes.txt, +113 stderr goldens, 0 M/D; no untracked needed (2 identical runs per case); explicit captureStderr normalised; Node 18.19 differing 0 and goldens identical; docs/spec.md:1083 'every output' left (spec is owner doc); review dispatched (opus)
Task 4: review Approved; reviewer re-replayed all 59 cases with skip rules loosened: the 2 changes.txt reflect real writes (nothing hidden)
Task 4: Ruling: plan-mandated determinism test is vacuous for changes.txt (seed-claude-basic writes none) — Review Focus 1 exists to pin it → fix: add cov-capture-sync to the determinism test; also normalise untracked paths (repo/./x would silently match nothing) and restore symlinkProblems' doc comment — cheap, keeps the focus honest — if wrong: one extra 2× replay in npm test
Task 4: Ruling: docs/spec.md:1083 "diffs every output byte-for-byte" left unedited (spec is the owner's binding doc); the narrower implemented scope (sandbox root only, .git skipped) is stated in README/CASES and goes to the owner sheet (Task 11) as a spec-wording item — if wrong: one spec sentence to align
Task 4: minor (deferred): collapsed git dir hashes its interior ignoring skip (tgit outputs double-observed; doc says skip hides subtree); .git skip hides future engine writes into the repo git dir — name it in the CASES limitation
Task 4: fix round 1/5 (3 addressed, 0 open — cov-capture-sync determinism, untracked normalisation, insideSandbox placement; commits d6196de..5d8f16a)
Task 4: complete (commits c5460a9..5d8f16a, review clean)
Task 5: dispatched (base 5d8f16a, opus)
Task 5: implementer DONE (199363c): no extra key paths; only scope-hook was silent (now prints named message on settings/extension load failure only, exit 0 kept — top-level print would break reference parity for swallowed runtime errors); review dispatched (opus)
Task 5: Ruling: scope-hook named message printed only for settings/extension load failures (not a top-level handler, as the brief said) — a top-level print would surface runtime errors the reference swallows, breaking absent-settings parity; reviewer agreed — if wrong: some scope-hook runtime failures stay silent (as in the reference)
Task 5: ⚠️ resolved by controller: gate claims are in task-5-report.md; Node 18.19 import-error codes untested locally — tests assert the message prefix only (low risk), CI matrix covers
Task 5: minor (deferred): extension.test leaks ht-ext-* temp dir (brief code); loadExtension drops the original error (add { cause: e }); ENGINE-B1 exit-code table not asserted by entry-errors test; no element-level deliveredOutcomes / receipts:[] cases
Task 5: complete (commits 5d8f16a..199363c, review clean)
Task 6: dispatched (base 199363c, opus)
Task 6: implementer DONE (a383183): foreign note now '(done)'; .json parsed whole (brief's per-line parse would crash on pretty JSON); 2 allowlist ids rehashed; stale delivered-vocab removed; review dispatched (opus)
Task 6: ⚠️ resolved by controller: commit stat shows only foreign-settings cost.json goldens changed (other engine-only goldens untouched); gate claims in report
Task 6: minor (deferred): TA delivered-note ignores its outcomes input (a TA project with custom deliveredOutcomes gets the reference wording — plan-mandated for byte parity); test passes outcomes [] without saying why
Task 6: complete (commits 199363c..a383183, review clean)
Task 7: dispatched (base a383183, opus)
Task 7: implementer DONE (1300eb4): 5 grain fixtures + 4 unit tests, existing 9 fixtures unchanged; review dispatched (opus)
Task 7: minor (deferred): grain values other than session/dispatch get dispatch rules (misleading 'dispatch undefined' message — reject unknown grain); dispatch overdraw tolerance per dispatch (N×tol) vs spec "per source" (session check still caps); overdraw violation group = last allocation's; tests hide the accompanying session-null violation / don't assert cross-group detail
Task 7: complete (commits a383183..1300eb4, review clean)
Task 8: dispatched (base 1300eb4, opus)
Task 8: implementer DONE (54f4ba8, 3991bf7): check = 2 modes, 59 cases, 0 problems (~55 s); default mode passes landed list explicitly / unsets when none landed; expectedFor gains caseId arg; 2 env-var allowlist entries; review dispatched (opus)
Task 8: review r0: 2 Important (empty declaration changed:[] lets a landed no-op migration pass all modes, write generates it; declared case without replay.json silently skipped) + ⚠️ doc claims every entry point rejects a bad TOKENOMICS_MIGRATIONS but otel-report/otel-sink never call loadSettings + minors (missing exits unreported; show swallows git failure; rows retain all files; expectedFor 4th arg); sent to round 1 with minor 3 (exit length — oracle)
Task 8: ⚠️ writer never-switchable in production is doc-only until B3/B4 settings work — carried to the map (D6) and owner sheet
Task 8: fix round 1/5 (4 addressed, 0 open — empty declaration / no-diff write / b2==baseline rejected; missing replay.json a problem in every mode; exit-count mismatch; doc names the 7 validating entry points; commits 3991bf7..430795e)
Task 8: minor (deferred): show swallows git spawn failure ("null" output); result rows retain every case's files in memory; expectedFor 4th arg unguarded; writeB2 refusal skipped when no baseline golden (check reports no golden); malformed string `removed` suppresses "declares no change" (shape error still reported)
Task 8: complete (commits 1300eb4..430795e, review clean)
Task 9: dispatched (base 430795e, opus)
Task 9: implementer DONE_WITH_CONCERNS (8824521): 9 NEW cases, Q1–Q16 incl. proposed items 12–21; 4 registry beforeCases show no diff (exact-ids/seed-receipts-shared-id, shared-allocation/cov-reports-ledger, anon-complete/cov-export-submission-edges, fold-flags/seed-claude-folded weak); planned before-export-anon-batch doesn't show §10.4 (--anon ignored on --batch); D6 switch set {2,3,4,6,7} conflicts with writer lines' §3.2 validity (Q3); writer version source undecided (Q14)
Task 9: review r0: 2 Important (D6/Q3 claim items 2,7 have contract-valid off — spec §5.4 says required, no exemption; item-1 before-ids-substring prediction should be 2→0 with the added 'review tc-1' dispatch, and Task 10's planned fact /cases/0/direct/dispatches=1 changes) + minors (sharedDispatches invented w/o Q; D6 row 7 unsourced clause; item 8 startedAt drop only with a window; item 10 stderr wording); all sent to round 1
Task 9: fix round 1/5 (6 addressed, 0 open — D6/Q3 no contract-valid off for 2,7; item-1 prediction 2→0; minors a–d; commits 8824521..7d203d2)
Task 9: minor (deferred): D6 "production-switchable: yes (per ruling)" column for rows 2,3,4,6,7 reads oddly next to "no contract-valid off" constraint cells
Task 9: complete (commits 430795e..7d203d2, review clean)
Task 10: Ruling: Task 10 follows the reviewed map where it corrects the plan — (a) before-export-anon-batch uses the map's corrected scenario (--anon is ignored on --batch; plan's scenario would not show §10.4); (b) before-ids-substring fact /cases/0/direct/dispatches is 2 (map's added review tc-1 dispatch); (c) the 4 weak registry beforeCases (exact-ids/seed-receipts-shared-id, shared-allocation/cov-reports-ledger, anon-complete/cov-export-submission-edges, fold-flags/seed-claude-folded) are replaced/augmented per map §2 so every migration's beforeCases shows its change; (d) all 9 NEW map cases are built (3 beyond plan, within the 6-extra time-box) — the map was reviewed against the reference; the plan predates it — if wrong: a few before-cases differ from the plan's table
Task 10: dispatched (base 7d203d2, opus)
Task 10: implementer DONE (8ab81d5, 9368785): 9 cases; map corrected for before-scope-handle (outcome --session <handle> recreates a record after claim); Copilot line in before-scope-precedence written by the Claude capture's catch-up sweep; report-windows receipts use revision + per-case at (Plan 4 to confirm); before-entry-symlink added to a4 no-telemetry list; review dispatched (opus)
Task 10: ⚠️ resolved by controller: targeted+migrations+runner tests 87/87, diff-impl cases 65 differing 0
Task 10: minor (deferred): via-symlink link keyed on basename only (two scripts with the same basename → second silently runs the first); before-report-windows REO-1 row shows no change under the target (CON-1 covers mtime-vs-revision); migrations.test CASE_NAME regex skips unknown case prefixes; before-entry-symlink pricing file unused under reference (kept for Plan 4)
Task 10: complete (commits 7d203d2..9368785, review clean)
Task 11: dispatched (base 9368785, opus)
Task 11: implementer DONE (127b6e6, tag v0.2.1-rc.1): clean clone 567/567, coverage open 0, cases 65 differing 0, inventory 0, migrations problems 0; sign-off sheet 10 rows; review dispatched (opus)
Task 11: minor (deferred): sign-off verdict column mixes editor notes with Codex words (rows 1,3,4); README "not observed" list omits `untracked`; spec §13 remaining item 3 (B5 external skill resolution) not on the sheet
Task 11: complete (commits 9368785..127b6e6, review clean; tag v0.2.1-rc.1 @127b6e6)
Final review: dispatched (4913d97..127b6e6, opus)
Final review: With fixes — 3 Important (default mode/writeB2 accept undeclared b2 differences — reproduced; landed migration need not declare its beforeCases; Ubuntu CI likely red: reference readdir order unsorted (R13), goldens are macOS order) + minors (normalizeDiagnostics keeps Node.js vX trailer / frame-count differs / runs on stdout; via-symlink link appears in reference changes.txt; harness TOKENOMICS_MIGRATIONS overrides event env, entry-errors test inherits shell env); triage: only Task 7 unknown-grain worth fixing; all 5 rulings agreed
Final: Ruling: replay preload sorts fs directory listings (readdirSync/readdir/opendir-free paths used by the reference) so enumeration order is deterministic on every host; regenerate only goldens whose bytes change, each verified to be a pure reordering (same multiset of lines/array elements) — R13 stays a recorded reference defect (map §3), the oracle must not depend on the filesystem's hash seed; same reasoning as the Task 1 stdio ruling — if wrong: goldens show sorted order where a given macOS volume might have produced another
Final: fix wave dispatched (base 127b6e6, opus): Important 1–3 + minor 4 (normaliser) + Task 7 unknown grain + minor 6 (entry-errors test env hygiene)
Final: fix wave (127b6e6..40cdbcf, 5 commits): all 6 fixed, no golden changed; fixer reports Node fs.readdir already sorted (libuv) so R13's premise looks false; Node 24 + 18.19: 581/581, differing 0, check problems 0; scoped re-review dispatched (opus)
Final: re-review — F1, F2, F5, F6 ADDRESSED; F3 code sound (libuv uv__fs_scandir strcmp-sorts on POSIX; the preload sort is a harmless guard) but docs false; F4 FRAME misses `at async <location>` frames; new Minor: writeB2 doesn't enforce a single declarer's exits when exits equal baseline (check's default mode still rejects)
Final: parked — map R13 (MIGRATION-MAP.md:1045, :1054) and proposed item `14: stable-enumeration` rest on a false premise (Node readdir is strcmp-sorted on macOS/Linux; only Windows differs), and its evidence case cannot show a diff under the sorting oracle; CASES.md:179 wording imprecise — Ruling: real and load-bearing for Plan 4 (the map is Plan 4's source) but doc-only; no second fix wave per process → first step of Plan 4 Task 1: restate R13 as "relies on undocumented order; differs on Windows", evidence = unit test with an unsorted readdir stub, and re-ask Q1 item 14 accordingly — if wrong: the owner sees one proposed item framed too strongly until then
Final: parked — normalizeDiagnostics FRAME misses V8 `at async <location>` frames (no current golden affected; a future uncaught async stack would leak impl line:col into stderr goldens) — Ruling: Plan 4 Task 1 adds `(?:async )?` + test before any new golden is written — if wrong: one golden needs regenerating then
Final: parked — writeB2 single-declarer exits not enforced when run exits equal baseline (check default mode rejects it, never silent) — Ruling: Plan 4 Task 1 — if wrong: a refused check after writing b2
Final: Ruling: tag v0.2.1-rc.1 moved (local, unpushed) from 127b6e6 to the ledger commit after the fix wave — the candidate must include the final-review fixes — if wrong: none

---

# Plan 3 patch (v0.2.1-rc.2) — ledger


Spec: docs/spec.md (v4.2); findings: docs/reviews/plan-3-codex-review.md (P3-01..P3-12). Start: main @ 75151e5 (v0.2.1-rc.1 = ab146c1). Work on main (unpushed). Model policy (user 2026-10-11): orchestrator opus 5.5; subagents chosen per task — sonnet 5.5 for T1/T4/T6 + their reviews, opus for T2/T3/T5 + their reviews + final review.

## Pre-flight conflict scan
| tasks | shared file/interface | produced vs consumed | finding |
|---|---|---|---|
| T1↔T2 | replay/runner.test.mjs, changes.txt format | T1 test matches path only; T2 changes line format | consistent (T1 first) |
| T2↔T3 | goldens with changes.txt; migrations check | T2 regenerates changes.txt goldens; T3 compares composed expectations of whatever goldens exist | consistent |
| T2↔T4 | replay/observe.mjs | T2 treeChanges/git summary; T4 FRAME regex | different functions, consistent |
| T3↔T5 | map's harness description (expected/b2) | T3 removes expected/b2; T5 edits map | T5 must replace map references to expected/b2 with composition/interactions — carry in T5 dispatch |
| T3↔T6 | ENGINE-B1 Migrations section | T3 rewrites; T6 adds dispositions | consistent |
| T5↔T6 | owner-signoff Q summaries | T5 updates; T6 open items | consistent |
| T1 self | test expected to pass already (pins behaviour) | ok |
| T2 self | git summary must be deterministic incl. Node 18.19 | step 3 checks before regenerating | ok |
| T3 self | removes b2 tests — must replace, not delete | stated | ok |
| T4 self | stdout call convention "whatever it is" | implementer reads observe.mjs | ok |
| T5 self | doc task with self-check | ok |
| T6 self | clean clone /tmp/ht-rc3b | ok |
Ruling (pre-flight): T5 also replaces every map reference to expected/b2 / writeB2 with the T3 composition + interaction model — T3 removes them; the map must not describe a mechanism that no longer exists — if wrong: one doc pass.

## Progress
Task 1: dispatched (base 75151e5, sonnet)
Task 1: implementer DONE (79821a9): 582 tests, differing 0, check 0 (coverage/inventory not run — change cannot affect them: manifest untracked only); review dispatched (sonnet)
Task 1: ⚠️ resolved by controller: only fault-capture-stage-locked has an untracked entry (grep); coverage/inventory unaffected by a manifest untracked entry (run in Task 6 clean clone)
Task 1: minor (deferred): runner test path match unanchored (brief asked path-only)
Task 1: complete (commits 75151e5..79821a9, review clean)
Task 2: dispatched (base 79821a9, opus)
Task 2: implementer DONE (aa8630d): digests + deterministic git summary (2× Node 24 + Node 18.19 identical); only 3 changes.txt goldens changed; also runner.test format asserts + before-entry-symlink assert.json; map lines 20/1010 old wording → T5; review dispatched (opus)
Task 2: review r0: 1 Important (CASES.md:170 claims a commit always shows as M — reproduced: later commits on an existing ref leave no line) + ⚠️ git-dir digest encodes top-level entry names that vary by git version (host-dependence risk) + minors (f: hashes raw bytes pre-scrub; l: targets verbatim; CASES.md:172 stale bullet; packed-refs names missed; space-in-path ambiguity; temp dir leaks)
Task 2: Ruling: replace the git-dir summary with a git-plumbing summary run read-only against the collapsed dir: per ref (for-each-ref, covers packed refs) its name, `rev-list --count` and the tip tree listing `ls-tree -r` (paths + blob ids — content-addressed, so deterministic; commit ids/times excluded) plus HEAD's symbolic target — observes repeat commits and committed content, independent of git's version-specific top-level files — if git is unavailable the digest is `g:unavailable` (stated) — cost if wrong: the observer spawns git per collapsed dir (one case today)
Task 2: fix round 1 implemented (6d7e8d2): plumbing git summary, scrubbed f: digests; determinism 2× Node 24 + Node 18.19; only cov-capture-sync changes.txt changed; 590/590; re-review dispatched (opus)
Task 2: fix round 1/5 (6 addressed, 0 open — plumbing git summary, scrubbed f: digests, docs accurate, packed refs, temp cleanup; commits aa8630d..6d7e8d2)
Task 2: minor (deferred): TextDecoder default ignoreBOM:false strips a leading BOM before hashing (BOM add/remove unobserved — use ignoreBOM:true); two test git calls not env-isolated; committed blob bytes unscrubbed (a future commit embedding a sandbox path/time would destabilise g:); only Apple git exercised
Task 2: complete (commits 79821a9..6d7e8d2, review clean)
Task 3: dispatched (base 6d7e8d2, opus)
Task 3: implementer DONE (928f6ba): repro A/D RED→GREEN; b2 surface removed; 606/606; check 0; interaction 'no change' check only on non-conflict paths; write-interaction records conflicted paths; interactions must name every conflicting migration; write records the whole exit vector; review dispatched (opus)
Task 3: review r0: 1 Important (interaction overrides single-declarer paths/exits without naming the owner — stale interaction or wrong names pass; write-interaction records any differing path under the interaction's reason) + minors (3-way exit conflict drops a same-valued declarer from owners; write-interaction accepts reason <40; interaction not tied to its case; conflicted cases not replayed)
Task 3: ⚠️ resolved by controller: in the entry-guard+writer scenario writer alone cannot declare before-entry-symlink (no diff in isolation → refused), so the rule is "at least one named migration declares the case", not "all"
Task 3: Ruling: every owned key (path or exit:<i>, conflicted or single-declarer) an interaction touches must have all its owners named in interaction.migrations; un-owned paths stay allowed; write-interaction records only conflicted paths and un-owned paths whose difference it is asked for, never a single-declarer path whose owner is unnamed; at least one named migration must declare the case — closes the stale/wrong-name override without rejecting the legitimate stamped-line interaction — if wrong: an interaction must list one more migration
Task 3: fix round 1 implemented (a568283): 612/612, check 0; re-review dispatched (opus)
Task 3: fix round 1/5 (4 addressed, 0 open — interaction must name every owner of keys it overrides; one named migration declares the case; write-interaction scope + short reason; 3-way exit owners; commits 928f6ba..a568283)
Task 3: minor (deferred): composeExpected/writeInteraction docstrings stale (owners return; new refusals); registry message prefix ${c}: vs ${L}:; no subset modes run; conflicted cases not replayed until an interaction exists
Task 3: complete (commits 6d7e8d2..a568283, review clean)
Task 4: dispatched (base a568283, sonnet)
Task 4: implementer DONE (2f834ad): 613/613, no golden change; review dispatched (sonnet)
Task 4: ⚠️ resolved by controller: commit stat touches no golden
Task 4: minor (deferred): named-async test passes on old regex (no RED); async node:internal / async <anonymous> lack direct tests; comment slightly overstates
Task 4: complete (commits a568283..2f834ad, review clean)
Task 5: dispatched (base 2f834ad, opus)
Task 5: implementer DONE_WITH_CONCERNS (fa57d4d): 11 obligations (10 required); proposed required items 22 report-conflicts, 23 role-dollars, 24 report-revision; Q1 split required/optional; 2 proposed before-cases not yet built (Plan 4); stale Linux-stdio wording in CASES.md:179 + replay/preload.mjs:25 → Task 6; review dispatched (opus)
Task 5: review r0: 2 Important (O1 pinning claim false — cov-reports-ledger s-a2 null dispatch tokens summed as 0; D1 says rescue release IS the none path — spec §18.5 = B1 build + mixed reader) + minors (restamp manifestRevision preservation labelled as spec text; mtime-as-revision interpretation as ruling; module.json-without-archive edge); all sent to round 1
Task 5: fix round 1 implemented (5ba6010): new Q11b; re-review dispatched (sonnet — scoped doc re-review)
Task 5: fix round 1/5 (5 addressed, 0 open — cov-reports-ledger pins O1 reader half; rescue = writer half + mixed reader; Q15b/Q10c labels; module.json-without-archive edge + Q11b; commits fa57d4d..5ba6010)
Task 5: minor (deferred): two proposed before-cases (before-report-unknowns, before-ratio-revisions) to build in Plan 4; unknown-count reader work assigned to item 4 (owner may read item 4 as capture-only); D1 wrapped line formatting
Task 5: complete (commits 2f834ad..5ba6010, review clean)
Task 6: Ruling: Task 6 also corrects the stale "Linux pipes are synchronous" wording in corpus/CASES.md:179 and the replay/preload.mjs:25 comment to Node's documented semantics (pipes async on POSIX, sync on Windows; output may be lost if process.exit() precedes an async write) — map R17 already says this; leaving the repo contradicting itself is worse — if wrong: two sentences
Task 6: dispatched (base 5ba6010, sonnet)
Task 6: implementer DONE (ff73fb6, tag v0.2.1-rc.2): Node 18.19 613/613, differing 0, check 0; clean clone all 5 gates exit 0, status empty; review dispatched (sonnet)
Task 6: minor (deferred): ENGINE-B1 "O1–O11" though O11 is non-binding; P3-12 row says fixed by removal (writeDeclared records the full exit vector — Task 3 adversarial 10)
Task 6: complete (commits 5ba6010..ff73fb6, review clean; tag v0.2.1-rc.2 @ff73fb6)
Final review: dispatched (75151e5..ff73fb6, opus)
Final review: opus agent terminated by spend limit (429); user said 'continue' → resumed the same opus agent (no model switch)
Final review: With fixes — 1 Important (write-interaction records every un-owned differing path, discarding hand-written changed/removed — recorder supplies authority) + minors (path named exit:0 collides with exit keys — reproduced; dir with HEAD+objects that git rejects hides its contents as g:unavailable — reproduced; one git failure loses the whole summary; digest assumes SHA-1 repos (undocumented); map O4 "missing archive → unverified" stated as spec); deferred triage: fix now T1 anchor, T2 BOM + test git env, T3 docstrings + message prefix, T4 async tests, T5 D1 wrap, T6 wording; Ubuntu-git run required before Plan 4 (no Linux git here → owner/CI item); all rulings agreed (T3 recorder wording not implemented as ruled)
Final: Ruling: fix wave on sonnet 5.5 (precise, bounded fixes; opus spend limit just hit) with an opus scoped re-review of the harness — if wrong: one more round on the residuals
Final: fix wave dispatched (base ff73fb6, sonnet)
Final: fix wave (ff73fb6..1cc6690, 2 commits): A1–A3, B1–B7, C1–C3 done; 619/619 (Node 24 + 18.19), differing 0, check 0, inventory/coverage clean; scoped re-review dispatched (opus)
Final: re-review — all 13 items ADDRESSED, no new Critical/Important
Final: parked — MIGRATION-MAP.md:907, :940 still state "unverified on a missing archive" without the Q11b proposal mark (O4 row is marked) — Ruling: doc residue, Plan 4 Task 1 — if wrong: none
Final: parked — write-interaction silently drops a hand-listed key that shows no difference (vacuous rule; no hint to the author); corpus/README.md lacks the exit:<i> path ban (the _interactions README has it) — Ruling: Plan 4 Task 1 polish — if wrong: none
Final: parked — on a host without git, git dirs are walked as files (index/objects carry ids/mtimes) → changes.txt could vary; corpus cases creating repos need git anyway — Ruling: state git as a host precondition in Plan 4 Task 1 docs — if wrong: a confusing diff on a git-less host
Final: parked — Ubuntu/Linux-git evidence for cov-capture-sync and the whole matrix still missing (no remote, no Linux git here) — Ruling: owner/CI item before Plan 4 lands migrations — if wrong: a red Ubuntu leg discovered later
Final: Ruling: tag v0.2.1-rc.2 moved (local, unpushed) from ff73fb6 to the ledger commit after the fix wave — candidate must include final-review fixes — if wrong: none
