---
title: Creation prompt schema alignment
type: implementation
status: reference
date: 2026-09-30
tags: [prompts, contracts, workflows]
initiative_branch: feat/authoring-schema-sync
branch_mode: shared-tree
worker_cap: 3
publish: none
tracking: none
tracking_reason: local-only
---

## Now

Goal: align the three bundled create_* prompts with canonical authoring contracts and catch future drift.
Current slice: all 41 owned files are integrated into main, with unrelated work preserved.
Next decision: none for this local task. Runtime activation requires a refreshed running MCP build; no cache/config changes, commit or publication were requested.
Constraint: prompt resources change through MCP only; one resource-writing actor; no commits, pushes or PRs requested.

## Intent

work_type: feature (secondary bug_fix)
strategy: extend bundled authoring adapters and existing parity tests, add a focused validation command.
scope: examples/create_prompt, examples/create_gate, examples/create_framework, authoring drift validation and relevant docs.
skip_gates: none
primary_skill: search -> refactoring; strategic_implement planner delegates all source.
Current incomplete authoring surface and duplicated obsolete builder checks -> current complete authoring fields with canonical validation and non-mutating draft preparation.

## Existing systems and diagnosis

Measured: exactly three bundled create_* prompt directories; prompt_builder covers eleven payload fields, lacks edges/budget/artifacts/injection/composer/delegation/native mode.
Existing bundled-script-tool-params.test.ts checks emitted keys but cannot catch supported fields omitted by a builder.
resourceManagerInputSchema owns transport shapes; resource-manager.json commands own per-operation vocabulary.
Shared node schema already owns persisted chain/workflow fields.
Gate/framework expose create plus maintenance preview; prompt alone exposes validate. Do not invent gate/framework validate or preview:create.

Diagnosis: authoring projection drift. Preserve canonical validation; reduce adapters to field mapping, remove local framework 100-percent scoring and obsolete gate criteria.

## Rulings

- R1 RULED: extend existing chain design mode; support persisted reusable chains with child scaffolds, not a new workflow resource type.
- R2 RULED: preserve legacy author-facing aliases where meaningful; expose all canonical creation fields except routing/control fields resource_type/action/full_restart/framework (framework selector is routing, id is authored identity).
- R3 RULED: prompt adapter may auto-execute only validate. Gate/framework adapters return a non-executing draft create payload; guide author to create when authorized, without pretending a server validate action exists.
- R4 RULED: automate parity against current command metadata plus hand-written transport schema. Check top-level argument/schema coverage and actual adapter preservation; use permissive forwarded nested records or canonical shapes instead of independent domain validators. Exercise modern chain node fields and invalid payload controls.
- R5 RULED: no new shell-executing gate or third-party hook. Register a deterministic check in validate:all; existing CI runs it.
- R6 RULED: shared-tree workers commit nothing and never move refs; planner owns worktree and plan. User authorization already permits this update, no repeat approval.

## Consequences

READS: clients render create_*; ScriptToolLoader/validator read tool schemas; auto-execute stage reads only auto_execute.
WRITES: one resource worker uses isolated local MCP to replace arguments/templates/tools; tooling worker writes tests/check registration.
DECIDES: canonical server runtime validates drafts/writes; adapter readiness is not a resource-validity verdict.
VIEWS: rendered drafts and MCP mutation receipts; CI validation reports lost or undeclared fields by prompt/tool/parameter.

## Tasks

Default 3-file row bound from strategic_implement expanded for the atomic three-resource bundle and its guard wiring; exact files below, one owner each.

| Row | Status   | Bounds / files                                                                                                                                                                                                                                                                                                        | Change                                                                                                                                                                                  | Depends                      | Tier / effort / failure / surface                                                                                | Verify                                                                                                                  |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1.1 | complete | 17 existing resource files: examples/{create_prompt,create_gate,create_framework}/{prompt.yaml,user-message.md,tools/<builder>/{script.py,schema.json,tool.yaml}}, plus gate/framework builder description.md                                                                                                         | Complete fields, thin mappings, correct modern guidance, workflow scaffolding, nonmutating drafts via MCP; one writer                                                                   | none                         | inherited GPT-6.1-Sol / high / wrong schema authority or write lifecycle / Codex worker-high                     | Inspect receipts and smoke-render all 3; full modern payload round trip                                                 |
| 1.2 | complete | server/scripts/validate-authoring-contracts.ts; server/tests/unit/resources/bundled-script-tool-params.test.ts; server/tests/unit/resources/bundled-script-tool-fixtures.json; server/tests/unit/scripts/validate-authoring-contracts.test.ts; server/package.json; server/scripts/run-validation-suite.js            | Extend existing closure checks; add command-driven schema/argument/adapter completeness guard and mutation tests, register validate:all                                                 | 1.1 for final checks         | inherited GPT-6.1-Sol / high / vacuous drift guard or new field silently omitted / Codex worker-high             | Missing field, missing argument, renamed mapping, unsupported output/action all fail; clean real resources pass         |
| 1.3 | complete | docs/reference/mcp-tools.md; docs/guides/mcp-contract-maintenance.md; docs/guides/script-tools.md; docs/guides/frameworks.md; docs/architecture/overview.md; docs/portfolio/design-decisions.md; docs/portfolio/case-study.md; docs/reference/chain-schema.md; docs/reference/workflow-ir.md; CHANGELOG.md (10 files) | Document actual draft lifecycle, workflow scaffolding, and authoring contract check; repair all five measured stale authoring consumers while retaining generic auto_execute capability | 1.1, 1.2                     | inherited GPT-6.1-Sol / high / public guidance promises unsupported validation or execution / Codex worker-high  | Exact commands and features crosschecked; formatting                                                                    |
| 1.4 | complete | 41 accepted source/doc/resource files, integration by worker; planner verification                                                                                                                                                                                                                                    | Run minimum suite plus validate:all/build/live isolated MCP including authoring -> create -> reload -> render -> cleanup                                                                | 1.1, 1.2, 1.3, 1.5, 1.6, 1.7 | planner / high / undelivered behavior                                                                            | typecheck, lint ratchet, test type ratchet, test:all, validate:all, live MCP                                            |
| 1.5 | complete | server/src/engine/execution/parsers/argument-parser.ts; server/tests/unit/execution/parsers/argument-parser.test.ts; server/tests/unit/execution/pipeline/command-parsing-stage.test.ts (3 max)                                                                                                                       | Leave omitted optional non-string arguments absent at both validation boundaries; retain string fallbacks and explicit values                                                           | none                         | inherited GPT-6.1-Sol / high / workaround fixes first validation but fails typed-input merge / Codex worker-high | Captured live create_prompt design call; omitted values versus explicit malformed strings; typed-input merge regression |
| 1.6 | complete | server/src/modules/automation/detection/tool-detection-service.ts; server/tests/unit/scripts/detection/tool-detection-service.test.ts (2 max; corrected measured source path)                                                                                                                                         | Stop erasing supplied empty arrays while retaining missing/blank string placeholder semantics                                                                                           | none                         | inherited GPT-6.1-Sol / high / explicit authored value lost before adapter / Codex worker-high                   | Empty arrays, false, zero and objects survive extraction; absent placeholders do not                                    |

## Completion criteria

1. All three creation prompts use current fields and contracts, preserving useful input aliases.
2. create_prompt guides full reusable workflow scaffolding and finished child authoring without promising branching.
3. Future new canonical authoring fields, removed fields, changed argument/schema types, lost adapter fields, and unsafe premature writes fail a deterministic check.
4. Required validation and live MCP smoke pass; any baseline failures attributed with evidence.
5. Relevant docs updated, resource writes made only through MCP, unrelated main edits preserved.

## Sources

server/tooling/contracts/resource-manager.json commands; server/src/mcp/tools/schemas/resource-manager.schema.ts; docs/reference/workflow-ir.md; docs/reference/mcp-tools.md; existing bundled-script-tool-params.test.ts.

## Open questions

None; a worker encountering a consequential unruled choice returns it to the planner.

## Runtime diagnosis and ruling R7

Live command >>create_prompt %clean with typed name/purpose fails optional collection type validation. Parser synthesizes empty-string absence, validated once during enrichment and again after typed input merge. Fix absence in parser rather than fake defaults or filtering just one validator. Script detector separately drops actual supplied empty arrays; preserve those. This is required for the exposed typed authoring surface to work end to end.

R8 RULED: retain preexisting explicit numeric/boolean string coercion. Explicit blank rejection applies to object/array inputs only; omission must remain absent for all declared optional non-string types. Numeric coercion redesign is not required for the exposed authoring fields and is outside this slice.

R9 RULED: base adapter fixtures must satisfy the hand-written transport schema. Use that owner to check output shapes without copying nested validation; malformed opaque passthrough probes belong in isolated mutation tests.

## Additional task 1.7

| Row | Status   | Bounds / files                                                                                                                                                                                                                                    | Change                                                                                                                          | Depends | Tier / effort / failure / surface                                                                   | Verify                                                                                                                               |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1.7 | complete | server/src/modules/prompts/yaml-prompt-loader.ts; server/src/mcp/tools/resource-manager/prompt/services/prompt-mutation-receipt-service.ts; server/tests/unit/mcp-tools/resource-manager/prompt/prompt-mutation-receipt-service.test.ts (3 files) | Reuse loaded budget projection while independently verifying authored structural caps on disk; prevent false post-write failure | 1.1     | inherited GPT-6.1-Sol / high / false receipt fix accidentally hides writer loss / Codex worker-high | Mixed and structural-only budget success, changed/missing raw caps and durable policy failure, live STDIO/HTTP original reproduction |

## Additional task 1.8

| Row | Status   | Bounds / files                                         | Change                                                                                                                            | Depends | Tier / effort / failure / surface                                                                                        | Verify                                                                                        |
| --- | -------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 1.8 | complete | server/scripts/validate-phase-header-drift.js (1 file) | Replace brittle selftest dependence on removed create_framework example with isolated quoted YAML fixture; keep detector behavior | 1.1     | inherited GPT-6.1-Sol / high / future authoring prose removal silently disables a validation control / Codex worker-high | Clean fixture passes, stale YAML-quoted declaration fails, selftest plus focused script suite |

## Final delivery

- Main source and resource contents match the tested worktree exactly; all three creation prompts are loaded at version 2.
- 496 suites: 7,888 passed, three skipped. Source typecheck, existing lint/test-type ratchets, architecture, format and new authoring guard pass.
- Full validation: 77/79; unchanged README prompt count and interview-boundary plan stamp checks remain baseline failures. Main index remains untouched, including its pending deleted-sidecar entry; formatter enumeration of that index becomes clean when this deletion is staged.
- Fresh main-built STDIO and HTTP lifecycles pass, with all temporary creates deleted. Cached active process renders new guidance; code fixes require a restarted process targeting the refreshed build.
- No commits, HEAD changes, cache/config edits or publication. 35 unrelated dirty files were preserved.

See [implementation notes](creation-authoring-schema-sync-2026-09-30-implementation-notes.md) for rulings and evidence.

The temporary integration worktree was removed after all 41 owned file contents matched main; its branch had no commits. Main changes remain uncommitted. Exact ownership is recorded in the implementation notes.
