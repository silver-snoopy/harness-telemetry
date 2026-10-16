# Reference coverage (49577c7)

Gate granularity: function ranges (V8 functions[].ranges[0], max count over all replayed child processes).
Functions measured: 474; uncovered: 13; not excluded: 0
Branch-block ranges are reported per file below as information only (a block is uncovered when no process executed any of its characters); the gate itself is function-level.

## Per file

- hooks/otel-sink.mjs: 8 functions uncovered (0 open); branch blocks never executed: 0/3
- hooks/scope-hook.mjs: 0 functions uncovered (0 open); branch blocks never executed: 1/71
- hooks/telemetry-capture.mjs: 0 functions uncovered (0 open); branch blocks never executed: 32/814
- scripts/batch-cost.mjs: 0 functions uncovered (0 open); branch blocks never executed: 16/454
- scripts/build-tokenomics-export.mjs: 1 functions uncovered (0 open); branch blocks never executed: 9/194
- scripts/install-hooks.mjs: 1 functions uncovered (0 open); branch blocks never executed: 0/0
- scripts/otel-report.mjs: 1 functions uncovered (0 open); branch blocks never executed: 0/0
- scripts/team-report.mjs: 1 functions uncovered (0 open); branch blocks never executed: 44/575
- scripts/work-scope.mjs: 1 functions uncovered (0 open); branch blocks never executed: 1/142

## Exclusions (corpus/coverage/exclusions.json)

- scripts/install-hooks.mjs (whole file) — approved-reachable: Hook/git post-commit/VS Code task installer, a spec non-goal for this corpus; it writes host config rather than capturing, scoping, joining or reporting (spec §18.3 scope).
- scripts/otel-report.mjs (whole file) — approved-reachable: OTel report over the optional OTel sink, a spec non-goal; not part of the capture/scope/join/report path replayed by the corpus.
- hooks/otel-sink.mjs (whole file) — approved-reachable: optional OTel service; spawned by cov-capture-otel-local only to fail before listen; live-receiver coverage deferred (corrects the old "needs a live collector" rationale)
- scripts/team-report.mjs#f@24782 — unreachable: Default-parameter initializer `f = (x) => x` of `line4` in renderBatchMarkdown: all four call sites (team-report.mjs:407-410) pass an explicit formatter, so the default is never evaluated.
- scripts/work-scope.mjs#(anonymous)@17884 — approved-reachable: Rejection handler of `main().then(…, onRejected)` (work-scope.mjs:335-338): reached only if `main()` rejects outside its own try/catch, i.e. a host/runtime failure such as an exception thrown by the Node runtime or a stdio write error escaping main; no CLI input reaches it; owner-approved 2026-10-11
- scripts/build-tokenomics-export.mjs#f@15476 — unreachable: Default-parameter initializer `f = (x) => x` of `fmt` in the --compare renderer: every call passes an explicit formatter (usd at build-tokenomics-export.mjs:240, the share and hours rows at build-tokenomics-export.mjs:251 and :252), so the default is never evaluated.

## Open (not excluded)



## Stale exclusions (match no uncovered function)



## Weak function exclusions (unknown kind, reason < 40 chars, unreachable without a file:line, unresolvable citation, wholeFile mismatch, unpinned whole-file scope)



## Duplicate function exclusions



## Whole-file pins (corpus/coverage/whole-file-scope.json): 3, invalid 0



## Branch blocks

Scope: files without a whole-file function exclusion (skipped: hooks/otel-sink.mjs, scripts/install-hooks.mjs, scripts/otel-report.mjs). Dead blocks inside a function-level-excluded function (0) count as covered by that exclusion. Each uncalled function a function exclusion covers is charged its lexical branch-point weight (branchPointWeight); per file the larger of that weight and the covered dead blocks is waived and counts against the 15% budget.

### hooks/scope-hook.mjs

total 71, dead 1, covered by function exclusion 0, function-exclusion weight 0, waived in budget 0, excluded 1, open 0



### hooks/telemetry-capture.mjs

total 814, dead 32, covered by function exclusion 0, function-exclusion weight 0, waived in budget 0, excluded 32, open 0



### scripts/batch-cost.mjs

total 454, dead 16, covered by function exclusion 0, function-exclusion weight 0, waived in budget 0, excluded 16, open 0



### scripts/build-tokenomics-export.mjs

total 194, dead 9, covered by function exclusion 0, function-exclusion weight 0, waived in budget 0, excluded 9, open 0



### scripts/team-report.mjs

total 575, dead 44, covered by function exclusion 0, function-exclusion weight 0, waived in budget 0, excluded 44, open 0



### scripts/work-scope.mjs

total 142, dead 1, covered by function exclusion 0, function-exclusion weight 1, waived in budget 1, excluded 1, open 0



### Stale / weak / over-budget branch exclusions


