---
title: "Adoption conversion — measure the funnel weekly, then fix the page it breaks on"
date: 2026-09-07
status: active
tags: [adoption, docs, readme, traffic]
---

# Adoption Conversion — Measure the Funnel Weekly, Then Fix the Page It Breaks On

**Status**: ACTIVE — Tier 0 baseline captured 2026-09-07; Tier 1 waits for the second snapshot
**Owner**: minipuft
**Created**: 2026-09-07
**Parent**: `plans/reference/acquisition-recovery.md` (retired 2026-09-07 — its §Retirement scorecard is the
evidence this plan starts from)

## Why this exists

The acquisition-recovery plan closed with acquisition UP and conversion FLAT: Google uniques roughly
2.4× the July baseline, npm downloads ~3× the pre-plan floor at steady state, and stars at 4 in August
and 1 in September against 32 across May–June. That inverts its own diagnosis ("the bottleneck is
acquisition, not conversion"). People now arrive; they do not stay.

Two things made that verdict weaker than it should have been, and this plan fixes both before it
fixes any page:

1. **The baseline was never recorded.** GitHub's traffic API keeps 14 days. The old plan's scorecard
   row for July views reads "not recorded" because nobody snapshotted it while the window was open.
2. **Stars were the goal metric, and stars are the wrong metric.** A Claude Code plugin install is a
   git clone, not a star. The one non-owner issue in 60 days and zero non-owner discussions say more
   about adoption than the star count does.

## Cadence and ledger

- `npm --prefix server run adoption:snapshot` appends one JSON line to
  `plans/adoption-conversion-2026-09-07.ledger.jsonl`. **Owner runs it every Sunday** (ruling
  2026-09-07). Weekly runs overlap by 7 days, so a missed week leaves no gap; a run on the same
  `window_end` is refused rather than duplicated.
- The ledger is tracked. It is the only durable copy of the 14-day traffic numbers.
- The baseline was taken **Monday 2026-09-07**, one day late; its window is 08-23 → 09-05. Every
  later Sunday run lands on a window ending the previous Saturday, which is what the baseline already
  is, so the day-late start costs nothing in comparability.

## Goal metric

**Clone uniques per 14 days, and issues/discussions opened by non-owners.** Stars, views and npm
downloads are recorded and reported but do not decide the plan. A rule is written now so no later
session re-litigates it against a good week:

| Signal                         | Role     | Why                                                                                    |
| ------------------------------ | -------- | -------------------------------------------------------------------------------------- |
| clone uniques (14d)            | **goal** | plugin install = clone; the only in-window trace of someone actually installing        |
| issues + discussions by others | **goal** | someone used it enough to have a question                                              |
| views / uniques / referrers    | funnel   | where they come from and how many; acquisition, not conversion                         |
| top paths                      | funnel   | which page they read second — the drop-off locator                                     |
| npm 14d downloads              | context  | dominated by registry crawlers and CI around releases; read the non-release weeks only |
| stars                          | context  | ~1% of uniques, which is ordinary; too small to move at this traffic level             |
| mcpb asset downloads           | context  | 58 all-time across every release; the Claude Desktop path is effectively unused        |

## Baseline (window 2026-08-23 → 2026-09-05, ledger line 1)

| Metric                         | Value                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| views (uniques)                | 306 (112)                                                                                                          |
| clone uniques                  | 357                                                                                                                |
| stars total / in window        | 186 / 1                                                                                                            |
| npm 14d / 7d                   | 247 / 107                                                                                                          |
| mcpb downloads (all-time)      | 58                                                                                                                 |
| issues / discussions by others | 0 / 0                                                                                                              |
| top referrers (uniques)        | Google 68 · github.com 7 · reddit 3 · Bing 2 · Brave 2                                                             |
| top paths (uniques)            | `/` 53 · `docs/tutorials/build-first-prompt.md` 36 · issues 5 · discussions 4 · pulls 4 · `docs/guides/gates.md` 9 |

**The funnel reading**: about a third of unique visitors (36 of 112) go from the README to the
build-first-prompt tutorial. Almost nobody goes further — the gates guide gets 9. So the tutorial is
where the funnel breaks, and reading it says why: it opens with a `resource_manager` payload and
"Recommended: Author Through MCP" for a reader who arrived from Google and has installed nothing;
there is no prerequisite or install link; the run examples are pseudo-syntax inside `bash` fences;
§3 says "hooks display" without saying whose hooks; `{{now}}` is never explained. The page assumes a
reader who already converted, and it is the page the unconverted land on.

## Tier 0 — Measurement (DONE 2026-09-07)

| #   | Status              | Task                                                                                | Receipt                                                                                    |
| --- | ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0.1 | ✓ DONE (2026-09-07) | Snapshot script over every source in the table above, appending to a tracked ledger | `scripts/snapshot-adoption.mjs`; `adoption:snapshot` + `:dry-run` in `server/package.json` |
| 0.2 | ✓ DONE (2026-09-07) | Capture the baseline                                                                | `plans/adoption-conversion-2026-09-07.ledger.jsonl` line 1, window 08-23 → 09-05           |
| 0.3 | ✓ DONE (2026-09-07) | Name the goal metric so a later session cannot re-choose it against a good week     | §Goal metric                                                                               |

## Tier 1 — Fix the page the funnel breaks on (BLOCKED on ledger line 2)

Nothing here edits before the second snapshot exists (Sunday 2026-09-13). Editing between the
baseline and the first comparison would make the first comparison measure the edit and the noise
together, which is the exact confound the old plan spent August avoiding.

| #   | Status                                                                                                                                                         | Task                                                                                                                                                                                                                                                                        | Falsifier                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1.1 | ☐ (as of 2026-09-07 · flips when the ledger holds 2 lines)                                                                                                     | Second snapshot lands (Sunday 2026-09-13). Confirms the script runs unattended on the owner's box and gives the first Δ                                                                                                                                                     | `wc -l` on the ledger reads 2                                                                               |
| 1.2 | ☐ (as of 2026-09-07 · flips when the tutorial opens with prerequisites and a working install link, and every run example is a real command a reader can paste) | Rewrite `docs/tutorials/build-first-prompt.md` for a reader with nothing installed: prerequisites + install link first; `resource_manager` authoring demoted below the file pattern; real commands (not pseudo-syntax in `bash` fences); "hooks" named; `{{now}}` explained | a reader with a fresh checkout follows the page top-to-bottom and reaches "Run it" without leaving the page |
| 1.3 | ☐ (as of 2026-09-07 · flips when the README's Claude Desktop / MCPB install path is demoted or removed)                                                        | README: demote the MCPB path. 58 all-time asset downloads across every release; keep it in `docs/`, drop it from the top-level install choice                                                                                                                               | `validate:readme` green; the README's install section names no `.mcpb` above the fold                       |
| 1.4 | ☐ (as of 2026-09-07 · flips when a "next page" exists at the tutorial's end that the paths table can see)                                                      | Give the tutorial ONE next step, not five. The paths table shows readers stop after it; a single link to the gates guide makes continuation measurable as `docs/guides/gates.md` uniques                                                                                    | `docs/guides/gates.md` appears in the top paths at ≥ 20 uniques in a window after the change                |

## Tier 2 — Hold and rule (BLOCKED on Tier 1)

| #   | Status                                                                 | Task                                                                                                                                                                                                       | Falsifier                                                |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 2.1 | ☐ (as of 2026-09-07 · flips when the ledger holds 8 post-Tier-1 lines) | **Eight-week hold** after Tier 1 lands. Fourteen-day windows at ~8 uniques/day are noise; one star vs four is not a signal                                                                                 | 8 ledger lines dated after the Tier 1 commit             |
| 2.2 | ☐ (as of 2026-09-07 · flips when 2.1 flips)                            | Rule: did clone uniques or non-owner issues move? Record the verdict here with the two ledger lines it rests on                                                                                            | this row cites `window_end` values, not adjectives       |
| 2.3 | ☐ (as of 2026-09-07 · flips when 2.2 records a verdict)                | If flat: the bottleneck is upstream of the README (the client, the category, the pitch) — write THAT plan; do not rewrite the README a third time. If up: retire this plan to reference with the scorecard | a successor plan exists, or this plan's status is `done` |

## Open questions

| #    | Question                                                                                          | Default                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | Clone uniques include CI runners and registry crawlers. How much of 357 is a person?              | Unknowable from the API. Read the Δ, not the level — crawler volume is roughly constant week to week; people are not                                                                         |
| OQ-2 | Should the Sunday run be a GitHub Action instead of the owner's hands?                            | No, for now. Traffic endpoints need push-scope auth, and an Action committing to `main` weekly adds noise the two-register PR gate would have to exempt. Revisit if a Sunday is missed twice |
| OQ-3 | May–June's 32 stars came from an event nobody logged. Was it a reddit post, a newsletter, a fork? | Not recoverable now. The referrers field in every future ledger line exists so the next event has a source                                                                                   |
