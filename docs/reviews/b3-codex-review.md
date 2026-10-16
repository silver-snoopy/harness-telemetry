Not approvable

# B3 independent milestone review — v0.3.0..ac119ec

Reviewed `v0.3.0` → `ac119ec7890baffa787a5ce176d730aad8e3ba52` (`main` and HEAD), 2026-10-15. File/line citations refer to that HEAD. Reviewed the specified sections of `docs/spec.md`, Plan 5's fixed decisions, ledger rulings R1–R15, and the owner decisions. This review makes no code, test, corpus, golden, reference, or tag changes.

The migrations-off differential passes on the current corpus. A synthetic full-checker reproduction nevertheless accepts an undeclared committed-tree change. B3 cannot be accepted: activation can certify a checkpoint that omits durable interim telemetry; the probe can certify an unrelated session or a host event that never happened; and installed report writers bypass activation. Separate reproductions expose clone activation, staging, and worktree failures. These are synthetic scratch fixtures exercising the shipped implementation, not changes to the acceptance fixtures.

## 1. Findings

Severity follows the requested definitions. **6 Blockers, 3 Majors, 2 Minors.** The findings combine the independent standards and specification reviews in the requested milestone format. Known deferrals in the ledger are still findings against the reviewed tree.

| ID | Severity | Area | File:line | Finding | Evidence (with reproductions) | Fix |
|---|---|---|---|---|---|---|
| B3-01 | Blocker | Replay observation / gate exactness | `replay/observe.mjs:41`; `:45` | `ls-tree -z` records are decoded correctly but then serialized with raw newlines. A filename containing a newline plus a second tree-record prefix aliases two distinct committed entries. Different committed trees get identical summary hashes, so the full declared-diff checker certifies an undeclared change. This defeats the B3 exact-path hardening and §18.2. | **A:** baseline bare repo commits files `a` and `b` with identical bytes; bad implementation commits one crafted nested filename containing the two summary records. Real `checkMigrations` returns `problems:[]` in none/only/default/all. Adding `CONTROL` to the crafted name makes all four modes reject `__sandbox__/changes.txt`. | Serialize structured records with unambiguous framing, such as JSON arrays or NUL-separated fields/records. Keep exact paths through the final digest. Add this full-checker false-pass/negative-control regression. |
| B3-02 | Blocker | Durable store / checkpoint | `tokenomics/engine/substrate.mjs:131` | Restoring interim telemetry skips an entire module directory if the telemetry branch already contains that directory. New ledger lines and untracked durable files remain in `.agents/telemetry.pre-submodule/`, outside the canonical store and checkpoint. Verification and activation nevertheless succeed. This violates §18.5's requirement to checkpoint every durable telemetry file. Bytes remain recoverable in the stash, but readers and the certified backup omit them. | **B:** branch has `old-session`; interim ledger has `old-session` + `new-session` and an extra scope file. `verifySubstrate` returns `ok:true`; checkpoint contains only `old-session`; scope absent; installed activation exits 0. | Detect collisions and preserve every interim file, or refuse before activation with an explicit recovery instruction. Never certify a checkpoint while durable files remain stranded in the stash. Test overlapping module directories, not just a fresh branch plus dirty folder. |
| B3-03 | Blocker | Probe result identity | `tokenomics/engine/probe.mjs:201`; `:283`; `:320` | Expected-result evidence is selected only by host and a recent timestamp. Neither the nonce nor the native probe-session identity is checked; any object-valued scope counts as the expected stamp. A sweep of an unrelated recent session therefore proves a probe that was never captured, including a false `sweep-only (partial)` result (§14.9). | **C:** a temporary fake host runs the real wired hooks but writes only `unrelated-session.jsonl`, leaving the probe's transcript absent. Result is `fired` with both expected fields present; the sole ledger id is `unrelated-session`. Suppressing session-end hooks yields `sweep-only (partial)` with the same unrelated id. | Bind nonce → native session id using host evidence and require that exact host/id and expected scope. Use the same identity check for fallback. Reject unrelated concurrent sessions even when recently started. |
| B3-04 | Blocker | Probe event attribution | `tokenomics/engine/probe.mjs:113`; `:121` | Fired records identify script/mode, not the actual host event. The count-allocation heuristic assigns repeated invocations of a shared entry to different events. It can certify `sessionEnd` when only `sessionStart` happened, contrary to §14.9's direct evidence requirement. | **D:** replace the temporary fake Copilot's final `fire('sessionEnd', …)` with another `fire('sessionStart', …)`. Real wired hooks execute; result is `fired`, including `sessionEnd:'fired'`, despite no sessionEnd invocation. | Carry an unambiguous host-event identity in the wrapper/entry record and validate it with the nonce. Repeated starts must never satisfy end-event evidence. |
| B3-05 | Blocker | Activation coverage | `tokenomics/scripts/batch-cost.mjs:705`; `tokenomics/scripts/build-tokenomics-export.mjs:375` | Installed batch-cost and export writers never consult the activation gate. During an interrupted upgrade they create/replace store reports and exports before the new version has a verified checkpoint. Plan D-ACT's “every writer entry point” is not implemented for these writers. | **E:** copy engine 0.4.0 into a repo recording engine 0.3.0. `activationState` is `inert`, yet both actual CLIs exit 0 and create `reports/g/cost.json` and `export/runs.json`. | Gate every writing CLI path before its first write, including submission/export and batch-cost. Keep genuinely read-only operations available. Add installed-copy tests for missing and mismatched activation. |
| B3-06 | Blocker | Production switch refusal | `tokenomics/engine/migrations.mjs:28` | An unreadable/malformed ENGINE.json is classified as “not installed” by migration selection. Report/export entries then honor `TOKENOMICS_MIGRATIONS=none`, although the activation state is explicitly inert. This violates Q3/R12's production switch set `{}` and can replace export rows using the reference-era path. | **E, second phase:** replace only the scratch installed ENGINE.json with `{`; run installed export with `TOKENOMICS_MIGRATIONS=none`. It exits 0 and reports replacing the existing row. The intact-manifest path refuses the same variable. Ledger already notes this deferred hole. | Distinguish an absent legacy manifest from a present unreadable one and fail closed. Apply consistent manifest-state handling to migration selection and all entries; retain the source checkout's explicit `installed:null` behavior. |
| B3-07 | Major | Clone materialisation | `tokenomics/engine/substrate.mjs:139`; `:174`; `tokenomics/engine/checkpoint.mjs:69` | A normal clone without `--recurse-submodules` materialises a clean detached checkout with `origin/telemetry` but no local `telemetry` branch. Substrate verification accepts it, then checkpoint creation rejects it. Local branch creation is conditional on a dirty checkout. | **F:** ordinary local clone; installed `install-hooks --host claude` exits 1 with `checkpoint-no-store: ... no telemetry branch (refs/heads/telemetry)`, while `verifySubstrate` returns `ok:true`. | Safely establish the local telemetry branch on materialisation, or support the verified detached checkout in checkpoint creation without rewinding history. Test a clean normal clone. |
| B3-08 | Major | Operator index | `tokenomics/engine/substrate.mjs:190` | Rollback after a failed plain-folder conversion resets telemetry index entries to HEAD, discarding the operator's staged state. The comment claims restoration of the original index, but staged contents are not restored. | **G:** HEAD ledger `old`; index/worktree `old` + `staged-new`; inject submodule-add failure. Index becomes `old`; worktree remains `old` + `staged-new`. | Save and restore the exact original index entries/stages, or use an isolated index until successful completion. Exercise pre-staged telemetry and failure after removing cached entries. |
| B3-09 | Major | Git fallback / worktrees | `tokenomics/scripts/install-hooks.mjs:264`; `:276` | The common post-commit hook hardcodes the last activating worktree's engine and repo paths. Activation in a linked worktree changes fallback behavior for commits in the primary checkout; the committing checkout's sessions are missed and another checkout is swept. | **H:** install real copies and fallbacks in primary and linked worktrees, each with a distinct completed transcript; commit in primary. `primaryLedger:[]`, `linkedLedger:['linked-session']`. This also reproduces the ledger's deferred shared-hooks issue. | Resolve the committing worktree at hook execution and select its installed copy. Test commits in both worktrees after both activations. Preserve foreign-hook chaining and git-environment cleanup. |
| B3-10 | Minor | Privacy / documentation | `docs/plans/plan-5.md:22`; `:24`; `:42`; `docs/plans/plan-5-ledger.md:1` | New documentation contains identifying absolute home-directory paths; the npm-cache example also contains a session UUID. This violates the explicit privacy constraint for docs. | **I:** the documented `rg` scan finds the personal paths and session identifier. Fixture and PROVENANCE checks did not expose equivalent personal identifiers; pinned provenance commit ids are intentional. | Replace personal paths and session identifiers with portable placeholders. Extend the privacy check to new documentation, while permitting necessary source revisions. |
| B3-11 | Minor | Integrity diagnostics | `tokenomics/scripts/doctor.mjs:76` | A dangling symlink replacing a listed engine file throws from hashing and aborts the entire doctor command. `--json` produces no checks, so other installed copies and health checks are not reported. It exits nonzero; this is not an integrity false pass. | **J:** real copies for both hosts; normal modified/missing/extra-file mutations correctly fail. Replace a listed file with a dangling symlink: exit 1, ENOENT stderr, empty JSON output. | Turn per-file read/stat errors into named integrity failures and continue checking the remaining files and copies. |

## 2. Reproductions

Run each saved script from the reviewed repository root. All generated fixtures and altered fake hosts live under `/private/tmp`; the reviewed implementation is unchanged (integrity experiments deliberately mutate scratch installed copies). Git experiments use temporary global configuration and `GIT_CONFIG_NOSYSTEM=1`. Substrate experiments additionally intercept push attempts. All host commands are fakes. The scripts deliberately retain scratch evidence for inspection.

### A — committed-tree summary collision (B3-01)

This invokes the real replay and full declared-diff checker. The synthetic implementation builds a bare git repository, so its committed tree is observed through the git-directory summary. Only out/a.txt is declared to change. The control differs only in its crafted filename.

Save as `/private/tmp/b3-review.u9eJsY/replay-git-repro.mjs` and run `node /private/tmp/b3-review.u9eJsY/replay-git-repro.mjs` from the repository root:

```js
import fs from 'node:fs';import path from 'node:path';
const src=process.cwd(),root=fs.mkdtempSync('/private/tmp/b3-git-summary-');
const put=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v));};
put(path.join(root,'gitconfig'),'');Object.assign(process.env,{GIT_CONFIG_GLOBAL:path.join(root,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',TMPDIR:'/private/tmp'});
const {runCase}=await import(path.join(src,'replay/runner.mjs'));
const {checkMigrations}=await import(path.join(src,'scripts/migrations.mjs'));
const c=path.join(root,'cases/m1'),impl=path.join(root,'impl'),registry=path.join(root,'registry');
const manifest=JSON.parse(fs.readFileSync(path.join(src,'scripts/fixtures/migrations/cases/m1/replay.json'),'utf8'));
put(path.join(c,'replay.json'),manifest);
function writer(bad,control=false){return `import fs from 'node:fs';import {execFileSync} from 'node:child_process';
fs.mkdirSync('out');fs.writeFileSync('out/a.txt',process.env.TOKENOMICS_MIGRATIONS==='none'?'base\\n':'demo\\n');
fs.writeFileSync(process.env.HOME+'/review-gitconfig','');
const env={...process.env,GIT_CONFIG_GLOBAL:process.env.HOME+'/review-gitconfig',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'Review',GIT_AUTHOR_EMAIL:'review@example.invalid',GIT_COMMITTER_NAME:'Review',GIT_COMMITTER_EMAIL:'review@example.invalid'};
const g=(a,input)=>execFileSync('git',['--git-dir=store',...a],{env,input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
g(['init','--bare','-q','store']);g(['symbolic-ref','HEAD','refs/heads/main']);
const blob=g(['hash-object','-w','--stdin'],'same bytes');
const names=${bad?"['a\\ntree refs/heads/main 100644 blob '+blob+'\\tb']":"['a','b']"};
for(const n of names)g(['update-index','--add','--cacheinfo','100644,'+blob+','+n+${JSON.stringify(control?'CONTROL':'')}]);
const tree=g(['write-tree']);const commit=g(['commit-tree',tree,'-m','one']);g(['update-ref','refs/heads/main',commit]);`}
put(path.join(impl,'scripts/w.mjs'),writer(false));
const baseline=await runCase(c,impl,{extraEnv:{TOKENOMICS_MIGRATIONS:'none'}});
for(const [p,v] of Object.entries(baseline.files))put(path.join(c,'expected/49577c7',p),v);
put(path.join(registry,'demo/migration.json'),{id:'demo',item:1,spec:'synthetic probe',summary:'probe',beforeCases:['m1'],declared:{m1:{reason:'The only declared migration changes ordinary out/a.txt.',changed:['out/a.txt']}}});
put(path.join(registry,'demo/expected/m1/out/a.txt'),'demo\n');
for(const control of [false,true]){
 put(path.join(impl,'scripts/w.mjs'),writer(true,control));
 const result=await checkMigrations({implDir:impl,casesDir:path.join(root,'cases'),registryDir:registry,migrations:[{id:'demo',item:1,landed:true}]});
 console.log(control?'CONTROL':'COLLISION',JSON.stringify(result.results.map(({mode,problems})=>({mode,problems}))));
}
console.log(root);
```

### B — overlapping interim store (B3-02)

The output distinguishes canonical, stranded, and checkpoint bytes, using the installed activation CLI from start to finish.

Save as `/private/tmp/b3-spec-repro.mjs` and run `node /private/tmp/b3-spec-repro.mjs` from the repository root:

```js
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const {ensureSubstrate,verifySubstrate} = await import(process.cwd() + '/tokenomics/engine/substrate.mjs');
const {takeCheckpoint} = await import(process.cwd() + '/tokenomics/engine/checkpoint.mjs');
const tmp=mkdtempSync('/private/tmp/b3-spec-'); const repo=join(tmp,'repo'); mkdirSync(repo); mkdirSync(join(tmp,'bin')); writeFileSync(join(tmp,'gitconfig'),'');
writeFileSync(join(tmp,'bin/git'),'#!/bin/sh\nfor arg do\n if [ "$arg" = push ]; then exit 1; fi\ndone\nexec /usr/bin/git "$@"\n',{mode:0o755});
const env={...process.env,PATH:join(tmp,'bin')+':'+process.env.PATH,GIT_CONFIG_GLOBAL:join(tmp,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',GIT_ALLOW_PROTOCOL:'file',GIT_AUTHOR_NAME:'Review',GIT_AUTHOR_EMAIL:'review@example.invalid',GIT_COMMITTER_NAME:'Review',GIT_COMMITTER_EMAIL:'review@example.invalid'};
const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:repo,env,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
git('init','-q');writeFileSync(join(repo,'README'),'main');git('add','.');git('commit','-qm','main');const main=git('branch','--show-current');
git('checkout','--orphan','telemetry');git('rm','-rf','.');mkdirSync(join(repo,'automation'));writeFileSync(join(repo,'automation/usage-review.jsonl'),'old-session\n');git('add','.');git('commit','-qm','old telemetry');git('checkout',main);
mkdirSync(join(repo,'.agents/telemetry/automation'),{recursive:true});writeFileSync(join(repo,'.agents/telemetry/automation/usage-review.jsonl'),'old-session\nnew-session\n');writeFileSync(join(repo,'.agents/telemetry/automation/new.json'),'durable-new-scope');
const {installCopy}=await import(process.cwd() + '/tokenomics/engine/install-copy.mjs');
const ins=installCopy({packageRoot:process.cwd(),repo,target:'claude'});
const {spawnSync}=await import('node:child_process');
const act=spawnSync(process.execPath,[join(ins.dest,'scripts/install-hooks.mjs'),'--host','claude'],{cwd:repo,env:{...env,TOKENOMICS_NO_SINK:'1',TOKENOMICS_NO_SYNC:'1'},encoding:'utf8'});
console.log(JSON.stringify({tmp,activationExit:act.status,activationStderr:act.stderr,verify:verifySubstrate(repo,{}, {env}),canonical:readFileSync(join(repo,'.agents/telemetry/automation/usage-review.jsonl'),'utf8'),newScopePresent:existsSync(join(repo,'.agents/telemetry/automation/new.json')),stranded:readFileSync(join(repo,'.agents/telemetry.pre-submodule/automation/usage-review.jsonl'),'utf8'),checkpointLedger:execFileSync('/usr/bin/git',['show','pre-engine-0.4.0:automation/usage-review.jsonl'],{cwd:join(repo,'.agents/telemetry'),env,encoding:'utf8'})},null,2));
```

### C — unrelated session accepted by the probe (B3-03)

Only the temporary fake host is changed: the probe transcript is absent, and a different recently started session is available to the real sweep. Both direct and fallback results are printed.

Save as `/private/tmp/b3-review.u9eJsY/probe-repro.mjs` and run `node /private/tmp/b3-review.u9eJsY/probe-repro.mjs` from the repository root:

```js
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const source=process.cwd();
const root=fs.mkdtempSync('/private/tmp/b3-probe-adversarial-');
const put=(p,data)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof data==='string'?data:JSON.stringify(data));};
put(path.join(root,'gitconfig'),'[user]\n name = Review\n email = review@example.invalid\n');
const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:path.join(root,'home'),TMPDIR:'/private/tmp',GIT_CONFIG_GLOBAL:path.join(root,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',GIT_ALLOW_PROTOCOL:'file',TOKENOMICS_NO_SYNC:'1',TOKENOMICS_NO_SINK:'1',TOKENOMICS_NO_CCUSAGE:'1',TOKENOMICS_CLAUDE_ROOT:path.join(root,'claude'),TOKENOMICS_COPILOT_ROOT:path.join(root,'copilot'),TOKENOMICS_VSCODE_ROOT:path.join(root,'vscode')};
Object.assign(process.env,env);
const {installCopy}=await import(path.join(source,'tokenomics/engine/install-copy.mjs'));
const {installClaude,installGitHook}=await import(path.join(source,'tokenomics/scripts/install-hooks.mjs'));
const {runProbe}=await import(path.join(source,'tokenomics/engine/probe.mjs'));
const repo=path.join(root,'repo'),rel='.claude/skills/tokenomics';fs.mkdirSync(repo);
spawnSync('git',['init','-q'],{cwd:repo,env});
installCopy({packageRoot:source,repo,target:'claude'});installClaude(repo,rel);installGitHook(repo,rel);
put(path.join(repo,'.agents/tokenomics/settings.json'),{extension:null,engine:'0.4.0',dir:'tokenomics',targets:['claude']});
let fake=fs.readFileSync(path.join(source,'tokenomics/fixtures/probe/fake-claude.mjs'),'utf8');
fake=fake.replace('appendFileSync, chmodSync,','appendFileSync, utimesSync, chmodSync,');
fake=fake.replace('writeFileSync(transcript,',"writeFileSync(join(projDir, 'unrelated-session.jsonl'),");
fake=fake.replace("  fire('SubagentStop'", "  utimesSync(join(projDir, 'unrelated-session.jsonl'), new Date(0), new Date(0));\n  declareScope({repo,rel,env,session:'unrelated-session',host:'claude'});\n  fire('SubagentStop'");
const fakePath=path.join(root,'fake-claude.mjs');put(fakePath,fake);
for(const mode of ['ok','no-session-end']) {
 const result=await runProbe(repo,{host:'claude',timeoutMs:10000,keepState:true,env:{...env,TOKENOMICS_PROBE_CLAUDE_BIN:fakePath,FAKE_PROBE_MODE:mode}});
 const tel=path.join(result.stateDir,'telemetry/tokenomics');
 const lines=fs.readdirSync(tel).filter(f=>f.startsWith('usage-')).flatMap(f=>fs.readFileSync(path.join(tel,f),'utf8').trim().split('\n').map(JSON.parse));
 console.log(JSON.stringify({mode,result,ledgerIds:lines.map(l=>l.id)}));
}
console.log(root);
```

### D — repeated start credited as end (B3-04)

The fake invokes no sessionEnd event. The reported event map nevertheless marks it fired.

Save as `/private/tmp/b3-review.u9eJsY/probe-event-repro.mjs` and run `node /private/tmp/b3-review.u9eJsY/probe-event-repro.mjs` from the repository root:

```js
import fs from 'node:fs';import path from 'node:path';
const src=process.cwd(),root=fs.mkdtempSync('/private/tmp/b3-event-');
const put=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v));};
put(path.join(root,'gitconfig'),'[user]\n name = Review\n email = review@example.invalid\n');
const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,TMPDIR:'/private/tmp',GIT_CONFIG_GLOBAL:path.join(root,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',TOKENOMICS_NO_SYNC:'1',TOKENOMICS_CLAUDE_ROOT:path.join(root,'claude'),TOKENOMICS_COPILOT_ROOT:path.join(root,'copilot'),TOKENOMICS_VSCODE_ROOT:path.join(root,'vscode')};Object.assign(process.env,env);
const {installCopy}=await import(path.join(src,'tokenomics/engine/install-copy.mjs'));
const {installCopilot}=await import(path.join(src,'tokenomics/scripts/install-hooks.mjs'));
const {runProbe}=await import(path.join(src,'tokenomics/engine/probe.mjs'));
const repo=path.join(root,'repo'),rel='.github/skills/tokenomics';fs.mkdirSync(repo);
installCopy({packageRoot:src,repo,target:'copilot'});installCopilot(repo,rel);
put(path.join(repo,'.agents/tokenomics/settings.json'),{engine:'0.4.0',extension:null,dir:'tokenomics',targets:['copilot-cli']});
let fake=fs.readFileSync(path.join(src,'tokenomics/fixtures/probe/fake-copilot.mjs'),'utf8').replace("fire('sessionEnd', { reason: 'complete' });","fire('sessionStart', { source: 'resume' });");
put(path.join(root,'fake-copilot.mjs'),fake);fs.copyFileSync(path.join(src,'tokenomics/fixtures/probe/fake-claude.mjs'),path.join(root,'fake-claude.mjs'));
console.log(await runProbe(repo,{host:'copilot-cli',timeoutMs:10000,keepState:true,env:{...env,TOKENOMICS_PROBE_COPILOT_BIN:path.join(root,'fake-copilot.mjs')}}));console.log(root);
```

### E — inert report writers and damaged-manifest switch bypass (B3-05, B3-06)

The first phase uses an intact installed manifest with a mismatched activation version. The second corrupts only the scratch manifest and sets the forbidden switch.

Save as `/private/tmp/b3-review.u9eJsY/writers-repro.mjs` and run `node /private/tmp/b3-review.u9eJsY/writers-repro.mjs` from the repository root:

```js
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const source=process.cwd();
const {installCopy}=await import(path.join(source,'tokenomics/engine/install-copy.mjs'));
const {activationState}=await import(path.join(source,'tokenomics/engine/activation.mjs'));
const root=fs.mkdtempSync('/private/tmp/b3-writers-');const put=(p,o)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(o));};
const repo=path.join(root,'repo');fs.mkdirSync(repo);const copy=installCopy({packageRoot:source,repo,target:'claude'});
put(path.join(repo,'.agents/tokenomics/settings.json'),{extension:null,dir:'tokenomics',engine:'0.3.0'});
put(path.join(repo,'.agents/automation/g/report.json'),{cases:[{id:'TASK-1',outcome:'delivered',at:'2026-10-01T00:00:00Z'}]});
const env={PATH:process.env.PATH,HOME:root,TMPDIR:'/private/tmp',GIT_CONFIG_GLOBAL:path.join(root,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',TOKENOMICS_NO_SYNC:'1',TOKENOMICS_NO_SINK:'1',TOKENOMICS_NO_CCUSAGE:'1'};fs.writeFileSync(env.GIT_CONFIG_GLOBAL,'');
console.log('state',activationState(copy.dest,repo,env));
for(const script of ['batch-cost.mjs','build-tokenomics-export.mjs']) {
 const r=spawnSync(process.execPath,[path.join(copy.dest,'scripts',script),repo,'--batch','g'],{cwd:repo,env,encoding:'utf8'});
 console.log(script,r.status,r.stderr);
}
console.log('costExists',fs.existsSync(path.join(repo,'.agents/telemetry/tokenomics/reports/g/cost.json')),'exportExists',fs.existsSync(path.join(repo,'.agents/telemetry/tokenomics/export/runs.json')));
console.log(root);
const control=spawnSync(process.execPath,[path.join(copy.dest,'scripts/build-tokenomics-export.mjs'),repo,'--batch','g'],{cwd:repo,env:{...env,TOKENOMICS_MIGRATIONS:'none'},encoding:'utf8'});
console.log('intact manifest switch control',control.status,control.stderr.includes('refused'));
fs.writeFileSync(path.join(copy.dest,'ENGINE.json'),'{');
console.log('damagedManifestState',activationState(copy.dest,repo,env));
const refused=spawnSync(process.execPath,[path.join(copy.dest,'scripts/build-tokenomics-export.mjs'),repo,'--batch','g'],{cwd:repo,env:{...env,TOKENOMICS_MIGRATIONS:'none'},encoding:'utf8'});
console.log('damaged manifest with MIGRATIONS=none',refused.status,refused.stderr);
```

### F — clone without recursive submodules (B3-07)

The local fetch substitutes for publishing the seed telemetry branch; no push is performed. The consumer is an ordinary clone with an initially unmaterialised submodule.

Save as `/private/tmp/b3-clone-repro.mjs` and run `node /private/tmp/b3-clone-repro.mjs` from the repository root:

```js
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {join} from 'node:path';
const {ensureSubstrate,verifySubstrate} = await import(process.cwd() + '/tokenomics/engine/substrate.mjs');
const {takeCheckpoint} = await import(process.cwd() + '/tokenomics/engine/checkpoint.mjs');
const {installCopy} = await import(process.cwd() + '/tokenomics/engine/install-copy.mjs');
const tmp=mkdtempSync('/private/tmp/b3-clone-'); const repo=join(tmp,'repo'); mkdirSync(repo); mkdirSync(join(tmp,'bin')); writeFileSync(join(tmp,'gitconfig'),'');
writeFileSync(join(tmp,'bin/git'),'#!/bin/sh\nfor arg do\n if [ "$arg" = push ]; then exit 1; fi\ndone\nexec /usr/bin/git "$@"\n',{mode:0o755});
const env={...process.env,PATH:join(tmp,'bin')+':'+process.env.PATH,GIT_CONFIG_GLOBAL:join(tmp,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',GIT_ALLOW_PROTOCOL:'file',GIT_AUTHOR_NAME:'Review',GIT_AUTHOR_EMAIL:'review@example.invalid',GIT_COMMITTER_NAME:'Review',GIT_COMMITTER_EMAIL:'review@example.invalid',TOKENOMICS_NO_SINK:'1',TOKENOMICS_NO_SYNC:'1'};
const git=(cwd,...args)=>execFileSync('/usr/bin/git',args,{cwd,env,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
git(repo,'init','-q');writeFileSync(join(repo,'README'),'main');git(repo,'add','.');git(repo,'commit','-qm','main');
ensureSubstrate(repo,{}, {env});
// The best-effort seed push is forbidden in this review. Preserve seed locally using plumbing.
const store=join(repo,'.agents/telemetry');const head=git(store,'rev-parse','HEAD');git(repo,'fetch','--no-write-fetch-head',store,`${head}:refs/heads/telemetry`);
git(repo,'add','.gitmodules','.agents/telemetry');git(repo,'commit','-qm','store');
const clone=join(tmp,'clone');git(tmp,'clone','-q',repo,clone);
const ins=installCopy({packageRoot:process.cwd(),repo:clone,target:'claude'});
const act=spawnSync(process.execPath,[join(ins.dest,'scripts/install-hooks.mjs'),'--host','claude'],{cwd:clone,env,encoding:'utf8'});
console.log(JSON.stringify({tmp,activationExit:act.status,activationStderr:act.stderr,branches:git(join(clone,'.agents/telemetry'),'branch','-a'),verify:verifySubstrate(clone,{}, {env})},null,2));
```

### G — failed conversion loses staging (B3-08)

A git shim injects the submodule-add error. Other git operations execute normally against the temporary repository.

Save as `/private/tmp/b3-index-repro.mjs` and run `node /private/tmp/b3-index-repro.mjs` from the repository root:

```js
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const {ensureSubstrate} = await import(process.cwd() + '/tokenomics/engine/substrate.mjs');
const tmp=mkdtempSync('/private/tmp/b3-index-'); const repo=join(tmp,'repo'); mkdirSync(repo); mkdirSync(join(tmp,'bin')); writeFileSync(join(tmp,'gitconfig'),'');
writeFileSync(join(tmp,'bin/git'),'#!/bin/sh\nfor arg do\n if [ "$arg" = push ]; then exit 1; fi\ndone\ncase " $* " in *" submodule add "*) echo "simulated unavailable submodule clone" >&2; exit 1;; esac\nexec /usr/bin/git "$@"\n',{mode:0o755});
const env={...process.env,PATH:join(tmp,'bin')+':'+process.env.PATH,GIT_CONFIG_GLOBAL:join(tmp,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',GIT_ALLOW_PROTOCOL:'file',GIT_AUTHOR_NAME:'Review',GIT_AUTHOR_EMAIL:'review@example.invalid',GIT_COMMITTER_NAME:'Review',GIT_COMMITTER_EMAIL:'review@example.invalid'};
const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:repo,env,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
git('init','-q');const p='.agents/telemetry/automation/usage-review.jsonl';mkdirSync(join(repo,'.agents/telemetry/automation'),{recursive:true});writeFileSync(join(repo,p),'old\n');git('add','.');git('commit','-qm','main');writeFileSync(join(repo,p),'old\nstaged-new\n');git('add',p);const before=git('show',`:${p}`);let err;try{ensureSubstrate(repo,{}, {env});}catch(e){err=e.message;}
console.log(JSON.stringify({tmp,error:err,indexBefore:before,indexAfter:git('show',`:${p}`),working:readFileSync(join(repo,p),'utf8')},null,2));
```

### H — primary commit sweeps linked worktree (B3-09)

This uses the real installed capture implementation, separate completed transcripts, and a real git-triggered hook. Sync, sink and ccusage are disabled.

Save as `/private/tmp/b3-git-fallback-real-review.mjs` and run `node /private/tmp/b3-git-fallback-real-review.mjs` from the repository root:

```js
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,readdirSync,existsSync,utimesSync} from 'node:fs';
import {spawnSync} from 'node:child_process';import {join,dirname} from 'node:path';
const {installGitHook} = await import(process.cwd() + '/tokenomics/scripts/install-hooks.mjs');
const {installCopy} = await import(process.cwd() + '/tokenomics/engine/install-copy.mjs');
const source=process.cwd();const root=mkdtempSync('/private/tmp/b3-git-real-');
const config=join(root,'gitconfig');writeFileSync(config,'');
const env={PATH:[dirname(process.execPath),'/usr/bin','/bin'].join(':'),HOME:root,GIT_CONFIG_GLOBAL:config,GIT_CONFIG_NOSYSTEM:'1',GIT_ALLOW_PROTOCOL:'file',GIT_AUTHOR_NAME:'Review',GIT_AUTHOR_EMAIL:'review@example.invalid',GIT_COMMITTER_NAME:'Review',GIT_COMMITTER_EMAIL:'review@example.invalid',TOKENOMICS_NO_CCUSAGE:'1',TOKENOMICS_NO_SYNC:'1',TOKENOMICS_NO_SINK:'1',TOKENOMICS_NO_BATCH_COST:'1',TOKENOMICS_COPILOT_ROOT:join(root,'none'),TOKENOMICS_VSCODE_ROOT:join(root,'none')};
Object.assign(process.env,env);
const git=(cwd,...args)=>{const r=spawnSync('git',args,{cwd,env,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()};
const main=join(root,'main'),linked=join(root,'linked');mkdirSync(main);git(main,'init','-q');git(main,'commit','--allow-empty','-qm','init');git(main,'worktree','add','-qb','linked',linked);
const version=JSON.parse(readFileSync(join(source,'tokenomics/ENGINE.json'))).engine;
for(const [repo,label] of [[main,'main'],[linked,'linked']]){
 installCopy({packageRoot:source,repo,target:'claude'});
 const settings=join(repo,'.agents/tokenomics/settings.json');mkdirSync(dirname(settings),{recursive:true});writeFileSync(settings,JSON.stringify({extension:null,engine:version,dir:'tokenomics',substrate:{form:'plain-folder'},targets:['claude']}));
 const sessions=join(root,'.claude/projects',repo.replace(/[^a-zA-Z0-9]/g,'-'));mkdirSync(sessions,{recursive:true});const transcript=join(sessions,label+'-session.jsonl');
 writeFileSync(transcript,[{type:'user',message:{role:'user',content:'hello'},timestamp:'2026-07-30T10:00:00Z'},{type:'assistant',timestamp:'2026-07-30T10:01:00Z',message:{id:'m1',model:'claude-sonnet-5',usage:{input_tokens:100,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0},content:[]}}].map(JSON.stringify).join('\n')+'\n');utimesSync(transcript,new Date(0),new Date(0));
 installGitHook(repo,'.claude/skills/tokenomics');
}
const lines=repo=>{const dir=join(repo,'.agents/telemetry/tokenomics');return existsSync(dir)?readdirSync(dir).filter(f=>/^usage-.*\.jsonl$/.test(f)).flatMap(f=>readFileSync(join(dir,f),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)):[]};
git(main,'commit','--allow-empty','-qm','main-commit');for(let i=0;i<50&&!lines(linked).length;i++)await new Promise(r=>setTimeout(r,100));
console.log(JSON.stringify({root,commit:'primary',primaryLedger:lines(main).map(l=>l.id),linkedLedger:lines(linked).map(l=>l.id)},null,2));
```

### I — documentation privacy (B3-10)

```sh
rg -n '/Users/|/home/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' docs/plans/plan-5.md docs/plans/plan-5-ledger.md
```

The positive matches include plan lines 22, 24, 42, 45, 47, 509 and 543, plus the ledger's first line. Personal values are intentionally not repeated here.

### J — integrity mutations (B3-11)

Each host copy is checked independently for modified, missing and unexpected files, followed by the dangling-symlink case. The fixture is deliberately unactivated, so inspect the integrity check separately from the overall doctor status.

Save as `/private/tmp/b3-integrity-review.mjs` and run `node /private/tmp/b3-integrity-review.mjs` from the repository root:

```js
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync,symlinkSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {join,dirname} from 'node:path';const {installCopy} = await import(process.cwd() + '/tokenomics/engine/install-copy.mjs');
const source=process.cwd();const root=mkdtempSync('/private/tmp/b3-integrity-review-');const config=join(root,'gitconfig');writeFileSync(config,'');const env={PATH:'/usr/bin:/bin',HOME:root,GIT_CONFIG_GLOBAL:config,GIT_CONFIG_NOSYSTEM:'1',GIT_ALLOW_PROTOCOL:'file',TOKENOMICS_NO_CCUSAGE:'1',TOKENOMICS_NO_SINK:'1',TOKENOMICS_NO_SYNC:'1',TOKENOMICS_CLAUDE_ROOT:root,TOKENOMICS_COPILOT_ROOT:root,TOKENOMICS_VSCODE_ROOT:root};
spawnSync('git',['init','-q',root],{env});
const roots=['claude','copilot'].map(target=>installCopy({packageRoot:source,repo:root,target}).dest);
const check=()=>{const r=spawnSync(process.execPath,[join(source,'tokenomics/scripts/doctor.mjs'),'--repo',root,'--json'],{env,encoding:'utf8'});let integrity;try{integrity=JSON.parse(r.stdout).checks.find(c=>c.id==='integrity')}catch{}return {status:r.status,integrity,stderr:r.stderr.slice(0,500)};};
console.log('baseline',JSON.stringify(check()));
for(const copy of roots){const p=join(copy,'engine/order.mjs');const orig=readFileSync(p);writeFileSync(p,Buffer.concat([orig,Buffer.from('\n// modified\n')]));console.log('modified '+copy.split('/').slice(-3).join('/'),JSON.stringify(check()));writeFileSync(p,orig);rmSync(p);console.log('missing',JSON.stringify(check()));writeFileSync(p,orig);const extra=join(copy,'engine/unexpected.mjs');writeFileSync(extra,'');console.log('unexpected',JSON.stringify(check()));rmSync(extra);}
const missing=join(roots[0],'engine/order.mjs');rmSync(missing);symlinkSync(join(root,'absent'),missing);console.log('dangling symlink',JSON.stringify(check()));console.log('root',root);
```

## 3. Commands run and results

Validation used Node **v24.21.0**. Broad tests ran against an archive of `ac119ec` extracted under `/private/tmp/b3-review.u9eJsY/checkout`, with a fresh scratch git directory. They did not run against or change the reviewed working tree. The npm cache and global git config were also temporary. No real Claude or Copilot CLI was run; the manual real-host probe remains outside this review's authorization.

| Command / check | Result |
|---|---|
| `git status --short`; `git rev-parse HEAD`; `git log --oneline v0.3.0..ac119ec`; `git diff --stat v0.3.0..ac119ec` | Initially clean; HEAD exactly `ac119ec7890baffa787a5ce176d730aad8e3ba52`; reviewed requested range. |
| `npm_config_cache=<scratch>/npm-cache GIT_CONFIG_GLOBAL=<scratch>/gitconfig GIT_CONFIG_NOSYSTEM=1 TMPDIR=/private/tmp npm test` | **Exit 1:** 1,019 tests; 1,014 pass, 1 fail, 4 skipped. Failure: B3-188b symlinked OTel sink test cannot observe its PID file. Runtime is forbidden to bind localhost: independent `net.createServer().listen(0,'127.0.0.1')` returns **EPERM**. This prevents a fully green suite here; it is not evidence of an entry-guard regression. Log: `/private/tmp/b3-review.u9eJsY/npm-test.log`. |
| `node --test tokenomics/engine/entry.test.mjs` with isolated git/TMPDIR | **Exit 1:** 10 tests, 9 pass, same B3-188b failure in isolation; localhost EPERM independently reproduced. Log: `/private/tmp/b3-review.u9eJsY/entry-rerun.log`. |
| `node scripts/diff-impl.mjs` with isolated git/TMPDIR | **Exit 0: cases 68, differing 0.** Log: `/private/tmp/b3-review.u9eJsY/diff.log`. |
| `node scripts/migrations.mjs check` with isolated git/TMPDIR | **Exit 0: modes 20, cases 71, problems 0.** Completed in approximately 28 minutes. Log: `/private/tmp/b3-review.u9eJsY/migrations.log`. This is the existing corpus; the synthetic committed-tree collision in B3-01 separately passes despite its undeclared change. |
| `node scripts/engine-manifest.mjs --check` | **Exit 0:** ENGINE.json is current. |
| Embedded JavaScript reproductions above | All described results reproduced. All nine JavaScript blocks were extracted from this report, syntax-checked, and executed successfully; their observations reproduce the findings. Logs: `/private/tmp/b3-review.u9eJsY/doc-repro-0.log` through `doc-repro-8.log`; final replay collision/control rerun with explicit temporary git config: `replay-git-final.log` in the same directory. Successful reproduction-script exits do not mean the tested behavior is correct. |
| Read-only `git show 50615f1:<path>` comparison with local LeRisque, plus SHA-256 comparison with PROVENANCE | `.claude/settings.json`, `.claude/hooks/_run.sh`, and `.claude/tests/_assert_hook_wiring.py` are byte-identical to the claimed source revision. |
| B3 gate tests within `npm test` | Documented-command, unchanged wiring-output, dirty, offline, and interrupted-upgrade fixtures passed. The temp package is removed before later commands. Their coverage does not exercise the adversarial cases above. |
| Read/review of probe tests within `npm test` | Existing isolation, timeout/process-group, recursion, inert-hook, and fallback tests passed. The fake hosts run configured hooks through real subprocesses. |
| Source/test scans and installed-copy integrity experiments | No `process.stdout` stubs found. Normal modified/missing/unexpected files detected in both copies. No runtime import outside the shipped `tokenomics/` subtree found. `--symlink` refusal tests passed. |
| `node /private/tmp/b3-review.u9eJsY/manifest-repro.mjs` | External current-manifest/archive divergence: activation warns and preserves both documents; doctor exits 0. Not counted as another finding: D-MAN prohibits installer rewrites, while the explicit doctor plan requires current-document validation and archive existence, not equality. |
| Documentation privacy scan | Positive identifying-path/session-id matches, recorded as B3-10. |

Final working-tree check: only `docs/reviews/b3-codex-review.md` is new; no tracked files changed. No commit or tag operation was performed on the reviewed repository.

The passing source differential and full corpus migration check support the unchanged migrations-off and declared-diff behavior on those fixtures. The review does not claim that the private source sessions were inspected, that the real-host manual probe was performed, or that Node 18 was independently validated in this pass.
