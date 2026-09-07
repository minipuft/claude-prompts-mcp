---
title: "Adoption conversion — implementation notes"
plan: adoption-conversion-2026-09-07.md
date: 2026-09-07
status: active
tags: [adoption, implementation-notes]
---

# Adoption Conversion — Implementation Notes

Deviation log for `adoption-conversion-2026-09-07.md`. Session voice; the plan carries the reader
voice.

## Rulings

| #   | Date       | Ruling                                                                                   |
| --- | ---------- | ---------------------------------------------------------------------------------------- |
| R1  | 2026-09-07 | Owner runs the snapshot by hand every Sunday; no GitHub Action (plan OQ-2 records why)   |
| R2  | 2026-09-07 | Goal metric is clone uniques + non-owner issues/discussions. Stars are context only      |
| R3  | 2026-09-07 | No docs edit before ledger line 2 exists — the first comparison must measure noise alone |

## Deviations

| #      | Date       | Deviation                                                                                                                                                                                            | Consequence                                                                                                                                                            |
| ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-01 | 2026-09-07 | Baseline captured on a Monday, one day after the Sunday cadence the owner set ("we are a day late on this for now")                                                                                  | None for comparability: GitHub's window ends on the last full UTC day, so the baseline window (08-23 → 09-05) ends on a Saturday, same as every future Sunday run will |
| DEV-02 | 2026-09-07 | First dry run 404'd: the bare repo endpoint was requested with a trailing slash (`repos/owner/repo/`). Fixed by branching on an empty path                                                           | Caught before any ledger write. The duplicate-window refusal was then exercised as the positive control: a second real run refused and the ledger stayed at one line   |
| DEV-03 | 2026-09-07 | The first cut of the ledger was destined for `plans/archive/` alongside the retired parent plan; `plans/archive/` is gitignored here, which would have made the only durable traffic copy local-only | Ledger placed as a tracked sidecar beside the active plan instead. Name deliberately does not match `*.validation-log.md`, the one sidecar pattern the repo ignores    |
