# Tokenomics — team usage report

Generated: 2026-10-05T09:09:00.000Z  ·  window: 2026-08-01T10:00:00.000Z → 2026-10-05T09:09:00.000Z

_Current state, UTC: the per-delivered ratio counts items whose current (winning, spec 5.2) receipt state is delivered, dated by that state's at, inside [since, until); an item delivered, reopened and delivered again counts once, at its latest delivery, so historical ratios can change when items reopen. Limitation: a session's cumulative ledger line counts wholly in the window of its endedAt; no in-window deltas are claimed. Totals and breakdowns cover the sessions whose endedAt lies in the window; sessions without endedAt are outside every window and counted as undated._

## Totals

- Sessions: 3 (claude 3)  ·  people: 1
- Cost (real figures only): $14.00 from 3 priced session(s) (ccusage-metered ×3)
- Tokens (incl. sub-agents): total 214,680  ·  in 720, out 17,700, cache-read 185,500, cache-write 10,760
- Real work: 18,420 tokens (in+out)  ·  cache hit rate: 94.2%
- Time: 3.0h active  ·  6.0h wall  ·  30 turns  ·  36 tool calls (3 err)
- ⚠️ Undated: 1 session(s) without endedAt ($0.50, 1 of 1 priced) — outside every window, not in these totals
- Case ids named in sessions: 4 distinct (sessions-per-case in the --json `byCase`; top: S-1, S-2, W1-1, S-3)
- By declared intent: automation $5.00 (2)  ·  undeclared $9.00 (1)

## Cases (from the pipeline's own receipts)

- Examined: 4 unique case(s) across 1 report(s)  ·  **delivered (automated) in the window: 0**  ·  3 delivered without `at` (unwindowed, excluded)
- Outcomes (current state): delivered 2  ·  defect-found 1  ·  not-started 1

## By person

| person | cost | sessions | tokens (in/out) | active | tools (err) |
|---|---|---|---|---|---|
| alice | $14.00 | 3 | 720/17,700 | 3.0h | 36 (3) |

## By role

| role | cost | units | tokens (in/out) | active | tools (err) |
|---|---|---|---|---|---|
| analyst | (session-grain) | 1 | 100/9,000 | 0.1h | 4 (0) |
| (interactive session) | (session-grain) | 2 | 200/4,000 | 1.4h | 24 (2) |
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

_Dollars are session-grain (one figure per session, real sources only), so the role table reports tokens/time — sub-agent roles included. Fork/resume caveat: a forked session replays its parent's records; its ledger line can double-count the replayed tokens._
