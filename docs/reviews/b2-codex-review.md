Not approvable

# B2 independent milestone review — v0.3.0-rc.1

Reviewed `v0.2.1-rc.2` (`952ebe57aec91199f5ca5eca8897132acaa4234d`) → `v0.3.0-rc.1^{}` / `main` / HEAD (`9d3a5c04c064289d24e513cc879d6b7e9b99bce6`), 2026-10-13. File/line citations refer to that HEAD. The annotated tag object is `28e7f2e71c01add4520a9ef00875212834cb55a8`.

The current corpus passes the migrations-off differential, and the previous six narrowly identified defects have been addressed. B2 still cannot be accepted: three adversarial fixtures pass the full declared-diff checker despite undeclared output, and seven additional findings concern shipped accounting, privacy or report behavior. The checker reproductions use synthetic accepted fixtures, not modified production code or corpus goldens. Passing the existing corpus therefore does not contradict these findings.

## 1. Findings

Severity follows the requested definition: **Blocker** = the checker can certify undeclared output or a shipped obligation is violated; **Major** = a material behavior or observation failure; **Minor** = a bounded correction. There are **9 Blockers and 1 Major**. Some predicates are inherited from B1; they are identified because this milestone's acceptance explicitly requires the complete gate and shipped obligations to hold.

| ID | Severity | Area | File:line | Finding | Evidence (reproduction below) | Fix |
|---|---|---|---|---|---|---|
| B2-01 | Blocker | Replay observation / gate exactness | `replay/observe.mjs:62`; `replay/sandbox.mjs:19` | Scrubbing a path before inserting it into a `Map` can merge distinct filesystem entries. A literal `<REPOKEY>` filename overwrites the entry for the actual encoded sandbox-repo path, concealing an extra file. This is the Task 2 ledger's deferred “minor,” but its effect is an undeclared-output pass. | **A, scrub-collision:** baseline creates `<REPOKEY>`; bad implementation additionally creates the encoded repo-path filename with `UNDECLARED` bytes. Full `checkMigrations` returns no problems in none/isolation/default/all. Renaming the extra file to `NON_COLLIDING` makes every mode fail. | Preserve distinct raw identities through normalization, or reject collisions explicitly before overwriting. Add a full-gate extra-file regression, including collisions between literal normalization tokens and real paths. |
| B2-02 | Blocker | Output/event namespace / gate exactness | `replay/runner.mjs:75`, `:112`, `:119`; `replay/collect.mjs:9` | A real selected output named `__events__/0.stdout` is silently replaced by event 0's captured stream when file maps merge. Its contents are also excluded from supplemental observation. Neither manifest nor registry validation reserves this namespace. The same structural risk applies to `__sandbox__/changes.txt`. This merge hazard is inherited. | **A, namespace:** output roots `out` and `__events__`; stdout is always `stream\n`. Change the real file from `APPROVED` to `UNDECLARED`: all four checker modes pass. Control filename `__events__/1.stdout` is detected. | Keep filesystem outputs and synthetic observations in disjoint typed namespaces, or fail loudly on collisions and reject reserved output roots. Never silently overwrite one observation with another. |
| B2-03 | Blocker | Selected output bytes / gate exactness | `replay/collect.mjs:23`; `scripts/migrations.mjs:59`; `replay/runner.mjs:106` | Selected files are decoded with replacement-character UTF-8 semantics before comparison. Distinct invalid byte sequences become identical strings; selected roots are excluded from the raw-byte-aware supplemental snapshot. Thus the §18.2 declared-output byte guarantee is false. This decoder behavior is inherited. | **A, binary:** baseline `out/raw.bin` is byte `80`; bad output is byte `81`. Both decode to U+FFFD, and all four full-checker modes pass. Changing the bad byte to `41` is rejected in all modes. No hash collision is involved. | Preserve binary bytes in the oracle, or reject invalid UTF-8 explicitly rather than accepting lossy decoding. Apply an explicit byte policy to event streams too. |
| B2-04 | Blocker | Inclusive readers / O10 | `tokenomics/scripts/batch-cost.mjs:477`; `tokenomics/scripts/team-report.mjs:450`, `:460` | Some reader breakdowns still add informative dispatch tokens to an inclusive session. Scalar totals honor `tokensBasis`, while model totals and period role totals do not. The map explicitly includes per-role reading in item 3. | **B:** inclusive parent input 100, informative dispatch input 40: batch total is 100 but `totals.tokensByModel.model.input` is 140. With both roles `lead`, period total is 100 but `byRole.lead.tokens.input` is 140. | Honor each persisted line's basis in every aggregate, independently of current capture switches. Keep any informative dispatch breakdown separate from inclusive totals; test model and same-role cases. |
| B2-05 | Blocker | Receipt manifest binding / D1, O4 | `tokenomics/scripts/batch-cost.mjs:522`; `tokenomics/scripts/team-report.mjs:1317` | Stamped receipt outcomes are interpreted by their archive in the period denominator but by current settings in group costs and delivered-only per-case statistics. One report contradicts itself, and changing settings can reinterpret historical group delivery. | **B:** receipt revision 2, archive `deliveredOutcomes:["done"]`, current settings retaining TA vocabulary. The same period JSON has `cases.delivered:1`, ratio cost 10, but `byBatch[0].delivered:0` and group ratio null. | Carry the receipt's resolved historical outcome vocabulary through group/per-case calculations. Propagate unavailable revision findings instead of substituting current settings. Retain the explicit revisionless-receipt ruling. |
| B2-06 | Blocker | Submission renderer / O1 | `tokenomics/scripts/build-tokenomics-export.mjs:244`, `:245`, `:276`, `:278`, `:279` | `writeSubmission` converts unknown costs, token categories and turns into zero aggregates. The report-robustness overflow/undefined fixes do not repair these unknowns. | **B:** real CLI export from a null-valued ledger produces a row with tokens/cost/turns all null; `submission.md` prints total `$0`, token categories `0 / 0 / 0 / 0`, turns `0`, without corresponding unpriced/unmeasured counts. Checklist failures elsewhere do not correct this false summary. | Aggregate measured values with measured/unmeasured counts; retain null when no measured contribution exists and render the counts beside partial or wholly unknown totals. Test the generated submission, not only the JSON row. |
| B2-07 | Blocker | Provisional live accounting / O1 | `tokenomics/scripts/batch-cost.mjs:118`, `:122` | The synthetic live parent is explicitly “not measured yet” but is assigned a zero token quad and zero turns/tool counters. This invented measured unit causes the join to emit zeros even when every live unit is unmeasured. | **C, unmeasured:** one Copilot live dispatch with null usage/counters yields `totals.tokens:0`, a zero quad, `tokensAttribution:"partial"`, and `turns:0, unmeasured.turns:0`. Tool counters likewise report zero instead of an all-unknown null. | Use null plus unknown counts for unobserved provisional parent quantities. Preserve measured zero when actually observed. Exercise both live HTML and its cost data. |
| B2-08 | Blocker | Capture robustness / O1 | `tokenomics/hooks/telemetry-capture.mjs:1425` | The timestamp-less recapture guard compares only turn count and input+output token sum. A later billing or other measurement update with unchanged counts is silently discarded, even though the parser sees it. | **D:** first sweep captures a timestamp-less VS Code request with no credits. Append op-log patch `copilotCredits:2`; parser now returns cost 0.02. Second sweep reports `captured:0`; persisted ledger remains `costUsd:null`. | Compare meaningful measurement state with the latest captured line, including null→measured changes, rather than only monotonic count growth. Append a superseding record for changed accounting and retain the no-change suppression test. |
| B2-09 | Blocker | Anonymisation / O9 | `tokenomics/engine/scrub.mjs:39`; `tokenomics/scripts/build-tokenomics-export.test.mjs:25` | Deep anonymisation scrubs values but copies object keys verbatim. A supplied work-item identifier survives in a nested extension field's key in the persisted anonymised dataset. The test helper traverses only values, so it cannot detect this leak. | **E:** work-item ref `PRIVATE-47` is anonymised in ordinary values but survives as `runs[0].extra["PRIVATE-47"]` after `writeSubmission(repo,{anon:true})`. No inference of an unknown secret is needed: the identifier is already in the scrub set. | Scrub identifying keys with an explicit collision policy, or reject unsupported identifier-bearing maps before export. Verify serialized output, including keys, across all rows. |
| B2-10 | Major | Reports location / live reports | `tokenomics/hooks/telemetry-capture.mjs:1573`; `tokenomics/engine/config.mjs:126`; `tokenomics/scripts/batch-cost.mjs:677` | Live HTML and relocated group directories share a namespace. Valid groups `foo` and `foo.html` collide at `reports/foo.html`; report generation then fails or the live page disappears. This is the Task 13 ledger's deferred collision. | **C, collision:** non-TA `{extension:null}` defaults to telemetry reports. Render `foo` live, then execute batch-cost for `foo.html`: exit 1, `EEXIST`. The reverse ordering reaches the live renderer's caught write failure. | Give live pages and group directories separate namespaces, or use a collision-free layout for every permitted slug. Add both ordering cases. |

### A — full checker false passes and negative controls (B2-01…03)

This creates only temporary fixtures, implementations and registries. It derives a baseline from the benign fixture implementation, declares only the ordinary `out/a.txt` migration, then substitutes the bad implementation. It invokes the real `checkMigrations`, collector and replay, without mocked filesystem or replay dependencies. Every attack returns `problems:[]` for `none`, `only:demo`, `default` and `all`; the controls fail all four modes. These are not claims that a current committed corpus case has one of these filenames or bytes.

Save the following as `/private/tmp/b2-checker-probes.mjs` and run `TMPDIR=/private/tmp node /private/tmp/b2-checker-probes.mjs`:

```js
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {runCase} from '~/dev/harness-telemetry/replay/runner.mjs';
import {checkMigrations} from '~/dev/harness-telemetry/scripts/migrations.mjs';
const root=mkdtempSync('/private/tmp/b2-checker-');
const template=JSON.parse(readFileSync('~/dev/harness-telemetry/scripts/fixtures/migrations/cases/m1/replay.json'));
function put(p,v){mkdirSync(dirname(p),{recursive:true});writeFileSync(p,v);}
for(const attack of ['namespace','binary','scrub-collision']) {
 const dir=join(root,attack), c=join(dir,'cases','m1'), impl=join(dir,'impl'), registry=join(dir,'registry');
 const m={...template,outputs:attack==='namespace'?['out','__events__']:['out']};
 put(join(c,'replay.json'),JSON.stringify(m));
 const start=`import {mkdirSync,writeFileSync} from 'node:fs';\nconst on=process.env.TOKENOMICS_MIGRATIONS!=='none';\nmkdirSync('out',{recursive:true});writeFileSync('out/a.txt',on?'demo\\n':'base\\n');\n`;
 const extra=attack==='namespace'?`mkdirSync('__events__',{recursive:true});writeFileSync('__events__/0.stdout',BAD?'UNDECLARED':'APPROVED');console.log('stream');`
 :attack==='binary'?`writeFileSync('out/raw.bin',Buffer.from([BAD?0x81:0x80]));`
 :`if(BAD)writeFileSync(process.cwd().replace(/[^a-zA-Z0-9]/g,'-'),'UNDECLARED');writeFileSync('<REPOKEY>','APPROVED');`;
 const script=bad=>start+extra.replaceAll('BAD',String(bad));
 put(join(impl,'scripts/w.mjs'),script(false));
 const baseline=await runCase(c,impl,{extraEnv:{TOKENOMICS_MIGRATIONS:'none'}});
 for(const [p,v] of Object.entries(baseline.files))put(join(c,'expected/49577c7',p),v);
 put(join(registry,'demo/migration.json'),JSON.stringify({id:'demo',item:1,spec:'probe',summary:'probe',beforeCases:['m1'],declared:{m1:{reason:'The declared migration changes only the ordinary output a.txt.',changed:['out/a.txt']}}}));
 put(join(registry,'demo/expected/m1/out/a.txt'),'demo\n');
 put(join(impl,'scripts/w.mjs'),script(true));
 const {results}=await checkMigrations({implDir:impl,casesDir:join(dir,'cases'),registryDir:registry,migrations:[{id:'demo',item:1,landed:true}]});
 console.log(attack,JSON.stringify(results.map(({mode,problems})=>({mode,problems}))));
 const control=script(true).replace(attack==='namespace'?'__events__/0.stdout':attack==='binary'?'0x81':"process.cwd().replace(/[^a-zA-Z0-9]/g,'-')",attack==='namespace'?'__events__/1.stdout':attack==='binary'?'0x41':"'NON_COLLIDING'");
 put(join(impl,'scripts/w.mjs'),control);
 const negative=await checkMigrations({implDir:impl,casesDir:join(dir,'cases'),registryDir:registry,migrations:[{id:'demo',item:1,landed:true}]});
 console.log(attack+' control',JSON.stringify(negative.results.map(({mode,problems})=>({mode,problems}))));
}
console.log(root);
```

### B — inclusive totals, historical receipts and submission unknowns (B2-04…06)

Save as `/private/tmp/b2-spec-repros.mjs` and run `node /private/tmp/b2-spec-repros.mjs`. This exercises the shipped CLIs with default migrations. Expected observed discrepancies:

```text
INCLUSIVE: tokens=100, tokensSplit.input=100, tokensByModel.model.input=140
INCLUSIVE_ROLE: total=100, role=140
STAMPED_RECEIPT: cases.delivered=1, perDelivered.costUsd=10,
                 byBatch[0].delivered=0, byBatch[0].perDelivered=null
UNKNOWN_ROW: tokens=null, cost=null, turns=null
UNKNOWN_SUMMARY: Total cost $0; tokens 0 / 0 / 0 / 0; sessions/dispatches/turns 1 / 0 / 0
```

```js
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const source='~/dev/harness-telemetry';
const root=fs.mkdtempSync('/private/tmp/b2-spec-');
const write=(r,p,o)=>{const f=path.join(r,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,typeof o==='string'?o:JSON.stringify(o));};
const quad=n=>({input:n,output:0,cacheRead:0,cacheWrite:0});
const baseline={v:1,host:'copilot',id:'s1',user:'u',repo:'r',role:'lead',cases:['TC-1'],startedAt:'2026-10-01T00:00:00Z',endedAt:'2026-10-01T01:00:00Z',capturedAt:'2026-10-01T01:01:00Z',tokensBasis:'inclusive',tokens:quad(100),tokensByModel:{model:quad(100)},models:['model'],costUsd:10,activeMin:60,wallMin:60,turns:1,toolCalls:0,toolErrors:0,scope:{intent:'automation',cases:['TC-1']},subagents:[{id:'d1',role:'lead',label:'TC-1',n:1,tokens:quad(40),tokensByModel:{model:quad(40)},activeMin:5,toolCalls:0,toolErrors:0}]};
const run=(script,args)=>{const r=spawnSync(process.execPath,[path.join(source,'tokenomics/scripts',script),...args],{encoding:'utf8',env:{...process.env,TOKENOMICS_MIGRATIONS:undefined}});if(r.status!==0)throw Error(r.stderr);return r.stdout;};
const init=(name,line,receipt={cases:[{id:'TC-1',outcome:'delivered',at:'2026-10-01T01:00:00Z'}]})=>{const r=path.join(root,name);write(r,'.agents/tokenomics/settings.json',{extension:null,reports:{location:'tree'}});write(r,'.agents/telemetry/automation/usage-u.jsonl',JSON.stringify(line)+'\n');write(r,'.agents/automation/g/report.json',receipt);return r;};
const inclusive=init('inclusive',baseline);
const incl=JSON.parse(run('team-report.mjs',[inclusive,'--batch','g','--json']));
console.log('INCLUSIVE',JSON.stringify({tokens:incl.totals.tokens,tokensSplit:incl.totals.tokensSplit,tokensByModel:incl.totals.tokensByModel}));
const roleRep=JSON.parse(run('team-report.mjs',[inclusive,'--since','2026-10-01','--until','2026-10-02','--json']));
console.log('INCLUSIVE_ROLE',JSON.stringify({total:roleRep.totals.tokens.input,role:roleRep.byRole.lead.tokens.input}));
const stamped=init('stamped',{...baseline,subagents:[],manifestRevision:2},{manifestRevision:2,revision:'2026-10-01T01:00:00Z',cases:[{id:'TC-1',outcome:'done',at:'2026-10-01T01:00:00Z'}]});
const manifest={module:'tokenomics',schema_version:'1.0',domain:'test',manifestRevision:2,ratioIntents:['automation'],receipts:{source:'files',root:'.agents/automation',file:'report.json',deliveredOutcomes:['done']}};
write(stamped,'.agents/telemetry/automation/module.json',manifest);write(stamped,'.agents/telemetry/automation/manifests/2.json',manifest);
const period=JSON.parse(run('team-report.mjs',[stamped,'--since','2026-10-01','--until','2026-10-02','--json']));
console.log('STAMPED_RECEIPT',JSON.stringify({cases:period.cases,byBatch:period.byBatch,perDelivered:period.perDelivered}));
const unknown=init('unknown',{...baseline,tokens:null,tokensByModel:{},costUsd:null,activeMin:null,wallMin:null,turns:null,toolCalls:null,toolErrors:null,subagents:[]});
write(unknown,'.agents/telemetry/automation/factory-profile.json',{factory_id:'example',factory_name:'Example'});
run('build-tokenomics-export.mjs',[unknown,'--batch','g']);
run('build-tokenomics-export.mjs',[unknown,'--submission']);
const outdir=path.join(unknown,'.agents/telemetry/automation/export/datasets/example');
const doc=JSON.parse(fs.readFileSync(path.join(outdir,'runs.json'),'utf8'));
const md=fs.readFileSync(path.join(outdir,'submission.md'),'utf8');
console.log('UNKNOWN_ROW',JSON.stringify({tokens:doc.runs[0].tokens,cost:doc.runs[0].cost_api_equivalent_usd,turns:doc.runs[0].turns}));
console.log('UNKNOWN_SUMMARY',md.split('\n').filter(l=>/Total cost|Tokens \(in|Sessions \/ dispatches/.test(l)).join('\n'));
console.log('SCRATCH',root);
```

### C — live unknowns and report-path collision (B2-07, B2-10)

Save as `/private/tmp/b2-live-review.mjs`; run `node /private/tmp/b2-live-review.mjs`. The collision subprocess exits 1 with EEXIST. The second fixture returns tokens 0, attribution partial, turns 0 with zero unmeasured turns, although the parent was never measured. Its dispatch token/tool unknown counts do not make the invented parent zero valid.

```js
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const ROOT='~/dev/harness-telemetry';
const {renderLiveReport}=await import(`${ROOT}/tokenomics/hooks/telemetry-capture.mjs`);
const {loadLiveLines,updateBatchCosts}=await import(`${ROOT}/tokenomics/scripts/batch-cost.mjs`);
const {loadSettings}=await import(`${ROOT}/tokenomics/engine/config.mjs`);
const root=mkdtempSync('/private/tmp/b2-live-review-');
const put=(repo,rel,data)=>{const p=join(repo,rel);mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,JSON.stringify(data)+'\n');};
const repo=join(root,'collision');
put(repo,'.agents/tokenomics/settings.json',{extension:null});
for(const slug of ['foo','foo.html'])put(repo,`.agents/automation/${slug}/report.json`,{cases:[{id:slug,outcome:'delivered'}]});
put(repo,'.agents/telemetry/automation/scopes/s.json',{v:1,session:'s',batch:'foo',cases:['foo'],intent:'automation'});
const live=await renderLiveReport(repo,'s',{},loadSettings(repo));
const r=spawnSync(process.execPath,[`${ROOT}/tokenomics/scripts/batch-cost.mjs`,repo,'--batch','foo.html'],{encoding:'utf8'});
console.log(JSON.stringify({collision:{repo,live,status:r.status,EEXIST:r.stderr.includes('EEXIST')}}));
const un=join(root,'unmeasured');
put(un,'.agents/automation/g/report.json',{cases:[{id:'TC-1',outcome:'delivered'}]});
put(un,'.agents/telemetry/automation/live/s.jsonl',{v:1,host:'copilot',agentId:'d',cases:['TC-1'],label:'TC-1',tokens:null,activeMin:null,toolCalls:null,toolErrors:null});
const line=loadLiveLines(un)[0], cost=updateBatchCosts(un,{write:false})[0];
console.log(JSON.stringify({unmeasured:{repo:un,parent:line.tokens,totals:cost.totals}},null,2));
```

### D — billing update lost during sweep (B2-08)

Save as `/private/tmp/b2-capture-repro.mjs`; run `node /private/tmp/b2-capture-repro.mjs`. Observed: `FIRST {captured:1,skipped:0}`, `PARSED_AFTER_BILLING 0.02`, `SECOND {captured:0,skipped:0}`; the only ledger line still has null cost. The synthetic host store is under `/private/tmp`; no real host store is consulted.

```js
import fs from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sweep,captureVsCodeSession,readRecords,ledgerPath} from '~/dev/harness-telemetry/tokenomics/hooks/telemetry-capture.mjs';
const base=fs.mkdtempSync('/private/tmp/b2-capture-');
const repo=join(base,'repo');fs.mkdirSync(repo);
const storage=join(base,'storage'), hash=join(storage,'h1');fs.mkdirSync(join(hash,'chatSessions'),{recursive:true});
fs.writeFileSync(join(hash,'workspace.json'),JSON.stringify({folder:pathToFileURL(repo).href}));
const f=join(hash,'chatSessions','credits.jsonl');
fs.writeFileSync(f,JSON.stringify({kind:0,v:{requests:[{requestId:'r0',promptTokens:10,completionTokens:5}]}})+'\n');
const config={priceAtCapture:false,capturePrompts:false,maxSweep:100};
const env={TOKENOMICS_CLAUDE_ROOT:join(base,'no-claude'),TOKENOMICS_COPILOT_ROOT:join(base,'no-copilot'),TOKENOMICS_VSCODE_ROOT:storage};
const run=(date)=>{const t=new Date(date);fs.utimesSync(f,t,t);return sweep(repo,{config,user:'tester',env,all:true});};
console.log('FIRST',run('2026-08-01T00:00:00Z'));
fs.appendFileSync(f,JSON.stringify({kind:1,k:['requests',0,'copilotCredits'],v:2})+'\n');
console.log('PARSED_AFTER_BILLING',captureVsCodeSession(repo,f,'credits',{config,user:'tester'}).costUsd);
console.log('SECOND',run('2026-08-02T00:00:00Z'));
console.log('LEDGER',readRecords(ledgerPath(repo,'tester')).map(l=>({costUsd:l.costUsd,tokens:l.tokens,turns:l.turns})));
console.log('SCRATCH',base);
```

### E — known identifier survives anonymised export (B2-09)

Save as `/private/tmp/b2-anon-key-review.mjs`; run `node /private/tmp/b2-anon-key-review.mjs`. `identifierSurvives` is true. The finding relies on `PRIVATE-47`, which is supplied explicitly as the work-item ref; the arbitrary path key is not needed to establish it.

```js
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {dirname,join} from 'node:path';
import {writeSubmission,exportPath} from '~/dev/harness-telemetry/tokenomics/scripts/build-tokenomics-export.mjs';
const repo=mkdtempSync('/private/tmp/b2-anon-key-review-');
const doc={schema_version:'1.0',segment:{factory_id:'fixture',scope:{},efficiency_techniques:[]},runs:[{work_item_ref:'PRIVATE-47',work_item_brief:'Confidential supplied brief',notes:'PRIVATE-47',extra:{'PRIVATE-47':'supplied identifier used as a map key','/secret/receipt.json':'path used as a map key'},tokens:null,cost_api_equivalent_usd:null}]};
const p=exportPath(repo);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,JSON.stringify(doc));
const {dir}=writeSubmission(repo,{anon:true});const s=readFileSync(join(dir,'runs.json'),'utf8');console.log({repo,path:join(dir,'runs.json'),identifierSurvives:s.includes('PRIVATE-47'),output:JSON.parse(s).runs[0]});
```

## 2. P3P-01…P3P-06 closure

| Prior finding | Closure | Verified evidence |
|---|---|---|
| P3P-01 — prototype-named paths | **Closed for the reported defect.** | Null-prototype maps and own-property membership are used in collection/composition/comparison. Rerun: undeclared `toString` → `extra toString`; declared `__proto__` remains an own entry containing `DECLARED`; nonexistent `toString` removal → `declares no change`. Full-gate root-name and actual collector regressions passed in `npm test`. This does not close the distinct observation aliases in B2-01…03. |
| P3P-02 — newline record collision | **Closed for the reported defect.** | `treeChanges` emits JSON arrays. The original one-link/two-link reproduction now compares unequal; actual symlink/newline replay regression passed. Path scrubbing introduced a separate lossy-map case, B2-01. |
| P3P-03 — recorder owner/no-op validation | **Closed for the reported defect.** | Owner checks now include conflicted keys, and listed keys showing no change cause a refusal before after-file replacement (`scripts/migrations.mjs:438`). The no-write owner/no-op regressions at `scripts/migrations.test.mjs:639`, `:657` passed. |
| P3P-04 — Git observation claims | **Closed as qualified documentation, not new portability evidence.** | README, CASES and `gitDirSummary` now specify raw committed blobs, detached HEAD, Git availability, object format and gitlink limits. README names `untracked`; spec §18.2 adopts the owner's observation boundary. Linux/Ubuntu evidence is explicitly parked by the owner until publication. No Linux evidence was obtained in this review. |
| P3P-05 — missing-archive policy labels | **Closed.** | Owner Q11b selects the strict rule; D1 and item 8 consistently treat absent archives as unverified. The relevant manifest tests pass. B2-05 concerns a different reader that does not consistently apply the resolved receipt binding. |
| P3P-06 — normalized-only migration admission | **Closed.** | Owner-approved `entry-points` and `capture-robustness` groups declare genuine changes from their other items; the registry still requires landed evidence. Real unpreloaded pipe/symlink tests and deliberately unsorted-listing tests cover items 13/14. No vacuous before-case waiver was needed. |

The prior review's §4 was addressed across Plan 4 Tasks 1–3 and later migrations, rather than literally Task 1 alone. Owner decisions, the reserved `exit:<i>` rule, normalized-only group policy, `before-report-unknowns`/`before-ratio-revisions`, frozen B1 defaults, and API part/Promise evidence are present. Shared-allocation and active-minutes tests compare handwritten trace quantities with actual engine group outputs; this is meaningful evidence, although it is not a universal engine-emitted allocation trace. Copilot's kit traces alone do not cover B2-04's reader breakdowns.

The §4 **overall exit condition remains unmet**: there are demonstrated undeclared-output passes within the selected-output/final-state observation boundary, and null/zero, inclusive-reader and privacy acceptance is incomplete. The approved later owners remain distinct: B3 installer/archive and production enforcement; B4 mixed-reader rescue/rollback; C1 command-receipt glue. Those deferrals are not additional B2 findings. Unrestricted harness subsets are not a claimed production switch set; the owner's production set is `{}`.

## 3. Other requested checks

**Off path and composition.** The actual migrations-off differential is green on all 68 reference cases at the closing commit, including after `ratioIntents` removal. `TA_DEFAULTS` has no `ratioIntents`; frozen `B1_DEFAULTS` and its validation still provide it, and the foreign-settings regression passes. Exactness is established for those cases' observed outputs, not arbitrary accepted fixtures (B2-01…03). Independently composing all 71 cases with the declarers in forward and reversed order produced identical files/exits and no composition problems. Existing overlap declarations name every owner recognized by the composer; this does not prove undeclared causal ownership or every subset combination.

**API 2 (D3).** `EXTENSION_API` and the TA extension are 2; API 1/string-2/unsupported extensions are rejected with migrations on and off. Promise/thenable results throw the named synchronous-hook error; rejection handling and the once-per-hook stderr report are exercised in children. The frozen table's input/context/return descriptions were inspected, including token quads, settings variants and exact-id behavior; no additional mismatch was found. The migrations-off trace check passes in the suite. An independent default-on trace across 68 cases records **3,488 invocations, 38/38 documented calls reached, exact agreement for every part set, no undocumented calls**.

**Other migration behavior.** Exact-id boundary/case tests, fold attribution, shared-allocation full-cohort tests, active-minutes allocation distinctions, scope precedence/claim recovery, writer/restamp provenance, conflict canonicalization and role-dollar separation are exercised by substantive tests. The reproduced defects qualify the broader success claims; they are not repaired by correct neighboring totals or a passing declared golden. In particular, the receipt issue is historical binding, not the intentional difference between windowed period totals and membership-based group totals.

**Robustness.** Entry-point tests use actual symlinks and child pipes without replay's blocking preload, including large output and below-high-water-mark pending writes. Stable-enumeration tests intentionally substitute unsorted listings. Directory-transcript, sparse VS Code op-log, timestamp-less growth, live-host, empty-repo and zero-session-share tests pass. B2-07/B2-08 expose additional live/capture states those tests miss; B2-10 exposes the relocated path collision. Kit ENOTDIR is repaired: the loader preserves the ledger and `check` returns an error-class `scopes-not-directory` finding instead of throwing.

**Privacy and tests.** Existing cross-row/nested-value anonymisation tests pass, but serialized identifying keys remain exposed (B2-09). A repository test scan found no `process.stdout` stubbing; child writes and real streams are used. The new probes invoke real helpers/CLIs and include checker negative controls. No style-only heuristic was promoted to a finding.

## 4. Commands run and results

Environment: macOS, Node `v24.21.0`, Git `2.50.1 (Apple Git-155)`, non-root uid 501, restricted local network/listen permissions. The working tree was initially clean. The private raw-corpus directory was never read. No code, tests, corpus, goldens, reference files, tags, commits or remotes were changed. Scratch files, fixtures and logs are under `/private/tmp`; the only repository write is this report.

| Command/check | Result |
|---|---|
| `git rev-parse v0.2.1-rc.2 'v0.3.0-rc.1^{}' HEAD`; branch/status/log/diff inspection | Correct endpoints, `main`, initially clean. |
| `TMPDIR=/private/tmp npm test` | Exit 0; **854 tests: 850 passed, 0 failed, 4 skipped**; ~72 seconds. The four OTel socket tests report `local listen unavailable (EPERM)`; this is not service acceptance. Log: `/private/tmp/b2-npm-test.log`. |
| `TMPDIR=/private/tmp node scripts/diff-impl.mjs` | Exit 0; **68 cases, differing 0**. Log: `/private/tmp/b2-diff.log`. |
| `TMPDIR=/private/tmp node scripts/migrations.mjs check` | Exit 0; **20 modes, 71 cases, problems 0**; approximately 11 minutes on this run. Log: `/private/tmp/b2-migrations.log`. This certifies the committed cases, not the adversarial fixtures in §1.A. |
| `TMPDIR=/private/tmp node /private/tmp/b2-checker-probes.mjs` | Exit 0; each of the three bad implementations passes none/isolation/default/all with no problems; all corresponding negative controls fail all four modes as expected. Log: `/private/tmp/b2-checker-probes.log`. |
| `node /private/tmp/b2-spec-repros.mjs` | Exit 0; real CLI reproductions B2-04…06 print the discrepancies in §1.B. |
| `node /private/tmp/b2-live-review.mjs` | Probe exits 0; collision child exits 1 with EEXIST; provisional accounting discrepancy reproduced. |
| `node /private/tmp/b2-capture-repro.mjs` | Exit 0; late billing parsed as 0.02 but sweep appends no new line. |
| `node /private/tmp/b2-anon-key-review.mjs` | Exit 0; `identifierSurvives:true` in persisted anonymised `runs.json`. |
| `node /private/tmp/b2-api-trace-review.mjs` | Exit 0; 68 default-on cases, 3,488 hook invocations, all 38 call/part sets match. The intentional all-on differences from B1 goldens were not treated as off-path failures. |
| Direct P3P probes / forward-vs-reverse `composeExpected` | Old prototype/newline attacks now rejected/distinct. All **71** case compositions agree with no problems. An initial directory-enumeration probe encountered `targeted.test.mjs`; rerun filtered to directories and completed successfully. |

No Linux or Node 18 run was performed in this review. The owner's publication deferral governs that missing matrix evidence; it does not excuse the local reproductions above.
