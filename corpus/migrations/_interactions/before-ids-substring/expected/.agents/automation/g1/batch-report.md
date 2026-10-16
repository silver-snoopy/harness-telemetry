# Batch cost — g1

Generated: 2026-10-01T10:30:00.000Z  ·  sessions: 1 (claude)  ·  sources: tokens only  ·  models: claude-haiku-5-5

## What happened

- Cases: 1  ·  **delivered: 1**  ·  delivered 1
- Gate: green
- Findings reported: 0  ·  fix rounds: 0

## What it cost

- Total: n/a  ·  0.1h active (session grain — not split per case, stage or dispatch)  ·  2 dispatches
- Tokens: total 935  ·  **real work 135** (in 25 / out 110)  ·  cache 700 read / 100 write  ·  **cache hit rate 84.8%**  ·  see batch-tokenomics for the full breakdown
- Activity: 1 turns  ·  0 tool calls (0 err)
- Overhead (lead + triage + gate + report, shown once): n/a
  - by stage: lead n/a · other n/a (—)
- Active-time spread: session grain, none per case  ·  loaded: avg 7m · median 7m · min 7m · max 7m (batch time ÷ cases, an allocation)

## Per case (direct = measured; loaded = direct + even overhead share, an allocation; loaded minutes = batch time ÷ cases)

| case | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-1 | delivered | n/a | n/a | 0 (incl. cache) | — | 7m | 0 | 0 (0) | 0 | 0 |

_Cases analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-case measurement (fractional `dispatches` marks them)._

## By role

| role | cost | dispatches | real-work tok | cache hit | active | tools (err) |
|---|---|---|---|---|---|---|
| implementer | — | 1 | 70 (in 10 / out 60) | 85.7% | — | 0 (0) |
| reviewer | — | 1 | 35 (in 5 / out 30) | 80.0% | — | 0 (0) |
| session | — (1 unpriced) | 0 | 30 (in 10 / out 20) | 85.7% | 7m | 0 (0) |

_role cost = the parent session's role, inclusive of its dispatches; — (n unpriced) = n parent session(s) without dollars; — = not allocated at this grain: a dispatch-only role has no parent-session dollars (its dispatch dollars are the separate breakdown, never added to a role or the total)_

## Dispatch dollars by role

_measured per-dispatch dollars by dispatch role — already inside the parent role and the total, so never added to them_

| role | cost | dispatches | priced |
|---|---|---|---|
| implementer | — (1 unpriced) | 1 | 0 of 1 |
| reviewer | — (1 unpriced) | 1 | 0 of 1 |

Unattributed (no dispatch named them in any captured session): TC-1

manifest revision 1
