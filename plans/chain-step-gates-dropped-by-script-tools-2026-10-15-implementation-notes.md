---
title: Chain-step gate plan notes
date: 2026-10-27
status: active
plan: chain-step-gates-dropped-by-script-tools-2026-10-15.md
tags: [gates, chains]
---

# Chain-step gates — implementation notes

## 2026-10-27 — rows 1.1–1.3, 2.3, 2.4 cut on `fix/chain-step-gates`

- Owner ruling: hold at the local branch, no PR until the README hero demo is final; rows 2.1/2.2
  and the hook built-in routing (already in the tree) were committed first as the base.
- Three workers in one checkout, one row group each; the planner split the one shared file
  (`gate-enhancement-service.ts`) by hunk so each commit carries one row.
- Checks run at the end: `typecheck`, `lint:ratchet`, `typecheck:tests:ratchet`, `validate:arch`,
  the six unit files of the rows (84 tests), `shell-verify-step-hold.e2e.test.ts` against a dist
  rebuilt from the branch (27 tests). `validate:all` and `test:all` are left for the PR boundary.

## Deviations

- DEV-2.3-1: the brief named the verdict path only; the flip condition ("the shell result is
  shown") had no producer for a passing inline `:: verify:` check, so `response-assembler.ts` gained
  a `Shell Verification Results` section for chain replies and two docs got a paragraph. A
  single-prompt `:: verify:` pass still renders no result (not in scope; noted in the plan row).
- DEV-2.3-2: `gradedNodeLeftStanding` was first placed beside `DeferredAdvance` in
  `gate-verdict-processor.ts`, which pushed that file over `max-lines` and failed `lint:ratchet`;
  the planner moved it to `execution/pipeline/decisions/gates/graded-node-left-standing.ts` with a
  structural parameter type, which is where the other pure gate decisions live.
- DEV-2.4-1: half 2 of the row changed `chain-step-gate-bindings.ts` (the chain prompt's own gate
  resolution input lacked `frameworkId`) and two docs the brief did not name, for docs/code lockstep.
- DEV-1.x-1: the row's test imported `ParsedCommand` from a module that does not export it and cast
  a partial step plan directly; `typecheck:tests:ratchet` caught both (baseline 0 → 3) and the
  planner fixed them in the row's commit.

## Open

- Bundle membership of `creed-fidelity` and the RADIANT / liquescent frameworks (owner question
  in row 2.4): cloudySky has no resource workspace to move them into.
- Third shape (system_message update without a yaml pointer): not started.
- Retake of the hero demo against this branch's dist: retry scenario, shorter feature string.

## 2026-10-28 — publish ruling

- Owner ruling 2026-10-28: approve the cut, split the branch into one PR per outcome and open them; the framework removal (RADIANT, liquescent) follows immediately after the split as its own slice. `publish: push`; merging is the owner's call on review.
