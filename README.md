# harness-telemetry

[![ci](https://github.com/silver-snoopy/harness-telemetry/actions/workflows/ci.yml/badge.svg)](https://github.com/silver-snoopy/harness-telemetry/actions/workflows/ci.yml)

Portable telemetry for agent harnesses: **Claude Code**, **GitHub Copilot CLI** and **Copilot in VS Code**. The first
module is **tokenomics**. For every agent session it records tokens, real dollars, active minutes and the work-item
ids the session touched. It keeps that record in a git-durable ledger inside your repository and reports what was
spent against what was delivered.

It works in any repository. It doesn't need sdlc-skills, has no npm dependencies, and runs on Node ≥ 18.19.

> **Status:** release candidate (`v0.4.1-rc.1`, milestones R0–B3 of [`docs/spec.md`](docs/spec.md) §12).
> - **Claude Code** and **Copilot CLI** capture are verified in real sessions: hooks fired, the ledger line and the
>   billed cost landed, and a real Copilot task was captured live with no commit needed.
> - **VS Code** sidebar capture is wired and tested against a fake host; verification against the real sidebar is
>   milestone C2.
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

### Quick setup (one command)

From the root of the project you want to track:

```sh
npx github:silver-snoopy/harness-telemetry setup
```

To pin a release, name its tag: `npx github:silver-snoopy/harness-telemetry#v0.4.1-rc.1 setup`. From a clone of
this repository, the same command is `node ../harness-telemetry/bin/harness-telemetry.mjs setup`.

`setup` does everything in the manual steps below, in one run:
1. It **detects your hosts**: Claude Code (`claude` on the PATH, or a `.claude/` folder) and Copilot CLI (`copilot` on
   the PATH, or `.github/copilot-instructions.md`, `agents/`, `prompts/`, `hooks/` or `skills/`). It prints what it
   found and why.
2. It **copies the engine** for each host into the project.
3. It **activates** each host with the git post-commit fallback. Copilot CLI hooks are wired at user level
   (`~/.copilot/hooks/`), because Copilot CLI did not run repository hooks in our trial.
4. It runs **`doctor`**.
5. It **prints the `git add` / `git commit`** that shares the setup with your team, or makes that commit itself with
   `--commit`. `--commit` includes only these files and leaves anything else you have staged alone.

Re-running is safe: an up-to-date project reports `unchanged` and `already active`, and nothing is rewritten. Each
teammate runs the same command once on their own machine, which wires their Copilot hooks.

| option | effect |
|---|---|
| `--host claude,copilot-cli,vscode` | Choose the hosts instead of detecting them. `vscode` is never guessed. |
| `--commit` | Commit the shared files (only those) as `chore: add tokenomics telemetry`. |
| `--probe` | Also run one short real session per host, to prove the hooks fire. It uses a little of your quota. |
| `--no-git-hook` | Skip the post-commit fallback sweep. |
| `--repo-hooks` | Wire Copilot CLI in `.github/hooks/` instead of at user level. |
| `--repo <dir>` | Run on another directory instead of the current one. |
| `--tracker jira\|github\|ado` | The work-item tracker whose ids to mine and whose adapter reads receipts. Default: inferred from the remote and the history. |
| `--tracker-keys PAY,WEB` | The Jira project keys (default: the keys the history shows). Required with `--tracker jira` when the history shows none. |
| `--tracker-url <https url>` | The tracker's address for the adapter, for example `https://acme.atlassian.net`. Applies to `--tracker`, else to the detected tracker (an error when none is detected); must be https. A Jira address outside `*.atlassian.net` is Jira Server / Data Center (`"server": true`). |
| `--tracker-project <p>` | The tracker project for the adapter. Needs `--tracker`. |
| `--no-tracker` | Write no work-item id rules and no receipt command. |

### Manual setup (what `setup` runs)

Run every command from the **root of the project you want to track**. The examples assume this repository is cloned
next to it (`git clone https://github.com/silver-snoopy/harness-telemetry ../harness-telemetry`).

**1. Copy the engine into the project.**

```sh
# Claude Code  → .claude/skills/tokenomics
node ../harness-telemetry/bin/harness-telemetry.mjs install tokenomics --target claude  --repo .

# Copilot (CLI and VS Code) → .github/skills/tokenomics
node ../harness-telemetry/bin/harness-telemetry.mjs install tokenomics --target copilot --repo .
```

This step copies files only. It changes no host settings and starts no hook. Install both targets if the team uses
both hosts. `--force` replaces whatever directory is at the destination, so check it first.

**2. Activate for each host you use.**

```sh
# Claude Code
node .claude/skills/tokenomics/scripts/install-hooks.mjs --host claude --git-hook

# Copilot CLI: hooks at user level (recommended; see below)
node .github/skills/tokenomics/scripts/install-hooks.mjs --host copilot-cli --git-hook --user-hooks

# VS Code Copilot Chat: only for repos where nobody uses Claude Code or Copilot CLI (see below)
node .github/skills/tokenomics/scripts/install-hooks.mjs --host vscode
```

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

**Copilot CLI: why user-level hooks.** In our trial, Copilot CLI 1.0.96 ran user-level hooks
(`~/.copilot/hooks/*.json`) but never ran a repository's `.github/hooks/*.json`. So `--user-hooks` installs:
- `~/.copilot/hooks/tokenomics.json`;
- a small dispatcher beside it, `~/.copilot/hooks/tokenomics/dispatch.mjs`. On each hook it finds the session's
  repository and that repository's installed copy. It does nothing in a repository that has not activated
  tokenomics for `copilot-cli`.

Copilot writes a session's final usage after its `sessionEnd` hook runs. The dispatcher therefore captures the
session a moment later, once Copilot has written the shutdown, without delaying Copilot. One file serves every
repository on the machine. Two commands remove it:
- `install-hooks.mjs --remove --host copilot-cli` keeps it;
- `--remove --host copilot-cli --user-hooks` removes it.

**VS Code.** The sidebar has no hooks, but every sweep, whichever host starts it, also reads the sidebar's sessions.
So `--host vscode` is needed only in a repository where nobody runs Claude Code or Copilot CLI. It adds a folder-open
task to `.vscode/tasks.json`, and VS Code asks each teammate once per folder to allow automatic tasks.

**3. Check it.**

```sh
node .claude/skills/tokenomics/scripts/doctor.mjs                         # integrity, activation, substrate, settings, hooks
node .claude/skills/tokenomics/scripts/doctor.mjs --probe --host claude   # one short real session: do the hooks fire?
```

`doctor` only reads, and it exits 1 on any `fail`. `--probe` runs one isolated host session whose telemetry goes to
a temporary directory, so your ledger is untouched: `claude -p …`, or `copilot -p … --allow-tool 'shell(node)'`,
which approves only the one `node` command the probe asks for. It reports `fired`, `not-fired`, `partial` (captured
by the git sweep only) or `unavailable`. VS Code always reads `unavailable` here; verify it with a real sidebar
session followed by a sweep.

**4. Commit what your teammates need.**

```sh
git add .claude/skills/tokenomics .github/skills/tokenomics \
        .agents/tokenomics/settings.json .claude/settings.json .github/hooks/tokenomics.json \
        .vscode/tasks.json .gitignore .gitmodules .agents/telemetry
git commit -m "chore: add tokenomics telemetry"
```

Add only the paths that exist for your hosts. Teammates who clone with `--recurse-submodules` are ready. Anyone else
runs `git submodule update --init .agents/telemetry` once. Each teammate needs Node on the `PATH` their host uses,
and with user-level Copilot hooks, runs step 2 for `copilot-cli` (or `setup`) once on their machine.

## Work-item trackers

`setup` can tie spend to the tickets and merged PRs of the tracker your team already uses. Nothing here needs another
tool or a factory: it works on a legacy project with only git history and a ledger.

**What setup writes.** On a project with no settings file yet, `setup` writes `ids.rules` (the id patterns for the
tracker it detected from the `origin` remote and the last 300 commits and branches, or the one you named with
`--tracker`). When it can name a receipts tracker (Jira if detected, else Azure DevOps, else GitHub, or the one you
chose), it also writes `tracker` (`{kind, url?, project?}`) and `receipts.command`, which runs the matching adapter from
the installed copy, for example `["node", ".claude/skills/tokenomics/adapters/jira.mjs"]` (`jira.mjs`, `github.mjs`
or `azure-devops.mjs`; `.github/skills/...` for a Copilot-only project). Setup never edits an existing settings file:
it prints the JSON to add and the `node <copy>/scripts/install-hooks.mjs --update-manifest` command, and labels what
it found "detected (not applied)". These keys do not change the module manifest. When the adapter still needs
something, setup says so: `receipts from jira still need: the tracker url (--tracker-url https://…) …; JIRA_EMAIL,
JIRA_API_TOKEN in the environment`. Jira always needs a url; Azure DevOps needs one unless `origin` is an Azure DevOps
remote; GitHub needs none.

```sh
npx github:silver-snoopy/harness-telemetry setup --tracker jira --tracker-url https://acme.atlassian.net --tracker-keys PAY,WEB
```

**Credentials.** Adapters read them from the environment or the CLI's own login only, never from settings, and never
pass them in a command line.

| Tracker | Credentials | Sent to |
|---|---|---|
| GitHub | `gh auth login` (the adapter calls `gh api graphql`) | GitHub, through `gh` |
| Azure DevOps | `AZURE_DEVOPS_EXT_PAT`, or else `az login` | `dev.azure.com` and `*.visualstudio.com` only |
| Jira Cloud | `JIRA_EMAIL` and `JIRA_API_TOKEN` | `*.atlassian.net` only |
| Jira Server / Data Center | `JIRA_PAT` (`"server": true` in `tracker`; setup sets it for a url outside `*.atlassian.net`) | any https host |

The host restriction means a `tracker.url` that a repository controls cannot send your token elsewhere. On-premises
Azure DevOps Server is therefore not supported yet. The adapters are read-only. One deleted, moved or invisible id never
fails a whole request: Azure DevOps batches ask with `errorPolicy: 'Omit'`, Jira Cloud uses the bulk fetch endpoint
(`/rest/api/3/issue/bulkfetch`, 100 keys per call) and Jira Server / Data Center searches with `validateQuery: 'warn'`.
Such an id is reported missing and the receipts are marked incomplete. When an adapter fails, `delivery-report` shows
its one failure line, for example `tracker: unavailable (command failed: exit 2 — jira: config (url))`.

**`delivery-report`.** Cost per ticket and per merged PR, from the ledger and the local git history:

```sh
node .claude/skills/tokenomics/scripts/delivery-report.mjs [repo] [--since D] [--until D] [--prs auto|gh|az|none] [--receipts] [--json] [--out F]
```

- Merged work is read from the first-parent history of the default branch (a local ref that is never fetched; the
  report prints `base: <ref> (local, not fetched)` and `shallow history` when it applies). `--prs` adds merged-PR data
  from `gh` or `az` (`auto` picks by the remote); `none` is git only.
- `--receipts` runs the configured receipt command and adds the tracker's status per ticket, the cost per delivered
  ticket, and tables by type and sprint. Without `--receipts` the receipt adapter never runs; `--prs auto` (the
  default) and `--prs gh|az` still ask `gh` or `az` for merged PRs, and `--prs none` keeps the report to local git.
- Ids recorded before the rules existed are read through them: an old ledger line's raw `PAY-1` counts as `jira:PAY-1`
  when the rules turn it into exactly that one id, and a line naming both is one ticket. The ledger itself is never
  rewritten, and without rules ids are used as written.
- A merge marker's PR number is not a ticket: `Merge pull request #12 from …`, a trailing `(#12)` and `Merged PR 12:`
  are cut from the subject before ids are mined from it. A PR whose head branch has the base's name (a fork's `main`)
  never takes the base branch's sessions by branch.

**How cost is shared.** A session that touches several tickets splits its cost, active minutes and tokens evenly among
them (one third each for three tickets); sessions touching one ticket count in full. Only priced lines (a numeric
`costUsd`, including a measured 0) add dollars; the rest are counted as tokens-only. A session's spend belongs to the
merge that shipped it, even when that merge is after `--until` (the window filters sessions, not merges). Follow-up work
after a merge does not belong to it. A session with no merge yet, on a feature branch or naming tickets, shows as in
progress; only work on the default branch that names no ticket is unattributed. Both views (by ticket, by PR) add up to
the same total.

**Privacy.** No branch names, titles, descriptions, people, comments or URLs appear in any output. Branches are used
only to join sessions to merges. Adapters project each ticket onto a fixed set of fields (id, outcome, date, type,
points, sprint name).

**Known limits.**
- A reverted PR still counts as merged; a squash commit ending in `(#N)` that was not a PR is counted.
- A rebase merge with no PR data from `gh` or `az` is invisible.
- A session joins by its single recorded branch (Claude's last branch, Copilot's start context).
- GitHub: only an issue closed as completed counts as delivered; an older issue closed before GitHub recorded a reason
  shows as `closed-unspecified` (add it to `receipts.deliveredOutcomes` if you want it counted).
- Jira: an unfinished ticket's outcome is its status category (`new` or `indeterminate`), not its status name.
- Azure DevOps: `Resolved` is not delivered by default; set `doneStates` in `tracker` to change it.
- The cost per delivered ticket is a membership metric over split shares, not the spec's §5.5 ratio.

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
  A Copilot session lands in the ledger a few seconds after it ends.
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

- **Upgrade.** Re-run `setup`, using the newer package (pull your clone, or the npx command fetches the latest).
  It upgrades each engine copy and re-runs activation. A copy you changed locally is refused, never overwritten. By
  hand: copy every target (step 1), then re-run step 2. Until step 2 runs, the new copy is **inert**: its hooks exit 0
  and do nothing, and the next sweep captures the sessions it missed.
- **Remove the Copilot user-level hooks.** `node <skill>/scripts/install-hooks.mjs --remove --host copilot-cli --user-hooks`.
  They serve every repository on the machine, so they go only when named.
- **Remove the git hook.** `node <skill>/scripts/install-hooks.mjs --git-hook --remove`. Any original
  `post-commit` hook is restored byte for byte.
- **Roll back.** Every activation leaves the tag `pre-engine-<version>` and a verified bundle under
  `$(git rev-parse --git-common-dir)/tokenomics/`. Those hold the store and the settings and host files as they were.

## Project structure

```
harness-telemetry/
├── bin/harness-telemetry.mjs   CLI: setup, install, check, aggregate, replay
├── bin/setup.mjs               the one-command setup (detect hosts, copy, activate, doctor, commit)
├── tokenomics/                 the installable skill — the only part copied into a project
│   ├── SKILL.md                operator reference (commands, activation, states)
│   ├── ENGINE.json             engine version + hash baseline of every installed file
│   ├── engine/                 capture, sweep, scope, join, config, activation, substrate, checkpoint, probe
│   ├── hooks/                  host hook entry points (telemetry-capture, scope-hook, otel-sink, copilot-user-hook)
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
