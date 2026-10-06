---
title: "Tutorial split and zero-install path — implementation notes"
date: 2026-09-11
status: active
tags: [docs, adoption, tutorial, cli]
---

# Implementation Notes — `plans/tutorial-split-zero-install-2026-09-11.md`

## Execution state

**Nothing has executed and nothing is scheduled to.** Every row in this plan is blocked on an
observation with a date, and the earliest of those (adoption row 2.2) sits behind an eight-week hold
that has not started, because the hold starts when A+B lands and A+B is itself blocked until
2026-09-13.

This file exists so the plan is checkable, not because work is in flight.

## Why this is a live plan and not a backlog entry

`cleanup-standards.md` §Plan Rows gives a work row two terminal states, done or killed, and names
"filed for later" as a relocation rather than a state. C and D are real work with real costs,
deferred on observations that have dates — the shape the same rule explicitly permits ("Row blocked
on an external event → stays OPEN; plan stays active"). Putting them in `plans/backlog/` would have
been the error that rule exists to prevent: a backlog may hold evidence maturing toward a pattern,
never work someone must eventually do.

Each tier carries its own kill condition for the same reason. A row that can only ever be done, and
never killed, is a row nobody will ever close.

## The two things a later session should not re-derive

- **C's URL trap.** The naive split — keep `build-first-prompt.md` as the authoring page, add a new
  `first-run.md` — points every cold arrival at the page A+B just finished demoting, because Google
  sends its traffic to the URL that already ranks and GitHub blob view offers no redirect. Measured:
  36 uniques per window on `/blob/main/docs/tutorials/build-first-prompt.md`. Whichever content is
  highest-value for a cold reader keeps that URL; the other one moves.
- **D's blocker is structural, not a gap in the docs.** `cli/src/commands/` holds sixteen commands
  (`compare config create delete enable-disable guide history init inspect link-gate list move
rename rollback toggle validate`) and none of them renders a prompt. A zero-install tutorial can
  therefore reach "it validated" and no further. That is why D.1 rules render-or-kill BEFORE
  anything else in the tier: writing the page first would produce a tutorial with no payoff and no
  way to notice.

## Deviations

None — no execution has occurred.
