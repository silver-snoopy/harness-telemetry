# Engine — B1 (pure extraction)

Copied from `reference/49577c7/{hooks,scripts,templates,references}` at Plan 2 Task 8.
Every later B1 commit must keep `node scripts/diff-impl.mjs` at `differing 0`.
Lifted sites are recorded below per task (inventory ids from docs/inventory/b0-assignments.json).

**Public import boundary (D2, `docs/b2/MIGRATION-MAP.md`).** The engine's supported API is its CLI entry
points, the extension API (below) and the kit (`tokenomics/kit/`). Functions exported from
`tokenomics/hooks/*` and `tokenomics/scripts/*` are engine-internal: they exist for the engine's own entry
points and the copied unit tests, their signatures may change in any migration, and calling one directly is
**not** guaranteed to behave like the reference (their `settings` / `ext = null` defaults select engine
defaults, not TA behaviour). No reference-compatible facade is provided; B5 revisits this if sdlc-skills
needs a module API. The B2 contract, migration specifications, reference defects and landing order are in
`docs/b2/MIGRATION-MAP.md`.

## Task 9 — engine settings (`tokenomics/engine/config.mjs`)

`loadSettings(repo)` returns the deep-frozen `TA_DEFAULTS` when `<repo>/.agents/tokenomics/settings.json`
is absent (every corpus case), else the file deep-merged over them. Every default is the reference
literal it replaced. Plumbing rule used throughout: an entry point (`main`) loads settings once and
passes them down; every function that holds `settings` passes it to every inner settings-reading call
(Task 9 fix round 1), so one invocation never mixes two settings objects. A helper that takes `repo`
gets a trailing `settings = loadSettings(repo)` parameter (or a `settings` option) — that default exists
for the copied unit tests and is not a compatibility contract (see "Public import boundary" below); a helper
without `repo` (renderers) gets `settings = TA_DEFAULTS`. (install-hooks `configureOtel` names it `engineSettings`: its body
already has a local `settings` — the Claude settings.json.) `loadLines(roots, settings)` applies one
repo's settings to every root; omitted, each root reads its own.

### dir (26 sites)

`telemetryDir(repo, settings)` = `<repo>/.agents/telemetry/<settings.dir>`; rendered paths use
`.agents/telemetry/${settings.dir}/…`. An inventory id covers every line with the same snippet (the
scanner collapses identical lines): `hooks/telemetry-capture.mjs:path-automation:896a40c697`
(`knownSessions`) also covers `appendLine`'s identical `const dir = …` line (reference :121), lifted too.
Line numbers below are reference/49577c7 lines.
`appendLine` passes its settings to `ledgerPath`; the `scripts/diff-impl.test.mjs` mutation anchor moved to
that new text (`appendFileSync(ledgerPath(repo, slug, settings),`) in fix round 1.
`install-hooks.mjs`: `TELEMETRY_README` became `telemetryReadme(settings)` (module-private);
`GITIGNORE_BLOCK` stays exported (`= gitignoreBlock()`, the TA value) next to the new `gitignoreBlock(settings)`.
Only the `automation` segment of the README / submodule notice wording is lifted; "the test-automation
factory's" stays literal (not an engine-config site).

- `hooks/scope-hook.mjs:path-automation:e0db26dd6a` (hooks/scope-hook.mjs:48)
- `hooks/telemetry-capture.mjs:path-automation:f31063fc5a` (hooks/telemetry-capture.mjs:68)
- `hooks/telemetry-capture.mjs:path-automation:ff5578ac0a` (hooks/telemetry-capture.mjs:99)
- `hooks/telemetry-capture.mjs:path-automation:896a40c697` (hooks/telemetry-capture.mjs:104)
- `hooks/telemetry-capture.mjs:path-automation:a250c9ee7b` (hooks/telemetry-capture.mjs:387)
- `hooks/telemetry-capture.mjs:path-automation:39d777f47d` (hooks/telemetry-capture.mjs:633)
- `hooks/telemetry-capture.mjs:path-automation:2cda2a1cfd` (hooks/telemetry-capture.mjs:1417)
- `hooks/telemetry-capture.mjs:path-automation:160f067acb` (hooks/telemetry-capture.mjs:1446)
- `scripts/batch-cost.mjs:path-automation:8ab0fa79f8` (scripts/batch-cost.mjs:92)
- `scripts/build-tokenomics-export.mjs:path-automation:2b372b8acb` (scripts/build-tokenomics-export.mjs:165)
- `scripts/build-tokenomics-export.mjs:path-automation:eb88f29d3d` (scripts/build-tokenomics-export.mjs:179)
- `scripts/build-tokenomics-export.mjs:path-automation:a223922a27` (scripts/build-tokenomics-export.mjs:202)
- `scripts/build-tokenomics-export.mjs:path-automation:564f4a5af3` (scripts/build-tokenomics-export.mjs:259)
- `scripts/install-hooks.mjs:path-automation:01ed5c1b41` (scripts/install-hooks.mjs:297)
- `scripts/install-hooks.mjs:path-automation:99d98f8ee6` (scripts/install-hooks.mjs:436)
- `scripts/install-hooks.mjs:path-automation:5d772d94ea` (scripts/install-hooks.mjs:510)
- `scripts/install-hooks.mjs:path-automation:e671659d7b` (scripts/install-hooks.mjs:511)
- `scripts/install-hooks.mjs:path-automation:79df1b7930` (scripts/install-hooks.mjs:512)
- `scripts/install-hooks.mjs:path-automation:b6c5b81663` (scripts/install-hooks.mjs:513)
- `scripts/install-hooks.mjs:path-automation:896a40c697` (scripts/install-hooks.mjs:538)
- `scripts/install-hooks.mjs:path-automation:49f951aebc` (scripts/install-hooks.mjs:579)
- `scripts/install-hooks.mjs:path-automation:b4234e0b4a` (scripts/install-hooks.mjs:620)
- `scripts/install-hooks.mjs:path-automation:3ec7f88fc9` (scripts/install-hooks.mjs:761)
- `scripts/install-hooks.mjs:path-automation:83be4efed1` (scripts/install-hooks.mjs:765)
- `scripts/team-report.mjs:path-automation:b3440d3758` (scripts/team-report.mjs:38)
- `scripts/work-scope.mjs:path-automation:e0db26dd6a` (scripts/work-scope.mjs:42)

### receipts.root (12 sites)

`receiptsRoot(repo, settings)` = `<repo>/<settings.receipts.root>`; the rendered work-scope NO RECEIPT
message prints `${settings.receipts.root}/…`. `loadReceipts` / `updateBatchCosts` / `receiptPathFor`
take a trailing `settings`; batch-cost, export and team-report `main` load once and pass it
(team-report: per root for the receipt dirs, `roots[0]` in batch mode).

Not lifted (literal kept, recorded here): `scripts/batch-cost.mjs:receipt-reader:8c6b00ef7c` (:62) and
`scripts/team-report.mjs:receipt-reader:8c6b00ef7c` (:132) — the receipts-walk skip rule
(`'telemetry'` / `_`-prefixed / dot dirs) is TA receipts-tree layout knowledge, not a settings value;
§14.4 has no key for it. The walk itself now starts at `receiptsRoot(repo, settings)`.

- `hooks/scope-hook.mjs:path-automation:f3f02f6a9a` (hooks/scope-hook.mjs:87)
- `scripts/batch-cost.mjs:receipt-reader:876c49e97d` (scripts/batch-cost.mjs:45)
- `scripts/batch-cost.mjs:path-automation:f3f02f6a9a` (scripts/batch-cost.mjs:46)
- `scripts/batch-cost.mjs:receipt-reader:8c6b00ef7c` (scripts/batch-cost.mjs:62) — (not lifted)
- `scripts/batch-cost.mjs:receipt-reader:86673af0f0` (scripts/batch-cost.mjs:725)
- `scripts/batch-cost.mjs:receipt-reader:07ee70e383` (scripts/batch-cost.mjs:729)
- `scripts/batch-cost.mjs:path-automation:e90b887e14` (scripts/batch-cost.mjs:758)
- `scripts/build-tokenomics-export.mjs:path-automation:2b6d8efa6f` (scripts/build-tokenomics-export.mjs:291)
- `scripts/team-report.mjs:receipt-reader:8c6b00ef7c` (scripts/team-report.mjs:132) — (not lifted)
- `scripts/team-report.mjs:path-automation:0f6e029e1b` (scripts/team-report.mjs:802)
- `scripts/team-report.mjs:path-automation:a7733e1073` (scripts/team-report.mjs:820)
- `scripts/work-scope.mjs:path-automation:b6b130e522` (scripts/work-scope.mjs:295)

### receipts.file (4 sites)

The receipt file name is `settings.receipts.file` in both receipt walks (`loadReceipts`,
team-report `findReports`), the stop gate's direct lookup and the NO RECEIPT message.
`loadCases(receiptDirs, settings = TA_DEFAULTS)` now calls `findReports(d, settings)` explicitly
(it was `flatMap(findReports)`, which would have passed the index as a second argument).
team-report `main` now loads `settings` once from `roots[0]` before the batch branch.
`scope-hook.mjs:93` (campaign/wave nested `report.json`) is ta-extension (stopGateCheck) — untouched.

- `hooks/scope-hook.mjs:receipt-reader:e7a4e05fdd` (hooks/scope-hook.mjs:88)
- `scripts/batch-cost.mjs:receipt-reader:ddb8113123` (scripts/batch-cost.mjs:65)
- `scripts/team-report.mjs:receipt-reader:47e6282ca6` (scripts/team-report.mjs:135)
- `scripts/work-scope.mjs:receipt-reader:b6b130e522` (scripts/work-scope.mjs:295)

### receipts.deliveredOutcomes (5 sites)

batch-cost `delivered` = `settings.receipts.deliveredOutcomes.reduce((n, o) => n + num(outcomes[o]), 0)`
(same addition order as the reference chain); team-report's `DELIVERED_OUTCOMES` constant is gone —
`loadCases` and the per-case delivered sort read `settings.receipts.deliveredOutcomes`. With `report-windows`, every one of these sites reads the receipt's resolved vocabulary instead (`receiptDelivery`, Codex B2-05; a revisionless receipt still resolves to `settings.receipts.deliveredOutcomes`).
`buildBatchCost` takes `settings` in its options object (default `TA_DEFAULTS`); `updateBatchCosts` passes it.

The `totalPerDelivered` note text (`scripts/batch-cost.mjs:delivered-vocab:0785400df5`, :701) is lifted
(Plan 3 Task 6, P2-09): its parenthesis is `hook(ext, 'enrichGroup', { outcomes }, { settings, phase:
'delivered-note' }) ?? settings.receipts.deliveredOutcomes.join('/')`. The TA extension returns the reference's
current-vs-legacy wording "delivered/defect-found; legacy automated/merged-sanctioned-red" (a flat list cannot
reproduce that split), so TA bytes are unchanged; a foreign configuration shows its own outcomes.

Not lifted:
- `scripts/team-report.mjs:delivered-vocab:59eb40cdad` (:151) — the `'not-started'` default outcome; §14.4 and
  the Task 9 Settings shape have no key for it (assignment note: "no dedicated key").

- `scripts/batch-cost.mjs:delivered-vocab:549873a9e5` (scripts/batch-cost.mjs:597)
- `scripts/batch-cost.mjs:delivered-vocab:71723f9fe6` (scripts/batch-cost.mjs:598)
- `scripts/batch-cost.mjs:delivered-vocab:0785400df5` (scripts/batch-cost.mjs:701) — (enrichGroup `delivered-note`)
- `scripts/team-report.mjs:delivered-vocab:cb77c775e0` (scripts/team-report.mjs:29)
- `scripts/team-report.mjs:delivered-vocab:59eb40cdad` (scripts/team-report.mjs:151) — (not lifted)

### intents.default (3 sites)

`openScope` keeps the `intent ?? prev.intent ??` chain and ends it with `settings.intents.default`;
`recordOutcomes`' self-healing record uses the same default. Both take a trailing `settings`;
work-scope `main` loads settings once (inside its try, so a malformed file is a `work-scope:` error, exit 1).
(Two inventory ids share work-scope :61 — path-automation and intent-default.)

- `scripts/work-scope.mjs:path-automation:d98c2fe677` (scripts/work-scope.mjs:61)
- `scripts/work-scope.mjs:intent-default:d98c2fe677` (scripts/work-scope.mjs:61)
- `scripts/work-scope.mjs:path-automation:6ca2577558` (scripts/work-scope.mjs:81)

### ratioIntents (9 sites)

scope-hook: `INTENTS` is now `suggestedIntents(B1_DEFAULTS)` (still exported, same array; `TA_DEFAULTS` until B2
closed) where `suggestedIntents(settings) = [...b1RatioIntents(settings), …the six open labels]`; the announce / first
stop-gate text names `--intent <first ratio intent>`: under `report-windows` the current manifest's
(`groupIntent(ratioIntentsOf(repo, settings))`, falling back to `settings.intents.default` when the manifest names
none), else `b1RatioIntents(settings)[0]`; it lists the suggestions minus the ratio intents. `announceLine` / `gateDecision` take a trailing `settings` after `scriptUrl`; `main` loads once.
team-report: `buildReport(lines, cases, settings = TA_DEFAULTS)` sums the byIntent buckets of every
ratio intent (`0 + x` for TA's single intent — the identical float); the Markdown/HTML labels render
`${settings.ratioIntents.join('/')}-intent spend only`. `renderMarkdown` / `renderTeamHtml` take a
trailing `settings`; `main` passes the one it loaded.

Kept literal (output field name, not a settings value): the `automationOnlyCostUsd` property of
`perDelivered` (sites :246 / :743 / :745 read or write it) — renaming a `--json` field is a schema
change, outside a pure extraction.

B2 (`report-windows`, map D1): these sites read `settings.ratioIntents` only with the migration off, where settings
merge over the frozen `B1_DEFAULTS`. Since B2 closed `TA_DEFAULTS` has no `ratioIntents`, so these reads go through
`b1RatioIntents(settings)` (`engine/config.mjs`), which falls back to `B1_DEFAULTS.ratioIntents` when a caller passes a
B2-contract object (e.g. the `settings = TA_DEFAULTS` parameter default). With it on, `buildReport` binds each line's ratio intents through
`engine/manifest.mjs` (`manifestFor`) and the scope hook suggests `currentManifest(...).ratioIntents`
(`ratioIntentsOf`); `automationOnlyCostUsd` is not written (the §5.5 `perDelivered.costUsd` is the scoped ratio).

- `hooks/scope-hook.mjs:path-automation:a141c3cc80` (hooks/scope-hook.mjs:46)
- `hooks/scope-hook.mjs:path-automation:a2ee5d47dc` (hooks/scope-hook.mjs:70)
- `hooks/scope-hook.mjs:path-automation:c80d4d9bb9` (hooks/scope-hook.mjs:71)
- `hooks/scope-hook.mjs:path-automation:934ff241bb` (hooks/scope-hook.mjs:133)
- `hooks/scope-hook.mjs:path-automation:1f97c236af` (hooks/scope-hook.mjs:134)
- `scripts/team-report.mjs:path-automation:3221caccb6` (scripts/team-report.mjs:246)
- `scripts/team-report.mjs:path-automation:296ff9227a` (scripts/team-report.mjs:291)
- `scripts/team-report.mjs:path-automation:f5913ac5a2` (scripts/team-report.mjs:743) — (not lifted)
- `scripts/team-report.mjs:path-automation:44dafb95a5` (scripts/team-report.mjs:745)

### ids.patterns (8 sites)

`CASE_ID_RE` is gone: its source is `TA_DEFAULTS.ids.patterns[0]` (copied from `RegExp.prototype.source`,
asserted equal), compiled by `idPatterns(settings)` with `${ids.flags}g` — TA flags `''`, i.e. exactly
the reference `/…/g`. New `mineIds(settings, texts)` runs every pattern over every text (one pattern
under TA ⇒ the reference loop, same match order); `extractCaseIds(...texts)` keeps its reference
signature as `mineIds(TA_DEFAULTS, texts)` (its copied unit test is unchanged). Every engine caller now
calls `mineIds(settings, […])`: `parseClaudeTranscript` / `parseVsCodeChatSession` take `settings` in
their options (default `TA_DEFAULTS`); `captureDispatches`, `captureCopilotDispatches`,
`captureClaudeSession`, `captureCopilotSession`, `captureVsCodeSession` take `settings` in their options
(default `loadSettings(repo)`); `main` passes its settings to the dispatch and direct-capture calls.
Compiled regexes are cached per `settings.ids` object (WeakMap).

- `hooks/telemetry-capture.mjs:case-id-miner:47dba68484` (hooks/telemetry-capture.mjs:207)
- `hooks/telemetry-capture.mjs:case-id-miner:54a71e4977` (hooks/telemetry-capture.mjs:210)
- `hooks/telemetry-capture.mjs:case-id-miner:94e9358035` (hooks/telemetry-capture.mjs:214)
- `hooks/telemetry-capture.mjs:case-id-miner:d07d3d3da0` (hooks/telemetry-capture.mjs:315)
- `hooks/telemetry-capture.mjs:case-id-miner:32839da988` (hooks/telemetry-capture.mjs:523)
- `hooks/telemetry-capture.mjs:case-id-miner:3836c5759d` (hooks/telemetry-capture.mjs:733)
- `hooks/telemetry-capture.mjs:case-id-miner:38b5f65edb` (hooks/telemetry-capture.mjs:990)
- `hooks/telemetry-capture.mjs:case-id-miner:7708c9941c` (hooks/telemetry-capture.mjs:1145)

### ids.max (2 sites)

`CASE_ID_MAX` is gone; `mineIds` stops at `settings.ids.max` distinct ids (TA: 50).

- `hooks/telemetry-capture.mjs:case-id-miner:20e87cff12` (hooks/telemetry-capture.mjs:209)
- `hooks/telemetry-capture.mjs:case-id-miner:79a55357c7` (hooks/telemetry-capture.mjs:217)

### ids.stoplist (2 sites)

`CASE_ID_STOP` is gone; `mineIds` drops a match whose dash-prefix is in `new Set(settings.ids.stoplist)` (TA: the reference 15 tokens, same order), cached with the compiled patterns.

- `hooks/telemetry-capture.mjs:case-id-miner:b616c818a3` (hooks/telemetry-capture.mjs:208)
- `hooks/telemetry-capture.mjs:case-id-miner:71a639fe4b` (hooks/telemetry-capture.mjs:215)

### vocabulary.item — part 1: scope-hook, work-scope, batch-cost, export (17 sites)

Rendered forms come from `words(settings)` (engine/config.mjs): `item`/`items`/`Item`/`Items` (TA:
case/cases/Case/Cases; plural +es after s/x/z/ch/sh else +s, capitalise first letter). Only the
rendered wording is lifted — property names (`scope.cases`, `c.cases`), JSON keys and CLI flags stay.
Plumbing: `renderStatus(…, settings = TA_DEFAULTS)` (work-scope `main` passes its settings);
`renderCompare(a, b, settings = TA_DEFAULTS)` — the `--compare` CLI path loads `loadSettings(process.cwd())`
(it has no repo argument); batch-cost notes read the `settings` `buildBatchCost` already receives.

Not lifted (kept verbatim, per the assignment notes "flag kept verbatim under TA config"):
- `hooks/scope-hook.mjs:qa-wording:c8ba160736` (:69) — the only `case` text on the line is the
  `--cases <ID,ID,…>` CLI flag of `work-scope open`.
- `scripts/work-scope.mjs:qa-wording:9e10233a19` (:266) — `arg('--cases')` / the scope's `cases` field.
- `hooks/scope-hook.mjs:qa-wording:934ff241bb` (:133) — its `--cases` flag stays; the trailing
  rendered "no batch/cases" IS lifted.

- `hooks/scope-hook.mjs:qa-wording:aa0618862b` (hooks/scope-hook.mjs:65)
- `hooks/scope-hook.mjs:qa-wording:c8ba160736` (hooks/scope-hook.mjs:69) — (not lifted)
- `hooks/scope-hook.mjs:qa-wording:a2ee5d47dc` (hooks/scope-hook.mjs:70)
- `hooks/scope-hook.mjs:qa-wording:c80d4d9bb9` (hooks/scope-hook.mjs:71)
- `hooks/scope-hook.mjs:qa-wording:934ff241bb` (hooks/scope-hook.mjs:133) — (partly lifted: the `--cases` flag stays)
- `scripts/batch-cost.mjs:qa-wording:035343342e` (scripts/batch-cost.mjs:667)
- `scripts/batch-cost.mjs:qa-wording:9d372f46cb` (scripts/batch-cost.mjs:675)
- `scripts/batch-cost.mjs:qa-wording:9d0a84b4d1` (scripts/batch-cost.mjs:692)
- `scripts/batch-cost.mjs:qa-wording:ddb6c8d513` (scripts/batch-cost.mjs:703)
- `scripts/batch-cost.mjs:qa-wording:e61182fd07` (scripts/batch-cost.mjs:760)
- `scripts/build-tokenomics-export.mjs:qa-wording:e360413db1` (scripts/build-tokenomics-export.mjs:246)
- `scripts/build-tokenomics-export.mjs:qa-wording:90f43b028a` (scripts/build-tokenomics-export.mjs:249)
- `scripts/work-scope.mjs:qa-wording:096c45ad2a` (scripts/work-scope.mjs:172)
- `scripts/work-scope.mjs:qa-wording:72d84b7737` (scripts/work-scope.mjs:177)
- `scripts/work-scope.mjs:qa-wording:9e10233a19` (scripts/work-scope.mjs:266) — (not lifted)
- `scripts/work-scope.mjs:qa-wording:2307ebfcd8` (scripts/work-scope.mjs:269)
- `scripts/work-scope.mjs:qa-wording:7abb2d94cd` (scripts/work-scope.mjs:322)

### vocabulary.item — part 2: team-report (33 sites)

All four batch renderers take a trailing `settings = TA_DEFAULTS` (`renderBatchMarkdown`,
`renderBatchHtml`, `renderBatchTokenomicsMarkdown`, `renderBatchTokenomicsHtml`) and call
sites pass settings explicitly — team-report `main` (`results.map((r) => mdR(r, settings))`, never a
bare `.map(fn)` that would pass the index), work-scope `generateBatchReports(repo, scope, settings)`
(close) and telemetry-capture `renderLiveReport` (live page; it also passes settings to
`updateBatchCosts`). `renderMarkdown` / `renderTeamHtml` reuse their `settings`; `main`'s
`perCaseStats` note uses `words(settings)`. Settings words are inserted unescaped in HTML, exactly where
the reference literal sat (settings.json is operator-trusted repo config). Single-quoted literals became
template literals; inner `\'` / backticks were re-escaped for the template form (byte-identical output).
batch-cost's binding was renamed `w` → `vocab` in this commit (its `buildBatchCost` already has a
loop-local `w` weight).

Deferred to vocabulary.delivered: `scripts/team-report.mjs:288` ("unique case(s)") — that line's
inventory id is assigned to vocabulary.delivered; its `case(s)` word is lifted in that commit.
Sizing table wording (`| size | cases | …`, :424+) is ta-extension (enrichGroup) — untouched.

- `scripts/team-report.mjs:qa-wording:1de4119a69` (scripts/team-report.mjs:278)
- `scripts/team-report.mjs:qa-wording:224549afc8` (scripts/team-report.mjs:286)
- `scripts/team-report.mjs:qa-wording:296ff9227a` (scripts/team-report.mjs:291)
- `scripts/team-report.mjs:qa-wording:9319318ac4` (scripts/team-report.mjs:292)
- `scripts/team-report.mjs:qa-wording:6d80ef5860` (scripts/team-report.mjs:298)
- `scripts/team-report.mjs:qa-wording:c9cdef9bf8` (scripts/team-report.mjs:306)
- `scripts/team-report.mjs:qa-wording:7c0fbdc7a5` (scripts/team-report.mjs:308)
- `scripts/team-report.mjs:qa-wording:311d1a8bfa` (scripts/team-report.mjs:309)
- `scripts/team-report.mjs:qa-wording:2e8c7aa96a` (scripts/team-report.mjs:312)
- `scripts/team-report.mjs:qa-wording:e4887c56cd` (scripts/team-report.mjs:383)
- `scripts/team-report.mjs:qa-wording:3a2995618d` (scripts/team-report.mjs:391)
- `scripts/team-report.mjs:qa-wording:a9ffaa99ce` (scripts/team-report.mjs:402)
- `scripts/team-report.mjs:qa-wording:af0cb62796` (scripts/team-report.mjs:403)
- `scripts/team-report.mjs:qa-wording:fcc2d248d6` (scripts/team-report.mjs:404)
- `scripts/team-report.mjs:qa-wording:28b178c70b` (scripts/team-report.mjs:411)
- `scripts/team-report.mjs:qa-wording:74cca45492` (scripts/team-report.mjs:415)
- `scripts/team-report.mjs:qa-wording:82cd434cc9` (scripts/team-report.mjs:416)
- `scripts/team-report.mjs:qa-wording:973d4f68ac` (scripts/team-report.mjs:421)
- `scripts/team-report.mjs:qa-wording:e7c749a522` (scripts/team-report.mjs:540)
- `scripts/team-report.mjs:qa-wording:7c9c0d8016` (scripts/team-report.mjs:549)
- `scripts/team-report.mjs:qa-wording:196d5a9dff` (scripts/team-report.mjs:562)
- `scripts/team-report.mjs:qa-wording:a94159d70c` (scripts/team-report.mjs:573)
- `scripts/team-report.mjs:qa-wording:06482b6c8d` (scripts/team-report.mjs:574)
- `scripts/team-report.mjs:qa-wording:75935bf8e2` (scripts/team-report.mjs:655)
- `scripts/team-report.mjs:qa-wording:f6df416bdf` (scripts/team-report.mjs:718)
- `scripts/team-report.mjs:qa-wording:9b87c80364` (scripts/team-report.mjs:719)
- `scripts/team-report.mjs:qa-wording:f5913ac5a2` (scripts/team-report.mjs:743)
- `scripts/team-report.mjs:qa-wording:c25d704c36` (scripts/team-report.mjs:744)
- `scripts/team-report.mjs:qa-wording:b3aa5901d5` (scripts/team-report.mjs:772)
- `scripts/team-report.mjs:qa-wording:3bec0f9693` (scripts/team-report.mjs:774)
- `scripts/team-report.mjs:qa-wording:be26c9c597` (scripts/team-report.mjs:775)
- `scripts/team-report.mjs:qa-wording:014584f598` (scripts/team-report.mjs:776)
- `scripts/team-report.mjs:qa-wording:f13187655d` (scripts/team-report.mjs:851)

### vocabulary.group (36 sites)

Rendered `batch`/`batches`/`Batch`/`Batches` wording now comes from `words(settings)` (`group`,
`groups`, `Group`, `Groups`) at every site below, reusing the item commits' plumbing (export's
`writeSubmission` / `main` call `words(settings)` directly). Kept verbatim, as identifiers rather than
wording: `--batch` CLI flags, `c.batch` / `scope.batch` properties, the `batch-cost` /
`batch-report` / `batch-tokenomics` file names, and the ta-extension second stop gate (scope-hook :141).
The batch-cost :701 note lifts its `batch` word here; its delivered-outcome list comes from the
enrichGroup `delivered-note` phase (see receipts.deliveredOutcomes).

Also lifted (not an inventory site — the B0 scanner's markup branch matches `<t[hd]>`, not `<title>`):
the HTML `<title>` of `renderBatchHtml` / `renderBatchTokenomicsHtml` (`Batch cost —` / `Batch tokenomics —`,
reference team-report :565 / :699), so each page's title matches its lifted `<h1>`.

- `hooks/scope-hook.mjs:group-wording:aa0618862b` (hooks/scope-hook.mjs:65)
- `hooks/scope-hook.mjs:group-wording:a2ee5d47dc` (hooks/scope-hook.mjs:70)
- `hooks/scope-hook.mjs:group-wording:c80d4d9bb9` (hooks/scope-hook.mjs:71)
- `hooks/scope-hook.mjs:group-wording:934ff241bb` (hooks/scope-hook.mjs:133)
- `scripts/batch-cost.mjs:group-wording:d5d1f81bd2` (scripts/batch-cost.mjs:652)
- `scripts/batch-cost.mjs:group-wording:035343342e` (scripts/batch-cost.mjs:667)
- `scripts/batch-cost.mjs:group-wording:9d372f46cb` (scripts/batch-cost.mjs:675)
- `scripts/batch-cost.mjs:group-wording:0785400df5` (scripts/batch-cost.mjs:701)
- `scripts/batch-cost.mjs:group-wording:ddb6c8d513` (scripts/batch-cost.mjs:703)
- `scripts/build-tokenomics-export.mjs:group-wording:1a5bb21269` (scripts/build-tokenomics-export.mjs:199)
- `scripts/build-tokenomics-export.mjs:group-wording:2b6d8efa6f` (scripts/build-tokenomics-export.mjs:291)
- `scripts/team-report.mjs:group-wording:9319318ac4` (scripts/team-report.mjs:292)
- `scripts/team-report.mjs:group-wording:5a39de62f9` (scripts/team-report.mjs:297)
- `scripts/team-report.mjs:group-wording:6d80ef5860` (scripts/team-report.mjs:298)
- `scripts/team-report.mjs:group-wording:c9cdef9bf8` (scripts/team-report.mjs:306)
- `scripts/team-report.mjs:group-wording:13c6b6fd58` (scripts/team-report.mjs:310)
- `scripts/team-report.mjs:group-wording:2e8c7aa96a` (scripts/team-report.mjs:312)
- `scripts/team-report.mjs:group-wording:86d8aa0bfc` (scripts/team-report.mjs:377)
- `scripts/team-report.mjs:group-wording:efac16b6d5` (scripts/team-report.mjs:380) — the `other-batch dispatch(es)` part lifted in the final fix wave
- `scripts/team-report.mjs:group-wording:a507ea3cca` (scripts/team-report.mjs:566)
- `scripts/team-report.mjs:group-wording:e91739f2cc` (scripts/team-report.mjs:570) — the `other-batch dispatch(es)` part lifted in the final fix wave
- `scripts/team-report.mjs:group-wording:06482b6c8d` (scripts/team-report.mjs:574)
- `scripts/team-report.mjs:group-wording:f0198f4142` (scripts/team-report.mjs:602)
- `scripts/team-report.mjs:group-wording:cf718ee628` (scripts/team-report.mjs:639)
- `scripts/team-report.mjs:group-wording:3fc23d7d44` (scripts/team-report.mjs:700)
- `scripts/team-report.mjs:group-wording:046f34bf72` (scripts/team-report.mjs:709)
- `scripts/team-report.mjs:group-wording:f6df416bdf` (scripts/team-report.mjs:718)
- `scripts/team-report.mjs:group-wording:7624c2365a` (scripts/team-report.mjs:755)
- `scripts/team-report.mjs:group-wording:a9a5fedf83` (scripts/team-report.mjs:771)
- `scripts/team-report.mjs:group-wording:b3aa5901d5` (scripts/team-report.mjs:772)
- `scripts/team-report.mjs:group-wording:3bec0f9693` (scripts/team-report.mjs:774)
- `scripts/team-report.mjs:group-wording:014584f598` (scripts/team-report.mjs:776)
- `scripts/team-report.mjs:group-wording:0f6e029e1b` (scripts/team-report.mjs:802)
- `scripts/team-report.mjs:group-wording:f13187655d` (scripts/team-report.mjs:851)
- `scripts/work-scope.mjs:group-wording:b6b130e522` (scripts/work-scope.mjs:295)
- `scripts/work-scope.mjs:group-wording:ca613b2428` (scripts/work-scope.mjs:302)

### vocabulary.delivered (2 sites)

team-report `renderMarkdown` renders `**${settings.vocabulary.delivered}: N**` (TA: `delivered (automated)`);
the same line's `unique case(s)` (deferred from vocabulary.item) is `${w.item}(s)`.

Not lifted: `scripts/team-report.mjs:qa-wording:422ceee8db` (:753) — `statCell('delivered / examined', …)` renders
the bare word `delivered`, not the `vocabulary.delivered` label `delivered (automated)`; the value cannot
be derived from the configured label (the ruling's "keep the literal" case).

- `scripts/team-report.mjs:qa-wording:e2b0370eb1` (scripts/team-report.mjs:288)
- `scripts/team-report.mjs:qa-wording:422ceee8db` (scripts/team-report.mjs:753) — (not lifted)

### paths (1 sites)

`TA_DEFAULTS.paths = { factoryProfile: 'factory-profile.json' }`. install-hooks' flat-era migration
matches `settings.paths.factoryProfile` (it already receives `settings`). For coherence the export's
`loadProfile` reads the same key (`<telemetryDir>/<paths.factoryProfile>`; its `'factory-profile.json'`
literal at reference :259 was assigned under `dir` only), and work-scope close passes its settings to
`loadProfile` / `appendRun`.

- `scripts/install-hooks.mjs:export-qa:e0528cc900` (scripts/install-hooks.mjs:437, paths.factoryProfile)

### reports (1 sites)

work-scope close writes `batch-report.*` / `batch-tokenomics.*` into `groupReportsDir(repo, settings, batch)`
(engine/config.mjs): for `reports.location === 'tree'` (TA) that is `<receiptsRoot>/<batch path>` — the
reference `join(repo, '.agents', 'automation', ...batch.split('/'))` byte for byte. B1 knows no other
location; any other value throws `unsupported reports.location` (tested) rather than inventing a layout.

- `scripts/work-scope.mjs:path-automation:47c6f2223e` (scripts/work-scope.mjs:221, reports.location)

### env (11 sites)

Record only (per the brief): these environment switches stay `env.X` / `process.env.X` reads — they are
operator/test overrides, not project settings. No code changed.

| switch | effect |
|---|---|
| `TOKENOMICS_CCUSAGE_BIN` | meter binary (default `npx`) |
| `TOKENOMICS_CLAUDE_ROOT` / `TOKENOMICS_COPILOT_ROOT` / `TOKENOMICS_VSCODE_ROOT` | host store roots |
| `TOKENOMICS_NO_BATCH_COST` | disables the live batch page |
| `TOKENOMICS_NO_CCUSAGE` | disables metering (lines stay unpriced) |
| `TOKENOMICS_NO_SINK` | never starts the OTel sink |
| `TOKENOMICS_NO_SYNC` | no telemetry-branch commit/push |
| `TOKENOMICS_SINK_IDLE_MS` | OTel sink idle timeout |

- `hooks/telemetry-capture.mjs:env-var:7c67e137e5` (hooks/telemetry-capture.mjs:569, env.TOKENOMICS_CCUSAGE_BIN) — (record only)
- `hooks/telemetry-capture.mjs:env-var:536d58bacb` (hooks/telemetry-capture.mjs:837, env.TOKENOMICS_CLAUDE_ROOT) — (record only)
- `hooks/telemetry-capture.mjs:env-var:f376acf2f6` (hooks/telemetry-capture.mjs:849, env.TOKENOMICS_COPILOT_ROOT) — (record only)
- `hooks/telemetry-capture.mjs:env-var:29ffff3293` (hooks/telemetry-capture.mjs:850, env.TOKENOMICS_COPILOT_ROOT) — (record only)
- `hooks/telemetry-capture.mjs:env-var:93a6838389` (hooks/telemetry-capture.mjs:1433, env.TOKENOMICS_NO_BATCH_COST) — (record only)
- `hooks/telemetry-capture.mjs:env-var:2a6b7e6489` (hooks/telemetry-capture.mjs:558, env.TOKENOMICS_NO_CCUSAGE) — (record only)
- `hooks/telemetry-capture.mjs:env-var:d228e1af79` (hooks/telemetry-capture.mjs:1345, env.TOKENOMICS_NO_SINK) — (record only)
- `hooks/telemetry-capture.mjs:env-var:bbd52c9dd1` (hooks/telemetry-capture.mjs:1465, env.TOKENOMICS_NO_SYNC) — (record only)
- `hooks/otel-sink.mjs:env-var:340c7465a4` (hooks/otel-sink.mjs:98, env.TOKENOMICS_SINK_IDLE_MS) — (record only)
- `hooks/telemetry-capture.mjs:env-var:016d3cabea` (hooks/telemetry-capture.mjs:1009, env.TOKENOMICS_VSCODE_ROOT) — (record only)
- `hooks/telemetry-capture.mjs:env-var:95c0e2ffbb` (hooks/telemetry-capture.mjs:1010, env.TOKENOMICS_VSCODE_ROOT) — (record only)

### Task 9 fix round 1 — settings validation

`loadSettings` validates the merged settings (`validateSettings`, exported) before freezing them and
throws the named `tokenomics: invalid .agents/tokenomics/settings.json: <reason>` error for: an
unsupported `reports.location` (B1: only `tree` — previously it threw late inside work-scope close and
surfaced as a false "NO RECEIPT" warning), an `ids.patterns` entry that is not a string or does not
compile with `${ids.flags}g`, `ids.flags` containing `g` (the miner adds it), an empty `ratioIntents`,
plus empty `dir`, non-positive `ids.max`, non-string stoplist entries and empty
`vocabulary.item`/`vocabulary.group`. `TA_DEFAULTS` passes (tested); an absent file still returns
`TA_DEFAULTS` itself. `words()` also handles consonant+`y` plurals (`story` → `stories`); TA's
`case`/`batch` are unaffected.

### Task 9 fix round 1 — notes

- **Multi-root team-report.** Roots with different settings are rejected (exit 2); per-root policy merging is a B2 decision.
  Equal settings must also load the same extension module (`extensionPath`: same resolved path, or byte-identical
  files; a missing module rejects too). Batch mode (`--batch` / `--batches`) uses `roots[0]` alone and skips the check.
  Settings compare as canonical JSON (object keys sorted recursively, array order kept), so key order in
  settings.json never causes a rejection (final review).
  **Known limitation (fail-closed, rc.2):** settings come from `<root>/.agents/tokenomics/settings.json`, so a root
  given as a telemetry dir or a single ledger file always reads as `TA_DEFAULTS`; a foreign repo root plus one of its
  own ledger files (or its telemetry dir) is therefore rejected with exit 2. Pass the repo root instead.
- **`build-tokenomics-export --compare`** is a pure two-file compare: it renders with `TA_DEFAULTS`
  unless `--repo <root>` names a repo whose settings (vocabulary — the only settings it uses, row labels)
  to load. It no longer reads `process.cwd()`, so a malformed settings.json there cannot break it.
- Not-lifted / partly-lifted / record-only ids are marked inline in each key's list above, so the lists
  audit mechanically (`grep -c "(not lifted)"`).

## Task 10 — TA extension (`tokenomics/extensions/test-automation.mjs`)

`engine/extension.mjs`: `loadExtension(settings, repo, engineRoot = ENGINE_ROOT)` imports `settings.extension`
(`null` = none) and requires `extensionApi === 1` (API 2 since Plan 4 Task 21: `=== 2`); a relative path resolves against the engine root
`tokenomics/` only for the built-in TA default (no settings file), and against the repo root when a
settings file supplies it (spec §14.4; final fix wave — a present settings file must state `extension`);
`hook(ext, name, ...args)` calls a present hook and returns `undefined` otherwise, so every engine call
site reads `hook(ext, '<name>', input, ctx) ?? <engine default>`. Every TA site moved verbatim into the
extension; paths it builds derive from `ctx.settings` (`telemetryDir` / `receiptsRoot`), never a copy of
the TA layout.

Plumbing (same rule as Task 9's `settings`): each entry point's `main` loads the extension once, right
after `loadSettings`, and passes `ext` down; a function that calls a hook takes `ext = null` — a trailing
positional parameter, or an `ext` option where the function already takes an options object (like its
`settings`). `null` is a default for the copied unit tests, not reference behaviour: a direct caller that
omits `ext` gets the engine defaults, not the TA behaviour (Codex P2-10; see "Public import boundary"). `batch-cost`, `team-report` and
`build-tokenomics-export` `main` became `async` (guards: `await main()` / `process.exit(await main())`)
so they can load it; exit codes and output are unchanged. team-report loads the one
extension from `roots[0]`'s settings, which every root shares (roots with different settings are rejected, Task 9 notes).

### Extension API

> **API 2, frozen** (decision D3, `docs/b2/MIGRATION-MAP.md`; Plan 4 Task 21, after every B2 migration landed).
> C1 targets API 2. A change to a call's parts, input, ctx fields or return contract below is API 3. API 1 (B1,
> provisional) is retired: a module declaring `extensionApi = 1` is rejected.

**Loading.** A module is loaded only when it exports `extensionApi === 2` (`EXTENSION_API`, `engine/extension.mjs`;
strict, else `tokenomics: extension API mismatch`). The check does not consult `TOKENOMICS_MIGRATIONS`: a migrations-off
run (replay, the B4 rescue writer) uses the same loader and the same `hook()`. Every hook is optional; a missing hook
is never called and its call site's engine default applies. **The extension's file name is observable:** with
`reports-location` on, a present settings file that omits `reports.location` defaults to `"telemetry"` (engine reports
and `cost.json` under `.agents/telemetry/<dir>/reports/`) unless the extension path's basename is `test-automation` or
`test-automation.mjs`, which keeps `"tree"`; so a non-TA (C1) extension gets relocated reports by default (see
"Settings").

**Calling convention.** Every call is `hook(ext, name, input, ctx)`, read synchronously as
`hook(...) ?? <engine default>`. `ctx = { repo?, settings?, phase?, part?, … }`: `phase` absent is the spec §14.3
call; a named phase is one of the hook's other engine sites; `ctx.part` (`ctx.slot` for `exportRow:checklist`) selects
the fragment a render or submission call asks for. **Hooks are synchronous:** a thenable result throws
`tokenomics: extension hook <name> returned a Promise (hooks are synchronous)` (error code
`ERR_EXTENSION_ASYNC_HOOK`) instead of being spread or concatenated by the call site. Some engine call sites are
best-effort and swallow a throw (close's `onClose`, the capture's per-session sweep), so `hook()` also writes the
message to stderr, once per hook name per process, and handles the Promise's own rejection.

**Two layers.** The table states the API 2 contract with every B2 migration on: all seventeen are landed, on by
default (`TOKENOMICS_MIGRATIONS` unset), and production switches none off (owner Q3). The calls, parts, ctx fields and
return contracts are the same with migrations on or off (the corpus trace records the same `name:phase#part` set
either way), except `exportRow:anonymize` under `anon-complete` (its row). What a migration changes is the **values** a
call receives, listed in the last column. With that migration switched
off (`TOKENOMICS_MIGRATIONS=none` or a subset; replay and the B4 rescue writer), the call receives the API 1 value
instead. So an API 2 extension reads every input by field (O10): a `null` where API 1 always had a number, an
`unmeasured` object that may be absent, and a `manifestRevision` key that may be absent.

**Contract table** (one row per `HOOK_CALLS` entry, as the hook trace writes it; a test keeps the rows equal to
`HOOK_CALLS`, and each row's parts equal to the parts the corpus trace records for that call). "spread" means the
result is spread into the engine's output object at the reference key position; `?? d` means `undefined`/`null`
falls back to the engine default `d`, which is what an extension `null` gets.

| call | parts | input | ctx (besides `phase`, `part`) | return contract | with a migration on (off: the API 1 value) |
|---|---|---|---|---|---|
| `classifyDispatch` | — | dispatch label (string) | `repo`, `settings` (batch-cost `classify`) | `'direct'` or an overhead stage name; `?? 'direct'` | `exact-ids`: after a `'direct'` verdict the engine matches receipt ids in the label as whole, case-sensitive tokens (off: case-insensitive substring); the verdict contract is unchanged |
| `classifyDispatch:stage-names` | — | `null` | batch-cost: `repo`, `settings`, `acc`, `addTo`, `emptyBucket`; team-report: `settings` | named overhead stages (`string[]`, overhead wording); `?? []` | — |
| `classifyDispatch:case-init` | — | `null` | `repo`, `settings`, `acc`, `addTo`, `emptyBucket` | object spread into each new case bucket; `?? {}` | — |
| `classifyDispatch:direct` | — | dispatch label | `repo`, `settings`, `acc`, `addTo`, `emptyBucket`, `m` (the dispatch's measured quantities), `w` (its weight), `share` (per-case share), `rows` (the matched case buckets) | ignored; side effects on `ctx.acc` / `ctx.rows` | `shared-allocation`: `w` = 1/k for a dispatch in k groups (else 1), `share` = `w` / cluster size; `exact-ids`: `rows` are the case buckets whose receipt id the label names as a whole, case-sensitive token (`[A-Za-z0-9_-]` boundary), or that equal a dispatch `cases` entry by `===` (off: case-insensitive substring and comparison); an inclusive line's dispatch (the line's own `tokensBasis: "inclusive"`, read by field whatever the switch set, O10; `copilot-inclusive` writes such lines) has `m.tokens` 0 and `m.tok` the zero quad `{input: 0, output: 0, cacheRead: 0, cacheWrite: 0}`, never `null`; with `null-unobservable` on, `m.nul.tokens` is `true` for it, which is the field to test (off: no `m.nul`, and an inclusive dispatch is indistinguishable from a measured zero); `null-unobservable`: `m.nul` = which of `tokens`/`activeMin`/`toolCalls`/`toolErrors` the dispatch did not measure (`true`), measured (`false`) or that do not apply (`null`); `active-minutes`: `m.activeMin` `null` (minutes are session grain) |
| `classifyDispatch:overhead` | — | dispatch label | as `case-init` plus `m`, `w` | ignored; side effects on `ctx.acc` | as `direct` for `m` and `w` (no `rows`) |
| `classifyDispatch:case-out` | — | the case's accumulated bucket | as `case-init` | object spread into the case's `direct` row; `?? {}` | `null-unobservable`: the bucket carries the measured set (see "Buckets") |
| `classifyDispatch:overhead-out` | — | `null` | as `case-init` plus `bucketOut` | object spread at the end of `cost.overhead`; `?? {}` | `null-unobservable`: `bucketOut(b)` returns `null` sums beside `unmeasured`; `active-minutes`: `bucketOut(b).activeMin` is `null` for a dispatch-partition bucket (every extension bucket) |
| `classifyDispatch:group-out` | — | `null` | as `overhead-out` | object spread after `cost.overhead`; `?? {}` | as `overhead-out` |
| `classifyDispatch:render-md` | `what`, `cost`, `case-head`, `case-cells` | the group's cost object (`case-cells`: the case row) | `settings`, `usd` | `what`: string; `cost`, `case-head`, `case-cells`: `string[]` spread into the line / header / row; `?? ''` / `[]` | cost object values (see "Cost objects"); `active-minutes`: TA's `cost` part prints a `null` stage minute as `—` |
| `classifyDispatch:render-html` | `case`, `delivery-cells`, `cost-cell`, `cost-callout` | the cost object (`case`: the case row) | `settings`, `usd`, `statCell`, `esc`, `fmtInt` | `case`: HTML string or `undefined`; `delivery-cells`: `string[]`; `cost-cell`: a stat cell string, `??` the engine's avg-direct cell; `cost-callout`: string, `?? null` | cost object values |
| `classifyDispatch:render-tok-md` | — | the cost object | `settings`, `rowFor` | `string[]` spread into the tokenomics page; `?? []` | cost object values; `null-unobservable`: TA keeps a stage whose `tok` is `null` when its `unmeasured.tokens` is non-zero |
| `classifyDispatch:render-tok-html` | — | the cost object | `settings`, `row` | HTML string; `?? ''` | as `render-tok-md` |
| `labelFrom` | — | `{ description, firstText }` | `repo`, `settings` | the label string; any value other than `undefined` is the label; `undefined` gives the first 160 chars of the description, else of the first message (whitespace-collapsed) | — |
| `receiptIds` | — | `{ id }` (the dispatch id) | `repo`, `settings` | `string[]` or `null`; `null` falls back to scope-gated mining, `[]` means "no ids" | `exact-ids`: the returned ids become the ledger dispatch's `cases`, which the join compares with receipt case ids by `===` (case-sensitive), so return them exactly as the receipt spells them (off: case-insensitive, so a case-normalised id still joined); `capture-robustness`: TA's own listing is sorted (it takes an optional `ctx.fs`, a test seam the engine never passes) |
| `enrichGroup:case` | — | the receipt's case row | `repo`, `settings` | object spread into the case's cost row; `?? {}` | — |
| `enrichGroup:records` | — | the receipt | `repo`, `settings`, `slug`, `dir` (the group's receipt dir), `scopes` (the repo's scope records) | object spread after `delivered`; `?? {}` | `scope-resolution`: `scopes` holds the flat records then each host's (`scopes/<host>/`), and a record may carry `role` and `claimedFrom` |
| `enrichGroup:sizing` | — | the `cases` array of the cost object being built (stamped in place) | `repo`, `settings`, `slug` | object spread after `workItemRef`; `?? {}` | `active-minutes`: rows carry no per-case actual minutes (`direct.activeMin` `null`); `loaded.activeMin` is the allocation (TA labels its estimate `basis: "allocated"`); `null-unobservable`: `loaded.tokens` / `loaded.activeMin` may be `null` beside `loaded.unmeasured` |
| `enrichGroup:match` | — | a group's cost object | `repo`, `settings`, `scope` | boolean: does the group serve the declared group; `?? (c.batch === scope.batch)` (a returned `false` is honoured) | cost object values; `scope-resolution`: the scope record shape (`role`, `claimedFrom`) |
| `enrichGroup:by-group` | — | a group's cost object | `settings` | object spread into the period report's `byBatch` row; `?? {}` | cost object values; `null-unobservable`: the engine appends `unmeasured` to the row after the hook's fields |
| `enrichGroup:delivered-note` | — | `{ outcomes }` (the receipt's delivered outcomes, `receiptDelivery`: `settings.receipts.deliveredOutcomes` for a revisionless receipt or without `report-windows`; a stamped receipt's archive, Codex B2-05) | `settings` | the text inside the parenthesis of `averages.totalPerDelivered.note`; `?? outcomes.join('/')` | — |
| `enrichGroup:render-md` | `what-lines`, `what`, `case-lead`, `case-tail`, `case-lead-cells`, `case-tail-cells`, `sections`, `by-group-head`, `by-group-cells` | the cost object; `*-cells`: the case row; `by-group-head`: the period report; `by-group-cells`: its `byBatch` row | `settings`; the batch page adds `cost` (the group) | `what`: string; the others `string[]`; `?? ''` / `[]` | cost object and period report values (see both) |
| `enrichGroup:render-html` | `case-pre`, `case-post`, `delivery-lead`, `delivery-tail`, `gate-drift`, `outcome-drift`, `sections`, `by-group-head`, `by-group-cells` | as `render-md` (`case-pre` / `case-post`: the case row) | batch page: `settings`, `cost`, `statCell`, `esc`, `fmtInt`; period page (`by-group-*`): `settings`, `esc` | `case-pre`, `case-post`, `gate-drift`, `outcome-drift`, `sections`: HTML string, `?? ''`; `delivery-*`, `by-group-*`: `string[]`, `?? []` | as `render-md` |
| `enrichGroup:render-tok-md` | — | the cost object | `settings` | `string[]`; `?? []` | cost object values |
| `onClose` | — | a closed group's cost object | `repo`, `settings`, `dir` | ignored; a throw is swallowed (the Promise error still reaches stderr) | `reports-location`: `dir` stays the group's **receipt** dir under `reports.location: "telemetry"` too (the engine's reports and `cost.json` move, the extension's records do not; which location applies follows the extension-basename rule, see "Settings"); cost object values |
| `onClose:report` | — | a rendered group's cost object | `repo`, `settings` | ignored (TA: drift warnings on stderr); a throw fails `close` | cost object values |
| `onClose:no-receipt` | — | the closing scope record | `repo`, `settings` | text inside the NO RECEIPT warning; `?? ''` | `scope-resolution`: the scope record shape |
| `stopGateCheck` | — | the session's declared scope record | `repo`, `settings`, `sid`, `askedOnce`, `scriptPath` | `null` or `{ decision, reason }`; `?? null` | `scope-resolution`: the record is the environment host's own (`scopes/<host>/<sid>.json`, else the only record), may carry `role` / `claimedFrom`; an ambiguous id resolves to no record, so the hook is not called |
| `exportRow:segment` | — | the cost object | `profile` | the segment's domain identity (`stop`, `owner_group`, `work_item_level`, `factory_type`) at `stop`'s position; `??` those keys where the profile sets them | cost object values |
| `exportRow:item` | — | the cost object | `profile`, `settings` | `work_item_level`, `work_item_brief`, spread; `??` the profile's `work_item_level` if set | cost object values |
| `exportRow:scenarios` | — | the cost object | `profile`, `settings` | dataset fields, spread at their position; `?? {}` | cost object values |
| `exportRow:size` | — | the cost object | `profile`, `settings` | dataset fields, spread at their position; `?? {}` | cost object values |
| `exportRow:effort` | — | the cost object | `profile`, `settings` | `effort_days` (number) or `null` (the engine derives `size_tshirt`); `?? null` | cost object values |
| `exportRow:notes` | — | the cost object | `profile`, `settings`, `engineNotes` (`{ attribution: string[], findings: string[], cacheShare: string }`; `findings` is the `UNVERIFIED RECEIPT: …` disclosure of `cost.findings`, `[]` when there are none, added by the Plan 4 final review as an additive key within API 2's `ctx.engineNotes`; an extension that ignores it only drops the disclosure, TA splices it after `attribution`) | the row's notes (`string[]`, joined with spaces); `??` the engine notes only (attribution, findings, cache share) | `anon-complete`: notes are scrubbed by the engine afterwards, so the identifiers they name must reach the scrub set (TA returns its slugs in `anonymize`'s `scrub`) |
| `exportRow:checklist` | `segment`, `effort`, `profile`, `row` (as `ctx.slot`) | the export row | `segment`, `slot` | `{ missing, defaulted }` fragments for that slot (falsy: nothing) | — |
| `exportRow:anonymize` | — | an export row (the engine's `work_item_ref` replacement comes after) | `settings` | object spread over the row, minus a `scrub` key: `scrub: string[]` lists identifiers the extension knows, added to the engine's cross-row scrub set and never written; `?? {}` | `anon-complete`: ctx gains `settings`, `scrub` is honoured, and the engine scrubs every string, and every key below the row, afterwards (identifier-bearing keys in an extension's returned maps are renamed `anonymised[-n]`) (the hook scrubs its own domain fields; the engine owns the guarantee, so it holds with no extension). Off: ctx is `{}` beyond `phase`, `scrub` would be spread into the row, and `work_item_ref` is replaced before the hook's fields |
| `exportRow:submission` | `title-suffix`, `intro`, `identity-row`, `factory-rows`, `summary-rows` | the export document (`runs.json`) | `settings` | `string[]` of submission.md lines; `title-suffix` / `identity-row` fall back to the profile's own present `stop` / `owner_group` only on `undefined`/`null` (an empty array suppresses that identity default); the others `?? []` | `report-revision`: the document carries `manifestRevision` after `schema_version`; `report-robustness`: TA omits a missing stop / owner / work-item level and renders an overflowing cost sum as `n/a` |
| `exportRow:compare` | — | cost object `a` | `settings`, `other` (cost object `b`), `row` (the row formatter) | `string[]` of extra compare rows; `?? []` | cost object values |
| `exportRow:no-profile` | — | `null` | `settings` | hint text after the missing-profile warning; `?? ''` | — |

#### Values every call may receive (by migration)

**Cost objects** (the group cost, `cost.json`; input of the render, `match`, `by-group`, `onClose*`, `exportRow` and
`compare` calls). With migrations on:

- `null-unobservable` (item 4, O1): the buckets (`totals`, `cases[].direct`, `cases[].loaded`,
  `overhead.lead/stages/byStage`, `byRole`, `rework`) carry `unmeasured: {tokens, activeMin, wallMin, turns, toolCalls,
  toolErrors}` counts, and `tokens` / `tok` / `activeMin` / `turns` / `toolCalls` / `toolErrors` may be `null` (no
  measured contribution). A render part prints `—` for a `null` and ` (n unmeasured)` beside a sum with a non-zero
  count (one format everywhere), never `null`, `NaN`, `undefined` or `$null`; TA does (`minsText` for `byStage` and
  `rework` minutes). `loaded.tokens` / `loaded.activeMin` are `null` when neither the case's direct bucket nor the
  lead/stage overhead received a measured value, and `loaded.unmeasured` carries the parts' summed counts. The
  provisional live line (`live: true`, `loadLiveLines`) is a parent that is not measured yet: its `tokens`, `turns`,
  `toolCalls` and `toolErrors` are `null` (counted in `unmeasured`), never an invented zero quad, so a batch whose
  every live unit is unmeasured reads `totals.tokens: null`, `tokensAttribution: "none"` (not `"partial"`) and renders
  `— (n unmeasured)`; an observed zero on a dispatch stays 0 (Codex B2-07). Off: no
  `unmeasured` key, numeric sums, the live parent keeps its zero quad and zero counters.
- `copilot-inclusive` (item 3): `sources.inclusiveSessions` and `sources.inclusiveNote`; an inclusive line's session
  tokens sit on the lead thread and `totals` only.
- `shared-allocation` (item 2): `sources.sharedDispatches` and `sources.sharedDispatchesNote`; fractional dispatch
  counts.
- `active-minutes` (item 7): `sources.activeMinGrain: "session"` and `activeMinNote`; `cases[].direct.activeMin`,
  `overhead.stages`, TA `byStage.*` / `rework`, a dispatch role's `byRole.*.activeMin` and `stats.directActiveMin` are
  `null` (not allocated at this grain, and not counted in `unmeasured`).
- `report-conflicts` (item 22): `sources.conflicts` and `conflictsNote`, and `preview: {sessions, costUsd, note}`. The
  preview comes from a second build run **without** the extension, so no hook sees it.
- `role-dollars` (item 23, O3): each `byRole.<role>` carries `priced` / `unpriced` parent-session counts beside the
  bucket fields. `costUsd` is the parent role's inclusive dollars over its priced sessions. It is `null` with
  `unpriced > 0` for an unpriced parent, and `null` with `0 / 0` for a dispatch-only role (not allocated at this grain;
  rendered `—`, an unpriced parent `— (n unpriced)`). `byDispatchRole` is new (below).
- `report-revision` (item 24): `manifestRevision` right after `v`: an integer, or `null` when `module.json` is present
  but unusable. A renderer prints `null` as "manifest revision unknown", never as 1. An absent key (migration off, or
  an older `cost.json`) renders no footer.

**Two shapes share the name `byDispatchRole`** (`role-dollars`, `active-minutes`). The period report's `--json`
(`buildReport`) is `{<role>: {units, activeMin[, unmeasured]}}`: dispatch minutes, overlapping, outside every total.
`cost.json` (and the `--batch --json` / `--batches --json` / batch-cost `--stdout` streams that print it) is
`{<role>: {units, costUsd, priced}}`: measured dispatch dollars × weight, outside `byRole` and `totals`; an unpriced
dispatch counts in `units` only, and a role with none priced reads `costUsd: null`. Only `units` is shared, so a
reader decides by field (O10), not by the key alone.

**The period report** (input of `enrichGroup:render-*` `by-group-head`; its `byBatch` rows feed `by-group-cells`)
gains, with `report-windows`, the window and `semantics` fields and the `perDelivered` ratio object
(`{costUsd, activeMin, priced, eligible[, partial]}`, `null` when nothing is delivered), and `unverified` / `undated`.
With `report-conflicts` it gains `conflicts` / `preview`. With `report-revision` it gains `manifestRevision` after
`generated` (and `manifestRevisions` when roots disagree). With `null-unobservable`, a `byBatch` row's `activeMin`
may be `null` beside `unmeasured`.

**Settings** (`ctx.settings`, passed to almost every call; deep-frozen, and a settings file's is validated). With migrations on:

- `report-windows` (item 8, D1/O8): settings merge over `TA_DEFAULTS` and are validated by `validateB2Settings`, which
  ignores `ratioIntents`. The ratio intents come from the line's manifest revision (`module.json`, else the implied TA
  manifest), never from settings. Since B2 closed (map §4 step 19) `TA_DEFAULTS` has no `ratioIntents`, so with no
  settings file `ctx.settings.ratioIntents` is `undefined`, and a settings file's own `ratioIntents` is merged but
  ignored. Off (any set without `report-windows`): settings merge over the frozen `B1_DEFAULTS`, `ratioIntents` is
  required and honoured (`b1RatioIntents(settings)` falls back to the frozen default for a B2-contract object). With no settings file `ctx.settings` is the base object itself (`TA_DEFAULTS` or
  `B1_DEFAULTS`).
- `reports-location` (item 10, Q13): `settings.reports.location` may be `"telemetry"` (off: only `"tree"`, any other
  value is rejected at load). A present settings file that omits the key gets `"telemetry"` unless its `extension` path's
  basename is `test-automation` or `test-automation.mjs` (segment boundary: `my-test-automation.mjs` is not), which
  gets `"tree"`; no settings file is `"tree"` (`effectiveReportsLocation`, `engine/config.mjs`). An explicit value
  always wins, so a non-TA extension that keeps its reports in the receipt tree states `"reports": {"location":
  "tree"}`.

**Buckets: never clone one before `bucketOut`** (`null-unobservable`, `active-minutes`). Which keys of a bucket
received a measured value is tracked in a `WeakMap` keyed on the bucket **object** (`countMeasured` / `sumOrNull` /
`measuredIn`, `scripts/team-report.mjs`). The session-grain buckets whose minutes are kept are a `Set` of bucket
objects too. An extension accounts into the bucket it was given or made (`ctx.addTo(bucket, m, share)`,
`ctx.emptyBucket()`) and passes that same object to `ctx.bucketOut`. A spread, `structuredClone` or JSON round-trip
copy loses the measured set, and `bucketOut` then reports a sum that had measured contributions as `null` whenever its
unmeasured count is non-zero.

**Scope records** (`scope-resolution`, spec 14.11): host-qualified at `scopes/<host>/<session>.json` (a legacy flat
record is still read when it is the session's only one). A record may carry `role` (`open --role`) and `claimedFrom`
(the pending handle it was claimed from). Off: flat records, no `role` or `claimedFrom`.

**Ledger lines** (no hook receives one and TA reads none; an extension that reads the ledger itself sees these). With `writer` every measurement line carries `writer: "tokenomics-engine@<version>"` and
`manifestRevision` right after `v`, and a restamp adds `restampedBy`. With `copilot-inclusive`, a Copilot line
carries `tokensBasis: "inclusive"` and `null` dispatch tokens. With `null-unobservable`, any counter may be `null`.
Read each line by its own fields (O10), whatever the switch set.

**API 1 → API 2.** Regardless of migrations: `extensionApi` 2 (an API 1 module is rejected), hooks are synchronous
(the Promise error above), and the trace format is `name:phase#part`. Only with a migration on: the values in the last
column and the sections above, and `exportRow:anonymize`'s ctx `settings` and return key `scrub` (`anon-complete`).
The call list is API 1's, unchanged in name, phase, part, call position and engine default.

### classifyDispatch
(37 sites)
- `scripts/batch-cost.mjs:stage-words:29f40a68fc` (scripts/batch-cost.mjs:216)
- `scripts/batch-cost.mjs:stage-words:e0d452b28e` (scripts/batch-cost.mjs:217)
- `scripts/batch-cost.mjs:stage-words:eb88c08125` (scripts/batch-cost.mjs:227)
- `scripts/batch-cost.mjs:stage-words:f3fe376e83` (scripts/batch-cost.mjs:228)
- `scripts/batch-cost.mjs:stage-words:fce47d27e6` (scripts/batch-cost.mjs:237)
- `scripts/batch-cost.mjs:stage-words:b253cbf5a4` (scripts/batch-cost.mjs:238)
- `scripts/batch-cost.mjs:stage-words:3aa6fe88d2` (scripts/batch-cost.mjs:304)
- `scripts/batch-cost.mjs:stage-words:48175a2f50` (scripts/batch-cost.mjs:305)
- `scripts/batch-cost.mjs:stage-words:6d4e1b5dc5` (scripts/batch-cost.mjs:306)
- `scripts/batch-cost.mjs:stage-words:cd8d9109f0` (scripts/batch-cost.mjs:307)
- `scripts/batch-cost.mjs:stage-words:9389280faf` (scripts/batch-cost.mjs:309)
- `scripts/batch-cost.mjs:stage-words:11c3924fb2` (scripts/batch-cost.mjs:470)
- `scripts/batch-cost.mjs:stage-words:02d86df640` (scripts/batch-cost.mjs:472)
- `scripts/batch-cost.mjs:stage-words:2801bed933` (scripts/batch-cost.mjs:473)
- `scripts/batch-cost.mjs:stage-words:b39486e8dc` (scripts/batch-cost.mjs:560)
- `scripts/batch-cost.mjs:stage-words:6ff87169bf` (scripts/batch-cost.mjs:563)
- `scripts/batch-cost.mjs:stage-words:9c3867076d` (scripts/batch-cost.mjs:564)
- `scripts/batch-cost.mjs:stage-words:308b2aae76` (scripts/batch-cost.mjs:569)
- `scripts/batch-cost.mjs:stage-words:e5851740af` (scripts/batch-cost.mjs:573)
- `scripts/batch-cost.mjs:stage-words:de61d36624` (scripts/batch-cost.mjs:579)
- `scripts/batch-cost.mjs:stage-words:2f89c95275` (scripts/batch-cost.mjs:587)
- `scripts/batch-cost.mjs:stage-words:035343342e` (scripts/batch-cost.mjs:667)
- `scripts/batch-cost.mjs:stage-words:2d9b420a4a` (scripts/batch-cost.mjs:672)
- `scripts/batch-cost.mjs:stage-words:4b45c3a5bc` (scripts/batch-cost.mjs:674)
- `scripts/batch-cost.mjs:stage-words:9d372f46cb` (scripts/batch-cost.mjs:675)
- `scripts/team-report.mjs:stage-words:39cf6a3050` (scripts/team-report.mjs:388)
- `scripts/team-report.mjs:stage-words:c682331eee` (scripts/team-report.mjs:399)
- `scripts/team-report.mjs:stage-words:d3e092aa85` (scripts/team-report.mjs:400)
- `scripts/team-report.mjs:stage-words:a9ffaa99ce` (scripts/team-report.mjs:402)
- `scripts/team-report.mjs:stage-words:74cca45492` (scripts/team-report.mjs:415)
- `scripts/team-report.mjs:stage-words:82cd434cc9` (scripts/team-report.mjs:416)
- `scripts/team-report.mjs:stage-words:05fe288f6d` (scripts/team-report.mjs:419)
- `scripts/team-report.mjs:stage-words:b9276b1c6e` (scripts/team-report.mjs:533)
- `scripts/team-report.mjs:stage-words:bad58c6959` (scripts/team-report.mjs:542)
- `scripts/team-report.mjs:stage-words:7c9c0d8016` (scripts/team-report.mjs:549)
- `scripts/team-report.mjs:stage-words:55551fdc26` (scripts/team-report.mjs:550)
- `scripts/team-report.mjs:stage-words:dd6621a4d8` (scripts/team-report.mjs:642)

batch-cost keeps `classify(label, ids, declared, ext, ctx)` (the engine join: the hook's stage verdict
first, then receipt-id match, then the transcript-ids fallback); TA's OVERHEAD_STAGE / FIX_STAGE /
STAGE_HEAD / STAGE_KIND, the byStage split, the rework bucket and `fixRounds` live in the extension
(per-group state on `ctx.acc`). Accumulation order per bucket is unchanged (each bucket sums the same
terms in the same order). The overhead note / Markdown "Overhead (lead …, shown once)" label render the
`stage-names` list; the per-case Markdown table is built from column lists (extension columns spliced at
the reference position), so the header/separator/cells are byte-identical. Under extension `null`: no
`fixRounds`, `byStage` or `rework` keys, every dispatch is `direct` (unmatched ones fall to overhead).

Copied unit tests updated (TA behaviour now needs the TA extension):
`scripts/batch-cost.test.mjs` wraps `buildBatchCost` / `classify` / `updateBatchCosts` to pass the TA
extension (`ext: ta`); `team-report.test.mjs` (3 `main` tests) and the batch-cost `team-report --batch`
test `await` the now-async `main`.

### labelFrom
(2 sites)
- `hooks/telemetry-capture.mjs:stage-words:cb323ba27c` (hooks/telemetry-capture.mjs:613)
- `hooks/telemetry-capture.mjs:stage-words:f57226f85b` (hooks/telemetry-capture.mjs:618)

`deriveLabel(description, firstText, ext, ctx)` stays the capture call site: `labelFrom` returns the whole
TA label (description, else the STAGE_MARKER window, else the first 160 chars); the engine default is the
reference's non-TA path. `ext` now rides every capture function's options (`captureDispatches`,
`captureCopilotDispatches`, `captureClaudeSession`, `captureSessionNow`, `captureCopilotSession`, `sweep`)
and work-scope's `sessionStatus` (trailing) / `generateBatchReports` capture call. (telemetry-capture
`main`'s stdin payload locals, `hook` in the reference, are named `payload` so they no longer shadow `hook()`.)

### receiptIds
(8 sites)
- `hooks/telemetry-capture.mjs:receipt-reader:cfeeff5407` (hooks/telemetry-capture.mjs:350)
- `hooks/telemetry-capture.mjs:path-automation:c474fc46cf` (hooks/telemetry-capture.mjs:353)
- `hooks/telemetry-capture.mjs:path-automation:98c3c8a1f6` (hooks/telemetry-capture.mjs:354)
- `hooks/telemetry-capture.mjs:receipt-reader:98c3c8a1f6` (hooks/telemetry-capture.mjs:354)
- `hooks/telemetry-capture.mjs:receipt-reader:d790f29e02` (hooks/telemetry-capture.mjs:365)
- `hooks/telemetry-capture.mjs:receipt-reader:52ba8ee762` (hooks/telemetry-capture.mjs:366)
- `hooks/telemetry-capture.mjs:receipt-reader:68ce8b4081` (hooks/telemetry-capture.mjs:441)
- `hooks/telemetry-capture.mjs:receipt-reader:ba0eb87e97` (hooks/telemetry-capture.mjs:788)

`receiptCaseIds` moved whole (incl. the unscanned third receipt shape `res.units[].ids`); its two return
roots are `telemetryDir(repo, settings)/returns` and `receiptsRoot(repo, settings)/_returns` (TA:
the reference paths). Both capture sites (`captureDispatches`, `captureClaudeSession` subagents) read
`hook(ext, 'receiptIds', { id }, { repo, settings }) ?? <scope-gated mined ids>`.
Copied unit test updated: `hooks/telemetry-capture.test.mjs` "receiptCaseIds: …" calls the TA hook.

### enrichGroup
(91 sites)
- `hooks/telemetry-capture.mjs:receipt-reader:76fe45b5c4` (hooks/telemetry-capture.mjs:1443)
- `scripts/batch-cost.mjs:gate-records:70d9dc6d58` (scripts/batch-cost.mjs:138)
- `scripts/batch-cost.mjs:gate-records:4b2ae4bd17` (scripts/batch-cost.mjs:139)
- `scripts/batch-cost.mjs:path-automation:37222d25b0` (scripts/batch-cost.mjs:140)
- `scripts/batch-cost.mjs:gate-records:37222d25b0` (scripts/batch-cost.mjs:140)
- `scripts/batch-cost.mjs:gate-records:f120d47a1d` (scripts/batch-cost.mjs:176)
- `scripts/batch-cost.mjs:gate-records:08fbe52e5d` (scripts/batch-cost.mjs:198)
- `scripts/batch-cost.mjs:gate-records:938b2adb80` (scripts/batch-cost.mjs:199)
- `scripts/batch-cost.mjs:gate-records:4f5842a583` (scripts/batch-cost.mjs:200)
- `scripts/batch-cost.mjs:gate-records:52b52ff09f` (scripts/batch-cost.mjs:201)
- `scripts/batch-cost.mjs:gate-records:357998db7a` (scripts/batch-cost.mjs:204)
- `scripts/batch-cost.mjs:gate-records:201859dc6d` (scripts/batch-cost.mjs:207)
- `scripts/batch-cost.mjs:gate-records:4edd6b0372` (scripts/batch-cost.mjs:209)
- `scripts/batch-cost.mjs:sizing:db1c75bb38` (scripts/batch-cost.mjs:327)
- `scripts/batch-cost.mjs:sizing:682acca5ea` (scripts/batch-cost.mjs:329)
- `scripts/batch-cost.mjs:receipt-reader:df9bad4ff1` (scripts/batch-cost.mjs:337)
- `scripts/batch-cost.mjs:receipt-reader:5e381aad69` (scripts/batch-cost.mjs:362)
- `scripts/batch-cost.mjs:sizing:a3ff5dc6bd` (scripts/batch-cost.mjs:367)
- `scripts/batch-cost.mjs:path-automation:60580b5331` (scripts/batch-cost.mjs:377)
- `scripts/batch-cost.mjs:sizing:53df385b04` (scripts/batch-cost.mjs:382)
- `scripts/batch-cost.mjs:sizing:e219893c78` (scripts/batch-cost.mjs:385)
- `scripts/batch-cost.mjs:sizing:8f0745609b` (scripts/batch-cost.mjs:386)
- `scripts/batch-cost.mjs:sizing:4f449ac8e7` (scripts/batch-cost.mjs:387)
- `scripts/batch-cost.mjs:sizing:81acfd87f1` (scripts/batch-cost.mjs:391)
- `scripts/batch-cost.mjs:sizing:3d362443dd` (scripts/batch-cost.mjs:399)
- `scripts/batch-cost.mjs:qa-wording:eeac8bc733` (scripts/batch-cost.mjs:414)
- `scripts/batch-cost.mjs:sizing:13b8005a89` (scripts/batch-cost.mjs:419)
- `scripts/batch-cost.mjs:sizing:69fbb5d14e` (scripts/batch-cost.mjs:421)
- `scripts/batch-cost.mjs:sizing:7c2a92f72a` (scripts/batch-cost.mjs:422)
- `scripts/batch-cost.mjs:sizing:b0b82774d1` (scripts/batch-cost.mjs:426)
- `scripts/batch-cost.mjs:sizing:586ad799ab` (scripts/batch-cost.mjs:427)
- `scripts/batch-cost.mjs:path-automation:6b4c5d39a0` (scripts/batch-cost.mjs:429)
- `scripts/batch-cost.mjs:qa-wording:6b4c5d39a0` (scripts/batch-cost.mjs:429)
- `scripts/batch-cost.mjs:group-wording:6b4c5d39a0` (scripts/batch-cost.mjs:429)
- `scripts/batch-cost.mjs:sizing:bde77a853c` (scripts/batch-cost.mjs:430)
- `scripts/batch-cost.mjs:receipt-reader:7feeaff470` (scripts/batch-cost.mjs:582)
- `scripts/batch-cost.mjs:gate-records:c3962d3a2b` (scripts/batch-cost.mjs:603)
- `scripts/batch-cost.mjs:gate-records:be4b26c1f1` (scripts/batch-cost.mjs:604)
- `scripts/batch-cost.mjs:gate-records:1750ef73ae` (scripts/batch-cost.mjs:605)
- `scripts/batch-cost.mjs:gate-records:54c93c9270` (scripts/batch-cost.mjs:606)
- `scripts/batch-cost.mjs:sizing:95e7ff8486` (scripts/batch-cost.mjs:634)
- `scripts/batch-cost.mjs:sizing:b13838a056` (scripts/batch-cost.mjs:635)
- `scripts/batch-cost.mjs:gate-records:b0c84f7ce4` (scripts/batch-cost.mjs:678)
- `scripts/batch-cost.mjs:gate-records:982997ec09` (scripts/batch-cost.mjs:679)
- `scripts/batch-cost.mjs:receipt-reader:6ac7c0b4f3` (scripts/batch-cost.mjs:681)
- `scripts/batch-cost.mjs:gate-records:6ac7c0b4f3` (scripts/batch-cost.mjs:681)
- `scripts/batch-cost.mjs:gate-records:c887e40ad9` (scripts/batch-cost.mjs:682)
- `scripts/batch-cost.mjs:gate-records:f5623db62f` (scripts/batch-cost.mjs:684)
- `scripts/batch-cost.mjs:gate-records:ce51b4a18e` (scripts/batch-cost.mjs:685)
- `scripts/batch-cost.mjs:sizing:94dba86493` (scripts/batch-cost.mjs:690)
- `scripts/team-report.mjs:gate-records:6fcb24609d` (scripts/team-report.mjs:384)
- `scripts/team-report.mjs:gate-records:f810d69aa4` (scripts/team-report.mjs:385)
- `scripts/team-report.mjs:receipt-reader:a2646e3a23` (scripts/team-report.mjs:386)
- `scripts/team-report.mjs:gate-records:a2646e3a23` (scripts/team-report.mjs:386)
- `scripts/team-report.mjs:receipt-reader:00dfd7d6da` (scripts/team-report.mjs:387)
- `scripts/team-report.mjs:gate-records:00dfd7d6da` (scripts/team-report.mjs:387)
- `scripts/team-report.mjs:receipt-reader:39cf6a3050` (scripts/team-report.mjs:388)
- `scripts/team-report.mjs:qa-wording:39cf6a3050` (scripts/team-report.mjs:388)
- `scripts/team-report.mjs:sizing:40e4da47bf` (scripts/team-report.mjs:412)
- `scripts/team-report.mjs:sizing:e1a528264e` (scripts/team-report.mjs:413)
- `scripts/team-report.mjs:receipt-reader:05fe288f6d` (scripts/team-report.mjs:419)
- `scripts/team-report.mjs:sizing:1cb7329b36` (scripts/team-report.mjs:422)
- `scripts/team-report.mjs:path-automation:b7bb5e2c87` (scripts/team-report.mjs:423)
- `scripts/team-report.mjs:qa-wording:1f1fe47251` (scripts/team-report.mjs:424)
- `scripts/team-report.mjs:sizing:efc4d99e14` (scripts/team-report.mjs:425)
- `scripts/team-report.mjs:qa-wording:efc4d99e14` (scripts/team-report.mjs:425)
- `scripts/team-report.mjs:sizing:77bc3c0f41` (scripts/team-report.mjs:426)
- `scripts/team-report.mjs:qa-wording:77bc3c0f41` (scripts/team-report.mjs:426)
- `scripts/team-report.mjs:group-wording:77bc3c0f41` (scripts/team-report.mjs:426)
- `scripts/team-report.mjs:sizing:5bd3dbb6b8` (scripts/team-report.mjs:427)
- `scripts/team-report.mjs:receipt-reader:b9276b1c6e` (scripts/team-report.mjs:533)
- `scripts/team-report.mjs:sizing:b9276b1c6e` (scripts/team-report.mjs:533)
- `scripts/team-report.mjs:gate-records:741dafbb17` (scripts/team-report.mjs:541)
- `scripts/team-report.mjs:receipt-reader:2affc85094` (scripts/team-report.mjs:543)
- `scripts/team-report.mjs:receipt-reader:317dbddb26` (scripts/team-report.mjs:571)
- `scripts/team-report.mjs:gate-records:317dbddb26` (scripts/team-report.mjs:571)
- `scripts/team-report.mjs:receipt-reader:354c2a624d` (scripts/team-report.mjs:572)
- `scripts/team-report.mjs:gate-records:354c2a624d` (scripts/team-report.mjs:572)
- `scripts/team-report.mjs:sizing:5e8204b81a` (scripts/team-report.mjs:586)
- `scripts/team-report.mjs:path-automation:77eb051421` (scripts/team-report.mjs:587)
- `scripts/team-report.mjs:sizing:77eb051421` (scripts/team-report.mjs:587)
- `scripts/team-report.mjs:qa-wording:77eb051421` (scripts/team-report.mjs:587)
- `scripts/team-report.mjs:group-wording:77eb051421` (scripts/team-report.mjs:587)
- `scripts/team-report.mjs:qa-wording:9afc304323` (scripts/team-report.mjs:588)
- `scripts/team-report.mjs:sizing:8865c27efa` (scripts/team-report.mjs:589)
- `scripts/team-report.mjs:qa-wording:8865c27efa` (scripts/team-report.mjs:589)
- `scripts/team-report.mjs:sizing:4df322b76f` (scripts/team-report.mjs:590)
- `scripts/team-report.mjs:sizing:e0d2934262` (scripts/team-report.mjs:648)
- `scripts/team-report.mjs:gate-records:d12f5afb27` (scripts/team-report.mjs:837)
- `scripts/team-report.mjs:gate-records:b5cfc0373b` (scripts/team-report.mjs:838)
- `scripts/work-scope.mjs:receipt-reader:39b61e588f` (scripts/work-scope.mjs:216)

Moved whole (now private to the extension): `loadGateRuns`, `declaredOutcomesFor`, `crossCheck`,
`loadSizings`, `sizeBaselines`, `MIN_CLASS_N`, `applySizing` (+ `percentileOf` / `pctVal`).
`loadGateRuns` reads `telemetryDir(repo, settings)/gate-runs/<slug>.jsonl` and `sizeBaselines` walks
`receiptsRoot(repo, settings)` (the `automation` dir / `.agents/automation` root from settings, per the
assignment notes); `.agents/estimation` stays a TA-layout literal inside `loadSizings`.
`buildBatchCost` spreads the `case` fragment between `outcome` and `direct`, the `records` fragment
(`gate`, `records`) after `delivered` and the `sizing` fragment after `workItemRef` — the reference key
order. Renders: every gate / drift / findings / sizing fragment is a `render-*` part at its reference
position; the per-case Markdown table splices the `case-lead` (size) and `case-tail` (findings) columns.
The duplicated three-way campaign/wave resolve (work-scope close, telemetry-capture live page) is the one
`match` phase (Task 2 ruling); the engine default is the exact `c.batch === scope.batch`.
team-report's period-rollup "By group" table (Markdown and team HTML) builds its columns from a list: the
`gate` / `drift` header and cells are the `by-group-head` / `by-group-cells` render parts (fix round 1), so
under extension `null` the table has no such columns; `renderMarkdown` / `renderTeamHtml` take a trailing `ext`.
Under extension `null`: no `findings`, `gate`, `records` or `sizing` keys and no such report lines.

Copied unit tests updated: `scripts/batch-cost.test.mjs` — `crossCheck`, `declaredOutcomesFor`,
`loadGateRuns` (incl. the absence check) assertions go through the `records` phase (gate runs from a
`gate-runs.jsonl`, declarations from scopes; "no drift" is now the absent key), `applySizing` /
`loadSizings` through the `sizing` phase (scores in `.agents/estimation`, history as an earlier batch's
`cost.json`; same assertions, plus one bare-array row); `scripts/work-scope.test.mjs` close test passes
the TA extension to `generateBatchReports` for the wave-name resolve.

### onClose
(13 sites)
- `scripts/batch-cost.mjs:gate-records:ab0de88bfa` (scripts/batch-cost.mjs:161)
- `scripts/batch-cost.mjs:path-automation:fefdd9ac03` (scripts/batch-cost.mjs:162)
- `scripts/batch-cost.mjs:gate-records:fefdd9ac03` (scripts/batch-cost.mjs:162)
- `scripts/batch-cost.mjs:gate-records:b5a3b8f516` (scripts/batch-cost.mjs:164)
- `scripts/work-scope.mjs:gate-records:c3f81ad666` (scripts/work-scope.mjs:209)
- `scripts/work-scope.mjs:gate-records:25b13ec8bd` (scripts/work-scope.mjs:224)
- `scripts/work-scope.mjs:gate-records:0764d4bc0c` (scripts/work-scope.mjs:296)
- `scripts/work-scope.mjs:path-automation:06b7cee398` (scripts/work-scope.mjs:297)
- `scripts/work-scope.mjs:receipt-reader:06b7cee398` (scripts/work-scope.mjs:297)
- `scripts/work-scope.mjs:receipt-reader:2f525b636d` (scripts/work-scope.mjs:304)
- `scripts/work-scope.mjs:gate-records:2f525b636d` (scripts/work-scope.mjs:304)
- `scripts/work-scope.mjs:receipt-reader:96973ca15d` (scripts/work-scope.mjs:305)
- `scripts/work-scope.mjs:gate-records:96973ca15d` (scripts/work-scope.mjs:305)

`foldGateRuns` moved whole (private; reads `telemetryDir(repo, settings)/gate-runs/<slug>.jsonl`). work-scope
`generateBatchReports` calls `onClose` per group before rendering (still inside its own try — best-effort);
`main` close prints the extension's `no-receipt` advice inside the NO RECEIPT warning (the advice names
`.agents/telemetry/${settings.dir}/returns/`) and calls `report` after each "report →" line. Under extension
`null`: no fold, no drift lines, and the NO RECEIPT warning keeps only its first and last lines.
Copied unit test updated: `scripts/batch-cost.test.mjs` "loadGateRuns … foldGateRuns …" folds through the
TA `onClose` hook (same assertions).

### stopGateCheck
(6 sites)
- `hooks/scope-hook.mjs:receipt-reader:fd7e9582aa` (hooks/scope-hook.mjs:86)
- `hooks/scope-hook.mjs:receipt-reader:16cc67b7c4` (hooks/scope-hook.mjs:93)
- `hooks/scope-hook.mjs:receipt-reader:d4ae291f47` (hooks/scope-hook.mjs:138)
- `hooks/scope-hook.mjs:group-wording:ef32bbe488` (hooks/scope-hook.mjs:141)
- `hooks/scope-hook.mjs:path-automation:e0683e5b6a` (hooks/scope-hook.mjs:143)
- `hooks/scope-hook.mjs:receipt-reader:5693c482aa` (hooks/scope-hook.mjs:144)

`gateDecision(repo, payload, scriptUrl, settings, ext)` keeps the first gate (dispatched, no scope) and
returns `hook(ext, 'stopGateCheck', scope, ctx) ?? null` for a declared scope; the engine passes its
one-time-marker helper (`askedOnce`) and the resolved work-scope script path. `receiptPathFor` moved
whole (private; its flat lookup keeps `receiptsRoot` + `receipts.file`, the campaign-wave nested
`report.json` literal stays TA layout). The reason text names `${settings.receipts.root}/<batch>/` (was
the literal `.agents/automation/`). Copied unit test updated: `hooks/scope-hook.test.mjs` "asks ONCE to
close …" passes the TA extension to `gateDecision`.

### exportRow
(37 sites)
- `scripts/build-tokenomics-export.mjs:export-qa:23b359fd83` (scripts/build-tokenomics-export.mjs:66)
- `scripts/build-tokenomics-export.mjs:sizing:fd3d5c7112` (scripts/build-tokenomics-export.mjs:83)
- `scripts/build-tokenomics-export.mjs:sizing:39472a6c22` (scripts/build-tokenomics-export.mjs:86)
- `scripts/build-tokenomics-export.mjs:sizing:09e39802ab` (scripts/build-tokenomics-export.mjs:89)
- `scripts/build-tokenomics-export.mjs:sizing:6e800eebc5` (scripts/build-tokenomics-export.mjs:92)
- `scripts/build-tokenomics-export.mjs:delivered-vocab:b04b67dc24` (scripts/build-tokenomics-export.mjs:94)
- `scripts/build-tokenomics-export.mjs:path-automation:60d1bdacf2` (scripts/build-tokenomics-export.mjs:106)
- `scripts/build-tokenomics-export.mjs:qa-wording:60d1bdacf2` (scripts/build-tokenomics-export.mjs:106)
- `scripts/build-tokenomics-export.mjs:group-wording:60d1bdacf2` (scripts/build-tokenomics-export.mjs:106)
- `scripts/build-tokenomics-export.mjs:export-qa:148133a220` (scripts/build-tokenomics-export.mjs:124)
- `scripts/build-tokenomics-export.mjs:export-qa:34279a003c` (scripts/build-tokenomics-export.mjs:125)
- `scripts/build-tokenomics-export.mjs:export-qa:73f8e0699e` (scripts/build-tokenomics-export.mjs:126)
- `scripts/build-tokenomics-export.mjs:sizing:51213a21db` (scripts/build-tokenomics-export.mjs:130)
- `scripts/build-tokenomics-export.mjs:gate-records:b3d5d24107` (scripts/build-tokenomics-export.mjs:133)
- `scripts/build-tokenomics-export.mjs:path-automation:671d359c48` (scripts/build-tokenomics-export.mjs:135)
- `scripts/build-tokenomics-export.mjs:group-wording:671d359c48` (scripts/build-tokenomics-export.mjs:135)
- `scripts/build-tokenomics-export.mjs:sizing:28ea28eea1` (scripts/build-tokenomics-export.mjs:136)
- `scripts/build-tokenomics-export.mjs:group-wording:28ea28eea1` (scripts/build-tokenomics-export.mjs:136)
- `scripts/build-tokenomics-export.mjs:qa-wording:63f9181945` (scripts/build-tokenomics-export.mjs:138)
- `scripts/build-tokenomics-export.mjs:export-qa:63f9181945` (scripts/build-tokenomics-export.mjs:138)
- `scripts/build-tokenomics-export.mjs:export-qa:5277cdace1` (scripts/build-tokenomics-export.mjs:147)
- `scripts/build-tokenomics-export.mjs:sizing:41a9ff3050` (scripts/build-tokenomics-export.mjs:149)
- `scripts/build-tokenomics-export.mjs:export-qa:43f459397e` (scripts/build-tokenomics-export.mjs:151)
- `scripts/build-tokenomics-export.mjs:export-qa:b0fefbb6c1` (scripts/build-tokenomics-export.mjs:156)
- `scripts/build-tokenomics-export.mjs:sizing:d07a0a642a` (scripts/build-tokenomics-export.mjs:157)
- `scripts/build-tokenomics-export.mjs:export-qa:d72d9310f6` (scripts/build-tokenomics-export.mjs:158)
- `scripts/build-tokenomics-export.mjs:path-automation:e3a09104b9` (scripts/build-tokenomics-export.mjs:190)
- `scripts/build-tokenomics-export.mjs:qa-wording:e3a09104b9` (scripts/build-tokenomics-export.mjs:190)
- `scripts/build-tokenomics-export.mjs:group-wording:e3a09104b9` (scripts/build-tokenomics-export.mjs:190)
- `scripts/build-tokenomics-export.mjs:export-qa:e3a09104b9` (scripts/build-tokenomics-export.mjs:190)
- `scripts/build-tokenomics-export.mjs:group-wording:8080171aa0` (scripts/build-tokenomics-export.mjs:191)
- `scripts/build-tokenomics-export.mjs:group-wording:4111215503` (scripts/build-tokenomics-export.mjs:211)
- `scripts/build-tokenomics-export.mjs:export-qa:13ae798075` (scripts/build-tokenomics-export.mjs:216)
- `scripts/build-tokenomics-export.mjs:export-qa:8481830162` (scripts/build-tokenomics-export.mjs:224)
- `scripts/build-tokenomics-export.mjs:gate-records:5ec7aadddc` (scripts/build-tokenomics-export.mjs:253)
- `scripts/build-tokenomics-export.mjs:export-qa:564f4a5af3` (scripts/build-tokenomics-export.mjs:259)
- `scripts/build-tokenomics-export.mjs:export-qa:c43231b0f9` (scripts/build-tokenomics-export.mjs:281)

The engine exporter keeps the dataset container and the measured fields (`work_item_ref`, `maturity`,
sessions/turns/dispatches, orchestrator share, token quads, models, cost, cache share, `env_setup`,
`_tokens_attribution`, the token-attribution and cache-share notes) and the generic `effortDaysToSize`
spine; every QA field is an `exportRow` phase spliced at its reference position. Moved whole (private):
`SIZE_ORDER`, the row facts (SP/effort, dominant/max size, authored = cases − not-started/infra-stalled)
and the QA half of the §7 checklist. Fix round 1: the engine `checklist(segment, row, ext)` keeps the checks
over fields it measures (identity, `work_item_ref` / `work_item_brief`, `size_tshirt`, token quad, model,
cost, cache share, `tokens_by_model`, attribution floor) and merges the extension's QA checks at four slots,
preserving the reference §7 order; the segment's domain identity (`stop: 'testing'`, `owner_group: 'QA'`,
`work_item_level: 'feature'`, `factory_type: 'qa'`) is one `segment` spread at `stop`'s position (TA key order
kept), engine default = only the keys the profile sets; the row's `work_item_level` falls back to the profile's.
The notes' cohort path names `${settings.receipts.root}/<batch>/`.
`buildSegment` / `buildRunRow` / `checklist` / `appendRun` / `anonymizeDoc` / `writeSubmission` /
`renderCompare` take a trailing `ext` (`buildRunRow(cost, profile, ext, settings)`); work-scope close and
the export `main` pass theirs (`--compare` loads the extension of the settings it renders with).
Not moved: `scripts/build-tokenomics-export.mjs:export-qa:564f4a5af3` (:259) — `loadProfile`'s path is
`join(telemetryDir(repo, settings), settings.paths.factoryProfile)` since Task 9 (the shared line's config
part); no TA literal is left on it. `default_method: 'metered'`, `currency`, `scope` stay engine (dataset
container defaults, not QA identity).
`exportRow` is reached on the corpus (final fix wave correction — it was recorded as exempt from the
corpus hook trace): work-scope close → `appendRun` calls its `segment`, `item`, `scenarios`, `size`,
`effort`, `notes` and `checklist` phases; the export CLI's `anonymize`, `submission`, `compare` and
`no-profile` phases are reached by the export CLI cases (`cov-export-cli`, `cov-export-submission-edges`,
`cov-export-compare`, `fault-export-usage`; plan-2-patch Task 4), so `CORPUS_UNREACHED` is empty. `extensions/test-automation.test.mjs`
"exportRow: …" is the unit-level differential for the whole exporter: the engine exporter with the TA extension vs the reference
exporter on two synthetic costs × two profiles — segment, row, checklist, `--compare`, the accumulated
`runs.json`, its anonymised form and the submission folder (plain and `--anon`), byte for byte (the corpus
also replays `appendRun` through every work-scope close, whose `runs.json` is in the goldens).
Copied unit tests updated: `scripts/batch-cost.test.mjs` "export v2 …" and "token attribution …" run the
exporter functions with the TA extension (`taExport()` wrapper).

### Hook trace (corpus)

`hook()` appends `name:phase` (the bare name for a phase-less call; final fix wave — it was name-only; API 2 appends
`#<part>` when ctx carries `part`, or `slot` for `exportRow:checklist`) to
`$HT_EXT_TRACE_FILE` (only when the hook is actually called; the append
is wrapped in try/catch so an unwritable trace file can never break a hook call — fix round 1).
`runCase(caseDir, implDir, { extraEnv })` merges `extraEnv` after each event's `env`;
`diffImpl(implDir, { traceHooks: true })` passes `HT_EXT_TRACE_FILE=<temp file outside the sandbox>` to every
event and returns `{ results, hooks }` (called hook names in order; the plain results array otherwise).
diffImpl owns the trace: it reads it and removes its temp dir in a `finally` (fix round 1 — the brief's
`{ results, traceFile }` left the dir to every caller). One traced replay in `corpus/engine.test.mjs` serves
both the B1 gate (outputs equal the reference goldens) and the hook-coverage check (every hook the inventory
names is called — all seven are reached on the TA corpus, exportRow through work-scope close's `appendRun`),
so `npm test` replays the corpus once for the engine, not twice. Final fix wave: the table above is
machine-readable as `HOOK_CALLS` in `engine/extension.mjs` (a test parses the table and requires equality; API 2: the
same traced replay also requires each call's documented `parts` cell to equal the parts the trace records for it, so
the table is the one source of the part sets),
and the traced replay must call every `HOOK_CALLS` entry except `CORPUS_UNREACHED` (entries there must stay
unreached; it is empty since plan-2-patch Task 4 put the export CLI on the corpus, which reaches the last four
`exportRow` phases `anonymize`, `submission`, `compare`, `no-profile`); no undocumented `name:phase` may appear. The spy test and the export differential
remove their temp dirs too.

### Foreign configuration (`extension: null`) — spy case

`corpus/cases/foreign-null-extension` (`implOnly: "engine"`, goldens in `expected/engine/` generated by the
engine): `seed-claude-basic`'s capture under `{"extension": null}`, extended with a batch scope, a sub-agent
dispatch of the scope's session (`--dispatch`, final fix wave), the scope hook's `--gate` with the receipt
present and `work-scope close`, so the replay passes through every
non-capture hook call site (seed-claude-basic alone has no dispatch and reaches none — an empty trace
there would prove nothing). `engine/extension.test.mjs` replays it with the hook trace: empty; the ledger
line's `costSource` / `tokens` equal seed-claude-basic's golden line; the same events under TA defaults
(control) call all seven hooks (`labelFrom` / `receiptIds` through the dispatch); the export
row written at close carries no QA identity or domain field (asserted; goldens regenerated in fix round 1).
`corpus/engine.test.mjs` checks implOnly cases against `expected/engine/` (both directions, byte for byte);
`corpus/goldens.test.mjs`, `corpus/cases/targeted.test.mjs`, `corpus/a4.test.mjs` and `scripts/coverage.mjs`
skip them (one-line filter each), as `diffImpl` already did. `diff-impl.mjs` exports `goldenFiles`.

### Step 6 — final B1 check

`node scripts/diff-impl.mjs` → `cases 51, differing 0`; `npm test` green; `node scripts/coverage.mjs` exit 0
(it measures the reference, unchanged; implOnly cases skipped); `node scripts/inventory.mjs` exit 0
(`sites 371, unassigned 0, stale 0, invalid 0`).
`grep -nE "triage|gate-runs|estimation|scenarios_" tokenomics/hooks/*.mjs tokenomics/scripts/*.mjs | grep -v '\.test\.mjs'`
leaves no code line — only comments: batch-cost's attribution-model header (:21, :24) and loaded-share note
(:385), the model-tier notes (batch-cost :265, telemetry-capture :160, :741 — "haiku triage + sonnet
workers"), and batch-cost :134, the comment at the delegating `classify` site naming the TA stages. Every
TA code site those words marked lives in `extensions/test-automation.mjs`; the buildBatchCost doc comment
that still described reading gate-runs.jsonl was corrected.

### Fix round 1 — widened residual-TA grep

```
grep -nE "triage|gate-runs|estimation|scenarios_|'qa'|'QA'|'testing'|gate|drift|\.agents/automation|campaign|wave" \
  tokenomics/hooks/*.mjs tokenomics/scripts/*.mjs | grep -v '\.test\.mjs'
```
56 hits: 41 comment lines (reference prose: attribution model, campaign/wave receipt walks, model tiers,
install/gitignore rationale; plus the comments at the delegating sites) and 15 code lines, none of them TA code:
- extension-delegating call sites: `team-report.mjs:576` `${enr('gate-drift') ?? ''}`, `:577` `${enr('outcome-drift') ?? ''}`.
- the engine's own stop gate (spec: the first, no-scope gate is engine; the second is `stopGateCheck`):
  `scope-hook.mjs:108` `export function gateDecision(…, ext = null)`, `:192` `argv.includes('--gate')`, `:193`
  `gateDecision(…, ext)`; its installer wiring `install-hooks.mjs:103` (`… --gate`), `:159` (`cmd('scope-hook.mjs', '--gate')`)
  and doctor line `:571` ('announce/gate not wired …').
- false positives (`ungated`, `gateway`, `Aggregate`): `telemetry-capture.mjs:303`, `:924`, `:1048` (comments
  trailing code), `build-tokenomics-export.mjs:149`, `:210`, `team-report.mjs:405`, `:697`.
- one non-inventory wording residue: `install-hooks.mjs:582` doctor message "… will dirty the tree and block the
  gate" (the pipeline's gate; install-hooks has no extension call site and the scanner assigned this line nothing —
  left for B2's installer work).
No `'qa'` / `'QA'` / `'testing'` / `.agents/automation` / campaign / wave code line remains in the engine.

## Final review fix wave

### Engine-side inventory gate (finding 3)

The two `other-batch dispatch(es) excluded` literals (team-report :393 / :575, inside the shared-session
note of sites efac16b6d5 / e91739f2cc) render `other-${w.group}` now — byte-identical under TA.
`node scripts/inventory.mjs` also scans the engine copy (`tokenomics/{hooks,scripts}`, non-test) with the
same scanner and fails (exit 1, CI) on any site missing from `docs/inventory/engine-allowlist.json`, on a
stale entry, or on an entry without a `kind` (`not-lifted` | `env-var` | `extension-call` |
`false-positive` | `residue`) and a reason of at least 40 chars. Output line:
`engine sites 57, unlisted 0, stale 0, invalid 0`. A planted leak is tested
(`scripts/inventory-gate.test.mjs`, including the CLI exit code via `--engine-root <copy>`).

Plan 3 (P2-07) makes the engine scan recursive and duplicate-aware:

- **Scope.** `scanEngine(root)` walks all of `tokenomics/` recursively and scans every `*.mjs` that is not
  `*.test.mjs`, so a TA literal moved into `engine/` or a nested module is a site. It skips only the
  top-level directories in `ENGINE_SCAN_SKIP` (and any `node_modules`): `extensions/` (the TA extension's
  own home), `kit/` (the contract tier, spec §1.1, which reads the reference layout by design), and
  `fixtures/`, `spec/`, `templates/`, `references/` (data). A new engine directory is scanned by default.
  Site files are relative paths (`engine/config.mjs`).
- **Occurrence counts.** Identical lines in one file still share one site id, but each site carries
  `count`. An allowlist entry's optional `count` (an integer ≥ 2; default 1) must equal it: an extra
  copy of an allowlisted line is an `overcount`, a removed copy an `undercount`, and both fail the gate.
- **`ta-default` kind.** Used only for the lines inside `TA_DEFAULTS` in `engine/config.mjs`; each reason
  cites the reference literal the default copies (the extension path names the lifted TA module).
  The `HOOK_CALLS` phase names in `engine/extension.mjs` are allowlisted as `extension-call`.
- Output line: `engine sites 71, unlisted 0, stale 0, invalid 0, overcount 0, undercount 0`.
- **A backstop, not proof.** The scan is lexical: it catches TA literals that match the B0 categories,
  not TA behaviour expressed without such a literal. A clean gate does not prove extraction is complete.

### Explicit extension in a settings file (finding 1)

A present `.agents/tokenomics/settings.json` must state `extension` (a module path or `null`), else
`tokenomics: invalid .agents/tokenomics/settings.json: extension must be set explicitly (path or null)`;
a non-string, empty value is rejected too. So a foreign configuration can no longer inherit the TA
extension by omission. `loadExtension(settings, repo)` resolves a settings-supplied relative path against
the repo root (spec §14.4) — including `./extensions/test-automation.mjs`, which then fails to import unless
the repo ships it; the absent-file TA default (`settings === TA_DEFAULTS`, or `=== B1_DEFAULTS` when
`report-windows` is off) still resolves against the engine root, so every corpus case is unchanged. Every entry point passes its repo (`roots[0]` for
team-report; `--compare --repo <root>` for the export, else TA defaults).

### Minor fixes (findings 7–9)

- `receiptPathFor` (TA `stopGateCheck`) looks up a nested campaign-wave receipt by `settings.receipts.file`
  like its flat lookup (it used a literal `report.json`); TA bytes unchanged.
- `writeSubmission` omits the `(<stop> stop)` title part and the `Stop · owner` row parts that the segment
  lacks (null extension, no profile value) instead of printing `undefined`; TA bytes unchanged.
- The extension API is marked unstable until B2 (frozen as API 2 in Plan 4 Task 21, above), and the stale "exportRow exempt" wording is
  corrected here and in `extensions/test-automation.test.mjs`.

## rc.2 patch (`v0.2.0-rc.2`) — Codex review P2-01..P2-05

Fixes for `docs/reviews/plan-2-codex-review.md`; P2-06..P2-12 move to Plan 3 Task 1.

- **P2-01** — `fault-capture-stage-locked` no longer collects the host-writable TMPDIR (host tooling such as `xcrun_db` leaked into outputs); the observation records the pre-cleanup locked state, the `telemetry-capture.mjs:601:73` cleanup catch stays covered, and sandbox removal restores modes first (symlinks included).
- **P2-02** — submission stop/owner identity comes from the extension's `exportRow`, so TA bytes equal the reference for incomplete segments too; with no extension part the profile's own `stop`/`owner_group` is kept (foreign omission only where neither exists).
- **P2-03** — function waivers count toward the 15% exclusion budget (final review: V8 reports no inner blocks for a never-called function, so each excluded uncalled function is charged a documented lexical branch-point weight, `branchPointWeight` in `scripts/coverage.mjs`); whole-file scope (`*` and `(never loaded)`) must be pinned and validated; `build-tokenomics-export` is narrowed from whole-file to per-function exclusions after four export CLI cases closed its replayed branches.
- **P2-04** — exclusion kinds are an exact enum, branch ids are unique and duplicate function exclusions (same file + fn + offset) are rejected, and every citation must resolve to an existing reference `file:line` (line ≥ 1, no `..` path segment).
- **P2-05** — `team-report` rejects roots whose settings or extension modules differ (exit 2) instead of applying the first root's (the `roots[0]` note above now holds only for compatible roots); batch mode is exempt.

## Configuration (Plan 3 Task 5) — nested validation and named load failures (P2-11)

`validateSettings` (run by `loadSettings` on a present settings file) now checks every key path the engine
consumes, so a bad nested value fails at load with `tokenomics: invalid .agents/tokenomics/settings.json:
<key path> <problem>` instead of throwing deep inside a hook (e.g. `receipts: null` used to pass and crash in
`receiptsRoot`). The key paths come from the Step 1 grep over `tokenomics/{hooks,scripts,engine,extensions}`:

| key path | check |
|---|---|
| `dir` | non-empty string |
| `receipts` | object |
| `receipts.root`, `receipts.file` | non-empty string |
| `receipts.deliveredOutcomes` | array of non-empty strings |
| `intents.default` | non-empty string (`intents` must be an object) |
| `paths.factoryProfile` | non-empty string (`paths` must be an object) |
| `reports` / `reports.location` | object; `location` must be `tree` |
| `ratioIntents` | non-empty array of non-empty strings (B1 rules: checked only without `report-windows`; `validateB2Settings` ignores it, map D1; absent from `TA_DEFAULTS` since B2 closed, kept in `B1_DEFAULTS`) |
| `ids.patterns`, `ids.flags`, `ids.max`, `ids.stoplist` | as in Task 9 fix round 1 |
| `vocabulary.item`, `vocabulary.group`, `vocabulary.delivered` | non-empty strings |
| `extension` | module path string or `null` |

`TA_DEFAULTS` passes; an absent settings file still returns `TA_DEFAULTS` unvalidated and unchanged.

**Extension load.** `loadExtension` wraps a failed import as `tokenomics: cannot load extension <path>: <cause>`
(`<cause>` = the error code, e.g. `ERR_MODULE_NOT_FOUND`, `ERR_UNSUPPORTED_DIR_IMPORT`, else the message — a
syntax error). An API mismatch keeps `tokenomics: extension API mismatch`.

**Multi-root team-report.** `rootsConflict` reports an unreadable extension path (a directory, no permission) as
`cannot read <root>'s extension <path> (<code>)` and exits 2, instead of crashing on `EISDIR` / `EACCES`.

**Entry points with invalid settings** (`tokenomics/engine/entry-errors.test.mjs`) — each puts the named message on
stderr:

| entry point | exit | stderr |
|---|---|---|
| `scripts/work-scope.mjs` | 1 | `work-scope: <message>` |
| `scripts/team-report.mjs` | 1 | uncaught error: message + stack |
| `scripts/batch-cost.mjs` | 1 | uncaught error: message + stack |
| `scripts/build-tokenomics-export.mjs` | 1 | uncaught error: message + stack |
| `hooks/telemetry-capture.mjs` | 0 | `tokenomics: capture failed (session unaffected): <message>` |
| `hooks/scope-hook.mjs` | 0 | `<message>` (was silent before this task) |

A hook keeps exit 0 (it never breaks the host). scope-hook reports only failures of its settings/extension load
phase; any later failure stays silent as in the reference, so absent-settings behaviour is unchanged.

## Migrations (B2)

The B2 behaviour migrations live in `tokenomics/engine/migrations.mjs` as `MIGRATIONS` (`{id, item, landed}`), in
landing order (`docs/b2/MIGRATION-MAP.md` §4), which is also the composition order below. There are seventeen
(Plan 4 Task 3, owner Q1): the eleven spec §14.8 items; the spec-required items `report-conflicts` (22),
`role-dollars` (23) and `report-revision` (24), each landing alone; and the optional items 12–21 as three groups,
which amend §14.8's "each lands alone" for them (owner Q1b): `entry-points` (12, 13), `capture-robustness` (14–17,
21) and `report-robustness` (18–20). A group's `item` is its lowest item number, and its `migration.json` lists
every item in `items` (`registryProblems` requires an integer array that includes `item`). Each group declares real
corpus cases from its corpus-visible items; items 13 (`stdout-drain`) and 14 (`stable-enumeration`) have no corpus
diff, so their evidence is a unit test (an unpreloaded child writing more than 1 MB to a pipe; an unsorted
`readdirSync` stub), named in the group's row here when it lands (P3P-06). Landed so far: `exact-ids`, `anon-complete`, `fold-flags`, `null-unobservable`, `copilot-inclusive`, `shared-allocation`, `active-minutes`, `report-windows`, `scope-resolution`, `reports-location`, `writer`, `report-conflicts`, `role-dollars`, `report-revision`, `entry-points`, `capture-robustness`, `report-robustness` (below).

| id | item | summary | declared cases | interactions |
|---|---|---|---|---|
| `exact-ids` | 1 | Receipt ids name a dispatch label or branch only as an exact, case-sensitive whole token (boundary class `[A-Za-z0-9_-]`, `namesToken` in `scripts/batch-cost.mjs`); structured ids and group keys compare with `===`. | `before-ids-substring` | none |
| `anon-complete` | 5 | The anonymised submission carries no supplied identifier in any string: the scrub set (`scrubSet`, `engine/scrub.mjs`) is the union, over every row and the document, of `work_item_ref` and `work_item_brief` values, the engine's own enumeration of the project's group receipts (`receiptIdentifiers`, via `loadReceipts`: each slug, a nested slug's last segment, and the group directory, receipt-file and `cost.json` paths under `settings.receipts.root`), and the extension's optional `scrub` list (TA: the slugs in its notes), so the guarantee holds with no extension; `scrubStrings` replaces each member, as a whole token or path segment (`[A-Za-z0-9_-]` boundary), longest first, in every string of `runs.json` and `submission.md` and, in `runs.json`, in every object **key** below the row level (B2-09: `runs[i].extra["PRIVATE-47"]`; document and row field names are never renamed). Keys that scrub to the same text are never merged: an untouched key keeps its name, changed keys become `anonymised`, `anonymised-2`, `anonymised-3`... in insertion order. The dataset's token-quad keys (`input`, `output`, `cache_read`, `cache_create` inside `tokens` and `tokens_by_model.<m>`) are kept (`scrubStrings` `opts.keepKeys`, Plan 4 final review M2): a supplied word such as a nested slug's last segment `output` never renames a schema key, while values are still scrubbed. The `anonymize` hook may return a `scrub` array (identifiers; removed from the row). `--batch` is not anonymised. | `before-export-anon-batch` | none |
| `fold-flags` | 6 | `foldDispatchLog` gives a folded dispatch the §3.2 dispatch shape of a captured entry (`tokens: r.tokens ?? null`, `tokensAttributed: false` when unmeasured or the record says so, `tokensByModel: r.tokensByModel ?? {}` in captured key order), then recomputes the line's `tokensAttribution` over the parent and every dispatch (`attributionOf`, exported: absent / `partial` / `none`) and `models` as the sorted union with the folded `tokensByModel` keys. | `seed-claude-folded`, `cov-capture-pricing`, `cov-dispatch-batch` | none |
| `null-unobservable` | 4 | Capture writes `null` for what the host does not expose (§10.5): a Copilot shutdown with no usage in `modelMetrics` → `tokens: null` + `tokensAttribution` from `attributionOf` (no netting); every Copilot dispatch `toolErrors: null`, and `activeMin` / `toolCalls` null when `durationMs` / `totalToolCalls` are absent (`copilotDispatchCounters`, ledger and live log); VS Code `toolCalls: null`, `skills: null`, and `tokens: null` + `tokensAttribution: "none"` when no request carries `promptTokens`/`completionTokens` (cache categories stay 0, Q8a; a missing `elapsedMs` stays 0, Q8c); any host with no timestamps → `wallMin`/`activeMin` `null` (Q8b); the fold and `loadLiveLines` keep an absent counter null. Readers (O1): every aggregate bucket of `team-report` (totals, by person/week/host/intent/role) and `batch-cost` (`totals`, `cases[].direct`, `overhead.lead/stages/byStage`, `byRole`, `rework`) carries `unmeasured: {tokens, activeMin, wallMin, turns, toolCalls, toolErrors}` (Q8d), a null or absent quantity counts there instead of adding 0, and a sum no measured value reached is `null` (`UNMEASURED_KEYS`, `addMeasured`, `countMeasured`, `sumOrNull` in `scripts/team-report.mjs`). Markdown/HTML print `n unmeasured` beside a sum with a non-zero count and `—` for a null sum; rows whose tokens are all unmeasured stay listed. The export's `writeSubmission` (B2-06) reads the accumulated rows by their own fields: a row whose `cost_api_equivalent_usd`, `tokens` or `turns` is null adds nothing and is counted, so `submission.md` prints `— (n unpriced)` / `— (n unmeasured)` when no row measured the quantity and `<partial total> (n unpriced|unmeasured)` otherwise; a measured zero stays `$0` / `0`. `work-scope status` (Plan 4 final review, ledger 86) prints `—` for a dispatch whose tokens are null and its "so far" total sums only the measured units with ` (n unmeasured)` appended (`— (n unmeasured) tokens` when none is measured); like `writeSubmission` it is gated on the migration, because the reference already read those nulls as 0 (`cov-dispatch-batch` events 6, 7). | `seed-copilot-no-usage`, `seed-vscode-credits`, `seed-vscode-no-credits`, `before-vscode-no-usage`, `before-report-unknowns`, `seed-copilot-cli`, `cov-copilot-dispatch`, `cov-capture-copilot-edges`, `cov-capture-vscode-edges`, `cov-capture-claude-parse`, `cov-capture-scope-live`, `cov-capture-dispatch-edges`, `cov-capture-pricing`, `cov-reports-ledger`, `cov-dispatch-batch`, `cov-team-report-batches`, `cov-team-report-rollup`, `cov-batch-cost-edges`, `seed-receipts-waves`, `seed-receipts-shared-id`, `foreign-settings`, `foreign-null-extension`, `cov-work-scope-close-faults`, `before-dispatch-two-groups`, `before-export-anon-batch`, `before-ids-substring`, `before-ratio-manifest`, `before-report-windows`, `cov-export-cli`, `cov-export-submission-edges`, `fault-batch-cost-empty-repo`, `fault-batch-cost-sizing-locked`, `fault-batch-cost-unreadable`, `fault-gate-fold-symlink`, `before-ratio-revisions` (added with its baseline, Plan 4 Task 11) | `before-ids-substring` (`exact-ids` + `null-unobservable`, `g1/cost.json`); `cov-capture-pricing` (`fold-flags` + `null-unobservable`, the ledger) |
| `copilot-inclusive` | 3 | Every `host: "copilot"` ledger line carries `tokensBasis: "inclusive"` right after `tokens`: the session `tokens` are the host's `modelMetrics` totals, no longer netted by the dispatch totals, and every dispatch `tokens` (ledger `subagents[]` and the live `<session>.jsonl` records) is `null`, because the host gives one cache-inclusive total and no category split (§3.2.1, owner Q6: the per-dispatch total is dropped, with no `tokensAttributed: false`). `attributionOf` skips the dispatches of an inclusive line, so a usage-less inclusive shutdown is `tokensAttribution: "none"`, not `partial`. Readers decide by the line's own `tokensBasis`, never by `migrationOn` (O10): `team-report` `lineTokens` and the totals/person/week/host/intent buckets ignore an inclusive line's dispatch tokens, and so do the by-role buckets: a dispatch role's `byRole[*].tokens` takes nothing from an inclusive line (under `null-unobservable` every inclusive dispatch, null or informative, is counted unmeasured at dispatch grain in both readers, never summed and never a measured 0), so a role shared by parent and dispatch equals the session's own number (B2-04); `batch-cost` allocates the session total once (the lead thread and `totals`), adds no tokens from the line's dispatches to `cases[].direct`, `overhead.stages`, `byRole` or `totals.tokensByModel` (an informative dispatch `tokensByModel` is not summed in; B2-04) (null dispatch tokens count there as unmeasured under `null-unobservable`, not as a gap in `totals` or `unattributedUnits`), and writes `sources.inclusiveSessions: <n>` with `sources.inclusiveNote`. Join fixtures: `copilot-inclusive-session` (zero violations), `copilot-inclusive-dispatch-split` (`inclusive-dispatch-split`). | `seed-copilot-cli`, `seed-copilot-no-usage`, `cov-copilot-dispatch`, `cov-capture-copilot-edges`, `before-scope-precedence`, `cov-capture-dispatch-edges` | `seed-copilot-cli`, `seed-copilot-no-usage`, `cov-copilot-dispatch`, `cov-capture-copilot-edges`, `cov-capture-dispatch-edges` (each `null-unobservable` + `copilot-inclusive`) |
| `shared-allocation` | 2 | A dispatch that is "mine" in k groups (across every receipt except `rollup: true` ones) weighs `1/k` in each instead of 1 (owner Q5). `updateBatchCosts` computes k once over all receipts, including for a `--batch` build, with `sharedDispatchCounts(groups, allLines, {scopes})`, which returns `Map<host:lineId:dispatchId, k>`. It uses the same membership and the same mine test (`dispatchMine`) as the partition. `buildBatchCost`'s partition takes the map (`shared`). Without it, k is 1. Within a group the existing cluster split applies to the weighted amount. A rollup group keeps full weight. `cost.json` gains `sources.sharedDispatches: <n>` (dispatches with k > 1) and `sources.sharedDispatchesNote`. Inclusive lines: only the dispatch count, minutes, tool counters and measured dollars split, because the tokens stay at session grain and null tokens stay unmeasured. Shares are unrounded and each group is rounded once at output, which is within the kit tolerance for k ≤ 3. The kit checks the join traces, not `cost.json`; the `div` and cluster splits share the same k/2 bound on the rounded figures. The TA `classifyDispatch` hooks receive the new `w`/`share`. Join fixture: `shared-dispatch-split` (zero violations, its trace checked against the engine). | `seed-receipts-shared-id`, `before-dispatch-two-groups` | `seed-receipts-shared-id`, `before-dispatch-two-groups` (each `null-unobservable` + `shared-allocation`, both `cost.json`) |
| `active-minutes` | 7 | A session's `activeMin` is allocated once, at session grain (spec 5.4, owner Q7): each group gets `activeMin / div` on `overhead.lead`, the parent role and `totals`; no dispatch minutes are subtracted or added. Dispatch-partition fields are `null` (not allocated at this grain): `cases[].direct.activeMin`, `overhead.stages`, TA `byStage.*` / `rework`, dispatch-role `byRole.*.activeMin`, `stats.directActiveMin`. A dispatch's `nul.activeMin` is null (not applicable), so these nulls are **not** counted in `unmeasured`. `loaded.activeMin` = group time ÷ cases. `cost.json` gains `sources.activeMinGrain: "session"` and `activeMinNote`. The 1/k weight of `shared-allocation` never reaches minutes. A live line's own minutes are never the sum of its (overlapping) dispatch minutes: `null` (unmeasured) with `null-unobservable`, else the reference 0. Period report: the parent role gets the full session minutes; dispatch minutes go to `byDispatchRole` (own table, outside every total), and a dispatch-only role reads `null` in `byRole`. TA: `classifyDispatch` direct/overhead receive `m.activeMin: null`; `render-md` `cost` renders a null minute as `—`; sizing has no per-case actual minutes (`hiMin` cannot fire) and keeps the batch-grain estimate vs actual over the rows' `loaded.activeMin`, labelled `basis: "allocated"`. Join fixture: `activemin-session-grain` (zero violations, checked against the engine; `grain-activemin-dispatch` stays the negative control). | `before-dispatch-two-groups`, `before-export-anon-batch`, `before-ids-substring`, `before-ratio-manifest`, `before-report-unknowns`, `before-report-windows`, `cov-batch-cost-edges`, `cov-copilot-dispatch`, `cov-dispatch-batch`, `cov-export-cli`, `cov-export-submission-edges`, `cov-reports-ledger`, `cov-team-report-batches`, `cov-team-report-rollup`, `cov-work-scope-close-faults`, `fault-batch-cost-empty-repo`, `fault-batch-cost-sizing-locked`, `fault-batch-cost-unreadable`, `fault-gate-fold-symlink`, `foreign-null-extension`, `foreign-settings`, `seed-receipts-shared-id`, `seed-receipts-waves`, `before-ratio-revisions` (added with its baseline, Plan 4 Task 11) | every declared case, each naming `null-unobservable` + `active-minutes`; three owners on `before-ids-substring` (+ `exact-ids`), `seed-receipts-shared-id` and `before-dispatch-two-groups` (+ `shared-allocation`), `cov-copilot-dispatch` (+ `copilot-inclusive`) |
| `report-windows` | 8 | The period report follows spec 5.5 with D1's manifest binding (O4) and frozen B1 defaults (O8). **Window:** one `[since, until)` UTC window on `endedAt` for the whole report (owner Q10b): `since` defaults to the earliest `endedAt` of the deduplicated lines (before `--role`), `until` to the report time; a date-only bound is `T00:00:00Z` (Q10d); an unreadable bound exits 2; a line without `endedAt` lies in no window (`reportWindow`, `parseInstant`). **Receipts:** the current state per id by the spec 5.2 ordering (`compareReceiptRows`, `currentReceiptRows`; revision, then `at`, then lowest group, then lowest source; on an exact tie the later-read row wins, item 22 turns ties into conflicts). A receipt stamped with a `manifestRevision` reads its delivered outcomes from that revision (`manifestFor`; a missing archive counts nothing and adds its finding) and never uses mtime. A receipt without one (every spec 5.1 receipt) is reference-era (Q10c): its delivered outcomes come from `settings.receipts`, the policy that discovered it and that the group cost uses (controller ruling, review round 1 I1), and with no `revision` its file mtime serves as revision. Dates (`--since`/`--until`, `endedAt`, receipt `revision`/`at`) are ISO-8601 only, an offset-less date-time read as UTC (`parseInstant`); a non-ISO receipt `at` counts as none. `cases.delivered` = delivered winners whose `at` lies in the window; delivered winners without `at` are `cases.unwindowed`. **Ratio:** `perDelivered = {costUsd, activeMin, priced, eligible[, partial]}`: priced `costUsd` of the windowed sessions whose `scope.intent` is a ratio intent of their line's manifest revision, ÷ `cases.delivered`; `null` object when the denominator is 0 (or `--role`), `costUsd` null when nothing eligible is priced, a measured 0 stays 0; `automationOnlyCostUsd` is gone (the ratio is the scoped figure). A line naming a revision without `manifests/<N>.json` is unverified: `unverified: {sessions, costUsd}` beside the ratio, `findings: ['manifest-archive-missing: revision N']`, its spend stays in the totals. Lines with no readable `endedAt` are outside every window and every total, counted as `undated: {sessions, costUsd, priced}` beside the ratio (present only when non-zero; review I2); `unverified` carries `priced` too. `perDelivered.activeMin` keeps the all-session formula and is labelled "(all sessions)" in Markdown. The report states the current-state semantics, the cumulative-line limitation and the undated rule (`semantics` in JSON, a line in Markdown and HTML). **Manifest reader** `engine/manifest.mjs`: `manifestFor(telemetryDir, record)`, `currentManifest(telemetryDir)` (module.json, else the implied manifest at revision 1). **Settings:** `B1_DEFAULTS` (frozen copy of the B1 literal, `ratioIntents` included) and `validateSettings` (B1 rules) behind `!migrationOn('report-windows')`; with it, settings merge over `TA_DEFAULTS` and `validateB2Settings` ignores `ratioIntents`. `extensionPath` treats `B1_DEFAULTS` like `TA_DEFAULTS` (engine-root resolution). scope-hook suggests the current manifest's ratio intents (`ratioIntentsOf`; with none it offers `intents.default` as the label and says no intent feeds the ratio). Group cost (`cost.json`, `--batches`) stays membership-based and unwindowed. **One delivered vocabulary per receipt (Codex B2-05):** `receiptDelivery(telemetryDir, receipt, settings)` in `engine/manifest.mjs` is the single rule for the period denominator (`loadCases`), `batch-cost`'s `delivered` / `averages.totalPerDelivered` (and the `delivered-note` hook input), the period report's `byBatch` rows and its delivered-only `perCase` sort and `perCaseStats` (per row, by its group's resolution, `groupDeliveredOutcomes`): a stamped receipt reads its archive, a revisionless one `settings.receipts`, so one report never contradicts itself and a settings change never reinterprets a stamped receipt. A stamped receipt whose archive is missing delivers nothing (Q11b) and its `cost.json` gains `findings: ['manifest-archive-missing: revision N']` (after `delivered`, only then), carried into its `byBatch` row and rendered as a callout in the batch Markdown/HTML. Without `report-windows` every receipt reads `settings.receipts` (the B1 extraction). | `cov-team-report-rollup`, `before-report-windows`, `before-ratio-manifest`, `before-ratio-revisions`, `cov-reports-ledger`, `cov-team-report-batches`, `foreign-settings`, `before-report-unknowns` | every declared case: `null-unobservable` + `active-minutes` + `report-windows` (the existing interactions extended) |
| `scope-resolution` | 9 | Scope records follow spec 14.11 (`engine/scopes.mjs`, shared by the capture, `work-scope` and `scope-hook`; `resolveScope` is re-exported by `telemetry-capture.mjs`). **Host-qualified:** records at `scopes/<host>/<session>.json` (`SCOPE_HOSTS`: `claude`, `copilot`, `copilot-vscode`); a legacy flat `scopes/<session>.json` is still read (and updated in place) when it is the session's only record; an id with records in more than one place (two hosts, or flat beside host-qualified) is ambiguous: never merged (a host reads only its own record), reported on stderr by the capture (`tokenomics: scope for <host>:<id> is ambiguous — …`) and by the kit `scope` profile as `ambiguous-scope` (class `limitation`) (Q12b). A pending record lives in `scopes/<host>/` when its host is known (`--host` or env) and only that host's sessions claim it; a host-less one stays flat (M4). `work-scope --host <h>` defaults to `copilot` when `COPILOT_CLI=1`, else `claude` when `CLAUDE_SESSION_ID`/`CLAUDE_PROJECT_DIR` is set (`hostFromEnv`; review round 1 I1); `open` without a host and without `--session auto` is a usage error (Q12a); `scope-hook` reads the record for the environment's host (else the only record), its suggested `open` names `--host <h>`, and its gate names an ambiguous id instead of "declared no scope" (M5). A session whose only record is another host's is reported on the capture's stderr and as the kit finding `scope-host-mismatch` (`limitation`, `scope` profile), never silently (O1). **Handles:** `open --session auto` prints `{"handle":"pending-…"}` on stdout; `outcome`/`close`/`show` resolve a handle to the pending record before the claim and to the record whose `claimedFrom` is the handle after it (`claimedScopePath`); `auto` on any other command exits 1. **Precedence and claims:** unreadable, symlinked or directory pending entries are skipped (I2); own `source: "handoff"` record > a pending record claimed by the reference time window > the own other record; an already-claimed record is kept. A claim renames the pending file to `<host>/<id>.json.claim`, writes the merged record atomically (temp + rename, M2) (the pending declaration — intent, batch, cases, role, source — wins; outcomes merge pending-first; `closedAt` kept; `claimedFrom` set; controller ruling on Q12c), removes a displaced legacy flat record, then the claim file; a leftover `.claim` is completed by the next resolution, merging the own record wherever it lies (host-qualified or flat, then removed; M1) and never re-merging an already-written one. An unreadable store resolves to no scope and the line is still written (R9, Q12d). **Role:** `open --role` stores `role`; the capture stamps `scope.role`; a re-open keeps `role` and `claimedFrom`. **Restamp:** `work-scope restamp --host <h> --session <id>` exits 1 with no prior line, and on a reference-era winner (no `writer`) naming `capture --force`; the success path landed with `writer` (row below). | `seed-scope-self`, `seed-scope-pending`, `seed-scope-handoff`, `fault-capture-sweep`, `before-scope-precedence`, `before-scope-handle`, `before-scope-env-host` (the `COPILOT_CLI=1` host default, no `--host`), `fault-pending-write`, `cov-dispatch-batch`, `cov-copilot-dispatch`, `cov-work-scope-lifecycle`, `cov-scope-hook`, `cov-scope-hook-edges`, `cov-scope-hook-stdin-chunks`, `seed-receipts-shared-id`, `cov-capture-vscode-edges`, `cov-capture-scope-live`, `foreign-settings`, `foreign-null-extension`, `before-dispatch-two-groups`, `before-ids-substring`, `cov-work-scope-close-faults`, `fault-batch-cost-empty-repo`, `fault-batch-cost-sizing-locked`, `fault-gate-fold-symlink` | `before-scope-precedence` (`copilot-inclusive` + `scope-resolution`, the ledger); `fault-capture-sweep` (`null-unobservable` + `copilot-inclusive` + `scope-resolution`, `changes.txt`) |
| `reports-location` | 10 | `reports.location` accepts `"tree"` and `"telemetry"` (without the migration only `tree`, the B1 rule). A present settings file that omits the key now defaults to `"telemetry"`, unless its effective extension is `test-automation` (path basename `test-automation[.mjs]`), which keeps `"tree"`; no file → `TA_DEFAULTS`, `tree` (`effectiveReportsLocation(doc, present)`, owner Q13b). Under `telemetry` `groupReportsDir` is `.agents/telemetry/<dir>/reports/<group path>/` and close writes `batch-report.*`, `batch-tokenomics.*` and `cost.json` (`updateBatchCosts` with `write`) there, creating the directory; receipts are only read in the tree and the stderr path line names the new path (Q13a, c). `onClose` keeps receiving the group's receipt dir (TA's gate runs and verdicts live beside the receipt; review round 1 I1), and TA's `sizeBaselines` reads a group's `cost.json` from the reports dir first, then the receipt tree. **TA detection:** the effective extension is test-automation when the extension path's basename is `test-automation` or `test-automation.mjs` (segment boundary: `my-test-automation.mjs` is not); a wrapper extension gets the `telemetry` default unless it names `tree`. **Release note:** an old tree-located `cost.json` is left in place after the upgrade (nothing deletes it); the engine's readers recompute and ignore it, TA's baselines count a group once, reports dir first. The anonymisation set also supplies the relocated reports dir and its `cost.json`. **Live pages (Codex B2-10):** group directories own `reports/<group path>/` and a slug may be any directory name (`foo` and `foo.html` are both valid), so under `telemetry` the live page moves out of that namespace to `.agents/telemetry/<dir>/reports-live/<encodeURIComponent(batch)>.html` (`liveReportPath`); the encoding is injective (`a/b` and `a-b` no longer fold to `a-b.html`) and `reports-live` is a sibling of `reports`, so no slug can collide in either order. Under `tree` (TA, migration off) the reference `reports/<batch with / as ->.html` is unchanged. Nothing in the engine links to the live page; its path is returned by `renderLiveReport`. Readers decide by what is on disk (O10): the period report's By-group table is recomputed from receipts and the ledger, so a relocated and an older tree-located `cost.json` coexist. | `foreign-settings`, `foreign-null-extension` (interactions with `null-unobservable` + `active-minutes`: the old path is removed, the new one changed) | `foreign-mixed-roots` refused (no difference: its roots are not relocated by the omitted key) |
| `writer` | 11 | Every **measurement** line `appendLine` writes (Claude direct capture, `captureSessionNow`, every sweep path, all three hosts) carries `writer: "tokenomics-engine@<version>"` and `manifestRevision` right after `v` (§3.2, map D4). The version is `engineVersion()` (`engine/version.mjs`): `TOKENOMICS_ENGINE_VERSION_PIN`, else `tokenomics/ENGINE.json`'s `engine` (B3; `package.json`'s `version` is kept equal by a test), else `0.0.0+unknown` (a copy without `ENGINE.json`; owner Q14). The replay runner pins `0.0.0-replay` on every event, so a version bump never churns the goldens. `manifestRevision` is `currentManifest(<telemetry dir>).revision` (`stampRevision`: `module.json` absent → 1, the implied TA manifest; present with an integer revision ≥ 1 → it; present but unusable — unparseable, not an object, no integer revision → `null`, never dropped and never the implied 1). The reader (`manifestFor`) reads an explicit `null` as unverified, finding `manifest-revision-unknown`, excluded from the per-delivered ratio and counted in `unverified`; only an absent key is revisionless (implied legacy manifest; review round 1, I1). The live dispatch log is not a ledger line and is unchanged. **Restamp (O7):** `work-scope restamp --host <h> --session <id>` on a `writer` winner appends it again to the winner's ledger file with the session's own current scope record (`scopeForLine`, now in `engine/scopes.mjs`) as `scope`, its original `writer` and `manifestRevision`, `restampedBy` = the current `tokenomics-engine@<version>` right after them, `capturedAt` = now; the top-level `cases` re-derive as `(winner.cases − winner.scope.cases) ∪ newScope.cases`, sorted (a mis-declared id leaves, the corrected one joins, mined ids stay; review round 1, M2); measured fields and `endedAt` are kept (`appendLine(..., { restamp: true })` writes the caller's line as built). No own scope record (none, ambiguous, or only another host's) → exit 1, nothing appended; a `writer` winner with `writer` switched off → exit 1. Readers are unchanged: they decide by line fields (O10). Production: never switchable (§18.5; enforcement B3/B4, D6). | the 40 capture cases of map item 11 (`seed-claude-basic` … `before-vscode-no-usage`; full list in `corpus/migrations/writer/migration.json`), including `cov-capture-sync` (`changes.txt` git digest) | new: `before-vscode-no-usage`, `cov-capture-claude-parse`, `cov-capture-scope-live`, `cov-capture-vscode-edges`, `seed-vscode-credits`, `seed-vscode-no-credits` (`null-unobservable` + `writer`); `seed-claude-folded` (`fold-flags` + `writer`); `seed-scope-self` (`scope-resolution` + `writer`). Extended with `writer`: `cov-dispatch-batch` (+ `fold-flags`, the ledger), `cov-capture-copilot-edges`, `seed-copilot-cli`, `seed-copilot-no-usage`, `cov-capture-pricing`, `cov-copilot-dispatch`, `fault-capture-sweep` (`changes.txt`), `before-scope-precedence` (the restamp event exits 0 and appends the restamped line) |
| `report-conflicts` | 22 | Engine reports apply spec 3.5 (map R20, O2; owner Q16). `dedupConflicts(lines)` (`team-report.mjs`) → `{winners, duplicates, conflicts: [{key, lines}], preview}` by the kit's rule and canonicaliser (`kit/canonical.mjs` `canonical` + `accountingPayload`, imported, as `aggregate`'s `kit/identity.mjs` uses them): rank = (`endedAt`, `capturedAt`), null or unreadable ranks lowest; among an exact tie one representative per accounting payload (the lowest full canonical line); one payload = a duplicate, several = a conflict whose preview pick is the lowest canonical accounting payload. All three lists are sorted by `host:id`, so the reports read their lines in key order and are byte-identical for any read order (review round 1, I3). **Scope:** a conflict is in scope when any of its tied lines is (window, `--role`, group membership; I1), and a conflict is never `undated` (I2). **Period report:** a conflicted session leaves every total, breakdown, the index and the ratio numerator; in-scope conflicts are counted as `conflicts: {sessions, costUsd, priced}` (the shape of `unverified`/`undated`, so its dollars are surfaced) beside `preview: {sessions, costUsd, priced}` = the totals plus the picks; both are present only when non-zero. **Receipts:** with `report-windows`, an exact spec 5.2 rank tie (`compareReceiptRows`) between different rows is a conflict (`receiptWinners`; two roots binding different manifests included): the id leaves `examined`/`delivered`/`outcomes`; `cases.conflicts: n`, `cases.preview: {examined, delivered, unwindowed}` (lowest canonical row); an identical row is a duplicate; with the migration off the later-read row wins. **Group cost:** the members are the winners; `sources.conflicts` + `conflictsNote`; `preview: {sessions, costUsd, note}` from a build that adds the picks of the group's conflicts (run without the extension); shared-allocation's k counts winners and picks alike. Markdown and HTML (period, batch delivery and tokenomics pages) render a callout. A restamp line (newer `capturedAt`) outranks its winner and never ties; `work-scope restamp` refuses a winner that is an exact conflict (exit 1, `capture --force`). | `cov-team-report-rollup` (event 3: `d4` and `d5` are conflicts; event 0: key order), `before-ratio-manifest`, `cov-reports-ledger`, `cov-team-report-batches`, `foreign-settings` (key order only); every other period-report and batch candidate refused (no difference) | extended with `report-conflicts`: `cov-team-report-rollup`, `before-ratio-manifest`, `cov-reports-ledger`, `cov-team-report-batches` (each with `null-unobservable` + `active-minutes` + `report-windows`), `foreign-settings` (+ `reports-location`) |
| `role-dollars` | 23 | The join's by-role dollars are inclusive by role (spec 3.2.1, map O3/R21; owner Q1a). `buildBatchCost`: a priced session's parent role (`line.role`, else `session`) is charged what the group charges for its session — the lead share (session − Σ dispatches) / div plus every included dispatch's measured dollars at its weight (`w`: 1, shared-allocation's 1/k, or a neutral 1/div) — so over priced sessions Σ `byRole.costUsd` = `totals.costUsd` (owner ruling, review round 1: this supersedes the brief's literal `costUsd / div`, which it equals when the group carries all or none of the session's dispatches evenly). An unpriced session (`costUsd` not a number) adds no by-role dollars: its parent role stays `null` and counts in `unpriced` (spec 3.2.1, O1; review round 1, I1); its measured dispatch dollars stay in `totals` (the existing floor) and in `byDispatchRole` only, so with unpriced sessions Σ `byRole.costUsd` = `totals.costUsd` − those sessions' dispatch dollars. Every `byRole` bucket carries `priced` / `unpriced` parent-session counts (I2). A dispatch adds no by-role dollars: a dispatch-only role's `byRole.costUsd` is `null` with `priced` / `unpriced` 0 / 0, not allocated at this grain (its tokens, count and tool counters stay in `byRole`), and a dispatch role named like the parent role leaves the parent's dollars alone. The separate measured breakdown `byDispatchRole: {<role>: {units, costUsd, priced}}` (present, possibly empty, after `byRole`; key-sorted) carries Σ `w` dispatches, their measured dollars × `w` and the priced share; an unpriced dispatch (every Copilot dispatch: the host prices the session once) counts in `units` but not `priced`, and a role with none priced reads `costUsd: null`, never 0. It is never summed into `byRole` or `totals`. Renders (by field, O10): the batch-report and tokenomics markdown/HTML and the live page add the inclusive by-role note and a "Dispatch dollars by role" table (`— (n unpriced)` for an unpriced dispatch role); a by-role cost cell reads `—` for a dispatch-only role ("— = not allocated at this grain") and `— (n unpriced)` for an unpriced parent (`$x (n unpriced)` when partly priced), never alike (I2). Two shapes share the name `byDispatchRole` (period `--json` minutes versus `cost.json` dollars; see "Extension API", "Two shapes share the name `byDispatchRole`"). The period report's `byRole` carries no dollars and does not change. | `before-dispatch-two-groups`, `before-export-anon-batch`, `before-ids-substring`, `before-report-unknowns`, `cov-batch-cost-edges`, `cov-copilot-dispatch`, `cov-dispatch-batch`, `cov-export-cli`, `cov-export-submission-edges`, `cov-reports-ledger`, `cov-team-report-batches`, `cov-work-scope-close-faults`, `fault-batch-cost-empty-repo`, `fault-batch-cost-sizing-locked`, `fault-batch-cost-unreadable`, `fault-gate-fold-symlink`, `foreign-null-extension`, `foreign-settings`, `seed-receipts-shared-id`, `seed-receipts-waves` (20; the other 50 cases refused, no difference) | extended with `role-dollars` (all 20 existing): each names `null-unobservable` + `active-minutes`, plus `exact-ids` (`before-ids-substring`), `shared-allocation` (`before-dispatch-two-groups`, `seed-receipts-shared-id`), `copilot-inclusive` + `writer` (`cov-copilot-dispatch`), `fold-flags` + `writer` (`cov-dispatch-batch`), `report-windows` (`before-report-unknowns`), `report-windows` + `report-conflicts` (`cov-reports-ledger`, `cov-team-report-batches`), `reports-location` (`foreign-null-extension`), `report-windows` + `reports-location` + `report-conflicts` (`foreign-settings`) |
| `report-revision` | 24 | Every engine-written report records the `manifestRevision` it was written under (spec 14.4, map O6/R22; owner Q14c), by the `writer` stamp rule (`stampRevision`): `module.json` absent -> 1 (the implied manifest), an integer revision >= 1 -> it, present but unusable -> `null`, which is the unknown and is never rendered as 1. `cost.json`: `manifestRevision` right after `v`. Period `--json`: right after `generated`; the revision is the primary (first) root's telemetry directory, and `manifestRevisions: [{dir, manifestRevision}]` follows it only when the distinct directories disagree. Export: the accumulated `runs.json` (and the submission and anonymised copies) gets `manifestRevision` right after `schema_version`; rows are unchanged (the dataset schema is external) and the anonymiser leaves a number alone. Markdown / html (batch, tokenomics, period, the live page) end with the footer line `manifest revision N`, `manifest revision unknown` for `null`, and `manifest revisions: <dir>=N; ...` for differing directories; `submission.md` gets the same line after the scrub. Readers decide by the field (O10): a report or `cost.json` without the key renders no footer. Declared (24): `before-dispatch-two-groups`, `before-export-anon-batch`, `before-ids-substring`, `before-ratio-manifest`, `before-ratio-revisions`, `before-report-unknowns`, `before-report-windows`, `cov-batch-cost-edges`, `cov-copilot-dispatch`, `cov-dispatch-batch`, `cov-export-cli`, `cov-export-submission-edges`, `cov-reports-ledger`, `cov-team-report-batches`, `cov-team-report-rollup`, `cov-work-scope-close-faults`, `fault-batch-cost-empty-repo`, `fault-batch-cost-sizing-locked`, `fault-batch-cost-unreadable`, `fault-gate-fold-symlink`, `foreign-null-extension`, `foreign-settings`, `seed-receipts-shared-id`, `seed-receipts-waves`; the other 46 show no difference. Not covered: `renderCompare` (two cost.json side by side) and `otel-report.mjs` (an OTel sink summary, no manifest); interactions in `corpus/migrations/_interactions/` name `report-revision` beside every other owner of a report path. |
| `entry-points` | 12, 13 | `engine/entry.mjs`: `isMain(import.meta.url, argv1)` compares `realpathSync` of the module and of `argv[1]` (false, never a throw, for a missing argv[1] or an unresolvable path), so a hook or script run through a symlinked path (sdlc-skills `--symlink`, macOS `/tmp`) runs (item 12, map R8); `exitAfterDrain(code)` waits for `process.stdout`/`process.stderr` to drain (`writableNeedDrain` -> `drain`, capped at 10 s so a stalled reader never hangs a hook) and then calls `process.exit(code)` (item 13, map R17; claims no more than Node's documentation on asynchronous POSIX pipe writes). Applied to the main guard and exit of `telemetry-capture`, `scope-hook`, `work-scope`, `batch-cost` (guard and its no-receipts exit), `team-report`, `build-tokenomics-export`, `bin/harness-telemetry`, `otel-report` and `install-hooks` (`otel-sink` is a server: guard only). The drain also waits for a pending write below the high-water mark (`writableLength > 0`, via an empty-write flush barrier); with the group off each keeps its reference guard and `process.exit`. Hooks still exit 0. Item 13 has no corpus diff (the replay preload makes stdio blocking); its evidence is the unit test in `engine/entry.test.mjs` (an unpreloaded `team-report.mjs` child writing > 2 MB to a pipe delivers every byte the same run writes to a file). Declared (1): `before-entry-symlink` (the capture now runs and appends its line; also `__events__/0.stderr`). Interaction: `before-entry-symlink` (`entry-points` + `writer`: the stamped line exists only with both on). |
| `capture-robustness` | 14, 15, 16, 17, 21 | Item 14: `findSubagents` and the TA `receiptIds` sort their `readdirSync` listings (strcmp on the name) instead of trusting an undocumented order; both take an optional `fs` (default: the real `fs`) as the test seam. No corpus diff (POSIX listings are sorted and the replay preload sorts them); the evidence is the unsorted-`readdirSync` unit tests (`telemetry-capture.test.mjs`, `test-automation.test.mjs`). Item 15: `captureDispatches` skips a sub-agent whose transcript path is a directory with a stderr note, and records the rest. Item 16: `parseVsCodeChatSession` ignores holes left by an op-log update two or more past the end. Item 17: the sweep's VS Code path appends only when the end advanced past the known end, so a timestamp-less session (null end, read back as 0) is appended once; a changed measurement state re-appends it (the parsed line against the latest ledger line for that session, over every field except v, capturedAt, writer, manifestRevision, restampedBy, user, repo, branch, scope and prompts, so a restamped line is not superseded by a re-capture of the unchanged file: cost including null to measured, the tokens quad, turns, tool counters, models, ...; Codex B2-08), with a capturedAt strictly after the superseded line so it supersedes and never reads as a `report-conflicts` tie, and readers keep the latest line per host:id; its `activeMin` stays null (Q8b). Item 21: Copilot dispatch-log records carry `host: "copilot"` and a provisional live line takes `host` from the log record (by field, whatever the switch set; a record without it reads as claude). | `cov-capture-vscode-edges`, `cov-capture-dispatch-edges`, `cov-copilot-dispatch` | `cov-capture-vscode-edges`, `cov-capture-dispatch-edges`, `cov-copilot-dispatch` (each names `capture-robustness` beside the migrations it already had) |
| `report-robustness` | 18, 19, 20 | Item 18: `work-scope --repo ""` is a usage error naming `--repo` (exit 1) instead of passing `''` through `??` and silently skipping sizing (R11). Item 19: the shared `pct` renders `—` for a non-finite share, so a zero-session group prints no `NaN%` (R12). Item 20: the TA `submission` parts omit a missing stop / owner / work-item level, and an overflowing cost sum renders `n/a` (never `` `undefined` `` or `$null`; R18); `manifestRevision`'s footer still follows the anonymiser scrub. Kit (owner Q2, not gated): `kit/load.mjs` marks a `scopes` that is not a directory (`scopesBlocked`) and `check` reports `scopes-not-directory` instead of throwing ENOTDIR (R10). | `fault-batch-cost-empty-repo`, `cov-team-report-batches`, `cov-export-submission-edges`, `cov-work-scope-close-faults`, `fault-gate-fold-symlink` | `cov-export-submission-edges`, `cov-team-report-batches`, `cov-work-scope-close-faults`, `fault-batch-cost-empty-repo` (also names `scope-resolution`), `fault-gate-fold-symlink` (each names `report-robustness` beside the migrations it already had) |

**The variable.** `TOKENOMICS_MIGRATIONS` selects which landed migrations run:

| value | enabled |
|---|---|
| unset or empty | every landed migration (the default) |
| `none` | none — the B1 extraction above |
| `a,b` | exactly those ids; each must be known and landed |

An unknown id throws `tokenomics: unknown migration '<id>' in TOKENOMICS_MIGRATIONS`; a known but unlanded id throws
`tokenomics: migration '<id>' has not landed`. `loadSettings` calls `enabledMigrations(env)` first, so every entry
point that loads settings rejects a bad value (with its usual exit and stderr, see the table above) instead of
running the default: `hooks/telemetry-capture.mjs`, `hooks/scope-hook.mjs`, `scripts/work-scope.mjs`,
`scripts/team-report.mjs`, `scripts/batch-cost.mjs`, `scripts/build-tokenomics-export.mjs` and
`scripts/install-hooks.mjs`. `hooks/otel-sink.mjs` and `scripts/otel-report.mjs` never load settings (they are
byte-identical to the reference and whole-file excluded), so they do not validate the variable at start-up. Code asks
`migrationOn(id)`, which calls `enabledMigrations` and so throws the same named error wherever it is consulted.

**Scope.** The variable is the **harness and rescue lever**, not a production setting. `none` is a supported mode: it
is the B4 rescue release's writer (spec §18.5 "inaugural recovery"). Production switching of individual measurement
migrations (§18.5 "contract-valid switches") is B3/B4 settings work. `writer` is **never** switchable in production;
the harness may still isolate it.

**Registry and modes.** `corpus/migrations/<id>/migration.json` declares, per case, the paths a migration changes
or removes (and exits it changes); the after-files are stored whole under `corpus/migrations/<id>/expected/<case>/`.
`node scripts/migrations.mjs check` asserts each migration's diff equals exactly its declared diff (spec §12, §18.2)
in four modes:

- `none` — `TOKENOMICS_MIGRATIONS=none`; every case equals its baseline (`expected/49577c7`, or `expected/engine` for
  approved engine-only cases);
- `only:<id>` — per landed migration, each declared case equals baseline + declared diff, every other case its
  baseline;
- `default` — `TOKENOMICS_MIGRATIONS` **unset**: the engine's genuine default, so a migration that works only when
  named fails here (Codex P3-04). It always runs; with nothing landed every case equals its baseline;
- `all` — the explicit comma list of landed ids, once at least one has landed.

**Composition.** `default` and `all` expect the composition of the reviewed declarations (`composeExpected`): the
baseline, then each landed migration declaring the case applies its `changed`, `removed` and per-event `exits`, in
registry order. Disjoint declarations compose exactly, so changed bytes on a declared path, a cancelled declared
change and a changed path that disappears all fail. A path, or an event exit `exit:<i>`, declared by two migrations
is a conflict and a problem until an **interaction declaration** resolves it:
`corpus/migrations/_interactions/<case>/interaction.json` (`case`, `migrations` — at least two, all landed, at
least one declaring the case —,
`reason` ≥ 40 characters, `changed`, optional `removed` / `exits`) with after-files under
`_interactions/<case>/expected/`. It applies only when all its migrations are enabled (in `default` and `all`),
overrides the composition, must cover every conflict, may override a declared path or exit only when it names
every migration declaring it (so a migration landing later on a stamped path fails), may declare paths no migration
changes (e.g.
`entry-points` (item 12 `entry-guard`) + `writer` stamping `before-entry-symlink`), and may not repeat what composition alone gives
(`interaction declares no change`). Cumulative bytes are never recorded from the implementation under test (Codex
P3-01, which retired the recorded `expected/b2` goldens) except through such an explicit, reasoned interaction
declaration, written by `write-interaction <case>` and reviewed with `show-interaction <case>`.
Every file map in the harness (collected outputs, goldens, declared and composed expectations) is a null-prototype
object with own-property membership, so any legal filename — `__proto__`, `constructor`, `toString` — is an ordinary
path key (Codex P3P-01).
Each `__sandbox__/changes.txt` record is one JSON array per line (`["A",path,digest]`, `["M",path,old,new]`,
`["D",path,old]`), with paths and link targets scrubbed field by field before serialisation, so a newline in a path
or symlink target cannot forge a second record (Codex P3P-02). The git-directory summary assumes git on `PATH`
(without it, git dirs are walked as files and `changes.txt` may vary), hashes raw committed blob ids (committed
content is not scrubbed: fixtures must not commit sandbox paths or times), sees only `detached` for a detached HEAD,
assumes SHA-1, and copies gitlink commit ids (Codex P3P-04). Evidence: macOS × Node 24 and 18.19 verified locally;
Linux git unverified (owner parked). `docs/spec.md` §18.2 now states this boundary (v4.2.1).
Observation exactness (Codex fix wave F1, B2-01…03): `runCase` refuses — throws `replay observation refused`,
which `checkMigrations` and `diff-impl` report as that case's problem in every mode, and `goldens.mjs` /
`write` / `write-interaction` refuse to record — any observation that would alias two different outputs:
(B2-01) two distinct raw sandbox paths that scrub to one `changes.txt` key (`snapshotTree` `onCollision`, default
throw; never an overwrite), and any raw sandbox path or link target that already contains a scrub token
(`<REPOKEY>`, `<ROOTKEY>`, `<REPO>`, `<HOME>`, `<ROOT>`, `<IMPL>`), which would read as a scrubbed real path in
another run; (B2-02) a selected output under the reserved roots `__events__/` and `__sandbox__/`, which own the
event streams and `changes.txt` — `validateManifest` rejects such an `outputs` entry, and a real file reaching
them anyway (e.g. through output `.`) is refused instead of merged; (B2-03) bytes that are not valid UTF-8. The
oracle compares text, so selected output files, event stdout/stderr, stored goldens and declared/interaction
after-files are decoded strictly (`collect.mjs` `decodeText` / `readText`); strict UTF-8 decoding is a bijection,
so string equality is byte equality, and invalid bytes are refused by name instead of becoming U+FFFD. Valid
UTF-8 (a BOM, a literal U+FFFD) is kept exactly. Supplemental `f:` digests already hashed raw bytes. Not covered:
a raw scrub token (`<REPO>`, `<HOME>`, `<ROOT>`, `<REPOKEY>`, `<ROOTKEY>`, `<IMPL>`) in compared text would read like a scrubbed sandbox path, so closed in B3 (ledger "Ruling: park content-scrub aliasing"): the replay refuses it as a problem (`content contains scrub token <T>`) in selected output files, in each event's stdout and stderr, and in the hashed content of every other tree file (the `f:` digests in `changes.txt`). Paths and link targets were already refused. Not checked: blob ids in git-directory summaries (raw committed content, never scrubbed). The stored corpus is unchanged (`diff-impl`: no case trips the check).

`node scripts/diff-impl.mjs` (the B1 gate) runs with `TOKENOMICS_MIGRATIONS=none`. See `corpus/README.md` for the
`write` / `show` / `write-interaction` / `show-interaction` commands.

**Map.** Each migration's specification (reference behaviour, target, change sites, before-cases, declared diff
shape, switchability), the decisions D1–D7, the reference-defect table and the landing order are in
`docs/b2/MIGRATION-MAP.md`; Plan 4 is written from it.

## Plan 3 (`v0.2.1-rc.1`) — B2 entry gate

Plan 3 makes the gates trustworthy enough to land migrations against, and writes the map Plan 4 is built from. No
migration has landed; with `TOKENOMICS_MIGRATIONS` unset or `none` the engine still equals the reference goldens
(`node scripts/diff-impl.mjs` → `differing 0`).

- **Task 1 — portable gates.** The CI matrix is ubuntu/macOS × Node 18.19.0/24 (`.github/workflows/ci.yml`, all five
  gates). A manifest `requires: ["non-root"]` marks the chmod fault cases, and `runCase` refuses them as root. The
  OTel listen probe is bounded. Replayed processes use blocking stdio (`replay/preload.mjs`). This fixed one golden
  that macOS had truncated: `cov-team-report-batches` `__events__/3.stdout`, 65536 → 67931 bytes, the old content a
  strict prefix of the new. CLI tests run mains in child processes, because Node 18's per-file reporter swallowed
  stubbed stdout.
- **Task 2 — coverage gate hardening (P2-08).** Coverage asserts every replay's exits. `branchPointWeight` is
  regex-aware. The engine-only cases are pinned with reasons in `corpus/engine-only.json`, checked both ways.
- **Task 3 — recursive inventory (P2-07).** `scripts/inventory.mjs` scans every engine module recursively. It skips
  the TA extension, the kit and data dirs (`ENGINE_SCAN_SKIP`). It counts occurrences against the allowlist entry's
  `count`, so a second identical copy fails as an overcount.
- **Task 4 — observation boundary (P2-12).** A replay observes `__sandbox__/changes.txt` (every write under the
  sandbox root, `.git` excluded) and every non-empty event stream, which passes through `normalizeDiagnostics`.
  Existing goldens stayed byte-identical; the regeneration only added files. Scope: the sandbox root minus `.git`.
  Writes outside it, modes and mtimes are not observed (`corpus/CASES.md` §"Replay infrastructure").
- **Task 5 — configuration (P2-11).** Nested settings validation, named extension-load failures, and `rootsConflict`
  reporting EISDIR/EACCES (§"Configuration (Plan 3 Task 5)" above).
- **Task 6 — foreign wording (P2-09).** The delivered-outcome note comes from configuration
  (`enrichGroup:delivered-note`). The foreign wording check walks JSON string values recursively, exempting schema
  keys.
- **Task 7 — grain-aware conservation in the kit** (Plan 1 carry-over). Dispatch-grain allocations are checked
  against spec §5.4. A join fixture without `grain` reads as session grain, and every existing fixture result is
  unchanged.
- **Task 8 — migration switch and declared-diff harness.** `TOKENOMICS_MIGRATIONS` covers the eleven §14.8 ids and
  rejects unknown or unlanded ids at `loadSettings`. `scripts/migrations.mjs check` has three modes: `none`,
  `only:<id>` and `default`. The registry has 11 entries (`corpus/migrations/<id>/migration.json`). Vacuous passes
  are rejected: an empty or baseline-equal declaration, a case without `replay.json`, or missing exits
  (§"Migrations (B2)" above).
- **Task 9 — contract and migration map** (`docs/b2/MIGRATION-MAP.md`). Decisions:
  - D1: P2-06, `ratioIntents` is bound to the manifest;
  - D2: P2-10, the public import boundary;
  - D3: the extension API (API 2) is frozen;
  - D4: `writer` + `manifestRevision`;
  - D5: grain evidence;
  - D6: switchability;
  - D7: receipts are not B2.

  The map also has per-migration specs (§2), reference defects (§3), landing order (§4) and owner questions Q1–Q16
  (§5).
- **Task 10 — before-cases.** Nine `before-*` cases pin today's reference behaviour for each B2 migration and
  reference defect, wired into the registry's `beforeCases`. A replay event with `via: "symlink"` spawns the script
  through `<root>/links/<basename>` (`before-entry-symlink`, map §3 R8).

**Codex dispositions P2-06…P2-12** (`docs/reviews/plan-2-codex-review.md`):

| finding | disposition |
|---|---|
| P2-06 `ratioIntents` as mutable settings | decided in the map: **D1** (manifest-bound; implemented with `report-windows` in Plan 4) |
| P2-07 inventory scope and duplicates | **fixed** (Task 3) |
| P2-08 unrestricted engine-only opt-out | **fixed** (Task 2) |
| P2-09 foreign wording | **fixed** (Task 6), except the installer README wording, deferred to **B3** |
| P2-10 exported API defaults | decided in the map: **D2** (public import boundary) |
| P2-11 nested settings validation | **fixed** (Task 5) |
| P2-12 differential observation boundary | **fixed** (Task 4); scope is the sandbox root minus `.git`; `docs/spec.md` §18.2 amended to that scope in Plan 4 Task 2 (owner decision 2026-10-11) |

## Plan 3 patch (`v0.2.1-rc.2`) — Codex review P3-01..P3-12

Findings are in `docs/reviews/plan-3-codex-review.md`. No migration landed; with migrations off the engine still
equals the reference goldens (`node scripts/diff-impl.mjs` → `differing 0`).

- **Task 1 — stage-locked host cache (P3-02), `79821a9`.** The manifest `untracked` list excludes exactly
  `repo/stage-tmp/xcrun_db`; other writes under `repo/stage-tmp/` still appear.
- **Task 2 — observation digests (P3-03), `aa8630d` + `6d7e8d2`.** `changes.txt` lines carry content digests
  (`f:` hashes scrubbed content). Git directories collapse to one entry summarised from read-only plumbing (HEAD
  target, per ref its name, commit count and tip tree); the repository's own commit ids and dates are not included,
  so replays agree given the preconditions in §"Migrations (B2)" (git on `PATH`, unscrubbed committed content,
  detached HEAD, SHA-1, gitlinks; Codex P3P-04).
- **Task 3 — composed declared diffs (P3-01, P3-04, P3-12), `928f6ba` + `a568283`.** The cumulative expectation is
  composed from the declarations. Interaction declarations under `corpus/migrations/_interactions/` name every
  owner of an overridden key. Modes are `none`, `only:<id>`, default (the env var unset) and `all`. `expected/b2` and
  `writeB2` are removed.
- **Task 4 — async stack frames (P3-11), `2f834ad`.** Anonymous `at async <location>` frames are normalised.
- **Task 5 — map corrections (P3-05..P3-10), `fa57d4d` + `5ba6010`.** `docs/b2/MIGRATION-MAP.md` §1.5 adds the
  Obligations table (O1–O10 binding, O11 optional robustness). D1 binds history to its manifest revision with a frozen `B1_DEFAULTS`; D4 and items 9/11
  restamp provenance; item 5 anonymises across rows; R13 and R17 are restated; Q1 splits into required-by-spec
  (items 22–24) and optional (12–21); Q11b is new.
- **Task 6 — close.** This section, the owner sheet, and the pipe-semantics wording in `corpus/CASES.md` and
  `replay/preload.mjs` (pipes are asynchronous on POSIX, synchronous on Windows; comment only).

**Codex dispositions P3-01…P3-12:**

| finding | disposition |
|---|---|
| P3-01 cumulative false passes inside declared paths | **fixed** (Task 3) |
| P3-02 `xcrun_db` host cache | **fixed** (Task 1) |
| P3-03 observation without content | **fixed** (Task 2); `docs/spec.md` §18.2 amended in Plan 4 Task 2; records unambiguous since Plan 4 Task 2 (P3P-02) |
| P3-04 default mode not the unset environment | **fixed** (Task 3) |
| P3-05 unknown counts, reader conflicts, by-role dollars unowned | decided in the map: **§1.5 O1–O3**, slots 22–24 (Q1a) |
| P3-06 historical manifest binding | decided in the map: **D1** historical binding, **O4** (Q11) |
| P3-07 frozen B1 defaults | decided in the map: **D1** (`B1_DEFAULTS`), **O8** |
| P3-08 restamp provenance | decided in the map: **D4**, items 9 and 11, **O7** |
| P3-09 cross-row anonymisation | decided in the map: **item 5**, **O9** (Q9) |
| P3-10 R13/R17 evidence | decided in the map: **R13**, **R17**, **O11** (Q1b) |
| P3-11 async stack frames | **fixed** (Task 4) |
| P3-12 recording exits | fixed (Task 3): `writeB2` removed; `write` records the run's full exit vector and refuses an event-count mismatch |

Owner decisions open at this tag: `docs/reviews/owner-signoff.md`.

## B3 (v0.4.0): install, activation, checkpoint, probe, git fallback

Plan 5 (`docs/plans/plan-5-ledger.md`) delivered the engine-only install path of spec §14.2. The chapter is the
sections below, in order: Activation (states and the gate), the activation flow, Substrate and checkpoint, Probe,
Git fallback. The version source is `tokenomics/ENGINE.json` (`engine`, kept equal to `package.json` `version`); its
`installed` field is `null` in the source checkout and `{target, from, at}` in a copy made by
`node <package>/bin/harness-telemetry.mjs install tokenomics --target <claude|copilot>`. `install tokenomics-port`
exits 2 ("the tokenomics-port skill ships in milestone C1"). The production switch set is `{}` (Q3).

## Activation (B3)

`tokenomics/engine/activation.mjs` (Plan 5 D-ACT, spec §14.2, §18.5, owner Q3). `activationState(engineRoot, repo, env)`
returns `{state, engine, recorded, reason}`; `gateOrExplain(engineRoot, repo, env)` is true for `source` and `active`,
and otherwise writes one stderr line (cause and remedy) and returns false. It never throws: `settings.json` is read
raw, not through `loadSettings`.

| state | when | entries |
|---|---|---|
| `source` | `ENGINE.json` absent, or `installed` null (the source checkout, reference-era copies, the corpus) | run unchanged; `TOKENOMICS_MIGRATIONS` stays the harness lever |
| `active` | an installed copy whose `.agents/tokenomics/settings.json` `engine` equals `ENGINE.json` `engine` (D-REC) | run |
| `inert` | an installed copy with no activation, an activation naming another version (an interrupted upgrade), an unreadable `settings.json`, or a present but unreadable `ENGINE.json` (reason `engine manifest unreadable`, never `source`) | exit 0, read and write nothing, print `tokenomics: inactive — …` |
| `refused` | an installed copy with `TOKENOMICS_MIGRATIONS` set to a non-empty value (empty or whitespace-only is unset, as in `enabledMigrations`; production switch set `{}`) | exit 0, read and write nothing, print `tokenomics: refused — …` |

Gated entries: `hooks/telemetry-capture.mjs` (first thing in `main`, after the repo is resolved), `hooks/scope-hook.mjs`
(after the bounded stdin read that names the repo), `hooks/otel-sink.mjs` (before it listens; the capture hook now
spawns it in the repo, with `CLAUDE_PROJECT_DIR` set), and `scripts/work-scope.mjs` `open`, `outcome`, `close`,
`restamp` (exit 0 when gated; `status`, `show`, `list` only read and are not gated). The engine root is each entry's
realpath, two levels up. Each gate is one call, so a line (the Task 10 probe record) can precede it.

The `entry-points` main guard is read at import, before the gate. `entryPointsOn(engineRoot, env)` returns the landed
guard in a copy that will be refused (installed or unreadable manifest, variable set) without parsing the variable,
so `TOKENOMICS_MIGRATIONS=not-a-migration` is refused with exit 0 instead of throwing at import; in the source checkout
it is `migrationOn('entry-points')`, unchanged.

Every other entry refuses too (ruling R12). In an installed copy `enabledMigrations` (`engine/migrations.mjs`, which
every migration read passes through) throws `tokenomics: refused — TOKENOMICS_MIGRATIONS is set in an installed engine
(production switch set is {}; unset it)` for a non-empty variable. The four gated entries never reach it (the gate
runs first and exits 0); `team-report`, `batch-cost`, `build-tokenomics-export`, `otel-report`, `install-hooks` and
the read-only `work-scope` commands exit 1 with that message before writing anything. The source checkout
(`installed: null`) is unaffected. `enabledMigrations` and `isInstalledCopy` fail closed: only an absent `ENGINE.json`
(ENOENT) reads as a source checkout; any other read or parse failure, or a non-object, is an installed copy (Codex
B3-06), so `TOKENOMICS_MIGRATIONS=none` cannot reopen the reference-era path through a damaged manifest.

**Report CLIs are gated (ruling R19, Codex B3-05).** `gateCli(engineRoot, repo, {writes}, env)` (`activation.mjs`)
runs in each report CLI's `main` before the settings load and before the first write. A `refused` copy is always
refused; an `inert` copy is refused only when the run writes. Refusal is exit 1 with the one-line reason and nothing
written (unlike the hooks, which exit 0). `batch-cost` writes unless `--stdout`; `build-tokenomics-export` writes in
every mode except `--compare`; `team-report` writes with `--batch` or `--out`; `otel-report` never writes, so only the
switch refusal applies to it. The source checkout is never gated. This supersedes the review round's earlier note that an
inert copy's report CLIs are not gated.

### The activation flow (Plan 5 Task 7)

`scripts/install-hooks.mjs --host <claude|copilot-cli|vscode>` (spec §14.2 step 2; `copilot` = `copilot-cli`). The
steps run in order. Each step's failure stops the run with exit 1 and the activation record unwritten, so every
gated entry stays `inert`. A usage error exits 2. In an installed copy, `TOKENOMICS_MIGRATIONS` set refuses
activation (exit 1, the `refused` line).

| step | what | module | on failure |
|---|---|---|---|
| 1 | `--host` parsed; missing or unknown → usage listing the targets | `install-hooks.mjs` | exit 2, nothing written |
| 2 | `settings.json` loaded or created (an existing file's merge is held in memory and written after step 4, so the checkpoint holds its original bytes). Fresh: `{engine: null, dir: <--dir, else the store's one ledger-holding module dir (automation preferred among several; several without it → exit 2), else "tokenomics"; an empty store directory is read from its history: `telemetry`, `origin/telemetry` or the checkout HEAD, fix 1b> (ruling R13), extension: null, substrate: {required: null, form}, enforcement: {announce: true, stopGate: "off"}, targets: [], receipts: <TA defaults>}`. Existing: only absent `enforcement` keys here | `loadOrCreateSettings` | invalid JSON / `--dir` conflict |
| 3 | substrate created or verified; `substrate.form` recorded | `engine/substrate.mjs` `ensureSubstrate` | `SubstrateError` (`no-git`, `submodule-failed`, `submodule-required`, `submodule-registered`); a staged `rm --cached` migration is undone |
| 4 | checkpoint `pre-engine-<engine>` over the store, `.agents/tokenomics/**` and the planned host files (`plannedWrappers`); submodule form: the gitlink is re-staged after a new checkpoint commit. Then the flat-layout migration and `config.json` seed | `engine/checkpoint.mjs` `takeCheckpoint` | `CheckpointError` |
| 5 | `module.json` + `manifests/1.json` written once; a mismatch with settings is reported, never rewritten (`--update-manifest` → N+1) | `engine/module-manifest.mjs` `ensureModuleManifest` | `ModuleManifestError` |
| 6 | host hooks wired to the running copy; Stop / agentStop only with `enforcement.stopGate === "on"` | `installClaude`, `installCopilot`, `installVsCode` | write error |
| 7 | ignore lines. An existing store's inner `.gitignore` also gets the `WORKING_STATE` patterns appended if missing (idempotent, R26), committed with the activation store commit | `installGitignore` | write error |
| 8 | `--git-hook` (optional, additive): the post-commit fallback, see "Git fallback (B3)" | `installGitHook` | a refusal stops activation, unrecorded |
| 9 | `engine` and `targets` recorded, last (D-REC). Then one local store commit `tokenomics: activate <version>` of `<dir>/module.json`, `manifests/` and `config.json` (`commitActivationFiles`: telemetry branch only, fallback identity, never pushed, pointer re-staged), so the store reads clean | `install-hooks.mjs` | — |

A re-run on an active repo (same engine, host already in `targets`) reuses the checkpoint (no commit, no tag moved),
wires no duplicate, and reports `already active` only when it wrote nothing; if it had to write (a missing hook, a store
file) the line is `activated ... (was active; this run updated: ...)`. With `--git-hook`, an existing
`post-commit.pre-tokenomics` is refused (`backup-exists`) before step 2, so nothing is written (`gitHookBlocked`). After an upgrade copy, the next activation takes
`pre-engine-<new>`, records it, and the next sweep captures the sessions the inert copy left in the host store.
`--remove` takes one `--host` or none (every host). B3 tests the installer directly (`install-hooks.test.mjs`,
hermetic, spawned from an installed copy); its coverage exclusion (row 1) stays whole-file.

## Probe (B3, Plan 5 Task 10)

`node <skill>/scripts/doctor.mjs --probe [--repo <dir>] [--host h] [--timeout s] [--keep-state] [--json] [--strict]`
(`tokenomics/engine/probe.mjs`, `runProbe`; spec §14.9, D-PROBE). It runs one isolated probe session per host: each
host in `settings.targets`, or the one named by `--host` (`copilot` = `copilot-cli`). A host whose CLI is not found is
reported `unavailable`; it is never skipped silently. `vscode` is always reported as
`unavailable: no hooks; verify with a real sidebar session and a sweep (C2)`.

### Transport

| what | value | default / note |
|---|---|---|
| `TOKENOMICS_PROBE` | a 32-hex nonce, set by the probe in its child's environment only | Unset by default. A malformed value is ignored. When it is set, `doctor --probe` exits 2 ("a probe never triggers another probe") and `runProbe` throws |
| `TOKENOMICS_STATE_DIR` | a fresh `mkdtemp` directory (`tokenomics-probe-*` under the OS temp dir) | Unset or empty: `telemetryDir` is `<repo>/.agents/telemetry/<dir>`, unchanged (diff-impl differing 0). Set: `<state>/telemetry/<dir>`, so the ledger, scopes, claims and markers all land there |
| `TOKENOMICS_NO_SYNC`, `TOKENOMICS_NO_CCUSAGE`, `TOKENOMICS_NO_SINK` | `1` in the probe child | Sync, metering and the OTel sink are off for a probe session |
| `TOKENOMICS_PROBE_CLAUDE_BIN`, `TOKENOMICS_PROBE_COPILOT_BIN` | a CLI path that replaces the PATH lookup; a `.mjs` or `.js` path runs under the probe's node | Unset: the first executable `claude` or `copilot` on `PATH`. A set path that does not exist gives `unavailable: <cli> CLI not found` |
| fired log | `<state>/probe/<nonce>.jsonl`, one `{"event", "entry", "host", "session", "at"}` line per hook run | `event` is the host's own event name from the hook payload (Claude's `hook_event_name`); when the payload names none (the Copilot CLI), the `TOKENOMICS_HOOK_EVENT` that `installCopilot` writes into each command's `env` (R25); else null. `entry` is the entry and its mode (`telemetry-capture --sweep`, `scope-hook --announce`, …). `session` is the payload's session id (`session_id` or `sessionId`), or null. `host` is `claude`, `copilot` or null |
| state seed | the repo's `module.json`, `manifests/` and `config.json`, copied (read only) into `<state>/telemetry/<dir>/` | The probe line is stamped and configured as a real one would be |
| host commands | `claude -p <prompt> --model haiku`; `copilot -p <prompt>` | The prompt names the nonce, asks for `work-scope open … --intent probe`, and asks for exactly one sub-agent dispatch |
| bound | `--timeout <s>` | 120 s. The child runs in its own process group, which is killed (SIGKILL) at the bound. After a normal exit the probe waits at most 3 s for async hooks (until the fired log has been quiet for 300 ms), then kills the group |
| state dir lifetime | removed after the probe | `--keep-state` keeps it and reports it as `stateDir` |

The fired record is the first work of `main` in `hooks/telemetry-capture.mjs` and `hooks/scope-hook.mjs`, after
only the stdin read it needs for the event name and session id: scope-hook reads its stdin there anyway, and
telemetry-capture, inside a probe only, reads it up front (bounded, 2 s) and serves every later read from that text. It
comes before the activation gate, so an inert hook still proves it fired, and the probe then quotes the inert line.

**The probe session is never captured outside a probe** (final review I3, R17). The host writes its transcript where
it always does (`~/.claude/projects/<repo>/…`, Copilot's `session-state/<id>`), so a later ordinary sweep of the repo
would find it. The capture (`captureClaudeSession`, `captureCopilotSession`) therefore writes no line for a session
whose first user prompt matches `PROBE_PROMPT_RE` (`^tokenomics hook probe <32 hex>`, exported by `probe.mjs`),
unless `TOKENOMICS_PROBE` is set, which is the probe's own capture into its state dir. No corpus transcript carries
the prefix, so diff-impl stays at 0.
`otel-sink.mjs` is a listener, not a host hook, and records nothing.

### Result

`runProbe(repo, {host, timeoutMs, env, keepState})` returns
`{host, result, reason?, events, expected, mode, durationMs?, stateDir?}`.

- `events` lists every event in the **wired** config, each `fired`, `not-fired` or `unattributed`. For Claude that
  is the marked entries of `.claude/settings.json` and `settings.local.json`; for Copilot,
  `.github/hooks/tokenomics.json`.
  - Stop and agentStop appear only when the gate is wired.
  - Attribution (R21, Codex B3-04): a record that names its event proves that event, when it ran one of the event's
    entries. A record with `event: null` proves an event only through an entry no other wired event runs. An entry
    two events share (Copilot's sweep runs at both sessionStart and sessionEnd) leaves an event proven by nothing
    else `unattributed`, never `fired`: records are never counted out to events. The Copilot CLI names no event in
    its payload, so `installCopilot` puts `TOKENOMICS_HOOK_EVENT=<event>` beside `COPILOT_CLI=1` in every command's
    `env` (R25) and each record is named. Only a wiring older than that reads its sessionEnd `unattributed` (re-run
    the Activate command).
- The expected result is the **probe session's own** line (R22, Codex B3-03). Its id comes from the fired records'
  `session`; when no payload carried one, from the state-ledger session whose host transcript opens with
  `tokenomics hook probe <nonce>`. Host and time are never enough: an unrelated session the probe's sweeps captured
  into the state dir is never its expected result. `expected.ledgerLine` is `present` when the state ledger holds a
  line of the host with that id; `expected.scopeStamp` is `present` when that line's `scope` has intent `probe`.
- `result`:
  - `fired` only when every wired event fired, both expectations are present, and the wired copy is `active` (or
    `source`);
  - `unavailable` with the reason `<cli> CLI not found`, `auth` (a non-zero exit naming a login or credential failure),
    `folder not trusted`, or the `vscode` line;
  - otherwise `not-fired`, with a reason naming the timeout, the inert line, the events that did not fire and the
    missing expectation.
- `mode` is `sweep-only (partial)` when all four hold; otherwise it is `hooks`:
  - the host session ended normally: exit 0, within the bound. A timeout or a failed host never falls back, and its
    reason keeps the timeout;
  - no wired session-end event fired (SessionEnd and Stop for Claude; sessionEnd and agentStop for Copilot);
  - a `post-commit` hook carrying the tokenomics marker is installed;
  - the probe's own sweep after the session (`telemetry-capture.mjs --sweep --ended`, with the nonce still set, so
    the probe session is not skipped; its fired record is never read) produces the probe session's line, matched by
    the same identity. `--ended` drops the live-grace skip of a freshly written transcript, because the caller knows the session is
    over. The sweep is bounded by the time left of `--timeout` (SIGKILL), and is skipped when less than 0.5 s is left.

  A partial reason also names any other event that did not fire and a missing scope stamp. A timed-out probe is never
  `fired`, even if every hook fired before the hang.

`doctor --probe` maps `fired` to ok, partial and `unavailable` to warn, and `not-fired` to fail. It exits 1 on a fail
(and on a warn with `--strict`) and 2 on a usage error. The tests (`engine/probe.test.mjs`) use the fake hosts under
`fixtures/probe/`, which are outside the baseline, on a PATH that holds no real host binary.

## Substrate and checkpoint (B3, Plan 5 Tasks 5 and 6)

### Substrate (`engine/substrate.mjs`, D-SUB)

`ensureSubstrate(repo, settings, {plainFolder, env, seed})` returns `{form, created}`; `verifySubstrate` returns
`{ok, form, problems}`, each problem naming its fix. Verification is four checks, all through git: `.gitmodules`
`url = ./`, `branch = telemetry` and `ignore = all`; the submodule is materialised (`submodule status` does not start
with `-`); the checkout is on `telemetry` (a detached HEAD that is an ancestor of `telemetry` or `origin/telemetry`
passes, the state of a fresh clone).

- An existing checkout is verified, never recreated or rewritten. A registered but unmaterialised one gets
  `submodule update --init`.
- Plain folder is never chosen silently. If the submodule cannot be made, activation fails with `submodule-failed`
  and a remedy naming `--plain-folder`; with `--plain-folder` it records `substrate: {"form": "plain-folder"}`. With
  `substrate.required === "submodule"` it fails with `submodule-required`, also under `--plain-folder` and for a
  recorded plain folder.
- `--plain-folder` over a registered or materialised submodule throws `submodule-registered` (ruling R8): repair or
  deregister first.
- No git repository fails with `no-git`. The submodule is created from the repo path, so an unreachable `origin`
  cannot fail it (Task 11).
- **Clone without `--recurse-submodules` (Codex B3-07).** `attachBranch()` runs on a detached store checkout with no
  local `telemetry` branch: on `origin/telemetry`'s history it creates `telemetry` tracking it; ahead of it, it creates
  the branch at HEAD with that upstream; then it checks it out (a fast-forward, never a rewind). An existing local
  branch, a missing `origin/telemetry` or a diverged HEAD are left for verification to judge.
- **Interim telemetry (Codex B3-02).** `mergeInterim()` restores the stash file by file: absent from the checkout →
  moved in; identical, or the checkout copy already holds every byte → stash copy dropped; the stash copy extends the
  checkout copy (an appended ledger) → replaces it; anything else is a conflict that stays in the stash. The run throws
  `interim-conflict` naming each path, and `verifySubstrate` reports a stranded file as a problem; a re-run merges again
  and refuses while a conflict remains. A leftover stash beside a non-empty store directory is refused up front.
- **Rollback (Codex B3-08, T11-2).** Before a conversion changes anything, the index entries of `.gitmodules` and
  `.agents/telemetry` (every stage) and the `.gitmodules` bytes are saved; on failure they are restored exactly
  (`update-index --force-remove` and `--index-info`), never reset to HEAD. If this run had started `submodule add`, the
  half-made checkout and the `.git/config` section are removed too. A partial `.git/modules` leftover after a failure
  past that point stays parked to B5 (T5-2).

### Checkpoint (`engine/checkpoint.mjs`, D-CKPT)

`takeCheckpoint(repo, settings, {version, form, wrappers, env})` returns `{tag, commit, bundle, reused, copied}`.

- **Store.** `durableFiles()` walks `.agents/telemetry/` and commits every durable file, except `WORKING_STATE`
  (`substrate.mjs`, also the source of `INNER_GITIGNORE`): the `.pending-*`, `.nagged-*` and `.unclosed-*` markers and
  `<module>/live/**`; in the submodule form it also drops untracked paths the store's own ignore rules exclude
  (`ls-files --others --ignored --exclude-standard`). A path tracked in the parent commit is always kept (final review
  I1). In a reference-era store without the seeded `.gitignore`, activation appends the working-state lines (R26),
  since the next sync's `add -A` would otherwise commit them. Blobs use exact bytes (`--no-filters`); the tree
  is built in a temporary index, so neither the operator's index nor the main working tree is touched. Submodule form:
  `refs/heads/telemetry` in the submodule. Plain-folder form: the orphan ref `refs/tokenomics/store`, chained across
  versions.
- **Main tree.** `.agents/telemetry/.checkpoints/pre-engine-<version>/checkpoint.json` holds
  `{version, at, mainTreeCommit, copied, localCopies}`. Scope: `.agents/tokenomics/**` and each planned host wrapper. A file whose
  HEAD, index and working copy agree is named by `mainTreeCommit`; every other (uncommitted, staged-only, untracked)
  is copied under `main-tree/<path>` in the same commit, **except** a file the main repository ignores
  (`check-ignore --no-index`) or that is named `*.local.json` (R18, final review I2): it is copied to
  `<git-common-dir>/tokenomics/pre-engine-<version>/main-tree/` and recorded in `localCopies`, never put on the shared
  branch. `takeCheckpoint` returns `localCopies` also on reuse; a failed checkpoint removes the copies it wrote;
  activation prints one line naming them.
- **Tag and bundle.** The commit is tagged `pre-engine-<version>` (created, never moved). The bundle is written to
  `$(git rev-parse --git-common-dir)/tokenomics/pre-engine-<version>.bundle` through a `.partial` file, checked with
  `git bundle verify` and `list-heads` (it must list the tag at the commit), then renamed into place.
- **Re-run.** An existing tag is reused (`reused: true`, no new commit) only when its bundle exists and verifies and
  `<tag>:.checkpoints/<tag>/checkpoint.json` exists; otherwise `checkpoint-foreign-tag`. A failure before the branch
  moves removes the record directory (or `.checkpoints/`) if this call created it (M11). The git plumbing `run` strips
  the inherited `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_PREFIX`, `GIT_OBJECT_DIRECTORY`,
  `GIT_ALTERNATE_OBJECT_DIRECTORIES` and `GIT_NAMESPACE`. The store's mixed reset supersedes staged-only store content.
- **Refusals** (`CheckpointError`, no tag created): `checkpoint-no-git`, `checkpoint-no-store`,
  `checkpoint-bad-form`, `checkpoint-foreign-tag`, `checkpoint-bad-version`, `checkpoint-bad-wrapper`, `checkpoint-bundle-missing` (tag, no
  bundle), `checkpoint-bundle-invalid`, `checkpoint-unverified`, `checkpoint-failed`, and
  `checkpoint-bundle-orphaned`: the bundle exists but its tag is gone, so it may be the last copy of a checkpoint
  (ruling R9). Nothing is written; the remedy is to restore the tag from the bundle or move the bundle aside.
- **Offline.** Local plumbing only: no fetch, no push.

## Git fallback (B3, Plan 5 Task 8)

`install-hooks.mjs --git-hook` (D-GIT; with `--host` it is step 8 of activation, alone it adds only the hook, and
`--git-hook --remove` takes it out).

- The hooks directory is `git rev-parse --git-path hooks`, run in the repo, so `core.hooksPath` and linked worktrees
  are honoured.
- A foreign `post-commit` is renamed to `post-commit.pre-tokenomics` (bytes and mode kept). Ours runs it first, only
  when executable, keeps its exit status as the hook's, then starts `telemetry-capture.mjs --sweep` detached with all
  stdio redirected, so it never delays or fails a commit. Installation refuses if `.pre-tokenomics` already exists.
- The hook unsets git's hook environment (`GIT_INDEX_FILE`, `GIT_DIR`, …) before the sweep, so the sweep cannot commit
  onto the user's worktree branch.
- The hook script holds no repository path (R23, Codex B3-09). After unsetting the git environment it takes the
  committing checkout from `git rev-parse --show-toplevel` and picks `.claude/skills/tokenomics` or
  `.github/skills/tokenomics`, preferring the copy whose `ENGINE.json` `engine` equals the checkout's activation record,
  else the first present. A linked worktree with no copy falls back to the primary worktree's; with no copy anywhere a
  line goes to `<git-dir>/tokenomics-post-commit.log`. A shared hooks directory therefore serves every worktree, and a
  moved repo needs no reinstall. `--remove` restores the original byte for byte.
- The engine is read from `ENGINE.json` with `sed` (no node or jq at hook time); a nested `"engine"` key on the same
  line of the activation record would confuse it, and the capture hook's own gate still decides whether the chosen copy
  may run.
- Limitation (spec §14.9): a session that ends after the last commit is captured only by a later sweep. The probe
  reports a run saved only by this sweep as `sweep-only (partial)`.

## Install copy and doctor (B3 fix wave)

- **Copy** (`engine/install-copy.mjs`, final review M6/M7/T3-x): the upgrade swap uses dot-prefixed siblings
  (`.tokenomics.tmp-<pid>`, `.tokenomics.old-<pid>`); stale ones are cleared at the start; a failed final removal does
  not fail the install. `.DS_Store` is ignored by the comparison, as in doctor. `--force` replaces any destination
  directory, including one that is not an engine copy. `--repo` with no value exits 2; any other non-install error is one
  line and exit 1.
- **Doctor** (`scripts/doctor.mjs`): a whitespace-only `TOKENOMICS_MIGRATIONS` counts as unset (M1); with the variable
  set, settings are judged as if it were not, so `substrate`, `targets` and `claims` still report and only `activation`
  and `switches` fail (M2); `--fix` starts the otel sink with the repo (M3); a listed file that cannot be hashed (a
  dangling link) is `<path>: unreadable (dangling link)` and the remaining files and copies are checked (Codex B3-11);
  `enforcement` and `substrate` are deep-merged over the defaults (T9-6).
- **Probe** is described in "Probe" above: R17 (the probe session is never captured), R21/R25 (event names, Copilot's
  `TOKENOMICS_HOOK_EVENT`), R22 (session identity).
