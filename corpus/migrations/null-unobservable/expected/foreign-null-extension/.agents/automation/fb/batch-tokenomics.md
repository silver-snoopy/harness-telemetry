# Batch tokenomics — fb

Generated: 2026-10-01T10:33:00.000Z  ·  sessions: 1  ·  models: —  ·  companion of batch-report (delivery view)

## Composition — where the tokens went

| kind | tokens | share | what it is |
|---|---|---|---|
| real work: input | 12 | 0.5% | fresh prompt tokens, full price |
| real work: output | 300 | 12.4% | generated tokens — the most expensive kind |
| cache write | 100 | 4.1% | context stored for reuse (~1.25× input price) |
| cache read | 2,000 | 82.9% | context replayed from cache (~0.1× input price) |
| **total** | **2,412** | 100% | raw sum — dominated by the cheapest kind |

**Cache hit rate: 94.7%** — share of all prompt tokens replayed from cache versus processed fresh (input + cache write are the fresh processing).
**Cache savings: ~84.0% of prompt cost** — what the same prompt volume would have cost uncached (all tokens at 1× input price) versus as billed (write 1.25×, read 0.1×).
**Cache-read cost share: ~10.9% of spend** (public-list ratios: in 1× / out 5× / write 1.25× / read 0.1×) — the dollar-weighted view the cross-factory dataset reports.

## By model

| model | input | output | cache write | cache read | total |
|---|---|---|---|---|---|
| claude-sonnet-5 | 12 | 300 | 100 | 2k | 2,412 |
**Total: 2,412 tokens (1 unmeasured) · n/a · 0.0h active · 1 dispatches** — judge by composition and hit rate, not by the big number.

## By role

| role | cost | real work | cache write | cache read | hit rate |
|---|---|---|---|---|---|
| implementer | n/a | 312 | 100 | 2k | 94.7% |
| session | n/a | — (1 unmeasured) | — | — | — |

## Orchestrator (lead thread) composition

Lead: n/a · real work — (1 unmeasured)

## Per case (direct; clustered cases are an even split)

| case | cost | input | output | cache write | cache read | total | hit rate | share |
|---|---|---|---|---|---|---|---|---|
| FX-1 | n/a | 12 | 300 | 100 | 2k | 2,412 | 94.7% | 100.0% |
