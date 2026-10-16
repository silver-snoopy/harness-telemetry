# Batch tokenomics — c1/w

Generated: 2026-10-01T09:07:00.000Z  ·  sessions: 0  ·  models: —  ·  companion of batch-report (delivery view)

## Composition — where the tokens went

| kind | tokens | share | what it is |
|---|---|---|---|
| real work: input | 0 | NaN% | fresh prompt tokens, full price |
| real work: output | 0 | NaN% | generated tokens — the most expensive kind |
| cache write | 0 | NaN% | context stored for reuse (~1.25× input price) |
| cache read | 0 | NaN% | context replayed from cache (~0.1× input price) |
| **total** | **0** | 100% | raw sum — dominated by the cheapest kind |

**Cache hit rate: n/a** — share of all prompt tokens replayed from cache versus processed fresh (input + cache write are the fresh processing).
**Cache savings: ~n/a of prompt cost** — what the same prompt volume would have cost uncached (all tokens at 1× input price) versus as billed (write 1.25×, read 0.1×).
**Total: 0 tokens · n/a · 0.0h active · 0 dispatches** — judge by composition and hit rate, not by the big number.

## Orchestrator (lead thread) composition

Lead: n/a · real work 0 · cache 0 read / 0 write · hit rate n/a
A high lead share with a high hit rate is orchestration overhead working as designed (context replayed per turn), not runaway spend.


manifest revision 1
