---
title: "Mid-chain unknown surfacing — implementation notes"
date: 2026-08-30
status: backlog
tags: []
---

# Mid-chain unknown surfacing — implementation notes

Deviation log kept beside `mid-chain-unknown-surfacing-2026-08-20.md`. Conservative option, log,
keep going. A deviation that invalidates a RULING stops the run instead.

## Tier A (alpha) — re-measurement before execution

Every inventory the tier asserts, re-measured at HEAD on the `feat/mid-chain-unknown-surfacing`
worktree before any edit.

| Asserted (plan)                                                              | Measured                                                                                                              | Verdict                                                                                                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| "5 bundled YAML chains"                                                      | 5 — `documentation_change`, `scaffold_project`, `implementation_plan`, `deep_analysis`, `quick_decision`              | ✓ (a 6th `chainSteps` hit, `examples/create_prompt`, is a script tool's JSON schema, not a chain)            |
| "`chain-schema.md:21-31` vs `workflow-ir/types.ts:38-66`" carry the same set | NOT the same set. `WorkflowNode` declares `args`, `ChainStepSchema` does not; `ChainStepSchema` declares `delegation` | ⚠ corrected — the tier's premise ("merely agree today") was optimistic: they already disagreed in two fields |
| "`delegation` … stays outside the node schema"                               | Zero `delegation:` occurrences in `server/resources/prompts/**`                                                       | ✓ stripping it is zero-impact on the bundled tree                                                            |
| `mcp/tools/index.ts` allowlist "~831-842, four recorded instances"           | not re-measured — A.3 not executed this run                                                                           | ☐                                                                                                            |

## Deviations

### DEV-TA-1 — the node schema moved DOWN a layer, not into `mcp/tools/schemas/`

Row A.1 says "one Zod source imported by the loader" without naming a home.
`workflowNodeSchema` lived in `src/mcp/tools/schemas/workflow-ir.schema.ts` (Layer 4) and the
loader is `modules/prompts/` (Layer 3); `modules-no-mcp` is an ERROR-severity dependency-cruiser
rule, so the loader could not import it there. The schema therefore moved to
`src/modules/workflow-ir/node-schema.ts`, and `workflowIRSchema` stayed at Layer 4 because it
composes `gateSpecUnionSchema`. `workflow-ir.schema.ts` re-exports the three moved schemas so
`mcp/tools/schemas/index.ts` and its consumers keep one import site.

Consequence, logged because it was not obvious: the visibility vocabulary
(`VisibilityItemSchema` / `StepVisibilitySchema`) had to move with it. It was defined in
`prompt-schema.ts` and imported BY the IR schema; with the dependency reversed, leaving it there
would have been a `no-circular` error. It now lives in `node-schema.ts` and `prompt-schema.ts`
re-exports it, since that has been its import site since P5.

### DEV-TA-2 — `linearize` had to become cycle-free, which moved three types

Not anticipated by the row. `modules/workflow-ir/types.ts` type-imports `GateSpecification` from
`shared/types/execution.ts`, which type-imports `WorkflowIR` back: a documented, tracked,
warn-level cycle. Row A.1 makes `prompt-schema.ts` call `linearize` to validate YAML `edges`, and
`prompt-schema.ts` is exported by `cli-shared`, whose isolation gate
(`tests/unit/cli-shared/import-isolation.test.ts`) asserts **zero** dependency-cruiser violations,
warnings included. Importing the linearizer therefore pulled the tracked cycle into a graph
required to be clean, and the gate failed — correctly.

Conservative fix taken: `WorkflowEdge`, `WorkflowRejection` and `WorkflowRejectionReason` moved to
`node-schema.ts` (which imports nothing but Zod) and are re-exported from `types.ts` so all 20
existing import sites are unchanged; `linearize`'s node parameter widened to a structural
`{ readonly id: string }`, which is what it actually reads. Rejected: restructuring the
`shared/types/execution.ts` ↔ `workflow-ir/types.ts` cycle, which is deliberate, documented and
outside Tier A; and relaxing the cli-shared assertion, which would weaken a real gate to
accommodate a change that did not need it.

### DEV-TA-3 — `delegation` removal is a test-visible contract change, priced here

Three existing tests asserted the OLD contract (`ChainStepSchema` DECLARES `delegation` and
preserves its value). Row A.1 rules the opposite ("stays a YAML-only exporter key stripped before
validation"), so those assertions were rewritten rather than worked around: the schema now rejects
the key and every ingress function strips it first. Enumerated ingress — `validatePromptYaml`,
`isValidPromptYaml`, `validatePromptSchema`, `isValidPromptData` — all four strip, so no ingress
can reach the schema with the key attached. Prompt-LEVEL `delegation` is untouched (both prompt
schemas are `.passthrough()`).

### DEV-TA-4 — `edges` are resolved at LOAD, not in the pipeline

Row A.1 says YAML "additionally accepts `edges:`" and does not say who consumes them. Resolving
them in a stage was not available: `linearize` is `modules/` and `engine/` may not value-import it
(`engine-no-modules-or-mcp-value`, severity error). The loader linearizes into `chainSteps` order
instead, so nothing downstream of the loader ever sees an edge and no stage learns a second
ordering rule. `PromptData.edges` is still carried so a round-tripped prompt keeps what it was
authored with; `ConvertedPrompt` deliberately does NOT carry it, since there is no reader past the
loader.

`budget` took the other route, because it has readers per-request: loader → `PromptData.budget` →
`converter` → `ConvertedPrompt.budget` → stage-04 `parsedCommand.budget`, the same field
`WorkflowCommandBuilder` sets. Only the two durable fields survive, mirroring `compileBudget`.

### DEV-TA-5 — A.2 has a falsified premise: `==>` maps to no node field

**Row A.2 was NOT executed. Its premise does not hold as written and re-ruling it is not mine.**

A.2 says a `-->` command's "per-step args/gates/`==>` mapped onto node fields". Measured at HEAD,
a symbolic chain step carries four things a compiled IR node cannot express:

| Symbolic `ChainStepPrompt` field               | IR node field | Note                                                                                                                          |
| ---------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `inlineGateCriteria` (free-text `::` criteria) | none          | `inlineGateIds` is ids, not criteria; the `::` operator produces criteria strings                                             |
| `delegated` (set from the `==>` operator)      | none          | `compiler.ts` explicitly refuses to set it — stage 06 `markDelegatedStepPrompts` is the single producer, from `subagentModel` |
| `subagentModel` / `agentType` prompt fallback  | none          | the symbolic builder reads them off `convertedPrompt`; `compileNode` takes the node's declaration only                        |

Adding `delegated` to the node schema would give one runtime flag two producers, which
`compiler.ts` documents as the thing it exists not to do — and, since A.1 makes `ChainStepSchema`
derived, it would also inject a runtime-only flag into YAML. The alternative, compiling then
post-decorating the steps with the symbolic-only fields, leaves "the string path stops building
`chainSteps` on its own" false.

Either resolution is a ruling (does `==>` become a node field, or does the IR gain an operator
channel?), so this stops here per the dispatch's judgment boundary rather than being decided
inside the tier.

### DEV-TA-6 — A.3 depends on three unlanded rows

**Row A.3 was NOT executed.** Not a falsified premise — a dependency the tier ordering does not
reflect. A.3 requires the `remainder` parameter to exist (`mode: 'append' | 'replace'`) and the
store method it names ("the same store method `remainder` uses"). Both are Tier 0/1 work:

- `remainder` on the contract, the Zod schema and the argument allowlist — rows 0.1, 0.3, 0.4
- `ChainSessionStore.replaceRemainder` — row 1.2

OQ-A1 additionally requires a test that submits BOTH spellings of one append and asserts identical
`chain_run_nodes`, which cannot be written until the structured spelling exists. Executing A.3
first would mean implementing rows 0.1/0.3/0.4/1.2 inside Tier A under a different gate — a
re-scoping decision, not an implementation one.

## Findings promoted to the plan

- **P-A-F1**: the `-->` → IR premise (A.2) is falsified; see DEV-TA-5. Needs a ruling.
- **P-A-F2**: A.3 is ordered before its dependencies (0.1, 0.3, 0.4, 1.2); see DEV-TA-6.
