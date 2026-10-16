> Normative extract of docs/spec.md §4.2 (v4.2). The spec wins on any difference.

### 4.2 Registries (open; add rows by PR)

| `host` | session id | `turns` | `activeMin` | `wallMin` |
|---|---|---|---|---|
| `claude` | generated-UUID (transcript stem / hook `session_id`) | deduped parent assistant messages | parent active time with gaps > 30 min **excluded**, + Σ dispatch active; each rounded to whole minutes | first → last parent timestamp, rounded minutes |
| `copilot` | **caller-chosen** (session-state dir name) | parent user + assistant messages | active time over all events, gaps > 30 min excluded, rounded minutes | first → last event, rounded minutes |
| `copilot-vscode` | generated-UUID normally (chatSessions file stem) | requests | Σ request `elapsedMs` ÷ 60 000, rounded (missing `elapsedMs` ⇒ 0) | session start → end, rounded minutes |

| `costSource` | meaning |
|---|---|
| `ccusage-metered` | Claude, metered by ccusage at capture |
| `copilot-nano-aiu` | Copilot CLI billed `totalNanoAiu` (1 credit = $0.01) |
| `copilot-credits` | VS Code sidebar billed `copilotCredits` |
| `none` | no real figure |

No registry entry may denote an estimate. Unknown `host`/`costSource` ⇒
`error` in port mode.

