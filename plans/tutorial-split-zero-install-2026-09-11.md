---
title: "Tutorial split and the zero-install path — the two directions not taken"
date: 2026-09-11
status: backlog
tags: [docs, adoption, tutorial, cli]
---

# Tutorial Split (C) and Zero-Install Path (D)

**Status**: ACTIVE — held, every row blocked on a named observation
**Owner**: minipuft
**Created**: 2026-09-11
**Sibling**: `plans/tutorial-rework-2026-09-11.md` executes directions A+B on the existing page.
**Parent**: `plans/adoption-conversion-2026-09-07.md` — row 2.2 records the verdict these rows wait on.

## Why this exists rather than a backlog entry

`cleanup-standards.md` §Plan Rows: a work row has two terminal states, and "filed for later" is not
one. C and D are real work with real costs, deferred on an observation that has a date, so they stay
OPEN rows in a live plan. They are not killed, because the measurement that would justify them has
not run yet; they are not open-now, because running them before that measurement spends a rewrite
against noise.

**The observation they all wait on**: adoption row 2.2 records whether clone uniques or non-owner
issues moved after A+B landed, against 8 post-Tier-1 ledger lines. Until then, a second rewrite of
the same page cannot be attributed.

## What each direction bets

|                      | Bet                                                                   | What makes it wrong                                                                 |
| -------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **C — split**        | Two readers (evaluating vs authoring) need two pages                  | One page can serve both if it is ordered correctly, which is what A+B tests         |
| **D — zero-install** | Hands-on beats installed; a reader who runs something converts better | `cpm` cannot render, so the path ends without the payoff the page exists to deliver |

---

## Tier C — split the page

**The trap, stated first.** The naive split keeps `build-first-prompt.md` as the authoring page and
adds a new `first-run.md`. That is backwards: Google sends **36 uniques per window to the existing
URL**, so a split that leaves authoring at that URL points every cold arrival at the page A+B just
finished demoting. Whichever content is highest-value for a cold reader must keep the URL that
already ranks.

| #   | St                                                                                                          | Change                                                                                                                                                                                      | Depends | Verification                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| C.1 | ☐ (as of 2026-09-11 · flips when adoption row 2.2 records a verdict AND that verdict is "flat")             | **Entry condition.** Split only if A+B measured flat. If A+B moved the goal metric, one ordered page was the answer and this tier is killed rather than executed                            | —       | adoption row 2.2 cites two `window_end` values and a direction                                       |
| C.2 | ☐ (as of 2026-09-11 · flips when a ruling names which content keeps `docs/tutorials/build-first-prompt.md`) | Rule which content keeps the ranking URL. Default: **first-run keeps it**; authoring moves to a new file. A redirect is unavailable — GitHub blob view has none, so the URL IS the decision | C.1     | one file is named as the cold-arrival page and it is the one with existing traffic                   |
| C.3 | ☐ (as of 2026-09-11 · flips when both pages exist and each links the other exactly once)                    | Write the second page. Each page ends with one link to the other; neither reintroduces a five-link exit                                                                                     | C.2     | `docs/README.md` §Tutorials lists both; each page has exactly one forward link                       |
| C.4 | ☐ (as of 2026-09-11 · flips when the ledger holds 4 lines dated after C.3 lands)                            | Hold and measure. The split is judged on the same goal metric as A+B, against `docs/tutorials/` path uniques split across two paths                                                         | C.3     | 4 ledger lines after the C.3 commit; both paths appear in `paths[]` or the second one is dead weight |

---

## Tier D — the zero-install path

**The blocker, stated first.** `cpm` ships `compare config create delete enable-disable guide history
init inspect link-gate list move rename rollback toggle validate`. There is **no `run` and no
`render`**. A reader can scaffold a workspace, author a prompt, and validate it with
`npx -y claude-prompts@latest` and no server running — and then cannot see the prompt render. A
tutorial whose last step is "it validated" has no payoff.

| #   | St                                                                                                           | Change                                                                                                                                                                                                                                                               | Depends | Verification                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| D.1 | ☐ (as of 2026-09-11 · flips when the owner rules render-or-drop)                                             | **Rule the blocker before anything else.** Either `cpm render <id> --args` exists, or D is killed. Documenting a path that ends before the payoff is worse than not offering it                                                                                      | —       | a ruling recorded in this row with a date                                                           |
| D.2 | ☐ (as of 2026-09-11 · flips when `cpm render` renders a bundled prompt with no MCP server running)           | `cpm render` — resolve a prompt from a workspace, apply supplied arguments through the same Nunjucks path the server uses, print the result. Reuse `processTemplate`, do not reimplement: a second renderer that disagrees with the server is worse than no renderer | D.1     | rendering a bundled prompt through `cpm` and through `prompt_engine` produces byte-identical output |
| D.3 | ☐ (as of 2026-09-11 · flips when `cli/` tests cover `render` and `npm run typecheck:tests:ratchet` is green) | Test in the CLI workspace. `cli/` has its own suite the server tests cannot see, and its own Node floor (>=18.18.0 vs the server's >=22.13.0) — a render path using anything newer breaks the standalone surface                                                     | D.2     | `cli/` suite covers render; the CLI still runs on Node 18.18.0                                      |
| D.4 | ☐ (as of 2026-09-11 · flips when a tutorial page reaches rendered output with nothing installed)             | Only now, write the zero-install path into a tutorial. Which page it lands on depends on C.2                                                                                                                                                                         | D.3 C.2 | a reader with no client and no plugin sees rendered output                                          |

---

## Kill conditions

Recorded now so a later session does not treat these as permanently pending:

- **C is killed** if adoption row 2.2 records the goal metric moving on A+B alone. One ordered page
  was the answer; a split would then be a rewrite in search of a problem.
- **D is killed** at D.1 if the owner declines `cpm render`. The remaining rows go with it, and this
  file records the reason rather than leaving four rows open against an impossible payoff.
- **Both are killed** if adoption row 2.3 concludes the bottleneck is upstream of the README, since
  that ruling sends the next plan to the client, the category, or the pitch — not to this page again.
