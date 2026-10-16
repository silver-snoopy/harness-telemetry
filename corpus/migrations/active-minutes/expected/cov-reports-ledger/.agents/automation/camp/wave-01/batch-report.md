# Batch cost — camp/wave-01

Generated: 2026-10-05T09:02:00.000Z  ·  sessions: 1 (claude)  ·  sources: ccusage-metered  ·  models: claude-opus-5

_1 session(s) also served other batches — their session-level figures are split evenly; 2 other-batch dispatch(es) excluded._

## What happened

- Cases: 2  ·  **delivered: 1**  ·  delivered 1  ·  blocked 1
- Gate: green
- Findings reported: 0  ·  fix rounds: 0

## What it cost

- Total: $1.85  ·  0.5h active (session grain — not split per case, stage or dispatch)  ·  1 dispatches
- Tokens: total 38,250  ·  **real work 2,350** (in 150 / out 2,200)  ·  cache 34k read / 2k write  ·  **cache hit rate 94.3%**  ·  see batch-tokenomics for the full breakdown
- Activity: 5 turns  ·  10 tool calls (1 err, 90% ok)  ·  skills: tdd
- Overhead (lead + triage + gate + report, shown once): $0.85 (46%)
- **Per delivered case (incl. overhead): $1.85**
- Avg direct per case (excl. overhead): $0.50
- Direct cost spread: avg $0.50 · median $0.50 · min $0.50 · max $0.50
- Loaded cost spread (direct + even overhead share): avg $0.93 · median $0.93 · min $0.93 · max $0.93
- Active-time spread: session grain, none per case  ·  loaded: avg 15m · median 15m · min 15m · max 15m (batch time ÷ cases, an allocation)

## Per case (direct = measured; loaded = direct + even overhead share, an allocation; loaded minutes = batch time ÷ cases)

| case | size | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| W1-1 | L | delivered | $0.50 | $0.93 | 650 (in 50 / out 600) | — | 15m | 0.5 | 2 (0) | 0 | 0 |
| W1-2 | — | blocked | $0.50 | $0.93 | 650 (in 50 / out 600) | — | 15m | 0.5 | 2 (0) | 0 | 0 |

_Cases analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-case measurement (fractional `dispatches` marks them)._

## By size — predicted (automation-scoping) vs actual

| size | cases | ΣSP | est min | actual min | actual rw tok |
|---|---|---|---|---|---|
| L | 1 | 8 | — | 15 | 650 |

## By role

| role | cost | dispatches | real-work tok | cache hit | active | tools (err) |
|---|---|---|---|---|---|---|
| implementer | $1.00 | 1 | 1,300 (in 100 / out 1k) | 94.7% | — | 4 (0) |
| lead | $0.85 | 0 | 1,050 (in 50 / out 1k) | 94.2% | 30m | 6 (1) |
