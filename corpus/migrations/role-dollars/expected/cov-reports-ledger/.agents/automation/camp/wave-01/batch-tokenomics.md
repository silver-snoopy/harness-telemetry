# Batch tokenomics — camp/wave-01

Generated: 2026-10-05T09:02:00.000Z  ·  sessions: 1  ·  models: claude-opus-5  ·  companion of batch-report (delivery view)

## Composition — where the tokens went

| kind | tokens | share | what it is |
|---|---|---|---|
| real work: input | 150 | 0.4% | fresh prompt tokens, full price |
| real work: output | 2,200 | 5.8% | generated tokens — the most expensive kind |
| cache write | 1,900 | 5.0% | context stored for reuse (~1.25× input price) |
| cache read | 34,000 | 88.9% | context replayed from cache (~0.1× input price) |
| **total** | **38,250** | 100% | raw sum — dominated by the cheapest kind |

**Cache hit rate: 94.3%** — share of all prompt tokens replayed from cache versus processed fresh (input + cache write are the fresh processing).
**Cache savings: ~83.6% of prompt cost** — what the same prompt volume would have cost uncached (all tokens at 1× input price) versus as billed (write 1.25×, read 0.1×).
**Cache-read cost share: ~20.1% of spend** (public-list ratios: in 1× / out 5× / write 1.25× / read 0.1×) — the dollar-weighted view the cross-factory dataset reports.

## By model

| model | input | output | cache write | cache read | total |
|---|---|---|---|---|---|
| claude-opus-5 | 50 | 1,000 | 2k | 25k | 27,550 |
**Total: 38,250 tokens · $1.85 · 0.5h active · 1 dispatches** — judge by composition and hit rate, not by the big number.

## By role

| role | cost | real work | cache write | cache read | hit rate |
|---|---|---|---|---|---|
| lead | $1.85 | 1,050 | 2k | 25k | 94.2% |
| implementer | — | 1,300 | 400 | 9k | 94.7% |

_role cost = the parent session's role, inclusive of its dispatches; — (n unpriced) = n parent session(s) without dollars; — = not allocated at this grain: a dispatch-only role has no parent-session dollars (its dispatch dollars are the separate breakdown, never added to a role or the total)_

## Dispatch dollars by role

_measured per-dispatch dollars by dispatch role — already inside the parent role and the total, so never added to them_

| role | cost | dispatches | priced |
|---|---|---|---|
| implementer | $1.00 | 1 | 1 of 1 |

## Orchestrator (lead thread) composition

Lead: $0.85 — overhead incl. stages is 46% of the batch · real work 1,050 · cache 25k read / 2k write · hit rate 94.2%
A high lead share with a high hit rate is orchestration overhead working as designed (context replayed per turn), not runaway spend.

## Per case (direct; clustered cases are an even split)

| case | cost | input | output | cache write | cache read | total | hit rate | share |
|---|---|---|---|---|---|---|---|---|
| W1-1 | $0.50 | 50 | 600 | 200 | 5k | 5,350 | 94.7% | 14.0% |
| W1-2 | $0.50 | 50 | 600 | 200 | 5k | 5,350 | 94.7% | 14.0% |
