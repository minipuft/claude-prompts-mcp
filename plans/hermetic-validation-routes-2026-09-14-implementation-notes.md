---
title: "Hermetic validation routes — implementation notes"
date: 2026-09-14
status: active
tags: [ci, scripts, config, validation]
---

# Implementation Notes — `plans/hermetic-validation-routes-2026-09-14.md`

Session voice. Append-only: deviations and findings land here as they happen; the plan's `## Now`
block is the state that gets rewritten.

## Why this branch stacks on the README install-path branch

Worker A edits the CI step block and `verify-mcp-surface.mjs`, both of which the README install-path
branch already changed. Cut from `main`, the two branches would conflict on the same hunks. The cost is a
rebase onto `main` once that PR squash-merges.

## Dispatch record

The first dispatch (2026-09-13, one Opus agent for all three rows, launched through the Agent tool) died
on an API session limit before its first command: no worktree, no branch, nothing to recover. It also ran
at the session's inherited effort, because the Agent tool has no effort parameter. The re-dispatch goes
through `Workflow`, whose `agent()` takes `effort`.

The second dispatch (2026-09-14, `Workflow` with opus/high per worker) also died when the session process
exited. The journal recorded both workers as started and neither as finished; neither had committed. Their
drafts survived uncommitted in their own worktrees — worker A: CI routing, CLAUDE.md/AGENTS.md, a shared
`server/scripts/lib/hermetic-server-env.js` with type declarations, the widened hermetic gate and five
rewired scripts; worker B: `paths.ts`, its unit tests, a new e2e test, docs and the CHANGELOG. Relaunched with
a resume brief that names the existing worktree, forbids `worktree:create` and rebasing, and requires a commit
per row as soon as its check passes. Before relaunching, this branch was rebased onto `c68205bd`; the worker
branches keep their pre-squash base, which is content-identical, and their commits cherry-pick here.

The third dispatch (2026-09-14) left `Workflow`. The second run's journal recorded both agents as `failed`
with no error text — consistent with the parent session's teardown, not an API limit — and any in-session
runner dies the same way. Both workers were relaunched as background sessions (`claude --bg`, `--model opus
--effort high`, `--permission-mode bypassPermissions` to match the planner's class), in their existing
worktrees, with the resume brief plus three rules: nobody answers questions, commit each row the moment its
check passes, and write the five-heading handoff to a file before stopping. A handoff file replaces a
cross-session message because this session's name changes on every restart.

## Deviations

None yet.

## Worker B handoff accepted (2026-09-14)

**Rulings on B's concerns.** The refusal names the workspace `config.json` rather than the packaged default when
`MCP_WORKSPACE` holds one, because that is what unsetting the explicit path would load — the ruling asked the
message to say what unsetting does, and the literal "packaged default" would be false there. The help-text hunk of
`index.ts` rides in the runtime commit; lint-staged re-stages whole files and the split buys nothing. Deleting
`validatePathCliOptions` stands: zero call sites, and a second, weaker definition of a usable config path.

**B's row 1.7 measurements** (current build, scrubbed env, variable at a missing path, 20 s window):

| Variable             | STDIO                  | HTTP                  | Anything names the missing path? | Path created?            |
| -------------------- | ---------------------- | --------------------- | -------------------------------- | ------------------------ |
| `MCP_RESOURCES_PATH` | boots, prompts/list 46 | boots, initialize 200 | no                               | no                       |
| `MCP_WORKSPACE`      | boots, prompts/list 46 | boots, initialize 200 | no                               | no                       |
| `MCP_RUNTIME_ROOT`   | boots                  | boots, initialize 200 | no                               | yes, with subdirectories |

B's positive control for the "nothing names it" column: the same log grep does see the path when the variable is
`MCP_CONFIG_PATH`, and saw it on the base build's `Error loading configuration from …`.

**Pre-change behavior B measured on the base build:** an unusable explicit path logged a stack to stderr, printed
`Using default configuration` to stdout, and kept serving on both transports (STDIO answered initialize; HTTP loaded
51 prompts). That stdout line survives on the implicit default path, which is row 1.8.

**Brief defects B reported, for the next dispatch.** `node scripts/sync-project-guidance.js` needs `--write` or
`--check` and fails bare. `npx prettier --check` run from `server/` against root files ignores the root
`.prettierignore` and falsely flags `AGENTS.md`; root files check from the root. `buildServerEnv` already scrubs every
key the brief listed, so naming it as the single source would have saved a check.

## Worker A handoff (2026-09-14)

**Accepted on planner probes:** row 1.1 (four documentation steps on `!= 'full'`, classifier, projection check) and
row 1.4 (measured, nothing to commit). The gate itself passes with a 10-case self-test, and a planner mutant that
replaces `buildServerEnv` in `capture-tool-schemas.mjs` with a `process.env` spread fails it naming that file.
`typecheck:tests:ratchet` holds at 367, and `verify:mcp` with the personal library, a sentinel runtime root and a missing
config path exported serves the bundled 51 and creates nothing.

**Held open:** rows 1.2 and 1.3. The planner's broader enumeration also matched `prepare-release-artifacts.js` and
`validate-extension-artifact.js`, which import no shared list and which the handoff does not classify. If either starts
the server under a spelling the gate's classifier does not recognise, "every server-spawning script" is false.

**Rulings on A's concerns.** The gate checks per file, not per spawn call — accepted as a documented limit, the
narrow-gate-with-stated-blind-spot shape. The snapshot's dependence on persisted state becomes row 1.11, assigned to A,
because a committed artifact must not read the author's `state.db` any more than the author's environment.
`SCRUBBED_KEYS` exported with only a declaration consumer goes to the knip check at the PR boundary.

**Findings recorded.** The gates-toggle scope mismatch is row 1.12 for the owner. `scripts/hook-harness.mjs` sets
`MCP_RESOURCES_PATH` deliberately for a child Claude Code builds itself — intended, not a site.
`server/scripts/validate-contributing.js:21` describes the docs route only, now incomplete; folded into A's follow-up.

**Brief defects A reported, for the next dispatch.** "Diff against `git show HEAD:<file>`" collides with "commit each row
as soon as its check passes": after the first commit, HEAD is the new script, and four runs compared new against new
before A caught it — name the base commit, never HEAD. And row 1.4 stated a mechanism as fact ("a config with gates
disabled changes prompt_engine's advertised parameters") that was false; a brief should offer a lever as a hypothesis the
worker must first show can move the measurement.

## Rows 1.2 and 1.3 accepted (2026-09-14)

The two scripts the planner's wider enumeration matched are outside the class. `prepare-release-artifacts.js`
spawns `dist/cpm.js --version` and `tar`: the CLI bundle holds no `MCP_CONFIG_PATH` reference, and `cpm --version`
printed `4.0.1` and exited 0 both with no override and with a missing config path exported. The server under that
same environment refused with exit 1 and zero stdout bytes, which is the positive control that the exported value
was live. `validate-extension-artifact.js` spawns only `stage-server-runtime.sh`, inside its self-test.

Row 1.11 went to A at base `3e56bb8a` and carries both brief defects A reported: the comparison base is a named
commit, and the shared-builder lever is offered as a hypothesis whose seeded-row positive control must move first.

## A knip ratchet regression found before the PR boundary (2026-09-14)

The planner ran knip early, because worker A's handoff flagged an export with only a declaration consumer.
`node scripts/knip-ratchet.js check` exits 1 at `dbd65433`: exports 492 to 493, files 16 to 17. Knip names four
additions, each referenced only inside its own module: the whole `scripts/lib/hermetic-server-env.d.ts`,
`SCRUBBED_KEYS`, and `describeUnusableConfigFile` and `formatConfigPathRefusal` in `src/runtime/paths.ts`.
`createPathResolver` shares the knip line but dates from `13901297` and is not this branch's.

Rows 1.2 and 1.5 stay accepted: their flip conditions held. But neither row's check read the ratchet, and both
rows added exports. **Brief defect, planner-side**: a dispatch row that adds or removes an export names
`validate:knip-ratchet` as part of its row check, since that count is otherwise first read in CI.

Ruling: one worker owns the count across both workers' files, because it is one measurement and two actors
fixing it concurrently would each read the other's half-done number. The declaration file goes out as a hypothesis
(tsc needs it; knip does not credit a declaration beside a `.js` import) that A measures before choosing between
deleting it and teaching knip about it.

## Row 1.11 killed; row 1.10's ruling amended (2026-09-14)

**1.11.** Worker A front-loaded the positive control and stopped when it did not move. A seeded the existing
`default` gates row to disabled with a distinct reason. The capture re-saved that row, since `updated_at` moved and
the reason survived, so the capture demonstrably read it, yet it still advertised `gate_action`, `gate_verdict` and
`gates`, byte-identical to the committed snapshot. The earlier `server`-scope toggle had behaved the same. The scripts
do write the checkout's `state.db`, but they write back what they read, and no output changes. Killed, with its
revival tied to row 1.12, whose fix must carry the runtime-root pin.

**1.10.** Worker B committed rulings 1 and 3 (`8ac0f676`, 4 files) and returned ruling 2 against the 6-file bound. The
rule turns 22 `eslint-disable no-console` directives into unused ones, which moves the ratchet's `__unknown__` count
from 5 to 27. The planner's enumeration then found the concern B raised about `src/index.ts` covers two more files:
the file-wide `no-console: 'off'` block also names `src/runtime/startup.ts` and `src/infra/logging/index.ts`, both of
which run in the serving process. B's 73-warning count was taken under that override, so it could not see them. The
same enumeration found no `process.stdout` code in `src` (positive control: 21 `process.stderr` code lines), which
`no-console` would not catch anyway.

**Brief defects, planner-side.**

- `git rebase <initiative branch>` assumed git would drop commits already applied by cherry-pick. The squash-merged
  history beneath them conflicts first. The exact command when a branch holds nothing new is
  `git rebase --onto <base> <last own commit>`.
- "Seed under the scope a fresh capture reads" assumed the database reveals that scope. Ask instead for the row a
  fresh capture re-saves.
- A severity change to a lint rule is sized by two counts taken before dispatch: the directives naming that rule, and
  the files an override exempts from it. A count taken under an override cannot see the override's files.

## Row 1.13 accepted; the merge loosened the ceiling it restored (2026-09-14)

Worker A's `847cc3d2` passes on the merged tree (`d51fad80`): the ratchet reports OK at 1195 findings, knip names
none of the four findings, `typecheck` passes, `typecheck:tests:ratchet` holds at 367, and the hermetic gate and its
self-test are green. The tightening was the ratchet's own request. A's `dc4783a0`, the `validate-contributing.js`
comment naming both lightweight routes, is cherry-picked with it.

The planner's mutant did not fail. Re-exporting `formatConfigPathRefusal` on the merged tree left the ratchet at
exit 0, because B's `8ac0f676` had deleted the exported `setupConsoleRedirection`, leaving 489 exports under a 490
ceiling. A's identical mutation failed on A's branch, which lacked B's deletion. Each branch's positive control was
sound for that branch alone; only the merged tree could show the slack. That is row 1.14.

**Finding, recorded as evidence rather than work:** the knip ratchet prints a request on any decrease and exits 0, so
a missed tightening never fails CI. That is the mechanism behind every ceiling slack this plan met, and it bears on
the ratchet-slack pattern rather than on this plan's class.

## Rows 1.10 and 1.14 accepted; the PR boundary goes ahead without 1.9 (2026-09-14)

**1.10.** Worker B's `f086189c` took the widened ruling. The file-wide exemption block is gone: measured under the new
rule, `startup.ts` and `logging/index.ts` held no stdout write, and `index.ts` held one, the `--init` early exit, now
exempt on its own line with the reason. The real-file probe disproved part of the planner's hypothesis:
`no-restricted-properties` catches `process.stdout`, destructuring and computed access, but not
`import { stdout } from 'node:process'`, so `no-restricted-imports` joins it. On the merged tree one planner mutant
holding every spelling failed the ratchet on all three rules. B's three limits are recorded here, each with what
reopens it:

- Flat config replaces a rule's options rather than merging them. Reopens if any other block in `eslint.config.js`
  sets `no-restricted-imports` or `no-restricted-properties` for server source, since that block would silently drop
  the stdout entry for its files.
- A stream handle reached another way (`globalThis.process.stdout`, `require('process').stdout`,
  `fs.writeSync(1, …)`) is not refused. Reopens if an rg for any of those spellings finds a site in `server/src`;
  today it finds none.
- The lint baseline's `totals` block is stale (3200/1020 against 3092/898). `check` never reads it, so nothing depends
  on it.

**1.14.** Worker A's `a9f80614` refuses a declaration that knip's `entry` credits when no sibling `.js` exists, reading
the roots from `knip.json` rather than a list. It deletes the unimported `plugin-test-helpers.ts` and tightens once, last.
Both mutants fail on the merged tree. A's own limits: only `<root>/**/*.d.ts` entry globs are enumerated, and a
declaration beside a `.mjs` or `.cjs` would read as an orphan, which is loud rather than silent.

**Finding, A's statement of the class:** a baseline taken on a worker branch is looser than the merged tree whenever
another branch deletes debt, because a positive control proves only the tree it ran on. A mutant adding exactly one
finding is sharp only at `current == baseline`, so the ratchet is re-measured and tightened after each merge, then
mutated.

**Row 1.9 and the PR.** The owner has not ruled on 1.9. Rows 1.5–1.8 already refuse an unusable explicit config and
keep the fallback line off stdout on their own. 1.9 would extend refusal to other path settings, which is a separate
breaking-change decision. So this PR carries every other in-class row, and 1.9 ships as its own change once ruled.

## The PR-boundary gate (2026-09-14)

Run once on `ffa50a2a`, logs under `/tmp/hvr-gate/`:

| Step                                                                           | Result                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `build`, `typecheck`                                                           | pass                                                               |
| `lint:ratchet`                                                                 | OK, 3092 errors and 898 warnings                                   |
| `typecheck:tests:ratchet`                                                      | OK, 367                                                            |
| `test:all`                                                                     | 3068 unit (1 skipped), 819 integration, 197 e2e (2 skipped), 221 s |
| `validate:all`                                                                 | **1 of 58 failed**: `validate:suite-membership`, new this run      |
| `verify:mcp`, and again with a missing `MCP_CONFIG_PATH` exported              | 18/18 both                                                         |
| STDIO and HTTP starts with a missing `MCP_CONFIG_PATH`                         | exit 1, 0 stdout bytes, one refusal line, no runtime root created  |
| `build:prod`, `start:test`, `verify:package-artifact`, `validate:tool-schemas` | pass; the snapshot is identical for 3 tools                        |

`test:all` ends with Jest's "did not exit one second after the test run" line from the e2e run. It predates this
branch: `main`'s last green CI run (34232329468) prints it in both the Node 24 and Node 22.13.0 test jobs. The new
`config-path-refusal.e2e.test.ts`, run alone with `--detectOpenHandles`, passes 4 of 4 and reports no open handle.

**Brief defect, planner-side**: a row that changes what a validator touches — a directory walk, a child process — names
`validate:suite-membership` in its row check. Rows 1.3 and 1.14 each did, and the registry mismatch was first read at
the PR boundary.

## After the gate: main merged, the CHANGELOG entry, and row 1.15 half overruled (2026-09-14)

`origin/main` gained #277 (`aaecac4e`), which touched `CHANGELOG.md` and one prompt file. It merged cleanly as
`555f0aa2`, with both `[Unreleased]` entries kept. Reading the merged CHANGELOG showed row 1.8's STDIO fix had no
entry, though a consumer observes it. Worker B added one under `### Fixed` (`d4b7abcc`, fast-forwarded), and B's
session was stopped with every row it owned accepted.

**1.15.** `validate:suite-membership` re-derives each step's substrate from its source, textually: it strips comments
and regex literals but not string literals. Worker A found knip-ratchet's `walk` real (row 1.14's `readdirSync`) and
declared it. For the hermetic gate, which starts no process, the `spawn` came from three `spawnSync` strings in its
self-test fixtures. A composed the name at runtime so the detector would not see it. The planner overruled that half.
The `validate:contributing` SUITE entry already settles the case: its `spawn` is a textual match on a literal, and its
comment says it is "declared rather than worked around, because the detector is textual by design and omitting a
matched substrate fails". A's concern, that any fixture spelling a signal token trips the detector, is therefore that
precedent's documented design, not an open defect.

**Brief defect, planner-side**: the 1.15 ruling said to prefer "a change that keeps the detector honest" without
reading the SUITE's existing convention for textual matches. A brief that rules on a registry cites the precedent the
registry already carries.

On the merged tree (`555f0aa2`, `d4b7abcc`, `c53e5872`), `validate:all` passes 58 of 58 in 67 s.

## #278 merged; the owner rules the open rows (2026-09-14)

PR #278 merged as `c141a048` with every row except 1.9, 1.11 and 1.12. The owner then ruled:

- **1.9**: "these should also refuse to start". Read as all three settings the planner listed (a malformed workspace
  `config.json`, `MCP_RESOURCES_PATH` naming a missing directory, `MCP_WORKSPACE` naming a missing directory). The
  planner's earlier recommendation to only warn for `MCP_WORKSPACE` is overruled. Recorded as R6.
- **1.12**: "we would need to do this migration; `system_control` needs to disable these features to preserve tokens
  when needed". Recorded as R7.

**Superseded kill.** Row 1.11 was `✗ KILLED` with the revive condition "a freshly started server's advertised schema
narrows from a persisted row, which fixing row 1.12 would make true". R7 builds that condition, so 1.11 reopens under R8
instead of a new row repeating it. The kill text stays quoted in the row.

**Planner sub-rulings inside R6**: an empty value counts as unset; a workspace without `config.json` keeps the packaged
fallback; `MCP_RUNTIME_ROOT` stays created on demand; the packaged `config.json`'s own fallback is outside R6, because it
is not an operator setting.

**Dispatch surface for Tier 2**: background `claude --bg --model opus --effort high` sessions, the surface that bound both
tier and effort in Tier 1 and survived session restarts. Workers return the five-heading handoff to
`~/.cache/claude-prompts-mcp/handoffs/` and send a one-line completion message, because idle notices fire while a
worker's shell commands run.

## Tier 2 cut for row 1.9 (2026-09-14)

A read-only trace on `c141a048` mapped the refusal surface. What it changed about the design:

- The check cannot live beside the explicit config check alone by accident of order. `MCP_RESOURCES_PATH` is first
  resolved after the transport is chosen, and a missing workspace is currently CREATED by the logs `mkdir`, because
  the runtime root defaults to the workspace. So the check must run before `determineTransport` and before any
  `mkdir`, which is also what keeps both transports in parity.
- Two release-job smoke steps depend on the fallback (`extension-publish.yml:227, 648`), so R6 would have failed the
  next release rather than any PR check. Row 2.2.
- Three more readers carry the same silent fallback. The skills-sync CLI's is kept as row 2.5, because a typo there
  writes the wrong set into client skill directories. The hooks' and `cpm enable-disable`'s are killed (2.6, 2.7) with
  reasons: the server refusal already surfaces the misconfiguration, and neither is the ruled surface.

**Routing deviation from the planner prompt.** Public documentation normally routes through `>>documentation_change`.
Row 2.3 stays a worker row, as row 1.6 did: it states an existing behaviour change in existing sections, not a new public
surface.

**Planner rulings in the brief**: one refusal error type generalized from `ConfigPathError`, not a parallel type
`application.ts` and `index.ts` must each learn; the check stays out of the path getters, whose unit tests use made-up
paths; the CHANGELOG extends the existing BREAKING entry.

## Tier 2 cut for rows 1.12 and 1.11 (2026-09-14)

A second read-only trace on `c141a048` falsified row 1.12's recorded mechanism. The row said a toggle persists under the
`server` scope while a fresh server reads the `default` row. In fact both read and write the launch workspace id. The
defect is `GateStateStore`: `initialize` loads only key `default`, and `getOrCreateScopedState` creates an enabled state
for any other key without reading SQLite. That also explains row 1.11's null result without a second cause. The seeded
`default` row loaded into memory under `default`, while the schema asked for `server`. The row's text is kept, with the
correction appended.

**Rulings for worker D.**

- Load every persisted `gates` row at initialize. A per-request lazy load cannot fit behind the synchronous
  `isGateSystemEnabled`, and the framework store's single-scope load would leave HTTP identities other than the launch
  scope unfixed. The launch-scope pattern is the named fallback.
- Adopt a legacy `default` row, as `FrameworkStateStore` does. That is the owner's "migration".
- No `SCHEMA_VERSION` bump, since a bump drops the very state being fixed.
- The scripts pin a runtime root each, not the shared builder (worker A's consumer map in row 1.11).

**Finding, not a row**: `buildServerEnv` leaves `CLAUDE_PROJECT_DIR` inherited, so a caller's Claude Code session decides
the scope key a script's server resolves. With a temp runtime root that key reads an empty store, so it cannot leak state.
Nothing else here depends on it.

## Row 2.4: R6 breaks two downstream extensions (2026-09-14)

Read-only probe of the sibling repositories:

| Repository         | Setting                                                                                                                               | Resolves to                                                               | Under R6                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| `minipuft-plugins` | none                                                                                                                                  | —                                                                         | unaffected                                           |
| `gemini-prompts`   | `MCP_WORKSPACE=${extensionPath}`; `MCP_RESOURCES_PATH=${extensionPath}/node_modules/claude-prompts/resources`                         | the extension directory exists; its `node_modules` does not after install | refuses on `MCP_RESOURCES_PATH`                      |
| `opencode-prompts` | `MCP_WORKSPACE=./node_modules/claude-prompts`, with the command `npx claude-prompts --transport=stdio`, in project and global configs | relative to the server's working directory                                | refuses wherever that directory has no local install |

`gemini extensions install` clones or copies the extension and does not run `npm install`, per the Gemini CLI extension
docs and the command's tracking issue (google-gemini/gemini-cli#5990). `gemini-prompts` gitignores `node_modules/` and
depends on `claude-prompts ^3.0.0`. Its start command is `npx claude-prompts`, so with no local install it fetches the
newest server, and that server will carry R6. Today both extensions work only because the server silently falls back to
its own bundled resources, which is exactly the behaviour R6 removes.

The local search of the installed Gemini CLI 0.55.1 bundle matched only yargs vendor code, so the "no npm install"
finding rests on the documentation, not on a code read.

## The owner rules the downstream order; workers stall on a restart (2026-09-14)

**R10.** Asked how the downstream repositories should move, with three options — fix downstream first, ship
claude-prompts and fix after, or soften R6 for relative paths — the owner chose to fix downstream first. R9 ("one PR
closes the plan") no longer holds: rows 2.11 and 2.12 land in other repositories, reviewed and pushed by the owner, so
the claude-prompts PR carries a progress footer and the plan closes when the downstream rows do.

**Stall.** At 13:12, after a session restart, both background workers read `idle` / `blocked` with no commits and no
handoff. Worker C held uncommitted edits in all six row 2.1 files; worker D held one uncommitted edit, to
`gate-state-store.ts`. Per the resumable-dispatch practice, the planner reads each session's log before choosing, and
resumes a live session with an instruction to re-read its tree, because a relaunch would redo reading the transcript
already holds.

## Downstream handoffs and a write to the owner's live config (2026-09-14)

**Incident (row 2.14).** Worker F's first two test runs for row 2.12 wrote to the owner's real
`~/.config/opencode/opencode.jsonc`. The test set `process.env.HOME` to redirect `GLOBAL_CONFIG_DIR`, a module-level
`join(homedir(), …)`. jest-environment-node gives each test file a copy of `process.env`, so `node:os` read the real home.
Damage: `mcp["opencode-prompts"]` replaced (ending with a temp `MCP_WORKSPACE`), and the `plugin` array rewritten, with
`"opencode-prompts"` appended and two commented lines lost. F restored both nodes from
`opencode.jsonc.tui-migration.bak` (2026-08-18) and kept the damaged copy in the handoffs directory.

The planner verified the repair:

- Against the damaged copy, only those two nodes differ.
- The active plugin entries equal the damaged list minus the appended `opencode-prompts`, and equal the backup's.
- The backup-to-current diff shows the owner's post-08-18 edits (instructions list, `mcp-youtube`, tui/theme block) intact.
- The only file under `~/.config/opencode` modified today is `opencode.jsonc`, at the restore.
- F's committed test now mocks `node:os` behind a `beforeAll` guard; the planner re-ran it with the file's sha256 identical
  before and after.
- Unprovable: the entry's value just before the test, so the owner confirms it.

**Brief defect, planner-side.** Row 2.12's brief sent global-scope tests at code whose config directory is a module-load
`homedir()` constant, and said nothing about the owner's live config. A brief for any row whose code writes user-level
config requires a guard proving where writes land, positive-controlled before the first write. Worker E's brief got that
guard only after its runs; `~/.gemini` shows no file modified today.

**Row 2.11, worker E.** `c695ce1`: three files, the JSON parses, and the gemini main checkout's uncommitted hook edits are
untouched. On published claude-prompts 4.0.1, the old env (`MCP_RESOURCES_PATH` into a missing `node_modules`) and the
new env serve the same 33 prompts by name. The R6 start waits on worker C's build. E installed dev dependencies into its
own worktree, because the commit hook needs commitlint.

**Row 2.12, worker F.** `3a71b12`: five files, 9 tests; a mutation restoring the relative default fails 4. Rulings on
its concerns:

- A legacy `mcp["claude-prompts"]` entry of the plugin's old shape would still start a server R6 refuses, so re-install
  removes it, and warns on one the user changed.
- F's equivalence read showed the runtime root follows the workspace. With no `MCP_WORKSPACE` it lands in the npx cache,
  which can be cleared along with `state.db`. The installer therefore writes an absolute per-user `MCP_RUNTIME_ROOT`,
  matching the Claude Code plugin's use of its data directory.
- Whole-entry replacement is killed as row 2.13.
- The CHANGELOG follows the repository's release-please convention.

**Not worker artifacts.** Both downstream worktrees hold an untracked `t3.json`, the T3 app's per-project script file,
written when a worktree is opened.

## Worker C accepted; both downstream rows verified against the R6 build (2026-09-14)

Planner probes on C's branch, all on one fresh build: the refusals, the boots and the skills-sync CLI as recorded in rows
2.1 and 2.5. The same build ran both downstream configs from fresh checkouts. Each old config refuses, which proves R6
would have broken it; each new config boots and serves 46 prompts. So rows 2.11 and 2.12 hold against the server they
exist for, not only against today's release.

**Rulings on C's concerns.**

- The refusal also covers a directory that cannot be read. Kept: it mirrors the shipped config check, and an unreadable
  directory is unusable.
- The commitlint "and" warning on `34b8a589` is resolved by the squash title.
- The label fix without a mutation is settled by the planner's own mutant, which fails its e2e case.
- `test:all`, and `hook-harness.mjs` setting these variables, belong to the PR-boundary gate.

**C's findings.** The README's `--transport sse` is row 2.15. The skills-sync `resolveProjectRoot` fallback is row 2.16,
the same class as 2.5. `ConfigLoader`'s catch-all is killed as 2.18, with a revive condition.

**Rulings on F's follow-up concerns.**

- `MCP_RUNTIME_ROOT` is written for custom workspaces too. That keeps state out of a user's resource library, the reason
  the variable exists.
- Existing runtime state is not migrated: the old locations sat under a local install or under setups R6 refuses.
- F's reading of a relative `XDG_DATA_HOME` (ignored, per the XDG spec) and of a legacy entry with an extra key (kept,
  with a warning) stand.

**Lint count.** `lint:ratchet` reports 3096 errors on C's branch against the 3092 measured at `ffa50a2a`. The per-rule
error delta over C's five touched source files is +0, so the four came from elsewhere, already on `main`. A planner
probe traces them.

**Downstream rows need a release gate, not only a fix.** Accepting 2.11 and 2.12 does not make the release safe: R10
orders the releases, which happen outside this repository. Row 2.17 holds that order, so the plan stays `active` after
the claude-prompts PR.

## A lint probe that could not see the rule it cleared (2026-09-14)

Row 2.1's receipt said "no new lint error in the five touched source files". The planner measured that by linting each
file's base version through `eslint --stdin --stdin-filename` and the head version as a real file, then diffing the
per-rule counts. The probe reported +0.

A full real-file run over `src`, `scripts` and `eslint-rules` then gave 3092 errors on main and 3096 on the merged
initiative branch. The whole delta is +4 `@typescript-eslint/strict-boolean-expressions` in `src/runtime/paths.ts`.
Linting through stdin does not reach that type-aware rule. Worker B found the same stdin blind spot for `no-console`
in row 1.10, so this is the second sighting.

The receipt is corrected in place, with the false clause struck and kept, and the fix is row 2.19, assigned to C.

**What would have caught it**: a positive control for the probe — a known `strict-boolean-expressions` violation fed
through the same stdin path, shown to be counted — or skipping stdin and comparing two real-file runs on two trees.

## Worker D accepted; C's follow-up mostly accepted (2026-09-14)

**D (2.8–2.10).** The planner's own STDIO drive ran four processes on one workspace and runtime root. The disable
narrowed the next fresh process to no gate parameters, and the enable restored all three on the process after. D's
e2e covers the same sequence over HTTP and re-ran green. The full real-file lint count equals main's (3092), which is the
measurement that later caught C's +4.

Rulings on D's concerns:

- No 19th `verify:mcp` check. `validate:tool-schemas` already fails on a narrowed schema, which D's positive control
  showed.
- `cleanup()`'s unscoped save is killed as 2.22. An effective-scope save would let a second server revert a peer's toggle.
- Loading once at startup is what R7 asks for.

Row 2.10's status clause for `verify:mcp` is superseded as unobservable, rather than silently dropped. D's findings
became rows 2.20 (a header claiming an unmade check) and 2.21 (a test that hangs jest when it fails).

**C's follow-up.** 2.15 and 2.19 are accepted: the README names no removed transport, and `paths.ts` is back to main's
`strict-boolean-expressions` count. The first 2.16 probe exited 1 for "No skills-sync.yaml found", which fails before
the new `MCP_WORKSPACE` check can run, so it proved nothing about the row. It is being re-run with a temp server root that
holds a `skills-sync.yaml`, first without `MCP_WORKSPACE` as the positive control. Same shape as row 1.11's lesson: a
probe must reach the code it claims to test.
