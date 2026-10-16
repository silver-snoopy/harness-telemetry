# Interaction declarations (B2)

The `default` and `all` modes of `node scripts/migrations.mjs check` expect every case to equal the
**composition** of the landed migrations' declared diffs: start from the baseline, apply each declaring
migration's `changed` / `removed` / `exits` in registry order. Disjoint declarations compose exactly. A path
(or event exit `exit:<i>`) that two migrations both declare is a conflict, and a conflict is a problem until
an interaction declaration here resolves it. An interaction may also declare paths that no single migration
changes — for example `entry-guard` + `writer` on `before-entry-symlink`: `writer` alone changes nothing
there, but together they write a stamped line.

One directory per case:

```
_interactions/<case>/interaction.json
_interactions/<case>/expected/<path>        complete after-file for each `changed` path
```

```json
{ "case": "<case>", "migrations": ["<id>", "<id>"], "reason": "<at least 40 characters>",
  "changed": ["<path>"], "removed": ["<path>"], "exits": [0] }
```

- `migrations` names at least two distinct ids, all landed, and at least one of them declares the case (not
  all: `writer` alone cannot declare `before-entry-symlink`). The interaction applies only when all of them
  are enabled, so only in `default` and `all`; the `only:<id>` modes ignore it.
- Its `changed`, `removed` and `exits` override the composition. Every conflict must be covered by one of its
  paths, or by its `exits` vector (a whole vector, baseline length, covering every `exit:<i>`).
- It may override a key (a path, or an `exit:<i>` it sets to a value other than the composition's) only when
  `migrations` names **every** migration that declares that key, conflicted or sole:
  `<case>: interaction overrides <key> owned by <id> without naming it`. So a migration that lands later on a
  path an interaction already stamps fails until the interaction is revised. Keys no migration declares are
  free (the stamped-line case).
- A path whose bytes equal what the composition alone gives is vacuous: `interaction declares no change`.
- `removed` and `exits` are optional; an interaction that declares nothing is a problem.

Write `case`, `migrations` and `reason` by hand — and the `changed` / `removed` / `exits` keys you intend
the interaction to pin — then run `node scripts/migrations.mjs write-interaction <case>`. It replays
`default` (`TOKENOMICS_MIGRATIONS` unset) and records the run's bytes for **only** (i) the keys conflicted
between declarers and (ii) the keys your hand-written interaction already lists in `changed` / `removed` /
`exits`; the exit vector is recorded when it differs or an exit conflicts. Any other difference between the
run and the composition is refused, naming each key (`<case>: default run differs at <key>, not listed in
the interaction — add it to changed/removed first, then re-run`), as is a difference on a key an unnamed
migration owns. Two further refusals keep the recording honest:

- `<case>: interaction overrides <key> owned by <id> without naming it` — every key it would record,
  **conflicted keys included**, must have every owner named in `migrations`; this is the same rule `check`
  applies, enforced before anything is written.
- `<case>: listed key <key> shows no difference in the default run` — a path you listed in `changed` /
  `removed` (or an `exits` you listed) that the run leaves equal to the composition is refused instead of
  silently dropped; remove it from the interaction and re-run.

It also refuses a reason under 40 characters and refuses when nothing differs. The whole candidate
declaration (keys, bytes and exits) is computed and validated in memory first; on any refusal it writes
nothing — the existing `interaction.json` and after-files stay byte-identical — and it never writes into
`corpus/cases`. A path may not be spelled `exit:<i>`: that
namespace is the exit keys'. Review the result with
`node scripts/migrations.mjs show-interaction <case>`.

Cumulative bytes are never recorded from the implementation by any other route. The after-files are
generated, **never hand-edited**.

Recorded so far: `before-ids-substring` (`exact-ids` + `null-unobservable`, `.agents/automation/g1/cost.json`) and
`cov-capture-pricing` (`fold-flags` + `null-unobservable`, the ledger).
