# B2 contract and migration map

Plan 4 (the eleven spec §14.8 behaviour migrations, the spec-required items 22–24 and the three grouped robustness
migrations for items 12–21; owner Q1) is written from this document. It records this
plan's rulings (§1), lists every spec-required outcome with its owner (§1.5), specifies each migration against the reference and the corpus (§2), assigns every
known reference defect (§3), fixes the landing order (§4) and records the owner's decisions (§5). The map is frozen
to those decisions (Plan 4 Task 3): every choice below is decided.

Conventions:

- A "today" claim cites the reference as `reference/49577c7/<file>:<line>`, the engine copy as
  `tokenomics/<file>:<line>` (B1 extraction, byte-identical behaviour with `TOKENOMICS_MIGRATIONS=none`),
  and the corpus case that pins it.
- A "target" claim cites the spec section in `docs/spec.md` (v4.2).
- Every before-case named in §2 "Before-cases" and the §3 table exists in `corpus/cases/` (Plan 3 Task 10
  added the nine `before-*` cases and replaced the markers this map used for them; `corpus/migrations.test.mjs`
  asserts no marker remains and every named case exists). Where Task 10's reference run differed from
  this map's scenario, the text below was corrected and the change is recorded in `corpus/CASES.md`.
- "Declared diff shape" is the prediction that `node scripts/migrations.mjs write <id> <case>` output is
  reviewed against. Paths are relative to the case's sandbox repo; `__events__/<i>.stdout|stderr` are the
  captured streams; `__sandbox__/changes.txt` is the out-of-root write list (Plan 3 Task 4). A migration
  that changes a stream or an out-of-root write declares that file too. As landed (Codex fix wave F1): those
  two roots are reserved — no case may select an output under them (B2-02) — and every observed file and
  stream must be valid UTF-8 (B2-03); a scrub collision or literal scrub token in a sandbox path is refused
  (B2-01). See `tokenomics/ENGINE-B1.md` §"Migrations (B2)".
- The harness's `default` (unset) and `all` modes compare every case with the composition of the landed
  migrations' declarations (plus an interaction declaration under `corpus/migrations/_interactions/` where
  two of them overlap), else its baseline. A migration therefore declares **every** corpus case whose
  output it changes, not only its anchor before-case. Where that set is large, the subsection lists it.
- There are no recorded cumulative goldens. A declared after-file is relative to the **baseline** (the case
  as if only that migration had landed, `only:<id>`), so two migrations that change one output path (or one
  event's exit) of a case conflict in `default`/`all` until
  `corpus/migrations/_interactions/<case>/interaction.json` resolves it. Recorded with
  `node scripts/migrations.mjs write-interaction <case>`, it names **every** migration that declares an overridden
  key, and at least one named migration declares the case. Wherever this map predicts a combined effect
  (two migrations on one ledger file, `cost.json` or report; or a path that only appears when two migrations
  are both on, such as `entry-points` (item 12 `entry-guard`) + `writer` on `before-entry-symlink`), that case needs an
  interaction declaration. §4 "Interaction declarations" lists the ones known today. The modes are `none`,
  `only:<id>`, `default` (`TOKENOMICS_MIGRATIONS` genuinely unset) and `all` (the explicit landed list).
- §1.5 "Obligations" lists every spec-required outcome this map must give a home, with its owner. No option
  in §2 or §5 may leave a required row unmet. "Keep the reference behaviour" is never an option for one.

---

## 1. Decisions

The seven rulings below are made by this plan. Each is quoted verbatim, then reasoned, then mapped to
the files it affects.

### D1 (P2-06), ratioIntents is manifest-bound.

- Ruling: from migration `report-windows` (item 8) on, the engine reads `ratioIntents` from the telemetry directory's `module.json` revision the line was written under. Without a `module.json`, it reads the kit's implied TA manifest (`ratioIntents: ['automation']`).
- `settings.ratioIntents` is honoured only with `TOKENOMICS_MIGRATIONS` excluding `report-windows`, and is removed from `TA_DEFAULTS` when B2 closes.
- Why: spec §14.4 says "The ratio key is only `ratioIntents` in `module.json`".
- Cost if wrong: one settings key restored.

**Reasoning.** Codex P2-06 (`docs/reviews/plan-2-codex-review.md:22`) found that Plan 2 put
`ratioIntents` in mutable executable settings (`tokenomics/engine/config.mjs:21`, validated at
`tokenomics/engine/config.mjs:49`, consumed at `tokenomics/scripts/team-report.mjs:234`). Spec §3.1
makes `ratioIntents` part of the durable reading manifest, and §14.4 says every record is interpreted
by **its** revision: a ratio computed from current settings would reinterpret history whenever the
setting changed. Today's B1 behaviour is preserved bit-for-bit because the implied manifest's ratio
intents equal `TA_DEFAULTS.ratioIntents` (`tokenomics/kit/load.mjs:4-8`). Binding the key at
`report-windows` (not earlier) puts the change in the one migration that rewrites the ratio (§5.5), so
its declared diff carries the whole semantic change once. Nothing writes `module.json` in B2 (D4), so in
the B2 corpus every ratio reads the implied manifest unless a case ships a `module.json` input (see
`before-ratio-manifest`, §2 item 8).

**Reading rule (historical binding; Codex P3-06, Obligation O4).** A line is interpreted by the revision it
was written under, never by whichever manifest is current:
- A line **without** `manifestRevision` (every reference-era and B1-era line, and every line written before
  `writer` lands) binds to the **implied legacy manifest**: revision 1, the kit's `IMPLIED_MANIFEST`
  (`tokenomics/kit/load.mjs:4-8`; spec §7.1), TA `ratioIntents: ['automation']`, and the legacy receipt policy
  (`files` receipts under `.agents/automation`, the TA delivered outcomes, and file mtime as the `revision` of a
  reference-era `files` receipt; §5.2 allows mtime "only in reference mode", and treating the implied-legacy binding
  as reference mode for this purpose is decided, Q10c). It never binds to the current
  `module.json` or to `manifests/1.json`, so editing or advancing `module.json` cannot change a historical line's
  eligible intents.
- A line **with** `manifestRevision: N` binds to `<dir>/manifests/N.json`. The one exception is N = 1 when the
  telemetry directory has neither `module.json` nor `manifests/`: that is the implied manifest, which `writer`
  stamps as revision 1 (D4).
- A line with an **explicit `manifestRevision: null`** is a `writer` line stamped while `module.json` was present but
  unusable (unparseable, not an object, or without an integer `manifestRevision` ≥ 1; D4). It is fresh, so it never
  binds to the implied legacy manifest: it is unverified, with the finding `manifest-revision-unknown`, excluded from the
  eligible sessions and counted in `unverified` like a missing archive (Plan 4 Task 14 review round 1, I1). Only an
  **absent** key means revisionless.
- Edge case: `writer` stamps N from `module.json`, but the N = 1 exception needs **no** `module.json`. So a
  telemetry directory with `module.json` (revision N) and no `manifests/N.json` reads every freshly written line
  as unverified. B3's `install-hooks` writes both, so a real install never has this. Until then, every Plan 4
  corpus case with a `module.json` input whose lines carry (or will receive) `manifestRevision` must also ship
  `<dir>/manifests/<N>.json`, byte-identical to it. `before-ratio-manifest`'s lines are revisionless and need
  none; `before-ratio-revisions` ships its archives. Whether the engine should treat a current `module.json`
  whose content equals its own revision as that revision's archive is decided (Q11b): it does not; the strict rule
  applies, and Plan 4 cases with a `module.json` ship `manifests/<N>.json`. **As landed (B3, Plan 5 Task 7):**
  `install-hooks` writes `module.json` and `manifests/1.json` (the same bytes) on a fresh activation
  (`engine/module-manifest.mjs`). A `module.json` without its archive gets the archive. `--update-manifest` writes
  `manifests/<N+1>.json` and then `module.json`.
- **Decided (Q11b).** A line naming a revision whose archive `<dir>/manifests/N.json` is
  missing is read as **unverified**. This is the map's design choice: spec §14.4 only says archives are
  retained forever, not how a reader treats a missing one. Under this rule the report
  states it, the kit reports a finding naming the line and the revision, and its spend is excluded from
  the ratio's eligible sessions rather than reinterpreted under another revision. The current `module.json` is
  not substituted, even if it declares `manifestRevision: N`. In a real install the missing archive is an
  installer defect that B3's `install-hooks` prevents (§14.4 "retained forever", which does not itself dictate
  the unverified reading). **As landed (B3, Plan 5 Task 7):** an existing revision is never rewritten. A difference
  from settings is reported and left for `--update-manifest`. Archives without a `module.json`, or an unreadable or
  schema-invalid `module.json`, stop activation (`ModuleManifestError`).
- Delivered outcomes and the receipt source policy follow the same binding (§14.4 "readers interpret each record
  by **its** revision") for a record that carries a `manifestRevision`. **Receipts without one (controller ruling,
  Task 11 review round 1, I1):** a receipt with no `manifestRevision` reads its delivered outcomes from the receipt
  policy that discovered it, `settings.receipts` (root + `deliveredOutcomes`), the same policy discovery and the
  group cost already use. Why: spec §5.1 receipts never carry a revision, so reading them by the implied TA manifest
  would zero every non-TA port's denominator forever (and contradict its own group cost); and Q10c already classes a
  revisionless receipt as reference-era. TA history is unchanged (`TA_DEFAULTS.receipts` equals the implied
  manifest's policy). `ratioIntents` stays manifest-bound per line (above).

**B1 defaults behind `none` (Codex P3-07, Obligation O8).** The migrations-off path keeps a frozen
`B1_DEFAULTS` in `tokenomics/engine/config.mjs`: today's `TA_DEFAULTS` literal, **including**
`ratioIntents: ['automation']`, and today's `validateSettings` rules for it. Whenever `report-windows` is not
enabled (`none`, or any `only:<id>` other than it), settings merge over and validate against `B1_DEFAULTS`, and
`buildReport` reads `settings.ratioIntents` exactly as today (`tokenomics/scripts/team-report.mjs:234`). When B2
closes, `ratioIntents` is removed only from the B2 executable-settings contract (`TA_DEFAULTS` and the B2
validator), never from `B1_DEFAULTS`. So removing it cannot change `none` output, and a minimally configured
foreign `settings.json` (no `ratioIntents`) is still accepted under `none`: the frozen default supplies it. The
`none` differential (`node scripts/diff-impl.mjs`, `differing 0`) must stay green **after** the B2 cleanup, not
only between migrations. The B4 rescue release's writer half is this path; B4 pairs it with the `mixed` reader (§18.5 "the B1 extraction
build plus the `mixed` reader"; O10). `none` alone is not the rescue release.

**Files.** `tokenomics/scripts/team-report.mjs` (`buildReport`, `main`), `tokenomics/engine/config.mjs`
(`TA_DEFAULTS`, a new frozen `B1_DEFAULTS`, `validateSettings`), a new manifest reader under `tokenomics/engine/` that imports
`IMPLIED_MANIFEST` from `tokenomics/kit/load.mjs`, `tokenomics/hooks/scope-hook.mjs`
(`suggestedIntents`, ENGINE-B1.md "ratioIntents (9 sites)"), `corpus/cases/foreign-settings` (its
`settings.json` carries `ratioIntents`; see §2 item 8 interactions).

### D2 (P2-10), the public import boundary.

- Ruling: the engine's supported API is its CLI entry points, plus the extension API, plus the kit. Helpers exported from `tokenomics/hooks/*` and `tokenomics/scripts/*` are engine-internal, and no reference-compatible facade is provided.
- ENGINE-B1.md stops claiming direct imports behave like the reference. B5 revisits this if sdlc-skills needs a module API.
- Cost if wrong: B5 adds a facade.

**Reasoning.** Codex P2-10 (`docs/reviews/plan-2-codex-review.md:26`) showed that an exported helper
called the way a reference consumer called it silently drops TA behaviour, e.g. `deriveLabel` with no
extension (`tokenomics/hooks/telemetry-capture.mjs:588-593` versus
`reference/49577c7/hooks/telemetry-capture.mjs:614-621`). The trailing `settings = loadSettings(repo)` /
`ext = null` defaults exist for the copied unit tests, not as a compatibility contract. The spec defines
the engine through its commands (§14.2, §14.11) and its extension interface (§14.3); nothing in §14
promises a module API. Declaring the helpers internal costs nothing now and keeps every Plan 4 migration
free to change helper signatures. The differential harness already exercises only CLI entry points
(§18.2). sdlc-skills consumes the engine as an installed skill (§14.1, D4 of §13), so B5 is the first
milestone that could need a module API.

**Files.** `tokenomics/ENGINE-B1.md` (Task 9 corrects the two sentences and adds the boundary). No code
change.

### D3, freeze the extension API.

- Ruling: `EXTENSION_API` becomes 2 in the last Plan 4 task, after every migration has landed.
- API 2 is the exact `HOOK_CALLS` list at that point, plus for each call: its `part` values, its `input` shape, its `ctx` fields and its return contract. All hooks are synchronous; a hook returning a Promise is an error.
- The map lists today's calls with these four columns, and marks which migration (if any) changes each one.
- C1 targets API 2. Cost if wrong: an API 3 bump.

**Reasoning.** Codex (§2 "Contract interpretation", `docs/reviews/plan-2-codex-review.md:175`) noted that
seven names plus about three dozen phase/part combinations is the real API, and that the `name:phase`
trace (`tokenomics/engine/extension.mjs:62-69`) checks executed calls, not parts, argument shapes or
return contracts. `EXTENSION_API = 1` is marked provisional (`tokenomics/engine/extension.mjs:12-13`,
ENGINE-B1.md "Extension API"). Several migrations change what a hook receives (the table below), so the
freeze can only follow the last migration. Today every call site reads the result synchronously through
`hook(ext, ...) ?? default` (`tokenomics/engine/extension.mjs:59-69`); a Promise would be spread or
concatenated as an object, so rejecting thenables in `hook()` turns a silent corruption into a named
error.

**Today's calls (API 1).** Call sites are engine lines. "spread" = the result is spread into the output
object at that position; `?? d` = `undefined`/`null` falls back to the engine default `d`.

| call | `part` values | `input` | `ctx` fields (besides `phase`) | return contract | changed by |
|---|---|---|---|---|---|
| `classifyDispatch` | — | dispatch label (string) | `repo`, `settings` (`tokenomics/scripts/batch-cost.mjs:342`, `:144`) | `'direct'` or an overhead stage name; `?? 'direct'` | — |
| `classifyDispatch:stage-names` | — | `null` | `repo`, `settings`, `acc`, `addTo`, `emptyBucket` (`tokenomics/scripts/batch-cost.mjs:435`); `settings` only (`tokenomics/scripts/team-report.mjs:413`) | `string[]`; `?? []` | — |
| `classifyDispatch:case-init` | — | `null` | `repo`, `settings`, `acc`, `addTo`, `emptyBucket` (`tokenomics/scripts/batch-cost.mjs:253`) | object spread into a new case bucket; `?? {}` | — |
| `classifyDispatch:direct` | — | dispatch label | `acc`, `addTo`, `emptyBucket`, `repo`, `settings`, `m` (measured quantities), `w` (weight), `share` (per-id share), `rows` (matched case buckets) (`tokenomics/scripts/batch-cost.mjs:347`) | ignored; side effects on `ctx.acc` / `ctx.rows` | `shared-allocation` (`w`, `share` values), `copilot-inclusive` (`m.tokens` of inclusive lines), `active-minutes` (`m.activeMin`) |
| `classifyDispatch:overhead` | — | dispatch label | as `case-init` plus `m`, `w` (`tokenomics/scripts/batch-cost.mjs:350`) | ignored; side effects on `ctx.acc` | `shared-allocation`, `copilot-inclusive`, `active-minutes` (as above) |
| `classifyDispatch:case-out` | — | case bucket | as `case-init` (`tokenomics/scripts/batch-cost.mjs:364`) | object spread into the case's `direct` row; `?? {}` | — |
| `classifyDispatch:overhead-out` | — | `null` | as `case-init` plus `bucketOut` (`tokenomics/scripts/batch-cost.mjs:440`) | object spread at the end of `cost.overhead`; `?? {}` | `active-minutes` (`bucketOut(...).activeMin`) |
| `classifyDispatch:group-out` | — | `null` | as `overhead-out` (`tokenomics/scripts/batch-cost.mjs:442`) | object spread after `cost.overhead`; `?? {}` | `active-minutes` (as above) |
| `classifyDispatch:render-md` | `what`, `cost`, `case-head`, `case-cells` | cost object (case row for `case-cells`) | `settings`, `part`, `usd` (`tokenomics/scripts/team-report.mjs:390`) | string or `string[]` or `undefined` (part-specific) | `active-minutes` (`cost` part prints stage `activeMin`) |
| `classifyDispatch:render-html` | `case`, `delivery-cells`, `cost-cell`, `cost-callout` | cost object (case row for `case`) | `settings`, `part`, `usd`, `statCell`, `esc`, `fmtInt` (`tokenomics/scripts/team-report.mjs:531`) | string / `string[]` / `undefined` / `null` (part-specific) | — |
| `classifyDispatch:render-tok-md` | — | cost object | `settings`, `rowFor` (`tokenomics/scripts/team-report.mjs:646`) | `string[]` spread into the report; `?? []` | — |
| `classifyDispatch:render-tok-html` | — | cost object | `settings`, `row` (`tokenomics/scripts/team-report.mjs:708`) | string; `?? ''` | — |
| `labelFrom` | — | `{ description, firstText }` | `repo`, `settings` (`tokenomics/hooks/telemetry-capture.mjs:416`, `:499`, `:655`, `:905`) | label string; any value other than `undefined` is used as the label (`tokenomics/hooks/telemetry-capture.mjs:590`) | — |
| `receiptIds` | — | `{ id }` (dispatch id) | `repo`, `settings` (`tokenomics/hooks/telemetry-capture.mjs:417`, `:760`) | `string[]` or `null`; `null` falls back to scope-gated mining, `[]` means "no ids" | — |
| `enrichGroup:case` | — | receipt case row | `repo`, `settings` (`tokenomics/scripts/batch-cost.mjs:359`) | object spread into the cost row; `?? {}` | — |
| `enrichGroup:records` | — | receipt | `repo`, `settings`, `slug`, `dir`, `scopes` (`tokenomics/scripts/batch-cost.mjs:379`) | object spread at group level; `?? {}` | `scope-resolution` (`ctx.scopes` read from host-qualified records) |
| `enrichGroup:sizing` | — | `casesOut` array (mutated in place) | `repo`, `settings`, `slug` (`tokenomics/scripts/batch-cost.mjs:402`) | object spread after `workItemRef`; `?? {}` | `active-minutes` (rows' `loaded.activeMin`) |
| `enrichGroup:match` | — | a group's cost object | `repo`, `settings`, `scope` (`tokenomics/scripts/work-scope.mjs:219`, `tokenomics/hooks/telemetry-capture.mjs:1418`) | boolean; `?? (c.batch === scope.batch)` (a returned `false` is honoured) | — |
| `enrichGroup:by-group` | — | a group's cost object | `settings` (`tokenomics/scripts/team-report.mjs:869`) | object spread into the `byBatch` row; `?? {}` | — |
| `enrichGroup:delivered-note` | — | `{ outcomes }` (configured delivered outcomes) | `settings` (`tokenomics/scripts/batch-cost.mjs:458`) | string; `?? outcomes.join('/')` | — |
| `enrichGroup:render-md` | `what-lines`, `what`, `case-lead`, `case-tail`, `case-lead-cells`, `case-tail-cells`, `sections`, `by-group-head`, `by-group-cells` | cost object, case row, or period report (`by-group-*`) | `settings`, `part` (`tokenomics/scripts/team-report.mjs:307`); plus `cost` (`tokenomics/scripts/team-report.mjs:391`) | string / `string[]` / `undefined` (part-specific) | — |
| `enrichGroup:render-html` | `case-pre`, `case-post`, `delivery-lead`, `delivery-tail`, `gate-drift`, `outcome-drift`, `sections`, `by-group-head`, `by-group-cells` | as `render-md` | `settings`, `part`, `cost`, `statCell`, `esc`, `fmtInt` (`tokenomics/scripts/team-report.mjs:532`); `settings`, `part`, `esc` (`tokenomics/scripts/team-report.mjs:727`) | string / `string[]` / `undefined` (part-specific) | — |
| `enrichGroup:render-tok-md` | — | cost object | `settings` (`tokenomics/scripts/team-report.mjs:647`) | `string[]`; `?? []` | — |
| `onClose` | — | a closed group's cost object | `repo`, `settings`, `dir` (`tokenomics/scripts/work-scope.mjs:227`) | ignored; a throw is swallowed | `reports-location` (`ctx.dir` value for non-TA configurations) |
| `onClose:report` | — | a rendered group's cost object | `repo`, `settings` (`tokenomics/scripts/work-scope.mjs:308`) | ignored (TA writes drift warnings to stderr); a throw fails `close` | — |
| `onClose:no-receipt` | — | the closing scope | `repo`, `settings` (`tokenomics/scripts/work-scope.mjs:302`) | string inside the NO RECEIPT warning; `?? ''` | `scope-resolution` (scope record shape) |
| `stopGateCheck` | — | the declared scope record | `repo`, `settings`, `sid`, `askedOnce`, `scriptPath` (`tokenomics/hooks/scope-hook.mjs:133`) | `null` or `{ decision, reason }`; `?? null` | `scope-resolution` (scope record gains `role`; resolution is host-qualified) |
| `exportRow:segment` | — | cost object | `profile` (`tokenomics/scripts/build-tokenomics-export.mjs:69`) | object of segment identity keys; `??` the profile's own keys | — |
| `exportRow:item`, `:effort`, `:scenarios`, `:size`, `:notes` | — | cost object | `profile`, `settings`; `notes` adds `engineNotes` (`tokenomics/scripts/build-tokenomics-export.mjs:87`) | `item`/`scenarios`/`size`: object spread; `effort`: number or `null`; `notes`: `string[]` | `anon-complete` (`notes` content the anonymiser must cover) |
| `exportRow:checklist` | slots via `ctx.slot`: `segment`, `effort`, `profile`, `row` | export row | `segment`, `slot` (`tokenomics/scripts/build-tokenomics-export.mjs:134`) | `{ missing, defaulted }` fragments for that slot | — |
| `exportRow:anonymize` | — | export row | none (`tokenomics/scripts/build-tokenomics-export.mjs:179`) | object spread over the row; `?? {}` | `anon-complete` (return contract: which fields the hook must scrub versus the engine) |
| `exportRow:submission` | `intro`, `title-suffix`, `identity-row`, `factory-rows`, `summary-rows` | export document | `settings`, `part` (`tokenomics/scripts/build-tokenomics-export.mjs:197-198`) | `string[]`; `title-suffix` / `identity-row` fall back to the profile only on `undefined`/`null`, an empty array suppresses them | — (item 20 in §3 if approved) |
| `exportRow:compare` | — | cost object `a` | `settings`, `other`, `row` (`tokenomics/scripts/build-tokenomics-export.mjs:248`) | `string[]` of extra compare rows; `?? []` | — |
| `exportRow:no-profile` | — | `null` | `settings` (`tokenomics/scripts/build-tokenomics-export.mjs:282`) | hint string; `?? ''` | — |

`writer`, `exact-ids`, `fold-flags`, `null-unobservable` and `report-windows` change no call's shape.
`null-unobservable` changes values the render calls may receive (a `null` counter in a ledger line is
read through `num()` today, `tokenomics/scripts/batch-cost.mjs:42`), see §2 item 4.

**Freeze task (last Plan 4 task).** Set `EXTENSION_API = 2` and `extensionApi = 2` in
`tokenomics/extensions/test-automation.mjs`; make `hook()` throw `tokenomics: extension hook <name>
returned a Promise (hooks are synchronous)` when the result is thenable; rewrite the ENGINE-B1.md table
as the API 2 contract with the four columns above (as changed by Plan 4); extend
`tokenomics/engine/extension.test.mjs` to assert every `HOOK_CALLS` entry's documented `part` set
equals the parts the corpus trace records.

**Files.** `tokenomics/engine/extension.mjs`, `tokenomics/extensions/test-automation.mjs`,
`tokenomics/ENGINE-B1.md`, `tokenomics/engine/extension.test.mjs`.

### D4, manifest revision and writer.

- Ruling: migration `writer` (item 11) adds both `writer: "tokenomics-engine@<package version>"` and `manifestRevision`, taken from `module.json`, or 1 for the implied TA manifest, to every line the engine writes, together, and nothing else.
- Writing `module.json` itself is B3 (`install-hooks`). **As landed (B3, Plan 5 Task 7):** activation step 5,
  `ensureModuleManifest`, writes `{module: "tokenomics", schema_version: "1", domain: settings.dir,
  manifestRevision: 1, receipts: {source: "files", root, file, deliveredOutcomes}, ratioIntents:
  [settings.intents.default]}`, validated against `kit/schemas/module.json`. It runs after the checkpoint and before
  the hooks.
- Cost if wrong: one field split into two migrations.

**Reasoning.** Spec §3.2 makes both fields required for port lines, and §14.7 says `writer` identifies the
post-B2 production engine's lines. A line carrying `writer` but no `manifestRevision` would be a port
line that cannot be interpreted (§14.4), so the two fields land together. Spec §18.5 makes both
non-switchable, which also argues for one migration. "Every line the engine writes" means every §3.2
ledger line, i.e. every `appendLine` call (`tokenomics/hooks/telemetry-capture.mjs:122`, called at
`:798`, `:1214`, `:1289`, `:1383`). The live dispatch log (`tokenomics/hooks/telemetry-capture.mjs:380`)
is transient bookkeeping deleted at capture, not a ledger line, and is unchanged. Creating and
revisioning `module.json` is an installer act (§14.4 "written once per revision by `install-hooks`"), so
the engine only reads it. The implied TA manifest already declares `manifestRevision: 1`
(`tokenomics/kit/load.mjs:5`). Decided (Q14): `<package version>` comes from
`package.json`, and the replay harness pins it to a fixed test value (Plan 4 Task 14), so a release bump causes no
golden churn; B3 moves the source to `ENGINE.json`.

**Restamp exception (Codex P3-08, Obligation O7).** The current-writer/current-revision stamp applies to
**measurement appends**: the capture, fold and sweep paths. A `work-scope restamp` append (item 9) is not a
measurement. It copies the winning line's original `writer` (spec text: §3.2 "restamping never changes it",
§14.11 "the original `writer` preserved") and its original `manifestRevision` (derived, not spec text: the revision
the measurement was written under; decided, Q15b), and sets `restampedBy` (decided, Q15b: the current
`tokenomics-engine@<version>` string). Item 11 therefore stamps at the measurement line builders, or passes a
"restamp" flag that `appendLine` honours. It must never overwrite whatever provenance the caller supplies.

**Files.** `tokenomics/hooks/telemetry-capture.mjs` (`appendLine` or the three line builders), the
manifest reader shared with D1, `corpus/migrations/writer/`.

### D5, grain evidence.

- Ruling: migrations `shared-allocation`, `copilot-inclusive` and `active-minutes` each add a join-replay fixture under `tokenomics/fixtures/join/` with Task 7's `grain`.
- Their declared diffs must leave `checkConservation` with no grain violation on the corpus outputs they change.
- Cost if wrong: weaker allocation evidence.

**Reasoning.** Plan 1 parked the grain rules (`docs/plans/plan-1-ledger.md:78`) and Codex required them
before §14.8 items 2, 3 and 7 (`docs/reviews/plan-2-codex-review.md:179`). Task 7 delivered them:
`checkConservation` reads allocation `grain: 'session'|'dispatch'` (absent = session) and enforces five
rules, `activeMin-partitioned`, `inclusive-dispatch-split`, `unknown-dispatch`,
`unmeasured-dispatch-split` and `dispatch-overdraw` (`tokenomics/kit/conservation.mjs:24-42`). These three
migrations are exactly the ones whose subject is a grain rule (§5.4, §3.2.1), so each must prove it with
an allocation trace, and the corpus outputs it changes must not introduce a violation. Existing grain
fixtures (`tokenomics/fixtures/join/grain-*`) are synthetic kit evidence; the new ones mirror the
migration's before-case.

**Files.** `tokenomics/fixtures/join/<new fixture>/` per migration, `tokenomics/kit/conservation.test.mjs`
(fixture list), the engine join (`tokenomics/scripts/batch-cost.mjs`) for the trace the fixture mirrors.

### D6, switchability.

- Ruling: every migration is individually selectable in the harness. In production (B3/B4 settings), only the measurement migrations (items 2, 3, 4, 6, 7) may be switched off, and only in combinations the contract allows; `writer` never. The map lists for each item: harness-selectable (always yes), production-switchable (yes or no), and the contract constraint.
- Effective column (Task 9 deferred minor; Codex §5 D6): the "production-switchable" cells below give what the
  contract **allows**, not what the ruling would permit. Every cell is "no": the measurement migrations'
  ruling allowance has no contract-valid combination (Q3), and harness selection (`TOKENOMICS_MIGRATIONS`)
  is never a production allowance.
- Cost if wrong: the switch table changes in B3.

**Reasoning.** Spec §18.5: "For one release, measurement migrations can be switched off only among
combinations the contract allows; `writer` and `manifestRevision` are never switchable." The harness
lever `TOKENOMICS_MIGRATIONS` (`tokenomics/engine/migrations.mjs:11-23`) already selects any landed set
and is documented as harness/rescue-only (ENGINE-B1.md "Migrations (B2)"). Task 8 review: nothing in the
engine stops `TOKENOMICS_MIGRATIONS` from excluding `writer` once it lands. **Production switch
enforcement is B3/B4 settings work, and it must reject any enabled set that lacks `writer` once `writer`
has landed** (and any set lacking a migration that a contract constraint below makes mandatory). The
harness variable stays unrestricted, because isolation runs (`only:<id>`) and the B4 rescue build
(`none`) need it.
**As landed (B3, Plan 5 Task 4 and fix 1):** with the production switch set `{}` (Q3) there is no production
settings key. An installed copy (`ENGINE.json` `installed` non-null) refuses a non-empty `TOKENOMICS_MIGRATIONS`
(empty or whitespace-only is unset, R11) at every entry (R12), in `enabledMigrations`
(`tokenomics/engine/migrations.mjs`), which throws `tokenomics: refused — TOKENOMICS_MIGRATIONS is set in an
installed engine (production switch set is {}; unset it)`. The four gated hook and writer entries
(`telemetry-capture`, `scope-hook`, `otel-sink`, and `work-scope` `open`/`outcome`/`close`/`restamp`) refuse first
through the activation gate (`tokenomics/engine/activation.mjs`, state `refused`): exit 0, one stderr line, nothing
read or written. Every other entry (`team-report`, `batch-cost`, `build-tokenomics-export`, `otel-report`,
`install-hooks`, the read-only `work-scope` commands) exits 1 with that message and writes nothing. **Fix wave
(R19, Codex B3-05/B3-06):** those writing report CLIs also call the activation gate (`gateCli`) before their first
write, so an *inert* installed copy exits 1 with the one-line reason and writes nothing (`batch-cost` unless
`--stdout`; `build-tokenomics-export` except `--compare`; `team-report` with `--batch`/`--out`); this replaces the
final review's M16 note that an inert copy's report CLIs are not gated. A present but unreadable `ENGINE.json` counts as
an installed copy (only an absent one is a source checkout). The source
checkout (`installed: null`) keeps the variable unrestricted for the harness and the B4 rescue build.

**Finding against the contract.** The table below shows that none of the five measurement migrations has a
contract-valid "off" once `writer` is on: items 3, 4 and 6 would make `writer` lines violate §3.2/§3.2.1,
and items 2 and 7 would break §5.4, which the spec calls "the join's required property" (§7.4 describes
reference-era data and grants the post-B2 engine nothing). The owner ruled the D6 production switch set `{}`
(decided, Q3).

| item | id | harness-selectable | production-switchable | contract constraint |
|---|---|---|---|---|
| 1 | `exact-ids` | yes | no | §5.1: ids compare by exact, case-sensitive equality; substring matching is never contract-valid. |
| 2 | `shared-allocation` | yes | no: the ruling allows a switch, but no off-combination is contract-valid (Q3) | Join-only (no ledger field changes). Off ⇒ a shared dispatch is counted in full in several groups: no contract-valid off (§5.4 required); a labelled non-conserving exemption would be new contract text. §7.4 is the reading profile for reference-era data, not an allowance for the post-B2 engine. Q3. |
| 3 | `copilot-inclusive` | yes | no: the ruling allows a switch, but no off-combination is contract-valid (Q3) | Off ⇒ a Copilot line written with `writer` claims `tokensBasis: "parent"` while its dispatch `tokens.input` is an invented category split (§3.2.1 "MUST NOT invent a category split"). No combination with `writer` on is contract-valid. Q3. |
| 4 | `null-unobservable` | yes | no: the ruling allows a switch, but no off-combination is contract-valid (Q3) | Off ⇒ `writer` lines carry `0` for unexposed counters, which §3.2 forbids ("never 0-for-unknown"). No combination with `writer` on is contract-valid. Q3. |
| 5 | `anon-complete` | yes | no | Privacy fix; no contract-valid "off". |
| 6 | `fold-flags` | yes | no: the ruling allows a switch, but no off-combination is contract-valid (Q3) | Off ⇒ a folded `writer` line may omit `tokensAttribution` although a unit is unmeasured (§3.2 "present iff some unit's usage is unmeasured"). No combination with `writer` on is contract-valid. Q3. |
| 7 | `active-minutes` | yes | no: the ruling allows a switch, but no off-combination is contract-valid (Q3) | Join-only. Off ⇒ active minutes are partitioned across dispatches, which §5.4 forbids ("never partitioned across dispatches"): no contract-valid off (§5.4 required); a labelled non-conserving exemption would be new contract text. Q3. |
| 8 | `report-windows` | yes | no | §5.5 is the only ratio semantics; D1 binds `ratioIntents` to it. |
| 9 | `scope-resolution` | yes | no | §14.11; `restamp` depends on host-qualified records. |
| 10 | `reports-location` | yes | no | §14.8 item 10; TA keeps `tree` by configuration, not by switch. |
| 11 | `writer` | yes | **never** | §18.5. B3/B4 enforcement rejects any set lacking it once landed. |

**Files.** None in Plan 4 beyond this table (the harness already isolates every id). B3/B4: the
production settings key and its validator. **As landed (B3, Plan 5 Task 4 and fix 1):** no settings key (the set is `{}`). An installed copy
refuses a non-empty `TOKENOMICS_MIGRATIONS` at every entry: `enabledMigrations` throws the refusal (exit 1 for the
report and admin CLIs), and the four gated entries refuse first through `activation.mjs` (exit 0). So an installed
engine only ever runs every landed migration.

### D7, the receipt command is not B2.

- Ruling: the receipt command (spec §5.6) and command-sourced receipts are porting glue (C1) and kit work (already in A2), not a §14.8 migration. The engine keeps reading file receipts in B2.
- Cost if wrong: one more migration in Plan 4.

**Reasoning.** §14.8 is "the complete list" and names no receipt-source change. §5.6's command is
project glue (§14.5 item 1, written by the porting skill in C1), and the kit already implements its
envelope and execution rules for `check --run-receipts` (A2, §8.1). The engine reads files receipts
today (`reference/49577c7/scripts/batch-cost.mjs:45-74`, `tokenomics/scripts/batch-cost.mjs:47`;
`reference/49577c7/scripts/team-report.mjs:117-157`, `tokenomics/scripts/team-report.mjs:121-161`).
Item 8 (§5.5) needs only the receipt *ordering* and `at`, which file receipts can carry.

**Files.** None.

---

## 1.5 Obligations

Every outcome the spec requires of the post-B2 engine (or of a named later milestone) has one row here, with
an owner. An owner is an existing §14.8 item, an item the owner approved under Q1a **as required
by spec, with its own migration slot**, or a milestone the spec or a §1 ruling names. "Required" rows offer no
"keep as is" option anywhere in this map. Codex P3-05 and Reproduction E
(`docs/reviews/plan-3-codex-review.md`) supplied the first three rows. Spec lines are `docs/spec.md` lines.
"Today" cites the reference and, where useful, the engine. These are preserved reference defects, correct B1
behaviour until their owner lands.

| # | obligation | spec citation | today's behaviour (file:line; pinning case) | owner | required / optional | acceptance test |
|---|---|---|---|---|---|---|
| O1 | **Unknown counts.** Aggregates carry unknowns as counts, never as zero | §3.2.1 "Aggregates carry unknowns as counts (`unpriced: n`, `unmeasured: n`), never as zero" (spec:236); §5.4 "Unknown quantities stay unknown" | The period report adds every counter through `num()` (`reference/49577c7/scripts/team-report.mjs:31`, `:160-162`, `:180-181`), so a line with `tokens:null`, `activeMin:null` adds a zero quad and `activeMin` 0, with no count (Repro E). Only the unpriced count exists (`tokensOnly`, `reference/49577c7/scripts/team-report.mjs:236`). The join counts unmeasured **token** units (`unattributedUnits`, `reference/49577c7/scripts/batch-cost.mjs:544`, `:558`, `:659`), but reads minutes and tool counters through `num()` (`reference/49577c7/scripts/batch-cost.mjs:40`). Pinned: `cov-reports-ledger`. Line `s-a2` (`usage-alice.jsonl:2`) has a `reviewer` dispatch `b3` with `tokens: null`. The period report (events 4–12) folds it into a zero quad with no count through `lineTokens`/`addTok` (`reference/49577c7/scripts/team-report.mjs:160-172`): event 6's `byRole.reviewer` (`__events__/6.stdout:174`) shows `units: 2` with only `b2`'s tokens. `batch-cost` (events 0–1) counts it only as `unattributedUnits: 1` (`__events__/0.stdout:41`). Also `cov-team-report-rollup` (the unpriced count, tokens-only root) and `cov-dispatch-batch` `cov-d/cost.json` `totals.unattributedUnits: 2` (the token count). No corpus case has a parent `tokens:null` / `activeMin:null` line (Repro E) | item 4 `null-unobservable`, reader half. Item 4 creates the nulls, so it also lands their counting, or its own nulls would read back as 0-for-unknown. Q8d decided the field names and rendering | required | `team-report.test.mjs` "null tokens / activeMin / counters are counted as unmeasured per quantity, never added as 0" (one `tokens:null, activeMin:null` line, no dispatches: totals carry `unmeasured` counts, no zero quad); `batch-cost.test.mjs` "null activeMin / toolCalls / toolErrors counted, not zeroed"; declared diff `cov-reports-ledger` (period-report events 4–12: the null `reviewer` dispatch tokens counted as unmeasured instead of a zero quad; batch-cost events 0–1); a before-case `before-report-unknowns`, which Plan 4 adds with item 4 for the parent `tokens:null` / `activeMin:null` scenario of Repro E, with a declared diff showing the counts |
| O2 | **Reader conflicts.** An exact rank tie with a different accounting payload is a `conflict`: excluded from verified totals, shown in a preview total with a deterministic pick (lowest canonical JSON). An identical payload is a duplicate | §3.5 (spec:273-277); §3.3 canonical JSON | `dedupLines` keeps the **first** line of an exact (`endedAt`, `capturedAt`) tie and reports nothing (`reference/49577c7/scripts/team-report.mjs:63-74`). Both the period report and the join use it (`reference/49577c7/scripts/batch-cost.mjs:459`). The winner depends on input order: costs 10/20 give 10 forward and 20 reversed (Repro E). The kit's `aggregate` implements §3.5, but no engine report uses it. Pinned: `cov-team-report-rollup` ("exact tie"); §3 R20 | item **22 `report-conflicts`**, required by spec (decided, Q1a, Q16) | required | `team-report.test.mjs` "exact tie, identical payload → one duplicate"; "exact tie, different payload → conflict: excluded from verified totals, preview total picks the lowest canonical JSON, conflict count reported"; "result independent of input order (forward = reversed)"; `batch-cost.test.mjs` the same for group cost; declared diff `cov-team-report-rollup`. **As landed (Task 15, review round 1):** `dedupConflicts(lines) → {winners, duplicates, conflicts: [{key, lines}], preview}` in `team-report.mjs`, on the kit's `canonical`/`accountingPayload` and the kit's rule (rank null/unreadable lowest; per payload the lowest full canonical line; the pick = lowest canonical accounting payload); `winners`, `conflicts` and `preview` are sorted by `host:id`, so every report reads its lines in key order and `--json`/Markdown are byte-identical for any read order (I3). **Scope (I1):** a conflict is in scope when ANY of its tied lines is (the `endedAt` window or the legacy `startedAt` window, `--role`, group membership); it is then counted and its pick (in scope or not) goes into the preview. **Precedence (I2):** a conflict is never `undated`; `undated` counts only unconflicted lines. Period report: conflicted sessions leave every total, breakdown, the index and the ratio; `conflicts: {sessions, costUsd, priced}` (the shape of `unverified`/`undated`) beside `preview: {sessions, costUsd, priced}` = totals + picks, both present only when non-zero. Receipts (§5.2 rows): an exact tie with a different row is a conflict (`receiptWinners`): the id leaves `examined`/`delivered`/`outcomes`; `cases.conflicts: n`, `cases.preview: {examined, delivered, unwindowed}` (M2). Two roots whose receipts share a group and rank but bind different manifests (same outcome, different `delivered`) are a conflict too, an accounting disagreement (M3, tested). Group cost: members are the winners; `sources.conflicts` + `conflictsNote`, `preview: {sessions, costUsd, note}` from a build that adds the picks; shared-allocation's k counts winners and picks. Markdown/HTML render a callout on the period page, the batch delivery page and the tokenomics view (M1). `work-scope restamp` refuses a winner that is an exact conflict (exit 1, suggests `capture --force`; M4). Declared: `cov-team-report-rollup` (events 0, 3), `before-ratio-manifest`, `cov-reports-ledger`, `cov-team-report-batches`, `foreign-settings` (key order only); `write` refused every other period-report and batch candidate (no difference) |
| O3 | **Inclusive by-role dollars.** By-role dollars = the parent session's role, inclusive. Per-dispatch-role dollars appear only as a separate measured breakdown | §3.2.1 "By-role dollars = the parent session's role, inclusive. Per-dispatch-role dollars are reported only as a separate measured breakdown" (spec:234-235); §3.2.1 `costUsd` session-inclusive (spec:220-221) | The join's `byRole` gives the parent role `costUsd − Σ dispatch costUsd` (`reference/49577c7/scripts/batch-cost.mjs:533`, `:547`) and adds each dispatch role's measured dollars into the same map (`reference/49577c7/scripts/batch-cost.mjs:559`). A $10 session with a measured $4 `worker` dispatch gives `byRole = {lead: 6, worker: 4}` (Repro E). The period report's `byRole` carries no dollars (`reference/49577c7/scripts/team-report.mjs:188`). Pinned: `cov-dispatch-batch` `cov-d/cost.json` `byRole.session.costUsd` 0.05 (the $0.35 line minus its dispatches) beside `implementer` 0.28 and the other dispatch roles | item **23 `role-dollars`**, required by spec (decided, Q1a). Not item 7: item 7's text is active minutes (§5.4), and its earlier citation of this rule for minutes is corrected in §2 item 7 | required | `batch-cost.test.mjs` "byRole dollars: parent role = session-inclusive costUsd; dispatch-role dollars in a separate measured breakdown, never summed into byRole totals" ($10 / $4 → `lead` 10, breakdown `worker` 4); declared diffs `cov-dispatch-batch`, `seed-receipts-shared-id` (`byRole.implementer`), plus every case the `write` run finds; interaction declarations with items 2 and 7 on the same `cost.json` (§4). **As landed (Task 16 + review round 1). The rule:** a priced session's parent role is charged what the group charges for that session — the lead share plus the included dispatches' measured dollars at their weight (1, `shared-allocation`'s 1/k, or the neutral 1/div). This supersedes the literal `costUsd / div` above (owner ruling, review round 1): spec §3.2.1 is written at session grain, and how one session splits across groups already belongs to `totals` (the reference's foreign-dispatch exclusion, the neutral 1/div share, Q5's 1/k). Charging the role `costUsd / div` would make the role table disagree with the headline total in every shared or foreign group, and redefining `totals` to match would drive `overhead` negative when one group carries the dispatch. The two agree when the group carries all or none of the session's dispatches evenly (the $10 / $4 example: 10 either way); they differ otherwise (`foreign-settings`: one $2 session over two stories gives $1.05 / $0.95, not $1 / $1). **Unpriced sessions (review round 1, I1):** a session whose `costUsd` is not a number adds no by-role dollars — its parent role stays `null` and counts in `byRole.<role>.unpriced` (spec §3.2.1: dispatch dollars are never added to the session's; O1); its measured dispatch dollars stay in `totals` (the existing floor, unchanged) and appear in `byDispatchRole` only. So Σ `byRole.costUsd` = `totals.costUsd` holds over priced sessions: with unpriced sessions in the group, Σ `byRole.costUsd` = `totals.costUsd` − the unpriced sessions' included dispatch dollars (`cov-batch-cost-edges` `gb-priced`: `session` `null`, `unpriced: 2`, totals $0.50). **Counts (I2):** every `byRole` bucket carries `priced` / `unpriced` parent-session counts; `null` with `unpriced > 0` is an unpriced parent (rendered `— (n unpriced)`), `null` with 0 / 0 a dispatch-only role, not allocated at this grain (rendered `—` beside the footnote "— = not allocated at this grain"). Dispatch-only roles read `byRole.<role>.costUsd: null`; `byDispatchRole: {<role>: {units, costUsd, priced}}` is present (possibly empty) in every `cost.json`, so the `write` run declares all 20 cases that write a `cost.json` or a batch view; 50 refused. `seed-receipts-shared-id`'s `byRole.implementer` does **not** change (its dispatch is unpriced, `null` before and after): the case changes by gaining `byDispatchRole.implementer {costUsd: null, priced: 0}` and the rendered table. No period-report stream changes (the period `byRole` carries no dollars). Interactions: all 20 existing case interactions extended with `role-dollars` (not only items 2 and 7: every other owner of the same files, §4) |
| O4 | **Historical manifest binding.** Every record is read by **its** revision. A revisionless line binds to the implied legacy manifest. A missing archived revision is unverified, never reinterpreted (the unverified reading is decided, Q11b; §14.4 only requires archives retained forever) | §14.4 "readers interpret each record by **its** revision", `manifests/<rev>.json` retained forever (spec:778); §3.1 "a revision's semantics never change once written"; §14.7 mixed eras; §7.1 implied manifest | The reference ignores `module.json` and divides the fixed `automation` bucket (`reference/49577c7/scripts/team-report.mjs:246`). The engine reads mutable `settings.ratioIntents` (`tokenomics/scripts/team-report.mjs:234`). Pinned: `before-ratio-manifest` (one revision, revisionless lines: it can show ownership, not stability) | item 8 `report-windows` (the manifest reader and D1's reading rule) for revisionless and archived lines; item 11 `writer` for the first revisioned lines | required | `team-report.test.mjs` "revisionless lines bind to the implied legacy manifest: changing or advancing `module.json` (revision 2, `ratioIntents: ['story']`) leaves their eligibility unchanged"; "a line with `manifestRevision: 2` binds to `manifests/2.json`, not the current `module.json` (revision 3)"; "a line naming revision 4 with no `manifests/4.json` → unverified, finding, excluded from eligible sessions"; "delivered outcomes follow the line's revision"; a before-case `before-ratio-revisions`, which Plan 4 adds with item 8 (archived revisions 1–2, current revision 3, one line per revision, one missing archive) |
| O5 | **Command receipts.** The engine reads receipts through the project's §5.6 command: envelope, `complete:false` → partial, failure → unavailable | §5.6 (spec:484-497); §14.5 item 1 | The engine reads `files` receipts only (`reference/49577c7/scripts/batch-cost.mjs:45-74`, `reference/49577c7/scripts/team-report.mjs:117-157`). The kit's command reader (A2) is not wired into the engine. Pinned: every receipt case (e.g. `before-report-windows`) | milestone **C1** (D7): an engine "command receipts" task, the first C1 task, before the porting skill's receipt adapter is relied on. B2 item 8 is tested with file receipts only | required | C1 engine tests: with `settings.receipts.command` set, `team-report` and `close` parse `{"schema":1,"complete":…,"receipts":[…]}`; `complete:false` → the report labels receipts partial; nonzero exit, timeout (`timeoutSec`, default 60), malformed output, stdout over 20 MB, missing credentials → receipts **unavailable** (never an empty successful set); argv without a shell, cwd = repository root; only the main tree's `settings.json` can name the command; the kit's `--receipts-file` fixtures are reused as engine fixtures |
| O6 | **Report provenance.** Every engine-written report records its `manifestRevision` | §14.4 "Every engine-written line and report records its `manifestRevision`" (spec:778) | No report or `cost.json` records a revision (e.g. `buildReport`'s result, `reference/49577c7/scripts/team-report.mjs:229-257`). Pinned: every report case | item **24 `report-revision`**, required by spec (decided, Q1a, Q14c); it lands in B2 | required | `team-report.test.mjs`, `batch-cost.test.mjs`, `work-scope.test.mjs` "every engine-written report (`cost.json`, batch reports, period report JSON / Markdown / HTML, live page, export) records the current manifest's `manifestRevision`; implied manifest → 1"; declared diffs for every report case (`write` run) **As landed (Task 17, item 24):** the registry's two before-cases understated the footprint; the `write` run over all 70 cases declares 24 (`before-dispatch-two-groups`, `before-export-anon-batch`, `before-ids-substring`, `before-ratio-manifest`, `before-ratio-revisions`, `before-report-unknowns`, `before-report-windows`, `cov-batch-cost-edges`, `cov-copilot-dispatch`, `cov-dispatch-batch`, `cov-export-cli`, `cov-export-submission-edges`, `cov-reports-ledger`, `cov-team-report-batches`, `cov-team-report-rollup`, `cov-work-scope-close-faults`, `fault-batch-cost-empty-repo`, `fault-batch-cost-sizing-locked`, `fault-batch-cost-unreadable`, `fault-gate-fold-symlink`, `foreign-null-extension`, `foreign-settings`, `seed-receipts-shared-id`, `seed-receipts-waves`) and refuses 46 (no report is written). The revision is the `writer` stamp rule (`stampRevision`): `module.json` absent -> 1, a usable one -> its revision, an unusable one -> `null`, rendered as "manifest revision unknown", never as 1. Placement: `cost.json` `manifestRevision` after `v`; period `--json` after `generated`; the export document after `schema_version` (rows unchanged, the dataset schema is external); md/html (batch, tokenomics, period, live page) and `submission.md` end with `manifest revision N`. A period report over several roots reports the primary (first) root's revision and adds `manifestRevisions: [{dir, manifestRevision}]` (footer `manifest revisions: <dir>=N; ...`) only when the distinct telemetry directories disagree. A report without the field renders no footer (O10). Not stamped: `renderCompare` and `otel-report.mjs` (an OTel sink summary with no manifest). |
| O7 | **Restamp provenance.** A restamp append keeps the original `writer` and measurement provenance and sets `restampedBy` | §3.2 `writer` "restamping never changes it", `restampedBy` (spec:184, :186); §14.11 Restamp (spec:930-936) | No `restamp` command exists. An unknown command prints usage and exits 1 (`reference/49577c7/scripts/work-scope.mjs:326-327`). Pinned: `before-scope-precedence` (restamp event exit 1) | item 9 `scope-resolution` (command and rejection paths); item 11 `writer` (positive path and the D4 restamp exception) | required | `work-scope.test.mjs` "restamp a line written by an older writer": winner `writer: tokenomics-engine@0.9.0`, `manifestRevision: 1`; current package newer and current `module.json` at revision 2 → the appended line has `writer` 0.9.0, `manifestRevision` 1, `restampedBy` set, corrected `scope`, measured fields and `endedAt` unchanged, `capturedAt` = now; plus "no prior line → error", "reference-era winner → error naming `capture --force`" |
| O8 | **B1 defaults behind `none`.** The migrations-off path stays the reference-equivalent extraction after B2 closes | §18.5 rescue release ("the B1 extraction build"); §12 B1 gate; Plan constraint "migrations off = pure extraction" | `ratioIntents` lives in `TA_DEFAULTS` and is validated and read there (`tokenomics/engine/config.mjs:21`, `:49`; `tokenomics/scripts/team-report.mjs:234`). Pinned: every reference case under `none`; `foreign-settings` | item 8 `report-windows` (introduces `B1_DEFAULTS`, D1) and the B2-close cleanup task | required | `config.test.mjs` "`none`: a foreign `settings.json` without `ratioIntents` loads (frozen `B1_DEFAULTS` supplies it) and reports as today"; "after `ratioIntents` leaves `TA_DEFAULTS`, `B1_DEFAULTS` still has it"; `node scripts/diff-impl.mjs` `differing 0` after the B2-close commit |
| O9 | **Complete anonymisation.** No supplied identifier survives in any output string of the anonymised submission, across **all** rows | §14.8 item 5; §10.4 | `anonymizeDoc` replaces `work_item_ref`, `work_item_brief` and the `batch slug '…'` phrase only (`reference/49577c7/scripts/build-tokenomics-export.mjs:185-194`). Pinned: `before-export-anon-batch` | item 5 `anon-complete` (scrub set = union over all rows and the submission, §2 item 5) | required | §2 item 5 acceptance, including the cross-row test **As landed (Codex fix wave F7, B2-09):** the scrub also covers object keys below the row level (`runs[i].extra["PRIVATE-47"]`), by the same whole-token/path-segment rules; document and row field names are never renamed. Colliding scrubbed keys are never merged: an untouched key keeps its name, changed ones become `anonymised`, `anonymised-2`... in insertion order. The token-quad schema keys (`input`, `output`, `cache_read`, `cache_create` in `tokens` and `tokens_by_model.<m>`) are never renamed (`keepKeys`; Plan 4 final review M2, test "M2 (Plan 4 final review)"). Test: `build-tokenomics-export.test.mjs` "B2-09" (real `writeSubmission(repo,{anon:true})`; the string walker now visits keys) |
| O10 | **Readers never drop formats.** A persisted line is read by its own `tokensBasis` and era, whatever the current switches. The rescue release pairs the B1 writer with the `mixed` reader | §14.7; §18.5 "Readers never drop formats", "Inaugural recovery" | The reference adds dispatch tokens on top of session tokens for every line (`reference/49577c7/scripts/team-report.mjs:167-172`). Pinned: `seed-copilot-cli`, `cov-copilot-dispatch` | item 3 `copilot-inclusive` (engine reports honour a persisted `tokensBasis`); milestone **B4** (spec §18.5: rescue release and rollback test) | required | item 3 "lineTokens ignores dispatch tokens of an inclusive line", also with `copilot-inclusive` disabled (`only:` another id) over an inclusive line; B4 rollback test reads persisted `writer`/inclusive lines after rollback without discarding them |
| O11 | Robustness fixes found in the reference (§3 R8, R11–R19): items 12–21 | none binding (defect fixes) | §3 rows | items 12–21 as three grouped migrations: `entry-points` (12, 13), `capture-robustness` (14–17, 21), `report-robustness` (18–20) (decided, Q1b) | optional (owner-approved, Q1b) | per §3 row and Q1 |

Self-check rule (Plan 3 patch Task 5): every `required` row names an owner. No §2 option or §5 question may
offer a required row's reference behaviour as an end state.

---

## 2. Per-migration specification

### Item 1 — `exact-ids`

**Spec:** §14.8 item 1 "Exact, case-sensitive id matching (§10.2)"; §5.1 "Ids are compared by exact,
case-sensitive string equality — never substring"; §10.2.

**Reference behaviour today:**
- Dispatch labels match receipt ids by case-insensitive substring:
  `reference/49577c7/scripts/batch-cost.mjs:230-235` (`matchIds`), engine
  `tokenomics/scripts/batch-cost.mjs:137-141`. `TC-1` matches a label naming only `TC-10`.
- The declared-id fallback compares case-insensitively:
  `reference/49577c7/scripts/batch-cost.mjs:246`, engine `tokenomics/scripts/batch-cost.mjs:152`.
- Line membership joins branch, line cases, scope batch/cases, dispatch labels and dispatch cases into
  one lower-cased text and tests slug, ids and branches by substring:
  `reference/49577c7/scripts/batch-cost.mjs:256-266`, engine `tokenomics/scripts/batch-cost.mjs:162-172`.
- Mine/foreign partition reuses `matchIds` and substring key mentions:
  `reference/49577c7/scripts/batch-cost.mjs:464-468`, `:524-525`, engine
  `tokenomics/scripts/batch-cost.mjs:245-249`, `:306-307`. Structured `s.cases` already compare exactly
  (`ids.includes(c)`).
- Pinned by: `before-ids-substring` (label substring). No existing case exercises a near-miss id:
  `seed-receipts-shared-id`'s label is `implement TC-1` against receipt id `TC-1` (an exact token).

**Target behaviour:**
- Structured ids (line `cases`, `scope.cases`, dispatch `cases`, receipt `cases[].id`) compare by
  `===` (§5.1).
- A receipt id "names" a free-text label or branch only as a whole token: case-sensitive, and not
  preceded or followed by an id character, so `TC-1` does not match `TC-10`, `xTC-1` or `tc-1`. The token
  boundary is decided (Q4): the boundary class `[A-Za-z0-9_-]`, so `TC-1` matches
  `implement TC-1,` and `TC-1:` but not `TC-1-2`).
- Group keys (slug, receipt `batch`) compare exactly against `scope.batch`, and as whole tokens in labels
  and branches.
- Changed outputs: `cost.json` `cases[].direct.*`, `overhead.*`, `coverage.*`, `stats.*`, `totals`
  (when a line stops matching a group), `sources.sessions`, and every report rendered from them.

**Engine change sites:** engine code only: `matchIds`, `classify` (fallback), `lineMatchesBatch` and the
`mentionsKey` closure in `tokenomics/scripts/batch-cost.mjs`. No extension phase (TA's `enrichGroup:match`
compares group names, not ids: `tokenomics/extensions/test-automation.mjs:408`).

**Before-cases:**
- `before-ids-substring` — group `g1` (receipt `TC-1`), session `ids` scoped to `g1` with two dispatches
  labelled `implement TC-10` and `review tc-1` (lower case, so case-sensitivity is pinned too), then
  `work-scope close`. Today both match `TC-1` (case-insensitive `includes`,
  `reference/49577c7/scripts/batch-cost.mjs:233-235`; "review" is not an overhead stage,
  `reference/49577c7/scripts/batch-cost.mjs:216`): `/cases/0/direct/dispatches` = **2**, `direct.tokens`
  565 (verified on the reference, `assert.json`).
- `seed-receipts-shared-id` was dropped from `exact-ids`'s `beforeCases` (its only label is an exact token,
  so it is predicted not to change under this migration).

**Declared diff shape:**
- `before-ids-substring`: `.agents/automation/g1/cost.json`: `cases[TC-1].direct.dispatches` 2 → 0 and
  its `tokens`/`tok`/`costUsd`/`activeMin`/`toolCalls` drop by the sum over both dispatches (`TC-10` and
  `tc-1`, which both match today); both dispatches move to
  `overhead.stages` (they name no receipt id, so `classify` returns overhead,
  `tokenomics/scripts/batch-cost.mjs:154`); `coverage.casesAttributed`/`casesUnattributed`;
  `stats.directCostUsd`/`directTokens`/`directActiveMin`; `cases[].loaded.*` unchanged in sum. The four
  rendered reports in `g1/` follow. Landed (Plan 4 Task 4): the export row in
  `.agents/telemetry/automation/export/runs.json` is unchanged (the case has no export step); with no
  attributed case `stats.directTokens`/`directActiveMin` become `null` (not merely lower), `casesUnattributed`
  lists `TC-1`, and the reports add an "Unattributed" note.
- Every other corpus case: Plan 4 runs `migrations.mjs write exact-ids <case>` over the batch/report
  cases (`cov-dispatch-batch`, `cov-reports-ledger`, `cov-team-report-batches`, `cov-team-report-rollup`,
  `cov-batch-cost-edges`, `seed-receipts-waves`, `cov-copilot-dispatch`, `foreign-settings`,
  `cov-work-scope-close-faults`) and declares each that changes. Known candidates: `cov-reports-ledger`
  label `triage solo batch` mentions slug `solo` as a whole token (unchanged), `cov-batch-cost-edges`
  matches a line only through `integration_branch` substring (`CASES.md` row) — changes if the branch
  is not a whole token.

**Interactions:** `shared-allocation` reuses the mine/foreign partition; landing `exact-ids` first means
item 2's diff is computed over exact matching. `report-windows` dedups receipt rows per id (§5.2) and
needs exact ids. Order: first (§4).

**Switchability:** harness yes; production no; §5.1.

**Acceptance tests:** `tokenomics/scripts/batch-cost.test.mjs` "matchIds: whole-token, case-sensitive"
(TC-1 vs TC-10, tc-1, TC-1:, xTC-1), "lineMatchesBatch: structured ids exact", "classify: declared
fallback exact"; declared diff `before-ids-substring` (+ any case the write run finds changed).

### Item 2 — `shared-allocation`

**Spec:** §14.8 item 2 "Conservation-preserving shared-dispatch allocation (§10.3)"; §5.4; §10.3; §7.4
("reference group costs may count a shared-id dispatch at full weight in several groups").

**Reference behaviour today:**
- A dispatch is "mine" in a group when its label or `cases` name any of that group's ids or keys, and
  "foreign" only when it is not mine: `reference/49577c7/scripts/batch-cost.mjs:524-527`, engine
  `tokenomics/scripts/batch-cost.mjs:306-309`. A dispatch naming ids of two groups (or one id that two
  receipts share, since `foreignIds` drops ids the group itself owns,
  `reference/49577c7/scripts/batch-cost.mjs:462`, engine `tokenomics/scripts/batch-cost.mjs:243`) is mine
  in both, weight `w = 1` in each: counted in full twice.
- Pinned by `seed-receipts-shared-id`: the same 410-token dispatch is `TC-1`'s direct work in both
  `camp/grp-a/cost.json` and `camp/grp-b/cost.json` (`assert.json` facts). Two different ids in one label:
  `before-dispatch-two-groups`.
- Session-level figures are already split evenly across the groups the line matched
  (`div`, `reference/49577c7/scripts/batch-cost.mjs:513`, `:532-539`; engine
  `tokenomics/scripts/batch-cost.mjs:295`, `:314-321`); neutral dispatches get `w = 1/div`
  (`reference/49577c7/scripts/batch-cost.mjs:527`). Those are conserving and stay.

**Target behaviour:**
- For each dispatch, let `k` = the number of groups (across all receipts, excluding rollups) in which it is
  "mine". Its weight in each such group is `1/k` (decided, Q5); `k = 1` is today's behaviour. Within a
  group, the existing per-id even split (`share = w / matched.length`) applies to the weighted amount.
- Conservation (§5.4): for each source session and each additive quantity, Σ over groups ≤ source
  quantity within tolerance; dollars and parent-basis tokens may be allocated at dispatch grain, because
  those are measured per dispatch.
- Decided (Q5): `cost.json` gains `sources.sharedDispatches: <n>` and a note when `k > 1` occurred (mirrors the
  existing `sharedSessions` note, `tokenomics/scripts/batch-cost.mjs:420`). As landed (Task 9) the note is its own
  key, `sources.sharedDispatchesNote`, because `sources.note` already belongs to `sharedSessions`.
- As landed (Task 9): `sharedDispatchCounts(groups, allLines, {scopes})` returns `Map<dispatchKey, k>` with
  `dispatchKey = host:lineId:dispatchId` (the dispatch's index when it has no id). It uses the same membership
  (time window + `lineMatchesBatch`) and the same "mine" test (`dispatchMine`) as the partition. A receipt with
  `rollup: true` (§5.1) is not counted in `k` and keeps its mine dispatches at weight 1, because a rollup
  aggregates the other groups and is outside the additive cohort (§5.4).
- As landed: **inclusive lines.** A dispatch of a `tokensBasis: "inclusive"` line already adds no tokens (item 3),
  so `1/k` splits only its dispatch count, minutes, tool counters and any measured dollars. Its tokens stay at
  session grain (the parent split by `div`), and its null tokens are still counted as unmeasured in each group,
  never as 0.
- As landed: **rounding.** The `1/k` share is carried unrounded through every sum, and each group's figure is
  rounded once at output (`Math.round` for tokens and minutes, `round2` for dollars), as the existing even
  splits (`div`, clusters) are. So each group is within half a unit, and the k groups together are within
  k/2 units of the source: for k = 3, 410 tokens give 137 + 137 + 137 = 411, within the kit's 1-token tolerance. The kit checks the join traces (the unrounded allocation), not `cost.json`; the `div` and cluster splits share the same k/2 bound on the rounded figures.
  Pinned by `batch-cost.test.mjs` "an odd split (k = 3) rounds per group and conserves within the kit
  tolerance". For k ≥ 4 the rounded figures can exceed the tolerance, while the unrounded allocation still
  conserves exactly.
- Changed outputs: the weighted dispatch's contribution in every group's `cases[].direct.*`,
  `totals.*` (`tokens`, `tokensSplit`, `tokensByModel`, `costUsd`, `dispatches`, `toolCalls`,
  `toolErrors`), `byRole.<role>`, `cases[].loaded.*`, `stats.*`, `averages.*`, and the renders/export
  rows built from them.

**Engine change sites:** engine code: `updateBatchCosts` must compute `k` across all receipts before
building each group (`tokenomics/scripts/batch-cost.mjs:481-506`), `buildBatchCost`'s partition
(`:303-310`) takes it. The TA extension's `classifyDispatch:direct`/`:overhead` receive the new `w`/
`share` values (no code change in TA).

**Before-cases:** `seed-receipts-shared-id`; `before-dispatch-two-groups` (campaign `camp`, waves `camp/a`
receipt `TC-1` and `camp/b` receipt `TC-2`, one dispatch labelled `implement TC-1 TC-2`, `close` on `camp`:
the dispatch's 410 tokens are `cases[0].direct` in both `a/cost.json` and `b/cost.json`, while the parent's
370 tokens split 185/185, so each group's `totals.tokens` is 595). `cov-reports-ledger` was dropped from the
registry entry: it is predicted **not** to change (none of its dispatches is mine in two groups:
`side quest` names `W1-1` only, `implement W1-1 elsewhere` is foreign in `solo`, mine in `camp/wave-01`);
Plan 4's `write` run re-checks it.

**Declared diff shape:**
- `seed-receipts-shared-id`: `camp/grp-a/cost.json` and `camp/grp-b/cost.json`: `cases[0].direct.tokens`
  410 → 205, `tok` halved, `dispatches` 1 → 0.5, `activeMin`/`toolCalls`/`toolErrors` halved (until
  item 7 lands), `totals.*` and `byRole.implementer` correspondingly, `loaded.*`, `stats.*`, new
  `sources.sharedDispatches: 1` (decided, Q5); the eight rendered reports (`batch-report.md|html`,
  `batch-tokenomics.md|html` in each group); `.agents/telemetry/automation/export/runs.json` (both rows'
  `tokens`, `subagent_dispatches`, `tokens_by_model`).
- `before-dispatch-two-groups`: same fields in `camp/a/cost.json` and `camp/b/cost.json`, plus renders and
  export rows.

**Interactions:** after `exact-ids` (the partition's matching) and `copilot-inclusive` (which changes
what dispatch tokens a Copilot line contributes); before `active-minutes` (which removes `activeMin` from
the weighted dispatch amounts). Join replay fixture per D5.

**Switchability:** harness yes; production no: no off-combination is contract-valid (§5.4 required; D6 table; Q3 decided the production set `{}`).

**Acceptance tests:** `batch-cost.test.mjs` "a dispatch mine in k groups gets 1/k in each", "k = 1
unchanged"; `tokenomics/fixtures/join/shared-dispatch-split/` (D5: dispatch-grain dollar and token
allocations of one dispatch across two groups, `checkConservation` zero violations, `grain: 'dispatch'`);
declared diffs `seed-receipts-shared-id`, `before-dispatch-two-groups`.

**As recorded (Task 9).** The `write` run declared exactly `seed-receipts-shared-id` and
`before-dispatch-two-groups`. Each has 11 paths: both `cost.json`, the eight renders and `export/runs.json`.
In the export rows, `cache_read_share_pct` also moves (9.3 → 10.3). The shape matches the map. Note that the
batch-report "Dispatches" KPI card prints `totals.dispatches` through `fmtInt`, so 0.5 shows as 1. The
Markdown and the by-role rows show 0.5. The tool refused every other candidate ("no difference under
only:shared-allocation"): `cov-reports-ledger`, as predicted, and Task 4's list (`before-ids-substring`,
`cov-dispatch-batch`, `cov-team-report-batches`, `cov-team-report-rollup`, `cov-batch-cost-edges`,
`seed-receipts-waves`, `cov-copilot-dispatch`, `foreign-settings`, `cov-work-scope-close-faults`). Interactions:
`seed-receipts-shared-id` and `before-dispatch-two-groups` (`null-unobservable` + `shared-allocation`, both
`cost.json`). The renders and the export rows are declared by `shared-allocation` alone.

### Item 3 — `copilot-inclusive`

**Spec:** §14.8 item 3 "Copilot `tokensBasis: "inclusive"`; dispatch totals no longer stored as
measured input (§10.1, P14)"; §3.2 (`tokensBasis`), §3.2.1, §3.8, §10.1.

**Reference behaviour today:**
- Each Copilot sub-agent's single cache-inclusive total is stored as `tokens.input` with the other
  categories 0: session capture `reference/49577c7/hooks/telemetry-capture.mjs:940`, engine
  `tokenomics/hooks/telemetry-capture.mjs:912`; live dispatch log
  `reference/49577c7/hooks/telemetry-capture.mjs:524`, engine `tokenomics/hooks/telemetry-capture.mjs:500`.
- The session's summed input is netted by Σ dispatch totals, clamped at 0:
  `reference/49577c7/hooks/telemetry-capture.mjs:969-972`, engine
  `tokenomics/hooks/telemetry-capture.mjs:943-944`. No `tokensBasis` is written
  (`reference/49577c7/hooks/telemetry-capture.mjs:978-995`).
- Readers add dispatch tokens on top of session tokens: team-report `lineTokens`
  `reference/49577c7/scripts/team-report.mjs:167-172` (engine `tokenomics/scripts/team-report.mjs:171-176`);
  batch-cost parent + dispatch (`reference/49577c7/scripts/batch-cost.mjs:534-535`, `:552`; engine
  `tokenomics/scripts/batch-cost.mjs:316-317`, `:334`).
- Pinned by `seed-copilot-cli` (1500 → 1000 input, sub 500 in `subagents[0].tokens.input`),
  `seed-copilot-no-usage` (0 − 500 clamped to 0), `cov-copilot-dispatch` (live log + sweep),
  `cov-capture-copilot-edges`.

**Target behaviour:**
- Every `host: "copilot"` ledger line carries `tokensBasis: "inclusive"` (§3.2), placed after `tokens`
  (decided: the map's placement, under the owner's delegation of detailed design, 2026-10-12; key order is part
  of the bytes).
- Session `tokens` = the host's per-category totals summed over `modelMetrics`, **not** netted (§3.2.1).
- Each dispatch's `tokens` is `null`: the host gives one total and no category split, and a port "MUST NOT
  invent a category split" (§3.2.1). No `tokensAttributed: false` on those dispatches and no
  session `tokensAttribution` caused by them: under `inclusive` "an unavailable dispatch split is implied
  by the basis and is not an attribution gap" (§3.2.1). The Copilot per-dispatch total is dropped, with no
  informative field (decided, Q6).
- Copilot live dispatch records store `tokens: null` the same way.
- Readers: `lineTokens` and batch-cost must not add dispatch tokens of an inclusive line; batch-cost
  allocates an inclusive line's tokens once at session grain (§5.4), so its dispatches contribute no
  tokens to `cases[].direct` (their dollars were never per-dispatch on Copilot). `cost.json` gains
  `sources.inclusiveSessions: <n>` with a note that their token split is unallocated (decided, Q6).
- Reference-era Copilot lines (no `tokensBasis`) keep today's reading (§7.2: they read as `parent`).

**Engine change sites:** engine code: `captureCopilotSession` and `captureCopilotDispatches` in
`tokenomics/hooks/telemetry-capture.mjs` (`:868-967`, `:478-518`); `lineTokens` and the per-role tokens in
`buildReport` (`tokenomics/scripts/team-report.mjs:171-215`); `buildBatchCost` parent/dispatch token
handling (`tokenomics/scripts/batch-cost.mjs:314-341`). TA phases `classifyDispatch:direct`/`:overhead`
receive `m.tokens` of 0/null for inclusive dispatches (no TA code change).

**Before-cases:** `seed-copilot-cli`, `cov-copilot-dispatch` (registry); also declare
`seed-copilot-no-usage` and `cov-capture-copilot-edges`, which write Copilot lines. (Corrected at landing, Plan 4
Task 8: the check also found two Copilot-writing cases the map did not list, `before-scope-precedence` (a Copilot
line `sp` from the catch-up sweep) and `cov-capture-dispatch-edges` (a Copilot live record in `live/cpx.jsonl`);
both are declared.)

**Declared diff shape:**
- `seed-copilot-cli`, `seed-copilot-no-usage`, `cov-capture-copilot-edges`, `before-scope-precedence`:
  `.agents/telemetry/automation/usage-corpus.jsonl` Copilot lines: `tokens.input` un-netted (e.g. 1000 →
  1500 in `seed-copilot-cli`; 0 stays 0 in `seed-copilot-no-usage` until item 4 makes it `null`), new
  `tokensBasis: "inclusive"`, every `subagents[].tokens` → `null`.
- `cov-copilot-dispatch`: the same in the ledger line; `.agents/telemetry/automation/live/cp1.jsonl`
  records' `tokens` → `null`; `.agents/telemetry/automation/reports/camp-wave-01.html` (the live page
  rendered from those records) changes token figures.
- `cov-capture-dispatch-edges`: `live/cpx.jsonl` record `u1` `tokens` → `null` (its live-log record only; no render).
- Period/batch report cases reading only reference-era Copilot lines (`cov-reports-ledger`,
  `cov-team-report-rollup`) do not change (their seeded lines lack `tokensBasis`).

**Interactions:** `null-unobservable` also edits the same Copilot line (usage-less shutdown → `tokens:
null`, dispatch `toolErrors` → `null`); landing `null-unobservable` first keeps this diff about basis
only. Both declare `seed-copilot-cli`, `seed-copilot-no-usage`, `cov-copilot-dispatch`,
`cov-capture-copilot-edges` and `cov-capture-dispatch-edges`, so each is an interaction (recorded at landing).
Together, `seed-copilot-no-usage` reads `tokensAttribution: "none"`, not `"partial"`: `attributionOf` ignores
the dispatches of an inclusive line. `shared-allocation` and `active-minutes` change the same batch-cost code paths afterwards.
`writer` must land after this (§18.5: the reference reader double-counts inclusive Copilot records, so
`writer` lines must already be inclusive). Join replay fixture per D5.

**Switchability:** harness yes; production no: no off-combination is contract-valid once `writer` is on
(D6 table; Q3 decided the production set `{}`).

**Acceptance tests:** `tokenomics/hooks/telemetry-capture.test.mjs` "copilot session: inclusive basis,
un-netted totals, null dispatch split", "copilot live record: null tokens"; `team-report.test.mjs`
"lineTokens ignores dispatch tokens of an inclusive line"; `tokenomics/fixtures/join/copilot-inclusive-session/`
(D5: session-grain token allocation of an inclusive line, plus a deliberately dispatch-grain variant that
must report `inclusive-dispatch-split`); kit `check` over the after-lines: `tokensBasis` invariant (§3.8)
`unverified`, never `error`; declared diffs above.

### Item 4 — `null-unobservable`

**Spec:** §14.8 item 4 "`null` for unobservable counters/usage (§10.5)"; §3.2 ("null = host does not
expose it (NEW: never 0-for-unknown)"; `tokens` null = unmeasured; `skills` null = not observable);
§7.2/§7.4 (the reference variants); §10.5.

**Reference behaviour today:**
- Copilot shutdown without usage writes a zero quad, no attribution flag:
  `reference/49577c7/hooks/telemetry-capture.mjs:961-968`, engine
  `tokenomics/hooks/telemetry-capture.mjs:933-940`. Pinned by `seed-copilot-no-usage`.
- Copilot dispatch `toolErrors: 0` (the host reports none), `activeMin` 0 without `durationMs`, `toolCalls`
  0 without `totalToolCalls`: `reference/49577c7/hooks/telemetry-capture.mjs:941-942`, `:525-526`; engine
  `tokenomics/hooks/telemetry-capture.mjs:913-914`, `:501-502`. Pinned by `seed-copilot-cli`,
  `cov-copilot-dispatch`, `cov-capture-copilot-edges` (sub `k1` with activeMin 0).
- VS Code `toolCalls: 0` and `skills: []` unconditionally, tokens summed with `num()` so missing usage is 0:
  `reference/49577c7/hooks/telemetry-capture.mjs:1129-1130`, `:1179-1180`, `:1185`; engine
  `tokenomics/hooks/telemetry-capture.mjs:1101`, `:1151-1152`, `:1157`. Pinned by `seed-vscode-credits`,
  `seed-vscode-no-credits`, `cov-capture-vscode-edges`.
- A session with no timestamps writes `wallMin: 0`, `activeMin: 0` (`timeStats`,
  `reference/49577c7/hooks/telemetry-capture.mjs:179-192`, engine `tokenomics/hooks/telemetry-capture.mjs:181-194`;
  VS Code `reference/49577c7/hooks/telemetry-capture.mjs:1177`, engine
  `tokenomics/hooks/telemetry-capture.mjs:1149`). Pinned by `cov-capture-vscode-edges` (session `g`),
  `cov-capture-copilot-edges` (`k4`), `cov-capture-claude-parse`, `cov-capture-scope-live`.

**Target behaviour:**
- Copilot: a shutdown whose `modelMetrics` carry no usage → `tokens: null` with
  `tokensAttribution` from `attributionOf` (`"none"` when no dispatch is measured, else `"partial"`; §3.2: present
  iff some unit's usage is unmeasured). Dispatch `toolErrors:
  null` always (not exposed by `subagent.completed`); dispatch `activeMin: null` when `durationMs` is
  absent; dispatch `toolCalls: null` when `totalToolCalls` is absent.
- VS Code: `toolCalls: null`, `skills: null` (§7.2: not observable); `tokens: null` when no request carries
  `promptTokens` or `completionTokens` (with `tokensAttribution: "none"`). VS Code `activeMin` keeps the
  §4.2 registry definition ("missing `elapsedMs` ⇒ 0"). Cache categories stay 0 (decided, Q8a).
- Any host: a session with no timestamps writes `wallMin: null` and `activeMin: null` (decided, Q8b).
- Readers (Obligation O1, owned here): the period report (`buildReport`) and the join (`buildBatchCost`) stop
  adding `null` (or absent) counters as 0. Each additive quantity (`tokens` per category, `activeMin`, `wallMin`,
  `turns`, `toolCalls`, `toolErrors`) gets an `unmeasured: n` count beside its sum in every aggregate bucket
  (totals, by person/week/host/role/intent, `cost.json` totals/cases/overhead/byRole). The existing unpriced count
  stays. The sum covers measured values only. The field names and rendering are decided (Q8d): `unmeasured: {tokens,
  activeMin, wallMin, turns, toolCalls, toolErrors}` per bucket, rendered in Markdown/HTML as "n unmeasured" beside
  each sum. Whether to
  count is not a question: §3.2.1 requires it.

**Engine change sites:** engine code: `captureCopilotSession`, `captureCopilotDispatches`,
`parseVsCodeChatSession`/`captureVsCodeSession`, `timeStats` consumers in
`tokenomics/hooks/telemetry-capture.mjs`; the reader half (O1): `num()`-based sums in `bucket`/`addLine`/`addTok`
and by-role in `tokenomics/scripts/team-report.mjs`, `addTo`/`bucketOut`/`roleAdd` in
`tokenomics/scripts/batch-cost.mjs`, and the renderers that print those sums. TA render phases receive the new
count fields (an API 2 contract change, D3).

**Before-cases:** `seed-copilot-no-usage`, `seed-vscode-credits`, `seed-vscode-no-credits` (registry);
`before-vscode-no-usage` (two VS Code chatSessions op-logs whose requests carry no `promptTokens`/`completionTokens`,
`vu1` with credits and `vu2` without; `--sweep --all` captures both with tokens `{0,0,0,0}` and no
`tokensAttribution` today). Also declared:
`seed-copilot-cli`, `cov-copilot-dispatch`, `cov-capture-copilot-edges`, `cov-capture-vscode-edges`,
`cov-capture-claude-parse`, `cov-capture-scope-live` (timestamp-less sessions; decided, Q8b).
The reader half (O1) is pinned by `cov-reports-ledger`: dispatch `b3` of line `s-a2` has `tokens: null`, which
the period report (events 4–12) sums as a zero quad with no count, and which `batch-cost` (events 0–1) counts only
as `unattributedUnits: 1`. That case is declared for the reader half. For a parent `tokens:null` / `activeMin:null`
line (Repro E), no case exists yet: Plan 4 adds one with this item (named in the acceptance tests below).

**Declared diff shape:**
- `seed-copilot-no-usage`: ledger line `tokens` → `null`, new `tokensAttribution: "partial"`,
  `subagents[0].toolErrors` → `null`. (Corrected at landing, Plan 4 Task 7: the flag is computed by `attributionOf`
  over the parent and every dispatch, and dispatch `tc1` carries a measured `totalTokens`, so under the `parent`
  basis the line is `partial`; `none` holds for a usage-less shutdown with no measured dispatch. Under
  `copilot-inclusive` the flag describes the session total only, §3.2.1: Plan 4 Task 8 records the interaction,
  where `seed-copilot-no-usage` reads `"none"`.)
- `seed-copilot-cli`, `cov-copilot-dispatch`, `cov-capture-copilot-edges`: `subagents[].toolErrors` →
  `null` (and `activeMin`/`toolCalls` where the event lacks the field); `cov-copilot-dispatch`'s
  `live/cp1.jsonl` records likewise and its live page if it renders them; `cov-capture-copilot-edges`
  `k4` `wallMin`/`activeMin` → `null` (Q8b).
- `seed-vscode-credits`, `seed-vscode-no-credits`, `cov-capture-vscode-edges`: every VS Code line
  `toolCalls` → `null`, `skills` → `null`; session `g`'s `wallMin`/`activeMin` → `null` (Q8b).
- `before-vscode-no-usage`: `tokens` → `null`, `tokensAttribution: "none"`, `toolCalls`/`skills` → `null`.
- `cov-capture-claude-parse`, `cov-capture-scope-live`: timestamp-less Claude lines' `wallMin`/`activeMin`
  → `null` (Q8b).
- Reader half (O1): `cov-reports-ledger`: period-report streams (events 4–12) count the null `reviewer` dispatch
  tokens of `s-a2` as unmeasured (e.g. event 6 `byRole.reviewer` gains an unmeasured count instead of folding a
  zero quad); `batch-cost` stdout (events 0–1) gains the per-quantity counts beside `unattributedUnits`. That
  case's period-report streams are shared with items 1, 2, 7, 8, 22 and 23 (interaction declarations, §4).
- **Actual declared set at landing (Plan 4 Task 7, the `write` run is the authority): 34 cases.** Beyond the
  predicted cases above (`cov-capture-sync` showed no difference and is not declared), Q8d's `unmeasured` object on
  every aggregate bucket changes every case that writes a `cost.json` or a period `--json` stream:
  `cov-team-report-batches`, `cov-team-report-rollup`, `cov-batch-cost-edges`, `seed-receipts-waves`,
  `seed-receipts-shared-id`, `foreign-settings`, `foreign-null-extension`, `cov-work-scope-close-faults`,
  `before-dispatch-two-groups`, `before-export-anon-batch`, `before-ids-substring`, `before-ratio-manifest`,
  `before-report-windows`, `cov-export-cli`, `cov-export-submission-edges`, `fault-batch-cost-empty-repo`,
  `fault-batch-cost-sizing-locked`, `fault-batch-cost-unreadable`, `fault-gate-fold-symlink`, `cov-dispatch-batch`,
  `before-report-unknowns` (most only gain all-zero counts; lines that omit a counter, e.g. `cov-batch-cost-edges`,
  read it as unmeasured, a null sum and a null `loaded` figure). Two capture cases join: `cov-capture-dispatch-edges`
  (a Copilot live record with no data: null counters) and `cov-capture-pricing` (the folded `agent-gone` record's
  absent `toolCalls`/`toolErrors` → `null`). Interactions recorded: `before-ids-substring` (`exact-ids` +
  `null-unobservable`, `g1/cost.json`) and `cov-capture-pricing` (`fold-flags` + `null-unobservable`, the ledger).
  **Consequence for later migrations:** every `cost.json` and period `--json` case now carries `null-unobservable`,
  so a later migration that changes one of those files must declare an interaction naming `null-unobservable`
  (e.g. `shared-allocation` on `before-dispatch-two-groups`, `report-windows` on `before-report-windows` /
  `before-ratio-manifest`, `reports-location` on the moved `cost.json` files). ENGINE-B1 §"Migrations (B2)"
  lists the full set.

**Interactions:** first of the capture-shape migrations after `fold-flags`; `copilot-inclusive` then edits
the same Copilot lines. `writer` lines must already be null-correct. Renderers reading these counters
(`team-report`, `batch-cost`) use `num()` today. The reader half (O1) adds `unmeasured` counts there, so every
report case that reads a `null` counter changes too (the `write` run finds them). Item 4 and `copilot-inclusive`
both change the Copilot ledger lines of `seed-copilot-cli`, `seed-copilot-no-usage`, `cov-copilot-dispatch` and
`cov-capture-copilot-edges`. Both declare those files, so each such case needs an interaction declaration naming
both (and `writer` and `fold-flags` where they touch the same file; §4).

**Switchability:** harness yes; production no: no off-combination is contract-valid once `writer` is on
(D6 table; Q3 decided the production set `{}`).

**Acceptance tests:** `telemetry-capture.test.mjs` "copilot usage-less shutdown → tokens null + attribution
none", "copilot dispatch counters null when absent", "vscode toolCalls/skills null", "vscode usage-less →
tokens null"; reader half (O1): `team-report.test.mjs` "null tokens/minutes/counters counted as `unmeasured`,
never added as 0", `batch-cost.test.mjs` "null activeMin/toolCalls/toolErrors counted, not zeroed", declared diff
`before-report-unknowns`; kit `check` on the after-lines (no `zero-for-unmeasured` limitation for `writer` lines once
item 11 lands); declared diffs above.

### Item 5 — `anon-complete`

**Spec:** §14.8 item 5 "Complete anonymisation of supplied strings (§10.4)"; §10.4.

**Reference behaviour today:**
- `--anon` exists only on `--submission`: `reference/49577c7/scripts/build-tokenomics-export.mjs:283`
  (engine `tokenomics/scripts/build-tokenomics-export.mjs:284`). The `--batch` path ignores `--anon`
  entirely (`reference/49577c7/scripts/build-tokenomics-export.mjs:288-295`, engine
  `tokenomics/scripts/build-tokenomics-export.mjs:293-296`). **Correction to Task 10's planned scenario:**
  `--batch b1 --anon --stdout` prints an un-anonymised row, so it does not exhibit §10.4; the defect is in
  the submission's anonymised copy.
- Each run row's notes embed the group slug twice, in a path and as `batch slug '<slug>'`:
  `reference/49577c7/scripts/build-tokenomics-export.mjs:135` (engine: TA extension
  `tokenomics/extensions/test-automation.mjs:652`). `anonymizeDoc` replaces `work_item_ref`,
  `work_item_brief` and the `batch slug '…'` phrase only, so `.agents/automation/<slug>/cost.json`
  survives: `reference/49577c7/scripts/build-tokenomics-export.mjs:185-194`, engine
  `tokenomics/scripts/build-tokenomics-export.mjs:174-182` + `tokenomics/extensions/test-automation.mjs:659-664`.
- Existing evidence: `cov-export-submission-edges` runs `--submission --anon`, but its hand-accumulated
  notes contain no path, so its anonymised `datasets/UNSET-factory-id/runs.json` leaks nothing. The
  path leak is pinned only by `before-export-anon-batch` (corrected scenario below).

**Target behaviour:**
- In the anonymised submission (`export/datasets/<id>/runs.json` and `submission.md`), no supplied
  identifier survives in any string field: group slugs (also inside paths), `work_item_ref` values, receipt
  paths. Decided (the map's design, under the owner's delegation of detailed design, 2026-10-12): the extension's `exportRow:anonymize` scrubs its own domain fields (TA: brief, notes).
  The engine then applies its own guarantee, independent of the extension (Codex P3-09, Obligation O9):
  1. Before replacing anything, it collects the **scrub set**: the union of every supplied identifier from
     **every** row of the submission and from the submission document itself (group slugs, `work_item_ref`
     values, receipt paths and the other Q9 members). The engine derives the slug and path members itself, by
     enumerating every group receipt under `settings.receipts` with `loadReceipts` (each slug, a nested slug's last
     segment, and the group directory, receipt-file and `cost.json` paths), so it needs no extension; an extension
     may add members through an optional `scrub` array in its `anonymize` result. No field is added to the rows.
  2. It replaces every occurrence of **any** member of that set with `anonymised` in **every** output string:
     every row's string fields at any depth (including nested objects, arrays and extension-returned fields),
     the document-level strings, and `submission.md`.
  A note in row A that names row B's slug or reference is therefore scrubbed. A per-row scan of a row's own
  identifiers would miss it. Occurrences are matched at token/path-segment boundaries, so a short slug (`b1`)
  does not corrupt unrelated text such as model names or hashes. The set and the boundary rule are decided (Q9): group slugs, `work_item_ref` values,
  receipt paths and briefs (not model names or segment profile values), matched on a whole-token or path-segment
  boundary.
- `--batch` output is not anonymised (it is the project's own record); unchanged.

**Engine change sites:** both: `anonymizeDoc` (`tokenomics/scripts/build-tokenomics-export.mjs:174-182`)
and the TA `exportRow:anonymize` phase (`tokenomics/extensions/test-automation.mjs:659-664`).

**Before-cases:** `before-export-anon-batch` (`cov-export-cli`'s profile, ledger line and `b1` receipt;
`build-tokenomics-export.mjs --batch b1` appends the row whose notes name `.agents/automation/b1/cost.json`,
then `--submission --anon`; `textFacts` on `export/datasets/fx-qa-01/runs.json`: the notes include
`.agents/automation/b1/cost.json` and `batch slug 'anonymised'`). `cov-export-submission-edges` was replaced
in the registry entry (no leak in its inputs, predicted not to change).

**Declared diff shape:** `before-export-anon-batch` (one row, so the union equals that row's own set):
`.agents/telemetry/automation/export/datasets/<id>/runs.json` `runs[0].notes` path segment `b1` → `anonymised`, and any
other string in the document holding a member of the scrub set (the slug `b1` or the receipt path
`.agents/automation/b1/report.json`) likewise; `submission.md` changes only where it holds a set member (it quotes no
notes today, `reference/49577c7/scripts/build-tokenomics-export.mjs:209-232`). Streams unchanged. With several rows,
the union also scrubs cross-row mentions: Plan 4's `write` run re-checks `cov-export-submission-edges` (several
accumulated rows; predicted unchanged only if no row's strings name another row's identifier) and declares it if it
changes.

**Interactions:** none in code. The API 2 freeze records the `exportRow:anonymize` return contract (D3).

**Switchability:** harness yes; production no.

**Acceptance tests:** `build-tokenomics-export.test.mjs` "anonymised doc contains no supplied identifier in
any string" (property over **every** string of the whole document and `submission.md`, against the union set,
not each row's own set); "cross-row: row A's note names row B's slug and row B's `work_item_ref` → both
scrubbed"; "nested and extension-returned string fields scrubbed"; "a short slug does not corrupt an unrelated
token (boundary rule, Q9)"; TA
`test-automation.test.mjs` "anonymize scrubs the cost.json path"; declared diff `before-export-anon-batch`.

### Item 6 — `fold-flags`

**Spec:** §14.8 item 6 "Fold recomputes session flags (§10.5)"; §3.2 (`tokensAttribution` "present iff some
unit's usage is unmeasured", `models` sorted/distinct, dispatch `tokens` quad|null, `tokensByModel`);
§7.2 "Claude, folded dispatch" variant; §10.5.

**Reference behaviour today:**
- `foldDispatchLog` appends live-log dispatches missing from the line with `tokens: r.tokens` (so an absent
  `tokens` key disappears from JSON), no `tokensByModel`, no `tokensAttributed`; adds `activeMin`, cases and
  dollars; sets `foldedFromLive`; does **not** recompute `tokensAttribution` or `models`:
  `reference/49577c7/hooks/telemetry-capture.mjs:470-491`, engine `tokenomics/hooks/telemetry-capture.mjs:446-467`.
  Flags are computed before the fold from transcripts only:
  `reference/49577c7/hooks/telemetry-capture.mjs:761-764`, engine `tokenomics/hooks/telemetry-capture.mjs:733-736`.
- Pinned by `cov-capture-pricing` (seeded live record `{"agentId":"agent-gone",...,"activeMin":2}` with no
  tokens: the folded dispatch has no `tokens` key and the line has no `tokensAttribution`),
  `seed-claude-folded` (a measured live record without `tokensByModel`), `cov-dispatch-batch`
  (`agent-gone` folded into a line already `partial`).

**Target behaviour:**
- Folded dispatch entries have the §3.2 dispatch shape of a Claude capture: `tokens: r.tokens ?? null`,
  `tokensAttributed: false` when tokens are null or `r.tokensAttributed === false`, `tokensByModel:
  r.tokensByModel ?? {}` in the same key position as captured entries
  (`reference/49577c7/hooks/telemetry-capture.mjs:780-790`).
- After the fold the line's `tokensAttribution` is recomputed over the parent and every dispatch
  (complete → key absent, some → `partial`, none measured → `none`), and `models` = sorted union with the
  folded entries' `tokensByModel` keys.
- `foldedFromLive`, `dispatches`, `activeMin` (Claude registry definition, §4.2), `cases`, `costUsd`
  handling unchanged.

**Engine change sites:** engine code: `foldDispatchLog` (`tokenomics/hooks/telemetry-capture.mjs:446-467`).

**Before-cases:** `seed-claude-folded` (registry; predicted change: `subagents[0]` gains
`tokensByModel: {}` only — weak), plus `cov-capture-pricing` (strong; in `beforeCases`)
and `cov-dispatch-batch` (declared because its folded entry gains `tokensByModel`/flag shape).

**Declared diff shape:**
- `cov-capture-pricing`: ledger line `p1`: `subagents[agent-gone]` gains `tokens: null`,
  `tokensAttributed: false`, `tokensByModel: {}`; line gains `tokensAttribution: "partial"`.
- `seed-claude-folded`: `subagents[0]` gains `tokensByModel: {}` (key order per captured entries); no flag
  change (the folded record is measured).
- `cov-dispatch-batch`: line `cd1` `subagents[agent-gone]` gains `tokensByModel: {}`; `tokensAttribution`
  stays `partial`. Its `cost.json`/renders do not change (batch-cost reads `tokens`, unchanged).

**Interactions:** first capture-shape migration (§4). `null-unobservable` and `writer` later touch the same
lines. A folded entry's `tokensByModel` feeds batch-cost `addByModel`
(`tokenomics/scripts/batch-cost.mjs:339`), so a folded record that carries per-model quads would add a
`tokensByModel` entry to `cost.json`; none of the before-cases has one.

**Switchability:** harness yes; production no: no off-combination is contract-valid once `writer` is on
(D6 table; Q3 decided the production set `{}`).

**Acceptance tests:** `telemetry-capture.test.mjs` "fold: unmeasured folded dispatch → tokens null +
tokensAttributed false + line partial", "fold: models union", "fold: complete stays flag-free"; declared
diffs above.

### Item 7 — `active-minutes`

**Spec:** §14.8 item 7 "Active minutes no longer partitioned across dispatches (§5.4)"; §5.4 ("Active
minutes are never partitioned across dispatches (concurrent dispatches overlap)"); §3.2.1 (`activeMin` is
host-defined). **Citation corrected (Codex P3-05):** §3.2.1's by-role rule ("By-role dollars = the parent
session's role, inclusive", `docs/spec.md:234`) is about **dollars**, not minutes. Inclusive by-role dollars
are Obligation O3 (item 23 `role-dollars`, decided Q1a), not this item. The parent-inclusive by-role **minutes**
presentation below is decided (Q7) and follows from §5.4 (minutes are not partitioned, so subtracting dispatch
minutes from the parent is itself a partition).

**Reference behaviour today:**
- The join subtracts Σ dispatch `activeMin` from the session's to get the lead's minutes, then adds each
  included dispatch's minutes to case/stage buckets: `reference/49577c7/scripts/batch-cost.mjs:519-536`,
  `:550-553`, `:565-573` (via `addTo`, `:278-286`); engine `tokenomics/scripts/batch-cost.mjs:301-318`,
  `:332-350`, `:184-192`. `loaded.activeMin` adds an even overhead share
  (`reference/49577c7/scripts/batch-cost.mjs:614-626`, engine `tokenomics/scripts/batch-cost.mjs:387-399`).
- The period report's by-role parent minutes also subtract dispatch minutes:
  `reference/49577c7/scripts/team-report.mjs:204`, engine `tokenomics/scripts/team-report.mjs:208`.
- Pinned by `cov-dispatch-batch` (8 dispatches: per-case `direct.activeMin`, `overhead.lead.activeMin`,
  TA `byStage`/`rework` minutes in `cov-d/cost.json`), and by `seed-receipts-shared-id`'s 7-minute line (5
  parent + 2 dispatch, Claude registry definition §4.2).

**Target behaviour:**
- A source session's `activeMin` is allocated once, at session grain: each group the line matched receives
  `activeMin / div` as group-level time (`totals.activeMin`, `overhead.lead.activeMin`). No dispatch
  minutes are subtracted from or added to any bucket.
- Fields whose value was a dispatch partition become `null` (finer allocation left unknown, §5.4):
  `cases[].direct.activeMin`, `overhead.stages.activeMin`, TA `overhead.byStage.*.activeMin`,
  `rework.activeMin`, `byRole.<dispatch role>.activeMin` (decided, Q7).
- `cases[].loaded.activeMin` = group time ÷ number of cases, a labelled allocation (§5.4 permits labelled
  allocations); `stats.directActiveMin` → `null`, `stats.loadedActiveMin` over the new loaded values.
- Period report by-role: the parent role gets the session's full `activeMin` (decided, Q7: no dispatch
  minutes are subtracted, §5.4); dispatch roles keep their measured minutes as a separate breakdown, not summed
  into totals. Parent/dispatch role-name collisions (a dispatch role equal to the parent's) keep the two figures
  apart (Q7). By-role **dollars** do not change here (O3, item 23).
- **As landed (Task 10):**
  - **Not allocated is not unmeasured.** A dispatch contributes `activeMin: null` with its `nul.activeMin` key
    null ("not applicable"), so no bucket counts it in `unmeasured`. The partition fields read `null` beside an
    `unmeasured.activeMin` of 0. Only a session whose own `activeMin` is null (Q8b) counts as unmeasured, in
    `totals`, `overhead.lead`, the parent role and (through `totals`) `loaded`. A null dispatch minute no longer
    counts anywhere in `cost.json`; in the period report it counts in `byDispatchRole` (O1).
  - **The 1/k weight never reaches minutes.** `shared-allocation`'s `w = 1/k` still splits a shared dispatch's
    count, tokens, tool counters and measured dollars, but the dispatch carries no minutes. Each group's minutes
    are the line's `activeMin / div` (the sessions-it-served split), whatever k is. Pinned in `batch-cost.test.mjs`
    (k = 2 and k = 3) and by the `activemin-session-grain` join fixture.
  - `cost.json` gains `sources.activeMinGrain: "session"` and `sources.activeMinNote` (always, under the
    migration). `loaded.activeMin` = round(`totals.activeMin` / cases), null when the group time is unmeasured.
  - The period report's dispatch breakdown is `byDispatchRole: {<role>: {units, activeMin[, unmeasured]}}` (present,
    possibly empty, in every `--json`), rendered as its own "Dispatch minutes by role" table (minutes, labelled as
    overlapping and outside every total). A dispatch-only role reads `activeMin: null` in `byRole`.
  - A live (provisional) line's own minutes are not measured yet, and its dispatch minutes are never summed into
    session time (they overlap, §5.4: three parallel 30-minute dispatches are not 90 minutes). With
    `null-unobservable` the live line's `activeMin` is `null`, so the group time reads "— (1 unmeasured)" beside
    the PROVISIONAL callout; without it the line keeps the reference 0 (review round 1, I1; the round-0 "floor"
    sum was withdrawn).
  - As landed (Codex B2-07): the same live line's `tokens`, `turns`, `toolCalls` and `toolErrors` are `null` with
    `null-unobservable` (the parent is not measured yet; it was given a zero quad and zero counters, which invented
    a measured unit). The join counts the parent as unmeasured, so an all-unmeasured live batch has `totals.tokens`
    `null`, `tokensAttribution` `"none"`, `turns` `null` with `unmeasured.turns` 1, and the page prints
    `— (n unmeasured)`. The gate is the producer's (`loadLiveLines`): the reader reads the line's own fields.
  - TA sizing: a null direct minute with no unmeasured count is not allocated, so a case has no actual minutes, no
    minute percentile, and `hiMin` cannot fire (an above-p90 flag is token-driven; its detail drops the case's
    minutes and the class minute median). The batch-grain comparison stays: `bySize.*.actualMin` and
    `estVsActualMin.actual` sum the sized rows' `loaded.activeMin` (group time ÷ items) and carry
    `actualMinBasis` / `basis: "allocated"`, rendered "(allocated: batch time ÷ cases)". A loaded minute that is
    null and counted unmeasured stays unmeasured: `actualMin` null with `actualMinUnmeasured: n`, rendered
    "— (n unmeasured)", and no comparison (review round 1, I2).
  - Rounding: each group's minutes are `activeMin / div` rounded once at output, so the groups of one session
    together are within div/2 minutes of it. For div ≥ 4 that can exceed the kit's 1-minute per-source tolerance
    (2 minutes over 4 groups: 1 each, 4 in all). The kit checks hand-written traces, not `cost.json`, and the same
    bound holds for every session-level split (`div`, clusters, `shared-allocation`'s k); minutes are now entirely
    session-level, so they meet it more often (review round 1, M5).
  - Period by-role table: a footnote says "— = not allocated at this grain" (M4); the batch per-item heading gives
    "loaded minutes = <group> time ÷ <items>" (M2).
  - Renderers: a null minute reads `—` (no count). The batch views replace "(items Nm · lead Nm · stages Nm)"
    with "(session grain — not split per <item>, stage or dispatch)" and show only the loaded spread.

**Engine change sites:** engine code: `buildBatchCost` (`tokenomics/scripts/batch-cost.mjs:301-399`),
`buildReport` by-role (`tokenomics/scripts/team-report.mjs:205-214`), renderers that print these minutes
(`renderBatchMarkdown`/`Html`, `renderBatchTokenomics*`, `renderMarkdown`/`renderTeamHtml`). TA phases:
`classifyDispatch:direct`/`:overhead` stop receiving `m.activeMin` (or receive `null`), and TA's
`render-md` `cost` part (`tokenomics/extensions/test-automation.mjs:91-101`) must render `null` minutes
(extension change).

**Before-cases:** `cov-dispatch-batch` (registry). Also declared: every batch/report case whose dispatches
carry minutes: `seed-receipts-shared-id`, `cov-reports-ledger`, `cov-team-report-batches`,
`cov-team-report-rollup` (per-role minutes), `cov-batch-cost-edges`, `seed-receipts-waves`,
`cov-copilot-dispatch` (live page), `cov-work-scope-close-faults`, `fault-batch-cost-sizing-locked`,
`foreign-settings`, `foreign-null-extension` (Plan 4's `write` run is the authority).

**Declared diff shape:**
- `cov-dispatch-batch`: `.agents/automation/cov-d/cost.json`: `cases[].direct.activeMin` → `null`,
  `cases[].loaded.activeMin` re-derived, `overhead.lead.activeMin` = line minutes, `overhead.stages.activeMin`
  / `overhead.byStage.*.activeMin` / `rework.activeMin` → `null`, `byRole.*.activeMin` (dispatch roles →
  `null`), `stats.directActiveMin` → `null`, `stats.loadedActiveMin`; the two `batch-report` renders in `cov-d/`
  (the `batch-tokenomics` renders print only `totals.activeMin`, which does not change here: corrected in Task 10);
  `.agents/telemetry/automation/reports/cov-d.html`. `__events__/6.stdout` (`status`) does not change (it prints
  the ledger line, not `cost.json`) and `export/runs.json` does not change.
- Period report cases: `__events__/<i>.stdout` by-role rows, plus the `byDispatchRole` breakdown.

**Interactions:** after `shared-allocation` (both rewrite the per-dispatch weights; item 7 then removes
minutes from them). `report-windows` changes the same period reports afterwards. Join replay fixture per
D5.

**As recorded (Task 10).** The `write` run declared 23 cases and refused none. Every case that writes a
`cost.json` or a period / batch-cost `--json` stream changes, because every `cost.json` now carries
`sources.activeMinGrain` and null per-case direct minutes (a case with no dispatch had a true 0 there), and every
period `--json` gains `byDispatchRole`. Beyond the map's list (all 12 declared): `before-dispatch-two-groups`,
`before-ids-substring`, `before-export-anon-batch`, `before-ratio-manifest`, `before-report-unknowns`,
`before-report-windows`, `cov-export-cli`, `cov-export-submission-edges`, `fault-batch-cost-empty-repo`,
`fault-batch-cost-unreadable`, `fault-gate-fold-symlink`. No `export/runs.json` changes. In `cov-reports-ledger`
`solo`'s total moves 68 → 60 (excluded foreign dispatches no longer move minutes) and TA sizing's
`estVsActualMin` becomes the allocated batch-grain comparison over loaded minutes, labelled as an allocation over loaded minutes (review round 1). Interactions (all 23 cases): `null-unobservable` + `active-minutes` on every `cost.json` /
`--json` overlap; `before-dispatch-two-groups` and `seed-receipts-shared-id` name `null-unobservable`,
`shared-allocation` and `active-minutes` (their `cost.json` and `batch-report` renders); `before-ids-substring` names
`exact-ids`, `null-unobservable` and `active-minutes`; `cov-copilot-dispatch` names `null-unobservable`,
`copilot-inclusive` and `active-minutes` (the live page).

**Switchability:** harness yes; production no: no off-combination is contract-valid (§5.4 required; D6 table; Q3 decided the production set `{}`).

**Acceptance tests:** `batch-cost.test.mjs` "activeMin allocated at session grain; dispatch-partition
fields null"; `team-report.test.mjs` "by-role parent minutes inclusive"; TA
`test-automation.test.mjs` "render-md cost part with null minutes";
`tokenomics/fixtures/join/activemin-session-grain/` (D5: session-grain minute allocation of a
multi-dispatch line across two groups, zero violations; the existing `grain-activemin-dispatch` fixture
stays the negative control); declared diffs above.

### Item 8 — `report-windows`

**Spec:** §14.8 item 8 "Report windowing (§5.5)"; §5.5; §5.2 (receipt ordering); §3.1/§14.4 (D1).

**Reference behaviour today:** (details under "Window semantics")
- Window = `--since`/`--until` calendar dates compared inclusively with the **local** date of `startedAt`;
  when `--since` or `--until` is given, lines without `startedAt` are dropped (without either flag no
  line is filtered, `reference/49577c7/scripts/team-report.mjs:95`); no default window (all time):
  `reference/49577c7/scripts/team-report.mjs:76-81`, `:94-103`, `:814-817`; engine
  `tokenomics/scripts/team-report.mjs:80-85`, `:98-107`, `:846-849`.
- Delivered count = latest outcome per id across receipt files ordered by file mtime, never windowed:
  `reference/49577c7/scripts/team-report.mjs:143-157`, engine `tokenomics/scripts/team-report.mjs:147-161`.
- `perDelivered.costUsd` = all priced in-window spend ÷ delivered; `automationOnlyCostUsd` = the
  `automation` intent bucket ÷ delivered: `reference/49577c7/scripts/team-report.mjs:241-247`, engine
  `tokenomics/scripts/team-report.mjs:233-236`, `:249-255` (engine sums `settings.ratioIntents`).
- Pinned by `cov-team-report-rollup` (registry), `cov-reports-ledger` (`--since/--until`),
  `cov-team-report-batches` (period rollup), `foreign-settings` (event 4), and `before-report-windows`.

**Target behaviour:** §5.5 exactly, per step below. `ratioIntents`, delivered outcomes and the receipt policy are
bound per line by D1's reading rule (Obligation O4): a revisionless line (no `manifestRevision` key) uses the implied
legacy manifest, a revisioned line uses its archived revision, and a missing archive is unverified (decided, Q11b), as is
an explicit `manifestRevision: null` (finding `manifest-revision-unknown`; Task 14 review round 1, I1). The report states the
current-state semantics and the cumulative-line limitation (§5.5). Output field names: the map's (decided, Q10a). Two reader
obligations also shape this report:
- **Deduplicated sessions (O2).** Step 3 counts §3.5-deduplicated sessions. Until item 22 `report-conflicts`
  lands, the reference dedup is a transitional state, not an end state. Item 22 then makes conflicting exact ties
  leave the verified numerator, and that change needs interaction declarations with this item on the period-report
  cases (§4). **As landed (Task 15 + review round 1):** conflicting ties leave every verified total (the numerator
  included); only `cov-team-report-rollup` holds an exact tie, and the host:id read order (I3) touches the period streams of
  `before-ratio-manifest`, `cov-reports-ledger`, `cov-team-report-batches` and `foreign-settings`, so those five interactions
  name `report-conflicts` (§4).
- **Unknowns (O1).** Item 4's reader half counts `null` counters, and the ratio's `priced`/`eligible` coverage
  counts unpriced sessions. Nothing unknown is read as 0.
- **B1 defaults (O8).** With this migration disabled, settings use the frozen `B1_DEFAULTS` (D1), so `none`
  keeps today's `settings.ratioIntents` behaviour after B2 closes.

#### Window semantics

| §5.5 step | today | target |
|---|---|---|
| Window | inclusive local dates on `startedAt` (`reference/49577c7/scripts/team-report.mjs:94-103`); none by default | `[since, until)` UTC instants; default `since` = earliest `endedAt` among in-scope ledger lines, `until` = report time (§5.5). Date-only arguments map to `T00:00:00Z` (Q10d). The whole period report (totals, by person/week/host/role) uses the same `endedAt` window: one window per report (decided, Q10b). |
| 1. Receipts | last-written receipt file by mtime wins per id; missing outcome → `not-started` (`reference/49577c7/scripts/team-report.mjs:144-152`) | dedup per id by (`revision`, `at`, `group`, `source`) (§5.2); the winner's outcome is the current state; a reopened item is a later revision with a non-delivered outcome. Files receipts without `revision`: mtime is a revision **only in reference mode** (§5.2): a revisionless legacy receipt without `revision` is reference-era, so its mtime may serve; a receipt carrying `revision` never uses mtime (decided, Q10c). |
| 2. Denominator | every id whose latest outcome is delivered, regardless of time (`reference/49577c7/scripts/team-report.mjs:156`) | winners whose outcome is delivered **and** whose `at` ∈ window; delivered winners without `at` are excluded and reported as `unwindowed: n`. |
| 3. Numerator | all priced in-window sessions (`perDelivered.costUsd`) and the `automation` bucket (`automationOnlyCostUsd`) (`reference/49577c7/scripts/team-report.mjs:241-247`) | priced `costUsd` of deduplicated sessions with `scope.intent ∈ ratioIntents` (D1) and `endedAt` ∈ window; a session's cumulative line counts wholly in its `endedAt` window, stated as a limitation. |
| 4. Result | `null` only when nothing is priced or delivered = 0 (`reference/49577c7/scripts/team-report.mjs:241-242`); no partial label | `null` when the denominator is 0, no eligible session exists, or none is priced; a measured `$0` is distinct; partial pricing ⇒ `partial: true` with `priced`/`eligible` session counts; role-filtered reports suppress the ratio (unchanged, `reference/49577c7/scripts/team-report.mjs:241`). |

Group cost (`cost.json`, `--batches`) stays membership-based and unwindowed (§5.5 "Group cost stays
membership-based").

#### Fixtures

| §5.5 fixture | case |
|---|---|
| old deliveries + today's spend | `before-report-windows` (`OLD-1` delivered `at` 2026-08-02, 60 days before the 2026-10-01 → 2026-10-07 window; spend inside it) |
| a reopened item | `before-report-windows` (`REO-1`: receipt `reopen-b`, later `revision` and mtime, outcome `in-progress`) |
| repeated ids with conflicting revisions | `before-report-windows` (`CON-1`: `conf-a` has the **older** mtime and the **later** `revision`, outcome `delivered`; `conf-b` the newer mtime, earlier `revision`, `blocked`; today mtime decides → `blocked`; the target follows `revision` → `delivered`) |
| undated outcomes | `before-report-windows` (`UND-1` delivered with no `at`) |
| boundary-spanning sessions | `before-report-windows` (`b1`: `startedAt` 2026-09-30T23:00Z before `--since`, `endedAt` 2026-10-01T01:00Z inside, intent `automation`, $4; dropped today) |
| manifest-bound ratio (D1), stable history | `before-ratio-manifest` (`.agents/telemetry/automation/module.json` `{module, schema_version, domain, manifestRevision: 1, ratioIntents: ["story"]}`; two priced sessions in the window, intent `story` $2 and intent `automation` $0.50; one delivered item with `at`; `team-report --json` captured. Today `automationOnlyCostUsd` = 0.5, the automation session only: the reference ignores `module.json`). **Corrected prediction (P3-06):** its seeded lines carry no `manifestRevision`, so under D1's reading rule they bind to the implied legacy manifest (`['automation']`), **not** to the present `module.json`. The ratio numerator stays $0.50, and only the §5.5 field/semantics changes apply. The case now pins "a current manifest does not reinterpret history", not manifest ownership |
| archived revisions, missing archive (D1, O4) | `before-ratio-revisions`, which Plan 4 adds with this item: `manifests/1.json` (`['automation']`) and `manifests/2.json` (`['story']`) archived, a current `module.json` at revision 3 (`['spike']`), one priced line per revision 1 and 2 plus a revisionless line, and a line naming revision 4 with no archive. The reference ignores all of it (automation bucket only) |

Today's figures in `before-report-windows` (`assert.json`): 2 in-window sessions (`a1` $3 automation, `c1`
$1.50 story), delivered 3 (`OLD-1`, `WIN-1`, `UND-1`) of 5 examined, `perDelivered.costUsd` 1.5,
`automationOnlyCostUsd` 1, `perExamined.costUsd` 0.9. Under the target the denominator is `WIN-1` + `CON-1`
= 2 (`unwindowed: 1` for `UND-1`) and the automation numerator over the `endedAt` window adds `b1`
($3 + $4).

- **As landed (Task 11):**
  - **Fields (Q10a).** `perDelivered = {costUsd, activeMin, priced, eligible[, partial: true]}`: `costUsd` is the
    §5.5 ratio (priced ratio-intent spend ÷ `cases.delivered`), so `automationOnlyCostUsd` is no longer written;
    `activeMin` keeps its reference formula (all windowed sessions' minutes) over the new denominator and is labelled
    "(all sessions)" in Markdown (HTML does not render it; review M2). `cases` gains `unwindowed` (always present);
    `cases.delivered` is the denominator (delivered winners with `at` in the window). `perDelivered` itself is `null`
    when the denominator is 0 or the report is role-filtered (step 4). `perExamined` keeps its formula.
  - **Unverified (controller ruling, Task 3).** A line naming a revision without `manifests/<N>.json` adds to
    `unverified: {sessions, costUsd, priced}` (a top-level sibling of `perDelivered`, present only when non-zero;
    `costUsd` `null` when none of them is priced; `priced` added in review round 1, M3) and to `findings` (`manifest-archive-missing: revision N`, sorted, unique).
    It never enters the numerator, there is no preview total, and its spend stays in the totals.
  - **Semantics.** JSON `semantics` (a string), the same sentence in italics under the Markdown header and as a
    `meta` paragraph in HTML: the current-state rule, the reopen effect, the cumulative-line limitation, and that
    totals cover the windowed sessions while sessions without `endedAt` are outside every window and counted as
    undated (review M8).
  - **Window.** `since` defaults to the earliest `endedAt` of the deduplicated lines before `--role` filtering;
    `until` to the report time; the label is `<since ISO> → <until ISO>` (`—` when no line has `endedAt`). A line
    without a readable `endedAt` lies in no window, so it leaves every total (§5.5 + Q10b; corpus: `m2`, `m3`, `d5`
    in `cov-team-report-rollup`, `s-nostart` in `cov-reports-ledger`); it is counted beside the ratio as
    `undated: {sessions, costUsd, priced}` (top level, present only when non-zero, never in a window total) and
    rendered in Markdown and HTML (controller ruling, review round 1 I2; O1). Dates are ISO-8601 only
    (`parseInstant`): a date is `T00:00:00Z` (Q10d), a date-time without an offset is read as UTC, never local time;
    an unreadable or non-ISO `--since`/`--until` exits 2, and a non-ISO receipt `at` counts as no `at` (review M1).
  - **Receipts (D1, controller ruling I1).** A receipt stamped with a `manifestRevision` reads its delivered outcomes
    from that revision (`manifestFor`); one naming a missing archive counts nothing as delivered and adds its finding.
    A receipt without one (every §5.1 receipt) reads them from `settings.receipts`, the policy that discovered it, so
    the window count, the outcomes line and the by-group delivered count agree (see D1). Only a reference-era receipt
    (no `manifestRevision`, no `revision`) uses its file mtime as `revision` (Q10c). **As fixed (Codex B2-05):** the
    group cost and the period report's by-group and delivered-only per-case figures read the same resolution
    (`receiptDelivery` in `engine/manifest.mjs`, shared with `loadCases`); before the fix they read current settings,
    so a stamped receipt's group counted `delivered: 0` beside a window count of 1. A missing archive's group carries
    the finding in `cost.json` and its `byBatch` row. Receipt discovery stays on
    `settings.receipts.root`/`file` (D7: the engine keeps reading file receipts). `group` is the receipt directory
    relative to the receipt root, `source` is `files`. On an exact rank tie the later-read row wins (as the
    reference's re-read did; pinned by a test, review M5); item 22 turns those ties into conflicts and reuses
    `compareReceiptRows` (landed, Task 15: `receiptWinners`; with `report-conflicts` off the later-read row still wins).
  - **Settings (O8).** `B1_DEFAULTS` and the B1 `validateSettings` apply without the migration; with it, settings
    merge over `TA_DEFAULTS` and `validateB2Settings` leaves `ratioIntents` unchecked. The scope hook suggests the
    current manifest's ratio intents (`currentManifest`); when the manifest names none it offers `intents.default`
    as the label and says that no intent feeds the ratio (review M4).

**Engine change sites:** engine code: `filterWindow`, `loadCases`, `buildReport`, `main`, `renderMarkdown`,
`renderTeamHtml` in `tokenomics/scripts/team-report.mjs`; the manifest reader (D1: implied legacy binding,
`manifests/<N>.json` lookup, unverified on a missing archive, decided Q11b); `TA_DEFAULTS`/`validateSettings` and the new frozen
`B1_DEFAULTS` (`settings.ratioIntents` only when the migration is off, D1). No extension phase.

**Before-cases:** `cov-team-report-rollup` (registry), `before-report-windows`,
`before-ratio-manifest`; also declared: `cov-reports-ledger` (events 4–7, 12),
`cov-team-report-batches` (events 8–10), `foreign-settings` (event 4).

**Declared diff shape:**
- Every period-report event (`__events__/<i>.stdout` of the events listed): JSON `perDelivered` /
  `perExamined` per Q10a (decided: the map's field names); Markdown/HTML per-delivered lines and the new semantics/limitation statement;
  window label; per Q10b (decided), every totals/by-person/by-week figure computed over the `endedAt`
  window. In corpus inputs without `at` the denominator becomes 0 with `unwindowed: n`, so `perDelivered`
  is `null`.
- `foreign-settings` event 4: its settings say `ratioIntents: ["story"]`, but its lines are revisionless, so D1
  binds them to the implied `['automation']`: its ratio becomes `null` (no automation-intent session). This is the
  intended consequence of D1 and is listed in the declared diff. Under `none` the same event still reads
  `settings.ratioIntents` through `B1_DEFAULTS` (unchanged). As recorded (Task 11 review round 1, I1): its receipts
  carry no `manifestRevision`, so `done` is delivered under the settings policy; neither row has `at`, so the
  Markdown reads `done in the window: 0` with `2 delivered without at (unwindowed, excluded)`, agreeing with the
  by-group table, and the per-delivered line is gone.
- `before-ratio-manifest`: §5.5 fields only; the numerator stays $0.50 (revisionless lines, implied manifest).
- `before-ratio-revisions`: $1 (`rv1`, `manifests/1.json`) + $2 (`rv2`, `manifests/2.json`) + $4 (`rv0`, implied) over
  2 delivered = 3.5; `rv4` (revision 4, no archive) is `unverified: {sessions: 1, costUsd: 8, priced: 1}` with the
  finding. The case also ships `manifests/3.json`, byte-identical to its `module.json` (Q11b; review M6).
- `cov-team-report-rollup` and `cov-reports-ledger`: the lines without `endedAt` appear as `undated` (review I2).
- Also declared (the `write` run, Task 11): `before-report-unknowns` (its `--json` period stream: `U-1` has no `at`,
  so it is `unwindowed` and `perDelivered` is `null`).

**As recorded (Task 11).** The `write` run declared all seven candidates plus `before-report-unknowns` and refused
none. `cov-reports-ledger` changes events 4–7 and the event-12 `--out` file (`.agents/telemetry/out.md`), not the
batch-cost events 0–1; `cov-team-report-batches` events 8–10; `cov-team-report-rollup` all 19 events. Every declared
path is also declared by `null-unobservable` and/or `active-minutes`, and by no other landed migration: `exact-ids`
and `shared-allocation` (items 1, 2) do not change these streams in the corpus. So each of the eight cases extends
its existing interaction to `null-unobservable` + `active-minutes` + `report-windows`.

**Interactions:** after `exact-ids` (per-id dedup) and the allocation migrations (the period report's
`byBatch`/`perCase` tables come from `cost.json`). The period-report streams of `cov-reports-ledger`,
`cov-team-report-batches` and `cov-team-report-rollup` are also changed by items 1, 2, 4 (O1), 7, 22 and 23, so each
such case needs an interaction declaration naming every declarer of the shared stream (§4). As recorded (Task 11):
in the corpus only items 4 and 7 declare these streams so far, so each interaction names `null-unobservable`,
`active-minutes` and `report-windows`. `writer` later adds
`manifestRevision`, which D1's reading rule then resolves through `manifests/<N>.json`. `B1_DEFAULTS` keeps
`ratioIntents` permanently; the B2 settings contract drops it when B2 closes.

**Switchability:** harness yes; production no.

**Acceptance tests:** `team-report.test.mjs` "window [since, until) UTC on endedAt", "default since =
earliest endedAt", "§5.2 ordering incl. reopened and conflicting revisions", "unwindowed count",
"null vs $0 vs partial", "ratioIntents from module.json; implied manifest without one"; historical binding (O4,
Codex P3-06): "a current-manifest change (`module.json` advanced to a new revision with different
`ratioIntents`) leaves historical lines' eligibility unchanged", "revisionless line → implied legacy manifest,
never the current `module.json`", "`manifestRevision: N` → `manifests/N.json`", "missing archive → unverified +
finding, excluded from eligible sessions, not reinterpreted" (decided, Q11b), "delivered outcomes follow the line's revision";
B1 defaults (O8, Codex P3-07): `config.test.mjs` "`none` with a foreign `settings.json` lacking `ratioIntents`
loads and reports as today (frozen `B1_DEFAULTS`)", "removing `ratioIntents` from `TA_DEFAULTS` leaves `none`
output unchanged" (`diff-impl` `differing 0` after the B2-close commit); declared diffs above plus
`before-ratio-revisions`.

### Item 9 — `scope-resolution`

**Spec:** §14.8 item 9 "Scope resolution, handles, precedence, role stamping (§14.11)"; §14.11; §3.6;
§3.2 (`scope.role`, `restampedBy`).

**Reference behaviour today:** per sub-heading below. Pinned by `seed-scope-self`, `seed-scope-pending`,
`seed-scope-handoff`, `fault-capture-sweep` (registry), `fault-pending-write`, `cov-capture-vscode-edges`
(pending claim among four), `before-scope-precedence`, `before-scope-handle`, `before-scope-env-host`.

**Target behaviour:** the four §14.11 bullets, each specified under its sub-heading below ("Target:"
paragraphs). Changed outputs: scope record paths (`scopes/<host>/<session>.json`), scope record fields
(`role`, retained `claimedFrom`), the line's `scope` stamp (`role`; which declaration wins), `open`'s
stdout (handle JSON), exit codes of `outcome`/`close`/`restamp`, and new `restamp` lines (`restampedBy`).

#### Host-qualified scopes

*§14.11 bullet 1.* Today scope records are flat `scopes/<session>.json` for every host:
`reference/49577c7/hooks/telemetry-capture.mjs:633-635`, `reference/49577c7/scripts/work-scope.mjs:42-43`;
engine `tokenomics/hooks/telemetry-capture.mjs:604-607`, `tokenomics/scripts/work-scope.mjs:44-45`. A
Claude and a Copilot session with the same id read the same record (`before-scope-precedence`).
An unreadable or non-directory scopes path throws inside `sessionScope` (`readdirSync` unguarded,
`reference/49577c7/hooks/telemetry-capture.mjs:636-640`, engine `tokenomics/hooks/telemetry-capture.mjs:608-612`)
and the capture writes no line (`fault-capture-sweep`, §3 row R9).

Target: records at `scopes/<host>/<session>.json`; legacy flat records still read; an id present under two
hosts (or flat plus host-qualified for different hosts) is reported as ambiguous and never merged
(§14.11). `work-scope` needs the host to write a record: decided (Q12a): `--host <claude|copilot|copilot-vscode>`,
default from the environment, `claude` when `CLAUDE_SESSION_ID`/`CLAUDE_PROJECT_DIR` is set, else a usage
error on `open` without `--session auto`. An ambiguous id is reported both on stderr and as a kit finding (decided,
Q12b). An unreadable scopes store resolves to "no scope" and the line is still written (decided, Q12d: R9 is inside
item 9). Controller rulings on the Task 12 review (round 1): the host default checks `COPILOT_CLI=1` (set on every
Copilot hook by install-hooks) → `copilot` **before** the Claude variables (I1); the scope hook uses the same default
and its announce/gate `open` command names `--host <h>`; a session whose only record is another host's is reported on
the capture's stderr and as the kit finding `scope-host-mismatch`, never a silent scope-less line (O1); a pending
record is stamped with its host when known (it lives in `scopes/<host>/`; the scope schema allows no `host` field) and
only that host's sessions claim it, host-less ones keep the precedence (M4); the gate names an ambiguous id instead of
"declared no scope" (M5).

#### Handles

*§14.11 bullet 2.* Today `--session auto` is expanded for **every** command
(`reference/49577c7/scripts/work-scope.mjs:258`, engine `tokenomics/scripts/work-scope.mjs:261`); `open`
reports the generated id only on stderr (`reference/49577c7/scripts/work-scope.mjs:269`, engine
`tokenomics/scripts/work-scope.mjs:275`). After a capture claimed the pending record (file renamed to the
session id), `outcome --session <pending id>` self-heals into a new orphan `pending-…` record
(`reference/49577c7/scripts/work-scope.mjs:81`, engine `tokenomics/scripts/work-scope.mjs:83`) and
`close --session <pending id>` exits 1 "no scope declared"
(`reference/49577c7/scripts/work-scope.mjs:98-99`, engine `tokenomics/scripts/work-scope.mjs:101`).

Target: `open --session auto` prints `{"handle":"pending-…"}` on stdout (stderr line unchanged);
`outcome`/`close` accept the handle and resolve it before the claim (the pending record) or after it (the
record whose `claimedFrom` equals the handle); `auto` on any other command is a usage error (exit 1).

#### Precedence and claims (crash-recoverable)

*§14.11 bullet 3.* Today an exact `scopes/<id>.json` always wins, whatever its `source`, and pending
records are considered only when none exists (`reference/49577c7/hooks/telemetry-capture.mjs:634-636`,
engine `tokenomics/hooks/telemetry-capture.mjs:606-608`): in `seed-scope-self` a self-declared scope beats
an in-window pending one, which stays unclaimed. A claim writes the session record, then removes the
pending file (`reference/49577c7/hooks/telemetry-capture.mjs:648-652`, engine
`tokenomics/hooks/telemetry-capture.mjs:620-624`): a crash between the two leaves both, so a second session
can claim the same pending record (not single-owner); a failed write returns no scope
(`fault-pending-write`). A later `open --session <id>` on a claimed record rebuilds it from known fields and
drops `claimedFrom` (`reference/49577c7/scripts/work-scope.mjs:59-69`, engine
`tokenomics/scripts/work-scope.mjs:56-74`).

Target: precedence among initial declarations for one session is (1) `source: "handoff"`, (2) a pending
record claimed by time window, (3) any other session scope (§14.11); in `seed-scope-self` the pending
record therefore wins over the self-declared one. A claimed record keeps its outcomes and `closedAt` and
`claimedFrom`; a later pending declaration never displaces a claimed hand-off scope. Claims are
single-owner and recoverable after a crash. Mechanics (decided, Q12c): claim by atomic `renameSync` of the
pending file to `scopes/<host>/<session>.json.claim`, then write the merged record and remove the claim
file; on resolution, a leftover `.claim` file is completed (its pending is gone, so no second owner can
exist).

#### Role stamp and restamp

*§14.11 bullets 4 and 5.* Today the scope record has no `role` and `--role` is ignored
(`reference/49577c7/scripts/work-scope.mjs:54-69`); the line's compact scope has `intent`, `batch`,
`cases`, `outcomes` only (`reference/49577c7/hooks/telemetry-capture.mjs:657-665`, engine
`tokenomics/hooks/telemetry-capture.mjs:629-637`). There is no `restamp` command: any unknown command prints
usage and exits 1 (`reference/49577c7/scripts/work-scope.mjs:326-327`, engine
`tokenomics/scripts/work-scope.mjs:329`).

Target: `work-scope open --role <name>` stores `role` (§3.6); capture stamps `scope.role` on the line
(§3.2), never read later from mutable scope files. `work-scope restamp --host <h> --session <id>` appends
the current winning line for `host:id` with the corrected `scope` (incl. `role`), measured fields,
`endedAt` and original `writer` preserved, `restampedBy` set, `capturedAt` = now; no prior line ⇒ error;
a winner without `writer` ⇒ error naming `capture --force` (§14.11). **Exception to item 11's stamp (Codex
P3-08, Obligation O7):** a restamp append is not a measurement append. It keeps the winner's original `writer`
**and** original `manifestRevision` (the revision the measurement was written under), even when the package
version and the current `module.json` have since advanced. It adds only `restampedBy` (decided, Q15b: the current
`tokenomics-engine@<version>`). Item 11's current-writer/current-revision stamp must not apply to it.
As landed (Plan 4 Task 14, review round 1 M2): the corrected `scope` is the session's own record (`locateScope`; none,
ambiguous or only another host's ⇒ error, nothing appended), and the line's top-level `cases` re-derive from the
correction as `(winner.cases − winner.scope.cases) ∪ newScope.cases`, sorted: a mis-declared id leaves `cases`, the
corrected id joins, mined ids stay, so `batch-cost` membership and the by-case count follow the corrected scope.

**Engine change sites:** engine code: `sessionScope`, `scopeForLine` (`tokenomics/hooks/telemetry-capture.mjs:604-637`),
`captureDispatches` declared-scope read (`:394`), `renderLiveReport` (`:1410`); `scopesDir`/`scopePath`/
`openScope`/`recordOutcomes`/`closeScope`/`listScopes`/`main` (new `restamp`, `--host`, `--role`, handle
output) in `tokenomics/scripts/work-scope.mjs`; `scopesDir` in `tokenomics/hooks/scope-hook.mjs:53`
(announce/mark-dispatch/gate read the host-qualified record). TA: `stopGateCheck` and `enrichGroup:records`
receive host-qualified records (no TA code change expected). As landed (Plan 4 Task 12): the record store is the new
cycle-free `tokenomics/engine/scopes.mjs` (`resolveScope`, re-exported by `telemetry-capture.mjs`; `locateScope`,
`claimedScopePath`, `SCOPE_HOSTS`, `hostFromEnv`) — `work-scope.mjs` importing `telemetry-capture.mjs` would close the
cycle telemetry-capture → (dynamic) batch-cost → work-scope and deadlock the capture's top-level await; the hook's
marker files stay in the flat `scopes/` root; `tokenomics/kit/check.mjs` gains the `ambiguous-scope` finding
(`scope` profile, class `limitation`).

**Before-cases:** `seed-scope-self`, `seed-scope-pending`, `seed-scope-handoff`, `fault-capture-sweep`
(registry); `before-scope-precedence` (session `sp`: `open --session auto` 2 minutes before it starts, then
`work-scope open --session sp --intent automation --source handoff --role lead`; a Claude direct capture
whose catch-up sweep also captures the Copilot session `sp` under `~/.copilot/session-state/sp/`; a
`--sweep --all` that finds nothing new; and `work-scope restamp --host claude --session sp`, exit 1 usage
today, declared in `exits`. Today both lines carry the flat `scopes/sp.json` hand-off scope
`{intent: automation, cases: []}`, the record has no `role`, and the pending record stays unclaimed);
`before-scope-handle` (`open --session auto` → handle `pending-mupd2d6o-smkm` from the frozen clock/entropy,
`outcome --session <handle> X-1=delivered`, a Claude capture claims it, then `close --session <handle>`
exits 1 "no scope declared", `outcome --session <handle> X-2=delivered` writes an orphan pending record
under the handle, a second `close --session <handle>` closes that orphan (exit 0), and `close --session auto`
exits 1 on a fresh id. Exits `[0,0,0,1,0,0,1]`); `before-scope-env-host` (Task 19: `work-scope open --session cenv`
with `COPILOT_CLI=1` and no `--host`; today the record is the flat `scopes/cenv.json`, after `scope-resolution`
the env marker resolves the host to copilot, `scopes/copilot/cenv.json`).

**Declared diff shape:**
- `seed-scope-handoff`, `seed-scope-pending`: `scopes/ss.json` → `scopes/claude/ss.json` (a removed and an
  added golden file under the `.agents/telemetry` root); ledger `scope` unchanged (no role declared);
  `seed-scope-pending` `__events__/0.stdout` gains the handle JSON.
- `seed-scope-self`: line `scope` → the pending record's (`intent: story`, `batch: issue-7`,
  `cases: [issue-7]`), line `cases` re-derived; `scopes/pending-mupd12w0-smkm.json` removed,
  `scopes/claude/ss.json` holds the claimed record with `claimedFrom` (the merged record per the
  claim mechanics above; decided, Q12c); `__events__/0.stdout` handle.
- `fault-capture-sweep`: the first sweep captures the timestamped sessions that today throw inside
  `sessionScope` (`__events__/0.stderr` "swept N" with N > 0, no `scope` key on their lines) and the ledger
  file appears in `__sandbox__/changes.txt` (the case collects no output roots); the second sweep (missing
  or invalid store roots) stays `swept 0`.
- `before-scope-precedence`: Claude line `scope.role: "lead"`, Copilot line no longer carries the Claude
  record (host-qualified) and carries no scope: the pending record is stamped `claude` (the sandbox's
  `CLAUDE_PROJECT_DIR`), so it stays unclaimed in `scopes/claude/` and the Copilot capture reports on stderr that
  `sp`'s only record is `claude/sp.json` (Task 12 review round 1; the first recording had Copilot cross-claim the
  pending record); restamp event exit 0 only once `writer` has landed (until then exit 1 "reference-era winner",
  naming `capture --force`). With `writer` (Task 14) it exits 0 and appends the Claude winner again with its original `writer` and
  `manifestRevision`, `restampedBy` set and `capturedAt` = the event's clock (interaction declaration). With `copilot-inclusive` the ledger needs an interaction declaration.
- `before-scope-handle`: `__events__/0.stdout` handle; outcome after claim updates the claimed record; both
  closes behave per target (each closes the claimed `scopes/claude/sh.json`, exit 0, and prints the NO RECEIPT note
  for batch `hb`); no orphan pending file; `close --session auto` is a usage error (exits `[0,0,0,0,0,0,1]`).
- Also declared: every case whose scope file paths move (`cov-dispatch-batch`, `cov-copilot-dispatch`,
  `cov-work-scope-lifecycle`, `cov-scope-hook`, `seed-receipts-shared-id`,
  `cov-capture-vscode-edges`, `cov-capture-scope-live`, `fault-pending-write`, `foreign-*`, …): Plan 4's
  `write` run is the authority. Recorded (Plan 4 Task 12): also `before-dispatch-two-groups`,
  `before-ids-substring`, `cov-work-scope-close-faults`, `fault-batch-cost-empty-repo`,
  `fault-batch-cost-sizing-locked`, `fault-gate-fold-symlink` (their `open` writes `scopes/claude/<id>.json`, the
  sandbox's `CLAUDE_PROJECT_DIR` defaulting `--host`); `fault-pending-write` gains the handle and its pending record
  moves to `scopes/claude/` (the claim into `scopes/claude/a/b.json.claim` still fails); `cov-capture-vscode-edges`
  claims into `scopes/copilot-vscode/a.json`; `cov-copilot-dispatch`'s `open` event passes `--host copilot` (review
  round 1; the reference ignores the flag, baseline byte-identical), so the record is `scopes/copilot/cp1.json` and the
  line keeps its scope; `cov-scope-hook`, `cov-scope-hook-edges`, `cov-scope-hook-stdin-chunks`: the announce/gate
  `open` command names `--host claude`. No difference (refused by `write`): `fault-work-scope-usage`,
  `fault-scope-dir-blocked`.

**Interactions:** `reports-location` and `writer` follow. `restamp`'s success path needs `writer` lines
(§14.11 rejects reference-era winners), so its positive acceptance test lands with `writer` (§4).
`fold-flags`, `null-unobservable`, `copilot-inclusive` change the same lines' measured fields, which
restamp must preserve.

**Switchability:** harness yes; production no.

**Acceptance tests:** `work-scope.test.mjs` "handle printed on stdout", "outcome/close resolve the handle
before and after the claim", "auto only on open", "restamp: no prior line → error; reference-era winner →
error; writer winner → appended with restampedBy" (last one in the `writer` task, written against an **older**
writer: winner `tokenomics-engine@0.9.0` / `manifestRevision: 1`, current package newer and current `module.json`
at revision 2 → appended line keeps 0.9.0 and revision 1, sets `restampedBy`; a same-version test would miss the
conflict);
`telemetry-capture.test.mjs` "host-qualified read, legacy flat read, ambiguous id reported", "precedence
handoff > claimed pending > other", "claim crash recovery", "unreadable scopes store → line written without
scope", "scope.role stamped"; declared diffs above.

### Item 10 — `reports-location`

**Spec:** §14.8 item 10 "Reports and close-time writes relocated to the telemetry branch for non-TA
configurations; TA keeps its in-tree layout (`reports.location: "tree"`) until its owner retires it";
§14.4 (two files, two roles); §2 (telemetry substrate).

**Reference behaviour today:**
- Close writes `batch-report.md|html` and `batch-tokenomics.md|html` into the receipt directory:
  `reference/49577c7/scripts/work-scope.mjs:221-233`, engine `tokenomics/scripts/work-scope.mjs:224-236`
  (via `groupReportsDir`, `tokenomics/engine/config.mjs:83-86`).
- Every `updateBatchCosts` with `write` writes `cost.json` next to the receipt:
  `reference/49577c7/scripts/batch-cost.mjs:745`, engine `tokenomics/scripts/batch-cost.mjs:502`.
- The live page is already on the telemetry side (`reports/<group-with-dashes>.html`):
  `reference/49577c7/hooks/telemetry-capture.mjs:1446-1451`, engine `tokenomics/hooks/telemetry-capture.mjs:1421`.
- The engine accepts only `reports.location: "tree"` (`tokenomics/engine/config.mjs:47-48`).
- Pinned by `foreign-settings` (engine-only): `.agents/stories/sp1/{cost.json, batch-report.*,
  batch-tokenomics.*}` and `sp2/cost.json` in the main tree.

**Target behaviour:**
- `reports.location` accepts `"tree" | "telemetry"`. With `"telemetry"`, close-time reports and
  `cost.json` are written under the telemetry directory (decided, Q13a: `.agents/telemetry/<dir>/reports/<group
  path>/`) and never into the main tree; receipts are only read there.
- `TA_DEFAULTS` keeps `"tree"`. A present settings file that does not name `reports.location` gets
  `"telemetry"` **for non-TA configurations only** (decided, Q13b), so they relocate without opting in. An
  effective extension of `test-automation` keeps `"tree"` when the key is omitted: spec §14.8 item 10 says "TA
  keeps its in-tree layout", so an existing TA install whose `settings.json` omits `reports.location` keeps its
  reports in-tree after the upgrade. TA's own settings file names `"tree"`.
- `cost.json` counts as a close-time write and moves with the reports (decided, Q13c).
- `work-scope close`'s stderr line `` work-scope: ${w.group} report → <path> `` (`tokenomics/scripts/work-scope.mjs:307`) names the new path.

**Engine change sites:** engine code: `groupReportsDir`, `validateSettings`, the settings default merge
(`tokenomics/engine/config.mjs`), `updateBatchCosts` write path (`tokenomics/scripts/batch-cost.mjs:502`),
`generateBatchReports` (`tokenomics/scripts/work-scope.mjs:224`). TA: `onClose` receives `ctx.dir`
(unchanged value under `tree`).

**Before-cases:** `foreign-settings` (registry).

**Declared diff shape:** `foreign-settings`: files `.agents/stories/sp1/cost.json`,
`.agents/stories/sp1/batch-report.md`, `.agents/stories/sp1/batch-report.html`,
`.agents/stories/sp1/batch-tokenomics.md`, `.agents/stories/sp1/batch-tokenomics.html`,
`.agents/stories/sp2/cost.json` removed and the same names added under
`.agents/telemetry/stories/reports/sp1/` and `…/sp2/`; `__events__/3.stderr` path line; TA cases unchanged.
`foreign-null-extension` (settings `{"extension": null}`, a present file) relocates the same way and is
declared.

**TA detection (review round 1).** "Effective extension is `test-automation`" means the settings `extension` path's basename is `test-automation` or `test-automation.mjs` (a segment boundary; `my-test-automation.mjs` is not TA, and a wrapper gets the `telemetry` default unless it names `tree`). `onClose` keeps receiving the receipt dir (TA's gate verdicts fold beside the receipt), and TA's `sizeBaselines` reads the reports dir first, then the receipt tree. An old tree `cost.json` is left in place after the upgrade.

**Landed (Task 13).** `foreign-settings` and `foreign-null-extension` are declared; `foreign-mixed-roots` was a candidate and the tool refused it (no difference). No TA case has a settings file (absent file → `tree`), so none changes. Both declared cases need interactions naming every owner of the old paths (`null-unobservable`, `active-minutes`; `foreign-settings` also `report-windows`): the relocation is `removed` at the old path and `changed` at the new one. The period report's By-group table recomputes from receipts and the ledger and never reads a `cost.json`, so relocated and tree-located files coexist (test in `team-report.test.mjs`).

**Interactions:** after `scope-resolution` (close reads the resolved scope); before `writer`. The live page
path is unchanged under `tree`; under `telemetry` it is `reports-live/<encoded batch>.html` (Codex B2-10, see "As landed").

**As landed (Codex B2-10).** `foo` and `foo.html` both mapped to `reports/foo.html` (live file vs group dir), and the reference fold `/`→`-` also merged `a/b` with `a-b`. `liveReportPath` (`engine/config.mjs`) puts live pages in `reports-live/` as percent-encoded names under `telemetry`. No corpus case renders a live page at a telemetry location, so no after-file or interaction changed.

**Switchability:** harness yes; production no (configuration, not a switch).

**Acceptance tests:** `config.test.mjs` "reports.location telemetry accepted; default for a present non-TA file";
"a present TA settings file without reports.location keeps tree" (Q13b);
`work-scope.test.mjs` "close writes reports under the telemetry dir for location telemetry";
`batch-cost.test.mjs` "cost.json path follows reports.location"; declared diffs `foreign-settings`,
`foreign-null-extension`.

### Item 11 — `writer`

**Spec:** §14.8 item 11 "`writer` field (§14.7)"; §3.2 (`writer`, `manifestRevision`), §14.4, §14.7, §18.5;
D4.

**Reference behaviour today:** no ledger line carries `writer` or `manifestRevision`: Claude
`reference/49577c7/hooks/telemetry-capture.mjs:746-798`, Copilot `:978-995`, VS Code `:1169-1188`; engine
`tokenomics/hooks/telemetry-capture.mjs:719-770`, `:951-967`, `:1141-1160`. Lines are appended by
`appendLine` (`reference/49577c7/hooks/telemetry-capture.mjs:120-124`, engine
`tokenomics/hooks/telemetry-capture.mjs:122-126`). Pinned by `seed-claude-basic` (and every case below).

**Target behaviour:** every **measurement** line the engine appends (capture, fold and sweep paths) carries
`writer: "tokenomics-engine@<package version>"` and `manifestRevision` (`module.json`'s `manifestRevision` in
`.agents/telemetry/<dir>/module.json`, else 1 for the implied TA manifest), placed right after `v`
(§3.2 field order; decided: the map's placement, under the owner's delegation of detailed design, 2026-10-12).
Nothing else changes (D4). The version source and golden stability are decided (Q14): the version comes from
`package.json`, and the replay harness pins it to a fixed test value (Plan 4 Task 14).
**Restamp exception (Codex P3-08, O7):** a `work-scope restamp` append (item 9) is not stamped with the current
writer or revision. It preserves the winner's original `writer` (§3.2 "restamping never changes it"; §14.11) and
its original `manifestRevision` (derived; decided, Q15b), and sets `restampedBy`.

**Engine change sites:** engine code: the measurement line builders, or `appendLine` with an explicit
restamp path that keeps caller-supplied provenance (one stamping point covers all hosts and both direct and sweep
paths, but must not stamp restamp appends), and the manifest reader shared with D1.
As landed (Plan 4 Task 14): `appendLine(repo, slug, line, settings, { restamp })` is the one stamping point (every measurement append — direct capture, `captureSessionNow`, the three sweep loops — goes through it; `{ restamp: true }` writes the caller's line as built); the version comes from the new `tokenomics/engine/version.mjs` (`engineVersion(env)`: `TOKENOMICS_ENGINE_VERSION_PIN`, else `package.json`, else `0.0.0+unknown`; `writerId(env)`), and the replay runner sets the pin `0.0.0-replay` on every event. `manifestRevision` is `stampRevision(<telemetry dir>)` (`engine/manifest.mjs`): `module.json` absent → 1 (the implied TA manifest); present with an integer `manifestRevision` ≥ 1 → it; present but unusable (unparseable, not an object, no integer revision) → `null`, never dropped and never the implied 1, which D1 reads back as unverified (`manifest-revision-unknown`; review round 1, I1). `scopeForLine` moved from the capture to `engine/scopes.mjs` so `work-scope restamp` builds the same compact scope without importing the capture at load time (the Task 12 import cycle); `restamp` re-reads the session's own record (`locateScope`) and appends to the winner's ledger file. No corpus case that appends a line has a `module.json`, so every recorded stamp is revision 1 and no case input needed a `manifests/<N>.json` archive.

**Before-cases:** `seed-claude-basic` (registry). Declared: every case that appends a ledger line — 35 today:
`cov-capture-claude-parse`, `cov-capture-claude-sweep`, `cov-capture-copilot-edges`,
`cov-capture-dispatch-edges`, `cov-capture-identity`, `cov-capture-otel-local`, `cov-capture-pricing`,
`cov-capture-scope-live`, `cov-capture-sync`, `cov-capture-vscode-edges`, `cov-copilot-dispatch`,
`cov-dispatch-batch`, `cov-otel-remote`, `fault-batch-cost-sizing-locked`, `fault-pending-write`,
`foreign-null-extension`, `foreign-settings`, `real-coach-dispatch`, `real-coach-heavy`,
`real-coach-small`, `real-coach-workflow`, `real-solo-1`, `seed-claude-basic-unpriced`,
`seed-claude-basic`, `seed-claude-folded`, `seed-claude-killed`, `seed-claude-resumed`,
`seed-copilot-cli`, `seed-copilot-no-usage`, `seed-receipts-shared-id`, `seed-scope-handoff`,
`seed-scope-pending`, `seed-scope-self`, `seed-vscode-credits`, `seed-vscode-no-credits` — plus the five
Task 10 cases that append a line: `before-ids-substring`, `before-dispatch-two-groups`,
`before-scope-precedence`, `before-scope-handle`, `before-vscode-no-usage` (40 in all;
`before-entry-symlink` appends nothing until `entry-points` (item 12 `entry-guard`), and the other three read
pre-seeded lines). `writer` cannot declare `before-entry-symlink` alone (it changes nothing there). Item 12 is
approved in the `entry-points` group (Q1b), so the stamped line that appears only with both on is an interaction
declaration (`_interactions/before-entry-symlink/`, naming `entry-points` and `writer`, `entry-points` declaring the
case).

**Declared diff shape:** in each declared case, each appended line of every `usage-*.jsonl` gains the two
keys; pre-seeded lines are byte-identical. `cov-capture-sync`'s `__sandbox__/changes.txt` **changes**: since Codex
P3-03 it records the modified git dir, now one JSON array per line (Codex P3P-02):
`["M","repo/tgit/","g:<old>","g:<new>"]`, where the git-dir digest hashes the tip tree's blob ids, and the
committed ledger blob now carries the stamped line. So its `g:<new>` digest changes, and the file is declared.
The `restamp` success path of item 9 becomes testable here. Most declared cases share their ledger file with
`fold-flags`, `null-unobservable` and/or `copilot-inclusive` (e.g. `seed-copilot-no-usage`, `seed-copilot-cli`,
`cov-copilot-dispatch`, `cov-capture-copilot-edges`, `cov-capture-pricing`, `cov-dispatch-batch`,
`seed-claude-folded`, the VS Code cases). Each of those needs an interaction declaration naming every declarer
of the ledger file, recorded once all of them have landed (§4).

Recorded (Plan 4 Task 14): the `write` run changed exactly the 40 cases above and nothing else (each a `usage-*.jsonl` file, two in `cov-capture-claude-sweep`, `cov-capture-otel-local`, `cov-capture-scope-live`, `cov-capture-sync`, `cov-capture-vscode-edges` (`alt/`), `cov-capture-dispatch-edges` only its `alt/` ledger (its `live/cpx.jsonl` is the dispatch log, unchanged), `cov-capture-identity` `w1/usage-unknown.jsonl`, `foreign-settings` `.agents/telemetry/stories/`); 80 lines stamped, no pre-seeded line touched, no exit changed under `only:writer`. Item 9's cases without an appended line under `only:writer` (`fault-capture-sweep`, `cov-work-scope-lifecycle`, `cov-work-scope-close-faults`, `cov-scope-hook*`, `fault-batch-cost-empty-repo`, `fault-gate-fold-symlink`) show no difference and are not declared; `fault-capture-sweep` changes only with `scope-resolution` on (an interaction).

**Interactions:** last (§4): every measurement migration must already shape the lines it stamps (§14.7,
§18.5). D1's per-line revision binding starts reading real `manifestRevision` values here.

**Switchability:** harness yes; production **never** (§18.5; enforcement in B3/B4, D6).

**Acceptance tests:** `telemetry-capture.test.mjs` "appendLine stamps writer + manifestRevision; module.json
revision; implied → 1"; "restamp append keeps the original writer and manifestRevision" (older-writer winner,
O7); kit `check --mode mixed` over an after-ledger (port contract for `writer` lines,
reading profile for the rest, §14.7); `--mode port` passes on the after-lines; work-scope "restamp writer
winner"; declared diffs for all cases above.

---

## 3. Reference defects

Owner column: an existing item only where the fix falls inside that item's spec text; otherwise an item numbered
12 and up, approved by the owner (Q1): 22–24 land alone (Q1a), and 12–21 land in three groups, `entry-points`
(12, 13), `capture-robustness` (14–17, 21) and `report-robustness` (18–20) (Q1b, amending §14.8's "each lands
alone" for them). Rows R1–R7 are the spec §10 defects already owned by §14.8.

| # | finding | citation | before-case | owner |
|---|---|---|---|---|
| R1 | Copilot nets the full dispatch total from session input only, clamped at 0 (§10.1) | `reference/49577c7/hooks/telemetry-capture.mjs:969-972`; `tokenomics/hooks/telemetry-capture.mjs:943-944` | `seed-copilot-cli`, `seed-copilot-no-usage` | item 3 `copilot-inclusive` |
| R2 | Id matching is case-insensitive substring: `TC-1` matches `TC-10` (§10.2) | `reference/49577c7/scripts/batch-cost.mjs:230-235`, `:256-266`; `tokenomics/scripts/batch-cost.mjs:137-141`, `:162-172` | `before-ids-substring` | item 1 `exact-ids` |
| R3 | A dispatch naming ids of two groups is counted at full weight in both (§10.3) | `reference/49577c7/scripts/batch-cost.mjs:513-527`; `tokenomics/scripts/batch-cost.mjs:295-310` | `seed-receipts-shared-id`, `before-dispatch-two-groups` | item 2 `shared-allocation` |
| R4 | The anonymised submission keeps the group slug in the notes' cost.json path (§10.4) | `reference/49577c7/scripts/build-tokenomics-export.mjs:135`, `:185-194`; `tokenomics/extensions/test-automation.mjs:652`, `:659-664` | `before-export-anon-batch` | item 5 `anon-complete` |
| R5 | Zero written for unmeasured values (Copilot usage-less shutdown, VS Code `toolCalls`/`skills`/usage) (§10.5) | `reference/49577c7/hooks/telemetry-capture.mjs:961-968`, `:1179-1185`; `tokenomics/hooks/telemetry-capture.mjs:933-940`, `:1151-1157` | `seed-copilot-no-usage`, `seed-vscode-credits`, `before-vscode-no-usage` | item 4 `null-unobservable` |
| R6 | Folding drops dispatch metadata and does not recompute session flags (§10.5) | `reference/49577c7/hooks/telemetry-capture.mjs:470-491`; `tokenomics/hooks/telemetry-capture.mjs:446-467` | `cov-capture-pricing`, `seed-claude-folded` | item 6 `fold-flags` |
| R7 | Active minutes are partitioned across dispatches in the join (§5.4) | `reference/49577c7/scripts/batch-cost.mjs:536`, `:552`; `tokenomics/scripts/batch-cost.mjs:318`, `:334` | `cov-dispatch-batch` | item 7 `active-minutes` |
| R8 | The main guard compares `import.meta.url` (realpath) with `argv[1]`: a hook run through a symlinked path (sdlc-skills `--symlink`, macOS `/tmp`) exits 0 and captures nothing (Plan 1 ledger, final) | `reference/49577c7/hooks/telemetry-capture.mjs:1494`, `reference/49577c7/hooks/scope-hook.mjs:211`, `reference/49577c7/scripts/work-scope.mjs:334`, `reference/49577c7/scripts/batch-cost.mjs:763`, `reference/49577c7/scripts/team-report.mjs:871`, `reference/49577c7/scripts/build-tokenomics-export.mjs:298`; `tokenomics/hooks/telemetry-capture.mjs:1469` (same in every entry point); Task 18 round 1 also moves `bin/harness-telemetry.mjs`, `tokenomics/hooks/otel-sink.mjs`, `tokenomics/scripts/otel-report.mjs` and `tokenomics/scripts/install-hooks.mjs` onto `isMain` | `before-entry-symlink` (`seed-claude-basic`'s capture run through `<root>/links/telemetry-capture.mjs`, replay event `via: "symlink"`: exit 0, no ledger line, the only sandbox change is the link) | `entry-points` group, item `12: entry-guard` (approved, Q1b) |
| R9 | `sessionScope`'s `readdirSync` is unguarded: a non-directory or unreadable scopes path throws and the capture writes no ledger line, for all three hosts (Plan 1 Task 13; Plan 2 ledger line 77) | `reference/49577c7/hooks/telemetry-capture.mjs:636-640`; `tokenomics/hooks/telemetry-capture.mjs:608-612` | `fault-capture-sweep` | item 9 `scope-resolution` (the resolver is rewritten by §14.11; decided, Q12d) |
| R10 | The kit throws ENOTDIR when `scopes` is a file (crash instead of a finding) (Plan 1 Task 14) | `tokenomics/kit/load.mjs:24-25` (kit, not reference code) | `fault-scope-dir-blocked` (outputs deliberately not collected because of it); kit unit test | outside B2: kit fix (A-track maintenance), not an engine migration (decided, Q2) **As landed (Task 20):** `kit/load.mjs` marks the module `scopesBlocked` and `check` emits an `error` finding `scopes-not-directory` (file = the `scopes` path); not gated by `migrationOn`; no golden or snapshot changes (the replay outputs for `fault-scope-dir-blocked` and `fault-capture-sweep` are still not collected). |
| R11 | `work-scope close --repo ""` passes `''` through `??`, so `buildBatchCost` silently skips sizing (Plan 2 ledger line 63) | `reference/49577c7/scripts/work-scope.mjs:256`, `reference/49577c7/scripts/batch-cost.mjs:634`; `tokenomics/scripts/work-scope.mjs:259`, `tokenomics/extensions/test-automation.mjs:402` | `fault-batch-cost-empty-repo` | `report-robustness` group, item `18: empty-repo-sizing` (approved, Q1b) **As landed (Task 20):** an empty `--repo` is a usage error (stderr `work-scope: --repo needs a non-empty path`, exit 1), gated by `report-robustness`; the `fault-batch-cost-empty-repo` close now writes nothing (no `cost.json`, reports or `runs.json`) and leaves the scope open. |
| R12 | Batch tokenomics Markdown prints `NaN%` shares for a group with zero sessions (`pct(0/0)`) (Plan 2 ledger line 71) | `reference/49577c7/scripts/team-report.mjs:605-611`; `tokenomics/scripts/team-report.mjs:609-615` | `cov-team-report-batches` | `report-robustness` group, item `19: zero-session-share` (approved, Q1b) **As landed (Task 20):** the map predicted only `cov-team-report-batches`; the `write` run declares three: also `cov-work-scope-close-faults` and `fault-gate-fold-symlink` (their zero-session groups print `NaN%` too). The fix is the shared `pct`, which renders `—` for a non-finite share. |
| R13 | Sub-agents are enumerated, and return receipts searched, in whatever order `readdirSync` returns, with no sort of its own (Plan 2 ledger line 76). On POSIX, Node's listing is strcmp-sorted: libuv's `uv__fs_scandir` sorts the entries, so macOS and Linux agree. That order is undocumented by Node, and Windows can differ. The defect is reliance on undocumented order, not a macOS/Linux divergence (the earlier "unsorted, platform-sensitive, golden in macOS order" premise was false; Plan 3 ledger, final parked note) | `reference/49577c7/hooks/telemetry-capture.mjs:324-325`, `:357-358`; `tokenomics/hooks/telemetry-capture.mjs:331-332`, `tokenomics/extensions/test-automation.mjs:154-155` | none in the corpus can show it: on POSIX the listing is already sorted, and the replay preload sorts listings as well (`replay/preload.mjs`), so `cov-dispatch-batch`'s golden is identical before and after a fix. Evidence = a Plan 4 unit test that stubs `readdirSync` to return an **unsorted** listing and asserts the captured `subagents[]` order and the receipt search order are sorted | `capture-robustness` group, item `14: stable-enumeration` (approved, Q1b) (optional robustness: Windows portability; a declared corpus diff is impossible, so its acceptance is the unit test, Q1) |
| R14 | A VS Code op-log path update two or more past the end leaves holes; the request loop dereferences `undefined` and the sweep's catch silently drops the session (Plan 2 ledger line 77) | `reference/49577c7/hooks/telemetry-capture.mjs:1105-1107`, `:1119-1120`; `tokenomics/hooks/telemetry-capture.mjs:1077-1079`, `:1091-1092` | `cov-capture-vscode-edges` (session `z`) | `capture-robustness` group, item `16: vscode-oplog-holes` (approved, Q1b) |
| R15 | A VS Code session with no timestamps is re-appended on every sweep (no end-advance guard on the VS Code path; null end read back as 0) (Plan 2 ledger line 77) | `reference/49577c7/hooks/telemetry-capture.mjs:1313-1317`, `:113`; `tokenomics/hooks/telemetry-capture.mjs:1285-1289`, `:115` | `cov-capture-vscode-edges` (session `g`, three lines) | `capture-robustness` group, item `17: vscode-end-guard` (approved, Q1b) |
| R16 | A sub-agent transcript path that is a directory makes `--dispatch` throw `EISDIR` out of the loop: the remaining dispatches are not recorded (Plan 2 ledger line 77) | `reference/49577c7/hooks/telemetry-capture.mjs:428-431`, `:53`; `tokenomics/hooks/telemetry-capture.mjs:404-407` | `cov-capture-dispatch-edges` | `capture-robustness` group, item `15: dispatch-dir` (approved, Q1b) |
| R17 | Entry points call `process.exit()` right after large stdout writes (Plan 3 Task 1). Node documents `process.stdout` writes to pipes (and sockets) as *asynchronous* on POSIX (and synchronous on Windows). It also documents that output may be "not written at all if `process.exit()` is called before an asynchronous write completes" (Node 18.19 `process` docs, "A note on process I/O"). So on any POSIX host, Linux included, a large piped write followed by `process.exit()` **may** be truncated. Observed: truncated on macOS at 8 KB (Node 18) and 64 KB (Node 24). A run that loses nothing on Linux is one observation, not a guarantee: the documentation promises no completion on any POSIX pipe | `reference/49577c7/scripts/team-report.mjs:871-873`, `reference/49577c7/scripts/build-tokenomics-export.mjs:298`, `reference/49577c7/scripts/work-scope.mjs:334-338`; `tokenomics/scripts/team-report.mjs:902-904` | none in the corpus: the replay preload makes stdio blocking by design (`replay/preload.mjs`; `cov-team-report-batches` `__events__/3.stdout` was regenerated whole); evidence = a Plan 4 unit test spawning the entry point **without** the preload | `entry-points` group, item `13: stdout-drain` (approved, Q1b) |
| R18 | An incomplete export segment renders `` `undefined` `` in submission.md's title and Stop · owner row, and an overflowing sum renders `$null` (Codex P2-02, kept byte-identical for TA) | `reference/49577c7/scripts/build-tokenomics-export.mjs:210`, `:215`, `:223`; `tokenomics/extensions/test-automation.mjs:670-671` | `cov-export-submission-edges` | `report-robustness` group, item `20: submission-identity` (approved, Q1b) **As landed (Task 20):** TA's `submission` parts omit a missing stop / owner / work-item level (the engine already filtered its own default), the overflowing sum renders `n/a`; declared diff is `cov-export-submission-edges` `submission.md` only. |
| R19 | Provisional live lines are built with `host: 'claude'` even for Copilot live logs, so live pages mislabel Copilot spend (found by this map) | `reference/49577c7/scripts/batch-cost.mjs:108`; `tokenomics/scripts/batch-cost.mjs:110` | `cov-copilot-dispatch` (`reports/camp-wave-01.html`) | `capture-robustness` group, item `21: live-host` (approved, Q1b) |
| R20 | Report dedup keeps the first of two lines with an exact (`endedAt`, `capturedAt`) tie and never reports a §3.5 conflict, so the winner depends on input order (Repro E) | `reference/49577c7/scripts/team-report.mjs:63-74`, `reference/49577c7/scripts/batch-cost.mjs:459`; `tokenomics/scripts/team-report.mjs:67-78` | `cov-team-report-rollup` ("exact tie") | `22: report-conflicts` (approved slot, decided Q1a), **required by spec** (§3.5 binds every reader; the kit's `aggregate` does not make engine reports conform). Obligation O2; Q1, Q16 |
| R21 | The join's `byRole` dollars are parent-exclusive (session − Σ dispatch) with dispatch-role dollars mixed into the same map (Repro E) | `reference/49577c7/scripts/batch-cost.mjs:533`, `:547`, `:559`; `tokenomics/scripts/batch-cost.mjs:329`, `:341` | `cov-dispatch-batch` (`cov-d/cost.json` `byRole`) | `23: role-dollars` (approved slot, decided Q1a), **required by spec** (§3.2.1). Obligation O3; Q1 |
| R22 | No engine-written report records its `manifestRevision` | `reference/49577c7/scripts/team-report.mjs:229-257` (`buildReport` result; likewise `cost.json` and the renders) | every report case (registry: `cov-team-report-rollup`, `cov-dispatch-batch`) | `24: report-revision` (approved slot, decided Q1a), **required by spec** (§14.4). Obligation O6; Q1, Q14c (landed, Task 17: 24 declared cases, see O6) |

R13 note (final review F3, corrected by the Plan 3 patch per Codex P3-10): Node's `fs.readdir`/`readdirSync` is strcmp-sorted on POSIX (libuv `uv__fs_scandir` sorts), so macOS and Linux already agree and no current golden depends on host order. The replay preload's sort (`replay/preload.mjs`) is a harmless guard that changed no golden. R13 stays recorded because the reference relies on an order Node does not document, and Windows can differ. It cannot be shown by a corpus diff, only by an unsorted-listing unit test.

R17 note: the preload's blocking stdio stays: it is the legitimate correction that makes captured streams complete. Because the preload masks the defect, item 13's evidence is a subprocess spawned **without** the preload that writes more than a pipe buffer to a pipe and asserts the reader receives every byte. Its acceptance claims no more than the Node documentation above.

P3P-06 resolution (Plan 4 Task 3; owner Q1b). Items 13 and 14 have no corpus diff: the replay normalises both
(blocking stdio, sorted listings). They land inside the `entry-points` and `capture-robustness` groups, and each group
declares real corpus cases from its other items: `before-entry-symlink` for item 12; `cov-capture-vscode-edges`,
`cov-capture-dispatch-edges` and `cov-copilot-dispatch` for items 15–17 and 21. So the registry rule "a landed
migration declares a case" holds without a vacuous diff, and that rule is unchanged (no `beforeCasesWaived`). The
evidence for items 13 and 14 is a unit test each:
- item 13: an unpreloaded child process writes more than 1 MB to a pipe and then exits; the reader receives every
  byte;
- item 14: a `readdirSync` stub returns an unsorted listing; the captured `subagents[]` order and the receipt search
  order are asserted sorted.

The group's commit and its `tokenomics/ENGINE-B1.md` row name those tests.

The new items come in two kinds (decided, Q1):
- **Required by spec, each with its own migration slot** (Obligations O2, O3, O6; Q1a): `22: report-conflicts`,
  `23: role-dollars`, `24: report-revision`. These are not optional robustness work. Each lands alone, after
  `writer` and before the grouped items (§4).
- **Optional robustness, approved as three grouped migrations** (Q1b): `entry-points` = `12: entry-guard`,
  `13: stdout-drain`; `capture-robustness` = `14: stable-enumeration`, `15: dispatch-dir`,
  `16: vscode-oplog-holes`, `17: vscode-end-guard`, `21: live-host`; `report-robustness` =
  `18: empty-repo-sizing`, `19: zero-session-share`, `20: submission-identity`. A group's registry `item` is its
  lowest item number and its `migration.json` lists every item in `items`. Items 13 and 14 have no corpus diff;
  see the P3P-06 resolution above (no `beforeCasesWaived`).

Each is harness-selectable and not production-switchable (they are defect fixes or reader obligations, D6).

---

## 4. Landing order

1. `exact-ids`
2. `anon-complete`
3. `fold-flags`
4. `null-unobservable`
5. `copilot-inclusive`
6. `shared-allocation`
7. `active-minutes`
8. `report-windows`
9. `scope-resolution`
10. `reports-location`
11. `writer`
12. `report-conflicts` (item 22)
13. `role-dollars` (item 23)
14. `report-revision` (item 24)
15. `entry-points` (items 12, 13)
16. `capture-robustness` (items 14–17, 21)
17. `report-robustness` (items 18–20)
18. the API 2 freeze (D3)
19. B2 close: `ratioIntents` leaves the B2 settings contract (`TA_DEFAULTS`), never `B1_DEFAULTS` (D1, O8),
    and the `none` differential is re-run green

**Reason.** Small, output-local changes first (`exact-ids`, `anon-complete`, `fold-flags`); capture-shape
changes next, `null-unobservable` before `copilot-inclusive` so each Copilot diff is about one thing;
allocation changes after the measurement changes they read (`shared-allocation`, then `active-minutes`);
`report-windows` after the allocations, because the period report embeds `cost.json` tables; scope and
report location after the accounting is final; `writer` last, so every `writer` line is port-conformant
(§14.7, §18.5). The required-by-spec items 22–24 follow (Q1a), before final B2 conformance and the API freeze
(Codex §5); the three grouped robustness migrations come last (Q1b). Entries 1–17 are `MIGRATIONS`
(`tokenomics/engine/migrations.mjs`) in this order, which is also the composition order of the declared-diff harness
(`declarersOf` follows `MIGRATIONS`).

**Order constraints found by this map (no change to the order):**
- `scope-resolution`'s `restamp` success path needs `writer` lines (§14.11 rejects reference-era winners),
  so that one acceptance test lands in the `writer` task; `scope-resolution` lands the rejection paths.
- D1's per-line `manifestRevision` binding has real values only after `writer`. Until then every line is
  revisionless and binds to the implied legacy manifest (D1 reading rule).
- `exact-ids` precedes `report-windows` because §5.2 dedups receipt rows per id.

### Interaction declarations

Landing order does not compose diffs. Each declared after-file is relative to the baseline, so in `default` and
`all` two declarers of one path (or one event's exit) conflict until an interaction declaration
(`corpus/migrations/_interactions/<case>/interaction.json`, recorded by `write-interaction <case>`) gives the
cumulative bytes. It must name every migration that declares an overridden key, and at least one named
migration must declare the case. Record it when the **last** of its migrations lands. A later migration that
lands on a path an interaction already overrides fails until the interaction is revised to name it. Known
overlaps (the `write` runs are the authority, and this list grows with them):

| shared output | migrations | cases (known) |
|---|---|---|
| ledger lines (`usage-*.jsonl`) | `fold-flags`, `null-unobservable`, `copilot-inclusive`, `writer` | `seed-copilot-no-usage`, `seed-copilot-cli`, `cov-copilot-dispatch` (also `live/cp1.jsonl`), `cov-capture-copilot-edges`, `cov-capture-pricing`, `cov-dispatch-batch`, `seed-claude-folded`, `seed-vscode-credits`, `seed-vscode-no-credits`, `before-vscode-no-usage`, `cov-capture-vscode-edges`, `cov-capture-claude-parse`, `cov-capture-scope-live` (`null-unobservable` + `writer` where Q8b applies), `cov-capture-dispatch-edges` (`live/cpx.jsonl`, Task 7). Recorded: `cov-capture-pricing` (`fold-flags` + `null-unobservable`); `cov-dispatch-batch`'s ledger is `fold-flags` only (`null-unobservable` changes its `cost.json` and renders). Recorded with `writer` (Task 14): new `before-vscode-no-usage`, `cov-capture-claude-parse`, `cov-capture-scope-live`, `cov-capture-vscode-edges` (both ledgers), `seed-vscode-credits`, `seed-vscode-no-credits` (`null-unobservable` + `writer`), `seed-claude-folded` (`fold-flags` + `writer`); extended with `writer`: `seed-copilot-no-usage`, `seed-copilot-cli`, `cov-capture-copilot-edges` (`null-unobservable` + `copilot-inclusive`), `cov-capture-pricing` (`fold-flags` + `null-unobservable`), `cov-copilot-dispatch` (`null-unobservable` + `copilot-inclusive` + `active-minutes`), `cov-dispatch-batch` (now `fold-flags` + `null-unobservable` + `active-minutes` + `writer`: the ledger beside its `cost.json`). `cov-capture-dispatch-edges` needs none: `writer` changes only its `alt/` ledger, which no other migration declares |
| a path that appears only with both on | `entry-points` (12: entry-guard) + `writer` | `before-entry-symlink` (the stamped line; `writer` alone declares nothing there) |
| `cost.json` and the batch renders / export rows | `exact-ids`, `shared-allocation`, `active-minutes`, `23: role-dollars`, `null-unobservable` (reader half, O1), `reports-location` (moves the files in non-TA cases) | `seed-receipts-shared-id`, `cov-dispatch-batch`, `before-dispatch-two-groups`, `before-ids-substring`, `foreign-settings`, `foreign-null-extension`, and the batch cases in item 7's list. **Since `null-unobservable` landed (Task 7) it declares every case that writes a `cost.json`:** also `cov-reports-ledger`, `cov-team-report-batches`, `cov-team-report-rollup`, `cov-batch-cost-edges`, `seed-receipts-waves`, `cov-work-scope-close-faults`, `before-export-anon-batch`, `before-report-unknowns`, `cov-export-cli`, `cov-export-submission-edges`, `fault-batch-cost-empty-repo`, `fault-batch-cost-sizing-locked`, `fault-batch-cost-unreadable`, `fault-gate-fold-symlink`, `cov-copilot-dispatch` (live page). A later migration changing any of these files needs an interaction naming `null-unobservable` (recorded so far: `before-ids-substring` with `exact-ids`; `seed-receipts-shared-id` and `before-dispatch-two-groups` with `shared-allocation`). **Since `active-minutes` landed (Task 10) it declares all of these as well:** each has an interaction naming `null-unobservable` + `active-minutes`, and three owners where a third migration declares the path (`before-ids-substring` + `exact-ids`; `seed-receipts-shared-id`, `before-dispatch-two-groups` + `shared-allocation`; `cov-copilot-dispatch` + `copilot-inclusive`). **Since `role-dollars` landed (Task 16)** it declares 20 of these cases (every `cost.json` gains `byDispatchRole`; not `cov-team-report-rollup`, whose `write` run shows no difference), and each of the 20 interactions now also names `role-dollars` beside every other owner of its paths (with `reports-location`, the relocated tokenomics renders of `foreign-settings` and `foreign-null-extension` too) |
| period-report streams (`__events__/<i>.stdout`) | `exact-ids`, `shared-allocation`, `active-minutes`, `report-windows`, `null-unobservable` (O1), `22: report-conflicts`, `23: role-dollars` (batch-cost / `--batch(es)` streams only; no period `--json`: it declares `__events__` of `cov-reports-ledger` 0, 8–11, `cov-team-report-batches` 0–4, `foreign-settings` 5–6, `before-report-unknowns` 1, `cov-batch-cost-edges` 1, `fault-batch-cost-empty-repo` 1, `seed-receipts-waves` 0; review round 1, M4), `24: report-revision` | `cov-reports-ledger`, `cov-team-report-batches`, `cov-team-report-rollup`, `foreign-settings`; since Task 7 `null-unobservable` also declares the `--json` / batch-cost streams of `before-ratio-manifest`, `before-report-windows`, `before-report-unknowns`, `cov-batch-cost-edges`, `seed-receipts-waves`, `fault-batch-cost-empty-repo` (every bucket gains `unmeasured`), so a later migration on them needs an interaction naming it. `active-minutes` (Task 10) declares every one of these streams (and `cov-reports-ledger`, `cov-team-report-batches`, `cov-team-report-rollup`, `foreign-settings`) and records them with `null-unobservable` in one interaction per case. `report-windows` (Task 11) declares the period streams of `cov-reports-ledger`, `cov-team-report-batches`, `cov-team-report-rollup`, `foreign-settings`, `before-ratio-manifest`, `before-ratio-revisions`, `before-report-windows` and `before-report-unknowns`; each of those interactions now names `null-unobservable` + `active-minutes` + `report-windows` (no `exact-ids` or `shared-allocation` path overlaps). `report-conflicts` (Task 15, review round 1) declares `cov-team-report-rollup` (event 3: the dedup root's exact ties; event 0: key order) and, for the host:id read order alone, the period streams of `before-ratio-manifest`, `cov-reports-ledger`, `cov-team-report-batches` and `foreign-settings`; each of those five interactions now also names `report-conflicts` (`foreign-settings` with `reports-location` too) |
| scope record paths and the line's `scope` | `scope-resolution`, `writer` | the item 9 cases that also append a line (`seed-scope-*`, `before-scope-precedence`, `before-scope-handle`, `cov-dispatch-batch`, …). Recorded with `scope-resolution` (Task 12): `before-scope-precedence` (+ `copilot-inclusive`, the ledger), `fault-capture-sweep` (+ `null-unobservable` + `copilot-inclusive`, the `changes.txt` digest of the lines R9 now lets the sweep write). Recorded with `writer` (Task 14): `seed-scope-self` (`scope-resolution` + `writer`, the ledger); `before-scope-precedence` extended to `copilot-inclusive` + `scope-resolution` + `writer` (the ledger gains the restamped line, event 4's stderr reports the restamp, exits `[0,0,0,0,0]`); `fault-capture-sweep` extended with `writer` (`changes.txt`). `seed-scope-handoff`, `seed-scope-pending`, `before-scope-handle` and `cov-dispatch-batch`'s scope paths compose without conflict |
| `cov-capture-sync` `__sandbox__/changes.txt` (`g:` digest) | every migration that changes the committed ledger (`writer`, and `fold-flags` / `null-unobservable` if they touch its line) | `cov-capture-sync` (Task 14: only `writer` changes its committed line, so `writer` declares `changes.txt` alone; no interaction) |

---

## 5. Owner decisions (2026-10-11/12)

The owner's answers are recorded in `docs/reviews/owner-decisions-2026-10-12.md`: Q1, Q3 and Q14 answered by the
owner; Q2, Q4–Q13, Q15 and Q16 delegated ("simple solution") and taking this map's stated proposals. They are binding,
and the text above is frozen to them.

- **Q1 — scope.** (a) `22: report-conflicts`, `23: role-dollars`, `24: report-revision` are B2 migrations, each landing
  alone. (b) Items 12–21 land as three grouped migrations, amending §14.8's "each lands alone" for them:
  `entry-points` (12, 13), `capture-robustness` (14–17, 21), `report-robustness` (18–20). Items 13 and 14 have no
  corpus diff; each group declares real cases from its other items, and 13/14 are evidenced by unit tests (§3,
  P3P-06 resolution).
- **Q2 — kit ENOTDIR (R10).** Kit maintenance: a `check` finding instead of a throw, outside §14.8 (Plan 4 Task 20).
- **Q3 — production switch set.** `{}`.
- **Q4 — `exact-ids`.** Whole-token, case-sensitive; boundary class `[A-Za-z0-9_-]`.
- **Q5 — `shared-allocation`.** Even `1/k` split, plus a `sources.sharedDispatches` note.
- **Q6 — Copilot dispatch totals.** Dropped (dispatch `tokens: null`), plus a `sources.inclusiveSessions` note.
- **Q7 — `active-minutes`.** The map's null/labelled-allocation field list; the parent role gets the full session
  minutes; dispatch roles are a separate breakdown.
- **Q8 — `null-unobservable`.** (a) VS Code cache categories stay 0; (b) a timestamp-less session gets
  `wallMin`/`activeMin` `null`; (c) a missing `elapsedMs` stays 0; (d) `unmeasured: {tokens, activeMin, wallMin,
  turns, toolCalls, toolErrors}` per bucket, rendered as "n unmeasured".
- **Q9 — supplied strings.** Group slugs, `work_item_ref`, receipt paths and briefs; matched on a whole-token or
  path-segment boundary.
- **Q10 — `report-windows`.** (a) The map's field names; (b) one `endedAt` window for the whole report; (c) a
  revisionless legacy receipt without `revision` is reference-era (its mtime may serve); (d) a date-only argument
  maps to `T00:00:00Z`.
- **Q11 — D1 historical binding.** (a) D1's legacy binding is immutable. (b) The strict rule: a missing archive means
  the line is unverified, and cases with a `module.json` ship `manifests/<N>.json`.
- **Q12 — `scope-resolution`.** (a) A `--host` flag with an environment default; (b) ambiguity reported both on
  stderr and as a kit finding; (c) claims by atomic rename plus `.claim` recovery; (d) R9 is inside item 9.
- **Q13 — `reports-location`.** (a) `.agents/telemetry/<dir>/reports/<group>/`; (b) the default is `"telemetry"` for
  a present settings file that omits the key, for non-TA configurations only: an effective extension of
  `test-automation` defaults to `"tree"` (spec §14.8 item 10, "TA keeps its in-tree layout"); (c) `cost.json` moves
  with the reports.
- **Q14 — `writer`.** The version comes from `package.json`, and the replay harness pins it (Plan 4 Task 14); B3
  moves the source to `ENGINE.json`. Report provenance is item 24 (Q1a). **As landed (Plan 5 Task 2):**
  `engineVersion()` reads `TOKENOMICS_ENGINE_VERSION_PIN`, then `tokenomics/ENGINE.json` `engine` (`0.4.0`), then
  `0.0.0+unknown`; `package.json` `version` equals it (tested); the replay still pins `0.0.0-replay`, so no golden
  changed.
- **Q15 — `restamp`.** (a) and (b) as in the map: the positive restamp test is in the `writer` task, against an older
  writer; a restamp append keeps the original `writer` and `manifestRevision` and sets `restampedBy` (the current
  `tokenomics-engine@<version>`).
- **Q16 — §3.5 conflicts.** `conflicts: n` plus a preview total from the lowest-canonical-JSON pick; slot 22.
