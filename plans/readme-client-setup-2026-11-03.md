---
title: "README client setup: one generated client table, two headline installs"
date: 2026-11-03
status: active
tags: [docs, readme, scripts]
---

# README Client Setup

**Status**: ACTIVE. Tier 1 is built on `docs/readme-client-matrix` (unpushed); the owner reviews it through the interview page before the PR opens.
**Owner**: minipuft
**Created**: 2026-11-03

## Now (2026-11-03)

**Goal**: a reader finds their client's install steps and its hook coverage in one place, and hook coverage is written once.
**Current slice**: Tier 1, rows 1.1–1.3 committed (`8e7a2ba7`, `5b2173c7`); row 1.4 is the owner's review.
**Next decision**: the owner's answers in the interview bundle `.grade/2026-11-03/readme-client-matrix/` (gitignored, local).
**Constraint in force**: nothing merges before the owner has seen the rendered preview (R4).

## Why this exists

The README spread client setup over three sections and stated hook coverage by hand in three places
(the "Is this for me?" list, the With Hooks paragraph, `docs/reference/client-capabilities.md`). The
hero caption under the video also re-told the story the video already shows.

## Rulings

| #   | Ruling                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Owner, 2026-11-02: the caption drops the replay line.** A viewer sees the video; how to replay its source is not reader information.                                                                  |
| R2  | **Owner, 2026-11-02: hook coverage is generated**, from `docs/reference/clients.json`, and the wording follows the `readme_improver` standards and the README charter.                                  |
| R3  | **Owner, 2026-11-02: Claude Code stays the main example; Codex gets equal prominence.** Columns were tried and overflowed at GitHub's README width, so the two installs are stacked sections (planner). |
| R4  | **Owner, 2026-11-02: preview before the merge.**                                                                                                                                                        |

## Tiers

| Row | Status                                                                                                                                | Tier        | Files                                                                                               | Depends | Verify                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------ |
| 1.1 | ✓ 2026-11-02 · `8e7a2ba7`; caption is two sentences, no replay line                                                                   | worker-high | `README.md`                                                                                         | —       | `validate:readme`                                            |
| 1.2 | ✓ 2026-11-02 · `8e7a2ba7`; 9 clients in one file; `--check` exit 0 clean, exit 1 after a hand edit of one Hooks cell, exit 0 restored | worker-high | `docs/reference/clients.json`, `server/scripts/generate-client-matrix.js`, `client-capabilities.md` | —       | `validate:client-matrix` with its planted edit               |
| 1.3 | ✓ 2026-11-03 · `5b2173c7`; two stacked sections; the column layout scrolled sideways at 830 px in a GitHub-CSS render                 | planner     | `README.md`                                                                                         | 1.1     | render through `gh api markdown` at 830 px                   |
| 1.4 | ☐ owner review of the rendered preview and the open questions (as of 2026-11-03 · flips when `answers.json` lands in the bundle)      | owner       | `.grade/2026-11-03/readme-client-matrix/`                                                           | 1.3     | `render.mjs --md` shows every question answered              |
| 1.5 | ☐ PR opened, CI green, merged (as of 2026-11-03 · flips when the owner approves publishing in 1.4)                                    | planner     | —                                                                                                   | 1.4     | `gh pr view --json state` reads MERGED                       |
| 2.1 | ☐ remove the six unused demo GIFs and retire `plans/demo-video-plan.md` (as of 2026-11-03 · flips when the owner rules on it in 1.4)  | worker-low  | `assets/demos/*.gif`, `assets/demos/skills-export.tape`, `plans/demo-video-plan.md`                 | 1.4     | `rg` for each file name returns no reference outside history |
| 2.2 | ☐ a "How this repo is run" docs page linked from Contributing (as of 2026-11-03 · flips when the owner rules on it in 1.4)            | worker-high | `docs/`, `README.md`                                                                                | 1.4     | `validate:readme`                                            |
| 2.3 | ☐ a backlog plan for `cpm setup` client detection (as of 2026-11-03 · flips when the owner rules on it in 1.4)                        | planner     | `plans/backlog/`                                                                                    | 1.4     | file exists with `status: backlog`                           |
