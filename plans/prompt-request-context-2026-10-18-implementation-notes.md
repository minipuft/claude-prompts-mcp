---
title: "Implementation notes — prompt-request-context-2026-10-18"
date: 2026-10-18
status: backlog
tags: []
---

# Implementation notes — prompt-request-context-2026-10-18

## Rulings

- **R1 (publish)** push+merge, owner in chat 2026-10-18. The PR merges before release PR #473; release-please then rebuilds #473 from `main`, so the slice ships in 6.0.
- **R2 (shape)** One PR, title `refactor(execution): …` (scope `execution` is in `commitlint.config.mjs`). The CHANGELOG entry is decided at the PR boundary with `/changelog-generator`: an internal type rename is not consumer-observable.
- **R3 (name)** The pipeline class becomes `PromptRequestContext` in `prompt-request-context.ts`. It names the one tool it serves (`prompt_engine`) and its lifetime (one request), and keeps "Context", the word Koa/NestJS readers recognize. No "Run": `chain_runs` already means state that outlives a request. Only the class symbol and its file move. Different concepts that merely share the suffix stay as they are: `HookExecutionContext` (43 refs), `FormatterExecutionContext` (23), `FrameworkExecutionContext` (17), `generateExecutionContext` (40), `GateReviewExecutionContext`, `BaseExecutionContext`, `ChainExecutionContext`, `ExecutionContextType`. Local variables named `executionContext` stay too.
- **R4 (argument context)** Rename to `ArgumentContext`. Drop `conversationHistory` (written `[]`, never read), `systemContext` (written `{}`, never read) and `userSession` (never written, never read). Keep `environmentVars` and `promptDefaults`, which are read once each. Measured with `rg` on main `728bb169`; the worker re-measures before dropping.
- **R5 (docs SSOT)** `sqlite-persistence.md` §The Map is the single table map. The overview's state section describes three lifetimes and links to the Map rather than repeating table names, because a restated table list is exactly what drifted (four retired table names plus `runtime-state/*.json`). The validator guards the Map, not the overview.
- **R6 (homonym ratchet)** Predicate: `^export (declare )?(interface|type|class|enum|abstract class) <Name>` in `server/src/**/*.ts`. A name with ≥2 definitions is a homonym. The baseline is the sorted NAME list, so a new homonym fails even when another one is removed in the same change. A baseline entry that is no longer duplicated also fails, which forces the baseline down. 38 names on main `728bb169`; `ExecutionContext` leaves after rows 1–2.
- **R7 (branch mode)** `branch_mode: shared-tree` in worktree `claude-prompts-mcp-request-context`, branch `refactor/prompt-request-context`. Each worker commits only the paths its row names. Rows 3 and 5 may run concurrently (disjoint paths); all other rows run serially.
- **R8 (baselines)** When a row moves an eslint/knip/typecheck-tests ratchet baseline (a renamed file re-keys entries; a deleted dead export lowers knip), the worker regenerates only the affected entries and reports the authored count against the measured one.

## Measured inputs (main `728bb169`, 2026-10-18)

- `ExecutionContext`: 894 occurrences, 53 src files, 85 test files. 81 files import the class through a path ending in `execution-context`.
- Non-TS readers of the name or path: `eslint-rules/claude-plugin.js:3`, `scripts/validate-tool-parameter-reads.js:671` (comment), `scripts/validate-operator-registry-drift.js:72` (a regex matching `resolveFrameworkToken(context: ExecutionContext)`: it goes silent if left unrenamed), `scripts/validate-scoped-framework-reads.js:75` (`generateExecutionContext`, which is out of scope under R3).
- Docs naming the class: `overview.md` ×4, `design-decisions.md:170,174`, `ralph-loops.md:397`.
- No validator reads `sqlite-persistence.md` §The Map (`validate-table-contracts.ts` checks code only).

## Deviations

- **DEV-T1-1** Row 1 committed a shorter subject than briefed: the brief's was 106 characters, over commitlint `header-max-length` 100. Briefs now check subject length before sending.

## Findings

- Row 1: no ratchet moved. Knip never counted the deleted interfaces, so knip stayed at 1049.
