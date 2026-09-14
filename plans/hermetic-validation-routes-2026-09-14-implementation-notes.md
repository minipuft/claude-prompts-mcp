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
