---
title: "Implementation notes: type-name-homonyms-2026-10-19"
date: 2026-10-19
status: backlog
tags: []
---

# Implementation notes: type-name-homonyms-2026-10-19

## Rulings

- **R1 (publish)** push+merge. Owner in chat, 2026-10-19: all four groups land together before release PR #473 merges.
- **R2 (shape)** One PR. Rows 1–6 each work on their own branch `refactor/type-homonyms-row<N>`, in a worktree created with `npm run worktree:create`. The planner merges each into `refactor/type-homonyms`. Row 7 runs on the initiative branch after those merges; row 8 runs after row 7. There are 8 rows across more than 3 modules, which would normally trigger a subplanner. This plan stays with one planner because every row has disjoint files and one owner-mandated PR. A subplanner would add a session boundary and gain no parallelism at a cap of 3.
- **R3 (fork per definition)** Measure first with ts-morph `findReferencesAsNodes` on the declaration's name node. A re-export (`export { X } from` / `export type { X }`) is NOT a consumer.
  - (a) No reference outside the declaration and no use in its own file: delete it, together with anything that existed only to serve it.
  - (b) Used only inside its own file: drop `export`. It then stops being a homonym under the ratchet's predicate.
  - (c) Same or compatible shape as another definition: one survives in the lower layer (`shared` < `infra` < `engine`/`modules` < `mcp`, as `validate:arch` enforces), and the others import it. Before merging, list the field-level differences in the handoff. A difference that changes what a consumer may pass or read is a concern for the planner, not a merge.
  - (d) A distinct concept: row 7, named by R4.
- **R4 (rename table, row 7)** The kept name stays on the definition with the most consumers unless stated.
  - `ResourceType`:
    - `modules/versioning/types.ts` and `mcp/tools/resource-manager/core/types.ts` are the same union (`prompt|gate|framework|category`). Dedupe them onto versioning, which keeps `ResourceType`.
    - `modules/skills-sync/service.ts` becomes `SkillsSyncResourceType`.
    - `cli-shared/version-history-types.ts` becomes `HistoryResourceType`. It adds `style` and `config` to what versioning lists for the same history. Report in the handoff whether this is drift between the server and `cpm` histories; do not change the union.
  - `TransportType`: the `infra/http/transport/index.ts` enum becomes `HttpTransportType`. If the two enums are one concept split across layers, report it rather than merging.
  - `ExecutionConfig`: `shared/types/automation.ts` becomes `AutomationExecutionConfig`. The `core-config.ts` one keeps its name, because it feeds `generate:config-schema`, and `config.schema.json` must stay byte-identical.
  - `GateSource`: `engine/gates/types/gate-guide-types.ts` becomes `GateGuideSource`.
  - `ExecutionStep`: `engine/frameworks/types/framework-types.ts` becomes `FrameworkExecutionStep`; `operator-types.ts` keeps the name.
  - `ChainStep`: `engine/execution/parsers/types/operator-types.ts` becomes `SymbolicChainStep`; `shared/types/index.ts` keeps the name.
  - `ValidationError`: the class in `errorHandling.ts` keeps the name. The `engine/execution/types.ts` detail interface becomes `ValidationErrorDetail`.
  - `ValidationResult`: `errorHandling.ts` and `engine/execution/types.ts` are near-identical. Apply R3(c) when the engine shape is a superset; otherwise rename the `errorHandling.ts` one to `ErrorValidationResult`. Report which applied.
  - `ResourceValidationResult`: the `cli-shared/resource-validation.ts` alias is replaced by its target `ResourceVerificationResult` at its consumers. The `shared/utils/resource-loader-types.ts` one gets R3(a or b).
- **R5 (`ResourceManagerInput`)** Owner ruling: treat it as a possible defect. CLAUDE.md §Core Principles 2 says hand-written schemas in `src/mcp/tools/schemas/` own runtime validation. So the Zod-inferred type is what the handler actually receives, and the hand-written interface survives only if it equals it. Fix any field the interface declares that the schema does not accept, or the reverse, toward the schema. A schema change is a tool-surface change and comes back as a concern first.
- **R6 (generated types)** Owner ruling: the contract generator emits `ToolCommand` and `ToolParameter` without `export`. `_generated/` is never hand-edited.
- **R7 (ts-morph)** Build the Project from `tsconfig.test.json`. After any `move` or `rename`, `rg` the touched specifiers for a missing `.js` and restore it. Measure files near ESLint `max-lines` 1000 before renaming. Stage moves before running `validate:all`.
- **R8 (baselines)** Rows 1–7 do not touch `.type-name-homonyms-baseline.json`; its stale entries are expected until row 8. A row that moves the knip or typecheck-tests ratchet reports the counts before → after and regenerates only that baseline.

- **R9 (row 3 concerns, 2026-10-19)** Merge `ProcessingStep`, `FrameworkGate` and `TemplateSuggestion` onto the engine / Zod-inferred types, because those match the runtime schemas in `src/mcp/tools/schemas/` (`processingStepSchema`, `frameworkGateSchema`, `templateSuggestionSchema`). The tool-layer copies promised fields as required, and `marker`, that the schema does not enforce or accept. Same logic: `ExecutionStep.dependencies` becomes optional to match `executionStepSchema`, and its readers handle the absence with `?? []` (no non-null assertion). This loosens types toward what the server already receives; it is not a tool-surface change.

- **R10 (row 4 concern, 2026-10-19)** `TemporaryGateDefinition` is two concepts: `engine/execution/types.ts` is the pre-registration draft (no `id`/`created_at`, consumed by `gate-analyzer.ts`), and `gates/core/temporary-gate-registry.ts` is the stored record. Row 7 renames the execution one to `TemporaryGateDraft`; the registry keeps the name. Typing between them is not unified in this plan. When two same-layer copies merge (`PromptLookup`), the survivor is the one its other consumer already imports from.

## Measured inputs (origin/main `ee3986e2`, 2026-10-19)

- 37 baseline names over 87 exported definitions. Reference counts per definition come from ts-morph `findReferencesAsNodes`, run over a snapshot of `server/src` + `server/tests`. The counts include barrel re-export sites, which R3 says are not consumers, so every count is re-measured by the row.
- 24 definitions had no reference outside their own declaration. The `_generated` `ToolCommand`/`ToolParameter` (8 definitions) are among them.

## Deviations

- **DEV-T1-1** R8 revised on 2026-10-19 after the client crash. Rows 1–7 commit NO ratchet baseline, because every row lowers the same counts and parallel commits to one JSON file conflict. Row 8 regenerates eslint, knip, typecheck-tests and homonyms once, on the merged tree. Row 2 had already committed a knip baseline (613 → 603 types); row 8's regeneration supersedes it.
- **DEV-T1-2** All three running rows were stopped by a client crash, with uncommitted edits in their worktrees. They were resumed through their saved transcripts, and each re-read its own diff before continuing.

## Findings

- Row 4: load average on this box reached 35–43 on 9 cores with 3 workers and 2 other sessions. A whole-project `lint:ratchet` took >10 min and was killed once at the background limit. Run ratchets in the foreground, one at a time.

- Row 3: the left-over probe state (three pairs merged) typechecked clean; it was restored before the row committed. `step-gate`-style near-twins under different names (`ExecutionStepDefinition`, `ProcessingStepDefinition` in step-generator) are invisible to the homonym ratchet; out of scope. `template-enhancer.ts:27` re-exports `ProcessingStepDefinition` as a second import path; unchecked.

- Row 1: `.husky/commit-msg` strips `Co-Authored-By: Claude` trailers on purpose (project policy), so briefs no longer ask for one.
- Row 1: `shared-types.ts` survives only as a one-line re-export of `ErrorContext`, because `mcp/tools/shared/structured-response-builder.ts:13` imports it from there. Row 7 repoints that import and deletes the file. `ConfigError` in `errorHandling.ts` has 0 references; it is not a homonym, so it is out of scope.

- Row 2: deleting a definition can orphan others (`GateRequirement`, `GateRequirementType`, and `GateType` in gate-definitions), so re-measure after each cut. `engine/gates/types.ts` and the directory `engine/gates/types/` coexist; `'../types.js'` resolves to the file.
- Row 2: `engine/gates/types.ts` still holds unmeasured, possibly unused types (`ValidationContext`, `GateActivationResult`). They are outside this plan's objective (not homonyms).
