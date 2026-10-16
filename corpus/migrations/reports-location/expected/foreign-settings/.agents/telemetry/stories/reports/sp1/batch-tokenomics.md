# Sprint tokenomics — sp1

Generated: 2026-10-01T10:33:00.000Z  ·  sessions: 1  ·  models: claude-opus-5  ·  companion of batch-report (delivery view)

## Composition — where the tokens went

| kind | tokens | share | what it is |
|---|---|---|---|
| real work: input | 155 | 0.4% | fresh prompt tokens, full price |
| real work: output | 1,950 | 5.2% | generated tokens — the most expensive kind |
| cache write | 1,925 | 5.2% | context stored for reuse (~1.25× input price) |
| cache read | 33,250 | 89.2% | context replayed from cache (~0.1× input price) |
| **total** | **37,280** | 100% | raw sum — dominated by the cheapest kind |

**Cache hit rate: 94.1%** — share of all prompt tokens replayed from cache versus processed fresh (input + cache write are the fresh processing).
**Cache savings: ~83.3% of prompt cost** — what the same prompt volume would have cost uncached (all tokens at 1× input price) versus as billed (write 1.25×, read 0.1×).
**Cache-read cost share: ~21.3% of spend** (public-list ratios: in 1× / out 5× / write 1.25× / read 0.1×) — the dollar-weighted view the cross-factory dataset reports.

## By model

| model | input | output | cache write | cache read | total |
|---|---|---|---|---|---|
| claude-opus-5 | 50 | 1,000 | 2k | 25k | 27,550 |
**Total: 37,280 tokens · $1.05 · 0.5h active · 1.5 dispatches** — judge by composition and hit rate, not by the big number.

## By role

| role | cost | real work | cache write | cache read | hit rate |
|---|---|---|---|---|---|
| implementer | $0.50 | 1,000 | 400 | 8k | 94.1% |
| session | $0.50 | 1,050 | 2k | 25k | 94.2% |
| helper | $0.05 | 55 | 25 | 250 | 89.3% |

## Orchestrator (lead thread) composition

Lead: $0.50 — overhead incl. stages is 52% of the sprint · real work 1,050 · cache 25k read / 2k write · hit rate 94.2%
A high lead share with a high hit rate is orchestration overhead working as designed (context replayed per turn), not runaway spend.

## Per story (direct; clustered stories are an even split)

| story | cost | input | output | cache write | cache read | total | hit rate | share |
|---|---|---|---|---|---|---|---|---|
| issue-101 | $0.50 | 100 | 900 | 400 | 8k | 9,400 | 94.1% | 25.2% |
