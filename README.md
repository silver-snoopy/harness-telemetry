# harness-telemetry

[![ci](https://github.com/silver-snoopy/harness-telemetry/actions/workflows/ci.yml/badge.svg)](https://github.com/silver-snoopy/harness-telemetry/actions/workflows/ci.yml)

Portable telemetry for agent harnesses: **Claude Code**, **GitHub Copilot CLI** and **Copilot in VS Code**. The first
module is **tokenomics**. For every agent session it records tokens, real dollars, active minutes and the work-item
ids the session touched. It keeps that record in a git-durable ledger inside your repository and reports what was
spent against what was delivered.

It works in any repository. It doesn't need sdlc-skills, has no npm dependencies, and runs on Node ≥ 18.19.

> **Status:** release candidate (`v0.4.0`, milestones R0–B3 of [`docs/spec.md`](docs/spec.md) §12).
> - **Claude Code** capture is verified in a real session.
> - **Copilot CLI** and **VS Code** capture are wired and tested against fake hosts. Verification against the real
>   hosts is milestone C2.
> - The first production release follows the shadow run (B4).

## What you get

- **A ledger line per session.** Each line carries the host, user, branch, models, tokens (input, output, cache read
  and write), the cost, active and wall minutes, turns, tool calls, sub-agent dispatches and the work-item ids.
  Ledgers live in `.agents/telemetry/<dir>/usage-<user>.jsonl`.
- **Real dollars only.** No cost is ever estimated:
  - Claude Code sessions are metered by [`ccusage`](https://github.com/ryoppippi/ccusage) at capture time.
  - Copilot sessions use Copilot's own billed figures (`totalNanoAiu` for the CLI, `copilotCredits` for VS Code).
  - A session without a real figure is counted and labelled **tokens-only**.
- **A durable, shared store.** The ledger lives on an orphan `telemetry` branch, mounted as a submodule at
  `.agents/telemetry`. It never pollutes your main history, is pushed with best effort, and merges across the team
  through git.
- **Work scopes and outcomes.** A session can declare what it is working on (`work-scope.mjs`), and spend is then
  split by intent and joined to outcomes.
- **Reports.** A team usage report (Markdown, HTML or JSON) covers cost per person, role, week, host and work item,
  and cost per delivered outcome.
- **Safety by design.**
  - Copying the engine in never turns it on; activation is a separate, explicit step.
  - Activation takes a verified checkpoint (a tag plus a git bundle) before it changes anything.
  - A hook never fails your host session.
  - `doctor` checks the installation for integrity against its own hash baseline.

## Requirements

- **Node.js ≥ 18.19** on every machine where sessions run, with `node` on the `PATH` that the hooks see.
- **git**, and a repository with an `origin` you can push a `telemetry` branch to. Without a remote, everything
  stays local.
- **One or more hosts:** Claude Code (`claude`), GitHub Copilot CLI (`copilot`), or VS Code with Copilot Chat.
- **Optional, for Claude dollar figures:** network access for `npx ccusage` at capture time, or a `ccusage` binary
  named by `TOKENOMICS_CCUSAGE_BIN`. Without it, Claude sessions are recorded as tokens-only.

## Setup

Run every command from the **root of the project you want to track** (`<project>`). The examples assume this
repository is cloned next to it.

### 1. Get harness-telemetry

```sh
git clone https://github.com/silver-snoopy/harness-telemetry ../harness-telemetry
```

### 2. Copy the engine into the project

```sh
# Claude Code  → .claude/skills/tokenomics
node ../harness-telemetry/bin/harness-telemetry.mjs install tokenomics --target claude  --repo .

# Copilot (CLI and VS Code) → .github/skills/tokenomics
node ../harness-telemetry/bin/harness-telemetry.mjs install tokenomics --target copilot --repo .
```

This step copies files only. It changes no host settings and starts no hook. Install both targets if the team uses
both hosts. `--force` replaces whatever directory is at the destination, so check it first.

### 3. Activate for each host you use

```sh
# Claude Code
node .claude/skills/tokenomics/scripts/install-hooks.mjs --host claude --git-hook

# Copilot CLI
node .github/skills/tokenomics/scripts/install-hooks.mjs --host copilot-cli --git-hook

# VS Code Copilot Chat: only for repos where nobody uses Claude Code or Copilot CLI (see below)
node .github/skills/tokenomics/scripts/install-hooks.mjs --host vscode
```

The VS Code sidebar has no hooks. Every sweep, whichever host starts it, already reads the sidebar's sessions too. So
`--host vscode` is needed only in a repository where nobody runs Claude Code or Copilot CLI. It adds a folder-open
task to `.vscode/tasks.json`, and VS Code asks each teammate once per folder to allow automatic tasks.

Activation runs these steps in order:
1. It creates or verifies the `telemetry` submodule at `.agents/telemetry`.
2. It takes the verified checkpoint `pre-engine-<version>`.
3. It writes the module manifest.
4. It wires the host hooks and adds the ignore lines for transient state.
5. With `--git-hook`, it adds the post-commit fallback, which sweeps sessions after each commit and chains any
   existing hook.
6. It records the activation last.

If a step fails, nothing is activated: fix the cause and re-run. Re-running on a healthy install writes nothing and
prints `already active`. Useful flags:
- `--dir <name>` names the ledger folder (default `tokenomics`).
- `--plain-folder` is a fallback, used only when the submodule form fails.
- `--local` writes Claude's `settings.local.json` instead of `settings.json`.

### 4. Check it

```sh
node .claude/skills/tokenomics/scripts/doctor.mjs                         # integrity, activation, substrate, settings, hooks
node .claude/skills/tokenomics/scripts/doctor.mjs --probe --host claude   # one short real session: do the hooks fire?
```

`doctor` only reads, and it exits 1 on any `fail`. `--probe` runs one isolated host session (`claude -p …` or
`copilot -p …`) whose telemetry goes to a temporary directory, so your ledger is untouched. It reports `fired`,
`not-fired`, `partial` (captured by the git sweep only) or `unavailable`. VS Code always reads `unavailable` here;
verify it with a real sidebar session followed by a sweep.

### 5. Commit what your teammates need

```sh
git add .claude/skills/tokenomics .github/skills/tokenomics \
        .agents/tokenomics/settings.json .claude/settings.json .github/hooks/tokenomics.json \
        .vscode/tasks.json .gitignore .gitmodules .agents/telemetry
git commit -m "chore: add tokenomics telemetry"
```

Add only the paths that exist for your hosts. Teammates who clone with `--recurse-submodules` are ready. Anyone else
runs `git submodule update --init .agents/telemetry` once. Each teammate also needs Node on the `PATH` their host
uses.

## Configure (optional)

Project settings live in `.agents/tokenomics/settings.json`. Activation creates the file, and you edit and commit it.
The settings you are most likely to change:

| key | what it does |
|---|---|
| `ids.patterns` | Regexes that mine work-item ids from branch names and prompts. The default matches Jira-style keys (`ABC-123`). |
| `intents.default` | The intent of a session that declares none. |
| `enforcement.stopGate` | `"on"` wires a Stop gate that reminds a session to close its scope. It is installed `"off"`; re-run activation after changing it. |
| `dir` | The ledger folder under `.agents/telemetry/`. |

The full settings contract, the host registries and what each field means are in [`docs/spec.md`](docs/spec.md)
(§4 and §14.4).

## Use it

Capture is automatic once activation is done:
- **Session hooks:** Claude Code and Copilot CLI capture through their hooks at session start and session end.
- **Session-start sweep:** each new session first sweeps up any session that was missed.
- **Git post-commit fallback:** with `--git-hook`, a background sweep also runs after every commit.

Reports run from the project root with the installed copy:

```sh
node .claude/skills/tokenomics/scripts/team-report.mjs                        # Markdown team report on stdout
node .claude/skills/tokenomics/scripts/team-report.mjs --html --out report.html
node .claude/skills/tokenomics/scripts/team-report.mjs --json --since 2026-10-01 --until 2026-10-31
```

For the whole team's picture, run `git -C .agents/telemetry pull` first. Each engineer's ledger lines arrive through
the `telemetry` branch.

To tie spend to specific work, a session (or you) can declare a scope:

```sh
node .claude/skills/tokenomics/scripts/work-scope.mjs open    --session <id> --intent feature --cases ABC-123,ABC-124
node .claude/skills/tokenomics/scripts/work-scope.mjs outcome --session <id> ABC-123=delivered
node .claude/skills/tokenomics/scripts/work-scope.mjs close   --session <id>
```

[`tokenomics/SKILL.md`](tokenomics/SKILL.md) is the operator reference for every command, flag, check and state.

## Upgrade and remove

- **Upgrade.** Pull this repository, re-run step 2 with `--force` for every target, then re-run step 3. Until step 3
  runs, the new copy is **inert**: its hooks exit 0 and do nothing. The next sweep captures the sessions it missed.
- **Remove the git hook.** `node <skill>/scripts/install-hooks.mjs --git-hook --remove`. Any original
  `post-commit` hook is restored byte for byte.
- **Roll back.** Every activation leaves the tag `pre-engine-<version>` and a verified bundle under
  `$(git rev-parse --git-common-dir)/tokenomics/`. Those hold the store and the settings and host files as they were.

## Project structure

```
harness-telemetry/
├── bin/harness-telemetry.mjs   CLI: install, check, aggregate, replay
├── tokenomics/                 the installable skill — the only part copied into a project
│   ├── SKILL.md                operator reference (commands, activation, states)
│   ├── ENGINE.json             engine version + hash baseline of every installed file
│   ├── engine/                 capture, sweep, scope, join, config, activation, substrate, checkpoint, probe
│   ├── hooks/                  host hook entry points (telemetry-capture, scope-hook, otel-sink)
│   ├── scripts/                install-hooks, doctor, work-scope, team-report, batch-cost, exports, otel-report
│   ├── kit/                    check + aggregate: validate and roll up ledgers against the port contract
│   ├── spec/                   contract docs (SUBSTRATE, TOKENOMICS, READING-PROFILE, REGISTRY) + schemas
│   ├── references/, templates/ reference notes and settings/profile templates
│   ├── extensions/             test-automation extension (not shipped; used by the corpus)
│   └── fixtures/               test fixtures (not shipped)
├── corpus/                     sanitised reference corpus: cases, goldens, migrations, privacy tests
├── reference/                  verbatim snapshots of the sdlc-skills reference writer (MIT, see NOTICE)
├── replay/                     hermetic replay runner (frozen clock, seeded RNG, no network, sorted listings)
├── scripts/                    gates and tooling: coverage, diff-impl, migrations, inventory, engine-manifest, …
├── docs/
│   ├── spec.md                 the design spec (normative)
│   ├── plans/                  implementation plans and execution ledgers, per milestone
│   ├── reviews/                milestone reviews and owner decisions
│   ├── b2/, inventory/         migration map and the dependency inventory
└── .github/workflows/ci.yml    CI: ubuntu + macOS × Node 18.19 / 24, every gate
```

## Development

```sh
npm test                           # every *.test.mjs (no dependencies)
node scripts/coverage.mjs          # coverage gate
node scripts/diff-impl.mjs         # engine vs reference goldens: must report "differing 0"
node scripts/migrations.mjs check  # each behaviour migration's diff equals its declared diff (~15 min)
node scripts/inventory.mjs         # every dependency site assigned
```

All five must exit 0. CI runs them on ubuntu and macOS with Node 18.19.0 and 24. Rules for contributors:
- Never commit raw session data; see [`corpus/README.md`](corpus/README.md).
- Never edit goldens by hand.
- Never modify `reference/`.
- Regenerate `tokenomics/ENGINE.json` (`node scripts/engine-manifest.mjs`) whenever an engine file changes.

How the engine was built:
- **B1, pure extraction.** The engine was extracted from the sdlc-skills reference (`reference/49577c7`). With no
  settings file it reproduces the reference byte for byte on every corpus case.
- **B2, behaviour migrations.** Seventeen approved behaviour migrations then landed, each one's diff pinned exactly.
  `TOKENOMICS_MIGRATIONS` switches them in a source checkout; it is a test lever, and an installed copy refuses it.
- **B3, install path.** B3 added the install path, the activation gate, the probe and the git fallback.

The engine record is [`tokenomics/ENGINE-B1.md`](tokenomics/ENGINE-B1.md), and each milestone's plan and ledger are
in [`docs/plans/`](docs/plans/).

<details>
<summary>What the differential harness observes</summary>

`node scripts/diff-impl.mjs` compares what a replay observes:
- the case's declared output roots, byte for byte;
- every event's stdout and stderr. Diagnostics are normalised: Node warnings, stack frames and source excerpts;
- a final-state summary of every other path change under the sandbox root, with content digests, in
  `__sandbox__/changes.txt`.

`changes.txt` has one JSON array per line: `["A",path,digest]`, `["M",path,old,new]` or `["D",path,old]`. A newline
or quote in a path or link target is therefore escaped, and one entry never reads as two (`corpus/CASES.md`,
"Replay infrastructure").

Not observed:
- transient writes created and undone within the run;
- file modes, mtimes and empty directories;
- `.git` directories and the manifest's `untracked` paths;
- anything outside the sandbox root (e.g. `os.tmpdir()`).

A nested git directory is summarised by git plumbing: the HEAD target, and per ref its name, commit count and tip
tree. Its own commit ids, dates, messages, index and reflogs are not observed. That summary has preconditions and
limits:
- git must be on `PATH`; without it, git directories are walked as ordinary files and `changes.txt` may vary between
  runs;
- it hashes git's raw committed blob ids, and committed content is not scrubbed, so fixtures must not commit sandbox
  paths or times;
- a detached HEAD contributes only `detached` (the tree it points at is not observed);
- it assumes the SHA-1 object format (a SHA-256 repository digests differently);
- gitlink (submodule) entries contribute their commit ids.

A ref git cannot read reads `ref <name> unavailable`. A directory shaped like a git dir whose summary git cannot take
is walked as ordinary files instead of collapsing. File digests hash the scrubbed content. Paths and symlink targets
are scrubbed field by field, and targets outside the scrubbed roots appear verbatim.

</details>

## License

Apache-2.0, see [`LICENSE`](LICENSE). Third-party code in `reference/` is MIT; see [`NOTICE`](NOTICE).
