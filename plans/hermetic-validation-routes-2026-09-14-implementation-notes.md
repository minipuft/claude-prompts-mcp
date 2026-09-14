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
