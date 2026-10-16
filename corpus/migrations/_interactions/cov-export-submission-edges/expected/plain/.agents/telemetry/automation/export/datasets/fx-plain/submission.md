# Submission — fx-plain (`testing` stop)

*Paired with the machine-readable [`runs.json`](./runs.json) (identical numbers). Telemetry cohort: every row is reconstructed from the pipeline's own per-batch cost receipts.*

## Factory

| | |
|---|---|
| **Factory** | `fx-plain` |
| **Stop · owner** | `testing` · `QA` |
| **Work-item level** | `feature` |
| **Agent / tool** | `claude` |
| **Method · scope** | `metered` · subagents ✓, retries ✗, abandoned ✗ |
| **Techniques** | prompt-caching |
| **Pipeline** | analyse |

## Aggregate summary — 1 work-item(s)

| Metric | Value |
|---|---|
| Total cost (API-equivalent) | — (1 unpriced) |
| Scenarios authored / automated / executed | 0 / 0 / 0 |
| Tokens (in / out / cache-read / cache-create) | — (1 unmeasured) |
| Sessions / dispatches / turns | 0 / 0 / — (1 unmeasured) |

## §7 checklist status

- ❌ row 1 (`T-p1`): work_item_brief
- ❌ row 1 (`T-p1`): effort_days (run the intake sizing pass)
- ❌ row 1 (`T-p1`): size_tshirt (derives from effort_days)
- ❌ row 1 (`T-p1`): tokens (4 totals)
- ❌ row 1 (`T-p1`): primary_model/models_used
- ❌ row 1 (`T-p1`): cost_api_equivalent_usd > 0
- ❌ row 1 (`T-p1`): cache_read_share_pct in [0,100]
- ❌ row 1 (`T-p1`): scenarios_authored
- ❌ row 1 (`T-p1`): scenarios_automated
- ❌ row 1 (`T-p1`): scenarios_executed
- ❌ row 1 (`T-p1`): scenario_complexity (from sizing verdicts)
- ❌ row 1 (`T-p1`): env_setup (set it in factory-profile.json: trivial|single-fixture|multi-fixture|external-deps|full-env)

_Free-form technique/savings notes: fill in what you measured (the guide's `measured_savings`) before opening the PR._

manifest revision 1
