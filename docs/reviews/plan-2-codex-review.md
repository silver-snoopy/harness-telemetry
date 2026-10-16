Not approvable

# Plan 2 independent milestone review

Reviewed `794cc73e2999c6264522ac5cc58270d7a32df518` (`v0.1.0-rc.1`) → `abe611b7540662de6fb3b32b3096757d6103b95b` (`v0.2.0-rc.1`), with HEAD at the latter. Review date: 2026-10-10. This verdict concerns using the candidate as the baseline for Plan 3 migrations. A baseline-repair Task 1 can proceed; behavioral migrations should wait for its exit criteria below.

The extraction is substantial and the corpus catches many real failures. However, the local differential is red, an unreplayed export path changes TA-default output, multi-repository reporting violates foreign extension isolation, and the coverage exclusion mechanism still permits the budget bypass the final review claimed to close. These are concrete qualifications to the ledger's final “9/9 addressed, no new breakage” outcome (`docs/plans/plan-2-ledger.md:125`).

I do **not** treat absence of `writer`, the reference allocation defects, or the lack of a finished installer/porting skill as B1 failures: §14.7 expressly makes B1 non-port-conformant. Likewise, preserving an existing reference bug is different from introducing a new extraction difference.

## 1. Findings

Severity is for this milestone: Major means a baseline or contract issue to resolve before dependent migration work; Minor means bounded debt with a specified follow-up. No destructive/data-loss regression in the extraction was established.

| ID | Severity | Area | File:line | Finding | Evidence / reproduction | Recommended fix |
|---|---|---|---|---|---|---|
| P2-01 | Major | Replay portability | `corpus/cases/fault-capture-stage-locked/replay.json:42`, `:53`; `replay/sandbox.mjs:94` | This case collects the process's temporary directory. On this macOS installation, host Git/Xcode tooling creates `stage-tmp/xcrun_db`, so both reference and engine produce an unrecorded output. The claimed zero-diff baseline does not reproduce. | `node scripts/diff-impl.mjs`: exit 1, `cases 52, differing 1`, extra `stage-tmp/xcrun_db`. Independent, sequential `runCase` calls against each implementation reproduce it; all recorded files otherwise match. `/usr/bin/git` is selected here. Repro A. | Separate the assertion about meter-stage cleanup from unrelated host-tool cache output, or isolate/pin the Git executable and its cache behavior. Retain a positive assertion that the intended failed-cleanup branch occurred. Do not add the host-specific cache bytes to goldens. |
| P2-02 | Major | Pure extraction, export | `tokenomics/scripts/build-tokenomics-export.mjs:199`, `:203`, `:208` | Submission identity omission was changed globally, including with the TA extension. An existing `runs.json` whose segment lacks `stop`/`owner_group` renders different Markdown under TA defaults. Both implementations accept this input. The foreign-output fix therefore included an undeclared reference behavior change. | In-memory filesystem test of `writeSubmission` with the same document and explicit TA extension: reference heading includes ``(`undefined` stop)`` and a `Stop · owner` row; engine omits both. No settings file. Repro B. | Preserve reference rendering when TA is selected; keep foreign omission behind the appropriate extension behavior. Alternatively declare this as a B2 migration, not as byte-preserving extraction. Add export CLI/submission cases, including incomplete existing documents. |
| P2-03 | Major | Coverage scope and budget | `scripts/coverage.mjs:122`, `:133`; `corpus/coverage/exclusions.json:3` | `wholeFile:true` is an explicit spelling of the wildcard bypass, not its removal. A single exclusion removes an entire file from the branch budget; individual excluded functions also remove their contained dead blocks without budget accounting. Export currently uses this to suppress branches in **replayed** close-time library functions. | Repro C: 100 dead blocks, one wildcard, every gate clean. Actual measurement has 32 dead export blocks out of 92, all outside the branch gate. The final reason-length/flag checks do not limit scope. | Pin and review exceptional whole-file scope separately; narrow export now. Count in-scope blocks waived through function exclusions in the exclusion budget, or introduce an equally strict independently reviewed limit. Do not describe all replayed branches as closed while the wildcard remains. |
| P2-04 | Minor | Exclusion validation | `scripts/coverage.mjs:110`, `:122` | Neither gate validates the exclusion kind. A misspelled `unreachble` bypasses the unreachable citation requirement; an arbitrary kind also passes function validation. Branch “citation” accepts any `:digits`, including `ratio 1:2`. | Repro C; all verdict arrays empty with invalid kinds. | Validate an exact kind enum, required fields and unique IDs; use a real source-file/line citation check for both kinds of exclusion. Keep owner approval distinct from mechanically valid prose. |
| P2-05 | Major | Foreign configuration, multi-root reports | `tokenomics/scripts/team-report.mjs:793`, `:819`, `:829`, `:840` | One extension from `roots[0]` is reused for every repository. A later repository with `extension:null` receives TA enrichment. First-root receipt filename/outcome policy is also applied to all receipt directories, so reordering roots changes which receipts count. This exceeds a cosmetic vocabulary limitation. | Repro D using existing TA and foreign corpus outputs: TA-first gives `gate`/`drift` fields on foreign `sp1`/`sp2` and only 1 receipt report; foreign-first omits TA fields even on `cov-d` and counts only 2 foreign receipt reports. Both return 0. | Resolve settings, extension, receipt format and outcome policy per root. Define how mixed-policy results are presented, or reject incompatible roots explicitly until supported. Reverse the decision to leave this as unqualified parked debt. |
| P2-06 | Major | Configuration ownership before B2/C1 | `tokenomics/engine/config.mjs:20`, `:41`; `tokenomics/scripts/team-report.mjs:232`; `docs/spec.md:802` | `ratioIntents` is stored and consumed as mutable executable settings although the binding spec says it exists **only** in revisioned `module.json`. This follows Plan 2's prescribed shape, but the plan does not override the spec. It would make historical interpretation depend on current settings if carried into the port contract. | `docs/plans/plan-2.md:652` explicitly prescribed the conflicting shape; engine report reads `settings.ratioIntents`. | Record the conflict explicitly in Plan 3 Task 1 and design manifest-bound reading before ratio/window migrations. Retain the implicit TA reference manifest for B1 compatibility. Do not advertise this settings shape as the completed §14.4 contract. |
| P2-07 | Minor | Inventory gate | `scripts/inventory.mjs:49`, `:54`, `:117` | The engine scan excludes `tokenomics/engine/` and nested modules. Moving an allowlisted TA assumption into a generic helper removes it from inspection. Identical snippets in one file collapse, so a second copy creates no new site. | The scanner loops only immediate `hooks`/`scripts` entries. In-memory `scanSource` returns one site for both one and two identical TA literal lines. The ledger acknowledges both weaknesses at line 127. | Recursively scan generic executable engine code, allowlisting the intentional TA default configuration narrowly. Include occurrence information or a duplicate-count guard. Keep lexical scanning as a backstop, not proof of complete extraction. |
| P2-08 | Minor | Differential exemption | `scripts/diff-impl.mjs:42`; `corpus/engine.test.mjs:20`, `:61` | `implOnly:'engine'` is an unrestricted reference-parity opt-out. The expected case set is derived from the same flag, so its equality assertion cannot detect accidental reclassification of a reference case. Engine goldens then validate only the new engine behavior. | Source inspection: reference golden/A4/coverage consumers also skip this flag. Current two foreign exemptions are legitimate; no current misclassification was found. | Pin or separately approve the two foreign case IDs, require reasons for additions, and reject unexplained exemptions on cases carrying reference goldens. |
| P2-09 | Minor | Foreign wording and test strength | `tokenomics/scripts/batch-cost.mjs:458`; `tokenomics/scripts/install-hooks.mjs:294`, `:298`; `corpus/engine.test.mjs:94` | The foreign golden still contains TA delivered-outcome prose in a JSON note. A foreign install's generated README calls its directory the “test-automation factory's” and speaks of “cases.” The foreign wording assertion skips every JSON value, not just schema keys. | `foreign-settings/expected/engine/.agents/stories/sp1/cost.json:197` contains `delivered/defect-found; legacy automated/merged-sanctioned-red`. Installer source emits the README independently of extension selection. These are documented residues, but contradict a blanket “no TA wording” claim. | Derive explanatory text from configured policy or the extension, recursively inspect JSON string values while exempting schema keys, and add foreign installer-output coverage. A CSS class name alone is lower priority than visible prose. |
| P2-10 | Minor | Exported API defaults | `tokenomics/hooks/telemetry-capture.mjs:588`; `tokenomics/scripts/batch-cost.mjs:217` | Exported helpers mix TA settings defaults with `ext=null`. Calling a helper exactly as a reference consumer did silently drops TA behavior. CLI wiring generally supplies the extension correctly, so this is a narrower compatibility break than a CLI extraction failure. | `deriveLabel('', 'preface '.repeat(25)+'triage TC-123')`: reference returns `triage TC-123`; engine returns truncated preface. Passing the TA extension restores equality. Similar public joins/renderers require explicit extension threading. | Define the public import boundary before B5 and give it one consistent configuration/context contract. Either provide a compatibility facade or document and test every migrated caller. Do not claim default direct imports are reference-identical. |
| P2-11 | Minor | Configuration failure behavior | `tokenomics/engine/config.mjs:38`, `:65`; `tokenomics/hooks/telemetry-capture.mjs:1312` | Validation accepts `receipts:null`, `paths:null` and `intents:null`; consumers then fail at different depths. Settings-load exceptions are also now an early failure point, including before formerly harmless/no-op operations. This is not an absent-settings regression, but it contradicts the loader's fail-at-load guarantee. | `validateSettings({...TA_DEFAULTS, extension:null, receipts:null})` returns successfully; `receiptsRoot` subsequently throws. Equivalent null overrides for paths/intents also pass. Malformed JSON does produce the named settings error as intended. | Validate all consumed nested structures and preserve clear hook/CLI failure semantics. Address this before enabling foreign capture, rather than relying solely on a future doctor command. |
| P2-12 | Minor | Differential observation boundary | `replay/collect.mjs:12`; `replay/runner.mjs:61` | “Every output” currently means only manifest-selected filesystem roots and opted-in stdout/stderr. An accidental new write elsewhere in the sandbox, or a changed uncaptured CLI diagnostic, is invisible to the differential. | `seed-claude-basic/replay.json` selects only `.agents/telemetry` and `.agents/automation` and captures neither stream. The collector walks only those roots; comparison cannot detect an extra write to another path. This boundary predates Plan 2. | Track sandbox filesystem changes with narrow explicit exclusions for fixture/setup artifacts, and capture stable diagnostics for relevant entry points. Scope the byte-equality claim accurately until then. |

### Reproduction A — local replay failure

Run from the repository root. The existing replay helper creates and removes its normal temporary sandboxes; it does not change fixtures.

```sh
node scripts/diff-impl.mjs
node --input-type=module <<'NODE'
import {runCase} from './replay/runner.mjs';
import {goldenFiles} from './scripts/diff-impl.mjs';
const c = 'corpus/cases/fault-capture-stage-locked';
const g = goldenFiles(c + '/expected/49577c7');
for (const impl of ['reference/49577c7', 'tokenomics']) {
  const r = await runCase(c, impl);
  console.log(impl, r.exits,
    Object.keys(r.files).filter(k => !(k in g)),
    Object.keys(g).filter(k => g[k] !== r.files[k]));
}
NODE
```

Observed for **both** implementations: exits `[0,0]`, extra `['stage-tmp/xcrun_db']`, differing existing files `[]`. Its contents identify Xcode/SDK tooling. This demonstrates host contamination of the golden comparison, not an engine/reference logic mismatch. It reproduced outside the initially concurrent gate runs.

### Reproduction B — TA-default submission difference without disk writes

The filesystem mock supplies an existing accumulated document and captures generated output in memory. Both implementations get the same input; the engine gets the real TA extension and its absent-file defaults. The export CLI delegates to this function after loading that extension.

```sh
node --input-type=module <<'NODE'
import * as ref from './reference/49577c7/scripts/build-tokenomics-export.mjs';
import * as eng from './tokenomics/scripts/build-tokenomics-export.mjs';
import * as ta from './tokenomics/extensions/test-automation.mjs';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const doc = JSON.parse(fs.readFileSync(
  'corpus/cases/cov-dispatch-batch/expected/49577c7/.agents/telemetry/automation/export/runs.json', 'utf8'));
delete doc.segment.stop;
delete doc.segment.owner_group;
const files = {};
fs.existsSync = p => String(p).endsWith('/export/runs.json');
fs.readFileSync = () => JSON.stringify(doc);
fs.mkdirSync = () => {};
fs.writeFileSync = (p, v) => { files[p] = v; };
syncBuiltinESMExports();
for (const [name, fn] of [
  ['reference', () => ref.writeSubmission('/virtual')],
  ['engine', () => eng.writeSubmission('/virtual', {}, undefined, ta)],
]) {
  const r = fn();
  console.log(name, files[r.dir + '/submission.md'].split('\n')
    .filter(l => l.startsWith('# Submission') || l.includes('Stop')));
}
NODE
```

Reference: `# Submission — UNSET-factory-id (` + `` `undefined` `` + ` stop)` and a `Stop · owner` row containing two `undefined` values. Engine: `# Submission — UNSET-factory-id` only. Improving malformed/incomplete-data presentation is reasonable in B2; it is still a B1 behavioral difference. No normal, complete-profile submission difference was found.

### Reproduction C — coverage bypass without file changes

```sh
node --input-type=module <<'NODE'
import {gate, weakFnExclusions, branchScope, branchGate} from './scripts/coverage.mjs';
const f = 'scripts/example.mjs', k = f + '#f@0';
const dead = Array.from({length:100}, (_, i) => ({
  id:`${f}:${i+1}:1:12345678`, file:f, inFns:[k]
}));
const ex = [{file:f, fn:'*', wholeFile:true,
  kind:'typo-not-an-approved-kind',
  reason:'This is a deliberately invalid exclusion kind with more than forty characters.'}];
console.log(gate([k], ex), weakFnExclusions(ex));
console.log(branchGate(branchScope(dead, ex).scoped, [], {[f]:100}));
console.log(branchGate([dead[0]], [{id:dead[0].id, kind:'unreachble',
  reason:'A sufficiently long reason without any source citation at all.'}], {[f]:100}));
NODE
```

All open/stale/weak/over-budget arrays are empty. Changing the wildcard's kind to the valid `approved-reachable` still exempts all 100 blocks; kind validation alone does not fix the budget problem.

### Reproduction D — root order changes foreign policy

This reads existing golden trees, supplies only the foreign settings file virtually, and runs the exported CLI `main` in period-report mode (`write:false` for cost recomputation). No fixture is edited.

```sh
node --input-type=module <<'NODE'
import fs from 'node:fs';
import {resolve, join} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {main} from './tokenomics/scripts/team-report.mjs';
const a = resolve('corpus/cases/cov-dispatch-batch/expected/49577c7');
const b = resolve('corpus/cases/foreign-settings/expected/engine');
const m = JSON.parse(fs.readFileSync('corpus/cases/foreign-settings/replay.json', 'utf8'));
const p = join(b, '.agents/tokenomics/settings.json');
const ex = fs.existsSync, rd = fs.readFileSync;
fs.existsSync = x => x === p || ex(x);
fs.readFileSync = (x, ...args) => x === p
  ? m.repo.files['.agents/tokenomics/settings.json'] : rd(x, ...args);
syncBuiltinESMExports();
const write = process.stdout.write;
for (const roots of [[a,b], [b,a]]) {
  let out = '';
  process.stdout.write = s => { out += s; return true; };
  const code = await main([...roots, '--json']);
  process.stdout.write = write;
  const r = JSON.parse(out);
  console.log(roots[0] === a ? 'TA-first' : 'foreign-first', code,
    r.byBatch.map(x => ({batch:x.batch, gate:x.gate, drift:x.drift})), r.cases);
}
NODE
```

Observed TA-first: foreign `sp1` and `sp2` each acquire `gate:null, drift:false`; `cases.reports=1`, `examined=3`, with TA outcomes. Foreign-first: no `gate`/`drift` even on the TA batch; `cases.reports=2`, `examined=2`, outcomes `{done:2}`. Receipt totals should include all compatible inputs, not select a different subset depending on argument order.

## 2. Ruling-by-ruling verdicts

These are every substantive `Ruling` in the **Plan 2 execution ledger**; pre-flight references to P1–P3 are not separate rulings. Line numbers refer to `docs/plans/plan-2-ledger.md` at the reviewed tag. “Agree” does not confer the owner's required exclusion approval.

| Ledger line / ruling | Verdict | Reason |
|---|---|---|
| 31 — P1, whole-file/function branch scope | **Disagree in blanket form; reverse before migrations.** | Optional subsystem scope can be explicit, but replayed export branches and unlimited function waivers defeat the promised closure/budget. |
| 32 — P2, count all branch exclusion kinds | **Agree.** | Stricter counting is appropriate; add kind validation and account for function-level waivers. |
| 33 — P3, deliberate nonzero golden exits | **Agree.** | Designed failures need an oracle for both their exit and their observable diagnostic/artifacts. |
| 42 — widen scanner for real missed surfaces | **Agree.** | Regex literals, sizing and split paths were real domain dependencies. |
| 44 — add group-wording category | **Agree.** | Rendered batch vocabulary is an explicit configuration responsibility. |
| 45 — single `enrichGroup` owner for campaign matching | **Agree.** | One owner avoids divergent domain matching; §14.3 permits signature finalization. |
| 70 — read-only `/dev/null` receipt case | **Agree for macOS/Ubuntu.** | It is a disclosed, stable character-device input on these platforms; it is not evidence of Windows portability. |
| 75 — replay `HT_PLATFORM` override | **Agree.** | It makes platform-selection branches testable; it does not emulate filesystem semantics or host tools (P2-01). |
| 79 — meter override as fault-injection lever | **Agree.** | It is an existing executable-input surface and can mutate only the test sandbox in these cases. |
| 80 — chmod 0500 with root caveat | **Disagree as a portable-gate conclusion.** | A caveat is candid but insufficient: enforce the non-root prerequisite or provide a supported root alternative. The related sizing mode-000 case has the same issue. |
| 81 — move local `v0.1.1-rc.1` to gate commit | **Agree with the recorded local/unpushed authorization.** | A candidate should identify its tested state; this review performed no tag mutation. |
| 87 — shared `expectedExits` helper | **Agree.** | One expectation rule prevents gate/golden divergence. |
| 89 — missing golden must be an error; exact case set | **Agree, with P2-08 follow-up.** | Missing evidence must fail; the remaining engine-only exemption needs independent control. |
| 94 — lift configuration in unreplayed files | **Agree with supplemental verification.** | Ownership cannot depend on corpus reachability; copied unit tests alone cannot establish off-corpus byte equality, as P2-02 demonstrates. |
| 96 — scalar vocabulary and derived forms | **Agree on shape; disagree with indefinite visible residue.** | It matches §14.4; irregular plurals can remain a documented limitation, but generic visible TA prose should still be lifted. |
| 100 — consonant+y plural | **Agree.** | It supports the spec's “story” example without changing TA bytes. |
| 105 — seven names, `(input, ctx)`, phase dispatch | **Agree.** | Signatures are explicitly indicative; ownership remains the normative constraint. Freeze/version the richer phase/part contracts before C1. |
| 106 — async entry points and trailing `ext=null` | **Agree for CLI loading; disagree with an unqualified API-equivalence claim.** | Async loading is reasonable; direct helper callers now need explicit TA context (P2-10). No separate normal-input async exit/order regression was reproduced. |
| 107 — exempt `exportRow` from corpus trace | **Disagree; superseded by actual reachability.** | Close reaches exportRow, and current tests correctly require those phases; only the four named CLI phases remain unreached. |
| 120 — present settings must name extension; relative paths resolve at repo | **Agree.** | Spec omission semantics are unspecified and its example includes `extension`; explicit selection prevents accidental TA inheritance. The absent-file B1 behavior is preserved. |
| 121 — defer export wildcard narrowing to Plan 3 Task 1 | **Disagree as evidence of completed Plan 2 coverage; accept only as the first repair prerequisite.** | The reason is now truthful, but reached branches remain excluded; do not begin behavioral migrations first. |
| 122 — reason rules and `wholeFile:true`, no function budget | **Agree with stronger validation; disagree that it closes the bypass.** | The flag documents scope but does not constrain it (P2-03/P2-04). |
| 123 — blanket parking of remaining issues | **Disagree for gate integrity and foreign isolation; partially agree otherwise.** | Unrestricted exemptions, scanner blind spots and mixed-root extension behavior are baseline risks. Packaging, CJS `require(esm)`, mature installer work and stylistic minors can remain separately scheduled. |
| 129 — move `v0.2.0-rc.1` to final ledger commit | **Agree with the recorded authorization.** | The reviewed tag does include the final fix wave; that does not replace independent verification. |

### Contract interpretation and deferred ledger items

- **Layout and ownership (§14.1/§14.3):** the runtime imports stay within the installable `tokenomics/` subtree. Keeping the reference snapshot alongside it as a test oracle is not a second production engine. Keeping entry-point filenames stable is useful for replay. Missing production packaging artifacts are later milestones, not an extraction blocker.
- **Extension signatures:** seven names plus roughly three dozen documented call/phase combinations is a larger API than seven simple functions. `ctx.part`, injected renderer helpers and mutable classifier state also matter. The `name:phase` trace verifies executed wrapper calls, not every `part`, argument shape, return contract, or a bypass that never uses `hook`. The explicit provisional warning (`tokenomics/ENGINE-B1.md:432`) is appropriate. B2/C1 needs a stable contract, not merely the same list of names.
- **Foreign evidence:** the null-extension spy has a meaningful TA control that reaches all seven names; this is no longer the original vacuous empty-trace test. The foreign directory/ID/vocabulary fixture is useful. Neither proves absence of embedded TA assumptions everywhere, and neither tests mixed-root settings (P2-05).
- **Settings:** requiring explicit extension is consistent with the spec; keeping `ratioIntents` in settings is not. `ids.normalize`/`mineFrom`, manifest revisions, command receipts, enforcement and foreign report placement remain unfinished port work. Do not silently accept the spec example and claim its full semantics have been implemented.
- **Deferred minors:** trailing-comment scanner false positives, dedupe/category tests, report generation CLI tests, drifting documentation line numbers and the stale function-only sentence in `corpus/coverage/report.md:5` are bounded maintenance. Citation/kind validation, function-exclusion scope, engine-only exemptions and scanner coverage deserve Task 1 treatment. HTML escaping of vocabulary, nested-ledger A4 coverage, malformed settings, and multi-root policy need explicit owners before foreign use. Fault-case cleanup must restore modes in `finally`; deleting mode-000/0500 directories can otherwise fail after a replay abort.
- **Plan 1 carry-over missed by Plan 2:** `docs/plans/plan-1-ledger.md:78` explicitly assigned allocation-grain checking to Plan 2. `tokenomics/kit/conservation.mjs:20` still checks sums without a grain/dispatch field, and Plan 2 contains no grain implementation. Reconcile this obligation before §14.8 items 2/3/7; arithmetic conservation alone cannot reject a semantically invalid partition of session active minutes.
- **Reference findings to preserve as before-cases:** empty `--repo` skips sizing; zero-session tokenomics percentages become `NaN%`; unsorted subagent enumeration is platform-sensitive; VS Code out-of-range op-log updates drop a session, missing timestamps allow re-appends, a subagent transcript directory breaks dispatch, and a scopes file loses capture. Plan 1 additionally identified symlinked entry guards and kit loading when scopes is a file. These are migration candidates, not excuses to change B1 goldens without declared diffs.

## 3. Exclusion verdicts

There are **11 current approved-reachable entries**: five function/file entries and six branch entries. The removed `scripts/batch-cost.mjs:359:77:bf7aa6ca` is not one of them; the final sizing-locked case replaced it. The ledger/CASES list records “owner sign-off needed”; I found no distinct completed owner approval for the current list. Recommendations below are **not owner sign-off**.

Function identifiers are given as `<file>#<fn>@<offset>` where applicable; branch IDs are exact manifest IDs. All reference line citations in this section are relative to `reference/49577c7/`.

| Approved-reachable ID | Verdict and challenge |
|---|---|
| `scripts/build-tokenomics-export.mjs#*` | **Reject as whole-file closure.** `loadProfile`, `appendRun`, segment/row construction and checklist are exercised by close. Narrow to actual unreached functions, then close the now-visible branch gaps. Add CLI/submission coverage: P2-02 is a demonstrated miss. |
| `scripts/install-hooks.mjs#*` | **Conditionally accept explicit installer scope exclusion.** It is outside this corpus's capture/scope/join focus and has copied unit tests, but it was edited in B1. “Spec non-goal” is too broad: installation is an eventual spec requirement. Require owner approval of the milestone boundary and foreign-output follow-up. |
| `scripts/otel-report.mjs#*` | **Conditionally accept optional OTel scope exclusion.** The file was byte-identical to the vendored reference in this comparison. Keep its exclusion explicit; do not generalize it to all report code. |
| `hooks/otel-sink.mjs#*` | **Conditionally accept service-behavior scope, correct the rationale.** `cov-capture-otel-local` actually spawns the child and coverage sees it. An external live collector is not needed to exercise a local receiver with synthetic requests. The defensible reason is deferred optional service coverage, not impossibility of testing. Source is byte-identical to reference. |
| `scripts/work-scope.mjs#(anonymous)@17884` | **Conditionally accept defensive outer rejection handling.** Ordinary CLI argv elements are strings and most work is inside `main`'s try/catch. The stated argument-parsing example is not a concrete CLI input. Specify the exceptional host/runtime failure being waived rather than imply an ordinary untested argument reaches it. |
| `hooks/scope-hook.mjs:182:7:3f92c5a6` | **Accept with owner approval.** Closed/unusable fd 0 can fail the stdin getter/listener setup; the current runner always supplies a pipe. A future explicit fd-mode facility could replace the exclusion. |
| `hooks/telemetry-capture.mjs:705:51:be4a91d4` | **Accept with owner approval.** Successful transcript read precedes this stat; the meter executes later. A persistent bad symlink or directory fails earlier, not at this catch. Requires external mutation between operations. |
| `hooks/telemetry-capture.mjs:1278:53:ceddb3ba` | **Accept with owner approval.** `existsSync` immediately precedes stat, without the meter lever in between. Static dangling symlinks do not pass the first check. |
| `hooks/telemetry-capture.mjs:544:32:4c9419d8` | **Accept for the stated portable same-filesystem sandbox.** Hard-link refusal can be exercised with EXDEV or file flags, but those require host-specific facilities. Fresh staging destinations and ordinary readable same-filesystem inputs do not supply that failure. Revisit if the harness gains a portable filesystem-failure mechanism. |
| `hooks/telemetry-capture.mjs:1328:30:afcc7777` | **Accept with owner approval.** A TTY is not produced by the pipe-based runner; this is a limitation of the replay interface, not dead reference code. |
| `hooks/telemetry-capture.mjs:1331:5:9a64ef9f` | **Accept with owner approval.** The runner supplies readable fd 0 ending at EOF; closed/nonblocking-fd failure is outside that input model. |

### Sampled unreachable entries

“Accept” below is relative to the **replayed CLI call graph**, not arbitrary direct imports. Calling exported helpers with impossible internal objects is not sufficient to refute a CLI-reachability proof.

| Unreachable ID | Adversarial check / verdict |
|---|---|
| `scripts/batch-cost.mjs:177:38:491f186e`, `scripts/batch-cost.mjs:205:33:4753add1` | **Accept.** `loadReceipts` requires array `cases`; missing/wrong-type cases are rejected before these fallback arms. |
| `scripts/batch-cost.mjs:386:23:afcc7777` | **Accept.** The only relevant caller already guards nonempty `sizings0`. Empty sizing data bypasses the function. |
| `scripts/batch-cost.mjs:585:60:6c519920`, `scripts/batch-cost.mjs:639:56:6c519920` | **Accept.** Constructed buckets carry token-quad objects. Negative, overflow and wrong-type numeric inputs do not make those objects nullish. |
| `scripts/team-report.mjs:314:141:12aa13ea`, `scripts/team-report.mjs:777:204:8940d3ad`, `scripts/team-report.mjs:419:223:788aed16` | **Accept.** Recomputed case rows always carry numeric `loaded.activeMin`. `NaN` is still non-nullish; null/wrong-type source values are normalized earlier. |
| `scripts/team-report.mjs:429:41:3b875f7d` | **Accept.** Cost construction always supplies `byRole`; malformed input can fail earlier but does not produce the absent-field branch via the normal CLI. |
| `scripts/team-report.mjs#f@24782` | **Accept.** All actual `line4` call sites pass a formatter; arbitrary external calls do not change this local call graph. |
| `hooks/telemetry-capture.mjs:600:4:5b2bcfd0` | **Accept.** Both the try and catch return before this continuation. |
| `hooks/telemetry-capture.mjs:1068:49:720d2ef5` | **Accept.** Even an empty string split yields an array containing a string; `.pop()` is not undefined here. |
| `hooks/telemetry-capture.mjs:883:13:6f3b1e96` | **Accept for these callers.** Capture main uses `||` for cwd and the installer supplies a resolved path. This differs from work-scope's `??` behavior; the empty work-scope repo regression is already a case. |
| `scripts/work-scope.mjs:329:54:7c8a89b4` | **Accept for ordinary replay inputs.** Current throw sites yield Error objects carrying messages. A future extension throwing a primitive would require re-auditing the engine contract, but does not change this frozen reference call graph. |

Additional checks: ran 176 in-memory reference/engine TA cost comparisons spanning `null`, zero, negative, huge and tiny numbers, strings, booleans, arrays, objects, varied labels, and empty/prototype-like IDs; no differences after excluding `generatedAt`. A separate review sweep included `NaN`/overflow and all four batch renderers. These support the sampled constructed-object proofs, not exhaustive correctness. Existing symlink, file-as-directory, empty-repo, meter-race and locked-directory corpus cases were replayed. The meter lever correctly replaced previously overbroad exclusions; it does not run between the two remaining stat race pairs.

## 4. Recommended Plan 3 Task 1

**Task 1: repair and freeze the B1 oracle, then finalize the migration boundary.** It should produce concrete artifacts and exit criteria, rather than immediately implementing §14.8 behavior changes.

1. **Restore a reproducible baseline.** Resolve P2-01; run the differential, reference goldens and complete tests on macOS and Ubuntu, at Node 18.19 (the declared minimum) and the current CI major. State and enforce privilege requirements for chmod cases. Ensure failed cases restore modes and clean up. Add a bounded failure to OTel tests when local listening is unavailable so a restricted environment reports an intelligible limitation instead of hanging.
2. **Close export and exclusion holes.** Add missing export CLI variants (`--batch`, `--stdout`, `--compare`, `--submission`, `--anon`, missing/incomplete profile and accumulated segment), preserve TA output for P2-02, narrow `build-tokenomics-export`'s wildcard, and close its resulting branch gaps. Validate exclusion schemas/citations; explicitly approve exceptional file scope; account for function-covered branches. Obtain the owner's decision on all 11 current approved-reachable entries, dropping entries replaced by new cases.
3. **Strengthen the safety gates.** Independently control engine-only case exemptions; recursively inventory generic engine modules and detect duplicate occurrences. Add a check that the oracle's replay actually completed with expected exits, rather than using coverage counts alone. Preserve both missing/extra output checks and cover writes outside currently selected roots plus stable CLI diagnostics (P2-12). Document V8 range totals as runtime-dependent, not a stable abstract branch count.
4. **Fix foreign isolation before depending on it.** Add mixed-root order tests and per-root settings/extension handling (or an explicit incompatible-root error). Test JSON prose and foreign installer output as well as schema keys and paths. Validate the nested settings the engine consumes. Keep the positive TA spy control and verify important phase/part argument and return contracts.
5. **Write the B2 contract/migration map.** Resolve §14.4's manifest/settings split (`ratioIntents`, receipt reading policy, revision binding) and define the public imported-function context. Freeze the extension API before C1, including phases/parts and synchronous return expectations. Account for the Plan 1 grain-checking obligation: add grain/source-dispatch evidence to conservation tests before shared allocation/inclusive-token/active-minute migrations.
6. **Register all expected changes.** Give each §14.8 item its own before/after fixture and an exact allowed differential, including new reference defects recorded by both ledgers. The existing differential knows only zero diff; introduce explicit migration expectations before using it for B2. Do not regenerate all reference goldens to absorb failures or rewrite historical reference data.

Exit criteria: complete baseline test runs with environment limitations resolved or explicitly bounded; zero unexplained differences; zero open/stale/weak/over-budget in-scope coverage entries; independently approved exclusions and engine-only cases; clean recursive inventory; foreign null isolation including multi-root reports; and a reviewed spec-to-migration map. Ratio/manifest implementation can then land with its appropriate declared B2 migration, rather than being smuggled into baseline repair.

## 5. What was checked and what could not be checked

### Executed checks

Environment: macOS (`darwin`), Node `v24.14.1`, UID 501, Git selected as `/usr/bin/git`, restricted filesystem/network sandbox. HEAD and both tags resolved to the requested commits; the working tree was initially clean.

| Check | Actual result |
|---|---|
| `node scripts/inventory.mjs` | Passed: 371 reference sites, zero unassigned/stale/invalid; 57 engine sites, zero unlisted/stale/invalid. Subject to P2-07's scope. |
| `node scripts/diff-impl.mjs` | **Failed**, exit 1: 52 reference cases, 1 differing (`fault-capture-stage-locked`, extra `stage-tmp/xcrun_db`). |
| Reference coverage via imported `measure`, `gate`, `weakFnExclusions`, `branchScope`, `branchGate` | Passed its current gates: 453 functions, 19 uncovered all excluded; zero open/stale/weak/over-budget. Calling the CLI would rewrite `corpus/coverage/report.md`, so it was deliberately not used. |
| `npm test` | Started the full suite. Two reproducible assertion failures (B1 gate and reference golden, both P2-01). OTel sink tests could not bind localhost; a direct listen probe returned `EPERM`. Interrupted the stalled run after about 179 seconds: reported 430 tests, 427 pass, 2 fail, 1 cancelled; command exit 130. This is **not** a complete green 433-test run. |
| Isolated `runCase` for stage-locked, reference then engine | Reproduced the extra file in both with expected exits and otherwise matching existing output. |
| In-memory export, multi-root, coverage-validator, inventory-dedupe and TA join probes | Reproduced P2-02/P2-03/P2-04/P2-05 and duplicate-site behavior; numeric/type comparisons found no additional TA join differences. |

Measured in-scope branches: scope-hook 1 excluded / 71 total; work-scope 1/142; batch-cost 16/449; team-report 44/575; capture 32/813. No blocks were covered by individual function exclusions in this run. Export's 32/92 dead blocks were excluded at file scope. Thus the current measured budgets are comfortably below 15% in the five admitted files; the criticism is the waiver mechanism and omitted export scope, not a falsely reported over-budget current file.

### Review coverage and limits

- Read the binding spec sections, Plan 2 goal/constraints/review focus/task contracts, both ledgers, engine record, inventory/allowlist, corpus documentation, changed gates/replay code, configuration/extension code and the engine-versus-vendored diffs. Reviewed all current approved-reachable exclusions and sampled unreachable call-chain proofs. Parallel read-only standards and spec reviews supplemented the primary review.
- Examined the sync-to-async main guards and extension-loading order. Under absent settings, no additional ordinary-input exit/order regression was established. Error stacks necessarily have moved source locations, so equivalence claims should distinguish stable diagnostics from raw stack bytes. Malformed present settings are a new contract surface and intentionally throw; P2-11 concerns incomplete validation rather than denying that contract.
- Inspected installer changes and found foreign prose residue; did not activate an installer against the workspace or a real host configuration. Optional OTel source files are byte-identical to reference; live receiver behavior could not be verified because the sandbox denies binding. The full test interruption is disclosed rather than attributed to an extraction regression.
- Did not run Ubuntu, Node 18.19, another Node major, or a root user. CI's `node: [18,24]` matrix (`.github/workflows/ci.yml:7`) tests a moving Node 18 release, not specifically its 18.19 minimum. V8 range boundaries/counts and filesystem enumeration can vary; `HT_PLATFORM` alone proves neither OS equivalence nor deterministic directory order. Root ignores the deliberate permission faults; this is a documented unsupported condition until handled explicitly.
- Did not demonstrate a false-positive branch hit caused by the V8 character-painting algorithm; do not read P2-03 as such a claim. Its observed-range union, source-position IDs and start-only identity deserve runtime-matrix checks. Coverage also does not itself assert replay exits (`scripts/coverage.mjs:24`); a clean coverage report is not a substitute for a successful differential/reference replay.
- No private raw-corpus directory was read or copied. Real-session checks used only the already committed sanitized cases and recorded facts. No reference file, source file, fixture, ledger, tag, branch, remote or commit was changed. Test/replay helpers used their ordinary temporary runtime sandboxes; the only repository artifact created by this review is this file.
