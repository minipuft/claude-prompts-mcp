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
