# Batch cost — g1

Generated: 2026-10-01T10:30:00.000Z  ·  sessions: 1 (claude)  ·  sources: tokens only  ·  models: claude-haiku-5-5

## What happened

- Cases: 1  ·  **delivered: 1**  ·  delivered 1
- Gate: green
- Findings reported: 0  ·  fix rounds: 0

## What it cost

- Total: n/a  ·  0.1h active (cases 2m · lead 5m · stages 0m)  ·  2 dispatches
- Tokens: total 935  ·  **real work 135** (in 25 / out 110)  ·  cache 700 read / 100 write  ·  **cache hit rate 84.8%**  ·  see batch-tokenomics for the full breakdown
- Activity: 1 turns  ·  0 tool calls (0 err)
- Overhead (lead + triage + gate + report, shown once): n/a
- Active-time spread: avg 2m · median 2m · min 2m · max 2m  ·  loaded: avg 7m · median 7m · min 7m · max 7m
- Direct token spread (no per-dispatch dollars on this host): avg 565 · median 565 · min 565 · max 565

## Per case (direct = measured; loaded = direct + even overhead share, an allocation)

| case | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-1 | delivered | n/a | n/a | 105 (in 15 / out 90) | 2m | 7m | 2 | 0 (0) | 0 | 0 |

_Cases analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-case measurement (fractional `dispatches` marks them)._

## By role

| role | cost | dispatches | real-work tok | cache hit | active | tools (err) |
|---|---|---|---|---|---|---|
| implementer | — | 1 | 70 (in 10 / out 60) | 85.7% | 1m | 0 (0) |
| reviewer | — | 1 | 35 (in 5 / out 30) | 80.0% | 1m | 0 (0) |
| session | — (1 unpriced) | 0 | 30 (in 10 / out 20) | 85.7% | 5m | 0 (0) |

_role cost = the parent session's role, inclusive of its dispatches; — (n unpriced) = n parent session(s) without dollars; — = not allocated at this grain: a dispatch-only role has no parent-session dollars (its dispatch dollars are the separate breakdown, never added to a role or the total)_

## Dispatch dollars by role

_measured per-dispatch dollars by dispatch role — already inside the parent role and the total, so never added to them_

| role | cost | dispatches | priced |
|---|---|---|---|
| implementer | — (1 unpriced) | 1 | 0 of 1 |
| reviewer | — (1 unpriced) | 1 | 0 of 1 |
