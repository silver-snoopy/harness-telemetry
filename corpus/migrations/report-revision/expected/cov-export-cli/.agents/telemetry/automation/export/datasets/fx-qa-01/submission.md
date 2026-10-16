# Submission — fx-qa-01 (`testing` stop)

*Paired with the machine-readable [`runs.json`](./runs.json) (identical numbers). Telemetry cohort: every row is reconstructed from the pipeline's own per-batch cost receipts.*

## Factory

| | |
|---|---|
| **Factory** | `fx-qa-01` |
| **Stop · owner** | `testing` · `QA` |
| **Work-item level** | `feature` |
| **Agent / tool** | `claude` |
| **Method · scope** | `metered` · subagents ✓, retries ✓, abandoned ✗ |
| **Techniques** | prompt-caching · model-tiering |
| **Pipeline** | analyse → implement → review |

## Aggregate summary — 1 work-item(s)

| Metric | Value |
|---|---|
| Total cost (API-equivalent) | $1.25 |
| Scenarios authored / automated / executed | 2 / 2 / 2 |
| Tokens (in / out / cache-read / cache-create) | 100 / 400 / 900 / 200 |
| Sessions / dispatches / turns | 1 / 0 / 12 |

## §7 checklist status

All rows pass the self-validation checklist.

_Free-form technique/savings notes: fill in what you measured (the guide's `measured_savings`) before opening the PR._

manifest revision 1
