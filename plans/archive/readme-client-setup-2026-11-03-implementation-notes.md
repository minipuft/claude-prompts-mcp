---
title: "README Client Setup — Implementation Notes"
plan: readme-client-setup-2026-11-03.md
date: 2026-11-03
status: done
tags: []
---

# Implementation Notes

Deviations, discovered constraints, unknowns, and re-measurements found while
executing the plan. Conservative option taken, logged, work continued.

## Deviations

- 2026-11-03 · row 1.3: the worker built a two-column Claude Code | Codex table. A render through
  `gh api markdown` with github-markdown-css at 830 px showed the Codex column scrolling sideways
  (GitHub tables are `display:block; width:max-content`), so the planner replaced it with two
  stacked sections (`5b2173c7`). `validate:readme` and Prettier had both passed the column layout.
- 2026-11-03 · row 1.4: the owner review moved from chat prose plus an inline preview to an
  evidence-report bundle served locally and opened in T3's browser panel, on the owner's
  instruction. The bundle gained a second round (plan linking) on 2026-11-03.

## Unknowns / gaps found during execution

- 2026-11-03 · linking this plan to the session: `bind-plan.py <plan>` printed "pinned", yet
  `agent-workbench plan show --host claude-code --conversation <session>` read `primary: null`.
  The direct `bind-plan.py bind <plan> --host claude-code --conversation <session>` returned
  `404 not_found`: Agent Workbench resolves plans from its own index, which does not hold a plan
  that exists only on an unmerged worktree branch. The session-local hygiene binding does work
  (this file's Stop-hook tripwire fired). The shell exports no `T3CODE_THREAD_ID`, so a working
  link would land on the Claude session, not the T3 thread. Owner asked in round 2 of the bundle
  which fixes to make; not in this plan's scope.
- 2026-11-03 · not checked on GitHub: whether following a `#setup-*` link opens the folded
  `<details>` it lands on. Check live after merge.
- 2026-11-04 · row 1.5: CI on PR #526 failed `validate:phase-header-drift` (Lint & Validate) and its self-test (both unit jobs). Cause was on `main`, not this branch: `a4dbed49` was pushed without a PR on 2026-11-02 and wrote the plan's Now heading as inline code in the interview prompt (3 lines); main's CI has been red since. Merged main into the branch and reworded the 3 lines (`20a72da4`); the check and its self-test pass locally.
- 2026-11-04 · `Validate Renovate Configuration` (not required) fails on every PR touching a `package.json` since #517 added `assets/demos/src/hero/fixture/package.json` (5 npm files, the check expects 4). Left out of this PR; owner asked whether to fix it separately.
- 2026-11-04 · a plan hook rewrote `plans/backlog/cpm-setup-client-detection-2026-11-03.md` to `status: active` with an empty Now skeleton and created a notes file beside it, after the session read that backlog plan. Restored from git and deleted the notes file.
