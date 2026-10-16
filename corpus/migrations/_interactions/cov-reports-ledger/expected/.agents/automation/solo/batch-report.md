# Batch cost — solo

Generated: 2026-10-05T09:02:30.000Z  ·  sessions: 2 (claude)  ·  sources: ccusage-metered  ·  models: claude-opus-5

_2 session(s) also served other batches — their session-level figures are split evenly; 3 other-batch dispatch(es) excluded._

## What happened

- Cases: 4  ·  **delivered: 3**  ·  delivered 2  ·  defect-found 1
- Gate: red
- Gate record (script-authored): green at 2026-10-01T10:00:00Z (3 run record(s))
- ⚠️ **GATE DRIFT**: receipt says `red` but the recorded verdict is `green` — write the verdict back into report.json
- ⚠️ **OUTCOME DRIFT** (2): S-3 receipt=delivered declared=blocked; S-4 receipt=— declared=delivered — reconcile report.json
- Findings reported: 2  ·  fix rounds: 1

## What it cost

- Total: $2.80  ·  1.0h active (session grain — not split per case, stage or dispatch)  ·  6.5 dispatches
- ⚠️ **TOKEN TOTALS ARE A FLOOR** — attribution partial: 1 unit(s) reported no usage (gateway pass-through gap); the real bill is higher.
- Tokens: total 91,933  ·  **real work 12,288** (in 363 / out 11,925)  ·  cache 75k read / 4k write  ·  **cache hit rate 94.2%**  ·  see batch-tokenomics for the full breakdown
- Activity: 10 turns  ·  38 tool calls (1 err, 97% ok)  ·  skills: tdd
- Overhead (lead + triage + gate + report, shown once): $1.05 (38%)
  - by stage: lead $0.85 · triage $0.10 (—) · other $0.10 (—)
- Rework (fix rounds — already inside per-case direct): $0.15  ·  1 dispatch(es)  ·  —
- **Per delivered case (incl. overhead): $0.93**
- Avg direct per case (excl. overhead): $0.58
- Direct cost spread: avg $0.58 · median $0.65 · min $0.30 · max $0.80
- Loaded cost spread (direct + even overhead share): avg $0.70 · median $0.74 · min $0.26 · max $1.06
- Active-time spread: session grain, none per case  ·  loaded: avg 15m · median 15m · min 15m · max 15m (batch time ÷ cases, an allocation)

## Per case (direct = measured; loaded = direct + even overhead share, an allocation; loaded minutes = batch time ÷ cases)

| case | size | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S-1 | M ⚠ | delivered | $0.65 | $0.91 | 9,320 (in 120 / out 9k) | — | 15m | 2 | 8 (0) | 1 | 2 |
| S-2 | M ⚠ | defect-found | $0.80 | $1.06 | 400 (in 100 / out 300) | — | 15m | 1 | 4 (0) | 0 | 0 |
| S-3 | S | delivered | $0.30 | $0.56 | 330 (in 30 / out 300) (1 unmeasured) | — | 15m | 2 | 8 (0) | 0 | 0 |
| S-4 | — | — | n/a | $0.26 | 0 (incl. cache) | — | 15m | 0 | 0 (0) | 0 | 0 |

_Cases analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-case measurement (fractional `dispatches` marks them)._

## By size — predicted (automation-scoping) vs actual

| size | cases | ΣSP | est min | actual min | actual rw tok |
|---|---|---|---|---|---|
| M | 2 | 5 | 30 | 30 | 9,720 |
| S | 1 | 1 | — | 15 | 330 |

**Estimate vs actual (batch grain): 30m predicted / 45m actual (allocated: batch time ÷ cases) — ×1.5.** Batch grain only: per-case dollars rank-correlate ~zero with predictions (scoping doctrine) — deviations below are tokens/time analysis pointers.
- ⚠ **S-1** (M, above-p90): real-work 9,320 tok (p100) vs M-class median 1,900 tok — review: estimate drift, execution smell, or a mis-sized case
- ⚠ **S-2** (M, below-p10): real-work 400 tok ≤ p10 of M-class — suspiciously cheap: verify coverage was not shortcut

## By role

| role | cost | dispatches | real-work tok | cache hit | active | tools (err) |
|---|---|---|---|---|---|---|
| session | $1.65 | 0 | 1,050 (in 50 / out 1k) | 94.2% | 30m | 6 (1) |
| lead | $1.15 | 0 | 1,050 (in 50 / out 1k) | 94.2% | 30m | 6 (1) |
| analyst | — | 1 | 9,100 (in 100 / out 9k) | 94.8% | — | 4 (0) |
| helper | — | 0.5 | 28 (in 3 / out 25) | 86.2% | — | 2 (0) |
| implementer | — | 2 | 620 (in 120 / out 500) | 91.5% | — | 8 (0) |
| reviewer | — | 2 | 330 (in 30 / out 300) (1 unmeasured) | 93.9% | — | 8 (0) |
| triage | — | 1 | 110 (in 10 / out 100) | 89.3% | — | 4 (0) |

_role cost = the parent session's role, inclusive of its dispatches; — (n unpriced) = n parent session(s) without dollars; — = not allocated at this grain: a dispatch-only role has no parent-session dollars (its dispatch dollars are the separate breakdown, never added to a role or the total)_

## Dispatch dollars by role

_measured per-dispatch dollars by dispatch role — already inside the parent role and the total, so never added to them_

| role | cost | dispatches | priced |
|---|---|---|---|
| analyst | $0.50 | 1 | 1 of 1 |
| helper | $0.10 | 0.5 | 0.5 of 0.5 |
| implementer | $0.95 | 2 | 2 of 2 |
| reviewer | $0.30 | 2 | 1 of 2 |
| triage | $0.10 | 1 | 1 of 1 |

Unattributed (no dispatch named them in any captured session): S-4

manifest revision 1
