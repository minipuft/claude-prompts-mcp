---
title: "README client setup: one generated client table, two headline installs"
date: 2026-11-03
status: done
tags: [docs, readme, scripts]
---

# README Client Setup

**Status**: DONE 2026-11-05. The client table (#526) and the README heading and developer-setup fixes (#528) merged; the last row, a docs page on how this repo is run, closes the plan.
**Owner**: minipuft
**Created**: 2026-11-03

## Now (2026-11-05, closed)

**Goal reached**: a reader finds their client's install steps and its hook coverage in one place, and hook coverage is written once; a contributor reads how a change moves from plan to release on one page.
**Slice**: every row ✓; row 2.2's page shipped in #530 and moved to the owner's private notes the same day (R17).
**Next decision**: none; the owner reviews the row 2.2 PR.
**Constraint in force**: none.

## Why this exists

The README spread client setup over three sections and stated hook coverage by hand in three places
(the "Is this for me?" list, the With Hooks paragraph, `docs/reference/client-capabilities.md`). The
hero caption under the video also re-told the story the video already shows.

## Rulings

| #   | Ruling                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | **Owner, 2026-11-02: the caption drops the replay line.** A viewer sees the video; how to replay its source is not reader information.                                                                                                                                                                       |
| R2  | **Owner, 2026-11-02: hook coverage is generated**, from `docs/reference/clients.json`, and the wording follows the `readme_improver` standards and the README charter.                                                                                                                                       |
| R3  | **Owner, 2026-11-02: Claude Code stays the main example; Codex gets equal prominence.** Columns were tried and overflowed at GitHub's README width, so the two installs are stacked sections (planner).                                                                                                      |
| R4  | **Owner, 2026-11-02: preview before the merge.**                                                                                                                                                                                                                                                             |
| R5  | **Owner, 2026-11-03 (interview round 1): open the PR and merge once its checks pass.**                                                                                                                                                                                                                       |
| R6  | **Owner, 2026-11-03: each client's name is the link; the Steps column is dropped.**                                                                                                                                                                                                                          |
| R7  | **Owner, 2026-11-03: the unused demo GIFs are removed in this PR**, and the plan that produced them is retired.                                                                                                                                                                                              |
| R8  | **Owner, 2026-11-03: how the repo is run becomes a docs page that Contributing links to, written after this PR.**                                                                                                                                                                                            |
| R9  | **Owner, 2026-11-03: `cpm setup` is written down as a backlog plan; no work starts.**                                                                                                                                                                                                                        |
| R10 | **Owner, 2026-11-04: the custom resources text becomes a `### Your own prompts` heading under What You Get**, next to the primitives it is about.                                                                                                                                                            |
| R11 | **Owner, 2026-11-04: the three copies of the developer setup become one block in Contributing.**                                                                                                                                                                                                             |
| R12 | **Owner, 2026-11-04: no README checker rule for unheaded bold-lead paragraphs**; this instance is fixed by hand.                                                                                                                                                                                             |
| R13 | **Owner, 2026-11-05: the page is for contributors**, an explanation of how a change moves from plan to release and why each gate exists.                                                                                                                                                                     |
| R14 | **Owner, 2026-11-05: it covers plans and rulings, PR and CI gates, and fleet standards**; agent sessions (Claude and Codex sessions, planner and worker roles, a worktree per session, hooks, interviews) are left out.                                                                                      |
| R15 | **Owner, 2026-11-05: it lives at `docs/concepts/how-this-repo-is-run.md`**, linked from CONTRIBUTING.md and from the README's Contributing section.                                                                                                                                                          |
| R16 | **Owner, 2026-11-05: the stale file-based storage section of `docs/portfolio/design-decisions.md` is corrected in the same PR**: runtime state is one SQLite file (ADR 0005), prompts, gates and frameworks stay files on disk with hot-reload; current state only.                                          |
| R17 | **Owner, 2026-11-05: the "how this repo is run" page is a personal maintainer reference, not a public document**; it moves to the owner's private notes, and its README, CONTRIBUTING and docs index links are removed. Supersedes R15's location; R16 and the corrected CONTRIBUTING hook list stay public. |

## Tiers

| Row | Status                                                                                                                                               | Tier        | Files                                                                                               | Depends | Verify                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| 1.1 | ✓ 2026-11-02 · `8e7a2ba7`; caption is two sentences, no replay line                                                                                  | worker-high | `README.md`                                                                                         | —       | `validate:readme`                                               |
| 1.2 | ✓ 2026-11-02 · `8e7a2ba7`; 9 clients in one file; `--check` exit 0 clean, exit 1 after a hand edit of one Hooks cell, exit 0 restored                | worker-high | `docs/reference/clients.json`, `server/scripts/generate-client-matrix.js`, `client-capabilities.md` | —       | `validate:client-matrix` with its planted edit                  |
| 1.3 | ✓ 2026-11-03 · `5b2173c7`; two stacked sections; the column layout scrolled sideways at 830 px in a GitHub-CSS render                                | planner     | `README.md`                                                                                         | 1.1     | render through `gh api markdown` at 830 px                      |
| 1.4 | ✓ 2026-11-04 · round 1 answered in `answers.json` (5 of 5 choices); rulings R5–R9                                                                    | owner       | `.grade/2026-11-03/readme-client-matrix/`                                                           | 1.3     | `render.mjs --md` shows every question answered                 |
| 1.5 | ✓ 2026-11-04 · #526 merged as `49dddae7`; checked live, signed out: table, name links and folded sections render; a link lands on its section closed | planner     | —                                                                                                   | 1.4     | `gh pr view 526` reads MERGED                                   |
| 1.6 | ✓ 2026-11-04 · client names link to their steps; the Steps column is gone (R6)                                                                       | planner     | `server/scripts/generate-client-matrix.js`, `README.md`                                             | 1.4     | `validate:client-matrix`                                        |
| 2.1 | ✓ 2026-11-04 · six files removed (R7); the old plan is `plans/archive/demo-video-plan.md`, `status: done`; `rg` finds no other reference             | worker-low  | `assets/demos/*.gif`, `assets/demos/skills-export.tape`, `plans/demo-video-plan.md`                 | 1.4     | `rg` for each file name returns no reference outside history    |
| 2.2 | ✓ 2026-11-05 · shipped #530, then moved to private notes (R13–R17)                                                                                   | worker-high | `docs/`, `README.md`                                                                                | 1.4     | `validate:readme`                                               |
| 2.3 | ✓ 2026-11-04 · `plans/backlog/cpm-setup-client-detection-2026-11-03.md`, `status: backlog` (R9)                                                      | planner     | `plans/backlog/`                                                                                    | 1.4     | file exists with `status: backlog`                              |
| 3.1 | ✓ 2026-11-04 · `### Your own prompts` under What You Get carries the custom resources text (R10); More Client Setups ends after the last client      | planner     | `README.md`                                                                                         | 1.5     | `validate:readme`                                               |
| 3.2 | ✓ 2026-11-04 · one "run from source" block in Contributing; the Quick Start dev-setup fold and the From source paragraph are gone (R11)              | planner     | `README.md`                                                                                         | 1.5     | `rg "development setup\|From source" README.md` returns nothing |
