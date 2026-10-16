# SDD ledger — plan: ~/dev/sdlc-skills/docs/superpowers/plans/2026-10-11-harness-telemetry-plan-4-b2-migrations.md

Spec: ~/dev/harness-telemetry/docs/spec.md (v4.2) + docs/b2/MIGRATION-MAP.md. Start: main @ bb3b8c1. Work on main (unpushed repo; owner ruling from Plans 1–3, "go" 2026-10-11). Models per plan Global Constraints.

## Pre-flight conflict scan
| tasks | shared file/interface | produced vs consumed | finding |
|---|---|---|---|
| T1↔T2 | replay/runner.mjs | T1 null-proto file maps; T2 changes.txt record format | consistent (different parts) |
| T1↔T3 | scripts/migrations.mjs registryProblems | T1 Object.hasOwn; T3 adds `items` | consistent (T3 after T1) |
| T2↔T6/T7/T14 | changes.txt format (JSON arrays) | T2 regenerates; cov-capture-sync declared later via write | consistent |
| T3↔T4..T20 | MIGRATIONS order/ids/items | T3 produces; all consume ids | consistent |
| T4↔T5,T9 | namesToken | T4 produces in batch-cost.mjs; T5 (export) imports from batch-cost | ok — export importing batch-cost is engine-internal (D2) |
| T6↔T7,T8 | attributionOf | T6 produces | consistent |
| T7↔T10 | unmeasured buckets / render null | T7 counts; T10 nulls minutes; both render tests | consistent |
| T11↔T14,T17 | manifest.mjs currentManifest | T11 produces | consistent |
| T12↔T14 | restamp | T12 rejection paths; T14 success path | consistent (map O7) |
| T13↔T15-17 | cost.json path | T13 relocates; later reports read via groupReportsDir | consistent |
| T14↔T18 | before-entry-symlink interaction | T18 records entry-points+writer interaction | consistent (writer lands first) |
| T22 self | ratioIntents removal | T11 B1_DEFAULTS keeps it | consistent |
| T1 self | tests vs code | pure fns + runCase/collect e2e | ok |
| T2 self | regenerate only changes.txt | goldens.mjs regenerates whole case; diff limited by check | ok |
| T3 self | groups' beforeCases must exist & show diffs at landing | listed cases exist (verified in map) | ok |
| T4–T20 self | write run is authority over candidate lists | stated L4 | ok |
| T18 self | item 13 test spawns unpreloaded child | no stdout stubbing | ok |
| T20 self | kit ENOTDIR not migration-gated | kit is not engine-gated | ok |
| T23 self | Codex pass; no re-review (owner) | ok |
Scan clean; no rulings needed.

## Progress
Task 1: dispatched (base bb3b8c1, opus)
Task 1: implementer agent a4f6edf93d4302518
Task 1: implementer DONE_WITH_CONCERNS (f222143): e2e out/__proto__ passed pre-fix (only root-level names hit); root-level tests added; 3 tests compare plain copies; diff-impl/goldens unchanged; review dispatched (opus)
Task 1: minor (deferred): corpus/README "—," punctuation; _interactions README line reflow; unlisted-key refusal lacks "— nothing written" suffix; P3P-03 test (a) asserts presence not exclusivity
Task 1: complete (commits bb3b8c1..f222143, review clean)
Task 2: dispatched (base f222143, opus)
Task 2: implementer agent a09d6680c0c842cf4
Task 2: implementer DONE (de2b01f): 3 changes.txt goldens regenerated (0 mismatches); paths scrubbed pre-serialisation too; before-entry-symlink assert.json textFact updated; map ~1188 old format → carry to Task 3; review dispatched (opus)
Task 2: minor (deferred): snapshotTree scrubs path keys → two raw paths scrubbing alike (literal <REPOKEY> file name) collapse silently — add a collision throw + test; gitDirSummary newline-in-committed-path untested (ls-tree C-quotes)
Task 2: accepted deviation: before-entry-symlink/assert.json textFact hand-updated to the JSON record (test assertion, not a golden)
Task 2: complete (commits f222143..de2b01f, review clean)
Task 3: dispatched (base de2b01f, opus) — carries map:1188 changes.txt record-shape fix
Task 3: implementer agent a07ccf3097b9c43d8
Task 3: implementer DONE_WITH_CONCERNS (63f9598, tag v0.2.1-rc.3): items 12–24 specs live in map §3 rows (not §2); 3 un-numbered proposals marked decided-by-delegation; Q12c merge + Q11 finding/preview underspecified; README rc.1 "eleven", signoff Q boxes unticked
Task 3: Ruling: Q12c displaced self-declared record — the claimed pending record's declaration fields (intent, batch, cases, role, source) win; outcomes are merged (pending's first, self-declared outcomes added for ids the pending lacks); closedAt kept if either has it; claimedFrom set — simplest merge that loses no recorded outcome — if wrong: one merge rule in Task 12 changes (carry to Task 12)
Task 3: Ruling: Q11 missing-archive finding rule name `manifest-archive-missing`; unverified spend reported beside the ratio as `unverified: { sessions, costUsd }`, never in numerator and no preview total — keeps the unverified reading visible without a second ratio — if wrong: one report field (carry to Task 11)
Task 3: review dispatched (opus)
Task 3: minor (deferred): map "only a spec exemption under Q3" phrasing (:480,:553,:648,:774,:842) → "Q3 decided {}"; owner-signoff §2 Q1–Q16 boxes unticked; §3 before-case test matches any row; items validation allows duplicates/overlaps; README rc.1 "eleven"
Task 3: complete (commits de2b01f..63f9598, review clean; tag v0.2.1-rc.3)
Phase A complete.
Task 4: dispatched (base 63f9598, sonnet)
Task 4: implementer agent aba9d024774285393
Task 4: implementer DONE (6458019): declared only before-ids-substring (10 candidates unchanged); map corrected (export row unchanged; stats.direct* → null); registry test now 'landed = prefix'; review dispatched (sonnet)
Task 4: minor (deferred): exact path compares line.cases to slug/branch by === only (intended §5.1; add a note); batch-cost.test sets TOKENOMICS_MIGRATIONS globally at import (restore in after hook)
Task 4: complete (commits 63f9598..6458019, review clean)
Task 5: dispatched (base 6458019, sonnet)
Task 5: implementer agent a960827dbe5057cb0
Task 5: implementer DONE (82ee581): declared before-export-anon-batch only; scrub helpers in engine/scrub.mjs (import cycle); slugs/receipt paths reach engine via extension anonymize result 'scrub' key; review dispatched (sonnet)
Task 5: review r0: 1 Important (slugs/receipt paths only via extension 'scrub' key — O9 says engine guarantee independent of extension) + minors (TA receipt path member wrong file; keys not scrubbed; ANON_SET hidden channel; numeric ref vs dotted versions)
Task 5: Ruling: engine derives slugs + receipt paths itself by enumerating every group receipt the project has (the same receipt enumeration batch-cost/team-report use under settings.receipts), not by adding a field to export rows — runs.json row schema is the external export contract and must not grow; enumeration makes the guarantee extension-independent — if wrong: a group whose receipt was deleted before --submission keeps its slug unscrubbed unless the extension supplies it
Task 5: fix round 1 dispatched (Important 1 per ruling + minor 2)
Task 5: fix round 1/5 (2 addressed, 0 open — engine-derived slugs/receipt paths via loadReceipts; TA receipt-path member dropped; commits 82ee581..6962291)
Task 5: minor (deferred): nested slug last segment scrubbed as bare token (team/docs → every 'docs' token); deleted receipts not in engine set; numeric ref vs dotted versions; object keys not scrubbed; ANON_SET non-enumerable symbol channel
Task 5: complete (commits 6458019..6962291, review clean)
Task 6: dispatched (base 6962291, sonnet)
Task 6: implementer agent ac6c99fcee4802c1a
Task 6: implementer DONE (31fd0d4): declared seed-claude-folded, cov-capture-pricing, cov-dispatch-batch; cov-capture-sync dropped; review dispatched (sonnet)
Task 6: minor (deferred): stale tokensAttribution deletion path untested (add stale-flag + null-parent mirror tests)
Task 6: complete (commits 6962291..31fd0d4, review clean)
Task 7: dispatched (base 31fd0d4, opus)
Task 7: implementer agent aff98b362a080e8fa
Task 7: implementer DONE_WITH_CONCERNS — commits 7e599fd, ef348c1; 666 tests; gates green N24+N18 (concerns: seed-copilot-no-usage tokensAttribution partial + map text fixed; 13 extra cases declared via unmeasured field; VS Code timestamp-less sweep re-append pre-existing → carry to T19)
Task 7: review dispatched (opus, agent a1acf15c6795830ea)
Task 7: review r0: Spec ❌ / Changes requested — 1 Important (cost.json loaded.activeMin/tokens + stats.loadedActiveMin/perCaseStats coerce unmeasured to 0; renderers print 0m beside "— (n unmeasured)") + 8 minors
Task 7: Ruling: Q8b kept literal — timestamp-less session gets null wallMin/activeMin even when every VS Code request carries elapsedMs (and Claude parent drops dispatch minutes) — owner delegated Q8 to the map's proposal, which says "any host"; changing it is a one-line capture rule — if wrong: VS Code timestamp-less sessions lose measured Σ elapsedMs minutes (surface to owner at the end)
Task 7: Ruling: one count format " (n unmeasured)" everywhere (TA render parts adopt the engine's) — one page must not show two formats; cheapest before API 2 freeze — if wrong: a string change in one extension
Task 7: Ruling: sumOrNull identity dependence → documented in the API 2 draft (extensions must not clone a bucket before bucketOut), not re-engineered — no current path clones; Task 21 freezes the contract — if wrong: an extension that spreads a bucket silently nulls a measured sum
Task 7: Ruling: plan brief goldens command takes a case directory (corpus/cases/<id>) — controller corrects it in later briefs' dispatches — if wrong: nothing
Task 7: fix round 1 dispatched (Important 1 + minors 1,3,4,5,6,7-doc)
Task 7: fix round 1 implementer done (ed00978; 670 tests; gates green N24+N18); re-review dispatched
Task 7: fix round 1/5 (Important 1 + minors 1,3,4,5,6,7 addressed; 2 ruled no-change; 8 controller plan-text — commits ef348c1..ed00978)
Task 7: minor (deferred): renderStatus prints "— (1 unmeasured)" for null inputs even under none (reference printed "null"; none capture never writes null); by-group render test not shown RED
Task 7: complete (commits 31fd0d4..ed00978, review clean after round 1)
Task 8: dispatched (base ed00978, sonnet)
Task 8: implementer agent aaec0d7d4e7faba97
Task 8: implementer DONE_WITH_CONCERNS (9b215ea; 680 tests; gates green N24+N18): +before-scope-precedence, cov-capture-dispatch-edges declared + map; seed-copilot-no-usage attribution back to none (inclusive dispatches ignored); 5 interactions w/ null-unobservable; join fixtures not RED (kit rule pre-existing); review dispatched (sonnet)
Task 8: minor (deferred): loadLiveLines live Copilot record has no tokensBasis → provisional page flags attribution; conservation fixtures hand-written (no engine-derived trace); batch-cost reader untested with null-unobservable alone + inclusive line; copilotDispatchTokens detaches JSDoc; work-scope tok() null→0 (Claude-only today)
Task 8: complete (commits ed00978..9b215ea, review clean)
Task 9: dispatched (base 9b215ea, opus)
Task 9: implementer agent a6cf89f9a8f30baff
Task 9: implementer DONE_WITH_CONCERNS (30e4acd; 690 tests; gates green N24+N18): declared seed-receipts-shared-id, before-dispatch-two-groups; inclusive line splits counts/minutes only; unrounded 1/k rounded at output (k≥4 rounded sums may exceed kit tolerance); sharedDispatchCounts(groups, allLines, {scopes}); rollup:true excluded from k; review dispatched (opus)
Task 9: minor (deferred): map/ENGINE-B1 rounding note should say kit checks traces not cost.json and div/clusters share the bound; KPI card fmtInt(dispatches) 0.5→"1" (pre-existing, render); div split still counts rollup receipts (pre-existing); no test of k under exact-ids,shared-allocation (TC-1 vs TC-10)
Task 9: complete (commits 9b215ea..30e4acd, review clean)
Task 10: dispatched (base 30e4acd, opus)
Task 10: implementer agent a8495b22da604dfba
Task 10: implementer DONE_WITH_CONCERNS (2f6d3ec; 702 tests; gates green N24+N18): 23 cases declared (map predicted 12), 23 interactions (4 extended to 3 owners); beyond map: live session minutes = Σ finished dispatch minutes floor, TA sizing null per-case minutes → '—' and batch estimate-vs-actual dropped; allocation-null not counted as unmeasured; 1/k never touches minutes; review dispatched (opus)
Task 10: review r0: Spec ❌ / Changes requested — I1 live-line minutes "floor" (Σ dispatch minutes, num() turns null → 0, overlapping dispatches overstate) out of scope + breaks O1; I2 TA sizing drops batch-grain estimate-vs-actual though session-grain minutes exist; 6 minors
Task 10: Ruling: I1 — drop the live floor; a running lead thread's minutes are null + counted unmeasured under null-unobservable (reference 0 without it); no owner-decision path pursued — minutes are not additive (§5.4) and an invented figure must not ship — if wrong: provisional live pages show "— (1 unmeasured)" instead of a number
Task 10: Ruling: I2 — keep the batch-grain estimate-vs-actual line, actual = Σ rows' loaded.activeMin (session-grain allocation) labelled "allocated: group time ÷ items"; per-case actualMin stays null, hiMin off — map hook table already routes sizing through loaded.activeMin; dropping a user-visible output needs owner sign-off we don't have — if wrong: one label/line in TA sizing
Task 10: fix round 1 dispatched (I1, I2, M1–M6)
Task 10: fix round 1 implementer done (04d8cb6; 702 tests; gates green N24+N18; all 23 cases re-recorded; foreign-null-extension renders added to interaction); re-review dispatched (sonnet)
Task 10: fix round 1/5 (I1, I2, M1–M6 addressed — commits 2f6d3ec..04d8cb6)
Task 10: minor (deferred): "not allocated" footnote prints on every period report even without dispatch-only roles; HTML "(loaded — (1 unmeasured))" nested parens; sizes without estimate add allocated actual to batch total (reference behaviour)
Task 10: complete (commits 30e4acd..04d8cb6, review clean after round 1)
Task 11: dispatched (base 04d8cb6, opus)
Task 11: implementer agent ad37aabc17b161d39
Task 11: implementer DONE_WITH_CONCERNS (126b195, 49efbbd; 725 tests; gates green N24+N18): revisionless receipts bound to implied TA deliveredOutcomes (foreign-settings 'done' not delivered in window vs by-group 1 delivered); endedAt-less lines drop from totals; unverified/findings top-level when non-zero; tie → later row; bad --since exits 2; +before-report-unknowns declared; review dispatched (opus)
Task 11: review r0: Spec ❌ / Changes requested — I1 revisionless receipts bound to implied TA deliveredOutcomes → every non-TA port reads 0 delivered, exclusion silent, window vs by-group disagree; I2 endedAt-less lines silently dropped from all totals (O1); 8 minors
Task 11: Ruling: I1 — a revisionless receipt reads its delivered outcomes from the receipt policy that discovered it (settings.receipts: root + deliveredOutcomes), the same policy discovery already uses; window, Outcomes and by-group must agree. The implied-legacy receipt policy in D1 equals TA_DEFAULTS.receipts, so TA history is unchanged; ratioIntents stays manifest-bound per D1 — §5.1 receipts never carry a revision, so the literal D1 reading makes every non-TA port's denominator 0 forever, which no spec text intends; Q10c says revisionless = reference-era, and a non-TA port has no TA reference era — if wrong: editing settings.receipts.deliveredOutcomes reinterprets revisionless receipts' history (surface to owner at the end)
Task 11: Ruling: I2 — lines without a readable endedAt are counted and rendered as `undated: { sessions, costUsd, priced }` beside the ratio (present only when non-zero, like unverified), never in any window total; semantics text adds the clause — O1 forbids silent drops; mirrors the unverified ruling — if wrong: one report field
Task 11: Ruling: M1 — offset-less date-times (flags and receipt `at`) read as UTC; non-ISO forms refused with exit 2 (flags) / receipt treated as having no `at` — windows are UTC instants (Q10d) — if wrong: a TZ-dependent receipt shifts window
Task 11: fix round 1 dispatched (I1, I2, M1–M8; M2 → label minutes "all sessions")
Task 11: fix round 1 implementer done (1ce8efc; 730 tests; gates green N24+N18); re-review dispatched (sonnet)
Task 11: fix round 1/5 (I1, I2, M1–M8 addressed — commits 49efbbd..1ce8efc)
Task 11: minor (deferred): multi-root run uses primary root's settings.receipts vocabulary for revisionless receipts (untested); perDelivered.activeMin still all-sessions formula (labelled)
Task 11: complete (commits 04d8cb6..1ce8efc, review clean after round 1)
Task 12: dispatched (base 1ce8efc, opus)
Task 12: implementer agent a8f78d1244421ce28
Task 12: implementer DONE_WITH_CONCERNS (c9a977e; 745 tests; gates green N24+N18): new engine/scopes.mjs (import cycle); resolveScope 5th arg {endedAtMs, now}; cov-copilot-dispatch loses scope (sandbox CLAUDE_PROJECT_DIR → --host claude; Copilot hooks pass no --host); restamp writer path stub for T14; 22 declared/4 refused, 3 interactions; review dispatched (opus)
Task 12: review r0: Spec ✅ / Changes requested — I1 Copilot session with inherited CLAUDE_PROJECT_DIR files scope under claude/ (hostFromEnv ignores COPILOT_CLI=1), line written scope-less silently (O1); I2 one unreadable/vanished pending-*.json aborts whole resolution → no scope; 6 minors
Task 12: Ruling: I1 — host default order: explicit --host > COPILOT_CLI=1 → copilot > CLAUDE_SESSION_ID/CLAUDE_PROJECT_DIR → claude > usage error; announce/gate text include --host; a capture that finds the session's record only under another host reports it on stderr + kit finding (never silent) — install-hooks already sets COPILOT_CLI=1 on Copilot hooks, so the marker is ours — if wrong: one env check
Task 12: Ruling: M4 — stamp `host` on a pending record when known (--host or env); a capture skips pending records stamped with another host; host-less pending records keep spec precedence — additive, prevents cross-host claim — if wrong: one field + one filter
Task 12: fix round 1 dispatched (I1, I2, M1–M6)
Task 12: fix round 1 implementer done (36c1a48; 758 tests; gates green N24+N18; cov-copilot-dispatch replay.json input edited to pass --host copilot, baseline regenerated identical; pending host stamped by location scopes/<host>/ (kit schema forbids extra field); +2 declared cases); re-review dispatched (opus — case-input edit + concurrency)
Task 12: fix round 1/5 (I1, I2, M1–M6 addressed — commits c9a977e..36c1a48)
Task 12: minor (deferred → final fix wave): misfiled-record remedy text "re-declare with --host" creates a 2nd location (should say move the record); unreadable .claim drops that session's scope silently (O1); flat-record claim crash window leaves ambiguous id (stderr-reported); corpus no longer covers COPILOT_CLI=1 env-default without --host (add a case in Task 19)
Task 12: complete (commits 1ce8efc..36c1a48, review clean after round 1)
Task 13: dispatched (base 36c1a48, sonnet)
Task 13: implementer agent a75e7bd3cfaa6faf4
Task 13: implementer DONE_WITH_CONCERNS (2ebfc00; 768 tests; gates green N24+N18): byBatch recomputes (mixed-era test green by construction); TA detected by extension basename; export anon paths still list tree cost.json; group/live-page name collision unhandled; declared foreign-settings, foreign-null-extension; review dispatched (sonnet)
Task 13: review r0: Spec ✅ / Changes requested — I1 TA with reports.location telemetry (explicit or wrapper default): onClose gets relocated dir, foldGateRuns folds verdicts there and deletes source, TA reads verdicts from receipt dir → gate drift false-negative; sizeBaselines misses relocated cost.json; 6 minors
Task 13: Ruling: I1 — extension onClose keeps receiving the group's receipt dir (where TA's gate runs and verdicts live); only the engine's reports + cost.json relocate; TA sizeBaselines reads cost.json at groupReportsDir first, then the receipt tree — extension-owned state stays where its readers look; no refusal of a valid setting — if wrong: TA gate-run folding location (one argument)
Task 13: fix round 1 dispatched (I1, M1 doc, M2 identifiers, M4 release note; M3 deferred → final, M5 negative test, M6 none)
Task 13: fix round 1 implementer done (bb70587; 772 tests; gates green N24+N18); re-review dispatched (sonnet)
Task 13: fix round 1/5 (I1, M1, M2, M4 addressed; M3 deferred; M6 no change — commits 2ebfc00..bb70587)
Task 13: minor (deferred → final): group/live-page name collision (group "foo.html" vs live page reports/foo.html); unparseable relocated cost.json hides tree-era copy in sizeBaselines
Task 13: complete (commits 36c1a48..bb70587, review clean after round 1)
Task 14: dispatched (base bb70587, opus)
Task 14: implementer agent a7be33f82412dff2e
Task 14: implementer DONE_WITH_CONCERNS (c8b2c34; 781 tests; gates green N24+N18): 40 cases (= map), 16 interactions; RF2 never RED; module.json w/o manifestRevision → null stamp → reader binds implied; unparseable module.json → revision 1; restamp: own-record scope only, exit 1 otherwise; scopeForLine moved to engine/scopes.mjs; review dispatched (opus)
Task 14: review r0: Spec ✅ / Changes requested — I1 fresh line under present-but-unusable module.json (no manifestRevision → null → reader binds implied; unparseable → stamped 1 → binds old manifests/1.json) misbound and counted verified, no finding; 3 minors
Task 14: Ruling: I1 — writer stamps manifestRevision null whenever module.json exists but is unusable (unparseable or no integer manifestRevision); the reader keeps an absent key = legacy implied manifest, and treats explicit null as unverified with finding `manifest-revision-unknown` (excluded from eligible, counted in `unverified`) — O1/O4: a fresh line must never be read under a manifest it wasn't written under — if wrong: one reader branch + one finding id
Task 14: Ruling: M2 — restamp re-derives top-level cases = (winner.cases − winner.scope.cases) ∪ newScope.cases — restamp exists to correct a mis-declared scope; a stale cases keeps the wrong batch membership — if wrong: restamped lines' cases differ from a capture --force result in rare overlap cases
Task 14: fix round 1 dispatched (I1, M1, M2, M3)
Task 14: fix round 1 implementer done (6676aed; 786 tests; gates green N24+N18; no corpus change; +1 inventory FP allowlist entry); re-review dispatched (sonnet)
Task 14: fix round 1/5 (I1, M1, M2, M3 addressed — commits c8b2c34..6676aed)
Task 14: minor (deferred → final): unverified callout wording ("name a revision without an archive") inaccurate for null-revision lines; receipt with null revision read as unstamped (engine never writes receipts)
Task 14: complete (commits bb70587..6676aed, review clean after round 1)
Task 15: dispatched (base 6676aed, opus)
Task 15: implementer agent a5bef1df564b6590f (scope note: item 22 also turns report-windows' receipt exact-tie rule into conflicts per map :1001/:1070)
Task 15: implementer DONE_WITH_CONCERNS (531a099; 797 tests; gates green N24+N18): only cov-team-report-rollup declared (23 refused); conflicts/preview {sessions,costUsd,priced}; receipt conflicts cases.conflicts + preview; spec-silent: undated conflict counted once as undated; window/role on picks; dup keeps lowest canonical; map key order still input order; tokenomics view lacks conflicts callout; review dispatched (opus)
Task 15: review r0: Spec ❌ / Changes requested — I1 conflict dropped silently when its preview pick is out of scope but another line is in scope (group membership, --role, legacy window); I2 undated conflict counted only as undated (cov-team-report-rollup reports conflicts 1, d5's $1600 line vanishes); I3 --json not byte-identical forward vs reversed (byPerson key order; float sum order); 4 minors
Task 15: Ruling: I1 — a conflict is in scope when ANY of its tied lines is in scope (window, --role, group membership); it is then counted under conflicts and its pick in preview — O1: a conflict is never invisible to a reader whose scope touches it — if wrong: a conflict appears in a scope its pick lies outside of
Task 15: Ruling: I2 — conflict takes precedence over undated: an undated conflicted pair counts under conflicts (and its pick in preview), never under undated; undated counts only unconflicted lines — one place per session, conflicts carry both lines' existence — if wrong: one counter moves
Task 15: Ruling: I3 — under report-conflicts, dedupConflicts returns winners and preview sorted by dedup key, so --json is byte-identical forward vs reversed; test with fractional costs and byte-compare full --json — R20/O2 order independence — if wrong: output key order changes (declared diff)
Task 15: Ruling: M4 — restamp refuses (exit 1, message naming the conflict) when the winner is an exact §3.5 conflict — a writer must not resolve a conflict by read order — if wrong: operator must capture --force
Task 15: fix round 1 dispatched (I1, I2, I3, M1 callout, M2 preview.unwindowed, M3 test, M4 refuse)
Task 15: fix round 1 implementer done (d4d56a7; 805 tests; gates green N24+N18; +4 declared cases key-order only; 5 interactions extended); re-review dispatched (sonnet)
Task 15: fix round 1/5 (I1–I3, M1–M4 addressed — commits 531a099..d4d56a7)
Task 15: minor (deferred → final): group-cost preview only {sessions,costUsd}; restamp conflict refusal gated on report-conflicts (writer-only still read order)
Task 15: complete (commits 6676aed..d4d56a7, review clean after round 1)
Task 16: dispatched (base d4d56a7, opus)
Task 16: implementer agent a1cb36a030f9fac9c
Task 16: implementer DONE_WITH_CONCERNS (c1864a9; 811 tests; gates green N24+N18): kept Σ byRole = totals invariant over brief's costUsd/div formula (foreign-settings 1.05/0.95); dispatch-only roles in byRole with costUsd null; byDispatchRole {units,costUsd,priced} always present → 20 cases declared, 20 interactions extended; tokenomics views lose per-dispatch-role dollars; map corrected; review dispatched (opus)
Task 16: review r0: Spec ❌ / Changes requested — I1 unpriced session's parent role shows dispatch dollars as its inclusive cost (spec 3.2.1, O1; cov-batch-cost-edges gb-priced null → $0.50; test name contradicts assertion); I2 byRole costUsd null/n/a conflates dispatch-only "not allocated" with unpriced parent; 6 minors
Task 16: Ruling: concern 1 — parent role = what the group charges for the session (Σ byRole.costUsd = totals.costUsd kept); brief's literal costUsd/div is superseded — keeps totals unchanged and overhead non-negative; reviewer concurs — if wrong: shared/foreign cases' parent-role dollars change (one formula)
Task 16: Ruling: I1 — an unpriced session's parent role costUsd is null and counted unpriced; its dispatch dollars appear only in byDispatchRole, never in byRole — spec 3.2.1 "never added to the session's" + O1 — if wrong: unpriced parent shows partial dispatch dollars
Task 16: Ruling: I2 — byRole buckets carry {priced, unpriced} counts; a dispatch-only role renders "—" with the existing "— = not allocated at this grain" footnote (active-minutes convention); an unpriced parent renders "— (n unpriced)" — two different nulls must read differently — if wrong: render text only
Task 16: fix round 1 dispatched (I1, I2, minors: tokenomics views get the dispatch-dollars table; map period-streams row restores role-dollars; CASES.md notes; stale comment; byDispatchRole two shapes documented in API 2 draft)
Task 16: fix round 1 implementer done (2f5619d; 812 tests; gates green N24+N18; 20 cases + 20 interactions re-recorded); re-review dispatched (sonnet)
Task 16: fix round 1/5 (I1, I2, M1–M6 addressed — commits c1864a9..2f5619d)
Task 16: minor (deferred → final): mixed priced/unpriced invariant test hard-codes 10 instead of 13−3
Task 16: complete (commits d4d56a7..2f5619d, review clean after round 1)
Task 17: dispatched (base 2f5619d, sonnet)
Task 17: implementer agent ab5cf9fa3e0429071 (Ruling carried: report manifestRevision uses writer's stampRevision rule — unusable module.json → null, rendered 'manifest revision unknown' — consistency with line stamps, O1)
Task 17: implementer DONE_WITH_CONCERNS (commit 6d1e440; 824 tests; gates green N24+N18; multi-root primary + manifestRevisions on disagreement; map O6/R22 before-case count corrected 2→24)
Task 17: reviewer dispatched (sonnet, package review-2f5619d..6d1e440.diff)
Task 17: review ✅/Approved (3 Minor, deferred to final fix wave: no direct renderLiveReport footer test; duplicated key-reorder block in build-tokenomics-export appendRun/writeSubmission; renderCompare/otel-report no footer — Ruling: no footer on compare/otel — neither has a single manifest revision — if wrong, a later footer add is additive)
Ruling: multi-root period report = primary root's manifestRevision + manifestRevisions[] only on disagreement — scalar stays one number for simple readers, disagreement never hidden (O1) — if wrong, readers needing per-root always must read the array
Task 17: complete (commit 6d1e440, review clean round 0)
Task 18: dispatched (base 6d1e440, sonnet)
Task 18: implementer agent ac7efea09e093720e
Task 18: implementer DONE (commit a5f5151; 828 tests; gates green N24+N18; concern: otel-sink/otel-report/install-hooks guards untouched)
Task 18: reviewer dispatched (sonnet, review-6d1e440..a5f5151.diff)
Task 18: review ✅/Approved, 3 Minor
Ruling: fix Minor 2 (exitAfterDrain also waits when writableLength > 0) and Minor 1 (all remaining entry guards incl. bin/harness-telemetry.mjs, otel-sink, otel-report) now as round 1 — item 13's purpose is no truncation and a sub-hwm pending write is exactly that; the npm bin is the canonical symlink case for item 12 — if wrong, cost is a slightly wider entry-points diff
Task 18: fix round 1 (resume implementer)
Task 18: round 1 DONE_WITH_CONCERNS (commit 20fa022; 831 tests; gates green both; drained(stream,capMs) tested on real Writable; otel-sink guard unit-covered only)
Task 18: re-review 1 — all addressed; 2 new Minor deferred to final fix wave (drained() sync-throw leaves timer/listeners; no spawned otel-sink symlink test)
Task 18: complete (commits a5f5151..20fa022, review clean after round 1)
Task 19: dispatched (base 20fa022, sonnet; carries T12 deferred minor: corpus case COPILOT_CLI=1 without --host)
Task 19: implementer agent a13ec8a70b7697bb4
Task 19: implementer DONE_WITH_CONCERNS (commit 91887a6; 840 tests; gates green N24+N18 except migrations check N18 not run — controller running it; COPILOT_CLI case before-scope-env-host declared under scope-resolution; item 17 guard also suppresses grown timestamp-less sessions)
Task 19: reviewer dispatched (sonnet, review-20fa022..91887a6.diff); controller running N18 migrations check
Task 19: review ✅/Changes requested — I1 item-17 guard suppresses grown timestamp-less session (O1); M1 no grown-session test; M2 CASES.md row stale; M3 duplicated sort comparator
Ruling: fix I1 by growth detection (re-append when turns/token total grew), not just disclosure — O1 forbids silent drops and detection is cheap — if wrong, cost is one extra append per growth, which readers already dedupe as for re-captured sessions
Task 19: fix round 1 (resume implementer)
Task 19: controller N18 migrations check @91887a6: modes 19, cases 71, problems 0
Task 19: round 1 DONE (commit 206d52a; 841 tests; all gates green N24+N18 incl. migrations check)
Task 19: re-review 1 — all addressed; grown re-capture is a supersession, not a report-conflicts conflict; 1 new Minor deferred to final wave (same-ms grown re-append could tie in dedupConflicts)
Ruling: grown timestamp-less VS Code session re-appended, latest capturedAt supersedes — O1 no silent drop — if wrong, readers see one extra line per growth
Task 19: complete (commits 91887a6..206d52a, review clean after round 1)
Task 20: dispatched (base 206d52a, sonnet), implementer agent a94ce5ee98fe4e4b0
Task 20: implementer DONE_WITH_CONCERNS (commit f2ec099; 845 tests; all gates green both; 5 cases declared vs 3 predicted, map corrected; kit scopes-not-directory class error)
Task 20: reviewer dispatched (sonnet, review-206d52a..f2ec099.diff)
Task 20: review ✅/Approved, 4 Minor
Ruling: fix all 4 in round 1 — M2 (undefined still possible in submission.md for agent_tool/default_method/pipeline; missing scope throws) and M4 (bare trailing --repo falls back to cwd) defeat items 20 and 18 themselves; M1/M3 cheap — if wrong, cost is one small extra commit
Task 20: fix round 1 (resume implementer)
Task 20: round 1 DONE (commit 2d0b84a; 846 tests; gates green both)
Task 20: re-review 1 — all addressed, no new issues
Task 20: complete (commits f2ec099..2d0b84a, review clean after round 1)
Task 21: dispatched (base 2d0b84a, opus)
Task 21: implementer agent a273a12f0aed5ea25 (opus)
Task 21: implementer DONE_WITH_CONCERNS (commit 80d1236; 850 tests; all gates green both)
Ruling: EXTENSION_API=2 strict, independent of TOKENOMICS_MIGRATIONS — D3 forbids migration-dependent loading; no corpus/kit/reference path loads a v1 extension so off path unchanged — if wrong, a v1 foreign extension fails to load with 'extension API mismatch' (loud, not silent)
Ruling: async-hook error also written to stderr once per hook name — reference-copied catch sites swallow errors, and a contract violation must not be silent (O1) — if wrong, a duplicate stderr line where the throw surfaces
Ruling: error message keeps brief verbatim (<name> only) — brief text is binding — if wrong, slightly harder to locate the phase
Ruling: part-set test runs migrations-off only; implementer verified all-on trace identical — one traced replay in npm test — if wrong, a future on-only part escapes the test
Task 21: reviewer dispatched (opus)
Task 21: review ✅/Changes requested — I1 m.tok doc wrong (quad of zeros, keyed on tokensBasis); I2 ctx.settings per-migration changes undocumented; I3 receiptIds row omits exact-ids; M1–M5 (vacuous parts cell, CORPUS_UNREACHED parts, noisy Promise test, ':'-split names, stale draft pointer)
Ruling: fix all (I1–I3, M1–M5) in round 1 — the freeze is the contract C1 targets; doc errors there are load-bearing — if wrong, cost is one doc/test commit
Task 21: fix round 1 (resume implementer)
Task 21: round 1 DONE (commit d1740f0; 853 tests; all gates green both; I1 doc-only)
Task 21: re-review 1 — all addressed (1 non-actionable wording Minor: "deep-frozen" settings text)
Task 21: complete (commits 80d1236..d1740f0, review clean after round 1)
Ruling: Task 22 copies a ledger snapshot to docs/plans/plan-4-ledger.md and tags v0.3.0-rc.1 per plan; after Codex (T23) and final-review fix waves the ledger copy is refreshed and, if code changed, v0.3.0-rc.2 is tagged — plan order is binding and rc tags are cheap local candidates — if wrong, one superseded local tag
Task 22: dispatched (base d1740f0, opus)
Task 22: implementer agent ac7710effb879c555 (opus)
Task 22: clean-clone gates — N24: tests 854/854 pass, coverage 0 open, inventory 371 sites/86 engine 0 problems, diff-impl 68 cases differing 0, migrations 20 modes/71 cases problems 0, git status clean; N18: tests 854/854 pass, coverage 0 open, inventory 371 sites/86 engine 0 problems, diff-impl 68 cases differing 0, migrations 20 modes/71 cases problems 0, git status clean
Task 22: implementer DONE_WITH_CONCERNS (commit 9d3a5c0, tag v0.3.0-rc.1 local; 854 tests; clean-clone gates green N24+N18; added b1RatioIntents fallback for off paths in scope-hook/team-report)
Task 22: reviewer dispatched (opus, review-d1740f0..9d3a5c0.diff)
Task 22: review ✅/Approved, 5 Minor deferred to final fix wave (ENGINE-B1:147 announce text stale; :584 long line; no direct none-path test for b1RatioIntents/INTENTS/md label; scope-hook INTENTS B1-only comment; ledger copy counts are from 652518c — report says identical)
Task 22: complete (commit 9d3a5c0, tag v0.3.0-rc.1, review clean round 0)
Task 23: Codex review launched (gpt-6-astra, effort high, companion 1.0.6 task --write; prompt scratchpad/codex-b2-review-prompt.md)
Task 23: Codex review written & committed (Not approvable: 9 Blocker B2-01..09, 1 Major B2-10; P3P-01..06 confirmed closed). Gates in Codex sandbox: 850 pass/4 skipped (OTel EPERM listen), diff-impl 68/0, migrations 20×71/0
Ruling: Codex fix wave = 8 sequential fix tasks: F1 harness exactness B2-01+02+03 (opus, same modules); F2 B2-04 inclusive model/role totals (sonnet); F3 B2-05 receipt binding in group/per-case (opus, D1); F4 B2-06 submission unknowns (sonnet); F5 B2-07 live parent nulls (sonnet); F6 B2-08 recapture on any measurement change (sonnet); F7 B2-09 anonymise keys (sonnet); F8 B2-10 live/group namespace (sonnet) — each TDD, gated by its owning migration where behavioural, after-files only via migrations.mjs write; no re-review (owner decision); final whole-branch review still follows — if wrong, grouping F1 hides one finding's fix in a shared commit
Codex F1: dispatched (base b26d1a5, opus, agent aea30d47bca90064f)
Codex F1: DONE (commit 7d362e7; 867 tests; all gates green both; no golden regenerated) — B2-01/02/03 fixed: aliasing refused (scrub collisions, reserved __events__/__sandbox__ roots, strict UTF-8)
Ruling: park content-scrub aliasing (a file literally containing "<REPO>/x" equals one containing the sandbox path) — refusing tokens in contents could reject legitimate output and the corpus wasn't audited; documented in ENGINE-B1 — owner milestone B3 (harness hardening) — if wrong, a contrived undeclared content change can still pass
Ruling: accept replay-throw → per-case problem row (exit still 1) and no non-UTF-8 outputs until a byte mode exists — both fail loudly — if wrong, a future binary case needs a byte-mode extension
Codex F2: dispatched (B2-04, sonnet)
Codex F2: DONE (commit 4fc6c0b; 869 tests; all gates green both; no corpus change) — B2-04 fixed
Ruling: defer to final review — null-token inclusive dispatch with the parent's role still adds an unmeasured token count to that role bucket (pre-existing, test-pinned); over-disclosure, not a drop — if wrong, a role shows "(1 unmeasured)" spuriously
Codex F3: dispatched (B2-05, opus)
Codex F3: DONE (commit b1d6f55; 871 tests; all gates green both; no corpus change) — B2-05 fixed via shared receiptDelivery helper; missing archive → findings in cost.json/byBatch/md/html
Ruling: accept receiptDelivery gated on report-windows (owner of D1 binding), receipt field decides within it — ungated would reintroduce the self-contradiction under none — if wrong, O10 purists flag a migrationOn branch in a reader
Ruling: park --receipts <dir> multi-root denominator vs byBatch telemetry-dir mismatch (pre-existing, outside B2-05) for final review — if wrong, a multi-root --receipts report can disagree with itself
Codex F4: dispatched (B2-06, sonnet)
Codex F4: DONE (commit b9bac57; 872 tests; all gates green both; cov-export-submission-edges rewritten via migrations.mjs write null-unobservable + interaction) — B2-06 fixed
Ruling: accept migrationOn('null-unobservable') gate in writeSubmission alongside null-field checks — reference rows already carry nulls the reference rendered as 0, so field-only gating breaks the off path — if wrong, a reader-side migrationOn branch the final review may flag
Codex F5: dispatched (B2-07, sonnet)
Codex F5: DONE (commit 84b9d7d; 874 tests; all gates green both; after-files rewritten: cov-batch-cost-edges, cov-copilot-dispatch, cov-reports-ledger, foreign-null-extension) — B2-07 fixed (gated null-unobservable in loadLiveLines)
Codex F6: dispatched (B2-08, sonnet)
Codex F6: DONE (commit 285f414; 875 tests; all gates green both) — B2-08 fixed (canonical measurement-state comparison)
Ruling: accept superseding capturedAt forced ≥ previous+1ms — guarantees supersession over conflict and also closes T19's same-ms tie Minor — if wrong, a capturedAt can be off real time by 1ms; and one re-append per pre-upgrade line on first sweep (settles)
Codex F7: dispatched (B2-09, sonnet)
Codex F7: DONE (commit ed3a1b5; 877 tests; all gates green both; no corpus change) — B2-09 fixed: nested keys scrubbed, collisions → anonymised, anonymised-2…
Ruling: accept document/row-level keys left unscrubbed (schema field names; a slug like "notes" must not rename a field) — residual: an extension row field NAMED by a supplied id still leaks; for the final review / C1 extension guidance — if wrong, a contrived extension field-name leak
Codex F8: dispatched (B2-10, sonnet)
Codex F8: DONE (commit d4c3288; 880 tests; all gates green both: coverage open 0, inventory 0, diff-impl differing 0, migrations 20 modes × 71 cases problems 0; no corpus change) — B2-10 fixed: live pages under reports-live/<encodeURIComponent(batch)>.html
Ruling: accept no corpus case for the relocated live path (unit-tested both orderings + injectivity) and stale old reports/<batch>.html left behind like cost.json — if wrong, an end-to-end live path regression is caught only by unit tests

## Codex B2 review — finding dispositions (Task 23 Step 2; no re-review per owner)
| ID | Severity | Disposition | Commit |
|---|---|---|---|
| B2-01 | Blocker | fixed — scrub-collision observations refused | 7d362e7 |
| B2-02 | Blocker | fixed — reserved __events__/__sandbox__ roots rejected; merges refused | 7d362e7 |
| B2-03 | Blocker | fixed — strict UTF-8 for outputs/events/goldens; invalid bytes refused | 7d362e7 |
| B2-04 | Blocker | fixed — inclusive tokensByModel / byRole honour tokensBasis | 4fc6c0b |
| B2-05 | Blocker | fixed — shared receiptDelivery for denominator, group costs, byBatch, per-case; missing archive → finding | b1d6f55 |
| B2-06 | Blocker | fixed — submission.md null + (n unmeasured/unpriced) | b9bac57 |
| B2-07 | Blocker | fixed — provisional live parent null quantities | 84b9d7d |
| B2-08 | Blocker | fixed — timestamp-less recapture on any measurement-state change | 285f414 |
| B2-09 | Blocker | fixed — nested object keys anonymised, collision suffixes | ed3a1b5 |
| B2-10 | Major | fixed — live pages in reports-live/, injective names | d4c3288 |
Parked residuals: content-scrub aliasing (B3 harness hardening); row-level extension field names named by a supplied id (C1 extension guidance); --receipts multi-root denominator vs byBatch (final review).
Task 23: fix wave complete (7d362e7..d4c3288); gate counts at d4c3288: 880/880 tests N24+N18, coverage open 0, inventory 0, diff-impl 68/0, migrations 20×71/0
Task 23: complete (tag v0.3.0-rc.1 moved to 866a42a)
Final review: dispatched (opus, range d827b2e..866a42a)
Final review: Needs fix wave — 0 Critical, 1 Important (F2 regression: inclusive dispatch-only role reads measured 0 tokens in period byRole, team-report.mjs:448), 6 Minor, 8 deferred items adjudicated (a)
Final fix wave: dispatched (opus, base 866a42a)
Final fix wave: commits f1c70e3 f168467 3e030ac 587d460 3b98eb4 (I1, M1–M5, ledger 47/86/91/146/231); N24 887/887, diff-impl 68/0; N18 + migrations check running in implementer's clean clones
Ruling: M6 (plan-4.md:708 "move rc.1" vs ledger "tag rc.2") — rc.1 stays at 866a42a (Task 23 close, Codex-fixed); the final-review fix wave changed code, so tag v0.3.0-rc.2 at the final HEAD; plan text left as written, ledger records the deviation — tags are local and movable, so a wrong call costs one tag command
Ruling: work-scope status null-token rendering gated on migrationOn('null-unobservable') rather than by field (O10 exception) — the reference already prints those nulls as 0 in cov-dispatch-batch, so a field-only reader breaks diff-impl; same precedent as writeSubmission (ledger 249) — if wrong, B3 lifts the gate once the reference baseline is retired
Final re-review: dispatched (sonnet, 866a42a..3b98eb4)
Final re-review: All findings addressed, no new Critical/Important breakage (sonnet)
Ruling: re-review Minor (keepKeys applies at all depths, so extension extra keys named input/output/cache_read/cache_create are not key-scrubbed) parked to C1 with ledger 257 — fixed generic words, no identifying content — if wrong, a C1 scrub-depth fix
Final fix wave: DONE (f1c70e3 I1; f168467 M1; 3e030ac M3+M2; 587d460 ledger 86 work-scope + 146 callout; 3b98eb4 docs M4, M5, ledger 47/91/231/146-note). Report: final-fix-report.md
Final fix wave dispositions: I1 fixed (f1c70e3, ledger 86 batch-cost test folded in); M1 fixed (f168467); M2 fixed (3e030ac); M3 fixed (3e030ac, engineNotes.findings additive within API 2); M4, M5 fixed (3b98eb4); M6 open, controller's call (plan:708 rc.1 move vs ledger:225 rc.2; no tag moved); (a) items 47, 86 ×2, 91, 146, 231 ×3 fixed; ledger 86 work-scope is gated on null-unobservable (the reference prints null as 0), after-files cov-dispatch-batch __events__/6, 7 via migrations write
Final fix wave parks: owner report gets ledger 74 (Q8b) and 108 (revisionless receipt vocabulary); B3: 38, 125 .claim, 188, 238; B4: 74, 91 rollup div, 108; C1: 62, 146 receipt null, 246, 257
Final fix wave gates at 3b98eb4 (clean clones, N24.21 + N18.19): 887/887 tests, diff-impl 68/0, coverage open 0, inventory 371/0 + engine 93/0, migrations 20×71/0
Final fix wave: complete (f1c70e3..053bed1); gates at 053bed1 from clean clones: 887/887 tests N24+N18, coverage open 0, inventory 0, diff-impl 68/0, migrations 20×71/0 on both
Plan 4: complete — tag v0.3.0-rc.2 (local, annotated) at the ledger-copy commit; rc.1 stays at 866a42a
Owner (2026-10-14): confirmed as built — Q8b null minutes for timestamp-less sessions (line 74); revisionless receipts read the current settings.receipts (line 108); host order --host > COPILOT_CLI=1 > CLAUDE_* (line 120); content-scrub aliasing parked to B3 (line 238)
