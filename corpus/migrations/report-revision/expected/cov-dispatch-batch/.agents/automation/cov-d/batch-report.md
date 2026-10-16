# Batch cost — cov-d

Generated: 2026-10-01T10:50:00.000Z  ·  sessions: 1 (claude)  ·  sources: ccusage-metered  ·  models: claude-opus-5, claude-sonnet-5

## What happened

- Cases: 3  ·  **delivered: 2**  ·  delivered 2  ·  blocked 1
- Gate: green
- ⚠️ **OUTCOME DRIFT** (1): PROJ-2 receipt=delivered declared=blocked — reconcile report.json
- Findings reported: 1  ·  fix rounds: 1

## What it cost

- Total: $0.35  ·  0.9h active (cases 16m · lead 30m · stages 6m)  ·  9 dispatches
- ⚠️ **TOKEN TOTALS ARE A FLOOR** — attribution partial: 2 unit(s) reported no usage (gateway pass-through gap); the real bill is higher.
- Tokens: total 75,244  ·  **real work 4,524** (in 174 / out 4,350)  ·  cache 67k read / 4k write  ·  **cache hit rate 93.9%**  ·  see batch-tokenomics for the full breakdown
- Activity: 4 turns  ·  14 tool calls (1 err, 93% ok)  ·  skills: brainstorming
- Overhead (lead + triage + gate + report, shown once): $0.06 (16%)
  - by stage: lead $0.05 · triage $0.00 (1m) · gate $0.00 (3m) · report $0.00 (2m) · other $0.00 (0m)
- Rework (fix rounds — already inside per-case direct): $0.00  ·  1 dispatch(es)  ·  2m
- **Per delivered case (incl. overhead): $0.17**
- Avg direct per case (excl. overhead): $0.10
- Direct cost spread: avg $0.10 · median $0.02 · min $0.01 · max $0.27
- Loaded cost spread (direct + even overhead share): avg $0.12 · median $0.04 · min $0.03 · max $0.29
- Active-time spread: avg 5m · median 6m · min 2m · max 8m  ·  loaded: avg 17m · median 18m · min 14m · max 20m

## Per case (direct = measured; loaded = direct + even overhead share, an allocation)

| case | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |
|---|---|---|---|---|---|---|---|---|---|---|
| PROJ-1 | delivered | $0.01 | $0.03 | 310 (in 10 / out 300) | 2m | 14m | 1 | 1 (0) | 0 | 1 |
| PROJ-2 | delivered | $0.02 | $0.04 | 966 (in 16 / out 950) | 6m | 18m | 1.5 | 2 (0) | 0 | 0 |
| PROJ-3 | blocked | $0.27 | $0.29 | 1,045 (in 65 / out 980) | 8m | 20m | 2.5 | 5 (0) | 1 | 0 |

_Cases analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-case measurement (fractional `dispatches` marks them)._

## By role

| role | cost | dispatches | real-work tok | cache hit | active | tools (err) |
|---|---|---|---|---|---|---|
| implementer | $0.28 | 3 | 1,805 (in 75 / out 2k) | 94.9% | 12m | 6 (0) |
| session | $0.05 | 0 | 1,975 (in 75 / out 2k) | 93.2% | 30m | 3 (1) |
| analyst | $0.01 | 1 | 310 (in 10 / out 300) | 95.0% | 2m | 1 (0) |
| empty | $0.00 | 1 | 0 (incl. cache) | n/a | 0m | 0 (0) |
| reviewer | $0.00 | 1 | 206 (in 6 / out 200) | 96.6% | 2m | 1 (0) |
| triage | $0.00 | 1 | 104 (in 4 / out 100) | 94.0% | 1m | 1 (0) |
| workflow-subagent | $0.00 | 1 | 0 (incl. cache) | n/a | 3m | 1 (0) |
| writer | $0.00 | 1 | 124 (in 4 / out 120) | 95.3% | 2m | 1 (0) |

manifest revision 1
