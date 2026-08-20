---
title: "resource_manager settability parity — implementation notes"
date: 2026-08-19
status: active
tags: []
---

# Implementation notes — resource_manager settability parity

Deviation log for `resource-manager-settability-matrix-2026-08-13.md`. Created at plan start
(2026-08-19), before the first source edit, per the deviation-log rule.

## Session log

### 2026-08-19 — plan activated, rows re-measured

No source edits. The plan was `status: backlog` with no notes file and had never been worked as
an initiative, but two of its §8 gaps had been closed incidentally by other sessions:

- Gap #1 (gate `activation`/`retry_config` data loss) — `dc1c5f75`
- Gap #5's `argument_updates` ("Fix D") — `ce93c8ac`, with merge logic riding along in `5c3198b5`

Flipped `status: backlog` → `active`, stamped all five §8 rows with `✓`/`◐`/`☐`, and gave every
open row an as-of date plus a falsifier. §1–§7 prose still describes the 2026-08-13 tree and was
deliberately NOT rewritten — the new §8 "Row status" block is the current-state SSOT.

### 2026-08-19 — owner interview, six decisions recorded

Still no source edits. Ran `/unknowns` Move 3 (interview, one question at a time). Six rulings
landed in the plan's new §10. Two reshaped the work materially rather than just picking an option:

- **D1 collapsed three rows into one design.** Rows 2, 3 and 4 were written as separate gaps; the
  interview's first question surfaced that they are one missing verb. The `unset: [keys]` ruling
  means T2 closes rows 2 and 4 together and removes row 3's schema ambiguity as a side effect.
- **D2 forced D3.** Making explicit tool removal destructive meant preview had to be reachable
  without confirmation, which promoted SF-2 from a cosmetic parity gap to a blocking dependency.
  SF-2's original instrument (adding pairs to `HANDLER_OWNED_CONFIRMATION`) was superseded by
  `action: 'preview'` and is now dead — do not implement it.

Probed during the interview and worth keeping: `[Unreleased]` already carries three breaking
entries, so 5.0.0 was already accruing and D4 costs no extra bump. And
`server/resources/prompts/.gitignore` is deny-by-default (`*` + a 21-line allowlist), 8 of 17
categories allowed — which is what made D5 a decision rather than a cleanup.

## Deviations

_(none yet — no implementation has started)_
