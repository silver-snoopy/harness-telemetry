# SDD ledger — plan: ~/dev/harness-telemetry/docs/plans/plan-5.md
Spec: docs/spec.md (v4.2). Start: main @ e9954e1 (after v0.3.0 60d8982). Work on main (unpushed; owner "go with plan 5" 2026-10-15). Models per plan Global Constraints.

## Pre-flight scan
| pair / task | produces → consumes | finding |
|---|---|---|
| T2→T3 | baselineFiles, readEngineJson → installCopy | consistent |
| T3→T4,T7,T10,T11 | hermetic copy → spawned-hook tests | consistent |
| T4↔T7 | T4 reads settings.engine; T7 writes it last | T4 test (b) hand-writes settings: a present settings.json must name `extension` (config.mjs:100) → write `extension: null` |
| T4↔T10 | T4 "gate first"; T10 "fired record before gate" | conflict → Ruling R1 |
| T5→T6→T7 | form → takeCheckpoint(form, wrappers) ← T7 planner | T6 lands before T7: T6 tests pass `wrappers` explicitly; T7 supplies them |
| T7↔T8 | T7 step 8 is the git-hook slot | T7 leaves the slot (no-op unless --git-hook already supported); T8 fills it |
| T9↔T10 | doctor --probe stub → real | consistent |
| T10→config | TOKENOMICS_STATE_DIR in telemetryDir | unset in replay → no corpus effect; T10 (i) asserts |
| T1 | self | content-scrub audit may hit a corpus literal → ruling at the time, never a golden edit |
| T2 | self | npm `files` "minus excluded subtrees" → negation patterns (`!tokenomics/**/*.test.mjs` etc.), verified by `npm pack --dry-run` |
| T7 | self | fresh settings `receipts: TA defaults` with `dir: tokenomics` → Ruling R2 |
| T9 | self | "crash window" for flat-record claims undefined → Ruling R3 |
| T11 | self | consistent (python3 required, never skipped) |

Ruling R1: the probe's fired record is written before the activation gate (Task 10 amends Task 4's "first") — §14.9 "records … before doing anything else"; an inert hook must still prove it fired — if wrong, one line moves
Ruling R2: a standalone fresh settings.json keeps the TA receipt defaults (root .agents/automation …) — spec gives no standalone receipt default and receipts are C1 glue — if wrong, a default change in Task 7
Ruling R3: the claim crash window is the engine's existing claim-staleness constant if one exists, else 10 minutes, named in doctor output — spec silent — if wrong, a constant
Task 1: dispatched (base e9954e1, sonnet)
Task 1: implementer agent aac532b92ef3dd8ee
Ruling R4 (owner asked to speed up, 2026-10-15): per-task gates = npm test (N24+N18), diff-impl, coverage, inventory; full migrations check (both Node) only for Tasks 1, 2, 4, 10, any task whose diff touches replay/, tokenomics/hooks/, tokenomics/engine/{config,migrations,manifest,version,entry}.mjs, scripts/migrations.mjs or corpus/, and at close; run in background off the critical path — B3 adds no migration and the gate is source-ungated — if wrong, a regression surfaces one task late (rework)
Ruling R5: independent tasks run in parallel worktrees and merge into main in task order (T1∥T2, T5∥T6, T8∥T9); reviews pipeline with the next implementer — if wrong, merge conflicts in shared files (allowlist, ENGINE-B1, install-hooks) cost a resolution step
Task 2: dispatched (base e9954e1, sonnet, worktree, parallel with Task 1)
Task 2: implementer agent ad07002b0c69ec043 (worktree)
Ruling R6 (owner, 2026-10-15: "do all the validations regarding migration once … fixing bugs in batch"; supersedes R4): per-task gates = npm test, diff-impl, coverage, inventory on Node 24 only. migrations check + Node 18.19 full gates run as ONE batch after Task 10 (before the Task 11 gate test), bugs fixed in one batch round, then again at close from clean clones. diff-impl stays per task (cheap; it replays the whole corpus and guards the off path) — if wrong, a Node-18 or declared-diff regression surfaces at the batch point and is fixed there
Task 2: implementer DONE (216d307 on worktree branch; 898 tests N24; diff-impl 0)
Task 2: review dispatched (sonnet, a5bca944d43e7082f)
Task 3: dispatched (base 216d307 = T2 branch, sonnet, worktree; pipelined with T2 review)
Task 3: implementer agent a0ac2bd5a603d8c4d (worktree, branch plan5-task-3)
Task 2: review — Spec ✅ / Approved; 6 minor. Routed to Task 3 (in flight): bin imports replay/runner.mjs excluded by `files`; LICENSE listed but absent. Deferred → final fix wave: stale package.json test title/var, engine-manifest write-mode silent 0.4.0 fallback, SKILL.md activation/doctor command text (Tasks 7/9/11 rewrite it), allowlist version-pin reason
Task 2: complete (216d307, merge to main after Task 1)
Task 1: implementer DONE_WITH_CONCERNS (3ecbaa3; 893 N24; diff-impl 0; audit: no corpus token hits); review dispatched (sonnet, a1dde75c9f6837d4f)
Merged to main: 3ecbaa3 (T1), dc63f4b (T2 cherry-pick of 216d307), 3eb96fb (test runner skips .claude/ worktrees), then ENGINE.json refresh; main 5dd5c06: 904/904, diff-impl 0
Ruling R7: every merge of parallel work regenerates tokenomics/ENGINE.json (node scripts/engine-manifest.mjs) in its own chore commit — the baseline hashes every engine file, so parallel branches always conflict on it — cost: none beyond a commit
Task 5 + Task 6: dispatched in parallel (base 5dd5c06, opus, worktrees) — new modules substrate.mjs / checkpoint.mjs; T4 waits for T3
Task 1: review — Spec ✅ / Needs fixes: I1 scrub-token refusal misses event stdout/stderr and changes.txt f: digests (ledger 238 still open there); I2 ENGINE-B1 "closed in B3" overclaims → fix round 1 (resumed aac532b92ef3dd8ee, on main)
Task 3: implementer DONE (80ebe31, cherry-picked to main as 93c02b2); tests written after code (TDD not observed — noted for review); concerns: standalone scope-hook prints "cannot load extension" (Task 4/7: settings extension null); `from` = unknown outside a git toplevel
Task 3: on main, 5 install-copy tests + npm pack test fail: npm writes ~/.npm (EACCES) — tests not hermetic → fix round 1 (resumed a0ac2bd5a603d8c4d, on main)
Task 3: fix 1 committed 4efa4da → main 97db413; hermetic tests 18/18 without npm_config_cache. Review dispatched (sonnet). Task 4: dispatched (base 97db413, opus, worktree)
Task 3 review agent aa1db133a499170b4; Task 4 implementer ac47519145d59774f (worktree); Task 5 implementer a66847e3c21a448ef; Task 6 implementer a3462c1ce0dff0860
Task 3: review — Spec ✅ / Approved; minors deferred → final fix wave: (h) checks output only not exit status; upgrade = two renames, a crash between leaves dest absent + a temp sibling with SKILL.md (host could discover a duplicate skill) — put temp siblings outside skill dirs or under a dot-name
Task 3: complete (93c02b2, 97db413)
Task 5: implementer DONE (f4be182 → main 94d3575; 914 N24; diff-impl 0); concerns: main() still exits 0 after substrate failure (stop is Task 7), mis-verified existing submodule throws (no repair), extra opts env/seed. Review dispatched (sonnet, aed639fe36a0f0d25)
Housekeeping: disk hit 100% once (other processes; 6.9 GB free now) — removed merged worktrees (T2, T3)
Task 5: review — Spec ✅ / Needs fixes: I1 --plain-folder over a registered, mis-verified submodule returns plain-folder while verify keeps failing → fix round 1 (resumed a66847e3c21a448ef)
Ruling R8: --plain-folder with a registered/materialised submodule at .agents/telemetry throws submodule-registered (repair or deregister first) — spec §2 never chooses plain silently, and two forms at one path cannot verify — if wrong, an operator must run one git command before choosing plain
Task 5: fix 1 084ed7c → main 1b00ef6 (+ 64602ee baseline); focused 36/36
Task 1: fix 1 51c4aba on main (914 N24, diff-impl 0, no corpus token hits)
Tasks 1+5: scoped re-review dispatched (sonnet, a22015beca9d73e16)
Task 1: re-review ADDRESSED, approved; minors (dead line in entry.test.mjs, weak >=3 assertion, blob ids in git-dir summaries unchecked) → final fix wave
Task 1: complete (3ecbaa3, 51c4aba)
Task 5: re-review ADDRESSED, approved; left to Task 7: undo `git rm --cached` on later failure, stop main() on substrate failure, record substrate.form
Task 5: complete (94d3575, 1b00ef6)
Task 6: implementer DONE (8796c18 → main a6efcc2; 913 N24; diff-impl 0); concerns: stale gitlink after checkpoint commit (Task 7 re-stage), store index reset, extra env opt, unused settings param, plain-folder record lives only in the commit. Review dispatched (opus — data safety, a6758129a3418ad3e)
Task 6: review — Spec ✅ / Needs fixes: I1 existing bundle silently overwritten when its tag is gone (last copy of a checkpoint) → fix round 1 (resumed a3462c1ce0dff0860, on main)
Ruling R9: tag absent + bundle present → CheckpointError checkpoint-bundle-orphaned, never write; remedy: restore tag from bundle or move bundle aside — §18.5 recoverability outranks convenience — if wrong, an operator moves one file
Task 6: original implementer not resumable (worktree removed early) → fresh fix implementer (sonnet, aec8e47124d401672, on main). Lesson: keep a worktree until its task is complete
Task 6: fix 1 83a626f (checkpoint-bundle-orphaned before any write; test e2 red→green; 20/20). Controller-verified diff (4-line guard ahead of the write path) in place of a re-review agent — Ruling R10: fixes of ≤10 changed code lines with a red→green test are verified by the controller reading the diff — saves a review seat; cost if wrong: the final whole-branch review catches it
Task 6: complete (a6efcc2, 83a626f); minors → final fix wave per task-6-review.md
Task 4: implementer DONE (471dd65 → main ea50a1f after ENGINE.json conflict resolve + regen; main 944/944, inventory 0, diff-impl 0); concerns: empty TOKENOMICS_MIGRATIONS counts as refused (migrations.mjs treats empty as unset); gated work-scope exits 0; unactivated standalone `work-scope list` exits 1 on default TA extension; entryPointsOn helper; ensureSink(repo)
Ruling R11: an empty TOKENOMICS_MIGRATIONS is unset for the gate too (matches enabledMigrations) — one reading of the variable everywhere — if wrong, a one-line change
Task 4: review dispatched (opus). Task 7 (opus) + Task 9 (sonnet) dispatched in parallel worktrees from ea50a1f
Agents: T4 review a46012bafce28ded7; T7 implementer a716228f6836c747e (worktree); T9 implementer a2aad171d4ee11a80 (worktree); T4 implementer worktree kept for fix round (ac47519145d59774f)
Task 4: review — Spec ✅ / Needs fixes: R11 empty-var item; I1 MIGRATION-MAP "As landed" overclaims — export/batch-cost/team-report/read-only work-scope in an installed copy still honour TOKENOMICS_MIGRATIONS=none (export writes the store with writer off, §18.5) → fix round 1 (resumed ac47519145d59774f)
Ruling R12: production switch refusal lives in enabledMigrations for installed copies (ENGINE.json installed set), covering every entry; gated writers keep exit 0 + stderr via gateOrExplain, other scripts exit 1 — Q3 set {} must hold for every entry, not four — if wrong, a report script refuses where a harness user wanted a switch (they use the source checkout)
Task 4: fix 1 8c1b774 → main 340e58e (946 N24, diff-impl 0); controller read the core (enabledMigrations refusal, 20 lines) + test list — exceeds R10's 10 lines; accepted on red→green spawned tests for every named entry, final review re-checks
Task 4: complete (ea50a1f, 340e58e); deferred → final fix wave: non-hook refusal prints a stack trace (catch → one line); unreadable ENGINE.json reads as not-installed in migrations.mjs (reports would honour the switch; gated writers are inert); mid-file import in migrations.mjs; install-hooks.mjs:604 sink without repo (Task 7); no test for capture outside repo → sink
Task 9: implementer DONE (3e82b7f → main 08799ab after allowlist + ENGINE.json conflict resolve; main 960/960, inventory 0, diff-impl 0); assumptions: no claim-staleness constant → 10 min (R3); stale-claim warn on every .claim; fail checks apply only with an installed copy. Review dispatched (sonnet)
Task 9: review — Spec ✅ / Approved; minors → final fix wave: dangling symlink in a copy aborts doctor (hash read throws); with the switch set, `settings` fails and skips substrate/targets/claims (pass loadSettings an env without the var); alias test covers only --json; dropped copilot-hook warn; doctor --fix starts the sink (opt-in write)
Task 9: complete (08799ab)
Task 7: implementer DONE (7e4dcff on ea50a1f; 961 N24; diff-impl 0); cherry-pick onto 08799ab conflicts (install-hooks main/doctor vs Task 9 alias, ENGINE-B1, ENGINE.json) → aborted; implementer rebases onto 08799ab (resumed a716228f6836c747e) + makes re-run a true no-op (skip identical writes, mtimes unchanged)
Task 7: rebased 5e38bed on 08799ab, fast-forwarded main (977 N24, diff-impl 0); re-run no-op with mtimes. Review dispatched (opus)
Task 8 (sonnet) + Task 10 (opus) dispatched in parallel worktrees from 5e38bed; pipelined with Task 7 review
Agents: T7 review a433c9a4e9c54e6b2; T8 implementer a2306cea94f8d89ee (worktree); T10 implementer a74ba71b44c6182a2 (worktree); T7 implementer worktree kept for fix round (a716228f6836c747e)
Task 7: review — Spec ✅ / Approved (7 minor); ⚠️ reference-era repo (automation/ store, no settings) gets dir tokenomics on first activation → stops reading automation/ history
Ruling R13: fresh settings without --dir default to an existing module dir holding a usage-*.jsonl ledger (one → it; several incl. automation → automation; several without → usage error); else tokenomics — the owner's projects carry reference-era automation/ ledgers (B4 shadow run starts there) — if wrong, an operator passes --dir → fix round 1 (resumed a716228f6836c747e)
Task 8: implementer DONE (1db1f88, ff main; 985 N24, diff-impl 0); concerns: absolute node/script paths in hook; --remove also restores post-commit; refuses if .pre-tokenomics exists. Review dispatched (sonnet)
Task 8: review — Spec ✅ / Needs fixes: I1 detached sweep inherits GIT_INDEX_FILE/GIT_DIR from the post-commit env → syncTelemetry can commit onto the user's worktree branch and switch it (reviewer reproduced) → fix round 1 (resumed a2306cea94f8d89ee): unset git env in hook + worktree sync test; minors taken: --remove with --git-hook, node-missing log line
Task 7: fix 1 96f966b ff main (989 N24, diff-impl 0): R13 + minors 1,2,4,7; concern: R13 misses an unmaterialised store (clone without --recurse-submodules) → fix 1b (resumed a716228f6836c747e); Task 8 fix told to rebase onto 96f966b
Task 10: implementer DONE (75e58f4 → main 1f8fe8b, ENGINE.json regen; main 1004/1004, inventory 0, diff-impl 0); concerns: fixed doctor isMain via symlinked path; real `claude -p` may not run work-scope (scope stamp missing) — maybe --allowedTools; fired `event` = entry+mode; every wired event reported; new `--ended` sweep flag; TOKENOMICS_NO_SINK added to probe env; Copilot fake only
Ruling R14: keep the D-PROBE Claude command for now; decide `--allowedTools` on the real-probe evidence at close (Task 12 step 5) — granting tool permissions in an operator's repo is a cost to justify by evidence — if wrong, one flag in Task 12
Task 10: review dispatched (opus)
Tasks 7 fix 1b and 8 fix 1 must rebase onto 1f8fe8b
Task 10: review — Spec ❌ / Needs fixes: I1 sweep-only fallback runs after timeout (breaks bound; hung host reads partial, exit 0; reviewer reproduced) → fix round 1 (resumed a74ba71b44c6182a2)
Task 7: fix 1b b0f67c6 ff main (1005 N24, diff-impl 0): R13 reads telemetry / origin/telemetry / store HEAD when disk is empty. Fix 1 + 1b controller-verified via red→green tests; Task 7: complete (5e38bed, 96f966b, b0f67c6); minors 3,5,6 → final wave
Task 8: fix 1 915fdf3 → main b678716 (test-file conflict with T7 fix 1b resolved: both tests kept); unset git env + worktree sync test + node-missing log + --remove with --host; controller-verified red→green; Task 8: complete (1db1f88, b678716); minors (shared hooks dir points at one repo, late backup-exists refusal) → final wave
Task 8: duplicate rebase 49ef8be (tree-identical to b678716) — ignored
Task 10: fix 1 c083fb4 → main 3a82d58 (1009 N24, diff-impl 0, inventory 0); timeout → no fallback, bounded fallback, partial names missing scope/events; minors M2-5,M7 fixed; M1 (nonce-matched ledger line), M6, M8, M9 → final wave. Accepted on red→green tests; final review re-checks
Task 10: complete (1f8fe8b, 3a82d58)
Batch validation (R6): started at 3a82d58 — clean clones, Node 24 + Node 18.19: npm test, coverage, inventory, diff-impl, migrations check
Task 11: dispatched (base 3a82d58, sonnet, on main; batch validation runs in clones in parallel)
Task 11: implementer DONE (c664953 substrate fix: clone submodule from repo path so an unreachable origin cannot fail it; cf2cdb2 gate test; 1019 N24, diff-impl 0); install --target copilot-cli alias; wiring script identical before/after in every variant. Review dispatched (sonnet)
Task 11: review — Spec ✅ / Approved; verbatim files match 50615f1; minors → final wave: runDoc splits on whitespace (spaced temp path), .gitmodules keeps absolute path if the substrate step throws between add and url reset, no proof the source checkout is unreachable after the package is deleted
Task 11: complete (c664953, cf2cdb2)
Batch validation (R6) at 3a82d58, clean clones: N24 npm test 1009/1009, coverage open 0 / replay problems 0, inventory 0, diff-impl 68/0, migrations 20×71 problems 1 (only:active-minutes cov-dispatch-batch: replay ENOTEMPTY removing the sandbox dir — cleanup race under load ~60); N18 npm test 1009/1009, coverage, inventory, diff-impl 68/0, migrations 20×71 problems 0
Ruling R15: the single N24 ENOTEMPTY is a sandbox-cleanup race under extreme load, not a declared-diff problem — 3 isolated re-runs of that mode clean, N18 clean on the same commit; logged for the final review (a child process writing into the sandbox after its event would be a real harness bug) and the close re-runs the full check from clean clones — if wrong, the close gate catches it
Batch validation: green (no fix round needed)
Task 12 step 5 (real probe, owner decision): throwaway clone of LeRisque @50615f1 in /private/tmp, origin removed, package = git archive cf2cdb2. Documented commands: install (51 files, not activated) → install-hooks --host claude --git-hook (submodule, checkpoint pre-engine-0.4.0 + bundle, manifest rev 1, post-commit, activated 0.4.0, Stop gate off) → doctor all ok (exit 0) → doctor --probe --host claude: result fired, mode hooks, events PreToolUse/SessionEnd/SessionStart/SubagentStop fired, ledgerLine present, scopeStamp present, 20.4 s. LeRisque _assert_hook_wiring.py exit 0, output byte-identical before/after. Repo store clean after probe. Clone deleted.
Ruling R14 resolved: no --allowedTools needed — the real probe stamped its scope with the D-PROBE command as fixed
Note for final review: after activation the store has module.json, manifests/1.json, config.json untracked (written after the checkpoint; committed by the next capture's sync) — no probe writes reached the store (no usage-*.jsonl)
Task 12 step 1: docs ac119ec (spec As-implemented notes, README install, ENGINE-B1 B3 chapter, ledger copy; 1019 N24)
Task 12 step 2: close gates running on ac119ec (clean clones N24+N18). Step 4: Codex milestone review running (v0.3.0..ac119ec). Final whole-branch review (opus) dispatched in parallel on the same commit; one combined fix wave follows (owner speed-up, R6 spirit) — Ruling R16: Codex and the SDD final review run concurrently on ac119ec and feed ONE fix wave; tag v0.4.0-rc.1 after the fix wave — saves a full review/fix cycle; cost if wrong: findings overlap (deduplicated in the fix brief)
Final review (opus): Needs fix wave — 0 Critical, 3 Important, 16 Minor; deferred-minor dispositions + 10-step work list in final-review.md. I1 checkpoint commits ignored/live working files to the shared telemetry branch (then synced); I2 --local settings.local.json (may hold API keys) copied onto the telemetry branch; I3 probe's real host session is captured into the repo ledger by the next sweep (docs say isolated)
Ruling R17 (I3): capture skips sessions whose first prompt starts with "tokenomics hook probe <nonce>" (the probe prompt), keeping the docs' isolation claim true — the probe is a diagnostic, not work — if wrong, probe spend is unrecorded (cents)
Ruling R18 (I2): ignored or *.local.json main-tree files are snapshotted next to the bundle in the local git dir, never into the store — secrets never reach a pushed branch — if wrong, a restore needs one extra path
Waiting for Codex before the single combined fix wave (R16)
Codex B3 review (docs/reviews/b3-codex-review.md, committed): Not approvable — 6 Blockers (B3-01 gitDirSummary newline aliasing; B3-02 interim restore skips existing module dir; B3-03 probe expected result not matched by session; B3-04 probe event attribution by counting; B3-05 installed batch-cost/export not gated; B3-06 unreadable ENGINE.json → not installed), 3 Majors (B3-07 clone without recurse lacks local telemetry branch; B3-08 rollback resets operator index; B3-09 shared post-commit hook hardcodes one worktree), 2 Minors (B3-10 home paths in docs; B3-11 dangling symlink aborts doctor). npm test there 1014 pass / 1 EPERM (sandbox localhost) / 4 skipped; diff-impl + migrations green
Rulings R19–R24 (in fix-wave-brief.md): R19 every installed-copy CLI that writes under .agents/ or receipts is gated (supersedes M16 park); R20 gitDirSummary escapes only control-char/backslash paths (no golden churn); R21 fired record carries the host event name, unnamed → unattributed never fired; R22 expected results matched by probe session identity; R23 post-commit hook resolves repo + engine at run time; R24 docs carry no home paths/session ids
Combined fix wave: 4 parallel lanes (A store opus, B probe opus, C gate/doctor/cli/git-hook sonnet, D hygiene sonnet then docs) per fix-wave-brief.md
Fix wave lanes dispatched from 689e438: A a083cc9a9434d5183 (opus), B a529a1c75f4d86355 (opus), C a3c8569b6ae83a4cf (sonnet), D a0de9eacf66ae704f (sonnet); worktrees kept until each lane completes
Close gates at ac119ec (clean clones): N24 1019/1019, coverage open 0, replay problems 0, inventory 0, diff-impl 68/0, migrations 20×71 problems 0; N18 identical. R15 case (only:active-minutes cov-dispatch-batch) clean in the full run
Lane D round 1: 1805af3 (B3-01 R20, T1-2), e5d7081 (T1-1, T2-1/2/3, T10-8, T11-1) ff main; 1023 N24, diff-impl 0 (no golden change)
Lane C: 3 commits (install copy M6 M7 T3-1 T3-4 T3-7; doctor M1 M2 M3 T9-1/B3-11 T9-6; gate R19/B3-05, M4, M5/B3-06, R23/B3-09) cherry-picked
Trailer fix: lane C and lane D commits carried "Claude Sonnet 5.5" (session attribution) instead of the handoff's required Opus 5.5 trailer — main rewritten from 689e438 (unpushed, no tag in range) with corrected trailers, tree identical: bf7a664, 5f3037c, 2eadea4, 9b13e9a, 7b43746. Lanes A/B must rebase onto 7b43746 and use the Opus trailer
Lane C concerns accepted: linked worktree without its own copy sweeps via the primary copy (idempotent capture); sed reads "engine" from settings (one-line JSON written by the installer); read-only team-report/otel-report stay ungated (no writes)
Lane B: d61f981 ff main (I3/R17, B3-03/R22, B3-04/R21; 1045 N24, diff-impl 0); concern: Copilot payload has no event name and sessionStart/sessionEnd share one command → sessionEnd unattributed → copilot-cli probe can never pass (gate test case changed to expect that)
Ruling R25: installCopilot sets TOKENOMICS_HOOK_EVENT=<event> in each hook's env (it already sets COPILOT_CLI=1 there) and the fired record reads it — our own generated config, outside the corpus and outside LeRisque's wiring test (which polices .claude/hooks only); restores a passing copilot-cli gate case — if wrong, one env key → lane B follow-up (resumed a529a1c75f4d86355)
Lane B R25: a9e65d8 ff main (TOKENOMICS_HOOK_EVENT in Copilot hook env; copilot-cli gate expects fired; 1046 N24, diff-impl 0). Lane B complete
Lane A: 7 commits ff main (0a6fd94 I1; 2c3bbd3 I2; 743a8ca B3-02; eff30a7 B3-07; 5bcf136 B3-08 T11-2; b82eb2d M11 T6-2/3/4; 04a783a M8 M9 M10 M12 T7-5 T7-6); 1064 N24, coverage 0, inventory 0, diff-impl 0. Concerns: docs (→ lane D round 2); interim merge rule (stash extends store → replace, else refuse); git-hook pre-check duplicates lane C's backup-exists condition; reference-era store without the seeded inner .gitignore → sync add -A still commits live/ files; 0a6fd94's ENGINE.json stale at that commit (HEAD current)
Ruling R26: activation ensures an existing store's inner .gitignore carries the working-state patterns (markers, live/) — idempotent append, committed in the activation store commit — closes I1 for reference-era stores whose sync uses add -A — if wrong, one file line → lane A follow-up
Lane D round 2 (docs) dispatched (resumed a0de9eacf66ae704f); lane A R26 follow-up in flight

Lane D round 2: 9b3330b ff main (docs + R24 scrub of plan-5.md and ledger copy). Older plan-1..4 docs still carry home paths — parked (pre-B3, outside B3-10's scope; owner-private repo)
Lane A R26: 516f669 cherry-picked → main 616f14d (Opus trailer; ENGINE.json regen unchanged; 1065 N24, diff-impl 0 in the lane). R26 wording in SKILL.md, spec §18.5 note and ENGINE-B1 activation step 7 matches the code. Lane A complete. All fix-wave worktrees and branches removed
Close gates at 616f14d (clean clones): N24 1065/1065, coverage open 0 / replay problems 0, inventory 371 sites unassigned 0 / engine 116 unlisted 0, diff-impl 68/0, migrations 20×71 problems 0. N18: 1064/1065 — git fallback (d) ENOTEMPTY in sandbox cleanup (deterministic, 3/3); coverage, inventory, diff-impl 68/0, migrations 20×71 problems 0 identical to N24
Close fix: the test's direct `sh post-commit` run spawned a second detached sweep that re-created .agents/telemetry/ in the repo after teardown removed it (test-only race; the hook itself behaved as specified). Tests (d) and (e) give their direct runs a no-op `node` shim, the pattern test (f) uses → 3857560 (git fallback 13/13 ×3 on N18)
Close gates at 3857560 (test-only change since 616f14d; clean clones): N24 1065/1065, N18 1065/1065 (includes the B3 gate test). Coverage, inventory, diff-impl and migrations carried from 616f14d (no code or corpus change)
Fix wave complete; tag v0.4.0-rc.1 (R16)

## Final review: deferred minors and noted items, with dispositions

Source: the Plan 5 final review, section 3. (a) fix in the final wave, (b) acceptable as is, (c) park to the named
milestone. Two dispositions were changed by later rulings, and the rows below keep the original wording:

- T4-6 (report CLIs in an inert copy still write): fixed in the wave instead of parked to B4. Ruling R19 gates every
  writing report CLI (`batch-cost`, `build-tokenomics-export`, `team-report` with `--batch`/`--out`).
- T10-1 (probe result matched by host and time): fixed in the wave instead of parked to C2. Ruling R22 matches the
  expected ledger line and scope stamp by the probe session's identity.

Fix-wave record: lanes A to D and their rulings (R17 to R26) are listed above; the as-implemented behaviour is in
`tokenomics/SKILL.md`, `docs/spec.md` (14.2, 14.9, 18.5), `tokenomics/ENGINE-B1.md` (B3) and `docs/b2/MIGRATION-MAP.md`.

| id | item | disp. | reason / action |
|---|---|---|---|
| T1-1 | dead `s.writableNeedDrain;` line, `entry.test.mjs:149` | (a) | Delete it. |
| T1-2 | weak `>= 3` assertion (drained test) | (a) | Assert the exact count the test produces. |
| T1-3 | fixed 1500 ms wait in that test | (b) | It is bounded, and a spawned-child exit check cannot be event-driven here. |
| T1-4 | blob ids in git-dir summaries unchecked | (c) B4 | A replay-oracle hardening that the shadow run's comparator should own. No B3 path depends on it. |
| T1-5 | invalid-UTF-8 output skips the token check | (a) | One sentence in `corpus/README.md` (the bytes are hashed unscrubbed and cannot alias). |
| T1-6 | seeded files holding a literal token are refused | (b) | Intended strictness; 0 cases hit it. |
| T2-1 | stale "package.json" test title / `PKG` var (`version.test.mjs`) | (a) | Rename. |
| T2-2 | `engine-manifest.mjs` write mode silently defaults to `0.4.0` when `ENGINE.json` is unreadable | (a) | Fail with exit 1 when `ENGINE.json` exists but does not parse; keep the first-write default for ENOENT. |
| T2-3 | allowlist version-pin reason cites package.json | (a) | Edit the reason text (inventory counts unchanged). |
| T2-4 | SKILL.md command text, LICENSE entry, bin importing `replay/` | (b) | Resolved in Tasks 3, 7, 9 and 11. |
| T3-1 | (h) asserts output only, not exit status | (a) | Also assert `status === 0` for entries whose `--help` / no-op exit is 0. |
| T3-2 | upgrade is two renames; temp siblings carry `SKILL.md`; `rmSync(aside)` failure | (a) | = M6. |
| T3-3 | `--force` over a non-engine directory deletes it wholesale | (a) | One line in SKILL.md "Copy" and the README. |
| T3-4 | bin `--repo` without a value falls back to cwd; a non-InstallError throws a stack | (a) | Exit 2 on a missing value; catch, then one line and exit 1. |
| T3-5 | a downgrade reports `upgraded` | (c) B4 | Rollback rules (§18.5, B4) define what a downgrade copy may do. |
| T3-6 | parent-directory symlink not covered | (b) | The destination-symlink refusal is the specified check. |
| T3-7 | `installed` re-stamp on upgrade; "missing from installed copy" branch untested | (a) | Two assertions in `install-copy.test.mjs` (f). |
| T4-1 | non-hook refusal prints a stack trace | (a) | = M4 (reproduced). |
| T4-2 | unreadable `ENGINE.json` reads as not installed in `migrations.mjs`; mid-file import | (a) | = M5. |
| T4-3 | doctor `--fix` sink without repo | (a) | = M3. |
| T4-4 | no test for capture outside the repo, then the sink | (b) | `ensureSink(…, repo)` is one line, and the sink gate itself is tested. |
| T4-5 | read-only `work-scope list` test asserts by absence | (b) | Standalone settings now set `extension: null`; low value. |
| T4-6 | report CLIs in an **inert** copy still write (export, batch-cost) | (c) B4 | Spec §18.5 gates *hooks*; explicit report runs are operator actions. B4's shadow run fixes which report outputs a non-active engine may write. Document it now (M16). |
| T5-1 | `checkout` existing branch vs `-b` has no test | (b) | Reached only on a detached checkout with pending files; covered by reading. |
| T5-2 | partial `.git/modules` leftover after a failed `submodule add` | (c) B5 | Belongs with the sdlc-skills substrate and cache work; no data at risk. |
| T6-1 | failure leaves `.checkpoints/pre-engine-<v>` in the store | (a) | = M11. |
| T6-2 | reuse does not check that the tagged tree holds a checkpoint record | (a) | Refuse `checkpoint-foreign-tag` when `<tag>:.checkpoints/<tag>/checkpoint.json` is absent. |
| T6-3 | mixed reset supersedes staged-only store content (comment) | (a) | Extend the comment at `checkpoint.mjs:125`. |
| T6-4 | `run` inherits `GIT_DIR` / `GIT_INDEX_FILE` / `GIT_WORK_TREE` | (a) | Strip them in `run` (cheap, defensive; the hook path already unsets them). |
| T6-5 | test gap: plain-folder store tracked by the main repo | (c) B4 | The plain folder is a non-default form; B4's rollback tests exercise it. |
| T6-6 | load noise in an earlier run | (b) | Clean at close. |
| T7-2 | `already active` message wrong | (a) | = M8. |
| T7-3 | checkpoint does not hold the original settings bytes | (a) | = M9. |
| T7-5 | `--remove` pinned by a source regex; `--host … --update-manifest` untested | (a) | Two spawned tests. |
| T7-6 | no activation-level flat-era test | (a) | One test: flat files at the store root; the tag holds them at the root; after activation they are under `<dir>/`. |
| T8-2 | a shared hooks dir / common worktree hooks embed one repo's path | (a) | One bullet in SKILL.md "Git fallback" (ENGINE-B1 already says a moved repo needs a reinstall). |
| T8-4 | late `backup-exists` refusal | (a) | = M10. |
| T9-1 | a dangling symlink in a copy aborts doctor (`sha` throws) | (a) | Catch it in `checkIntegrity`: `<path>: unreadable (dangling link)`, which is a fail. |
| T9-2 | with the switch set, `settings` fails and skips the rest | (a) | = M2. |
| T9-3 | alias test covers only `--json` | (b) | The alias is a one-line delegation. |
| T9-4 | dropped copilot-hook warn | (b) | `targets` now fails on an unwired recorded host. |
| T9-5 | `doctor --fix` starts the sink | (b) | Opt-in and documented (plus M3). |
| T9-6 | `rawSettings` shallow merge drops defaulted `enforcement` keys | (a) | Deep-merge `enforcement` (and `substrate`) in `runChecks`. |
| T9-7 | a claim being written can read unreadable | (b) | The claim writer is atomic (rename); a transient failure is not observed. |
| T9-8 | allowlist keyed on line text | (c) B5 | Inventory re-keying is part of the B5 inventory and cache work. |
| T10-1 | expected ledger line matched by host and time, not by nonce | (c) C2 | Only a concurrent, ended session inside the 5 s window can satisfy it; C2's host verification ties the evidence to the session id. |
| T10-6 | hosts not found are reported `unavailable` rather than skipped | (b) | More informative; documented. |
| T10-8 | capture message says `→ .agents/telemetry/...` during a probe | (a) | Print the resolved `telemetryDir`. |
| T10-9 | the probe's start sweep re-meters history in the state dir | (b) | Time only (see Declined to judge). |
| T11-1 | `runDoc` splits on whitespace (breaks on a spaced temp path) | (a) | Fail fast if the temp root contains whitespace, or substitute into an argv after splitting. |
| T11-2 | `.gitmodules` keeps the absolute path if a step between `add` and the url reset throws | (a) | In `ensureSubstrate`'s catch, when this run registered the submodule: reset `.gitmodules` from HEAD (or remove the section) and unstage. |
| T11-3 | no proof that the source checkout is unreachable after the package is deleted | (b) | The gate's PATH and package deletion already make reuse impossible in practice. |
| R15 | N24 ENOTEMPTY in `only:active-minutes cov-dispatch-batch` | (c) B4 | No B3 code on that case's path spawns a detached child: `ensureSink` is otel-only, and `recordFired` and the gate are synchronous. Retries in `replay/sandbox.mjs` would hide the signal R15 wants. B4's shadow run re-runs the full check repeatedly; investigate there, and keep the close gate from clean clones. |
| note | `module.json` / `manifests/1.json` / `config.json` untracked until the next sync | (a) | = M12. |
| note | the probe leaves the store clean (real-probe evidence) | — | True only until the next sweep; see I3. |

## Codex B3 milestone review: dispositions

Source: `docs/reviews/b3-codex-review.md` (verdict on `v0.3.0..ac119ec`: Not approvable). Every finding was fixed in the
combined fix wave (R16); each fix commit names the test that reproduces the finding (red, then green).

| ID | Severity | Finding | Ruling | Fix commit(s) |
|---|---|---|---|---|
| B3-01 | Blocker | `gitDirSummary` newline path aliasing | R20 | bf7a664 |
| B3-02 | Blocker | interim restore skips an existing module directory | — | 743a8ca |
| B3-03 | Blocker | probe expected results not matched by session | R22 | d61f981 |
| B3-04 | Blocker | probe event attribution by counting | R21, R25 | d61f981, a9e65d8 |
| B3-05 | Blocker | installed `batch-cost` / export not gated | R19 | 7b43746 |
| B3-06 | Blocker | unreadable `ENGINE.json` reads as not installed | — | 7b43746 |
| B3-07 | Major | clone without `--recurse-submodules` lacks a local `telemetry` branch | — | eff30a7 |
| B3-08 | Major | failed conversion rollback resets the operator's index | — | 5bcf136 |
| B3-09 | Major | shared post-commit hook hardcodes one worktree | R23 | 7b43746 |
| B3-10 | Minor | home paths in docs | R24 | 9b3330b (plan-1..4 docs predate B3; parked) |
| B3-11 | Minor | dangling symlink aborts doctor | — | 9b13e9a |

Final review Important findings: I1 0a6fd94 + 616f14d (R26), I2 2c3bbd3 (R18), I3 d61f981 (R17).
