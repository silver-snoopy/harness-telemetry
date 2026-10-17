# Plan 7: work-item trackers (Azure DevOps, GitHub, Jira) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 2 (2026-10-17).** This revision folds in the adversarial review `docs/reviews/plan-7-codex-review.md`
(P7-01 … P7-18) and one gap the review missed: branch rules that match dates. The owner decided three things on
2026-10-17:
- **Allocation.** A session's cost is split evenly across its tickets, and separately across its PRs.
- **Branch names.** They are never printed.
- **Priced.** "Priced" means exactly what team-report counts as priced.

**Goal:** Any project, whatever its tracker (Azure DevOps, GitHub Issues, Jira), gets agent spend attributed to work
items and to what shipped. That means cost per ticket, cost per merged PR, and cost per delivered ticket by type and
sprint. It needs no credentials for the first two, and one read-only adapter for the third.

**Architecture:** The work has three layers, and only the last one knows the tracker.

1. **Identify.** The id miner gains per-pattern rules that normalise ids (`ids.rules`). Ids then carry a tracker
   prefix: `jira:PAY-123`, `gh:42`, `ado:12345`. There are tracker presets for these rules, and
   `harness-telemetry setup` infers the tracker from the remote and the git history.
2. **Delivered.** A read-only delivery join (`engine/delivery.mjs`) derives merged work from git, optionally enriched
   with PR metadata from `gh` or `az`, and splits each ledger line's cost across tickets and across PRs so that the
   cost is conserved. A new `delivery-report.mjs` prints the result. Nothing new is stored: the report is recomputed
   from git and the ledger on every run.
3. **Enrich.** There are three read-only receipt adapters (`tokenomics/adapters/{github,azure-devops,jira}.mjs`).
   Each follows the spec §5.6 receipt-command contract. `setup --tracker …` wires one into
   `settings.receipts.command`. `delivery-report --receipts` runs it and merges each ticket's status, type, points
   and sprint.

**Tech Stack:** Node ≥ 18.19, stdlib only (global `fetch` for REST, `gh`/`az` CLIs where present), `node:test`.

**Spec:** `docs/spec.md`:
- §5.6, the receipt command contract;
- §14.4, ids;
- §14.5, glue and receipt adapters;
- §11, delivery-monitor. Only the slim, git-derived join is built here; the full port stays parked.

The review `docs/reviews/plan-7-codex-review.md` travels with this plan. Implementers read the findings their task
cites.

## Owner decisions (2026-10-17)
- All three trackers are in scope.
- Standalone use on legacy projects comes first. Nothing may require sdlc-skills or a factory.
- **D-ALLOC: split evenly** (P7-01). Cost is split the way batch-cost already splits a combined slot
  (`tokenomics/scripts/batch-cost.mjs:297`, `share`).
- **D-PRIVACY: no branch names in any output** (P7-12). Branches are used internally for joining only.
- **D-PRICED: a line is priced when `typeof line.costUsd === 'number'`** (P7-17), exactly as team-report counts it
  (`team-report.mjs:398`). Every other line is tokens-only. A measured `0` is priced, and `null` or missing is not.

## Fixed design decisions

**D-RULES (ids; P7-02, P7-03, P7-15).** `settings.ids` gains an optional `rules` array. Each rule looks like:

```json
{ "tracker": "jira", "pattern": "\\b(PAY|WEB)-(\\d+)\\b(?!-\\d)", "flags": "", "normalize": "jira:$1-$2", "source": "any" }
```

1. **Inert when absent.** When `rules` is absent or `[]`, `mineIds` runs today's code path unchanged: the same loop
   order, the same early return at `max`, and the same output. Every caller passes the same texts as today. The
   TA/B1 defaults stay unchanged, and `diff-impl` reports differing 0.
2. **Validation at load, never in a hook.** `rules` must be an array. Each rule is checked as follows:
   - `pattern` is a string that compiles with `flags + 'g'`;
   - `flags` is a string without `g`, as `ids.flags` is;
   - `normalize` is required, matches `^[a-z][a-z0-9]*:`, and uses only the placeholders `$1`–`$9`. `$0`, `$10` or
     more, and a group number above the pattern's capture count are errors. Count the groups with
     `new RegExp(src + '|').exec('').length - 1`;
   - `source` is `'any'` (the default) or `'branch'`.

   Errors name the rule's index.
3. **Mining with rules (only when rules is non-empty).** For each text, in caller order:
   - **(a) Pass-through.** A text that is a whole already-normalised id is kept verbatim and not mined again. Such a
     text matches `^(<prefix>):\S+$`, where the prefixes come from the rules' `normalize`. This lets Claude's second
     mining pass (`telemetry-capture.mjs:850`, which mines its own mined ids) keep `gh:42` and `jira:PAY-12`.
   - **(b) Rules.** The `source:'any'` rules run on the text, and the `source:'branch'` rules run only on
     `opts.branch`. The stoplist applies to the raw match's `split('-')[0]`. Each match records its `[start, end)`
     span in that text.
   - **(c) Legacy patterns.** These run as before, but a legacy match that overlaps a rule match's span in the same
     text is dropped. So `PAY-12` never appears next to `jira:PAY-12`.
   - **(d) The cap.** `max` caps the union. Rule ids and pass-through ids are added before legacy ids from the same
     text, so legacy matches can't use up the cap first.
4. **Substitution.** `normalize.replace(/\$([1-9])/g, (_, i) => m[+i] ?? '')`. A rule whose substitution leaves an
   empty group produces no id.
5. **Not done here.** The spec's top-level `ids.normalize` and `ids.mineFrom` (§14.4) stay unimplemented (P7-16).
   They're still silently ignored as today, and Task 8 marks them in the spec as superseded by `ids.rules`.
   Ids already recorded in the ledger are never rewritten: a ledger written before the rules keeps raw `PAY-12`, and
   the delivery join treats `PAY-12` and `jira:PAY-12` as different ids, as spec §5 exact equality requires. The
   README says so.

**D-PRESETS (P7-14 and the date gap).** `engine/trackers.mjs` exports `PRESETS` and
`presetRules(tracker, {keys?, branchRule?})`.

| Preset | Rules | Notes |
|---|---|---|
| `jira({keys})` | `\b(K1\|K2)-(\d+)\b(?!-\d)` → `jira:$1-$2` | Keys must match `^[A-Z][A-Z0-9]+$`; anything else throws, naming the key. There is never a catch-all pattern. |
| `github({branchRule})` | `(?<![A-Za-z0-9&])#(\d+)\b` → `gh:$1`; `\bGH-(\d+)\b` → `gh:$1`; with `branchRule`, branch-only `(?:^\|/)(\d+)-(?=[A-Za-z])` → `gh:$1` | The lookbehind rejects `abc#42`, `AB#42` and `&#42`. |
| `ado({branchRule})` | `(?<![A-Za-z0-9])AB#(\d+)\b` → `ado:$1`; with `branchRule`, branch-only `(?:^\|/)(\d{3,7})-(?=[A-Za-z])` → `ado:$1` | |

- **The date gap.** The `(?=[A-Za-z])` after the dash means `release/2024-10`, `hotfix/2026-01-x` and `v2-3` yield no
  id, while `feat/57-login` does.
- **One numeric branch rule.** At most one of the github or ado branch rules is ever active: the one matching the
  remote's host. So `feat/12345-login` never yields both `gh:12345` and `ado:12345`.
- **Known limitation.** A hex colour such as `#123456` written after a space still mines as `gh:123456`. It's
  documented, not fixed.

**D-DETECT (P7-14).** `detectTrackers(repo, {env}) → {trackers: [{tracker, why, keys?}], host: 'github'|'ado'|null, receipts: tracker|null}`.

1. **The remote.** Parse `git remote get-url origin` exactly, in both the https and the ssh forms.
   - `github.com`, `git@github.com:o/r` and `ssh://git@github.com/o/r` give host github.
   - `dev.azure.com`, `ssh.dev.azure.com`, `<org>.visualstudio.com` and `vs-ssh.visualstudio.com` give host ado.
   - A look-alike such as `github.com.evil.io` gives no host.
2. **The sample.** The sample is the last 300 commits, read with `git log -n 300 --format=%s%n%b%x1e` and split on
   `\x1e`. Each commit is one document. Branch names are added as one document each, deduplicated after stripping
   `origin/` (`git for-each-ref --format=%(refname:short) refs/heads refs/remotes`, skipping `origin/HEAD`). Counts
   are document frequencies: a key mentioned twice in one commit counts once.
3. **The rules:**
   - **jira:** a prefix matching `[A-Z][A-Z0-9]+` (from `\b([A-Z][A-Z0-9]+)-\d+\b`) that isn't in the stoplist,
     present in ≥ 5 documents and in ≥ 10% of documents. The keys are every prefix meeting that bar, sorted by
     frequency.
   - **ado:** `(?<![A-Za-z0-9])AB#\d+` in ≥ 3 documents, or host ado.
   - **github:** host github and `(?<![A-Za-z0-9&])#\d+` in ≥ 3 documents (`AB#N` excluded), or host github alone.
     Every repo hosted on GitHub has PRs, so the PR rules apply.
4. **The receipts tracker,** when more than one is detected: jira, else ado, else github. An issue tracker that isn't
   the code host wins. Explicit `--tracker` always wins.

**D-SETTINGS-WRITE (P7-04, P7-18).** Setup copies the engine first. Before activation, if no
`.agents/tokenomics/settings.json` exists and rules exist, it imports `defaultDir` and `freshSettings` from the
**installed copy** (`join(repo, COPY_OF[targets[0]], 'scripts', 'install-hooks.mjs')`), never from the package. It
then writes `{...freshSettings({dir: defaultDir(repo).dir}), ids: {...fresh.ids, rules}}`, plus
`tracker`/`receipts.command` when Task 8 applies. So a legacy repo that has an `automation/` store keeps it.

When the file already exists, setup never edits it. It prints the JSON to add and the command
`node <copy>/scripts/install-hooks.mjs --update-manifest`.

**D-DELIVERY (git-derived, read-only; P7-05, P7-06).**

- **The base.** `defaultBranch(repo)` is the target of `git symbolic-ref refs/remotes/origin/HEAD`, else local
  `main`, else `master`. It's a local ref that is never fetched. The report prints
  `base: <ref> (local, not fetched)`, and `shallow history` when `git rev-parse --is-shallow-repository` says true.
- **Merged work.** `git log --first-parent <base> --format=%H%x1f%cI%x1f%P%x1f%s%x1f%b%x1e`:

  | Regex | Needs | Gives |
  |---|---|---|
  | `MERGE_PR = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/` | ≥ 2 parents | pr, branch |
  | `MERGE_BRANCH = /^Merge branch '([^']+)'/` | ≥ 2 parents | branch |
  | `ADO = /^Merged PR (\d+):/` | any | pr |
  | `SQUASH = /\(#(\d+)\)\s*$/` | 1 parent | pr |

  Other commits are skipped. Each item is `{commit, at, pr, branch, ids, source: 'git'}`, with ids from
  `mineIds(settings, [branch, subject, body].filter(Boolean), {branch})`.
- **Enrichment (`--prs auto|gh|az|none`; auto chooses gh on a GitHub host and az on an ADO host).** The repo identity
  is resolved once from the origin, and both CLIs get explicit selectors:
  - `gh pr list --repo <owner/repo> --base <baseName> --state merged --limit 2000 --json number,headRefName,mergedAt,mergeCommit`.
    No titles are requested. When the result has 2000 rows, coverage is `partial (limit 2000)`.
  - `az repos pr list --organization <url> --project <p> --repository <r> --target-branch refs/heads/<baseName> --status completed --top 500 --skip <n> -o json`,
    looping until a page has fewer than 500 rows. More than 10 pages makes the run `partial`.
  - PRs are mapped by number within that one repo. A git item gets `branch` filled in from its PR.
  - A CLI PR whose `mergeCommit` is reachable from the base (`git merge-base --is-ancestor`), but which no git item
    names, is added with `source: 'cli'`. This covers rebase merges.
  - The result is `{items, prs: 'gh'|'az'|'git-only', coverage: 'complete'|'partial (<why>)', reason?}`. When the
    CLI is absent or fails, `prs` is `'git-only'` and `reason` says why.
- **Known limits, printed in the report's notes:**
  - a reverted PR still counts as merged;
  - a squash commit with `(#N)` that wasn't a PR is counted;
  - a git-only rebase merge is invisible;
  - a session is joined by its single recorded branch (Claude's last `gitBranch`, Copilot's start context).

**D-JOIN (P7-01, P7-07; owner D-ALLOC).**
`joinDelivery(lines, items) → {tickets, prs, unattributed, unmerged, totals, trace}`. The input lines have already
been through dedup and the window (Task 4).

- **Tickets.** A line's tickets are `line.cases` (or else `line.scope?.cases`), deduplicated. With `k` tickets, each
  gets `share = 1/k` of the line's cost, active minutes and tokens. With `k = 0`, the whole line goes to
  `unattributed.tickets`.
- **PRs.** A line's PRs are found as follows:
  1. **By branch.** These are the items whose `branch === line.branch`. When several PRs reused that branch, the line
     goes to the first PR, ordered by `at`, whose `at ≥ line.endedAt`. Spend before a merge belongs to that merge.
     When the line ended after the last such merge, it goes to `unmerged` (in progress).
  2. **Else by id.** These are the items whose `ids` intersect the line's tickets, which covers branchless squash
     merges. With `n` such items, each gets `1/n`.
  3. **Else** the whole line goes to `unattributed.prs`.
- **Row shape.** A ticket row is
  `{sessions, shared, costUsd, priced, tokensOnly, activeMin, firstAt, lastAt, prs[], mergedAt}`, and a PR row is
  `{pr, mergedAt, ids[], sessions, shared, costUsd, priced, tokensOnly, activeMin}`.
  - `sessions` counts the lines that touch the row, and `shared` counts those with a share below 1.
  - `costUsd` sums `share × costUsd` over priced lines only (D-PRICED). `priced` and `tokensOnly` count lines.
  - A PR row has no branch field (D-PRIVACY).
- **Conservation.** `totals` is computed from the lines once:
  `{sessions, costUsd, priced, tokensOnly, activeMin, mergedPrs, ticketsWithSpend}`. The trace must hold to 1e-9 for
  both views: `Σ ticket.costUsd + unattributed.tickets.costUsd === totals.costUsd`, and
  `Σ pr.costUsd + unmerged.costUsd + unattributed.prs.costUsd === totals.costUsd`.
- **Ticket state.** `mergedAt` is the earliest `at` of the items naming the ticket, or `null`, which means in
  progress. A ticket that has spend but no merge is never dropped.

**D-RECEIPTS (P7-08).** `runReceiptCommand(repo, settings, {env}) → {available, complete, receipts, findings, reason}`
is extracted from `readReceipts`. It keeps today's spawn settings unchanged: `spawnSync` with `shell:false`,
`cwd: repo`, `settings.receipts.timeoutSec ?? 60`, `MAX_OUT`, the schema validation, and child stderr never
forwarded. `env` is passed through, and `readReceipts` passes `process.env`, so its behaviour and its return shape
stay byte for byte as they are.

- **`reason`** is one of `not configured`, `command failed: exit N`, `command failed: <error>`,
  `malformed output: <path> <msg>`, or `null`.
- **`complete`** is `doc.complete === true`.

delivery-report reads the receipts this way:
- **Flattening.** It flattens them into rows `{id, outcome, at, revision?, group, source, type, points, sprint}`, and
  takes each id's winner with the existing `receiptWinners` (`team-report.mjs:250`, spec §5.2 ordering, with
  conflicts excluded).
- **Delivered tickets.** A ticket is delivered when its winning outcome is in `settings.receipts.deliveredOutcomes`.
  An id with no row is `unknown`, never not-done.
- **The metric.** "Cost per delivered ticket" is Σ costUsd of delivered tickets ÷ their count. It's labelled
  *membership metric (split shares), not the §5.5 ratio* and shown only when receipts are available. When
  `complete` is false, it's suffixed `(partial: adapter reported complete:false)`.
- **Tables by type and by sprint** (delivered count and costUsd) appear only with `--receipts`.

**D-ADAPTERS (P7-09 … P7-12).**
- **Ids.** These come from `--ids <a,b>`, or else from every id in the repo's ledger carrying the adapter's prefix.
  Ledger loading goes through team-report's `loadLines`. Ids are validated after the exact prefix is stripped:
  - GitHub `^\d{1,9}$`;
  - ADO `^\d{1,9}$`;
  - Jira `^[A-Z][A-Z0-9]+-\d+$`.

  Invalid ids are skipped, and their count goes on stderr. When no valid id is left, the adapter prints
  `complete:true` with no receipts. It never falls back to an unbounded query.
- **Configuration** comes from `settings.tracker`: `{kind, url?, project?, fields?: {points?, sprint?}, doneStates?, server?}`.
- **Output.** The §5.6 envelope is
  `{"schema":1,"complete":bool,"receipts":[{"group":"<tracker>:<project>","source":"<tracker>","cases":[…]}]}`.
  - Each case is built from an explicit projection and nothing else:
    `{id, outcome, at?, atSource?, type?, points?, sprint?}`.
  - `type` and `sprint` are strings of at most 64 characters, from a name field only. `points` is a finite number.
  - Titles, descriptions, people, comments, URLs and raw API bodies never appear.
- **`complete:false`** when a requested valid id is missing from the answer, a page cap is hit, or the API reports it
  is truncated.
- **Failure.** No credentials, an HTTP error, a GraphQL `errors` array, a timeout or non-JSON gives exit 1 with one
  stderr line: `<adapter>: <class> (<status or code>)`. The line never carries a response body, header, URL query
  or token.
- **Credentials.** They come from env vars or the CLI's own login only, never from settings, and never in a child's
  argv:
  - an `az` token is read from captured stdout and used only in the header;
  - `common.mjs` exports `CREDENTIAL_ENV = ['AZURE_DEVOPS_EXT_PAT','JIRA_EMAIL','JIRA_API_TOKEN','JIRA_PAT']`;
  - a test checks that adapter sources read no other env names except `TOKENOMICS_TRACKER_BASE_URL`, because
    inventory only audits `TOKENOMICS_*` (P7-18).
- **Base URL.** Without an override, it must be `https:`. `--base-url` or `TOKENOMICS_TRACKER_BASE_URL` (an
  engine-owned test lever, allowlisted) may be `http:` only for `127.0.0.1`, `localhost` or `[::1]`. Anything else
  is refused with exit 2.

| Adapter | Auth | Request | Delivered | `at` / `atSource` |
|---|---|---|---|---|
| GitHub | `gh` login (`gh api graphql`) | `repository(owner,name){ i<N>: issueOrPullRequest(number:N){ __typename ... on Issue { state stateReason closedAt labels(first:20){nodes{name}} } } }`, 100 aliases per call | `__typename == 'Issue'`, `state == 'CLOSED'`, `stateReason == 'COMPLETED'` | `closedAt` / `closedAt` |
| Azure DevOps | `AZURE_DEVOPS_EXT_PAT` (Basic `:PAT`), else `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv` (Bearer) | `POST <org>/_apis/wit/workitemsbatch?api-version=7.1`, body `{ids, fields}`, 200 per request | state in `doneStates`, default `["Done","Closed","Completed"]` (no `Resolved`, P7-11) | `Microsoft.VSTS.Common.ClosedDate` / `ClosedDate`, omitted when absent |
| Jira Cloud | `JIRA_EMAIL` + `JIRA_API_TOKEN` (Basic) | `POST /rest/api/3/search/jql`, `{jql, fields, maxResults:100, nextPageToken?}`; follow `nextPageToken` until `isLast` | `fields.status.statusCategory.key == 'done'` | `fields.resolutiondate` / `resolutiondate`, omitted when null |
| Jira Server/DC (`server:true`) | `JIRA_PAT` (Bearer) | `POST /rest/api/2/search`, `{jql, fields, startAt, maxResults:100}`; loop until `startAt + issues.length ≥ total` | as Cloud | as Cloud |

- **GitHub outcomes:**
  - `Issue` CLOSED+COMPLETED gives `delivered`;
  - CLOSED with another reason gives `closed-<reason lowercased>`, for `not_planned` and `duplicate`;
  - OPEN gives `open`;
  - `PullRequest` gives `pull-request`;
  - a null node gives `missing`, and the run becomes `complete:false`.

  `type` is the first label among `bug`, `feature` and `enhancement`.
- **ADO** sets `type` from `System.WorkItemType` and `sprint` as the last segment of `System.IterationPath`.
  `points` comes from `fields.points`, defaulting to `Microsoft.VSTS.Scheduling.StoryPoints`; Scrum projects set
  `Microsoft.VSTS.Scheduling.Effort`. Any other state is reported raw.
- **Jira** sets `type` from `fields.issuetype.name`. `sprint` is the `name` of the last element of the sprint field
  array; `points` is the points field. There's no default custom-field id: both are skipped unless configured.
- **Jira pagination.** The JQL is `key in (K1,K2,…)` with validated keys only, at most 100 keys per JQL. Cloud
  replays the same JQL with the returned `nextPageToken`. The adapter stops with `complete:false` when the token
  repeats, when there's no progress, or at `--max-pages` (default 50). Results are deduplicated by key, and keys
  that weren't requested are ignored.

**D-SHIP.**
- **Where adapters live.** They ship in the engine (`tokenomics/adapters/`, integrity-checked).
  `settings.receipts.command` names the adapter in the copy setup installed:
  `["node", "<COPY_OF[targets[0]]>/adapters/<tracker>.mjs"]`.
- **Customising.** A project that customises an adapter copies it to `.agents/tokenomics/glue/` (§14.5).
- **Settings fields.** `settings.tracker` and `receipts.command` don't change the module manifest, which records
  only `receipts.source:'files'` (`engine/module-manifest.mjs:32`). Task 8 checks that with doctor.

**D-TESTKIT (P7-13).** `tokenomics/fixtures/trackers/harness.mjs` is test-only and excluded from the manifest like the
other fixtures. It provides:
- `sandboxEnv(tmp, {bin})`, a new object, never a spread of `process.env`. It holds:
  - `PATH = bin + ':' + dirname(process.execPath) + ':/usr/bin:/bin'`;
  - `HOME`, `COPILOT_HOME`, `XDG_CONFIG_HOME`, `GH_CONFIG_DIR` and `AZURE_CONFIG_DIR`, all under `tmp`;
  - `GIT_CONFIG_GLOBAL = tmp/gitconfig`, `GIT_CONFIG_NOSYSTEM = '1'`, `GH_PROMPT_DISABLED = '1'` and `NO_COLOR = '1'`.

  It never includes `GH_TOKEN`, `GITHUB_TOKEN` or real credentials. Tests that need credentials add dummy sentinel
  values such as `SENTINEL-PAT-7f3a`.
- `fakeBin(bin, name, js)`, which writes an executable `#!<process.execPath>` script. The `node` in PATH stays the
  real one, never the no-op shim in `bin/setup.test.mjs`.
- `startServer(routesModule)`, which spawns `node fixtures/trackers/server.mjs <routes>` as a **child process**, so
  the synchronous `spawnSync` receipt runner can't deadlock against an in-process server. It resolves `{url, log(),
  stop()}`; `log()` returns the requests, method, path, headers and body, read from a file the child appends to.
- `assertNoSentinels(strings[])`, which checks stdout, stderr, files written and the recorded child argv for the
  sentinels: the raw value, its base64 forms (`:PAT` and `email:token`), `PRIVATE_TITLE`, `PRIVATE_PERSON` and
  `PRIVATE_BRANCH`.

## Global constraints
- Repo `~/dev/harness-telemetry`, branch `main`. Pushes to `origin` (github.com/silver-snoopy/harness-telemetry) and
  tags happen only on the owner's word.
- Stdlib only, Node ≥ 18.19. Never stub `process.stdout`. Pass test files to `node --test` (a directory doesn't work).
- **Byte identity.** With migrations off and no `ids.rules`, `node scripts/diff-impl.mjs` reports differing 0.
  Goldens are never hand-edited, and `reference/` is never modified.
- **ENGINE.json.** Every engine file change, docs included, regenerates `tokenomics/ENGINE.json` with
  `node scripts/engine-manifest.mjs` **before** the gates run.
- **Allowlist.** New env/path sites get entries with reasons in `docs/inventory/engine-allowlist.json`. Entries are
  keyed on the line's text, so editing an allowlisted line means re-keying its entry.
- **Gates per task:** `npm test`, `node scripts/coverage.mjs`, `node scripts/inventory.mjs` and
  `node scripts/diff-impl.mjs`. At close, run the full batch, including `node scripts/migrations.mjs check`, from
  clean clones on Node 24 and 18.19. For Node 18:
  `export npm_config_cache=<scratchpad>/npmcache; N18=$(npx -y node@18.19.0 -p process.execPath)`.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, authored with the repo's
  configured identity. Check every subagent commit's trailer before moving on.
- **Hermetic tests,** through D-TESTKIT: no network, nothing beyond loopback, no real `claude`, `copilot`, `gh` or
  `az`.
- **Privacy.** No titles, descriptions, people, comments or branch names in any output. Docs carry no home paths,
  emails or org names.
- **Untouchable.** `reference/`, goldens, the raw corpus, and other repos on the machine.

## Review focus
1. **A Jira-keyed repo whose PR titles also say `#123`.** With only jira, `#123` is not an id. With a GitHub host,
   it's `gh:123`. The final ledger line holds `jira:PAY-1` and `gh:7`, never raw `PAY-1`. Tests: Task 1 (f),
   Task 2 (d).
2. **A session tagged with two tickets on a branch reused by two PRs.** Costs are conserved in both views. Test:
   Task 3 (d).
3. **A squash-merge-only repository without `gh`.** PRs come from `(#N)`, their cost joins by ticket id, and the
   report says `prs: git-only`. Test: Task 3 (b), (e).
4. **Tracker credentials missing or the tracker unreachable, or a partial envelope.** The report still prints the
   git-derived part, with `tracker: unavailable (<reason>)` or `(partial)`, never zero tickets done. Test:
   Task 4 (c).
5. **More ids than one API call takes** (250 ADO ids, 230 Jira keys, 150 GitHub numbers). Results are batched and
   complete; a capped or short-answered run says `complete:false`. Tests: Task 5 (e), Task 6 (c), Task 7 (c).
6. **Secrets and private text.** Sentinel tokens, titles, people and branch names never reach any output. Tests:
   Task 4 (e), Task 5 (f), Task 6 (f), Task 7 (f).

---

### Task 1: id rules and tracker presets (layer 1)

**Files:**
- Create `tokenomics/engine/trackers.mjs` (`PRESETS`, `presetRules`).
- Modify `tokenomics/engine/config.mjs` (validate `ids.rules`; `idRules(s)`).
- Modify `tokenomics/hooks/telemetry-capture.mjs` (`mineIds(settings, texts, opts)`).
- Tests: `tokenomics/engine/trackers.test.mjs`, additions to `tokenomics/engine/config.test.mjs` and
  `tokenomics/hooks/telemetry-capture.test.mjs`. Find the existing capture test file with
  `ls tokenomics/hooks/*.test.mjs`.

Read D-RULES, D-PRESETS, and review findings P7-02, P7-03, P7-15 and P7-16 first.

**Interfaces:**
- Produces `presetRules(tracker: 'jira'|'github'|'ado', {keys?: string[], branchRule?: boolean}) → Rule[]`.
- Produces `idRules(settings) → {rules: [{re: RegExp, normalize: string, source: 'any'|'branch'}], prefixes: Set<string>}`,
  cached per `settings.ids` in a WeakMap.
- Produces `mineIds(settings, texts, opts?: {branch?: string}) → string[]` (sorted).

- [ ] **Step 1: Write the failing tests.**
  - (a) **jira.** `mineIds` with `rules: presetRules('jira',{keys:['PAY','WEB']})` over
    `"fix PAY-12 and WEB-3, not SHA-256 or ISO-8601"` gives `['jira:PAY-12','jira:WEB-3']`, with no raw duplicates
    even though the TA legacy pattern is still present. `PAY-12-34` gives nothing.
    `presetRules('jira',{keys:['123']})` and `{keys:['pay']}` throw, naming the key.
  - (b) **github,** with `branchRule:true`:
    - `"Merge pull request #42 from o/feat"` gives `gh:42`;
    - `"abc#42"`, `"AB#42"` and `"&#42;"` give nothing;
    - branch `feat/57-login`, passed as `{branch}`, gives `gh:57`, and the same string as prompt text gives nothing
      from the branch rule;
    - branches `release/2024-10` and `hotfix/2026-01-x` give nothing.
  - (c) **ado,** with `branchRule:true`: `"AB#12345 fix"` gives `ado:12345`, and branch `users/x/23456-fix` gives
    `ado:23456`.
  - (d) **Validation.** `loadSettings` rejects each of these, with an error naming `ids.rules[<i>]`:
    - an invalid regex;
    - `flags:'g'`;
    - `normalize:'gh:$3'` on a 2-group pattern;
    - `normalize:'gh:$10'`;
    - `normalize:'$1'` (no prefix);
    - `source:'x'`.
  - (e) **Inertness.**
    - With `rules` absent and with `rules:[]`, the outputs of every existing `mineIds`/`extractCaseIds` test are
      unchanged.
    - A table of 20 mixed strings gives identical output with and without `rules:[]`.
    - With rules present and `max:2`, `"PAY-1 PAY-2 PAY-3"` gives exactly 2 `jira:` ids and no raw ids.
  - (f) **Pass-through.** A second pass, `mineIds(s, ['gh:42','jira:PAY-12'])`, gives `['gh:42','jira:PAY-12']`.
    Then through the real Claude path: a capture-test fixture whose prompt says `PAY-1 (#7)`, under settings with
    jira and github rules, writes a ledger line with `cases` `['gh:7','jira:PAY-1']`. Use the existing Claude
    capture fixture helper in the capture test file. Do the same for the Copilot CLI path (`:1125`) and the VS Code
    path (`:1283`).
- [ ] **Step 2: Run them and see them fail.**
  `node --test tokenomics/engine/trackers.test.mjs tokenomics/engine/config.test.mjs tokenomics/hooks/telemetry-capture.test.mjs`
- [ ] **Step 3: Implement `trackers.mjs`.**
  ```js
  const KEY = /^[A-Z][A-Z0-9]+$/;
  export const PRESETS = Object.freeze({
    jira: ({ keys = [] } = {}) => {
      const bad = keys.find((k) => !KEY.test(k));
      if (bad !== undefined) throw new Error(`jira key '${bad}' must match ${KEY.source}`);
      const ks = [...new Set(keys)];
      if (!ks.length) throw new Error('jira preset needs project keys (e.g. PAY, WEB)');
      return [{ tracker: 'jira', pattern: `\\b(${ks.join('|')})-(\\d+)\\b(?!-\\d)`, normalize: 'jira:$1-$2' }];
    },
    github: ({ branchRule = false } = {}) => [
      { tracker: 'github', pattern: '(?<![A-Za-z0-9&])#(\\d+)\\b', normalize: 'gh:$1' },
      { tracker: 'github', pattern: '\\bGH-(\\d+)\\b', normalize: 'gh:$1' },
      ...(branchRule ? [{ tracker: 'github', pattern: '(?:^|/)(\\d+)-(?=[A-Za-z])', normalize: 'gh:$1', source: 'branch' }] : []),
    ],
    ado: ({ branchRule = false } = {}) => [
      { tracker: 'ado', pattern: '(?<![A-Za-z0-9])AB#(\\d+)\\b', normalize: 'ado:$1' },
      ...(branchRule ? [{ tracker: 'ado', pattern: '(?:^|/)(\\d{3,7})-(?=[A-Za-z])', normalize: 'ado:$1', source: 'branch' }] : []),
    ],
  });
  export const presetRules = (tracker, opts) => { const p = PRESETS[tracker]; if (!p) throw new Error(`unknown tracker '${tracker}' (jira, github, ado)`); return p(opts); };
  ```
- [ ] **Step 4: Implement `config.mjs`.** Add the rules validation from D-RULES item 2 right after the existing
  `ids.stoplist` check, and an `idRules(s)` export. Prefixes are `normalize.match(/^([a-z][a-z0-9]*):/)[1]`.
- [ ] **Step 5: Implement `mineIds`.**
  - Keep the current body verbatim as the no-rules branch:
    `const { rules, prefixes } = idRules(settings); if (!rules.length) { …today's loop… }`.
  - With rules, add the mining from D-RULES item 3:
    ```js
    const passRe = new RegExp(`^(?:${[...prefixes].join('|')}):\\S+$`);
    const out = new Set(); const full = () => out.size >= settings.ids.max;
    const add = (id) => { out.add(id); return full(); };
    const ruleHits = (t, rs) => {
      const spans = [];
      for (const r of rs) for (const m of t.matchAll(r.re)) {
        if (stop.has(m[0].split('-')[0])) continue;
        const id = r.normalize.replace(/\$([1-9])/g, (_, i) => m[+i] ?? '');
        if (/:$|::/.test(id)) continue;
        spans.push([m.index, m.index + m[0].length, id]);
      }
      return spans;
    };
    if (typeof opts.branch === 'string' && opts.branch) {
      for (const [, , id] of ruleHits(opts.branch, rules.filter((r) => r.source === 'branch'))) if (add(id)) return [...out].sort();
    }
    for (const t of texts) {
      if (typeof t !== 'string' || !t) continue;
      if (passRe.test(t)) { if (add(t)) return [...out].sort(); continue; }
      const spans = ruleHits(t, rules.filter((r) => r.source !== 'branch'));
      for (const [, , id] of spans) if (add(id)) return [...out].sort();
      for (const re of res) for (const m of t.matchAll(re)) {
        const s = m.index, e = s + m[0].length;
        if (spans.some(([a, b]) => s < b && a < e)) continue;
        if (stop.has(m[0].split('-')[0])) continue;
        if (add(m[0])) return [...out].sort();
      }
    }
    return [...out].sort();
    ```
    Legacy patterns are compiled with `g` already (`idPatterns`), so `matchAll` works. `RegExp` objects are cached,
    and `matchAll` doesn't mutate their `lastIndex`.
  - **Call sites.** Pass `{branch}` at `:403` (`p.branch`) and at `:1125` (the Copilot branch). Leave the texts
    arrays exactly as they are; `branch` is already their first element. Don't change `:640`, `:850` or `:1283`.
- [ ] **Step 6: Run the tests and the gates.** Regenerate ENGINE.json first; `diff-impl` must report differing 0.
- [ ] **Step 7: Commit** `feat(ids): per-pattern id rules with normalize and tracker presets (jira, github, ado)`.

### Task 2: setup infers the tracker and writes the id rules (layer 1)

**Files:**
- Modify `tokenomics/engine/trackers.mjs` (`parseRemote`, `detectTrackers`).
- Modify `bin/setup.mjs` (`--tracker`, `--tracker-keys`, `--no-tracker`, and the settings write after the copy step,
  before activation).
- Tests: `tokenomics/engine/trackers.test.mjs` and `bin/setup.test.mjs`.

Read D-DETECT, D-SETTINGS-WRITE, and review findings P7-04, P7-14 and P7-18 first.

**Interfaces:**
- Produces `parseRemote(url) → {host: 'github'|'ado'|null, owner?, repo?, org?, project?, orgUrl?}`.
- Produces `detectTrackers(repo, {env}) → {trackers: [{tracker, why, keys?}], host, receipts}`.

- [ ] **Step 1: Write the failing tests.** Use temp repos with crafted commits and branches, built with git under
  `sandboxEnv`. If D-TESTKIT doesn't exist yet, create `tokenomics/fixtures/trackers/harness.mjs` with
  `sandboxEnv`/`fakeBin` now; Task 3 extends it.
  - (a) **parseRemote:**
    - `https://github.com/o/r.git`, `git@github.com:o/r.git` and `ssh://git@github.com/o/r` give github `o/r`;
    - `https://dev.azure.com/acme/proj/_git/app`, `git@ssh.dev.azure.com:v3/acme/proj/app` and
      `https://acme.visualstudio.com/proj/_git/app` give ado with org/project/repo;
    - `https://github.com.evil.io/o/r` gives null.
  - (b) **jira.** Commits `PAY-1 …` × 8 and `WEB-2 …` × 6, plus `bump SHA-256` × 6, `UTF-8 fix` × 6 and
    `RUN-2026 notes` × 1, give jira with keys `['PAY','WEB']`. The why reads `14 of 20 commits`.
    - **Thresholds:** 4 commits give no jira. 5 of 60 (8%) give no jira, and 6 of 60 (10%) do.
    - **One commit, one count:** a single commit mentioning `PAY-1 PAY-2 PAY-3` counts once.
  - (c) **ado.** An ado origin plus `AB#1` × 3 gives ado, with a why naming both. `AB#1` × 3 on a GitHub origin
    doesn't add to the github `#N` count.
  - (d) **jira and github.** A GitHub origin with Jira keys and `(#7)` gives both. `receipts` is `jira`, and the
    settings' github rules carry the branch rule while the jira rules don't. Mining `"PAY-1 (#7)"` with the written
    rules gives `['gh:7','jira:PAY-1']`.
  - (e) **Fresh settings.** `setup` in a repo with no settings file creates settings with `ids.rules` for the
    detected trackers, `dir: 'tokenomics'` and `extension: null`. The output names the tracker and why, and
    `doctor` is ok.
  - (f) **Legacy store.** In a repo with `.agents/telemetry/automation/usage-x.jsonl` and no settings, setup writes
    `dir: 'automation'` (P7-04).
  - (g) **Existing settings.** When the settings file already exists, it's untouched byte for byte. The output prints
    the rules JSON and the `--update-manifest` command.
  - (h) **Flags.** `--tracker jira --tracker-keys PAY` overrides detection, and `--no-tracker` writes no rules. A bad
    key such as `--tracker-keys 12` exits 2, naming it.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - `detectTrackers` runs git through a failure-tolerant helper (`spawnSync`, `stdio` ignored on error, 20 s
    timeout) and counts as D-DETECT says. Take the stoplist from `TA_DEFAULTS.ids.stoplist`.
  - In `setup`, add the flags to `known`. After the copy loop and before the activation loop, do this when no
    settings file exists and the rules are non-empty:
    ```js
    const ih = await import(pathToFileURL(join(repo, COPY_OF[targets[0]], 'scripts', 'install-hooks.mjs')).href);
    const fresh = ih.freshSettings({ dir: ih.defaultDir(repo).dir });
    ih.saveSettings(repo, { ...fresh, ids: { ...fresh.ids, rules } });
    ```
    Check that `saveSettings` is exported, and export it if not. Print
    `tracker: jira (PAY, WEB — 14 of 300 commits); receipts from jira`.
- [ ] **Step 4: Run the tests and the gates.**
- [ ] **Step 5: Commit** `feat(setup): infer the work-item tracker from the remote and history; write its id rules into fresh settings`.

### Task 3: the delivery join (layer 2)

**Files:**
- Create `tokenomics/engine/delivery.mjs`.
- Create or extend `tokenomics/fixtures/trackers/harness.mjs` and `tokenomics/fixtures/trackers/server.mjs`
  (D-TESTKIT; the server is needed from Task 4 on, but build it here).
- Test: `tokenomics/engine/delivery.test.mjs`.

Read D-DELIVERY, D-JOIN, D-PRICED, D-TESTKIT, and review findings P7-01, P7-05, P7-06 and P7-13 first.

**Interfaces:**
- Consumes `mineIds(settings, texts, {branch})` from Task 1 and `parseRemote` from Task 2.
- Produces `defaultBranch(repo, env) → {ref, name, shallow}`.
- Produces `mergedWork(repo, {settings, prs?: 'auto'|'gh'|'az'|'none', env}) → {items: MergeItem[], prs, coverage, reason?}`,
  where `MergeItem = {commit, at, pr: number|null, branch: string|null, ids: string[], source: 'git'|'cli'}`.
  Window filtering happens in Task 4.
- Produces `joinDelivery(lines, items) → {tickets, prs, unattributed: {tickets, prs}, unmerged, totals, trace}`, in
  the D-JOIN shapes.
- Produces `isPriced(line) → boolean` (`typeof line.costUsd === 'number'`), exported from `delivery.mjs`.

- [ ] **Step 1: Write the failing tests.** Use real git in temp repos under `sandboxEnv`, and a fake `gh`/`az` via
  `fakeBin` where needed.
  - (a) **Merge commit.** A real two-parent merge `Merge pull request #7 from o/feat/PAY-1-login` gives
    `{pr:7, branch:'feat/PAY-1-login', ids:['jira:PAY-1'], source:'git'}`. A one-parent commit with that same
    subject is skipped.
  - (b) **Squash only.** A squash-only history `add login (#9)` with no `gh` gives `pr:9`, `branch:null` and
    `prs:'git-only'` with a reason. A fake `gh` returns `headRefName: 'feat/PAY-3-x'` for #9; then `branch` is
    filled, `ids` gains `jira:PAY-3` (mined from the branch through the general rule), and `prs` is `'gh'`. The
    fake `gh` records its argv, which must include `--repo o/r` and `--base main`.
  - (c) **ADO and rebase.** ADO `Merged PR 31: …` gives `pr:31`. A fake `gh` lists #40 with a `mergeCommit.oid`
    that's reachable but unmarked (a rebase merge); it's added with `source:'cli'`. A fake `gh` returning 2000
    rows makes coverage `partial (limit 2000)`.
  - (d) **Conservation** (Review Focus 2). One $10 priced line with `cases:['jira:PAY-1','jira:WEB-2']` on branch
    `b`, where two PRs used `b` (#1 merged before the line ended, #2 after):
    - the tickets get $5 each, with `shared:1`;
    - the line goes to PR #2 only;
    - both trace sums equal `totals.costUsd = 10`.

    A tokens-only line (`costUsd: null`) and a line with `costUsd: 0` are added: the first counts in `tokensOnly`,
    and the second in `priced` with $0. Then a line for `jira:PAY-9`, never merged, lands in `unmerged`, and the
    ticket shows `mergedAt: null` with its spend. A line with no ids on `main` lands in
    `unattributed.tickets`/`.prs`.
  - (e) **Branchless squash.** A squash merge naming `jira:PAY-3` in its subject, with no branch, gets the cost of a
    line with `cases:['jira:PAY-3']` on any branch, by id.
  - (f) **Privacy.** No PR row has a `branch` key; `JSON.stringify(result.prs)` never contains `PRIVATE_BRANCH`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** as D-DELIVERY and D-JOIN say.
  - For allocation, follow batch-cost's `addTo(..., share)` pattern (`tokenomics/scripts/batch-cost.mjs:297`):
    accumulate `share × value` and count `sessions` per line.
  - Build `harness.mjs` and `server.mjs` per D-TESTKIT. `server.mjs` takes a routes module path that exports
    `(req, body) → {status, json}` and appends each request as a JSON line to `<tmp>/requests.jsonl`.
- [ ] **Step 4: Run the tests and the gates.** `delivery.mjs` is engine code, so regenerate ENGINE.json; the fixtures
  are excluded.
- [ ] **Step 5: Commit** `feat(delivery): git-derived merged work joined to the ledger with conserved even splits`.

### Task 4: `delivery-report.mjs` (layer 2 output, layer 3 consumer)

**Files:**
- Create `tokenomics/scripts/delivery-report.mjs`.
- Modify `tokenomics/kit/receipts.mjs` (export `runReceiptCommand`; `readReceipts` uses it with the same behaviour).
- Tests: `tokenomics/scripts/delivery-report.test.mjs` and `tokenomics/kit/receipts.test.mjs`.

Read D-RECEIPTS, D-PRIVACY, and review findings P7-07, P7-08, P7-12 and P7-18 first. Then read team-report's `main`
(`tokenomics/scripts/team-report.mjs:1239`) for root resolution, `loadLines`, `dedupConflicts`, `reportWindow` and
`gateCli`.

**Interfaces:**
- Consumes `mergedWork`, `joinDelivery` and `isPriced` (Task 3); `runReceiptCommand`; and team-report's `loadLines`,
  `dedupConflicts`, `reportWindow` and `receiptWinners`.
- Produces `runReceiptCommand(repo, settings, {env}) → {available, complete, receipts, findings, reason}`.
- Produces the CLI
  `node <copy>/scripts/delivery-report.mjs [--since D] [--until D] [--prs auto|gh|az|none] [--receipts] [--json] [--out F]`.

- [ ] **Step 1: Write the failing tests.** Use `sandboxEnv`, the real `node`, and the receipt server in a child
  process.
  - (a) **Markdown.** On the Task 3 fixture repo, the output has these sections:
    - a header with `base: main (local, not fetched)`, `prs:` and `coverage:`;
    - Totals: spend, priced/tokens-only, merged PRs, tickets with spend, unattributed, unmerged;
    - By ticket: id, sessions (shared), cost, active minutes, PRs, merged or in progress, sorted by cost;
    - By PR: number, ids, cost;
    - Notes, listing the known limits.

    The ticket cost sum plus unattributed equals the Totals spend, as printed.
  - (b) **Windows and duplicates.**
    - `--json` gives the join object plus `{base, prs, coverage, receipts}`.
    - `--since 2026-10-02 --until 2026-10-03` includes a line that started on 10-01 23:59Z and ended on 10-02
      00:01Z (the window is on `endedAt`, start included and end excluded).
    - Two conflicting duplicate lines (same host and id, different cost) are excluded and counted as `conflicts: 1`,
      never as two priced sessions.
    - Merges filter by `at` in the same window.
  - (c) **`--receipts`.**
    - A command printing a valid envelope adds `status`, `type`, `points` and `sprint` columns, the By type and By
      sprint tables, and "cost per delivered ticket" with its membership label.
    - When one id has two receipts, the later `at` wins (`receiptWinners`).
    - An id with no receipt shows `unknown`.
    - A `complete:false` envelope shows `(partial: adapter reported complete:false)`.
    - A failing command keeps the git-derived report and prints `tracker: unavailable (command failed: exit 1)`, with
      no ticket marked delivered and no metric.
    - Malformed output gives `tracker: unavailable (malformed output: …)`.
    - With no command configured: `tracker: not configured (setup --tracker …)`.
    - The command runs only when `--receipts` is given.
  - (d) **The gate.** From an inert installed copy (copy the engine as the existing gate tests do), `--out` is refused
    by `gateCli(engineRoot, repo, {writes:true})` before settings load. Plain stdout is allowed with
    `{writes:false}`.
  - (e) **Privacy.** The envelope fixture's cases carry `title:'PRIVATE_TITLE'`, `assignee:'PRIVATE_PERSON'` and
    `sprint:{name:'S1', owner:'PRIVATE_PERSON'}`, and the ledger branch is `PRIVATE_BRANCH/PAY-1-x`.
    `assertNoSentinels` passes over the Markdown, the JSON, the `--out` file and stderr. A sprint given as an object
    is reduced to its `name`, or dropped when that isn't a string.
  - (f) **receipts.test.mjs.** `readReceipts` returns objects deep-equal to today's for the existing fixtures.
    `runReceiptCommand` reports `complete:false` for a partial envelope, and passes the given `env` (a fake command
    echoes an env var).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - Mirror team-report's ordering: `gateCli` → `loadSettings` → roots → `loadLines` → `dedupConflicts` →
    `reportWindow`.
  - Pass the window's lines to `joinDelivery`, and the items filtered by `inWindow(at)`.
  - Render from an explicit projection that lists every printed field. No object is spread into the output.
- [ ] **Step 4: Run the tests and the gates,** adding allowlist entries for new sites.
- [ ] **Step 5: Commit** `feat(delivery-report): cost per ticket and per merged PR; tracker status through the receipt command`.

### Task 5: GitHub adapter and the shared adapter helpers

**Files:**
- Create `tokenomics/adapters/common.mjs`, holding:
  - `CREDENTIAL_ENV`;
  - `parseArgs`;
  - `idsFromLedger(repo, settings, prefix, re)`;
  - `envelope(group, source, cases, complete)`;
  - `projectCase(raw)`, the D-ADAPTERS projection;
  - `fail(adapter, cls, code)`, which writes one line and exits 1;
  - `batches(arr, n)`;
  - `baseUrl(configured, override)`, enforcing https except on loopback;
  - `httpJson(url, {method, headers, body, timeoutMs})`, using `fetch` and `AbortSignal.timeout`, and throwing
    `{cls, code}` without the body.
- Create `tokenomics/adapters/github.mjs`.
- Tests: `tokenomics/adapters/github.test.mjs` and `tokenomics/adapters/common.test.mjs`, with a fake `gh` in
  `tokenomics/fixtures/trackers/fake-gh.mjs`.

Read D-ADAPTERS and review findings P7-10 and P7-12 first.

**Interfaces:**
- Produces `node github.mjs [--ids gh:1,gh:2] [--repo <path>]`, printing the envelope.
- `common.mjs` is used by Tasks 6 and 7.

- [ ] **Step 1: Write the failing tests.**
  - (a) **Outcomes.** The fake `gh` checks that the query uses `issueOrPullRequest`, `__typename` and
    `... on Issue { … stateReason … }`. It answers for:
    - 1: closed, COMPLETED, closedAt;
    - 2: open;
    - 3: closed, NOT_PLANNED;
    - 4: closed, DUPLICATE;
    - 5: `PullRequest`;
    - 6: null.

    The outcomes are `delivered`, `open`, `closed-not_planned`, `closed-duplicate`, `pull-request` and `missing`.
    The group is `gh:o/r`; `at` and `atSource:'closedAt'` appear only for delivered, and `complete` is false because
    6 is missing. The output validates against `receipts-envelope.json`.
  - (b) **Ledger ids.** Ids default to every `gh:` id in the ledger. Invalid `gh:abc` is skipped and counted on
    stderr.
  - (c) **Failures.** A missing `gh`, an unauthenticated `gh` (exit 4), and a response with HTTP 200 and an `errors`
    array each give exit 1 and one stderr line.
  - (d) **Type.** `type` comes from the first of the `bug`, `feature` and `enhancement` labels, and other labels never
    appear.
  - (e) **Batching.** 150 ids give two `gh` calls, with 100 and 50 aliases.
  - (f) **Privacy.** The fake answers also carry `title:'PRIVATE_TITLE'` and
    `author{login:'PRIVATE_PERSON'}`; `assertNoSentinels` passes.
  - (g) **common.mjs.**
    - `baseUrl` refuses `http://example.com` and allows `http://127.0.0.1:9`.
    - `httpJson` maps a 500 to `{cls:'http', code:500}` without the body.
    - A test scans `tokenomics/adapters/*.mjs` for `process.env.X` and `env.X` and `env['X']` reads, and checks that
      `X ∈ CREDENTIAL_ENV ∪ {TOKENOMICS_TRACKER_BASE_URL}`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** with `spawnSync('gh', ['api', 'graphql', '-f', `query=${q}`], {env, encoding:'utf8', timeout: 30000})`.
  The query holds only validated integers. Owner and repo come from `parseRemote` (Task 2) or
  `settings.tracker.project` (`owner/repo`).
- [ ] **Step 4: Run the tests and the gates,** regenerating ENGINE.json and adding allowlist entries.
- [ ] **Step 5: Commit** `feat(adapters): GitHub Issues receipt adapter (gh auth, read-only)`.

### Task 6: Azure DevOps adapter

**Files:**
- Create `tokenomics/adapters/azure-devops.mjs`.
- Test: `tokenomics/adapters/azure-devops.test.mjs` (the D-TESTKIT server in a child process).

Read D-ADAPTERS and review finding P7-11 first.

**Interfaces:**
- Consumes `common.mjs` (Task 5) and `parseRemote` (Task 2).
- Produces `node azure-devops.mjs [--ids ado:1,…] [--base-url URL]`.
- Configuration comes from `settings.tracker`, `{kind:'ado', url:'https://dev.azure.com/<org>', project?, doneStates?, fields?}`.
  The origin URL fills in what's absent.

- [ ] **Step 1: Write the failing tests.** The server implements `POST /<org>/_apis/wit/workitemsbatch?api-version=7.1`
  and records each body.
  - (a) **Fields.** The fields `System.State`, `System.WorkItemType`, `Microsoft.VSTS.Scheduling.StoryPoints`,
    `System.IterationPath` and `Microsoft.VSTS.Common.ClosedDate` map to outcome, type, points, sprint (the last
    path segment) and at with `atSource:'ClosedDate'`. `Done` gives delivered, `Resolved` gives `Resolved` (not
    delivered), and `Closed` without a ClosedDate gives delivered with no `at`.
  - (b) **Configuration.** `doneStates` overrides the default, and `fields.points:'Microsoft.VSTS.Scheduling.Effort'`
    is honoured.
  - (c) **Batching.** 250 ids give two requests whose bodies hold exactly ids 1–200 and 201–250. Every id is
    answered and `complete:true`. When the server omits one id, `complete:false`. An HTTP 500 on the second request
    gives exit 1.
  - (d) **No credentials.** With no PAT and no `az`, exit 1 with a stderr line naming `AZURE_DEVOPS_EXT_PAT` and
    `az login`.
  - (e) **az token.** A fake `az` that prints `t0k` gives the header `Bearer t0k`. The recorded `az` argv never holds
    a token, and with a PAT set `az` is never called.
  - (f) **Privacy and secrets.** The PAT is `SENTINEL-PAT-7f3a`. The server answers with
    `System.Title:'PRIVATE_TITLE'` and `System.AssignedTo:{displayName:'PRIVATE_PERSON'}`, and a 500 body that
    contains the sentinel. `assertNoSentinels` passes over stdout and stderr, checking `base64(':SENTINEL-PAT-7f3a')`
    too. `--base-url http://example.com` exits 2.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** with `httpJson` and `AbortSignal.timeout(30000)`. Request only the five configured
  fields.
- [ ] **Step 4: Run the tests and the gates.**
- [ ] **Step 5: Commit** `feat(adapters): Azure DevOps Boards receipt adapter (PAT or az login, read-only)`.

### Task 7: Jira adapter

**Files:**
- Create `tokenomics/adapters/jira.mjs`.
- Test: `tokenomics/adapters/jira.test.mjs` (the D-TESTKIT server).

Read D-ADAPTERS and review finding P7-09 first.

**Interfaces:**
- Consumes `common.mjs`.
- Produces `node jira.mjs [--ids jira:PAY-1,…] [--base-url URL] [--max-pages N]`.
- Configuration comes from `settings.tracker`, `{kind:'jira', url:'https://<site>.atlassian.net', fields?: {points?, sprint?}, server?: false}`.

- [ ] **Step 1: Write the failing tests.**
  - (a) **Cloud.** `POST /rest/api/3/search/jql` with `jql: 'key in (PAY-1,PAY-2)'`,
    `fields: ['status','issuetype','resolutiondate', …configured]`, `maxResults: 100` and Basic `email:token`.
    - `fields.status.statusCategory.key == 'done'` gives delivered with `at` = `resolutiondate` and
      `atSource:'resolutiondate'`. Done with a null resolutiondate gives delivered with no `at`.
    - A sprint array uses the last element's `name`.
    - Without configured custom fields, no `customfield_*` is requested.
  - (b) **Server/DC.** Server mode (`server:true`, `JIRA_PAT`) uses `/rest/api/2/search` with Bearer and pages by
    `startAt` until `total`.
  - (c) **Pagination.** 230 keys give three JQL chunks (100, 100, 30).
    - The server answers chunk 1 in two Cloud pages: a short first page (60 issues, an opaque
      `nextPageToken:'tok-a'`, `isLast:false`), then 40 issues with `isLast:true`. The second request carries
      `nextPageToken:'tok-a'` and the same JQL.
    - Everything is answered and `complete:true`.
    - A repeated token stops with `complete:false`, and so does `--max-pages 1`.
    - The ids `jira:PAY-1) OR 1=1` and `jira:pay-1` are skipped and counted, never sent (check the recorded JQL).
    - When every id is invalid, no request is made and the output is `complete:true` with no receipts.
  - (d) **Missing credentials.** Exit 1, naming `JIRA_EMAIL`/`JIRA_API_TOKEN` or `JIRA_PAT`.
  - (e) **Unrequested keys.** A key returned that wasn't requested is ignored.
  - (f) **Privacy.** The server answers carry `summary:'PRIVATE_TITLE'` and `assignee:{displayName:'PRIVATE_PERSON'}`,
    and the token is `SENTINEL-TOKEN-91c2`. `assertNoSentinels` passes, including `base64('e@x:SENTINEL-TOKEN-91c2')`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and the gates.**
- [ ] **Step 5: Commit** `feat(adapters): Jira receipt adapter (Cloud token or Server PAT, read-only)`.

### Task 8: `setup --tracker` wires the adapter; docs; release

**Files:**
- Modify `bin/setup.mjs`: `--tracker <jira|github|ado> [--tracker-url U] [--tracker-project P]`. Into a fresh settings
  file it writes `tracker` and `receipts.command` for the receipts tracker (D-DETECT item 4). For an existing file
  it prints the exact JSON and the `--update-manifest` command.
- Docs:
  - `README.md`: the setup options, and a "Work-item trackers" section. It covers the credential table, the
    `delivery-report` usage, the even-split rule, the privacy rule, the known limits, and the fact that raw ids
    recorded before the rules don't join with prefixed ones.
  - `tokenomics/SKILL.md`: delivery-report and the adapters.
  - `docs/spec.md`: an "as implemented" note in §14.4 (`ids.rules`; top-level `normalize`/`mineFrom` superseded),
    §14.5 and §5.6.

  `tokenomics/SKILL.md` is an engine file, so regenerate ENGINE.json after editing it.

- [ ] **Step 1: Write the failing tests** (`bin/setup.test.mjs`).
  - (a) **End to end.** `setup --tracker jira --tracker-url https://acme.atlassian.net --tracker-keys PAY --host claude`
    in a fresh repo gives settings with `tracker` and `receipts.command: ["node", ".claude/skills/tokenomics/adapters/jira.mjs"]`.
    `doctor` stays ok, so the module manifest is unchanged by these keys.
    - Then a seeded ledger line `cases:['jira:PAY-1']` goes through `delivery-report --receipts`, with
      `TOKENOMICS_TRACKER_BASE_URL` pointing at the D-TESTKIT server and dummy Jira credentials in `sandboxEnv`.
      The status `delivered` shows.
    - The test uses the real `node`, not the setup test's no-op shim, for this child.
  - (b) **Existing settings.** An existing settings file is untouched, and the JSON plus the `--update-manifest`
    command are printed.
  - (c) **Copilot only.** `--host copilot-cli` names `.github/skills/tokenomics/adapters/…`.
- [ ] **Step 2: Implement,** then regenerate ENGINE.json.
- [ ] **Step 3: Run the full gate batch** from clean clones on Node 24 and 18.19, including
  `node scripts/migrations.mjs check`.
- [ ] **Step 4: Real check.** It's the owner's, with their credentials, at their choice:
  - `delivery-report` on a readiness trial repo (GitHub, git-only);
  - `--receipts` against a tracker the owner names.
- [ ] **Step 5: Commit** `feat(setup): --tracker wires a receipt adapter; docs for trackers and delivery-report`.
  Tag `v0.5.0-rc.1` on the owner's word.
