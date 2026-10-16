# Submission — UNSET-factory-id (`undefined` stop)

*Paired with the machine-readable [`runs.json`](./runs.json) (identical numbers). Telemetry cohort: every row is reconstructed from the pipeline's own per-batch cost receipts.*

## Factory

| | |
|---|---|
| **Factory** | `UNSET-factory-id` |
| **Stop · owner** | `undefined` · `undefined` |
| **Work-item level** | `feature` |
| **Agent / tool** | `claude` |
| **Method · scope** | `metered` · subagents ✗, retries ✓, abandoned ✓ |
| **Techniques** | — |
| **Pipeline** | analyse > implement |

## Aggregate summary — 2 work-item(s)

| Metric | Value |
|---|---|
| Total cost (API-equivalent) | $null |
| Scenarios authored / automated / executed | 1 / 0 / 1 |
| Tokens (in / out / cache-read / cache-create) | 1 / 2 / 0 / 4 |
| Sessions / dispatches / turns | 1 / 2 / 3 |

## §7 checklist status

- ❌ row 1 (`T-WI-001`): segment.factory_id
- ❌ row 1 (`T-WI-001`): segment.factory_name
- ❌ row 1 (`T-WI-001`): segment.stop/owner_group/work_item_level
- ❌ row 1 (`T-WI-001`): effort_days (run the intake sizing pass)
- ❌ row 1 (`T-WI-001`): tokens (4 totals)
- ❌ row 1 (`T-WI-001`): cache_read_share_pct in [0,100]
- ❌ row 1 (`T-WI-001`): scenarios_automated
- ❌ row 1 (`T-WI-001`): scenario_complexity (from sizing verdicts)
- ❌ row 1 (`T-WI-001`): env_setup (set it in factory-profile.json: trivial|single-fixture|multi-fixture|external-deps|full-env)
- ❌ row 1 (`T-WI-001`): tokens_by_model (required: models_used > 1; re-run close with current capture hooks)
- ❌ row 2 (`T-WI-002`): segment.factory_id
- ❌ row 2 (`T-WI-002`): segment.factory_name
- ❌ row 2 (`T-WI-002`): segment.stop/owner_group/work_item_level
- ❌ row 2 (`T-WI-002`): effort_days (run the intake sizing pass)
- ❌ row 2 (`T-WI-002`): size_tshirt (derives from effort_days)
- ❌ row 2 (`T-WI-002`): tokens (4 totals)
- ❌ row 2 (`T-WI-002`): primary_model/models_used
- ❌ row 2 (`T-WI-002`): cache_read_share_pct in [0,100]
- ❌ row 2 (`T-WI-002`): scenarios_authored
- ❌ row 2 (`T-WI-002`): scenarios_automated
- ❌ row 2 (`T-WI-002`): scenarios_executed
- ❌ row 2 (`T-WI-002`): scenario_complexity (from sizing verdicts)
- ❌ row 2 (`T-WI-002`): env_setup (set it in factory-profile.json: trivial|single-fixture|multi-fixture|external-deps|full-env)
- ❌ row 2 (`T-WI-002`): tokens attribution 'none' — some dispatches reported no usage (gateway pass-through gap); token totals and cost are a FLOOR, not a bill

_Free-form technique/savings notes: fill in what you measured (the guide's `measured_savings`) before opening the PR._
