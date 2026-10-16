> Normative extract of docs/spec.md §1, §3, §4, §5 (v4.2). The spec wins on any difference.

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

Each trace allocation is `{ source, group, quantity, amount, grain?, dispatch? }`.
`grain` is `"session"` (the default when absent) or `"dispatch"`; a
`"dispatch"` allocation names `dispatch`, the `id` of a dispatch in the source
line's `subagents[]`. Dispatch-grain amounts still count toward the session
sums above. Besides arithmetic conservation, the conformance kit rejects a
semantically invalid partition with one of five rules:

| rule | rejects a dispatch-grain allocation where |
|---|---|
| `activeMin-partitioned` | the quantity is `activeMin` — active minutes are never partitioned across dispatches (§5.4) |
| `inclusive-dispatch-split` | the quantity is a token category and the source has `tokensBasis: "inclusive"` — dispatch tokens are informative only (§3.2.1) |
| `unknown-dispatch` | `dispatch` names no dispatch in the source line |
| `unmeasured-dispatch-split` | the dispatch does not measure the quantity (no `costUsd`, or no such token category) — a finer allocation needs a measured disjoint contribution (§5.4) |
| `dispatch-overdraw` | the allocations to one dispatch and quantity, summed across groups, exceed what the dispatch measured, beyond the per-quantity tolerance |

Any other `grain` value is rejected as `unknown-grain` (it is never checked
under the dispatch rules). Rollup groups are excluded from the grain rules as
from the sums.

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

