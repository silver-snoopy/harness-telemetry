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

- Total: $2.80  ·  1.1h active (cases 25m · lead 35m · stages 8m)  ·  6.5 dispatches
- ⚠️ **TOKEN TOTALS ARE A FLOOR** — attribution partial: 1 unit(s) reported no usage (gateway pass-through gap); the real bill is higher.
- Tokens: total 91,933  ·  **real work 12,288** (in 363 / out 11,925)  ·  cache 75k read / 4k write  ·  **cache hit rate 94.2%**  ·  see batch-tokenomics for the full breakdown
- Activity: 10 turns  ·  38 tool calls (1 err, 97% ok)  ·  skills: tdd
- Overhead (lead + triage + gate + report, shown once): $1.05 (38%)
  - by stage: lead $0.85 · triage $0.10 (5m) · other $0.10 (3m)
- Rework (fix rounds — already inside per-case direct): $0.15  ·  1 dispatch(es)  ·  5m
- **Per delivered case (incl. overhead): $0.93**
- Avg direct per case (excl. overhead): $0.58
- Direct cost spread: avg $0.58 · median $0.65 · min $0.30 · max $0.80
- Loaded cost spread (direct + even overhead share): avg $0.70 · median $0.74 · min $0.26 · max $1.06
- Active-time spread: avg 8m · median 10m · min 5m · max 10m  ·  loaded: avg 17m · median 19m · min 11m · max 21m

## Per case (direct = measured; loaded = direct + even overhead share, an allocation)

| case | size | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S-1 | M ⚠ | delivered | $0.65 | $0.91 | 9,320 (in 120 / out 9k) | 10m | 21m | 2 | 8 (0) | 1 | 2 |
| S-2 | M ⚠ | defect-found | $0.80 | $1.06 | 400 (in 100 / out 300) | 5m | 16m | 1 | 4 (0) | 0 | 0 |
| S-3 | S | delivered | $0.30 | $0.56 | 330 (in 30 / out 300) (1 unmeasured) | 10m | 21m | 2 | 8 (0) | 0 | 0 |
| S-4 | — | — | n/a | $0.26 | 0 (incl. cache) | 0m | 11m | 0 | 0 (0) | 0 | 0 |

_Cases analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-case measurement (fractional `dispatches` marks them)._

## By size — predicted (automation-scoping) vs actual

| size | cases | ΣSP | est min | actual min | actual rw tok |
|---|---|---|---|---|---|
| M | 2 | 5 | 30 | 15 | 9,720 |
| S | 1 | 1 | — | 10 | 330 |

**Estimate vs actual (batch grain): 30m predicted / 25m actual — ×0.83.** Batch grain only: per-case dollars rank-correlate ~zero with predictions (scoping doctrine) — deviations below are tokens/time analysis pointers.
- ⚠ **S-1** (M, above-p90): real-work 9,320 tok (p100) / 10m (p67) vs M-class median 1,900 tok / 10m — review: estimate drift, execution smell, or a mis-sized case
- ⚠ **S-2** (M, below-p10): real-work 400 tok ≤ p10 of M-class — suspiciously cheap: verify coverage was not shortcut

## By role

| role | cost | dispatches | real-work tok | cache hit | active | tools (err) |
|---|---|---|---|---|---|---|
| implementer | $0.95 | 2 | 620 (in 120 / out 500) | 91.5% | 10m | 8 (0) |
| lead | $0.85 | 0 | 1,050 (in 50 / out 1k) | 94.2% | 23m | 6 (1) |
| analyst | $0.50 | 1 | 9,100 (in 100 / out 9k) | 94.8% | 5m | 4 (0) |
| reviewer | $0.30 | 2 | 330 (in 30 / out 300) (1 unmeasured) | 93.9% | 10m | 8 (0) |
| helper | $0.10 | 0.5 | 28 (in 3 / out 25) | 86.2% | 3m | 2 (0) |
| triage | $0.10 | 1 | 110 (in 10 / out 100) | 89.3% | 5m | 4 (0) |
| session | $0.00 | 0 | 1,050 (in 50 / out 1k) | 94.2% | 13m | 6 (1) |

Unattributed (no dispatch named them in any captured session): S-4
