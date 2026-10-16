# Batch cost — bt-sized

Generated: 2026-10-05T09:05:00.000Z  ·  sessions: 1 (claude)  ·  sources: ccusage-metered  ·  models: claude-opus-5

## What happened

- Cases: 2  ·  **delivered: 1**  ·  blocked 1  ·  delivered 1
- ⚠️ **OUTCOME DRIFT** (1): SIZED-1 receipt=blocked declared=delivered — reconcile report.json
- Findings reported: 0  ·  fix rounds: 0

## What it cost

- Total: $5.00  ·  0.3h active (session grain — not split per case, stage or dispatch)  ·  2 dispatches
- Tokens: total 10,080  ·  **real work 1,980** (in 480 / out 1,500)  ·  cache 8k read / 100 write  ·  **cache hit rate 93.2%**  ·  see batch-tokenomics for the full breakdown
- Activity: 5 turns  ·  11 tool calls (1 err, 91% ok)
- Overhead (lead + triage + gate + report, shown once): $3.00 (60%)
- **Per delivered case (incl. overhead): $5.00**
- Avg direct per case (excl. overhead): $1.00
- Direct cost spread: avg $1.00 · median $1.00 · min $0.50 · max $1.50
- Loaded cost spread (direct + even overhead share): avg $2.50 · median $2.50 · min $2.00 · max $3.00
- Active-time spread: session grain, none per case  ·  loaded: avg 10m · median 10m · min 10m · max 10m (batch time ÷ cases, an allocation)

## Per case (direct = measured; loaded = direct + even overhead share, an allocation; loaded minutes = batch time ÷ cases)

| case | size | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SIZED-1 | M | blocked | $1.50 | $3.00 | 500 (in 100 / out 400) | — | 10m | 1 | 3 (0) | 0 | 0 |
| SIZED-2 | S | delivered | $0.50 | $2.00 | 280 (in 80 / out 200) | — | 10m | 1 | 2 (0) | 0 | 0 |

_Cases analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-case measurement (fractional `dispatches` marks them)._

## By size — predicted (automation-scoping) vs actual

| size | cases | ΣSP | est min | actual min | actual rw tok |
|---|---|---|---|---|---|
| M | 1 | 3 | 20 | 10 | 500 |
| S | 1 | — | — | 10 | 280 |

**Estimate vs actual (batch grain): 20m predicted / 20m actual (allocated: batch time ÷ cases) — ×1.** Batch grain only: per-case dollars rank-correlate ~zero with predictions (scoping doctrine) — deviations below are tokens/time analysis pointers.

## By role

| role | cost | dispatches | real-work tok | cache hit | active | tools (err) |
|---|---|---|---|---|---|---|
| session | $5.00 | 0 | 1,200 (in 300 / out 900) | 92.6% | 20m | 6 (1) |
| implementer | — | 2 | 780 (in 180 / out 600) | 94.3% | — | 5 (0) |

_role cost = the parent session's role, inclusive of its dispatches; — (n unpriced) = n parent session(s) without dollars; — = not allocated at this grain: a dispatch-only role has no parent-session dollars (its dispatch dollars are the separate breakdown, never added to a role or the total)_

## Dispatch dollars by role

_measured per-dispatch dollars by dispatch role — already inside the parent role and the total, so never added to them_

| role | cost | dispatches | priced |
|---|---|---|---|
| implementer | $2.00 | 2 | 2 of 2 |

manifest revision 1
