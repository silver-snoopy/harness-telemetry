# Batch tokenomics — sz

Generated: 2026-10-01T10:20:00.000Z  ·  sessions: 1  ·  models: claude-sonnet-5  ·  companion of batch-report (delivery view)

## Composition — where the tokens went

| kind | tokens | share | what it is |
|---|---|---|---|
| real work: input | 10 | 1.8% | fresh prompt tokens, full price |
| real work: output | 200 | 36.4% | generated tokens — the most expensive kind |
| cache write | 40 | 7.3% | context stored for reuse (~1.25× input price) |
| cache read | 300 | 54.5% | context replayed from cache (~0.1× input price) |
| **total** | **550** | 100% | raw sum — dominated by the cheapest kind |

**Cache hit rate: 85.7%** — share of all prompt tokens replayed from cache versus processed fresh (input + cache write are the fresh processing).
**Cache savings: ~74.3% of prompt cost** — what the same prompt volume would have cost uncached (all tokens at 1× input price) versus as billed (write 1.25×, read 0.1×).
**Cache-read cost share: ~2.8% of spend** (public-list ratios: in 1× / out 5× / write 1.25× / read 0.1×) — the dollar-weighted view the cross-factory dataset reports.

## By model

| model | input | output | cache write | cache read | total |
|---|---|---|---|---|---|
| claude-sonnet-5 | 10 | 200 | 40 | 300 | 550 |
**Total: 550 tokens · n/a · 0.1h active · 0 dispatches** — judge by composition and hit rate, not by the big number.

## By role

| role | cost | real work | cache write | cache read | hit rate |
|---|---|---|---|---|---|
| session | n/a | 210 | 40 | 300 | 85.7% |

## Orchestrator (lead thread) composition

Lead: n/a · real work 210 · cache 300 read / 40 write · hit rate 85.7%
A high lead share with a high hit rate is orchestration overhead working as designed (context replayed per turn), not runaway spend.


manifest revision 1
