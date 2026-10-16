# Owner answers (2026-10-11/12, interactive)
- Q1(a): approve 22 report-conflicts, 23 role-dollars, 24 report-revision as B2 migrations, each landing alone.
- Q1(b): approve 12–21 in B2 as three grouped migrations — entry points (12,13), capture robustness (14–17,21), report robustness (18–20); amends §14.8 'each lands alone' for these.
- Q3: production switch set = {} (no production switches; only off = B4 rescue release = B1 writer + mixed reader).
- Q14: "i just want a simple solution" → version from package.json; replay harness pins it to a fixed test value (no golden churn on bumps); B3 moves the source to ENGINE.json. Report provenance = item 24 (Q1a).
- Owner delegated the detailed design questions ("simple solution"): Q2, Q4–Q13, Q15, Q16 take the map's stated proposals (controller-decided, recorded as delegated):
  Q2 kit ENOTDIR fixed as kit maintenance (check finding); Q4 whole-token case-sensitive ids, boundary [A-Za-z0-9_-];
  Q5 even 1/k split + sources.sharedDispatches note; Q6 drop per-dispatch Copilot totals (dispatch tokens null), sources.inclusiveSessions note;
  Q7 map's null/labelled-allocation field list, parent gets full session minutes, dispatch roles separate; Q8 (a) cache 0 in quad without source categories, (b) timestamp-less → null minutes, (c) elapsedMs missing stays 0, (d) unmeasured:{…} per bucket + "n unmeasured" rendering;
  Q9 supplied strings = group slugs, work_item_ref, receipt paths, briefs; whole-token/path-segment boundary; Q10 (a) map's field names, (b) one endedAt window, (c) revisionless legacy receipt without revision = reference-era, (d) date-only → T00:00:00Z;
  Q11 (a) confirm D1 immutable legacy binding, (b) strict rule (fresh lines unverified without archive; Plan 4 cases ship manifests/<N>.json); Q12 (a) --host flag with env default, (b) both stderr + kit finding, (c) atomic rename + .claim recovery, (d) R9 inside item 9;
  Q13 (a) .agents/telemetry/<dir>/reports/<group>/, (b) default "telemetry" for present settings omitting it, (c) cost.json moves too; Q15 (a)+(b) confirm; Q16 conflicts:n + lowest-canonical-JSON preview total, slot 22.

## Closed 2026-10-11 (session 2)
- P3P-01/P3P-02: folded into Plan 4 Task 1 (no rc.3 patch). No migration lands before Task 1.
- Process: one Codex pass per milestone; findings fixed and listed in the ledger, no patch re-review. B2 scope unchanged (11 spec items + 22–24 + three grouped 12–21, per Q1).
- Coverage sign-off: all 10 approved-reachable exclusions approved per Codex verdicts; #4's reason text is reworded in Plan 4 Task 1 (name the host/runtime failure, drop the argument-parsing example); #1 stays tied to B3.
- Linux/Ubuntu evidence, GitHub remote, verbatim branch names, hyperfactory guide: parked until the owner decides to publish (pre-publish checklist). B2 runs on macOS.
- Spec §18.2: amend to the implemented observation scope (Plan 4 Task 1). `writer` production non-switchability documented-only until B3/B4: accepted. Installer README wording deferral to B3: accepted.

## Still open (owner)
- Pre-publish checklist (parked): remote + Ubuntu CI run, branch-name rewrite decision, hyperfactory guide (blocks A5).
