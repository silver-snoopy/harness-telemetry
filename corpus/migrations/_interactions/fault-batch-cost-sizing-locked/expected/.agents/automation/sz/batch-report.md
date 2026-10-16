# Batch cost — sz

Generated: 2026-10-01T10:20:00.000Z  ·  sessions: 1 (claude)  ·  sources: tokens only  ·  models: claude-sonnet-5

## What happened

- Cases: 1  ·  **delivered: 1**  ·  delivered 1
- Findings reported: 0  ·  fix rounds: 0

## What it cost

- Total: n/a  ·  0.1h active (session grain — not split per case, stage or dispatch)  ·  0 dispatches
- Tokens: total 550  ·  **real work 210** (in 10 / out 200)  ·  cache 300 read / 40 write  ·  **cache hit rate 85.7%**  ·  see batch-tokenomics for the full breakdown
- Activity: 1 turns  ·  0 tool calls (0 err)
- Overhead (lead + triage + gate + report, shown once): n/a
- Active-time spread: session grain, none per case  ·  loaded: avg 5m · median 5m · min 5m · max 5m (batch time ÷ cases, an allocation)

## Per case (direct = measured; loaded = direct + even overhead share, an allocation; loaded minutes = batch time ÷ cases)

| case | size | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SZ-1 | M | delivered | n/a | n/a | 0 (incl. cache) | — | 5m | 0 | 0 (0) | 0 | 0 |

_Cases analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-case measurement (fractional `dispatches` marks them)._

## By size — predicted (automation-scoping) vs actual

| size | cases | ΣSP | est min | actual min | actual rw tok |
|---|---|---|---|---|---|
| M | 1 | 3 | — | 5 | 0 |

## By role

| role | cost | dispatches | real-work tok | cache hit | active | tools (err) |
|---|---|---|---|---|---|---|
| session | — (1 unpriced) | 0 | 210 (in 10 / out 200) | 85.7% | 5m | 0 (0) |

_role cost = the parent session's role, inclusive of its dispatches; — (n unpriced) = n parent session(s) without dollars; — = not allocated at this grain: a dispatch-only role has no parent-session dollars (its dispatch dollars are the separate breakdown, never added to a role or the total)_

Unattributed (no dispatch named them in any captured session): SZ-1

manifest revision 1
