# Batch tokenomics — solo

Generated: 2026-10-05T09:02:30.000Z  ·  sessions: 2  ·  models: claude-opus-5  ·  companion of batch-report (delivery view)

## Composition — where the tokens went

| kind | tokens | share | what it is |
|---|---|---|---|
| real work: input | 363 | 0.4% | fresh prompt tokens, full price |
| real work: output | 11,925 | 13.0% | generated tokens — the most expensive kind |
| cache write | 4,295 | 4.7% | context stored for reuse (~1.25× input price) |
| cache read | 75,350 | 82.0% | context replayed from cache (~0.1× input price) |
| **total** | **91,933** | 100% | raw sum — dominated by the cheapest kind |

**Cache hit rate: 94.2%** — share of all prompt tokens replayed from cache versus processed fresh (input + cache write are the fresh processing).
**Cache savings: ~83.4% of prompt cost** — what the same prompt volume would have cost uncached (all tokens at 1× input price) versus as billed (write 1.25×, read 0.1×).
**Cache-read cost share: ~10.3% of spend** (public-list ratios: in 1× / out 5× / write 1.25× / read 0.1×) — the dollar-weighted view the cross-factory dataset reports.

## By model

| model | input | output | cache write | cache read | total |
|---|---|---|---|---|---|
| claude-opus-5 | 100 | 2,000 | 3k | 50k | 55,100 |
**Total: 91,933 tokens · $2.80 · 1.1h active · 6.5 dispatches** — judge by composition and hit rate, not by the big number.

## By role

| role | cost | real work | cache write | cache read | hit rate |
|---|---|---|---|---|---|
| implementer | $0.95 | 620 | 140 | 3k | 91.5% |
| lead | $0.85 | 1,050 | 2k | 25k | 94.2% |
| analyst | $0.50 | 9,100 | 1k | 20k | 94.8% |
| reviewer | $0.30 | 330 | 100 | 2k | 93.9% |
| helper | $0.10 | 28 | 5 | 50 | 86.2% |
| triage | $0.10 | 110 | 50 | 500 | 89.3% |
| session | $0.00 | 1,050 | 2k | 25k | 94.2% |

## Orchestrator (lead thread) composition

Lead: $0.85 — overhead incl. stages is 38% of the batch · real work 2,100 · cache 50k read / 3k write · hit rate 94.2%
A high lead share with a high hit rate is orchestration overhead working as designed (context replayed per turn), not runaway spend.

## By stage (overhead)

| stage | cost | real work | cache write | cache read | hit rate |
|---|---|---|---|---|---|
| triage | $0.10 | 110 | 50 | 500 | 89.3% |
| other | $0.10 | 28 | 5 | 50 | 86.2% |

## Size-class deviations (analysis pointers)

- ⚠ **S-1** (M, above-p90): real-work 9,320 tok (p100) / 10m (p67) vs M-class median 1,900 tok / 10m — review: estimate drift, execution smell, or a mis-sized case
- ⚠ **S-2** (M, below-p10): real-work 400 tok ≤ p10 of M-class — suspiciously cheap: verify coverage was not shortcut

## Per case (direct; clustered cases are an even split)

| case | cost | input | output | cache write | cache read | total | hit rate | share |
|---|---|---|---|---|---|---|---|---|
| S-1 | $0.65 | 120 | 9,200 | 1k | 21k | 31,160 | 94.7% | 33.9% |
| S-2 | $0.80 | 100 | 300 | 100 | 2k | 2,500 | 90.9% | 2.7% |
| S-3 | $0.30 | 30 | 300 | 100 | 2k | 2,430 | 93.9% | 2.6% |

manifest revision 1
