> Normative extract of docs/spec.md §2 (v4.2). The spec wins on any difference.

## 2. Shared telemetry substrate

Data rules are normative; setup choreography is a recommendation.

- **Location.** `.agents/telemetry/<module-dir>/`. Two conforming forms:
  *submodule form* (recommended — same-repo submodule, `url = ./`, own
  `telemetry` branch, `ignore = all`; main tree never dirty) or *plain-folder
  form* (ordinary committed folder). Same layout and rules either way.
  **The plain-folder form is forbidden where the harness binds a gate to a
  commit** (e.g. LeRisque's Stage 4.5 acceptance report pinned to HEAD): a
  capture commit on a feature branch would invalidate the gate (PoC P5). The
  porting skill detects or asks about such gates (§15.2).
- **In submodule form the main tree is never written by the engine** at
  capture, scope or report time: reports and close-time records go to the
  telemetry branch under `<module-dir>/reports/`; the only main-tree artefacts
  are the engine install, `.agents/tokenomics/settings.json` and the project's
  glue (PoC P5). (The TA configuration keeps its legacy in-tree layout, §14.8.10.)
  Plain-folder form writes the main tree by definition and is never chosen
  silently (§14.2).
  `.agents/telemetry` MUST NOT be gitignored. A repo with no remote conforms.
- **Modules.** One subfolder per module; a module writes only inside its own.
  Names are free; `module.json` declares the module (§3.1).
- **Per-user files.** Ledger file names carry a user slug (`git user.name` →
  OS user → email local-part; lower-cased, non-`[a-z0-9]` runs → `-`, trimmed,
  empty ⇒ `unknown`). The slug is a **label for conflict-free appends, not an
  identity**: distinct people can collide on a slug (known limitation).
- **Append-only JSONL** for ledgers; JSON documents (manifest, scope, config)
  are rewritten whole.
- **Sync.** Best-effort commit+push at capture moments; failure never fails a
  hook; opt-out `<MODULE>_NO_SYNC=1`. Team readers pull first.
- **Working state** (transient files) SHOULD stay out of commits. This is an
  installation-hygiene concern, checked only by an **optional** diagnostic
  (tracked working files in a checkout); interchange validation never needs a
  git checkout, and a standalone snapshot reports it `unverified`. Durable pending scope records (`scopes/pending-*.json`)
  are data, not working state; dot-prefixed markers (`.pending-*`, `.nagged-*`,
  `.unclosed-*`) are working state.

