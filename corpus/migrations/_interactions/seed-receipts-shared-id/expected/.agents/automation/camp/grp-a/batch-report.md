# Batch cost — camp/grp-a

Generated: 2026-10-01T10:30:00.000Z  ·  sessions: 1 (claude)  ·  sources: tokens only  ·  models: claude-haiku-5-5

_1 session(s) also served other batches — their session-level figures are split evenly._

## What happened

- Cases: 1  ·  **delivered: 1**  ·  delivered 1
- Gate: green
- Findings reported: 0  ·  fix rounds: 0

## What it cost

- Total: n/a  ·  0.1h active (session grain — not split per case, stage or dispatch)  ·  0.5 dispatches
- Tokens: total 390  ·  **real work 50** (in 10 / out 40)  ·  cache 300 read / 40 write  ·  **cache hit rate 85.7%**  ·  see batch-tokenomics for the full breakdown
- Activity: 1 turns  ·  0 tool calls (0 err)
- Overhead (lead + triage + gate + report, shown once): n/a
- Active-time spread: session grain, none per case  ·  loaded: avg 4m · median 4m · min 4m · max 4m (batch time ÷ cases, an allocation)
- Direct token spread (no per-dispatch dollars on this host): avg 205 · median 205 · min 205 · max 205

## Per case (direct = measured; loaded = direct + even overhead share, an allocation; loaded minutes = batch time ÷ cases)

| case | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-1 | delivered | n/a | n/a | 35 (in 5 / out 30) | — | 4m | 0.5 | 0 (0) | 0 | 0 |

_Cases analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-case measurement (fractional `dispatches` marks them)._

## By role

| role | cost | dispatches | real-work tok | cache hit | active | tools (err) |
|---|---|---|---|---|---|---|
| implementer | — | 0.5 | 35 (in 5 / out 30) | 85.7% | — | 0 (0) |
| session | — (1 unpriced) | 0 | 15 (in 5 / out 10) | 85.7% | 4m | 0 (0) |

_role cost = the parent session's role, inclusive of its dispatches; — (n unpriced) = n parent session(s) without dollars; — = not allocated at this grain: a dispatch-only role has no parent-session dollars (its dispatch dollars are the separate breakdown, never added to a role or the total)_

## Dispatch dollars by role

_measured per-dispatch dollars by dispatch role — already inside the parent role and the total, so never added to them_

| role | cost | dispatches | priced |
|---|---|---|---|
| implementer | — (0.5 unpriced) | 0.5 | 0 of 0.5 |

manifest revision 1
