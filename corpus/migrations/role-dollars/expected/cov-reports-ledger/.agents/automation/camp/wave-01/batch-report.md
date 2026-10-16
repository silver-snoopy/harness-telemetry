# Batch cost — camp/wave-01

Generated: 2026-10-05T09:02:00.000Z  ·  sessions: 1 (claude)  ·  sources: ccusage-metered  ·  models: claude-opus-5

_1 session(s) also served other batches — their session-level figures are split evenly; 2 other-batch dispatch(es) excluded._

## What happened

- Cases: 2  ·  **delivered: 1**  ·  delivered 1  ·  blocked 1
- Gate: green
- Findings reported: 0  ·  fix rounds: 0

## What it cost

- Total: $1.85  ·  0.5h active (cases 6m · lead 23m · stages 0m)  ·  1 dispatches
- Tokens: total 38,250  ·  **real work 2,350** (in 150 / out 2,200)  ·  cache 34k read / 2k write  ·  **cache hit rate 94.3%**  ·  see batch-tokenomics for the full breakdown
- Activity: 5 turns  ·  10 tool calls (1 err, 90% ok)  ·  skills: tdd
- Overhead (lead + triage + gate + report, shown once): $0.85 (46%)
- **Per delivered case (incl. overhead): $1.85**
- Avg direct per case (excl. overhead): $0.50
- Direct cost spread: avg $0.50 · median $0.50 · min $0.50 · max $0.50
- Loaded cost spread (direct + even overhead share): avg $0.93 · median $0.93 · min $0.93 · max $0.93
- Active-time spread: avg 3m · median 3m · min 3m · max 3m  ·  loaded: avg 14m · median 14m · min 14m · max 14m

## Per case (direct = measured; loaded = direct + even overhead share, an allocation)

| case | size | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| W1-1 | L | delivered | $0.50 | $0.93 | 650 (in 50 / out 600) | 3m | 14m | 0.5 | 2 (0) | 0 | 0 |
| W1-2 | — | blocked | $0.50 | $0.93 | 650 (in 50 / out 600) | 3m | 14m | 0.5 | 2 (0) | 0 | 0 |

_Cases analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-case measurement (fractional `dispatches` marks them)._

## By size — predicted (automation-scoping) vs actual

| size | cases | ΣSP | est min | actual min | actual rw tok |
|---|---|---|---|---|---|
| L | 1 | 8 | — | 3 | 650 |

## By role

| role | cost | dispatches | real-work tok | cache hit | active | tools (err) |
|---|---|---|---|---|---|---|
| lead | $1.85 | 0 | 1,050 (in 50 / out 1k) | 94.2% | 23m | 6 (1) |
| implementer | — | 1 | 1,300 (in 100 / out 1k) | 94.7% | 5m | 4 (0) |

_role cost = the parent session's role, inclusive of its dispatches; — (n unpriced) = n parent session(s) without dollars; — = not allocated at this grain: a dispatch-only role has no parent-session dollars (its dispatch dollars are the separate breakdown, never added to a role or the total)_

## Dispatch dollars by role

_measured per-dispatch dollars by dispatch role — already inside the parent role and the total, so never added to them_

| role | cost | dispatches | priced |
|---|---|---|---|
| implementer | $1.00 | 1 | 1 of 1 |
