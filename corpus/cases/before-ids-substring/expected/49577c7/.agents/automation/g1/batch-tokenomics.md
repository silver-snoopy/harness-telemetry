# Batch tokenomics — g1

Generated: 2026-10-01T10:30:00.000Z  ·  sessions: 1  ·  models: claude-haiku-5-5  ·  companion of batch-report (delivery view)

## Composition — where the tokens went

| kind | tokens | share | what it is |
|---|---|---|---|
| real work: input | 25 | 2.7% | fresh prompt tokens, full price |
| real work: output | 110 | 11.8% | generated tokens — the most expensive kind |
| cache write | 100 | 10.7% | context stored for reuse (~1.25× input price) |
| cache read | 700 | 74.9% | context replayed from cache (~0.1× input price) |
| **total** | **935** | 100% | raw sum — dominated by the cheapest kind |

**Cache hit rate: 84.8%** — share of all prompt tokens replayed from cache versus processed fresh (input + cache write are the fresh processing).
**Cache savings: ~73.3% of prompt cost** — what the same prompt volume would have cost uncached (all tokens at 1× input price) versus as billed (write 1.25×, read 0.1×).
**Cache-read cost share: ~9.1% of spend** (public-list ratios: in 1× / out 5× / write 1.25× / read 0.1×) — the dollar-weighted view the cross-factory dataset reports.

## By model

| model | input | output | cache write | cache read | total |
|---|---|---|---|---|---|
| claude-haiku-5-5 | 25 | 110 | 100 | 700 | 935 |
**Total: 935 tokens · n/a · 0.1h active · 2 dispatches** — judge by composition and hit rate, not by the big number.

## By role

| role | cost | real work | cache write | cache read | hit rate |
|---|---|---|---|---|---|
| implementer | n/a | 70 | 40 | 300 | 85.7% |
| reviewer | n/a | 35 | 20 | 100 | 80.0% |
| session | n/a | 30 | 40 | 300 | 85.7% |

## Orchestrator (lead thread) composition

Lead: n/a · real work 30 · cache 300 read / 40 write · hit rate 85.7%
A high lead share with a high hit rate is orchestration overhead working as designed (context replayed per turn), not runaway spend.

## Per case (direct; clustered cases are an even split)

| case | cost | input | output | cache write | cache read | total | hit rate | share |
|---|---|---|---|---|---|---|---|---|
| TC-1 | n/a | 15 | 90 | 60 | 400 | 565 | 84.2% | 60.4% |
