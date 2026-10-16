> Normative extract of docs/spec.md §7 and §14.7 (v4.2). The spec wins on any difference.

## 7. Reference reading profile (`--mode reference`)

How to read data written by the sdlc-skills reference without changing it.

### 7.1 Layouts accepted

Module dir `automation/` (manifest absent ⇒ implied manifest below); the
flat-era layout (ledgers/config/scopes directly at `.agents/telemetry/`);
mixed layouts; `usage.jsonl` (un-suffixed) alongside `usage-<slug>.jsonl`.
Implied manifest: `{module:"tokenomics", schema_version:"1.0",
domain:"test-automation", receipts:{root:".agents/automation", file:"report.json",
deliveredOutcomes:["delivered","defect-found","automated",
"merged-sanctioned-red"]}, ratioIntents:["automation"]}`.

### 7.2 Host variants accepted

| variant | differences from §3.2 |
|---|---|
| Claude, ordinary | `tokensAttributed:false` may appear; `prompts`/`dispatched` object shapes as §3.2 |
| Claude, folded dispatch | dispatch lacks `tokensByModel` and `tokensAttributed`; session carries `foldedFromLive: n`; enclosing `tokensAttribution`/`models` not recomputed |
| Claude, pre-`fa0a6fb` | no `tokensByModel`, no dispatch `id`/`cases`, no `scope`, no attribution flags; absent usage written as zero quads |
| Copilot | no `tokensByModel`; dispatch has no `id`/`cases`; dispatch `tokens.input` = host total, others 0; session input netted by Σ dispatch totals (clamped at 0); shutdown without usage written as a zero quad with no attribution flag |
| VS Code | no `tokensByModel`; `branch:null`; `toolCalls:0` and `skills:[]` are unconditional (not observable); `toolErrors` is measured (request errors); `title` may be null; missing usage written as 0; missing `elapsedMs` ⇒ 0 active minutes |

All of these read as `tokensBasis:"parent"` with the limitations in §7.4.

### 7.3 Unknowns

Unknown `v` or unknown `costSource`: retained and shown diagnostically,
**excluded from verified totals** (no supported interpretation); other known
fields reported as `unverified`.

### 7.4 Known limitations (reported per affected record as `limitation`)

Zero-for-unmeasured quads and counters (pre-`fa0a6fb`, Copilot shutdown without
usage, VS Code usage/`toolCalls`/`skills`/`elapsedMs`); Copilot
category split not measured and possible non-conservation of the session total;
folded-dispatch metadata loss; reference ids trusted without validation (§3.4);
email-local-part slugs in early ledgers; reference group costs may count a
shared-id dispatch at full weight in several groups (§10). A limitation is a
*known possibility from provenance*, not a proven violation.

### 14.7 Mixed-era ledgers (upgrade boundary)

An upgraded install appends to the same per-user files, so eras mix within one
file. **Record-level provenance, explicit:** every line written by the **post-B2
production engine** carries a required `writer: "tokenomics-engine@<semver>"`
(B1's extraction output reproduces reference bytes and is *not* port-conformant).
Upgraded installs are read with `--mode mixed` (§1.1): port contract for
`writer` lines, reading profile for the rest — by this dedicated field, never by
inference from optional fields — with global `host:id` dedup across eras;
`--mode port` rejects lines without `writer`. No historical line is rewritten or
deleted. Fixture (A3): old and new captures of the same Copilot session,
old-only sessions, subsequent sweeps; expected totals fixed.

