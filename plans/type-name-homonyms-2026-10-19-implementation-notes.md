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

- **Q1 (RULED B, owner 2026-10-19: fully fixed in this PR, with each concern in its own commit)** `ResourceManagerInput`: the investigation found real drift that is larger than a type merge. (1) 8 parameters (`tools`, `phases`, `tool_descriptions`, `quality_indicators`, `activation`, `retry_config`, `gates`, `gate_configuration`) are `unknown` in the schema, yet the router reads them as typed shapes, so a wrongly shaped value passes through unchecked (e.g. `improvementHints.length > 0` on a number is silently false). (2) `argument_suggestions[].frameworkReason` is required in the framework types but optional in the schema. (3) HTTP callers (`api.ts`, `prompt-authority-api.ts`) build raw input typed as parsed input. (4) A `pass_criteria` string filter in the router is dead under the schema type. Fixing (1) means refusing wrongly shaped values: a resource_manager behavior change.

- **R11 (row 6b)** The schema in `src/mcp/tools/schemas/` owns runtime validation (CLAUDE.md §Core Principles 2). For each of the 8 loose parameters, find where its shape is validated today. If a downstream validator already refuses a wrong shape by name, the gap is typing only: type the handler with that validator's output. If nothing validates it, give the schema the real shape, so a wrong shape is refused at the boundary with the parameter named. A downstream type stricter than the schema widens to the schema (as R9). HTTP callers that build raw input use the schema's input type (`z.input`). The `.passthrough()` catch-all key is stripped by a declared-keys helper type so `Omit<>` derivatives keep their fields. Refusing a previously accepted wrong shape is a behavior change: a CHANGELOG `### Changed` entry plus one test per field. Commits: (1) schema shape checks + tests + changelog, (2) type unification.
- **R12 (row 9)** `TransportType {STDIO}` (logger only) and `HttpTransportType {STREAMABLE_HTTP, BOTH}` (HTTP transport only) are partial copies of `TransportMode`, and both are compared against `TransportMode` values. Superseded fork: delete both, compare against the `TransportMode` literals. No behavior change.
- **R1 note** Merge order: this PR still merges before #473.

- **R13 (row 10, from the `>>diagnose` run chain-diagnose#2)** `version_history.resource_type` is one column with two writers. Server: prompt, gate, framework, category, config (`config-utils.ts:154`). cpm: prompt, gate, framework, config. `style` has no writer. One type names what the column HOLDS: `StoredResourceType = 'prompt'|'gate'|'framework'|'category'|'config'`, in `shared/types/version-history.ts`. Server `ResourceType = Exclude<StoredResourceType,'config'>`, which keeps R53: no MCP config write surface. cpm `HistoryResourceType = Exclude<StoredResourceType,'category'>`. No schema bump; the column is plain TEXT.
- **R14 (defaults applied; owner may override before merge)** (a) cpm keeps not reading category history, stated in its type comment. (b) cpm refuses `style` by name for history, compare, rename and delete, as `rollback` already does. The cast at `version-history.ts:675` becomes a guard that admits only prompt, gate and framework to byte restore; any other value gets a projection-only result with a named reason.

- **Q2 (RULED, owner 2026-10-19: publish the real shapes, raise the ceiling to fit)** Row 6b validates with `<loose>.pipe(<shape>)`, so calls are checked but `tools/list` stays loose (36,365 bytes; publishing measured 38,409 against a 37,000 ceiling). Row 6c drops the `.pipe()` so the published schema is the validated one, and raises the `resource_manager` ceiling in `tests/snapshots/mcp-input-schema-sizes.json` to the next 1,000 above the measured size, keeping the headroom the other two tools carry.
- **Q3 (RULED, owner 2026-10-19: yes)** The changelog entry for the eight shape-checked parameters is marked BREAKING, with the migration (`activation.frameworks` -> `activation.framework_context`) first. Row 6c.
- **Q4 (RULED, owner 2026-10-19: fix in this PR)** Row 12 rewrites the stale wording in the bundled authoring prompts through `resource_manager`, against a server built from this branch (CLAUDE.md §Core Principles 1: no hand edits under `server/resources/prompts/**`).

- **F-12 (finding, out of scope per the Scope objective)** `resource_manager`'s prompt `tools` writer serializes `schema.json` with `JSON.stringify(schema, null, 2)` (`mcp/tools/resource-manager/prompt/operations/file-operations.ts`, `planToolFiles`): no trailing newline, one array entry per line. Every tool-adapter update therefore fails `validate:format` until prettier runs over it. Row 12 ran prettier on the three files it wrote. A writer that emits the repo's format, or a gate, is follow-up work.

## Measured inputs (origin/main `ee3986e2`, 2026-10-19)

- 37 baseline names over 87 exported definitions. Reference counts per definition come from ts-morph `findReferencesAsNodes`, run over a snapshot of `server/src` + `server/tests`. The counts include barrel re-export sites, which R3 says are not consumers, so every count is re-measured by the row.
- 24 definitions had no reference outside their own declaration. The `_generated` `ToolCommand`/`ToolParameter` (8 definitions) are among them.

## Deviations

- **DEV-T1-4** R14 said the byte-restore guard admits only prompt, gate and framework. The server already byte-restores categories (`category-versioning-processor.ts:89` → `planByteRestore`), so the shared guard admits `category` too. At the cpm call site a category cannot arrive, because `HistoryResourceType` excludes it. R14 is superseded on this point. cpm `delete`/`rename` on a style still act on the files and skip a history step that touched 0 rows; refusing them would remove a working cpm command, and nobody asked for that.
- **DEV-T1-5** Row 7's ts-morph rename reprinted `cli/src` files with double quotes (e.g. `rollback.ts:233` `kind: "file"`). That broke `cli-tree-parity.test.ts:478`, which pins the source text. Row 11 undoes it.

- **DEV-T1-3** Row 7 renamed `ValidationResult` (errorHandling) to `ErrorValidationResult` instead of merging it. The engine superset references `ValidationCheck`, an engine type, so it cannot move down to shared; keeping the shared base would drop fields `argument-parser.ts:682` writes. Accepted (R4's fallback). Row 7 also edited 2 `cli/src` files that consumed the deleted `ResourceValidationResult` alias; accepted, and `cli` typecheck is clean.

- **DEV-T1-1** R8 revised on 2026-10-19 after the client crash. Rows 1–7 commit NO ratchet baseline, because every row lowers the same counts and parallel commits to one JSON file conflict. Row 8 regenerates eslint, knip, typecheck-tests and homonyms once, on the merged tree. Row 2 had already committed a knip baseline (613 → 603 types); row 8's regeneration supersedes it.
- **DEV-T1-2** All three running rows were stopped by a client crash, with uncommitted edits in their worktrees. They were resumed through their saved transcripts, and each re-read its own diff before continuing.

## Findings

- Row 6b: TypeScript lets `Record<string, unknown>` be assigned to an all-optional object type, so `activation` and `gates` compiled while nothing checked them; only a live probe exposes that class. The loader schemas silently drop unknown keys, which is how `frameworks` and `maxRetries` vanished. `pass_criteria` accepts a criterion with no `type` that the loader requires: the same gap, outside this row. `phases.phases` has no engine reader (possibly write-only). `docs/reference/mcp-tools.md:1447` says `execution_type_enhancements` covers "chain vs single", but only `chain` exists.

- Row 7: `version_history.resource_type` is written by two unions that disagree. The server writes `prompt|gate|framework|category`; `cpm` (`HistoryResourceType`) writes `prompt|gate|framework|style|config`. `cli-shared/version-history.ts:675` casts `request.resource_type as VersioningResourceType`. This is possible cross-surface drift, outside this plan; reported to the owner.
- Row 7: the two `TransportType` enums (`{STDIO}` and `HttpTransportType {STREAMABLE_HTTP, BOTH}`) together equal `TransportMode` in `core-config.ts:68`: one concept split three ways. Not merged.
- Row 7: a ts-morph rename followed a barrel that exports both definitions (`shared/types/index.ts`: explicit `ExecutionConfig` plus `export *` from automation) and rewrote the wrong sites in `infra/config/index.ts`; restored. After a rename, read every file that imports through a barrel re-exporting both definitions.
- Row 7: still unused (R3(a) candidates, not homonyms): `ResourceValidationResultWithData`, `isResourceValidationSuccess`, `hasResourceValidationWarnings`; redundant alias `TemporaryGateRegistryDefinition` in `gates/core/index.ts`.

- Row 3: `framework-definition-types.ts` (`FrameworkGateDefinition`, `TemplateSuggestionDefinition`) and `step-generator.ts` (`ExecutionStepDefinition`, `ProcessingStepDefinition`) are stricter or near-copy twins under DIFFERENT names: the same schema drift, invisible to a name-keyed ratchet. Not a homonym, so it is outside this plan; a follow-up candidate.
- Row 3: under load average ~57, `composition-root.integration.test.ts` failed 78 tests on 60 s `beforeAll` timeouts; the re-run on the same diff passed. Load-induced, not a regression. Briefs should run `eslint <touched files>` before the whole-project ratchet (seconds vs many minutes).

- Row 4: load average on this box reached 35–43 on 9 cores with 3 workers and 2 other sessions. A whole-project `lint:ratchet` took >10 min and was killed once at the background limit. Run ratchets in the foreground, one at a time.

- Row 3: the left-over probe state (three pairs merged) typechecked clean; it was restored before the row committed. `step-gate`-style near-twins under different names (`ExecutionStepDefinition`, `ProcessingStepDefinition` in step-generator) are invisible to the homonym ratchet; out of scope. `template-enhancer.ts:27` re-exports `ProcessingStepDefinition` as a second import path; unchecked.

- Row 1: `.husky/commit-msg` strips `Co-Authored-By: Claude` trailers on purpose (project policy), so briefs no longer ask for one.
- Row 1: `shared-types.ts` survives only as a one-line re-export of `ErrorContext`, because `mcp/tools/shared/structured-response-builder.ts:13` imports it from there. Row 7 repoints that import and deletes the file. `ConfigError` in `errorHandling.ts` has 0 references; it is not a homonym, so it is out of scope.

- Row 2: deleting a definition can orphan others (`GateRequirement`, `GateRequirementType`, and `GateType` in gate-definitions), so re-measure after each cut. `engine/gates/types.ts` and the directory `engine/gates/types/` coexist; `'../types.js'` resolves to the file.
- Row 2: `engine/gates/types.ts` still holds unmeasured, possibly unused types (`ValidationContext`, `GateActivationResult`). They are outside this plan's objective (not homonyms).
