# Tokenomics — team usage report

Generated: 2026-10-05T09:09:00.000Z

## Totals

- Sessions: 4 (claude 4)  ·  people: 1
- Cost (real figures only): $14.50 from 4 priced session(s) (ccusage-metered ×4)
- Tokens (incl. sub-agents): total 269,780  ·  in 820, out 19,700, cache-read 235,500, cache-write 13,760
- Real work: 20,520 tokens (in+out)  ·  cache hit rate: 94.2%
- Time: 4.0h active  ·  8.0h wall  ·  40 turns  ·  48 tool calls (4 err)
- Case ids named in sessions: 4 distinct (sessions-per-case in the --json `byCase`; top: S-1, S-2, W1-1, S-3)
- By declared intent: automation $5.00 (2)  ·  undeclared $9.50 (2)

## Cases (from the pipeline's own receipts)

- Examined: 4 unique case(s) across 1 report(s)  ·  **delivered (automated): 3**
- Outcomes: delivered 2  ·  defect-found 1  ·  not-started 1
- Per delivered case: $4.83  ·  80 active min  ·  **automation-intent spend only: $1.67**  ·  per case examined: $3.63
  (spend in the window ÷ delivered cases in the receipts — align the window to the batch for a per-batch figure)

## By person

| person | cost | sessions | tokens (in/out) | active | tools (err) |
|---|---|---|---|---|---|
| alice | $14.50 | 4 | 820/19,700 | 4.0h | 48 (4) |

## By role

| role | cost | units | tokens (in/out) | active | tools (err) |
|---|---|---|---|---|---|
| analyst | (session-grain) | 1 | 100/9,000 | 0.1h | 4 (0) |
| (interactive session) | (session-grain) | 3 | 300/6,000 | 2.4h | 36 (3) |
| implementer | (session-grain) | 4 | 270/2,200 | 0.3h | 16 (0) |
| lead | (session-grain) | 1 | 100/2,000 | 0.8h | 12 (1) |
| reviewer | (session-grain) | 2 | 30/300 | 0.2h | 8 (0) |
| triage | (session-grain) | 1 | 10/100 | 0.1h | 4 (0) |
| helper | (session-grain) | 2 | 10/100 | 0.2h | 8 (0) |

## By week

| week | cost | sessions | tokens (in/out) | active | tools (err) |
|---|---|---|---|---|---|
| 2026-W31 | $9.00 | 1 | 100/2,000 | 1.0h | 12 (1) |
| 2026-W40 | $5.00 | 2 | 620/15,700 | 2.0h | 24 (2) |
| unknown | $0.50 | 1 | 100/2,000 | 1.0h | 12 (1) |

_Dollars are session-grain (one figure per session, real sources only), so the role table reports tokens/time — sub-agent roles included. Fork/resume caveat: a forked session replays its parent's records; its ledger line can double-count the replayed tokens._
