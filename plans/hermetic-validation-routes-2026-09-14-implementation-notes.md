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

## Deviations

None yet.
