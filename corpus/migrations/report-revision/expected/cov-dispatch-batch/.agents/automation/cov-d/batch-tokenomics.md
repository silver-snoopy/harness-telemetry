# Batch tokenomics — cov-d

Generated: 2026-10-01T10:50:00.000Z  ·  sessions: 1  ·  models: claude-opus-5, claude-sonnet-5  ·  companion of batch-report (delivery view)

## Composition — where the tokens went

| kind | tokens | share | what it is |
|---|---|---|---|
| real work: input | 174 | 0.2% | fresh prompt tokens, full price |
| real work: output | 4,350 | 5.8% | generated tokens — the most expensive kind |
| cache write | 4,120 | 5.5% | context stored for reuse (~1.25× input price) |
| cache read | 66,600 | 88.5% | context replayed from cache (~0.1× input price) |
| **total** | **75,244** | 100% | raw sum — dominated by the cheapest kind |

**Cache hit rate: 93.9%** — share of all prompt tokens replayed from cache versus processed fresh (input + cache write are the fresh processing).
**Cache savings: ~83.1% of prompt cost** — what the same prompt volume would have cost uncached (all tokens at 1× input price) versus as billed (write 1.25×, read 0.1×).
**Cache-read cost share: ~19.7% of spend** (public-list ratios: in 1× / out 5× / write 1.25× / read 0.1×) — the dollar-weighted view the cross-factory dataset reports.

## By model

| model | input | output | cache write | cache read | total |
|---|---|---|---|---|---|
| claude-sonnet-5 | 59 | 2,670 | 1k | 31k | 34,539 |
| claude-opus-5 | 65 | 1,600 | 3k | 36k | 40,465 |
**Total: 75,244 tokens · $0.35 · 0.9h active · 9 dispatches** — judge by composition and hit rate, not by the big number.

## By role

| role | cost | real work | cache write | cache read | hit rate |
|---|---|---|---|---|---|
| implementer | $0.28 | 1,805 | 790 | 16k | 94.9% |
| session | $0.05 | 1,975 | 3k | 41k | 93.2% |
| analyst | $0.01 | 310 | 200 | 4k | 95.0% |
| empty | $0.00 | 0 | 0 | 0 | n/a |
| reviewer | $0.00 | 206 | 100 | 3k | 96.6% |
| triage | $0.00 | 104 | 60 | 1k | 94.0% |
| workflow-subagent | $0.00 | 0 | 0 | 0 | n/a |
| writer | $0.00 | 124 | 70 | 2k | 95.3% |

## Orchestrator (lead thread) composition

Lead: $0.05 — overhead incl. stages is 16% of the batch · real work 1,975 · cache 41k read / 3k write · hit rate 93.2%
A high lead share with a high hit rate is orchestration overhead working as designed (context replayed per turn), not runaway spend.

## By stage (overhead)

| stage | cost | real work | cache write | cache read | hit rate |
|---|---|---|---|---|---|
| triage | $0.00 | 104 | 60 | 1k | 94.0% |
| gate | $0.00 | 0 | 0 | 0 | n/a |
| report | $0.00 | 124 | 70 | 2k | 95.3% |
| other | $0.00 | 0 | 0 | 0 | n/a |

## Per case (direct; clustered cases are an even split)

| case | cost | input | output | cache write | cache read | total | hit rate | share |
|---|---|---|---|---|---|---|---|---|
| PROJ-1 | $0.01 | 10 | 300 | 200 | 4k | 4,510 | 95.0% | 6.0% |
| PROJ-2 | $0.02 | 16 | 950 | 450 | 10k | 11,416 | 95.5% | 15.2% |
| PROJ-3 | $0.27 | 65 | 980 | 440 | 9k | 10,585 | 94.7% | 14.1% |

manifest revision 1
