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

### DEV-T1-1 — D5's destination is read-only through the tool (2026-08-27)

**Conservative option taken**: stopped before the first T1 edit and escalated, rather than moving
prompts into a destination the write path cannot reach.

Probed the write path because D5 assumes prompts round-trip through the overlay. They do not.
`data-loader.ts:123` merges overlay dirs at LOAD, so overlay prompts execute fine — but both write
sites (`file-operations.ts:248`, `:452`) resolve the single
`configManager.getResolvedPromptsDirectory()`. An update to an overlay-resident prompt would fork a
copy into `server/resources/prompts/`. Recorded as plan row T1-F1.

The reusable shape: **read-overlay and write-overlay are separate capabilities, and the presence of
the first is not evidence of the second.** CLAUDE.md's "Workspace resources overlay bundled ones"
is a statement about loading; nothing in it says a write lands where the read came from. The plan
inherited the ambiguity from the handbook sentence.

### DEV-T1-2 — the overlay destination is inside the repo (2026-08-27)

`MCP_WORKSPACE` measured off the live server is the repo root itself, so `getOverlayResourceDirs`
resolves `<repo>/prompts/` and `<repo>/resources/prompts/` — the migration would move personal
prompts from one in-repo ignored directory to another. Recorded as plan row T1-F2.

Worth keeping: the earlier session verified "MCP_WORKSPACE resolves to the repo" and treated that
as a healthy signal (the repo's own server is what runs). It is the same fact, and for D5 it is the
defect. A measurement's polarity depends on the question asked of it.

### DEV-T1-3 — deleting the gitignore retires a live subsystem (2026-08-27)

`readCategoryShipStatus` reads the very file D5 deletes, and returns `ships: true` when it is
absent. Three consumers go permanently constant. Recorded as plan row T1-F3.

Found by grepping the write path for the gitignore _path literal_ rather than for "gitignore" as a
concept — the same semantic-capability framing that has caught private duplication before.

### DEV-T1-4 — D6's block is over-broad (2026-08-27)

D6 blocks T2-T4 behind T1 on a review-integrity argument about **file deletion**. T2 and T4 delete
no prompt files, so the argument does not reach them. Superseded in plan §11.3: T1 blocks T3 only.
Not a defect in D6 — a scope the interview did not need to draw at the time, and drawing it now
unblocks two tiers while D5 is re-decided.

### Environment

Work moved to worktree `../claude-prompts-mcp-settability` on branch `feat/settability-parity`
(2026-08-27), because three sibling worktrees hold live uncommitted work — one of them
(`-feat-workbench-governance`) is editing `prompt-lifecycle-processor.ts`, which T2 and T3 also
touch. `core.hooksPath` verified still relative and `.husky/_` regenerated via `npm install`, so
hooks actually fire here — the failure recorded in PR #239.

### DEV-T1-5 — the read/write split was the whole of T1-F1 (2026-08-27)

T1-F1 was filed as "the overlay is read-only through the tool", which framed it as an overlay
limitation and implied overlay-aware write plumbing. Probing one level further showed the cause is
narrower: `ConfigManager` contains zero references to `PathResolver` and resolves the write
destination against the config file alone, while reads go through the full resolution chain. The
overlay was never the constraint — path resolution simply had two implementations and only one of
them was wired to the environment.

Superseded in plan §12.1. T1.1 shrank from "make writes overlay-aware" (M-L) to one delegation plus
one constructor argument (S), and it is the fix the remaining T1 rows build on rather than a step
toward them.

Reusable: **when a capability appears missing on one side of a read/write pair, check whether the
two sides share a resolver before designing the missing half.** The first framing would have built
overlay-aware writing on top of a write path that still could not see `MCP_RESOURCES_PATH`, and the
new code would have inherited the defect it was meant to fix.

### DEV-T1-6 — the negative control changed what the green run meant (2026-08-27)

The T1.1 probe passed on first run against the patched build. Rather than accept it, stashed the
source change, rebuilt, and re-ran: the create landed in the package tree, `isError: true`. Only
then was the passing run evidence.

This is the `feedback_surface_check_vs_end_to_end` and `feedback_mutation_never_reached` pattern
arriving together — a probe that has never been observed to fail is consistent with a working fix
AND with a probe that cannot fail. The control cost one rebuild.

It also surfaced T1-F4 (a response opening `✅ **Prompt Created**` while carrying `isError: true`),
which the passing run could not have shown, because in the passing run there is no error to
mis-narrate. **A negative control is a second observation, not a repeat of the first.**

### Environment note

The control run wrote a probe prompt into the worktree's own `resources/prompts/analysis/` (that
being the defect it was demonstrating). Removed; `git status` verified clean apart from the four
intended files.
