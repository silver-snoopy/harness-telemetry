---
name: tokenomics
description: Measures what agent sessions cost and what they deliver. Installs a self-contained telemetry engine into a repository, records per-session token and cost lines, scopes work to outcomes, and reports cost per delivered outcome. Copying it in never turns it on; activation is a separate, explicit step.
---

# tokenomics

Tokenomics records what each agent session in this repository costs (tokens, dollars, active minutes), ties the spend
to declared work scopes and outcomes, and reports cost per delivered outcome. The record lives in the repository
under `.agents/telemetry/`, in a verified, versioned store.

## Commands

These are the published commands, exactly as the B3 gate test runs them (`scripts/b3-gate.test.mjs` substitutes only
`<package>` (the package that carries this skill), `<skill>` (the installed copy, `.claude/skills/tokenomics` or
`.github/skills/tokenomics` in the repository) and `<host>` (`claude` or `copilot-cli`)). Run them from the repository
root, in order:

<!-- b3-commands:begin -->
```
node <package>/bin/harness-telemetry.mjs install tokenomics --target <host>
node <skill>/scripts/install-hooks.mjs --host <host> --git-hook
node <skill>/scripts/doctor.mjs
node <skill>/scripts/doctor.mjs --probe --host <host>
```
<!-- b3-commands:end -->

Each is described below.

1. **Copy.** Install the engine files into the repository.

   `node <package>/bin/harness-telemetry.mjs install tokenomics --target <claude|copilot>` (`copilot-cli` is accepted
   for `copilot`)

   This copies the engine and marks the copy with where it came from. It changes no host settings and starts no hook.
   Copying never activates. `--force` replaces whatever directory is at the destination, including one that is not an
   engine copy, so check what is there first. A missing value after `--repo` is a usage error (exit 2).
   An upgrade copy swaps the directory in place; its temporary siblings are dot-prefixed (`.tokenomics.tmp-*`), so a
   crashed upgrade leaves nothing that looks like a second skill, and the next copy clears them. `.DS_Store` files are
   ignored when the copy is compared with its manifest.

2. **Activate.** From the installed copy, wire the hooks and write the activation record.

   `node <installed copy>/scripts/install-hooks.mjs --host <claude|copilot-cli|vscode>`

   `--host` is required (`copilot` is accepted for `copilot-cli`). Add `--git-hook` to install the post-commit
   fallback in the same run (see "Git fallback"). For Copilot CLI add `--user-hooks` to wire it at user level (see
   "Copilot CLI user-level hooks"); `harness-telemetry setup` does that by default. See **Activation** below for what it does, in
   order. Re-running it on an active repository that needs no change writes nothing and reports `already active`; if
   the re-run had to write something (a missing hook, a store file), the line reads
   `activated ... (was active; this run updated: ...)` and names it.

3. **Check.** Confirm the engine is live.

   `node <installed copy>/scripts/doctor.mjs [--repo <dir>] [--json]` prints one `ok` / `warn` / `fail` line per check
   and exits 1 on any `fail`. It reads only and never writes. (`install-hooks.mjs --doctor` is an alias.) The checks
   that fail:

   - `integrity`: every installed copy matches its own `ENGINE.json`; a changed, missing or unexpected file fails.
   - `activation`: an `inert` or `refused` copy fails, with the remedy.
   - `substrate`: the `telemetry` submodule (or the recorded plain folder) verifies through git.
   - `settings`: `settings.json` loads, `module.json` is valid, and `manifests/<revision>.json` exists.
   - `targets`: each recorded host has its hooks wired to an installed copy of the activated version, and the Stop
     gate is wired exactly when `enforcement.stopGate` is `on`.
   - `claims`: an unreadable `.claim` file under the scopes fails (a claim older than 10 minutes warns).
   - `switches`: `TOKENOMICS_MIGRATIONS` set (an empty or whitespace-only value counts as unset) fails for an
     installed copy. The other checks still run when it is set; they judge the settings as if it were not.

   A listed engine file that cannot be read (a dangling link, for example) is a named `integrity` failure
   (`<path>: unreadable (dangling link)`); the remaining files and copies are still checked. `--fix` starts the otel
   sink for this repository only.

   Everything the old `--doctor` flagged stays, as a `warn`.
4. **Probe.** Confirm that the hooks fire in a real host session.

   `node <installed copy>/scripts/doctor.mjs --probe [--host <claude|copilot-cli|vscode>] [--timeout <s>] [--json]`
   runs one short, isolated session per host. It covers each host in `settings.targets`, or the one named by `--host`.
   - **The session.** The host CLI runs as `claude -p <prompt> --model haiku` or `copilot -p <prompt>`. The prompt
     asks the model to declare a scope and dispatch one sub-agent.
   - **Isolation.** All of the session's telemetry goes to a temporary state directory (`TOKENOMICS_STATE_DIR`), with
     sync and metering off, so the repo's store is never touched. The host still keeps its own transcript of the
     session, but a later sweep of the repo never captures it: capture skips any session whose first prompt is the
     probe's.
   - **Reporting.** Each hook records that it fired before doing anything else, with the host's event name and the
     session id when the host passes them. The probe reports each wired event as `fired` or `not-fired`, or as
     `unattributed` when the event is not named and the hook it runs also serves another event. The Copilot hook
     file names each event itself; an older one reads its sessionEnd `unattributed` until you re-run the Activate
     command. The probe checks the expected
     result (the probe session's own ledger line and its scope stamp) separately. A hook that fires and then fails
     therefore reads `fired` with the result `missing`, which is not success.
   - **Results.** One line per host:
     - `fired` (ok);
     - `not-fired` (fail);
     - `partial`, meaning `sweep-only (partial)`: no session-end hook fired, but the git post-commit sweep captured
       the session (warn);
     - `unavailable` (warn), when the CLI is not found, login failed, or the folder is not trusted. VS Code is always
       `unavailable`: it has no hooks, so verify it with a real sidebar session and a sweep.
   - **Bound.** The wait is bounded (120 s by default); a hung CLI is killed and reported `not-fired`.
   - **Recursion.** A probe never starts another probe: inside a probe session, `--probe` exits 2.

## Work-item trackers: delivery-report and the adapters

`scripts/delivery-report.mjs [repo] [--since D] [--until D] [--prs auto|gh|az|none] [--receipts] [--json] [--out F]`
reports cost per ticket and per merged PR. The ledger goes through the same read pipeline as `team-report` (dedup, then
the window on `endedAt`); merged work comes from the local default branch's first-parent history (`--prs` adds `gh`/`az`
data). A session touching `k` tickets gives each `1/k` of its cost, minutes and tokens; spend joins the merge that
shipped it (by branch, else by ticket id, only to merges at or after the session ended); a session with no merge yet is
in progress. `--receipts` runs `settings.receipts.command` (read-only, no shell, the §5.6 contract) and adds per-ticket
status and cost per delivered ticket (`receipts.deliveredOutcomes`). Output never contains branch names, titles or
people. Exit 2 is a usage error.

`adapters/github.mjs`, `adapters/azure-devops.mjs` and `adapters/jira.mjs` are the shipped receipt adapters (integrity
checked with the engine). Each takes `--ids <a,b>` (default: every ledger id with its prefix), `--repo <dir>`,
`--base-url <u>` (or `TOKENOMICS_TRACKER_BASE_URL`; `http:` only for loopback) and `--max-pages N`, reads
`settings.tracker` (`{kind, url?, project?, ...}`) and prints the envelope. Credentials come from the environment or the
CLI login only: `gh auth login`; `AZURE_DEVOPS_EXT_PAT` or `az login`; `JIRA_EMAIL` + `JIRA_API_TOKEN` (Cloud) or
`JIRA_PAT` (Server/DC). Azure DevOps credentials go only to `dev.azure.com` / `*.visualstudio.com`, Jira Cloud's only to
`*.atlassian.net`. A missing, deleted or invisible id never fails a request (ADO `errorPolicy: 'Omit'`, Jira Cloud
`/rest/api/3/issue/bulkfetch`, Jira Server/DC `validateQuery: false`); it is missing and the envelope says
`complete:false`. A failure is one stderr line `<adapter>: <class> (<code>)` with exit 1 (2 for bad config) and no body
or token; `delivery-report` shows that line in its tracker status. Unprefixed ledger ids are read through `ids.rules`
(a historical `PAY-1` is `jira:PAY-1`), never rewritten.
`setup --tracker` writes `tracker` and `receipts.command` into fresh settings; a project that customises an adapter
copies it to `.agents/tokenomics/glue/`.

## Activation

`scripts/install-hooks.mjs --host <claude|copilot-cli|vscode>` runs these steps in order. If a step fails, the run
stops with a nonzero exit and the activation record is not written, so the hooks stay inert. Fix the cause and
re-run it.

1. **Host.** A missing or unknown `--host` is a usage error (exit 2) that lists the targets.
2. **Settings.** `.agents/tokenomics/settings.json` is loaded, or created with `engine: null`, `dir: "tokenomics"`
   (`--dir <name>` overrides it), `extension: null`, `enforcement: {announce: true, stopGate: "off"}`, `targets: []`
   and the default receipt settings. In an existing file only `engine`, `targets`, `substrate.form` and the missing
   `enforcement` keys are written, and that merge is written after step 4, so the checkpoint holds the file as the
   operator left it.

   An existing store keeps its module folder. If no settings file exists yet, `dir` becomes the folder under
   `.agents/telemetry/` that already holds a `usage-*.jsonl` ledger. When several folders hold one, `automation/`
   is preferred; with several and no `automation/`, activation asks for `--dir`. The output says which folder was
   chosen and why.

   A store that is not checked out yet (cloned without `--recurse-submodules`) is read from its `telemetry` branch
   history instead.
3. **Substrate.** The `telemetry` branch submodule at `.agents/telemetry` is created or verified. The plain-folder
   form is used only with `--plain-folder` after the submodule form fails. The form is recorded in
   `substrate.form`. No git repository stops activation.
   - A clone made without `--recurse-submodules` gets a local `telemetry` branch tracking `origin/telemetry` (never
     rewinding history) before verification.
   - Interim telemetry from a plain folder is restored file by file. A file that differs from the branch's copy and
     does not simply extend it is a conflict: activation stops with `interim-conflict`, naming each path, and the file
     stays in the stash until you merge it by hand. Verification also reports any file still stranded there.
   - If the conversion fails, the index entries and `.gitmodules` return to exactly what they were; nothing is reset
     to HEAD.
4. **Checkpoint.** `pre-engine-<version>`: the durable store is committed and tagged, and a verified bundle is
   written under the repository's git directory. Transient working state (`<dir>/live/**`, the scope markers, and in
   the submodule form anything the store's own ignore rules exclude) is never committed, unless the branch already
   tracks it. The settings and every host file the next steps change are named by commit, or copied when they are
   uncommitted. A main-tree file that the repository ignores, or that is named `*.local.json`, is not put on the shared
   branch: it is copied under `<git-common-dir>/tokenomics/pre-engine-<version>/main-tree/` and listed as
   `localCopies` in `checkpoint.json`. A re-run reuses the tag only when its bundle verifies and the tag holds a
   checkpoint record; otherwise it is refused as `checkpoint-foreign-tag`. A failed checkpoint removes the half-written
   record.
5. **Module manifest.** `<store>/<dir>/module.json` and `manifests/1.json` are written once. A later difference from
   settings is reported and never rewritten; `install-hooks.mjs --update-manifest` writes the next revision.
6. **Host hooks.** These are wired to this installed copy (with `--user-hooks`, Copilot CLI through the user-level
   dispatcher instead, and this repository's `.github/hooks/tokenomics.json` is removed). The Stop gate is wired only when
   `enforcement.stopGate` is `"on"`. It is installed off; set it on and re-run to wire it.
7. **Ignore lines.** These keep the transient working state out of the main tree. An existing store's inner
   `.gitignore` also gets the working-state patterns (scope markers, `live/`) appended if they are missing, and the
   change rides in the store commit below.
8. **`--git-hook`** (optional, additive). This installs the post-commit fallback; see "Git fallback" below.
9. **Activation record.** `engine` is set to this copy's version, and the host is added to `targets`. This is
   written last, followed by one local commit in the store (`tokenomics: activate <version>`) of `module.json`,
   `manifests/` and `config.json`, so the store is clean. It is never pushed.

   `--git-hook` is refused up front (`backup-exists`) when a `post-commit.pre-tokenomics` backup already exists, before
   anything is written.

### After activation

Commit what teammates need: the installed copy (`.claude/skills/tokenomics` or `.github/skills/tokenomics`),
`.agents/tokenomics/settings.json`, the host config (`.claude/settings.json` or `.github/hooks/tokenomics.json`),
`.gitignore`, `.gitmodules` and the `.agents/telemetry` pointer.

Upgrade: copy every target first, then re-run Activate. Activation records the new `engine` for every target, so a
copy left on the old version becomes inert.

After an upgrade copy, the new version is inert until activation is re-run. Sessions it missed stay in the host's
store, and the next sweep captures them.

## Copilot CLI user-level hooks

`install-hooks.mjs --host copilot-cli --user-hooks` installs `<COPILOT_HOME|~/.copilot>/hooks/tokenomics.json` and the
dispatcher `hooks/tokenomics/dispatch.mjs` beside it, instead of the repository's `.github/hooks/tokenomics.json`.
In the readiness trial, Copilot CLI 1.0.96 ran user-level hooks in every session and never ran a repository's.

- **What the dispatcher runs.** For each hook it resolves the session's repository: `git rev-parse --show-toplevel`
  from the hook's directory, else the primary worktree. It then runs that repository's installed copy (the one
  matching the activation record), with Copilot's payload, output and environment.
- **Repositories it ignores.** A repository that has not activated `copilot-cli` is left alone: exit 0, no output.
- **The Stop gate.** It runs only where `enforcement.stopGate` is `"on"`.
- **Session end.** Copilot runs `sessionEnd` hooks before it writes the session's final usage and `session.shutdown`.
  So after the immediate capture, a detached waiter sweeps the session once its `events.jsonl` records the shutdown,
  within 60 s. Copilot is never kept waiting.
- **One wiring per machine.** One file serves every repository, so each teammate wires it once on their machine
  (`setup` does). `doctor` accepts either wiring and warns when both exist (`copilot-hooks`).
- **Removal.** `--remove --host copilot-cli` keeps the user-level files; `--remove --host copilot-cli --user-hooks`
  removes them.

## Git fallback

`install-hooks.mjs --host <h> --git-hook` adds a post-commit hook as step 8. `install-hooks.mjs --git-hook` on an
active install adds only that hook, and `--git-hook --remove` takes it out again.

- The hook goes where git actually runs hooks: `git rev-parse --git-path hooks`, so `core.hooksPath` and linked
  worktrees are honoured.
- The hook holds no repository path. When it runs it finds the committing checkout with
  `git rev-parse --show-toplevel` and uses that checkout's installed copy (`.claude/skills/tokenomics` or
  `.github/skills/tokenomics`; when both exist, the one matching the activation record). Moving or cloning the repository
  needs no reinstall, and one shared hooks directory serves every linked worktree. A linked worktree without its own
  copy falls back to the primary worktree's; with no copy anywhere the hook writes a line to
  `<git-dir>/tokenomics-post-commit.log` and does nothing else.
- An existing `post-commit` is moved to `post-commit.pre-tokenomics` and chained. It runs first, and its exit status
  stays the hook's exit status. A non-executable one is chained but still not run, because git would not have run it;
  the install report says so.
- The sweep starts detached after that, so it never delays or fails a commit. `--remove` restores the original hook
  byte for byte.
- Limitation: a session that ends after the last commit is captured only by a later sweep (the next session-start
  sweep, or the next commit).

## Activation states

- `source`: the engine is not an installed copy (the package checkout itself). No gate applies.
- `active`: an installed copy whose repository activation record names the same engine version. Hooks run.
- `inert`: an installed copy whose activation is missing or names another version, for example after an interrupted
  upgrade. Hooks exit 0 without writing, print one line naming the cause and the remedy, and `doctor` reports a
  failure. Re-run the Activate command (`install-hooks.mjs --host <host>`).
- `refused`: an installed copy running with the `TOKENOMICS_MIGRATIONS` variable set. That variable is a test lever,
  not a production switch; unset it.

A hook never fails the host session: inert and refused hooks exit 0.

The report CLIs are gated too. Run from an installed copy, `batch-cost` (unless `--stdout`), `build-tokenomics-export`
(every mode but `--compare`), and `team-report` (with `--batch` or `--out`) check the state first; `otel-report` writes nothing, so it only
refuses the switch. An `inert` copy exits 1 with the one-line reason and writes nothing; a `refused` copy exits 1 with the switch message. The
package checkout stays ungated. An `ENGINE.json` that is present but unreadable counts as an installed copy, so the
switch is refused there too; only an absent one reads as a source checkout.
