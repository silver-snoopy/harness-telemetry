# Tokenomics port blueprint — design

- **Status:** **v4.2.1** (2026-10-11; v4.2.1: §18.2 scoped to the implemented observation boundary (owner decision 2026-10-11). v4.2: 2026-10-10; review-6 edits §19, review-7 edits §20; Codex verdict on v4.1: approvable with listed edits — applied). v4 records the owner's decisions
  (§13): everything ships from a **standalone repo** `harness-telemetry`, usable
  without sdlc-skills; sdlc-skills consumes it; the engine refactor is governed by
  §18 (refactor safety). Earlier versions archived (`…-v1`, `-v2.1`, `-v3`,
  `-v3.1`, `-v3.2`). History: v1 → v2 → v2.1 (archived
  `…-design-v1.md`, `…-design-v2.1.md`; Codex gpt-6-astra reviews 1–3). v3 adds
  the product shape (engine + kit + porting skill, Claude and Copilot) and turns
  the LeRisque PoC findings (`2026-10-10-tokenomics-port-poc-lerisque.md`,
  P1–P14) into requirements.
- **Scope:** the **contract + kit** (§1–§8, unchanged in substance from v2.1),
  the **engine** (§14 — generic tokenomics extracted from the test-automation
  copy) and the **porting skill** (§15 — the agent-run toolkit). Build order is
  kit → engine → skill (§12); the kit is the engine's regression net.
- **Reference implementation:** `bundles/test-automation/skills/tokenomics/` at
  `49577c7` (ledger `v: 1`, scope `v: 1`).

## 0. Purpose, audience, success

sdlc-skills' tokenomics captures every agent session's tokens, real dollars,
time and work-item ids into a git-durable ledger, then joins it with pipeline
receipts to answer *what did each unit of delivered work cost*. Today it is
welded to the test-automation factory.

**Where it lives.** A standalone repository **`harness-telemetry`**
(`~/dev/harness-telemetry`) holds the contract docs, schemas, kit, engine and
porting skill, with its own zero-dependency installer
(`npx github:silver-snoopy/harness-telemetry …`). It serves **any** harness —
including legacy ones that do not use sdlc-skills. **sdlc-skills is a
consumer**: it registers the engine and porting skill as external `repo:` skills
in `skills.json`, pinned to a release tag, and keeps only its test-automation
extension. There is exactly one copy of the engine (§14.1). Delivery-monitor
joins the same repo later (§11).

**What we ship (two distributable forms, Claude and Copilot, from one source):**

| part | what | who writes code |
|---|---|---|
| **Engine** (§14) | generic tokenomics: capture for every registered host, scope, sweep, ledger + telemetry branch, join, reports, doctor — configured by `settings.json` + `module.json` (§14.4) | us; released from `harness-telemetry`, updated by its installer (or `npx sdlc-skills init --update` for sdlc-skills users) |
| **Contract + kit** (§1–§8) | wire format, schemas, `check` / `aggregate`, fixtures | us; doubles as acceptance test |
| **Porting skill** `tokenomics-port` (§15) | agent-run toolkit: discover the harness → interview the operator → install engine + generate glue → verify | the agent, **glue only** |

**The operator story.** In any harness (Claude Code or Copilot), the operator
says *"I received the tokenomics blueprint — add this capability to our
harness."* The active session runs `tokenomics-port`; it discovers the hosts,
hooks, tracker and work-item records, asks only what it cannot infer, installs
the engine, writes `module.json` and the project glue (id policy, receipt
adapter, scope hand-off in the orchestrator, harness-policy updates), and loops
on `check` + `doctor` until green. Result: the same data layer as sdlc-skills,
and cost per delivered work item in the project's own terms.

**Success — all required:**

1. Kit: every port-mode fixture and harness test passes; expected totals match.
2. Engine: (a) **B1 pure extraction** — on the test-automation fixtures, engine
   + TA extension + TA configuration reproduce the reference's payloads and
   rendered bytes exactly (fixed clock, config, fixtures); (b) **B2** — each
   enumerated behaviour migration (§14.8) changes only what its before/after
   fixture shows.
3. Reference data: the **reference corpus** (§18.1) — telemetry written by the
   real reference writer — reads in reference mode with zero `error`.
4. Porting skill: on a fresh LeRisque clone, a fresh **Claude** session and a
   fresh **Copilot CLI** session each produce a port that passes
   `check --mode port --profile core,scope,receipts`, reports cost per
   delivered story, and verifies capture per host: Claude by `doctor --probe`
   (hooks fired + expected result); Copilot by hooks fired **or** demonstrated
   sweep capture labelled **partial** with its limitation stated (D5); the VS
   Code sidebar by a real sidebar session + sweep. `aggregate` rolls up both
   ports with the corpus.
5. Export: pinned to the hyperfactory guide (§6). Until then, partial acceptance
   (ledger layer) — stated, not glossed over.

**Non-goals:** uploading anything; OTel as a data plane; forensic cross-fork
dedup; standardising a cost-allocation algorithm across ports; the agent
editing engine code.

## 1. Shape of the spec

### 1.1 Two tiers — never mixed

| tier | for | character |
|---|---|---|
| **Port wire contract v1** (§2–§6) | data written by any **new** port | normative, strict; rules beyond current reference behaviour are marked **NEW** |
| **Reference reading profile** (§7) | data already written by the sdlc-skills reference | permissive; surfaces weaknesses as findings, never "fixes" data |

A reader selects the tier **explicitly** (`--mode port|reference|mixed`). `mixed`
applies the port contract to lines carrying `writer` and the reading profile to
lines without it (§14.7); `port` **rejects** a line without `writer`. It never
infers the tier from `v`, and never retries a failed port-mode validation in
reference mode.

### 1.2 Evidence classes (every kit finding carries one)

| class | meaning | effect |
|---|---|---|
| `error` | structure or consistency the input itself proves wrong | exit ≠ 0; record excluded from verified totals |
| `conflict` | two records with the same identity **at equal rank** carry different accounting payloads (§3.5); successive ranked snapshots are not conflicts | exit ≠ 0 in port mode; excluded from verified totals, shown in preview |
| `limitation` | a *known possible* weakness from writer provenance (e.g. reference Copilot quads, §7.4) — not a proven violation | exit 0; flagged in totals |
| `unverified` | a property the supplied evidence cannot establish (growth, append-only, prompt opt-in history, identity uniqueness, anonymisation completeness) | exit 0; listed |

Every diagnostic names the evidence it needs; absent evidence ⇒ `unverified`,
never pass.

**Verified is decided per record and per metric.** A record's dollars can be
verified while its tokens carry a `limitation`. A metric enters **verified
totals** only if (a) the record has no `error`/`conflict`, (b) its identity is
verified (§3.4), and (c) that metric has no `limitation`/`unverified` finding.
Everything else is summed into separately reported **unverified totals** — never
dropped silently, never merged into verified.

### 1.3 Profiles

| profile | status | covers |
|---|---|---|
| `core` | **required** | substrate data rules, manifest, ledger line, identity/dedup, honesty, `--sweep` |
| `scope` | optional | scope records + scope stamp |
| `receipts` | optional | receipt contract + join properties (§5) |
| `export` | **reserved — conformance unavailable** until §6's authority is pinned | hyperfactory 1.0 rows |

A port with only `core` already aggregates with everyone.

## 2. Shared telemetry substrate

Data rules are normative; setup choreography is a recommendation.

- **Location.** `.agents/telemetry/<module-dir>/`. Two conforming forms:
  *submodule form* (recommended — same-repo submodule, `url = ./`, own
  `telemetry` branch, `ignore = all`; main tree never dirty) or *plain-folder
  form* (ordinary committed folder). Same layout and rules either way.
  **The plain-folder form is forbidden where the harness binds a gate to a
  commit** (e.g. LeRisque's Stage 4.5 acceptance report pinned to HEAD): a
  capture commit on a feature branch would invalidate the gate (PoC P5). The
  porting skill detects or asks about such gates (§15.2).
- **In submodule form the main tree is never written by the engine** at
  capture, scope or report time: reports and close-time records go to the
  telemetry branch under `<module-dir>/reports/`; the only main-tree artefacts
  are the engine install, `.agents/tokenomics/settings.json` and the project's
  glue (PoC P5). (The TA configuration keeps its legacy in-tree layout, §14.8.10.)
  Plain-folder form writes the main tree by definition and is never chosen
  silently (§14.2).
  `.agents/telemetry` MUST NOT be gitignored. A repo with no remote conforms.
- **Modules.** One subfolder per module; a module writes only inside its own.
  Names are free; `module.json` declares the module (§3.1).
- **Per-user files.** Ledger file names carry a user slug (`git user.name` →
  OS user → email local-part; lower-cased, non-`[a-z0-9]` runs → `-`, trimmed,
  empty ⇒ `unknown`). The slug is a **label for conflict-free appends, not an
  identity**: distinct people can collide on a slug (known limitation).
- **Append-only JSONL** for ledgers; JSON documents (manifest, scope, config)
  are rewritten whole.
- **Sync.** Best-effort commit+push at capture moments; failure never fails a
  hook; opt-out `<MODULE>_NO_SYNC=1`. Team readers pull first.
- **Working state** (transient files) SHOULD stay out of commits. This is an
  installation-hygiene concern, checked only by an **optional** diagnostic
  (tracked working files in a checkout); interchange validation never needs a
  git checkout, and a standalone snapshot reports it `unverified`. Durable pending scope records (`scopes/pending-*.json`)
  are data, not working state; dot-prefixed markers (`.pending-*`, `.nagged-*`,
  `.unclosed-*`) are working state.

## 3. Port wire contract v1 — data

### 3.1 Module manifest `module.json` — **NEW**

The wire-level manifest (what any reader needs). The engine's configuration
settings live in a separate `settings.json` (§14.4).

```json
{ "module": "tokenomics", "schema_version": "1.0",
  "domain": "github-issues-stories",
  "receipts": { "source": "command", "deliveredOutcomes": ["delivered"] },
  "ratioIntents": ["story", "spike"], "manifestRevision": 1 }
```

`module`, `schema_version`, `domain`, `manifestRevision` required; a revision's
semantics never change once written (§14.4). `receipts` required for profile
`receipts` (§5.1). `ratioIntents` optional — the intents whose spend forms the
scoped per-delivered ratio (§5.5); it does **not** filter group cost.

### 3.2 Ledger line — `usage-<user-slug>.jsonl`

| field | type | req | notes |
|---|---|---|---|
| `v` | `1` | ✔ | |
| `writer` | `"tokenomics-engine@<semver>"` | ✔ port | provenance of the **measurement** (§14.7); restamping never changes it |
| `manifestRevision` | int ≥ 1 | ✔ port | the `module.json` revision the line was written under (§14.4) |
| `restampedBy` | string | – | set when a scope-only restamp appended this line (§14.11) |
| `host` | registry string (§4.2) | ✔ | |
| `id` | string | ✔ | native host session id, verbatim (§3.4) |
| `user` | string | ✔ | slug (label) |
| `capturedAt` | timestamp (§3.3) | ✔ | capture bookkeeping |
| `repo` | string | ✔ | basename — label, not identity |
| `branch`, `role` | string \| null | ✔ | null where the host cannot know |
| `models` | string[] | ✔ | sorted, distinct |
| `startedAt`, `endedAt` | timestamp \| null | ✔ | |
| `wallMin`, `activeMin`, `turns`, `toolCalls`, `toolErrors` | int ≥ 0 \| null | ✔ | **null = host does not expose it** (NEW: never 0-for-unknown) |
| `tokens` | quad \| null | ✔ | `{input,output,cacheRead,cacheWrite}` ints ≥ 0; null = unmeasured |
| `tokensBasis` | `"parent"` \| `"inclusive"` | – | **NEW**, default `"parent"` (§3.2.1) |
| `tokensByModel` | `{model: quad}` | – | a breakdown of `tokens`, never additional |
| `costUsd` | number ≥ 0 \| null | ✔ | billed/metered only |
| `costSource` | registry string | ✔ | `"none"` ⇔ `costUsd` null |
| `cases` | string[] | ✔ | sorted, distinct, opaque ids — never surrounding text |
| `subagents` | dispatch[] | ✔ | may be `[]` |
| `skills` | string[] \| null | ✔ | null = not observable |
| `dispatches` | int ≥ 0 | ✔ | |
| `tokensAttribution` | `"partial"`\|`"none"` | – | present iff some unit's usage is unmeasured |
| `scope` | `{intent, batch?, cases, outcomes?: {id: string}, role?}` | – | stamp at capture time (§3.6); `role` = declaring orchestrator (§14.11) |
| `title` | string \| null | – | |
| `prompts` | `{t: timestamp\|null, text: string}[]` | – | only when `capturePrompts` was on at capture; `text` ≤ 200 chars |
| `dispatched` | `{type: string, description?: string}[]` | – | same opt-in |

**Dispatch entry:** `role` (string), `label` (string ≤ 160), `n: 1`, `tokens`
(quad \| null), `activeMin`, `toolCalls`, `toolErrors` (int \| null) required;
`id` (dispatch id), `cases[]`, `costUsd`, `tokensByModel` optional.

`cases` / `batch` keep their v1 names for wire compatibility; they mean
*work-item ids* / *work-item group* in every domain.

#### 3.2.1 Accounting grain — what may be added to what

- `costUsd` is **session-inclusive** (parent + all dispatches). Dispatch
  `costUsd` is a measured breakdown, never added to the session's.
- `tokensBasis: "parent"` ⇒ session `tokens` and each dispatch's `tokens` are
  **disjoint contributions**; session total = parent + Σ dispatch.
- `tokensBasis: "inclusive"` ⇒ session `tokens` already includes every
  dispatch; dispatch `tokens` are informative and MUST NOT be added. Use it when
  the host measures categories only at session level (Copilot). **A port MUST
  NOT invent a category split the source does not provide** — conservation holds
  at the grain and categories actually measured.
- Under `inclusive`, `tokensAttribution` describes only whether the **session
  total** is complete; an unavailable dispatch split is implied by the basis and
  is not an attribution gap.
- `turns`, `activeMin`, `wallMin` are **host-defined** (each host's definition is
  in §4.2) and not comparable across hosts; aggregators report them per host.
- By-role dollars = the parent session's role, inclusive. Per-dispatch-role
  dollars are reported only as a separate measured breakdown.
- Aggregates carry unknowns as counts (`unpriced: n`, `unmeasured: n`), never
  as zero.

### 3.3 Timestamps and canonical form

Timestamps are UTC ISO-8601 with a `Z` suffix (`YYYY-MM-DDTHH:MM:SS(.sss)?Z`),
compared as parsed instants. Canonical JSON (for tie-breaking and payload
equality) = keys sorted recursively, no insignificant whitespace, numbers as
JSON-serialised by ECMAScript `JSON.stringify`.
**Accounting payload** = every field except `capturedAt`, `user`, `repo`,
`branch` (observer labels and capture bookkeeping).

### 3.4 Identity

- The identity of a session is `host:id`, where `id` is the **native session id
  as the host stores it**, verbatim — so two ports observing the same session
  derive the same key, and it is deduplicated as one spend. Ports MUST NOT
  prefix ids with repo/module/port.
- **Global uniqueness is an assumption, not a guarantee.** Claude and VS Code
  ids are normally generated UUIDs; Copilot CLI/SDK permit caller-chosen ids
  (e.g. `user-123-task-456`). Therefore: a registered host declares in §4.2
  whether its ids are *generated-UUID* or *caller-chosen*. For caller-chosen
  ids, identity is `unverified` (UUID shape proves nothing about reuse), so those
  records' metrics go to unverified totals; generated-UUID hosts give verified
  identity. **NEW** for ports on caller-chosen hosts: SHOULD choose UUID ids. A
  stable source-namespace scheme for caller-chosen ids is deferred to v2 of the
  wire format.
- Ownership diagnostics are independent of timestamps: one `host:id` seen with
  different `repo` or `user` labels is reported (`limitation` — it may be the
  same session observed from two contexts, or a reused id).
- A session present in several modules counts once in cross-module totals;
  per-module views show it in each, labelled shared. Per-user, per-role and
  per-intent totals use the **winning line's** labels; ownership differences
  are reported, never used to pick the winner.

### 3.5 Dedup and conflicts

Readers key by `host:id`. Winner = greatest `endedAt`, then greatest
`capturedAt` (null ranks lowest). Successive snapshots with different ranks are
normal growth. Exact rank tie: identical accounting payload ⇒ duplicate
(fine); different payload ⇒ `conflict` — excluded from verified totals,
shown in a preview total with a deterministic pick (lowest canonical JSON).
A superseding line is written when the accounting payload changed; a deliberate
forced refresh with an unchanged payload is allowed (it dedups to the same
measurements).

### 3.6 Scope record — `scopes/<session>.json` (profile `scope`)

| field | type | req | notes |
|---|---|---|---|
| `v` | `1` | ✔ | |
| `session` | string | ✔ | native id, or `pending-<stamp>` |
| `intent` | string | ✔ | open vocabulary; writer default `automation` in the reference, port's own domain default otherwise |
| `batch` | string | – | work-item group |
| `cases` | string[] | ✔ | sorted, distinct |
| `source` | string | – | who declared it; `handoff` = the orchestrator hand-off (§14.11) |
| `role` | string | – | **NEW** — the declaring orchestrator's role (a skill or agent name), used when the ledger `role` is null (PoC P11) |
| `declaredAt`, `updatedAt` | timestamp | ✔ | |
| `outcomes` | `{id: {outcome: string, at: timestamp}}` | – | overwrite per id |
| `closedAt` | timestamp | – | an upsert preserves an existing `closedAt` |
| `claimedFrom` | string | – | the `session` value of the pending record this was claimed from |

**Pending claim (informative — port mechanics are free).** The reference, when
capturing session S: uses S's own scope record if one exists; else, if S has a
start time, picks among pending records whose `declaredAt` lies in
`[startedAt − 5 min, (endedAt ?? now) + 5 min]` the one closest to
`startedAt`; writes it as S's record with `claimedFrom` = the pending record's
`session` value, and removes the pending file. Selection is per invoked session,
not globally optimal; two sessions racing for one pending record are
**`unverified`** single-owner attribution. Ports need only produce valid §3.6
records. The ledger's `scope` stamp is a **snapshot at capture**; later
scope edits do not invalidate earlier stamps.

### 3.7 Capture config — `config.json` (telemetry branch, team-shared)

This file stays **authoritative for capture settings** (it is team-shared on
the telemetry branch); the main-tree `.agents/tokenomics/settings.json`
(§14.4) holds only project-executable settings and never duplicates these keys.

The file and every key may be absent; defaults
`{capturePrompts:false, priceAtCapture:true, maxSweep:10, vscodeUserDataDirs:[],
otel:null}` are overlaid. `otel` is `null | {enabled:false} |
{enabled:true, endpoint:string}`. `priceAtCapture` controls only an external
metering call (Claude/ccusage); host-billed figures are always recorded. Writers
preserve unknown keys. Malformed config ⇒ `error` in port mode.

### 3.8 Snapshot-checkable invariants (port mode)

Schema validity; `costSource`/`costUsd` consistency; registry membership of
`host`/`costSource`; sorted/distinct arrays; timestamp form; `tokensBasis`
consistency (`inclusive` ⇒ for each category where every dispatch and the
session are measured and comparable, Σ dispatch ≤ session, else `error`; null
or non-comparable categories ⇒ `unverified`, never treated as 0); `prompts`/`dispatched` present ⇒ `unverified` opt-in
history (config is read at capture time and not snapshotted); dedup conflicts;
ownership diagnostics. Growth, append-only and completeness are **not**
snapshot-checkable — §8.3.

## 4. Capture adapter obligations

### 4.1 Capture moments (reference, for orientation)

| moment | Claude Code | Copilot CLI | VS Code sidebar |
|---|---|---|---|
| session end | `SessionEnd` | `sessionEnd` (CLIs that have it) | — |
| start sweep | `SessionStart` (startup/resume), async | `sessionStart` | opt-in `folderOpen` task |
| dispatch finished | `SubagentStop` | `subagentStop` (`subagentStart` only marks "work dispatched") | — |
| batch close | `work-scope close` snapshots the running session | no direct capture; reads prior ledger/live data | no direct capture |
| any host | `--sweep [--all]`, optional git post-commit sweep | ← | ← |

**`core` requires:** a `--sweep [--all]` entry point; a ledger line is a
**cumulative snapshot, not proof of completion**; the sweep is bounded and
best-effort (recently active, deferred or unreadable sessions may need later
sweeps; `--all` lifts only the budget); repeated sweeps are dedup-stable.

### 4.2 Registries (open; add rows by PR)

| `host` | session id | `turns` | `activeMin` | `wallMin` |
|---|---|---|---|---|
| `claude` | generated-UUID (transcript stem / hook `session_id`) | deduped parent assistant messages | parent active time with gaps > 30 min **excluded**, + Σ dispatch active; each rounded to whole minutes | first → last parent timestamp, rounded minutes |
| `copilot` | **caller-chosen** (session-state dir name) | parent user + assistant messages | active time over all events, gaps > 30 min excluded, rounded minutes | first → last event, rounded minutes |
| `copilot-vscode` | generated-UUID normally (chatSessions file stem) | requests | Σ request `elapsedMs` ÷ 60 000, rounded (missing `elapsedMs` ⇒ 0) | session start → end, rounded minutes |

| `costSource` | meaning |
|---|---|
| `ccusage-metered` | Claude, metered by ccusage at capture |
| `copilot-nano-aiu` | Copilot CLI billed `totalNanoAiu` (1 credit = $0.01) |
| `copilot-credits` | VS Code sidebar billed `copilotCredits` |
| `none` | no real figure |

No registry entry may denote an estimate. Unknown `host`/`costSource` ⇒
`error` in port mode.

### 4.3 Adapter test drivers (for §8.3)

A port supplies a **thin, port-specific driver** (no prescribed signature, no
internal refactor required) for:

- **parse** — source fixture in, ledger line out; no network, metering, sync or
  writes. Proves parsing and accounting (null-not-zero, `tokensBasis`,
  conservation at the measured grain).
- **state transition** (optional) — previous captures + a force flag in, the
  proposed append operations out. Only with it can superseding/forced-refresh
  behaviour be claimed; without it that behaviour is `unverified`.

Results hold **on the fixtures run** — not universally.

## 5. Work-item receipts and the cost join (profile `receipts`)

The spec standardises the join's **inputs** and **properties**, not its
algorithm. Different honest allocation policies are wire-compatible but need not
produce identical group costs; comparability across ports is not a consequence
of conformance.

### 5.1 Receipt — file or reader adapter

A receipt is a JSON object, from one of two **sources** (`receipts.source`):

- `files` — `<receipts.root>/<group>/<receipts.file>` (the reference's form;
  nested groups allowed; group key = root-relative path; dirs starting `_` or `.`
  hold none). The pipeline writes them.
- `command` — **NEW** — a project glue command that prints receipts (envelope
  and execution rules in §5.6).
  This lets a harness keep its existing work-item records as the source of
  truth (LeRisque: `specs/done/*/spec.md` frontmatter + acceptance verdict)
  instead of changing a gated pipeline to emit new files (PoC P5).

```json
{ "group": "issue-356", "work_item_ref": "#356", "rollup": false,
  "cases": [ { "id": "issue-356", "outcome": "delivered", "at": "2026-10-09T18:02:11Z" } ] }
```

`group` required for `command` receipts (implied by path for `files`).
`cases[]` required; each row has `id`; `outcome` a string (absent ⇒ group cost
reports it as unknown; team counts read it as `not-started`); `at` — **NEW,
optional** — when the row's outcome became true, used for windowing (§5.5).
`rollup: true` marks a group that aggregates other groups (an epic over
stories) and is excluded from additive sums. Other fields are the domain's own.
Ids are compared by **exact, case-sensitive string equality** — never substring.

### 5.2 Outcomes

Open vocabulary; delivered = `receipts.deliveredOutcomes`. **Team counts:** one
row per id across all receipts, using the **single receipt ordering** below.
**Group cost:** each receipt's own rows.

**Receipt ordering (one rule, everywhere).** Each case row's rank =
(`revision`, `at`, `group`, `source`): `revision` is an ISO-8601 UTC instant of
when that receipt state was produced — comparable across groups and receipts;
missing `revision` ranks below any present one; then later `at`; then lowest
`group`, then lowest `source`. File mtime is used **only** in reference mode,
as the `revision` of a reference-era `files` receipt.

### 5.3 Membership evidence

A port documents which evidence assigns a session or dispatch to a group
(declared scope, structured receipt ids, branch, mined ids). A per-group
breakdown of spend by evidence kind is optional.

### 5.4 Allocation conservation — the join's required property

For each deduplicated source session and each additive measured quantity
(dollars, each token category, active minutes): the contributions attributed to
groups are non-negative and **sum to at most the source quantity** (tolerance:
0.01 USD / 1 token / 1 min per source to absorb rounding); the remainder is
reported as **unallocated** with a reason; complete attribution ⇔ remainder 0.
Unknown quantities stay unknown. A finer-than-session allocation is allowed only
where the source measures disjoint contributions: tokens with `tokensBasis:
"parent"`, dollars where per-dispatch `costUsd` is measured. Otherwise the
inclusive session quantity is allocated **once, at session grain**, or its finer
allocation is left unknown. Active minutes are never partitioned across
dispatches (concurrent dispatches overlap). The
property applies across the whole allocation cohort (all groups at once), and a
rollup receipt (campaign over waves) is declared as such and excluded from
additive sums. Labelled allocations (`loaded` = direct + overhead share) are
permitted when marked as allocations.

Verified with a **join replay fixture** that returns an allocation trace
(source → group → amount, plus residuals); test-only, no production artifact.

### 5.5 Scoped per-delivered ratio and windows

**Semantics: current state, UTC.** The ratio counts items whose **current**
(winning) state is delivered, dated by that state's `at`; an item delivered,
reopened and delivered again counts once, at its latest delivery, so historical
ratios can change when items reopen (stated in every report). A report window is
`[since, until)` in UTC instants. Defaults: `since` = earliest `endedAt` among
the ledger lines in the report's scope (the telemetry cohort start — never
"all time", which would recreate P6), `until` = report time. Steps, in order:

1. **Receipts:** dedup per id across all receipts by the §5.2 ordering; the
   winner's outcome is the item's current state. A reopened item is simply a later
   revision with a non-delivered outcome.
2. **Denominator:** items whose winning outcome is delivered **and** whose `at`
   lies in the window. Delivered items without `at` are excluded and reported as
   `unwindowed`.
3. **Numerator:** priced `costUsd` of deduplicated sessions whose
   `scope.intent ∈ ratioIntents` and whose `endedAt` lies in the window. A
   session's cumulative line is attributed wholly to the window of its
   `endedAt`; no in-window deltas are claimed (limitation, stated in the report).
4. **Result:** `null` when the denominator is 0, when no eligible session
   exists, or when none is priced — a measured `$0` is distinct from all three.
   Partial pricing ⇒ labelled **partial** with priced/eligible coverage.
   Role-filtered reports suppress the ratio, like the reference.

Group cost stays membership-based. Fixtures: old deliveries + today's spend,
a reopened item, repeated ids with conflicting revisions, undated outcomes,
boundary-spanning sessions.

### 5.6 Receipt command contract

- **Envelope:** the command prints `{"schema": 1, "complete": true|false,
  "receipts": [ … ]}`; each receipt may carry `revision` (ISO-8601 UTC instant, §5.2) and `source` (where it was read from). `complete: false` (e.g. a
  paginated tracker query that stopped early) is reported as partial evidence.
- **Execution:** argv without a shell, cwd = repository root, `timeoutSec`
  (default 60), stdout capped at 20 MB, read-only by contract; nonzero exit,
  timeout or malformed output ⇒ receipts **unavailable** (never an empty
  successful set); missing credentials ⇒ unavailable.
- **Trust:** only the main tree's `.agents/tokenomics/settings.json` names a
  command. `check` is structural by default and **never** executes commands
  found in a telemetry snapshot; `--run-receipts` executes the project's own
  configured command; `--receipts-file <json>` feeds captured output for
  offline, reproducible checks.

> **As implemented (Plan 7).** The shipped adapters print `{"schema":1,"complete":…,"receipts":[{"group","source",
> "cases":[…]}]}` with each case an explicit projection `{id, outcome, at?, atSource?, type?, points?, sprint?}` (no
> titles, people or URLs). `complete: false` is reported when a requested id is missing, a page cap is hit or the API
> says it is truncated. Credentials come from the environment or the tracker CLI's login, never settings or argv. A
> failure exits 1 with one `<adapter>: <class> (<code>)` line. `delivery-report --receipts` runs the command.

## 6. Hyperfactory export (profile `export`) — reserved

The ai-hyperfactory tokenomics guide (schema 1.0) is the authority, but its
location and revision are **not yet pinned** (§13 Q1). Until they are, this
spec defines no export schema and the profile's conformance is unavailable;
the reference's local checklist does not stand in for the authority.

Already settled for when it is pinned:

- **Wire validity ≠ submission readiness.** A valid row may be incomplete;
  missing domain equivalents and missing measurements are readiness findings,
  not conformance errors. Optional domain fields may be omitted or `null`.
- `work_item_ref` unique within a segment (a snapshot can check only the rows it
  has; proving no group was overwritten needs the group→ref mapping).
- **Anonymisation** is an optional transform with explicit input values (the
  sensitive strings to remove) and a paired before/after fixture; without those
  inputs the kit reports completeness `unverified`.

## 7. Reference reading profile (`--mode reference`)

How to read data written by the sdlc-skills reference without changing it.

### 7.1 Layouts accepted

Module dir `automation/` (manifest absent ⇒ implied manifest below); the
flat-era layout (ledgers/config/scopes directly at `.agents/telemetry/`);
mixed layouts; `usage.jsonl` (un-suffixed) alongside `usage-<slug>.jsonl`.
Implied manifest: `{module:"tokenomics", schema_version:"1.0",
domain:"test-automation", receipts:{root:".agents/automation", file:"report.json",
deliveredOutcomes:["delivered","defect-found","automated",
"merged-sanctioned-red"]}, ratioIntents:["automation"]}`.

### 7.2 Host variants accepted

| variant | differences from §3.2 |
|---|---|
| Claude, ordinary | `tokensAttributed:false` may appear; `prompts`/`dispatched` object shapes as §3.2 |
| Claude, folded dispatch | dispatch lacks `tokensByModel` and `tokensAttributed`; session carries `foldedFromLive: n`; enclosing `tokensAttribution`/`models` not recomputed |
| Claude, pre-`fa0a6fb` | no `tokensByModel`, no dispatch `id`/`cases`, no `scope`, no attribution flags; absent usage written as zero quads |
| Copilot | no `tokensByModel`; dispatch has no `id`/`cases`; dispatch `tokens.input` = host total, others 0; session input netted by Σ dispatch totals (clamped at 0); shutdown without usage written as a zero quad with no attribution flag |
| VS Code | no `tokensByModel`; `branch:null`; `toolCalls:0` and `skills:[]` are unconditional (not observable); `toolErrors` is measured (request errors); `title` may be null; missing usage written as 0; missing `elapsedMs` ⇒ 0 active minutes |

All of these read as `tokensBasis:"parent"` with the limitations in §7.4.

### 7.3 Unknowns

Unknown `v` or unknown `costSource`: retained and shown diagnostically,
**excluded from verified totals** (no supported interpretation); other known
fields reported as `unverified`.

### 7.4 Known limitations (reported per affected record as `limitation`)

Zero-for-unmeasured quads and counters (pre-`fa0a6fb`, Copilot shutdown without
usage, VS Code usage/`toolCalls`/`skills`/`elapsedMs`); Copilot
category split not measured and possible non-conservation of the session total;
folded-dispatch metadata loss; reference ids trusted without validation (§3.4);
email-local-part slugs in early ledgers; reference group costs may count a
shared-id dispatch at full weight in several groups (§10). A limitation is a
*known possibility from provenance*, not a proven violation.

## 8. Conformance kit — deliverables

All new, read-only, stdlib-only Node. Nothing touches existing write paths.

```
specs/telemetry/
  SUBSTRATE.md  TOKENOMICS.md  READING-PROFILE.md  REGISTRY.md  PORTING.md
  schemas/        module, ledger-line.v1, dispatch, scope.v1, config, receipt
  fixtures/
    port/valid/ port/invalid/        single-fault files, named for their rule
    reference/                       per variant in §7.2, pinned to d9eac08 / fa0a6fb / 49577c7
    aggregate/                       cohorts with EXPECTED TOTALS (below)
    join/                            replay cohorts with expected allocation traces
bin/telemetry-conformance.mjs
  check     <telemetry-dir> --mode port|reference [--profile core,scope,receipts] [--repo <root>] [--json]
  aggregate --input port:<dir> --input reference:<dir> …  [--since --until] [--json]
```

### 8.1 `check`

Read-only. Schema validation (built-in validator for the keyword subset the
schemas use — no dependencies), then §3.8 invariants; `--repo` supplies the
project root for `receipts`: a `files` root is read directly; a `command` runs
only with `--run-receipts`, or its captured output is passed with
`--receipts-file` (§5.6). Exit 0 iff no `error`/`conflict` (port mode) or no
`error` (reference mode). Single-fault fixtures must report their intended rule
(other diagnostics allowed).

### 8.2 `aggregate`

Each input carries its own explicit mode (`--input <mode>:<path>`, or an input
manifest listing them); the mode is preserved through validation,
normalisation and global dedup. Rolls up any conforming module dirs: sessions, tokens (honouring
`tokensBasis`), real dollars, by host / user / role / module / intent; per-host
time and turns. Emits **verified totals** (excluding `error`/`conflict`/unknown
records) and **preview totals** (deterministic picks), plus coverage counts
(unpriced, unmeasured, conflicts, unverified identity). Canonicalises input
paths so a dir given twice is read once.

**Compatibility boundary:** lines with `tokensBasis:"inclusive"` need this
reader; the reference `team-report.mjs` ignores the field and would add
dispatch tokens again (100 inclusive + 40 dispatch → 140). Ports emitting
`inclusive` therefore aggregate through `aggregate`, not the reference report.

**Expected-total fixtures:** same dir twice; one session captured by two
modules/ports; distinct sessions with colliding caller-chosen ids; identical vs
conflicting exact ties; current + historical lines mixed; unmeasured usage;
`inclusive` vs `parent` bases; Copilot reference lines; shared receipt ids.

### 8.3 Harness drivers

`node --test` drivers call a port's §4.3 parse driver on source fixtures
(unmeasured usage, category conservation at the measured grain), its optional
state-transition driver (growth, superseding, forced refresh) and its join entry point on §5.4 cohorts. Results are scoped to
the fixtures run. Run against isolated fixture state only; never real host
stores, never with metering/sync enabled.

## 9. Porting guide

Superseded by the porting skill (§15). `PORTING.md` documents the same steps
for a human or for a harness that cannot run the skill: install the engine,
write `settings.json`, write the glue (§14.5), verify with the kit.

## 10. Reference defects found during review (fixed in B2, §14.8)

1. Copilot nets the full dispatch total from session **input only**, clamped at
   0 — session totals can diverge from the host's (`telemetry-capture.mjs:961–972`).
2. Group membership uses case-insensitive **substring** OR matching — `TC-1`
   matches `TC-10` (`batch-cost.mjs:256–265`).
3. A dispatch naming ids of two groups is counted at full weight in both
   (`batch-cost.mjs:513–527`).
4. `--anon` leaves the batch slug in the `.agents/automation/<slug>/cost.json`
   path inside `notes` (`build-tokenomics-export.mjs:135`, `:185–193`).
5. Zero written for unmeasured values (Copilot usage-less shutdown, VS Code
   `toolCalls`/`skills`/usage); folded dispatches drop metadata without
   recomputing session flags.

## 11. Delivery-monitor — the next blueprint

Reuses §1 (tiers, evidence classes), §2 (substrate) and the kit skeleton.
`delivery/` gets `module.json` (`module: "delivery-monitor"`), its event ledger a
port contract + reading profile in `DELIVERY.md`, and the kit a `delivery`
profile. Its parked cost join (`metrics.md` §6.12) becomes a consumer of this
spec's ledger. Starts after C2 (§12).

## 12. Milestones and acceptance gates

Every success criterion (§0) has exactly one gate.

| # | deliverable | gate (inputs → expected) |
|---|---|---|
| **R0** | **bootstrap** `harness-telemetry`: repo skeleton, CI, zero-dep installer stub, test runner, hermetic replay runner (§18.2) | CI green on an empty test suite; replay runner reproduces one reference capture deterministically twice |
| **A1** | `SUBSTRATE`, `TOKENOMICS`, `READING-PROFILE`, `REGISTRY` docs + schemas | port fixtures validate; reference fixtures pinned at `d9eac08` / `fa0a6fb` / `49577c7` read with zero `error` |
| **A2** | `check` (structural; receipts only via §5.6) + fixtures + tests | every single-fault fixture reports its rule |
| **A3** | `aggregate` + expected-total, join-replay and mixed-era fixtures (§14.7) | all expected totals match |
| **A4** | reference corpus (§18.1) built and validated | zero `error` in reference mode (success 3); coverage gate §18.3 met |
| **B0** | dependency inventory (§14.3) | reviewed; no unassigned item |
| **B1** | pure extraction (not port-conformant, §14.7) | differential harness **zero diff** on the corpus (success 2a) |
| **B2** | enumerated behaviour migrations (§14.8) | each migration's diff equals exactly its declared diff (success 2b) |
| **B3** | install path, activation gate, probe, git fallback (§14.2, §14.9, §18.5) | exact published commands on the LeRisque fixture, its wiring test unchanged; dirty/offline/interrupted-upgrade tests pass |
| **B5** | sdlc-skills consumes the external (D4): immutable revision cache, TA extension + configuration reach their paths | TA factory install yields engine + extension; two projects pinned to different tags stay independent; sdlc-skills tests green |
| **B4** | shadow run, then cutover (§18.4) | per-host thresholds met with zero unexplained differences → first **production** release; sdlc-skills pins it; reference copy removed |
| **C1** | `tokenomics-port` under Claude | success 4 (Claude) |
| **C2** | same under Copilot CLI + sidebar | success 4 (Copilot, partial allowed — D5) |
| **A5** | `export` profile | §6 authority pinned → success 5 |

Milestones are sequential. Each closes with kit + applicable gates green and a
Codex review; from R0 to B5 releases are private **candidates** (`-rc.N`); the
first production release follows B4.

Delivery-monitor follows the same pattern after C2 (§11).

## 13. Owner decisions (2026-10-10) and remaining questions

| # | decision |
|---|---|
| D1 | Kit, engine and porting skill live in a **standalone repo**, distributable to harnesses that do not use sdlc-skills; sdlc-skills depends on it. |
| D2 | The owner's projects have no tokenomics **ledger** (their telemetry branches carry delivery-monitor data), but they have large real **session stores**: `coach-android` (30 Claude sessions, 2.8 GB) and `solo` (6, 364 MB). These are the corpus inputs; the real reference writer produces the outputs (§18.1). |
| D3 | Repo: `~/dev/harness-telemetry` (named for the family — tokenomics now, delivery-monitor later). |
| D4 | One engine copy, in `harness-telemetry`; sdlc-skills references it (external `repo:` entry, pinned `ref`); the test-automation factory keeps only its extension. |
| D5 | Copilot: if headless hooks do not fire, **sweep-only, labelled partial, is accepted** for C2. |
| D6 | The engine refactor must be bulletproof → §18 is normative. |

Remaining:

1. **Hyperfactory guide** — location + revision to pin (blocks A5). Not recorded
   in this repo, its history, PR #64 or public GitHub; ask the export's author
   (Alexander Bychinskiy, GitHub `bermudas`).
2. ~~**GitHub owner** for `harness-telemetry` (the installer URL)~~ — decided 2026-10-16:
   `github.com/silver-snoopy/harness-telemetry` (public).
3. Whether a sdlc-skills **factory** can resolve a skill from the external
   registry instead of owning a copy — verified in the plan (B5); if not,
   `bin/init.mjs` gains that ability.

## 14. Engine — generic tokenomics (B)

### 14.1 What it is, where it lives, how it ships

The engine is today's tokenomics with every test-automation (TA) assumption
lifted into configuration (§14.4) or the TA extension (§14.3). Stdlib-only
Node ≥ 18.

**One installable subtree** inside `harness-telemetry` — everything a foreign
repo runs is inside it (installers copy a skill's directory):

```
harness-telemetry/tokenomics/      (registered in sdlc-skills' skills.json as an external, pinned ref)
  SKILL.md
  engine/            capture adapters, sweep, scope, join, reports, sync, doctor
  kit/               check + aggregate (shared code with engine/)
  scripts/           install-hooks.mjs, work-scope.mjs, team-report.mjs, doctor.mjs, kit.mjs
  hooks/             host hook entry points
  ENGINE.json        engine version + file-hash baseline (§14.10)
```

**No duplication.** The engine exists once, in `harness-telemetry`. In
sdlc-skills the test-automation factory keeps only
`extensions/test-automation.mjs` and its TA configuration; its `tokenomics`
skill resolves to the pinned external (D4). A standalone install has no
extension and never needs one.

### 14.2 Install path — engine only

`npx sdlc-skills init` today copies a skill and **always** adds the shared SDLC
context hooks (`bin/init.mjs` `installCoreHooks`); it never runs the tokenomics
installer, and `--git-hook` in `install-hooks.mjs` returns before hosts and
substrate are wired. B3 therefore delivers:

1. **Copy** — standalone: `npx github:<owner>/harness-telemetry#<tag> install
   <tokenomics|tokenomics-port> --target <claude|copilot>` (engine/skill files
   only; no sdlc-skills, no shared SDLC hooks). sdlc-skills users: `npx
   sdlc-skills init` with the pinned external (B5). Copying never activates.
2. **Activate** — `node <skill>/scripts/install-hooks.mjs --host
   <claude|copilot-cli|vscode> [--git-hook]`: on a fresh install the substrate is
   created and verified first; then the verified checkpoint (§18.5); then host
   hooks and ignore lines; **activation is recorded last**. `--git-hook` is
   additive.
3. `node <skill>/scripts/doctor.mjs --probe` (§14.9).

**Substrate is a prerequisite, not a fallback.** If the submodule cannot be set
up, `install-hooks` fails when the project configuration marks a commit-bound
gate (`substrate.required: "submodule"`), and `doctor` fails on any existing
`.agents/telemetry` whose branch, `ignore = all` or materialisation is wrong.
The plain-folder form remains a conforming *data* layout (§2) but is never
chosen silently. Writers stay inactive until the substrate verifies.

Hermetic install tests: for each target, install into a temp repo without
access to the source checkout, then run every documented command.

**As implemented (B3).** Copy: `node <package>/bin/harness-telemetry.mjs install tokenomics --target <claude|copilot>`
(`copilot-cli` accepted) copies exactly the baseline files listed in `tokenomics/ENGINE.json` and stamps the copy
`installed: {target, from, at}`; the source checkout keeps `installed: null`. The npx form
(`npx github:<owner>/harness-telemetry#<tag> install …`) is documented for when the package is published and is not
gated. `install tokenomics-port` exits 2 until C1. Activation states (D-ACT, `engine/activation.mjs`): `source`
(no `ENGINE.json`, or `installed` null; no gate), `active` (the repo's `.agents/tokenomics/settings.json` `engine`
equals `ENGINE.json` `engine`), `inert` (installed, activation missing or another version; hooks exit 0 and say why,
`doctor` fails), `refused` (installed with `TOKENOMICS_MIGRATIONS` set; Q3 production switch set `{}`, ruling R12
extends the refusal to every entry). The activation record is that `settings.json` `engine` field, written last
(D-REC). Substrate (D-SUB): the submodule is verified through git (`.gitmodules` url/branch/ignore, materialised,
branch `telemetry`); on failure activation fails, and only `--plain-folder` records `substrate: {"form":
"plain-folder"}`; `substrate.required: "submodule"` refuses even that; no git repository fails. A registered
submodule is never silently replaced by a plain folder (R8). Fix-wave behaviour: a clone without
`--recurse-submodules` gets a local `telemetry` branch tracking `origin/telemetry` before verification; interim
telemetry is restored file by file and a conflicting file refuses activation (`interim-conflict`) instead of being
stranded; a failed conversion restores the exact prior index entries and `.gitmodules`. An existing `settings.json` is
merged after the checkpoint, so the checkpoint holds the operator's original bytes; activation ends with one local
store commit (`tokenomics: activate <version>`) and, for an existing store, appends the working-state lines to its inner
`.gitignore` (R26). `already active` is printed only when nothing was written. The R12 refusal is fail-closed: an
`ENGINE.json` that is present but unreadable counts as installed (only an absent one is a source checkout). Every
CLI that writes under `.agents/` or into a receipts directory (`batch-cost`, `build-tokenomics-export`, `team-report`
with `--batch`/`--out`) calls the activation gate first when run from an installed copy: `inert` or `refused` exits 1
with the one-line reason and writes nothing (R19). Details: `tokenomics/ENGINE-B1.md`, "B3".

### 14.3 TA extension — interface from the B0 inventory

Known domain dependencies (from review-4; B0 completes the list):
TA stage words that choose/truncate dispatch labels at capture; predicted-size
enrichment from `.agents/estimation` and historical `cost.json`; gate-record
loading, reconciliation and close-time folding; the second stop gate's
receipt + QA-gate reconciliation prompt; workflow return-receipt id parsing;
campaign/wave nesting; QA overhead classifier; QA export fields; QA wording.

Extension interface — **ownership boundary normative, signatures indicative**
(B0 finalises them in the plan; `extensionApi` versioned; every hook optional;
the engine never calls a missing hook):

| hook | call site | in → out |
|---|---|---|
| `labelFrom(dispatchInput)` | capture, before truncation | raw dispatch input → label string |
| `receiptIds(dispatch, repo)` | capture | dispatch → structured ids |
| `classifyDispatch(label)` | join | label → `direct` \| overhead stage name |
| `enrichGroup(group, repo)` | report | group cost → extra fields (sizing, history) |
| `onClose(group, repo)` | `work-scope close` | side effects (gate folding) — TA only |
| `stopGateCheck(scope, receipts)` | scope hook | → `null` \| message (second gate) |
| `exportRow(group)` | export (A5) | → domain fields |

A foreign-harness fixture asserts none of these is invoked with
`extension: null`.

### 14.4 Configuration — two files, two roles

| file | where | role | who changes it |
|---|---|---|---|
| `module.json` | telemetry branch `<dir>/module.json` (current) + `<dir>/manifests/<rev>.json` (every revision, retained forever) | **durable reading manifest** (§3.1) — what readers need to interpret the data | written once per revision by `install-hooks`; changing an existing revision is rejected; new revision = explicit `install-hooks --update-manifest`. Every engine-written line and report records its `manifestRevision`; readers interpret each record by **its** revision |
| `settings.json` | main tree `.agents/tokenomics/settings.json` | **project executable settings** — ids, receipt command, enforcement, extension, substrate, installer targets | the porting PR / operator; branch-local by nature |

```json
// .agents/tokenomics/settings.json
{ "engine": "1.0.0", "dir": "stories",
  "substrate": { "required": "submodule" },
  "ids": { "patterns": ["#(\\d+)\\b", "\\bissue-(\\d+)\\b", "^feat/(\\d+)-"],
           "flags": "i", "normalize": "issue-$1", "max": 50,
           "mineFrom": ["branch", "labels", "prompts"] },
  "receipts": { "command": ["node", ".agents/tokenomics/glue/receipts.mjs"],
                "timeoutSec": 60 },
  "intents": { "default": "story" },
  "enforcement": { "announce": true, "stopGate": "off" },
  "vocabulary": { "item": "story", "group": "story" },
  "targets": ["claude", "copilot-cli"],
  "extension": null }
```

**Names.** Installer **targets** are `claude`, `copilot-cli` and `vscode` (the
sidebar's folder-open task, opt-in); ledger **hosts** (capture sources) are the
§4.2 registry values `claude`, `copilot`, `copilot-vscode`. Every sweep reads all
host stores regardless of targets.

The ratio key is **only** `ratioIntents` in `module.json`; `settings.json` has no
ratio key. Relative paths resolve against the repository root.

**Ids (P1).** Patterns apply **only to mined candidates** (text from the
`mineFrom` sources); each match is rewritten by `normalize` (`$1`…), JS regex
with the given flags, capped at `max` distinct ids, invalid pattern ⇒ install
error. Declared scope ids and structured receipt/extension ids are kept
**verbatim** — conversion of structured ids belongs in the project's adapter.
Under TA configuration the reference miner (stoplist, caps) is reproduced
exactly (B1).

> **As implemented (Plan 7).** Id mining is configured by `ids.rules`, an array of `{tracker, pattern, flags, normalize,
> source}` validated when settings load (never in a hook); absent or `[]` leaves the TA/B1 miner unchanged. The
> top-level `ids.normalize` and `ids.mineFrom` shown above are superseded by the per-rule `normalize` and `source`
> (`any`, `branch`). `setup` writes the rules (`--tracker`, `--tracker-keys`) and, with them, `tracker`
> (`{kind: jira|github|ado, url?, project?}`) and `receipts.command` into fresh settings only; neither changes the
> module manifest.

### 14.5 Glue — project-owned code

Lives in the main tree under `.agents/tokenomics/glue/`, committed, written
only by the porting skill or the project:

> **As implemented (Plan 7).** Adapters for GitHub Issues, Azure DevOps Boards and Jira ship in the engine
> (`adapters/github.mjs`, `azure-devops.mjs`, `jira.mjs`) and are named by `receipts.command` in the installed copy; a
> project that needs different behaviour copies one into `glue/`. The `ado` and `jira` templates below are therefore
> no longer "later".

1. **Receipt adapter** — implements §5.6. Templates: `frontmatter-specs`,
   `report-json`, `github-issues`; `ado`, `jira` later. The adapter **persists
   the interviewed era policy** in its own config block and names evidence for
   outcome and `at` separately (`atSource`: e.g. `archive-log`, `merge-commit`,
   `pr-merged`); it never uses spec creation time, checkout mtime or a verdict
   marker as delivery time. LeRisque fixtures: direct and hypothesis ids, WIP
   with PASS, verified archive, pre-ADR waiver/archive, partial merge (`Refs`),
   multiple verdicts.
2. **Scope hand-off** — instruction text at the harness's "work begins" point
   (opens the work-session scope) and, separately, at points where *other*
   sessions contribute to the same unit (e.g. a Copilot plan review). Work
   sessions close their scope independently of delivery; **delivery is reported
   by the receipt adapter**, never by a later session pretending to be the
   original one.
3. **Harness wrappers and policy updates** — launcher wrappers (outside the
   engine directory), hook counts/tables in the harness's docs, an ADR draft
   where required, ignore lines. Never a change to the harness's tests.

### 14.6 One work item, several hosts (P10)

A harness may split one unit across hosts — LeRisque runs `/sdlc` in Claude
Code and plan reviews in Copilot (VS Code or CLI). Requirements: the porting
skill wires **every host the harness uses** (discovered from its records,
confirmed in the interview); the hand-off covers each host's entry point; ids
are mined from prompts as a fallback; group reports show spend by host. How a
Copilot review participates is demonstrated end-to-end in C2, not assumed from
an instruction-file edit.

### 14.7 Mixed-era ledgers (upgrade boundary)

An upgraded install appends to the same per-user files, so eras mix within one
file. **Record-level provenance, explicit:** every line written by the **post-B2
production engine** carries a required `writer: "tokenomics-engine@<semver>"`
(B1's extraction output reproduces reference bytes and is *not* port-conformant).
Upgraded installs are read with `--mode mixed` (§1.1): port contract for
`writer` lines, reading profile for the rest — by this dedicated field, never by
inference from optional fields — with global `host:id` dedup across eras;
`--mode port` rejects lines without `writer`. No historical line is rewritten or
deleted. Fixture (A3): old and new captures of the same Copilot session,
old-only sessions, subsequent sweeps; expected totals fixed.

### 14.8 Behaviour migrations (B2) — the complete list

Each lands alone, with a before/after fixture:

1. Exact, case-sensitive id matching (§10.2).
2. Conservation-preserving shared-dispatch allocation (§10.3).
3. Copilot `tokensBasis: "inclusive"`; dispatch totals no longer stored as
   measured input (§10.1, P14).
4. `null` for unobservable counters/usage (§10.5).
5. Complete anonymisation of supplied strings (§10.4).
6. Fold recomputes session flags (§10.5).
7. Active minutes no longer partitioned across dispatches (§5.4).
8. Report windowing (§5.5).
9. Scope resolution, handles, precedence, role stamping (§14.11).
10. Reports and close-time writes relocated to the telemetry branch for
    non-TA configurations; TA keeps its in-tree layout (`reports.location:
    "tree"`) until its owner retires it.
11. `writer` field (§14.7).

### 14.9 Hook probe and fallbacks (P12)

`doctor --probe [--host h]` runs one isolated probe session per host CLI found:
temp state (`TOKENOMICS_STATE_DIR`), sync off, metering off, a unique nonce.
Every engine hook entry, when it sees the nonce, records `{event, host, at}`
before doing anything else — evidence that the hook **fired**, distinct from any
ledger line; the probe additionally asserts the probe session's **expected
result** (its ledger line and scope stamp), so a crashing hook reads `fired` +
`result: missing`, not success. Probes run only where the host has hooks: the
VS Code sidebar has none — it is verified by a real sidebar session followed by
a sweep (C2), never inferred from CLI results. Transport, variable names and
defaults are fixed in the plan. The probe session
performs one dispatch so SubagentStop/subagent events are exercised; waiting is
bounded (default 120 s). Result per event:
`fired` · `not-fired` · `unavailable` (CLI missing, auth failure, folder not
trusted — named). A probe never triggers another probe.

**Fallbacks are partial, and say so.** If session-end hooks do not fire, the
install is reported **sweep-only (partial)**: capture is eventual, via the next
session-start sweep or the git fallback, never proof of hook execution. The git
fallback is a post-commit sweep that discovers the effective hooks path
(`core.hooksPath`, worktrees), chains an existing hook instead of refusing, and
is tested by a real git-triggered run against a completed fixture session.
Limitation stated: a session that ends after the last commit is captured only by
a later sweep. Sweep-only is accepted as a **partial** result (D5).

**As implemented (B3).** Transport (D-PROBE): `TOKENOMICS_PROBE=<32-hex nonce>`, `TOKENOMICS_STATE_DIR=<temp dir>`
(ledger, scopes, markers and the fired log resolve there), `TOKENOMICS_NO_SYNC=1`, `TOKENOMICS_NO_CCUSAGE=1` (and
`TOKENOMICS_NO_SINK=1`). The fired record `{event, entry, host, session, at}` goes to
`$TOKENOMICS_STATE_DIR/probe/<nonce>.jsonl`, written before the activation gate (ruling R1), so an inert hook still
proves it fired. `event` is the host's own event name (Claude's `hook_event_name`; for the Copilot CLI, whose payload
names none, the `TOKENOMICS_HOOK_EVENT` its generated hook config sets per command, R25), else null; an event is never attributed by counting records, so an entry two events share leaves the
unproven one `unattributed`, never `fired` (R21). The expected result is matched by the probe session's identity: the
session id from the fired records, or the session whose first prompt carries the nonce — never by host and time
(R22). The probe session is never captured outside a probe: the capture skips a session whose first prompt is the
probe's (`tokenomics hook probe <nonce>`) unless `TOKENOMICS_PROBE` is set (R17). Host commands:
`claude -p <prompt> --model haiku`, `copilot -p <prompt>`, overridable by `TOKENOMICS_PROBE_CLAUDE_BIN` and
`TOKENOMICS_PROBE_COPILOT_BIN`; the default bound is 120 s (`--timeout`), after which the process group is killed.
Results per host: `fired`, `not-fired`, `unavailable` (CLI not found, auth, folder not trusted, VS Code), and
`sweep-only (partial)`. A timeout never falls back to the sweep. Git fallback (D-GIT): the hook directory is
`git rev-parse --git-path hooks`; a foreign `post-commit` is moved to `post-commit.pre-tokenomics`, run first with its
exit status preserved, then the sweep starts detached; `--remove` restores the original byte for byte. The hook script
holds no path: at run time it resolves the committing checkout (`git rev-parse --show-toplevel`) and that checkout's
installed copy (`.claude/skills/tokenomics` or `.github/skills/tokenomics`), so a shared hooks directory serves every
linked worktree (R23). The real-host
probe is run by the owner at close and recorded in `docs/plans/plan-5-ledger.md`; the B3 gate is the fixture.

### 14.10 Integrity — engine files are not glue

"The agent never edits engine files" is an **instruction plus an independent
check**, not write protection: `ENGINE.json` pins the engine version and a
hash baseline covering every installed copy (both hosts); `doctor` fails on any
mismatch or unexpected file inside an engine directory; the porting skill runs
it before and after porting. Upgrades (`init --update` + `install-hooks`)
preserve both config files, glue and wrappers; the glue/extension API is versioned
(`extensionApi`, receipt `schema`).

### 14.11 Scope resolution (P3, P4, P11, P13)

- **Host-qualified scope records.** The engine keys scopes as
  `scopes/<host>/<session>.json`; legacy flat `scopes/<session>.json` is still
  read, and an id present under two hosts is reported as ambiguous, never merged.
- **Handles.** `work-scope open --session auto` prints a machine-readable handle
  (`{"handle":"pending-…"}` on stdout). `outcome`/`close` accept the handle and
  resolve it before or after the capture claim (the claimed record carries
  `claimedFrom: <handle>`). `auto` is valid only on `open`.
- **Precedence among initial declarations** for one session: (1) `source:
  "handoff"`, (2) a pending record claimed by time window, (3) any other
  session scope. A claimed record keeps its outcomes and `closedAt`; a later
  pending declaration never displaces a claimed hand-off scope. Claims are
  single-owner and recoverable after a crash (mechanics in the plan).
- **Role.** The ledger scope stamp gains `role` (the declaring orchestrator),
  stamped at capture — reports never read mutable scope files for history.
- **Restamp.** `work-scope restamp --host <h> --session <id>` appends the
  current winning line for `host:id` with the corrected `scope` (incl. `role`),
  measured fields, `endedAt` and the original `writer` preserved, `restampedBy`
  set, `capturedAt` = now. No prior line ⇒ error. A **reference-era** winner
  (no `writer`) is rejected: its measurements cannot be certified by restamping;
  the operator runs `capture --force` (re-parse from sources, if still present)
  first. Full re-capture is that separate command.

### 14.12 Enforcement state (P2)

`enforcement.stopGate` is `off` | `on`, persisted in `settings.json`, installed
`off`. The porting skill proposes `on` only after a **hand-off probe** — a
session that follows the hand-off and is shown to declare the expected intent,
ids and role before its first dispatch — and the operator approves; the
operator can always turn it off. Both gate conditions go through the receipt
abstraction; a receipt-command failure never blocks a turn (it is reported).

## 15. Porting skill — `tokenomics-port`

### 15.1 Form and distribution

`harness-telemetry/tokenomics-port/`: `SKILL.md`, stdlib Node scripts, the spec
docs (§1–§8) and the glue templates, all inside its subtree. Installed by the
§14.2 copy step for either target (standalone), or as a pinned external through
sdlc-skills; the Claude form lands in `.claude/skills/tokenomics-port/`, the
Copilot form in `.github/skills/tokenomics-port/`. Its instructions name no
host-specific tools; host differences live in its scripts.

### 15.2 Flow

1. **Preflight** — git repo; Node ≥ 18; remote or not; an existing tokenomics
   install (→ upgrade path, §14.10); `doctor` integrity baseline.
2. **Discover** (script → `discovery.json`, read-only): hosts and how each is
   used (`.claude/settings.json`, agents/skills, `.github/hooks`, Copilot
   instructions/agents/skills, VS Code, pipeline logs naming other hosts);
   existing hooks, launcher convention, tests that police hooks, docs that count
   them; commit-bound gate signals (to confirm); tracker signals; work-item
   records and their status/verdict/timestamp evidence; orchestrators and their
   work-begins / contributes / delivered points.
3. **Interview** — only what discovery could not settle, pre-filled: hosts; tracker;
   unit of cost and hierarchy (group, item, rollups); delivered definition and
   its `at` evidence **per era**; id formats; intents; hand-off points per host;
   harness policies for new hooks; commit-bound gates.
4. **Plan + approval** — full change list (engine install commands, both config
   files, each glue file, each harness file); nothing written before approval.
5. **Implement** — §14.2 commands per target; `settings.json`; glue (§14.5).
6. **Verify loop** — until green or blocked, reporting each item:
   integrity (`doctor`); `check --mode port --profile core,scope,receipts
   --run-receipts`; glue tests on fixtures from the project's real records;
   `doctor --probe` per host (§14.9); hand-off probe (§14.12); the harness's own
   test suite; a first report. Main tree verified unchanged by capture.
7. **Hand-off** — summary: wired, unverified (and why), partial results
   (sweep-only), residual gaps; on a branch, as one PR. Stop gate stays `off`
   unless the operator turned it on.

### 15.3 Operator's call

Tracker credentials; `capturePrompts`; ADR acceptance; delivered definition per
era; enabling the stop gate; accepting a sweep-only host.

## 16. PoC and review-4 traceability

| ref | finding | resolved by |
|---|---|---|
| P1 | miner found no GitHub ids | §14.4 ids (mined candidates only) |
| P2 | stop gate without glue → junk scopes | §14.12 (off until hand-off probe + approval) |
| P3 | self-declared scope shadowed pending | §14.11 precedence |
| P4 | post-hoc correction never reached ledger | §14.11 restamp |
| P5 | main-tree writes vs commit-bound gate | §2, §5.6, §14.2 substrate prerequisite, §14.8.10 |
| P6 | historical receipts vs today's spend | §5.5 window semantics |
| P7 | delivered differs by era; QA wording | §14.5 era policy + `atSource`, §14.4 vocabulary |
| P8, P9 | harness docs and launcher conventions | §14.5.3 |
| P10 | one story spans Claude + Copilot | §14.6, C2 |
| P11 | lead role null | §14.11 role stamping |
| P12 | Copilot hooks not observed headless | §14.9, D5 |
| P13 | `--session auto` is Copilot's normal path | §14.11 handles |
| P14 | Copilot dispatch tokens one total | §14.8.3 |
| R4-1 | npx path adds core hooks, no tokenomics wiring | §14.2 |
| R4-2 | mixed-era ledger | §14.7 |
| R4-3 | byte-identical vs new semantics | §12 B1 vs B2, §14.8 |
| R4-4 | extension surface too small | §14.3, B0 |
| R4-5 | hook probe contract | §14.9 |
| R4-6 | `--session auto` not reusable | §14.11 |
| R4-7 | restamp identity/measurements | §14.11 |
| R4-8 | receipt ordering and windows | §5.5, §5.6 |
| R4-9 | LeRisque delivery evidence | §14.5.1–2 |
| R4-10 | two mutable manifests | §14.4 |
| R4-11 | normalisation of opaque ids | §14.4 ids |
| R4-12 | `after-glue` undefined | §14.12 |
| R4-13 | plain-folder vs main-tree promise | §2, §14.2 |
| R4-14 | arbitrary command in "read-only" check | §5.6 |
| R4-15 | packaging of kit/extension | §14.1 |
| R4-16 | integrity is not enforcement | §14.10 |
| R4-17 | milestones vs gates | §12 |

## 17. Review-5 edits applied (v3.2)

R4-2 explicit `mixed` mode, `port` rejects missing `writer` (§1.1, §14.7) ·
R4-5 C2 partial when hooks do not fire, until the owner revises success 4 (§12)
· R4-8 one receipt ordering, comparable `revision` instants (§5.2) · R4-10
retained manifest revisions bound per record (§3.2, §14.4) · N1 restamp keeps
measurement provenance, rejects reference-era winners (§14.11) · N2 ratio is
current-state with exact default bounds (§5.5) · N3 capture `config.json`
authoritative, project `settings.json` separate, `writer` / `manifestRevision` /
`scope.role` in §3.2 · N4 installer targets vs ledger hosts, sidebar verified by
a real session + sweep (§14.4, §14.9, §12) · N5 host-qualified scopes (§14.11) ·
N6 probe asserts marker + expected result (§14.9) · N7 `writer` only from the
post-B2 engine (§14.7) · plan-level detail marked indicative (§14.3, §14.9,
§14.11).

## 18. Refactor safety — normative (D6)

The engine refactor rewrites code that writes **unrecoverable** history
(transcripts expire). No production release ships before every gate below has passed (candidates follow §18.6).

### 18.1 Reference corpus — built first, with the real writer

Before any engine code moves, a corpus is generated by the **reference code
itself** (sdlc-skills `49577c7`, plus `d9eac08` and `fa0a6fb` for historical
shapes), in throwaway clones like the PoC:

- **Real inputs first:** frozen copies of the owner's coach-android and solo
  Claude sessions — **frozen 2026-10-10** to `~/dev/harness-telemetry-corpus-raw/`
  (6,902 files incl. 2,001 sub-agent transcripts, sessions 2026-09-10 → 10-10,
  mtimes preserved; no Copilot sessions exist for those repos). The raw freeze stays
  local and outside git; only reduced, anonymised cases enter `corpus/`.
- **Targeted inputs** for branches the real sessions do not reach
  (frozen copies of transcripts / session-state / chatSessions):
  Claude sessions with and without dispatches, workflow runs, resumed and
  continued sessions, a killed session (no SessionEnd), an expired sub-agent
  file (fold), forks; Copilot CLI sessions with dispatches and with no usage;
  VS Code sidebar op-logs (with and without credits); scope variants (handoff,
  pending, self-declared, none); receipts (files, nested waves, shared ids).
- **Outputs** — everything the reference writes from those inputs: ledger
  lines, live logs, scopes, cost files, reports, export rows.

The pair (inputs → outputs) is the oracle. It lives in `harness-telemetry`
under `corpus/`, with a manifest of how each case was produced. Real sessions
are anonymised before they are committed (no prompts, no paths beyond the
fixture root).

### 18.2 Hermetic replay and the differential harness

Every corpus case carries a **replay manifest**: initial filesystem and ledger
state, ordered events (hook invocations, CLI commands), file mtimes, clock and
entropy (Date, `Math.random`), runtime and locale (`TZ=UTC`, `LANG=C`), git and
OS identity, and **frozen pricing responses** (ccusage outputs recorded once and
served by a stub on `PATH`, so neither runner reaches the network). Runners are
isolated per case; sync, network and real host stores are disabled. Goldens are
generated **after** sanitisation, which keeps the prompt structure id
extraction depends on.

The harness replays each case through **both** the pinned reference and the
engine and diffs what a replay observes: the declared outputs byte-for-byte;
every event's stdout/stderr (diagnostics normalised); and the final-state path
changes, with content digests, under the sandbox root, excluding `.git`
directories, the manifest's `untracked` paths and writes outside the sandbox.
It does not observe file modes, mtimes, empty directories or transient writes
(`corpus/CASES.md` §"Replay infrastructure"). B1 passes only at zero diff. From
B2 on, each migration declares its expected diff and the harness asserts exactly
that.

### 18.3 Coverage gate

Coverage is measured on the **replayed entry points**, child processes included,
against the reference code. Each uncovered branch is (a) covered by a corpus
case, (b) covered by a **failure-state case** (fault injection — e.g. a failing
pending-scope write), (c) shown unreachable, or (d) an **approved reachable
exclusion** with a reason. Mechanics are plan detail.

### 18.4 Shadow run and cutover

- **Start:** the owner's projects and the LeRisque clone get the reference
  writer installed first, so a reference ledger exists.
- **Observation boundary:** at fixed points (daily), the host stores are
  snapshotted; both writers replay the same snapshot from identical isolated
  initial states, with all writes, claims and sync isolated.
- **Comparison:** specified records and metrics, with B2's declared differences
  and timestamp fields treated as declared; anything else is an **unexplained
  difference**.
- **Threshold, fixed before B4 starts:** proposed ≥ 50 real Claude sessions,
  ≥ 10 Copilot CLI sessions, ≥ 5 VS Code sidebar sessions, zero unexplained
  differences throughout.

### 18.5 Data safety, activation and rollback

- **Activation gate.** A copied engine is inert: its hooks no-op until
  `install-hooks` records an activation for this engine version. Activation
  requires a **verified checkpoint**: every durable telemetry file (incl.
  uncommitted and untracked) committed on the telemetry branch, tagged
  `pre-engine-<version>`, plus a `git bundle` backup file; and a recoverable
  snapshot of the main-tree configuration and glue (`.agents/tokenomics/`,
  harness wrappers) — the commit it was taken at, or a copy inside the bundle
  when uncommitted. Upgrades follow the
  same path; tests cover dirty and offline stores and an interruption between
  copy and activation.
- **Readers never drop formats.** Every engine release reads every persisted
  format (`mixed`). Rollback is to an earlier **engine** release at or after the
  first production release; once `writer` lines exist, the reference reader is
  not a rollback target (it double-counts inclusive Copilot records).
- **Inaugural recovery.** For the first production cutover there is no earlier
  engine release, so B4 also ships a **rescue release**: the B1 extraction
  build plus the `mixed` reader — writes reference-shaped lines, reads every
  format, preserves new records. B4's rollback test exercises it after new
  `writer` lines exist.
- **Switches stay contract-valid.** For one release, measurement migrations can
  be switched off only among combinations the contract allows; `writer` and
  `manifestRevision` are never switchable. Rollback after new records exist is
  tested without discarding them.
- No migration rewrites or deletes historical lines (§14.7).

**As implemented (B3).** Checkpoint (D-CKPT, `engine/checkpoint.mjs`): every durable file under `.agents/telemetry/` is
committed on the `telemetry` branch (plain-folder form: the orphan ref `refs/tokenomics/store`) and tagged
`pre-engine-<version>`. Working state is left out: the `.pending-*`, `.nagged-*` and `.unclosed-*` markers, `<dir>/live/**`
and, in the submodule form, every untracked path the store's own ignore rules exclude; a path the branch already tracks
is always kept. The record `.checkpoints/pre-engine-<version>/checkpoint.json` names `mainTreeCommit` for clean tracked
main-tree files and copies uncommitted or untracked ones under `main-tree/`, except a main-tree file the repository
ignores or that is named `*.local.json`: it never goes onto the shared branch, but is copied to
`<git-common-dir>/tokenomics/pre-engine-<version>/main-tree/` and listed as `localCopies` (R18). A tag without a
readable checkpoint record is refused as `checkpoint-foreign-tag`, and a failed checkpoint removes its half-written
record. The bundle is
`$(git rev-parse --git-common-dir)/tokenomics/pre-engine-<version>.bundle`, verified with `git bundle verify`. A re-run
reuses the tag only when its bundle verifies, and never moves it. If the bundle exists but its tag is gone, activation
refuses with `checkpoint-bundle-orphaned` and writes nothing (R9). The checkpoint works offline. Tests cover a dirty
store, an offline or unreachable origin, and an interruption between copy and activation (the copy stays `inert`).
Production switch refusal (R12): an installed copy refuses any non-empty `TOKENOMICS_MIGRATIONS` in every entry; gated
hooks exit 0 with one stderr line, other scripts exit 1.

### 18.6 Review and release discipline

Each milestone: applicable gates green, Codex review, a private candidate tag;
production releases only from B4 on. Consumers pin tags, never branches.
sdlc-skills resolves externals through an **immutable cache keyed by resolved
revision** (B5); until then `--symlink` installs of `harness-telemetry` are
rejected, since the shared cache can switch revisions underneath them.

## 19. Review-6 edits applied (v4.1)

1 activation gate + verified checkpoint (§18.5) · 2 rollback boundary,
format-preserving readers, contract-valid switches (§18.5) · 3 hermetic replay
manifest, frozen pricing (§18.2) · 4 shadow boundary and thresholds (§18.4) ·
5 immutable revision cache, `--symlink` rejected until then (§18.6, B5) ·
6 bootstrap-first order, B5 before B4, candidate vs production releases (§12,
§18.6) · 7 D5 propagated to success 4 and C2 · 8 tagged copy + activate commands,
§15.1 (§14.2) · 9 coverage of replayed entry points, failure-state cases,
unreachable vs approved exclusions (§18.3).

## 20. Review-7 edits applied (v4.2)

Checkpoint also snapshots main-tree configuration and glue (§18.5) · fresh
installs create and verify the substrate before the checkpoint, activation last
(§14.2) · inaugural recovery via a rescue release tested in B4 (§18.5).
