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
| `mcp/tools/index.ts` allowlist "~831-842, four recorded instances"           | re-measured under Tier 0 (2026-08-30): four confirmed, range now ~824-853                                             | ✓ superseded by the Tier 0 table below                                                                       |

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

> **CLOSED 2026-08-30** by OQ-A2 (the `==>` half) and OQ-A2b (the `::` half); A.2 shipped on the
> third attempt. Kept unedited: the `subagentModel` / `agentType` row of the table below is the
> one this record got most nearly right and most usefully wrong — the fallback did have to move,
> just onto the node at the parse site rather than into the compiler. See DEV-TA3-1.

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

## Tier 0 — re-measurement before execution

| Asserted (plan)                                                    | Measured                                                                                                                                                                                                                                                     | Verdict                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `mcp/tools/index.ts` allowlist "~831-842, four recorded instances" | Four confirmed: the comment's "three times" enumerates `version_description` + `dry_run` (gate, framework) + `cancel`, then a separate "Fourth instance (2026-08-21)" names `handoff`/`claim_token`. Line range is now ~824-853                              | ✓ "fifth instance" is the correct label for `remainder`                              |
| `resolvesPendingGate` sites                                        | 7 non-generated sites, not the 3 the row names: contract JSON ×3 flags, `contracts/schemas/types.ts` (the Zod metadata schema — row 0.2 does not list it), generator ×4, `gate-enforce.py` ×3, `hooks/tests/test_gate_enforce_verdict.py`, `hooks/README.md` | ⚠ corrected — the row named 3 files, the rename touched 6 plus 6 generated artifacts |
| `gate_action` enum "~line 325"                                     | 325 exactly, in `buildGateFields`                                                                                                                                                                                                                            | ✓                                                                                    |
| "reuse the IR node schema from `workflow-ir/node-schema.ts`"       | `workflowNodeSchema` + `workflowEdgeSchema` + `DEFAULT_WORKFLOW_CAPS` all reachable through the `workflow-ir.schema.ts` re-export (`DEFAULT_WORKFLOW_CAPS` had to be ADDED to it)                                                                            | ✓ with one addition                                                                  |

## Deviations (Tier 0)

### DEV-T0-1 — row 0.2's flip condition is unsatisfiable as literally written

The row requires `rg "resolvesPendingGate|PENDING_GATE_RESOLUTION"` across the worktree to return
NOTHING. It cannot: this plan's own row 0.2 and ruling OQ-4 spell the old name, and the retired
`plans/gate-enforce-resolution-verbs-2026-08-20.md` records its introduction. A rename check that
a plan describing the rename makes fail is measuring the wrong thing.

Substituted, and recorded here so the substitution is auditable rather than silent:

```
rg 'resolvesPendingGate|PENDING_GATE_RESOLUTION' --hidden -g '!node_modules' -g '!plans/**' .
```

→ no hits. `plans/` is exempt for the reason `cleanup-standards.md` exempts CHANGELOG and git
history: it is a record of what happened, not a description of current state. The `Current State`
table WAS updated, because that row does describe current state.

The check is non-vacuous — it observes files this tier wrote (the contract, the generator, the
generated Python constant, `gate-enforce.py`). Positive control on the parity side:
`test_generated_artifact_matches_contract_flags` reads the contract's `resolvesPendingRun` keys and
compares them to what the hook imports, so renaming any ONE of the three layers turns it red
(empty verb set → the generator throws; unrenamed hook import → `load_resolution_params()` returns
None → `None == flagged` fails).

### DEV-T0-2 — the Zod work landed one layer down from where the row pointed

Row 0.3 names `workflow-ir.schema.ts` for `pauseOnBlocking`. Tier A moved `workflowBudgetSchema`
to `modules/workflow-ir/node-schema.ts` (DEV-TA-1), so that is where the field went;
`workflow-ir.schema.ts` re-exports it, and one re-export was added (`DEFAULT_WORKFLOW_CAPS`) so
`prompt-engine.schema.ts` keeps the single import site that file's header asks for.

Two type declarations the row did not mention were required for contract agreement, not chosen:

- `WorkflowBudget.pauseOnBlocking` (`modules/workflow-ir/types.ts`). `workflow-ir.schema.ts`
  carries a never-executed drift guard asserting `WorkflowIRInput` is assignable to `WorkflowIR`;
  a Zod field with no type twin passes that guard silently (structural assignability permits the
  extra property) and would have left the type SSOT lying.
- `RemainderSubmission` (same file), with a matching drift guard in `prompt-engine.schema.ts`.
  Declared at Layer 3 rather than in `mcp/tools/schemas/` for the reason `WorkflowIR` is: the
  eventual consumers are `engine/` stages and the chain store, and `engine/` may not import
  `mcp/`. Putting it in the schema file would have forced a move in Tier 2.

`prompt-executor.ts`'s argument type also gained `remainder?: RemainderSubmission` — the allowlist
in `mcp/tools/index.ts` is typed as `Parameters<PromptExecutor['executePromptCommand']>[0]`, so
row 0.4 is not writable without it. Nothing reads it; that is row 2.3's work.

### DEV-T0-3 — `pauseOnBlocking` is declaration-dead at FOUR hops, and row 1.3 assumed one

Row 1.3 reads as a single blueprint readback in stage 16. Measured: `compileBudget`
(`workflow-ir/compiler.ts`) deliberately projects only the budget fields with a post-validation
reader onto `DeclaredRunBudget`, and the YAML loader has its own budget projection mirroring it.
A field declared only on `workflowBudgetSchema` therefore never reaches a step at all — it is
dropped twice before stage 16 looks for it, and the readback would read `undefined` forever while
typechecking perfectly. Row 1.3 is re-scoped in the plan to name all four hops and to require an
assertion per hop. Not fixed here: Tier 0's charter is contract + schema, and the strippers are
runtime plumbing.

### DEV-T0-4 — a new contract parameter needs a conformance exception, and Tier 0 cannot write the scenario

`validate:conformance-coverage` (inside `validate:all`, hence CI) fails any contract parameter
with neither a corpus scenario nor a declared exception. `remainder` has no consumer until rows
2.1–2.3, so a scenario written now would assert the ABSENCE of an effect and would pass for the
wrong reason. An exception was declared with its real close condition instead, and row 0.5 was
added to the plan to own the retirement — the exception is an unmarked `☐` living inside a gate's
allowlist, and the gate's own satisfied-exception audit is what will detect it.

### DEV-T0-5 — `plan-row-tracking` was red at HEAD, inherited, fixed anyway

Not caused by this tier: `git diff` showed no plan modification when the gate first failed. Row
A.2's stamp from commit `3fa6ba11` reads `(as of 2026-08-30 · OQ-A2 ruled, see below · flips when
…)`, and `OPEN_STAMP` is `/as of (\d{4}-\d{2}-\d{2})\s*[·|-]\s*flips when\s+\S/` — it requires the
two halves ADJACENT, so the intervening clause broke it. Attributed to Tier A, repaired here
because a gate nobody can pass blocks every later tier. The clause was moved after the flip
condition rather than deleted.

### DEV-T0-6 — `remainder` is NOT flagged `resolvesPendingRun`

A judgment call the rows do not cover. The interrupt payload lists `remainder` among the resume
verbs, which reads like a flag candidate. It is not one: on a PAUSED run the verb that clears the
review is `gate_action: 'accept_alternative'` (already flagged), with `remainder` as its argument;
on an unpaused run there is no pending review for the hook to guard. Flagging it would tell
`gate-enforce.py` that a bare `remainder` resolves a pending GATE review, which it does not. Row
3.1's matrix (`resume`, `accept_alternative`, `abort`, `cancel`) agrees.

## Tier 1 — re-measurement before execution

| Asserted (plan)                                                        | Measured                                                                                                                                                                            | Verdict                                                                                                                                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Row 1.3: "four hops, four independent strippers"                       | Four confirmed — `DeclaredRunBudget` (`chain-session.ts:65`), `compileBudget` (`compiler.ts:168`), `normalizeChainBudget` (`yaml-prompt-loader.ts:580`), stage-16 readback (`:459`) | ✓. A FIFTH observable hop exists but is not a stripper: `converter.ts` and stage-04 pass the whole `DeclaredRunBudget` object through, so they cannot drop a field — asserted anyway |
| Row 1.2: `origin='remainder'` needs no schema bump                     | `chain_run_nodes.origin` is `TEXT NOT NULL`, no CHECK, no DDL default (`sqlite-engine.ts:751`)                                                                                      | ✓ no bump. One reader (`reconstructNodeOrigin`) had to widen or the value silently reads back as `'planned'`                                                                         |
| Row 1.1: "`UNKNOWN_INTERRUPT_GATE_ID` beside the phase-guard constant" | `PHASE_GUARD_GATE_ID` lives in its STAGE file and is consumed by `response-assembler` + `pipeline/index.ts` — all `engine/`                                                         | ⚠ adapted — placed in `decisions/mutation/types.ts` instead (DEV-T1-1); the pattern is honoured, the location is not                                                                 |
| Row 1.2: "atomic, awaited, throws on failure"                          | `persistSessions` log-and-swallows; NO throwing persist path existed                                                                                                                | ⚠ corrected — the row assumed a capability the store did not have (DEV-T1-2)                                                                                                         |
| Row 1.2: `replaceRemainder(sessionId, nodes, unknownId)`               | Cannot express OQ-A1's one-mechanism-two-spellings rule, ruled after the row was authored                                                                                           | ⚠ corrected in the plan — `mode` added as a fourth parameter                                                                                                                         |

## Deviations (Tier 1)

### DEV-T1-1 — the reserved gate id sits with the POLICY, not with the stage

Row 1.1 says "beside the phase-guard constant", and `PHASE_GUARD_GATE_ID` is declared in
`stages/19-phase-guard-verification-stage.ts` — the stage that sets the review. Copying that
placement would have put `UNKNOWN_INTERRUPT_GATE_ID` in stage 16, which the pure decision module
would then have to import FROM a stage: a decision depending on an orchestration file, the
inversion `decisions/` exists to avoid.

It is declared in `decisions/mutation/types.ts` instead, next to `MAX_INSERTIONS_PER_RUN`. Every
consumer the plan names for it — stage 16 (row 2.1), stage 13 (D-9), `GateVerdictProcessor`
(row 2.2) and `response-assembler` (row 2.4) — is inside `engine/`, so all four import it without
crossing a layer. The Python side (`session_state.py`, row 3.1) carries the literal rather than an
import, exactly as it already does for `__phase_guard__`.

### DEV-T1-2 — "throws on persist failure" was a capability the store did not have

Row 1.2 requires an awaited persist that throws. `ChainSessionStore.persistSessions` catches
everything and logs, so no caller can distinguish a committed write from a failed one — and
`applyUnknownObservations` has been DOCUMENTED as throwing on persist failure while calling that
same swallowing method since it landed.

Conservative fix: `persistSessions` now wraps a new `persistSessionsOrThrow` containing the
identical body without the outer catch. Existing callers keep byte-identical behaviour (the
advisory mutations and the cleanup pass all prefer a logged failure they cannot act on);
`replaceRemainder` calls the strict one. Rejected: changing `persistSessions`' posture globally,
which would turn a logged failure into a thrown one for every step capture in the pipeline — a
behaviour change no row asked for.

The pre-existing false docblock was NOT fixed here. It is a different method with a different
posture question (should an observation batch fail the whole call?), so it is plan row 1.4 rather
than a silent drive-by — a fix at the site you found is not a fix of the class, and the class here
is "a docblock promising a throw over a swallowing persist".

### DEV-T1-3 — two derivation choices row 1.1 left open, ruled and documented in code

Neither is a deviation from a ruling; both are gaps the row did not specify, decided in the module
rather than left implicit:

- **Which unknown the interrupt is ABOUT** when several blocking ones are open: the most recently
  discovered (`discoveredAtStep`). Ledger order would let an older still-open unknown outrank the
  discovery that just stopped this step, so the payload would keep naming the stale one.
- **`affectedStepIds` is filtered to nodes strictly AHEAD** of the current node, and collected
  across every open blocking entry rather than only the triggering one. A step already executed or
  currently rendered cannot be re-planned — the same boundary OQ-P4-2 draws for skips — and a
  caller authoring a replacement needs every declared link, not just one. Both are unit-tested, so
  a later tier that disagrees will find the assertion rather than the behaviour.

### DEV-T1-4 — the stage-16 readback is reachable, not reached

`resolveDeclaredPauseOnBlocking` has no production caller until row 2.1 wires `decideInterrupt`
into the stage. Row 1.3's Verify asks for "absent → false; declared true → true" plus one
assertion per hop, which is exactly what shipped — but a green suite here proves the value ARRIVES,
not that anything acts on it. Recorded rather than papered over: the alternative was to implement
row 2.1's call inside Tier 1, which is a re-scoping decision, and the alternative to THAT was to
leave hop 4 unwritten and let rows 2.1 discover the field is still declaration-dead.

## Tier 2 — re-measurement before execution

| Asserted (plan)                                                    | Measured                                                                                                                                                                                                                                  | Verdict                                                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Row 2.1: `resolveDeclaredPauseOnBlocking` has no production caller | Confirmed — one reference, the unit test (DEV-T1-4 was accurate)                                                                                                                                                                          | ✓ this tier is its caller                                                                 |
| Row 2.2: `gate_action` already carries five members                | NOT at the type level. The contract and the Zod tool schema have five; `GateAction` (`gate-enforcement-types.ts:19`), `McpToolRequest.gate_action`, `PromptExecutor`'s arg type and `gateActionSchema` all still had three                | ⚠ corrected — four internal declarations needed widening (DEV-T2-3)                       |
| Row 2.3: "`PromptExecutor` / stage that reads `mcpRequest`"        | `McpToolRequest` had NO `remainder` field — Tier 0 typed only `PromptExecutor`'s argument bag, so the value stopped one hop above the pipeline. Validation additionally needs `modules/workflow-ir`, which `engine/` may not value-import | ⚠ corrected — one more hop plus an injected port (DEV-T2-4)                               |
| Row 2.4: the assembler owns `structuredContent`                    | It does not — every assembler method returns a `string`; `ResponseFormattingStage` owns the `ToolResponse`, and it passes `includeStructuredContent: false`                                                                               | ⚠ corrected — payload built in the assembler, attached in the stage (DEV-T2-5)            |
| Row 2.5: bumping would touch a durable restore path                | `execution_records` is `posture: 'ephemeral'`; `DROPPED_ON_THIS_BUMP` is empty and `DROPPED_AT_VERSION` is 19                                                                                                                             | ✓ no STOP — v25 → v26 touches nothing durable                                             |
| Row 1.4: "a one-line call-site change"                             | One line in `manager.ts`, plus FIVE test files whose persistence spy sat on the swallowing wrapper                                                                                                                                        | ⚠ corrected — the one-line change was true; the mock surface around it was not (DEV-T2-7) |

## Deviations (Tier 2)

### DEV-T2-1 — the interrupt verbs are handled in stage 16, not stage 13

Row 2.2 names `13-session-stage.ts` + `GateVerdictProcessor`. The processor half is exactly right
and is where `resolveUnknownInterrupt` lives. The stage half is not: stage 13 is session
lifecycle and never reads `gate_action`; stage 16 owns that parameter today and is the only stage
positioned between the observation write and the interrupt decision, which is where the verb has
to be consumed (DEV-T2-2). The call-through is three lines.

Stage 13 needed no change at all, which is the other half of the finding: D-9 ("claiming a run
with `__unknown_interrupt__` pending returns the interrupt to the claimer") is already free,
because stage 13 copies any `pendingGateReview` onto `sessionContext` on every resume without
caring which gate id it carries. Row 4.2 still owns proving it.

### DEV-T2-2 — the PAUSE cannot follow the interrupt's open-state shape

The row does not say when the pause fires, and the obvious reading — "whenever `paused` is true"
— livelocks. `decideInterrupt` is a function of what is OPEN, so it re-raises on every step while
an unknown is unresolved; raising the synthetic review on that same condition means the very next
call after `resume` is held again, by the same unknown, with no verb able to clear it.

The pause is bound instead to the two states where the run is genuinely stopped: an insertion
landed on THIS call (OQ-1's "the inserted investigation node IS the pause point", and the
insertion cap is one per unknown id, so this fires once per unknown), or the synthetic review is
already pending. Stage 16 computes that and passes it as `pauseOnBlocking`, so `decideInterrupt`
stays pure and its unit test's "`paused` mirrors the knob" remains true at the module level.

Positive control: forcing the knob straight through turns the `resume` and `accept_alternative`
integration cases red (probe run 2026-08-30, restored).

### DEV-T2-3 — `GateAction` was NOT widened; the union lives at the request boundary

OQ-4 says "extend `gate_action`", and the contract does carry five members. Widening the INTERNAL
`GateAction` was rejected: `GateEnforcementAuthority.resolveAction` switches on it to reset a
retry count, skip a failed gate or abort, and every one of those branches addresses a gate the run
FAILED. `resume` addresses a hold no gate produced, so widening would have obliged each of those
sites to answer a question with no answer.

`McpToolRequest.gate_action` is the union of both vocabularies; `InterruptResolutionAction` is the
new half; `isInterruptResolutionAction` is the single narrowing point, in stage 16. The
retry-exhaustion branch is explicitly guarded by it — without that guard the authority answers
`handled: true` to a verb it never acted on, which is the silent-success shape this plan keeps
finding.

### DEV-T2-4 — `remainder` needed a service, a port and one more request hop

Row 2.3 reads as a call-through. Three things it does not mention:

1. `McpToolRequest` had no `remainder` field. Tier 0 typed `PromptExecutor`'s argument bag (so the
   allowlist could be written), but the executor builds the pipeline request separately — the
   value stopped one hop short of anything that could read it. Both hops now carry it.
2. Validating a remainder needs `validateWorkflowIR` and `DEFAULT_WORKFLOW_CAPS`, which are
   Layer 3; `engine-no-modules-or-mcp-value` bars stage 16 from importing them. Resolved with the
   existing precedent rather than a new one: a `RemainderIrPort`, supplied by `PipelineBuilder`,
   exactly as `WorkflowCommandBuilder` takes `WorkflowIrPort`.
3. The work is not a stage's. `RemainderProcessor` (`engine/execution/capture/`) sits beside
   `UnknownObservationProcessor` — same role, same layer, same posture — so stage 16 keeps two
   symmetric call-throughs instead of growing an entitlement rule and a validator.

Two decisions inside it that the row left open, ruled in code with the reasoning attached:
`maxNodes` is narrowed by the count already executed (OQ-3's "executed + remainder", which the
per-remainder cap alone does not bound — three remainders of 32 nodes is 96 through a cap of 32),
and accepted nodes are written in LINEARIZED order, since projecting in declaration order would
silently ignore every edge the caller declared.

### DEV-T2-5 — the assembler builds the payload; the stage attaches it

Row 2.4 assigns both halves to `response-assembler.ts`. Its methods all return `string`;
`ResponseFormattingStage` owns the `ToolResponse` and calls the formatter with
`includeStructuredContent: false`. Rather than give the assembler a response object, the split
follows the one already there: `buildInterruptStructuredContent` returns the payload, stage 21
merges it under `chain_interrupt`. The `false` above is untouched — it governs the lean
execution/chain bookkeeping block, and the interrupt is not bookkeeping.

### DEV-T2-6 — the footer contradicted the interrupt inside one payload

Not in any row, found by the first snapshot. A paused run holds on a `pendingGateReview`, so
`buildChainFooter` rendered `Next: … user_response="<your step output>", gate_verdict="GATE_REVIEW:
PASS|FAIL"` — two false statements in one line (no step was issued, and no verdict clears this
hold) directly under an interrupt section listing the verbs that do. `buildGateReviewCTA` was
suppressed for the synthetic id and the footer gained a branch naming the same verbs. One verb
list, `resolveInterruptVerbs`, feeds the section and `structuredContent`, so the three surfaces
cannot advertise different exits.

### DEV-T2-7 — the pre-existing persist-failure test was vacuous, and five files shared the cause

`chain-session-store.test.ts` already contained "applyUnknownObservations propagates a persist
failure rather than reporting success". It passed for four months against a method that
swallowed. The spy sat on `saveSessions` and mocked it to REJECT — a method production can never
make reject, since it routes through the log-and-swallow `persistSessions`. The probe measured a
property of the mock, not of the code.

Every persistence spy in the repo had the same target (5 files: the store unit suite, the
run-telemetry unit suite, and three integration suites). All now sit on `persistSessionsOrThrow`,
which is the funnel BOTH paths run through — so the swallowing callers stay covered and the
throwing ones become observable. Positive control: restoring `saveSessions` in
`applyUnknownObservations` turns the unit test AND the new integration case red (probe run
2026-08-30, restored). Before this tier, the same mutation turned nothing red.

### DEV-T2-8 — the live drive found a render gap no test could

Row 4.5's probe, run ad-hoc against a built `dist/` (see the Tier 2 execution record for the
receipt). It confirmed `remainder` reaching stage 16 — row 0.4's open question — and it failed one
check nobody had written: `>>strategicImplement` is a GATED SINGLE PROMPT that gets a session, so
it can declare observations and raise an interrupt, and it reaches `formatSinglePromptResponse`,
which rendered no interrupt section. `structuredContent.chain_interrupt` was correctly present
(stage 21 attaches it outside the chain/single branch), so the two halves of one payload
disagreed — the machine half reported a blocking unknown and the human half did not.

Fixed on both paths and gated by a test. Worth stating plainly: the suite was green, the section
was rendered in four assertions, and the gap was in the OTHER formatting method. A fix at the
sites you found is not a fix of the class.

### DEV-T2-9 — two lint ceilings forced a shape, and the shape is better

`max-params` (constructor at 7) and `sonarjs/cognitive-complexity` (`execute` at 16/15) both
tripped. Rather than regenerate baselines: the two optional collaborators became one
`collaborators` bag, and the five ordered steps of the unknowns phase moved into
`runUnknownsPhase`, whose docblock is now the only place the ORDER is written down — and the order
is the whole design (DEV-T2-2).

### DEV-T2-10 — the paused verb list says "answer the step", and no step was issued

Followed the plan's §Interrupt payload block verbatim, which specifies the base verbs
`["answer the step", "remainder", "gate_action:abort", "cancel"]` plus the two resolution verbs
when paused. On a PAUSED run stage 18 issues no step, so "answer the step" is not an available
exit and the run's own footer no longer offers it. Not changed here — the payload block is
normative and narrowing it is a ruling, not an implementation choice. New row 2.6 owns it.

### DEV-T2-11 — P-1-F2 recurred, and the baseline was tightened rather than loosened

Third sighting of the knip-types shape: `decisions/index.ts` re-exported `DecideInterruptInput`
and `InterruptNodeSummary`, which nothing imports from that path (the policy module and its unit
suite both take them from `mutation/index.js`). Removed the two barrel entries rather than
inventing a consumer — a barrel entry with no consumer is what the ratchet counts, and adding one
to look symmetric is how a barrel stops describing its consumers. The baseline was then
regenerated to lock in an unrelated IMPROVEMENT the tier produced (exports 493 → 492); the types
count is unchanged at 679, not raised.

## Tier 3 (+ rows 2.6, 0.5) — re-measurement before execution

| Asserted (plan)                                                                      | Measured                                                                                                                                                                                                                           | Verdict                                                                         |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Row 3.1: "`session_state.py` currently names gates from `pendingGateReview.gateIds`" | It does not. `session_state.parse_prompt_engine_response` derives `pending_gate` from the RESPONSE TEXT (`**Gates**:`); `db_reader.py` is the module that joins `pendingGateReview.gateIds`, at TWO sites (lines 404-406, 510-514) | ⚠ corrected — the label lives in both modules, for different reasons (DEV-T3-1) |
| Row 3.1: the allow half "may already work" after the Tier 0 rename                   | It does — `gate_action` is one parameter whatever its value, so all four exits pass Check 2 unchanged. Proven, not assumed: the mutation probe drops `gate_action` from the generated set and turns `resume` red                   | ✓ confirmed by probe                                                            |
| Row 3.1: a bare `chain_id` resume while paused "must be DENIED"                      | It was NOT denied, and could not be. The paused response carries no `**Review Required**` header (`buildGateReviewCTA` returns null on the synthetic id), so nothing set `pending_gate` and Check 2 saw an unheld run              | ⚠ corrected — the deny half needed a detector, not a message (DEV-T3-2)         |
| Row 0.5: retiring the `remainder` exception is the whole job                         | The same scenario also covers `observations`, whose exception the gate then flagged SATISFIED. Two entries retired, not one                                                                                                        | ⚠ corrected (DEV-T3-3)                                                          |
| Row 2.6: `INTERRUPT_VERBS` becomes two lists                                         | Two lists, and the paused one is NOT a superset — it drops `remainder` as well as `answer the step`, because a bare `remainder` does not clear the synthetic review                                                                | ✓ implemented as ruled, with one spelling consequence (DEV-T3-4)                |

## Deviations (Tier 3)

### DEV-T3-1 — the synthetic-id label has two producers, and the row named neither correctly

`pending_gate` is written by two independent modules. `session_state.parse_prompt_engine_response`
reads the response TEXT (live calls, via the PostToolUse hook); `db_reader` reads
`chain_sessions.pendingGateReview.gateIds` (compact recovery and `prompt-suggest`, where no
response text exists). Row 3.1 named `session_state.py` and attributed `db_reader`'s mechanism to
it, so a fix at the named site alone would have left the dunder rendering on every recovery path.

`label_gate_ids` lives in `session_state.py` — which is where the row pointed, and is the module
`db_reader` may import without a cycle — and both `db_reader` sites call it. One function, so a
hook's reminder and a hook's denial cannot name the same hold differently.

### DEV-T3-2 — the deny half did not exist, and no message change could have created it

The row reads as prose work ("deny message names the verbs"). Measured, the denial was not
happening at all: `buildGateReviewCTA` returns `null` for the synthetic review (Tier 2, correctly
— no `gate_verdict` clears it), so a paused response carries no `**Review Required**` header and
no `**Gates**:` line. `parse_prompt_engine_response` therefore left `pending_gate` as `None`, and
`gate-enforce.py` Check 2 read a HELD run as a free one. A bare `chain_id` resume was allowed
through to a server that would refuse it.

Fixed with a detector rather than a message: a new `interruptHeader` extraction pattern matching
the PAUSED header only. The soft variant is deliberately excluded — it issues a step, so a bare
resume is a legitimate answer to it, and matching it would deny a call the server accepts. That
distinction has its own positive-control test (`test_the_soft_variant_is_not_a_hold`).

The verbs the denial names are read back from the server's own interrupt section
(`interruptVerbs` pattern) rather than modelled in the hook. Both patterns were added to
`generate-contracts.ts`, which is the SSOT the Python defaults and the opencode plugin share —
the hook's previously hardcoded verb model is recorded in `hooks/README.md` as having rotted
twice, and a second hardcoded copy is the same defect one layer along. The db_reader path has no
text to read, so `interrupt_exits` falls back to the generated PARAMETER names minus
`gate_verdict`.

### DEV-T3-3 — row 0.5 retired TWO exceptions, and the gate is what found the second

The row names the `remainder` entry. Deleting it left `validate:conformance-coverage` red on
`prompt_engine.observations`: the new scenario declares a blocking observation to open the ledger,
so `observations` became covered in the same commit. Its `closedBy` had proposed a different
route (a `system_control action:status` ledger readback); what shipped asserts an effect reachable
ONLY if the ledger opened, which is the stronger reading, so the entry was deleted rather than
re-worded.

Worth recording as a mechanism, not just an outcome: this is the satisfied-exception audit doing
exactly what row 0.5's own text predicted, on an entry nobody was looking at.

### DEV-T3-4 — the paused verb list is state-dependent, and one member is not copy-pasteable

Implemented as ruled: `PAUSED_INTERRUPT_VERBS` replaces the soft list rather than extending it.
Two members are absent for two different reasons, and the code says which — `answer the step`
because a paused run issues no step, `remainder` because a bare `remainder` does not clear the
synthetic review (the caller must spell it `gate_action:accept_alternative` and carry the
remainder along).

The ruled spelling `gate_action:accept_alternative (with remainder)` carries a parenthetical, so
that one entry is not a verbatim wire value the way the other three are. Kept as ruled — it
matches the paused footer, which has said exactly this since Tier 2 — and noted here because the
list's docblock says a client "puts the string back on the wire". A client parsing by prefix is
unaffected; one splitting on whitespace is not.

### DEV-T3-5 — running `test:e2e` writes seven prompts into the repo tree (NOT this tier)

`tests/e2e/conformance/workspace-and-mutations.yaml` declares `workspace: isolated`, and after any
conformance run `server/resources/prompts/examples/` holds seven untracked `conformance_*`
directories. `validate:readme` then fails claim-coverage (39 claimed vs 46 shipped) until they are
deleted by hand — measured twice, and reproduced with this tier's own corpus file MOVED OUT of the
directory (105 scenarios, same 7 directories), which is the attribution probe. Pre-existing and
not fixed here; promoted as P-3-F1 with its own plan row.

## Tier A continuation (rows A.2, A.3, 4.5) — re-measurement before execution

| Asserted (plan)                                                                | Measured                                                                                                                                                                                                                                               | Verdict                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| OQ-A2: `::` criteria → run-level `gates[]` `{criteria, target_step_id}`        | The gate UNION accepts that shape; the CONSUMER cannot honour it. `resolveCanonicalGateId` returns early on any inline content, and the id-only spelling drops `target_step_id`. Resolution happens at stage 11 with a registry stage 04 does not have | ✗ falsified — row A.2 stopped, OQ-A2 reopened (DEV-TA2-1)                       |
| A.3: "`mcp/tools/index.ts` allowlist" is where the append parameter is carried | No allowlist change is needed at all. The translation happens one layer up, at `PromptExecutor`, and produces the `remainder` parameter that already crossed both hops at rows 0.4 / 2.3                                                               | ⚠ corrected — the named site was not touched, and that is what makes OQ-A1 hold |
| A.3: nodes carry per-step args into the run                                    | `RemainderNodeSpec` carries `id`/`promptId`/`stepName` only, so `projectNodes` drops `args` for BOTH spellings. Their one effect is `required-argument-missing` validation                                                                             | ⚠ corrected — args are parsed to keep the two spellings equally admissible      |
| 4.5: "pattern: `verify-handoff.mjs`" including its stale-`dist/` refusal       | `verify-handoff.mjs` has NO staleness check; `verify-mcp-surface.mjs` does. The row's two clauses come from two different scripts                                                                                                                      | ⚠ corrected — the freshness half is modelled on `verify-mcp-surface.mjs`        |

## Deviations (Tier A continuation)

### DEV-TA2-1 — OQ-A2's `::` mapping is falsified: the loss is two-way, and it is about TIMING

**Row A.2 was NOT executed, and this is the second time it has stopped — on a different clause.**

> **CLOSED 2026-08-30** by OQ-A2b, which routes `::` to `inlineGateCriteria` on the node instead
> of to run-level `gates[]`. The reader this record identified (`InlineGateProcessor` at stage 11)
> is the one the re-ruling relies on, and it was re-probed before A.2 shipped. See DEV-TA3-4.
> DEV-TA-5 stopped it because `==>` had no node field; OQ-A2 answered that (a declared
> `delegated?: boolean`, implementable as ruled, along with the prompt-fallback and `* N` rows).
> It stops now on the `::` row, which was ruled from the gate union's SHAPE without measuring its
> CONSUMER.

Today, a per-step `::` token does TWO things, and it can do both only because it is resolved LATE:

1. `InlineGateProcessor.partitionGateCriteria` (stage 11, holds the gate registry) asks the
   resolver whether each token names a REGISTERED gate. `>>a :: code-quality --> >>b` therefore
   binds the real `code-quality` gate, not a temp gate with that string as a criterion.
2. The result is written onto that STEP's `inlineGateIds`, so the binding is per-node.

`TemporaryGateRegistrar` — the consumer of the run-level `gates[]` channel OQ-A2 routes to —
can do either, never both:

| What the IR could emit                             | What happens                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{criteria:['code-quality'], target_step_id:'n1'}` | `gateInputContainsInlineContent(gate)` is true → `resolveCanonicalGateId` returns `undefined` → a TEMP gate whose `pass_criteria` is `["code-quality"]` |
| `{id:'code-quality', target_step_id:'n1'}`         | Resolves canonically → `canonicalGateIds.add(...)` → `continue`, which never reads `target_step_id`. Run-wide, not bound to n1                          |

So this is not a spelling problem. The IR for a `-->` command is built at stage 04, which has no
gate registry, and no shape available there can say "resolve this token, then bind the result to
node nK". Either the IR gains a criteria-carrying channel (which the ruling forbids: "No node
field"), or resolution moves earlier, or `::` keeps its current path and A.2's own clause "the
string path stops building `chainSteps` on its own" stays false.

The cost of shipping it anyway is measured, not estimated:
`tests/unit/execution/parsers/symbolic-inline-gate-attribution.test.ts` asserts
`parsedCommand.steps?.[0]?.inlineGateCriteria` equals `['code-quality']` at the builder level, so
row A.2's own Verify clause ("existing symbolic-chain tests green") fails, and the tier's
"every change here is additive" constraint fails with it. A protected-surface regression is not an
implementation choice, so this stopped here rather than being re-ruled inside the tier.

**What is NOT blocked**, and is worth recording so a re-ruling does not re-derive it: `==>` →
`delegated?: boolean` on the node schema is additive and reaches YAML free through A.1's
derivation; `markDelegatedStepPrompts` already reads `subagentModel` and would only widen to
`step.delegated === true || step.subagentModel != null`; the prompt-level `subagentModel` /
`agentType` fallback moving into stage 06 is a real unification (`buildDirectCommand` already does
it for YAML, `buildSymbolicChain` for symbolic, and an IR run gets it for the first time — a
behaviour change on the IR path the re-ruling should price); `* N` needs nothing.

### DEV-TA2-2 — the append is translated at `PromptExecutor`, and the row's named site is untouched

Row A.3 names `mcp/tools/index.ts`'s argument allowlist, which is where four previous parameters
died. Nothing goes there: the append is not a new parameter. `PromptExecutor.executePromptCommand`
rewrites a `chain_id` + leading-`-->` call into `remainder: {mode:'append', nodes}` and clears the
command, so the pipeline receives the STRUCTURED spelling's request — the parameter that already
crossed both hops at rows 0.4 and 2.3.

That placement is what makes OQ-A1 structural instead of maintained. After that one line there is
no string spelling left, so admissibility (`resolveAnsweredUnknownId`), `validateWorkflowIR`, the
narrowed `maxNodes`, `replaceRemainder`, both caps and the recorded `origin`/`origin_unknown_id`
are not "kept in sync" — they are the same code. The both-spellings test therefore compares whole
`chain_run_nodes` rows (minus `session_id`) rather than named columns: a column a future change
sets on one path and not the other fails without anyone remembering to assert it. Probed by
mutating `mintAppendId` to append `-x`, which turned it red; restored.

Three narrowings the row does not mention, each refused BY NAME rather than dropped:

- **`::` and `==>` inside an append fragment** are refused, pointing at row A.2. Mapping them here
  would mean choosing the mapping A.2 is stopped on.
- **Node ids are derived from the prompt id**, not minted `n1..nK`: a counter would collide with
  the symbolic parser's frozen ids on the run being appended to, and a caller writing the
  structured spelling of the same append cannot guess a counter's starting point. A slug is
  reproducible from the command text, which is what lets OQ-A1's test author one id and get one
  row. `mintInsertionId` still de-duplicates against the live run.
- **`key="value"` args are parsed by a local regex**, not `ArgumentParser`. Bounded by what they
  feed: `RemainderNodeSpec` drops them, so their only effect is the `required-argument-missing`
  check — without them the string form would be refused for arguments the caller did supply, which
  would be a divergence from the structured form.

### DEV-TA2-3 — `verify-unknown-interrupt.mjs` is a knip entry, not an npm script

Adding `verify:unknown-interrupt` to `package.json` would put it under
`validate:suite-membership`, which then demands membership in `SUITE` or a declared exception with
a real consumer in `.github/` or `.husky/`. It cannot join `SUITE` (that runs before the build) and
wiring it into `ci.yml` costs a build-dependent CI step. `verify-handoff.mjs` faced the same choice
and is a `knip.json` entry with no npm script; this follows it.

**What would flip that**: a post-build validation suite existing for build-dependent checks to
join — the same `closedBy` the three existing `ALLOWED_OUTSIDE` entries already name. Until then
the drive is run by hand after `npm run build`, and the header says so.

Also corrected: the row says "pattern: `verify-handoff.mjs`" AND "refuses on stale `dist/`", but
`verify-handoff.mjs` has no staleness check at all — that is `verify-mcp-surface.mjs`. The script
takes the transport client from the first and `checkDistFreshness` from the second, and both
polarities were probed (green after a build; exit 1 with `dist/ is stale` after
`touch src/index.ts`).

## Tier A row A.2 (third attempt, under OQ-A2b) — re-measurement before execution

| Asserted (plan / dispatch)                                                         | Measured                                                                                                                                                                                                                                                       | Verdict                                                                               |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| OQ-A2b: `InlineGateProcessor` resolves raw `::` tokens per step at stage 11        | Confirmed at `inline-gate-processor.ts:347` (`partitionGateCriteria`) — each token is asked of `lookupTemporaryGateId` then `gateReferenceResolver.resolve`, splitting into `registeredGateIds` vs free-text `inlineCriteria`. The reader OQ-A2b names is real | ✓ RULING HOLDS — the field it prescribes has a correctly timed reader                 |
| Row A.2: the change lands in `symbolic-operator-parser.ts` + `04-parsing-stage.ts` | Neither. The parser already mints frozen `n1..nK` and already carries `delegated` / `inlineGateCriteria` on its `ExecutionStep`s; stage 04 only dispatches. The hand-rolled `ChainStepPrompt[]` construction is entirely in `symbolic-command-builder.ts`      | ⚠ corrected — the row named two files it did not need to touch and not the one it did |
| Row A.2: "per-step args" need mapping onto node fields                             | Already expressible: `WorkflowNode.args` landed at A.1. What needed care is not the FIELD but the TIMING — symbolic args go through the full `ArgumentParser` ladder + prompt defaults, IR args do not (`compiler.ts` refuses to re-derive)                    | ⚠ corrected — args are resolved BEFORE the node is built, not carried raw             |
| Row A.2 / OQ-A2b: `compileNode` "copies no prompt defaults"                        | It still does not — but the symbolic path's prompt-level `subagentModel`/`agentType` fallback had to move ONTO the node to survive, since `compileNode` reads the node only. Applied at the parse site, where it already lived                                 | ⚠ corrected — see DEV-TA3-1; the constraint is on the compiler, not on the mapping    |
| A.3's `::`/`==>` refusal "can now be lifted cheaply"                               | It cannot. `projectNodes` (`remainder-processor.ts:214-226`) narrows every node to `{id, promptId, stepName}` for BOTH spellings, so a mapped operator would be dropped before the store write                                                                 | ✗ not lifted — DEV-TA3-3                                                              |

## Deviations (Tier A row A.2)

### DEV-TA3-1 — the prompt-level fallback had to move onto the NODE, and that is not the killed unification

OQ-A2b killed unifying the prompt-level `subagentModel` / `agentType` fallback, requiring "both
paths keep today's fallback semantics unchanged". Measured: `buildSymbolicChain` set
`subagentModel: convertedPrompt.subagentModel` unconditionally on every step it built, while
`compileNode` reads the NODE's declaration only. Routing the symbolic path through the compiler
therefore DELETES that fallback unless something puts the value on the node first.

Two readings of the ruling were available and they disagree:

- "no prompt default may reach a node" → the fallback disappears from the `-->` path. That is a
  behaviour change on the path the ruling explicitly protects, in the opposite direction from the
  one it killed. Rejected.
- "`compileNode` may not copy prompt defaults; the symbolic parse still may" → the fallback stays
  exactly where it has always been (the parse site, reading `convertedPrompt`), and the compiler
  stays free of prompt lookups for defaults. The IR path gains nothing. Taken.

The second is what the ruling means — the killed row was about giving the IR path a fallback it
never had, and this gives it none. Probed both ways: dropping the fallback from the builder turns
the new fixture's assertion red (a prompt declaring `subagentModel: 'heavy'` loses it AND loses
the `delegated` flag stage 06 derives from it), and no IR-path test moves in either direction.

One incidental improvement, recorded because it is a behaviour delta however small: the old site
wrote `subagentModel: undefined` / `agentType: undefined` as PRESENT keys on every step of every
symbolic chain. They are now conditionally spread, so an absent hint is an absent key. Invisible
downstream — the blueprint is JSON-cloned, which erases an `undefined` value either way — which is
why the parity fixture had to declare a prompt that actually SETS both fields. A fixture with
neither cannot tell the two spellings apart.

### DEV-TA3-2 — `SymbolicCommandBuilder` takes the compiler as a third constructor argument

`engine/` (Layer 2) may not value-import `modules/workflow-ir/` (`engine-no-modules-or-mcp-value`,
ERROR severity), so the builder cannot call `compileWorkflowIR` directly. It takes it injected,
the seam `WorkflowCommandBuilder` already established, narrowed to the compile half: a `-->`
command's nodes are minted by the parser rather than submitted by a client, so there is no
untrusted shape for `validateWorkflowIR` to reject and no order for `linearize` to derive.

REQUIRED, not optional. An optional dependency with an `if (this.compileWorkflow)` guard is the
shape `refactoring.md` names an ordering bug in disguise — it would turn a missing wiring into a
silent fall-back to the old path, which is the one outcome this row exists to make impossible.
Cost: six test construction sites updated by name. `validate:arch` stays at 0 errors; the two new
`engine-cross-layer-type-only` warnings sit beside the four `workflow-command-builder.ts` already
carries.

### DEV-TA3-3 — A.3's `::` / `==>` refusal is NOT lifted, and its stated reason was wrong

The dispatch asked whether the refusal could be lifted cheaply now that the mapping exists. It
cannot, and the interesting part is that the blocker MOVED rather than persisted.

The refusal's own text said the operators "have no representation in a remainder node yet (plan
row A.2)". After this row, the node vocabulary represents both. What still cannot carry them is
one layer down: `projectNodes` (`capture/remainder-processor.ts:214-226`) narrows every submitted
node to `{id, promptId, stepName}` before `replaceRemainder` writes it, so a mapped `::` or `==>`
would be dropped silently on the way to `chain_run_nodes` — for the STRUCTURED spelling too. That
is precisely why accepting it in the string form would BREAK OQ-A1's "may never diverge": the
string form would appear to accept an operator that changes nothing about the run, which is worse
than refusing it.

Lifting it means widening `RemainderNodeSpec`, the store's node write and the row projection for
both spellings at once — storage surface owned by rows 1.2 / 2.3, not by A.2. Not done here.
What WAS done, because a stale reason is worse than a refusal: both messages and the module
docblock now name the layer that actually blocks them, so the refusal is retirable rather than
folklore. The two tests asserting the refusals key on the operator name, not the reason, and stay
green.

**Flip condition**: `RemainderNodeSpec` carries a step's gate/delegation declaration end-to-end
and a remainder-written `chain_run_nodes` row can be shown to hold it.

### DEV-TA3-4 — the row's Verify clause needed a fixture that can OBSERVE a loss

Row A.2 asks for byte-identical `chain_run_nodes` before and after. Measured: `chain_run_nodes`
has no column for `delegated`, `inlineGateCriteria`, `subagentModel` or `args` — the three fields
this row moves and the one it re-times. A rewiring that dropped all four would leave those rows
byte-identical and pass the row's own clause.

The check as written is therefore not vacuous but is far too coarse, so it was WIDENED rather than
substituted: the new suite compares every stable `chain_run_nodes` column AND the run blueprint's
whole `parsedCommand.steps`, which is what `buildChainNodes` derives those rows from and carries
strictly more. Both expectation sets were captured at `3a012bae` against the old builder, then
frozen as literals — not `toMatchSnapshot()`, which regenerates on `-u` and would launder exactly
the regression the file exists to catch.

Four mutation probes, each red then restored: `compileNode` dropping `inlineGateCriteria` (3/3
red), dropping `delegated` (1/3), the builder dropping the prompt-level fallback (1/3), and the
YAML loader dropping both new fields (1/12 in the loader suite). The differing blast radii are
themselves the evidence that the three assertions are independent rather than one assertion
written three times.

### DEV-TA3-5 — both new fields were carried at all three YAML strippers, unasked

The row scopes itself to the `-->` path, but `ChainStepSchema` is DERIVED from `workflowNodeSchema`
since A.1, so adding a field to the node schema makes YAML accept it whether or not anything
carries it. `node-schema.ts`'s own header states the rule (P6-F7): a field carried at fewer than
all three strippers is silently dead — accepted in the file, absent at run time, nothing red.

So `normalizeChainSteps` and the stage-04 projection carry both, and `ChainStepData` declares
both. This is the additive half OQ-A2 predicted for `delegated` ("YAML gains an explicit
context-isolation flag it could only express via `subagentModel` before") and the same is now true
of `inlineGateCriteria`, which YAML previously could not express at all — only pre-resolved
`inlineGateIds`.

## Findings promoted to the plan

- **P-A-F4**: a byte-equality check is only as wide as the columns it reads. Row A.2's own Verify
  clause (`chain_run_nodes` byte-identical) is structurally blind to every field that table has no
  column for — which was all three fields the row moves. The general form: when a row's evidence is
  "artifact X is unchanged", enumerate what X CANNOT represent before trusting a green. The fix is
  cheap when done up front (add the finer-grained artifact the coarse one is derived from) and
  invisible afterwards. See DEV-TA3-4.
- **P-A-F5**: a refusal's stated REASON rots independently of the refusal. A.3's `::`/`==>`
  messages cited row A.2 as their blocker; A.2 shipped and the messages would have kept sending
  readers to a closed row while the real blocker (`projectNodes`' three-field narrowing) went
  unnamed. Nothing detects this — the tests key on the operator name, not the reason, which is
  correct for the tests and is why the reason had no gate. Every refusal that cites a plan row is
  an unmarked `☐` in code prose (`cleanup-standards.md` §A Status Outlives What It Described).
  See DEV-TA3-3.
- **P-A-F3**: a ruling taken from a SCHEMA's shape is not a ruling about behaviour. OQ-A2's `::`
  row was correct that `gate-spec.schema.ts` accepts `{criteria, target_step_id}` and wrong about
  what happens next, because the consumer treats inline content and a canonical reference as
  mutually exclusive. The general form: when a ruling routes something to an existing channel
  "which already accepts exactly this", the probe is the channel's READER, not its schema.
  See DEV-TA2-1.
- **P-A-F1**: the `-->` → IR premise (A.2) is falsified; see DEV-TA-5. Needs a ruling. **CLOSED
  2026-08-30**: two rulings, on two different clauses — OQ-A2 for `==>` (`delegated?: boolean` on
  the node) and OQ-A2b for `::` (`inlineGateCriteria?: string[]`, resolved at stage 11 where the
  registry is). A.2 shipped under both. The durable lesson is the shape of the two stops: a row can
  be blocked on a ruling AND pointing at the wrong files, and the second is only visible once the
  first clears.
- **P-A-F2**: A.3 is ordered before its dependencies (0.1, 0.3, 0.4, 1.2); see DEV-TA-6. **Half
  discharged 2026-08-30**: rows 0.1/0.3/0.4 have landed, so `remainder` and its `mode` now exist
  for A.3 to name. A.3 remains blocked on row 1.2 (`replaceRemainder`), which is still the store
  method it says it shares. **CLOSED 2026-08-30**: 1.2 landed and A.3 shipped on top of it
  (`b0955c6c`). Recorded outcome for the ordering lesson: A.3 was never blocked on A.2 either,
  which the tier's ordering also implied — the append needed the `remainder` parameter, not the
  `-->` → IR compile.
- **P-0-F1**: `pauseOnBlocking` reaches nothing without three more projections; row 1.3 re-scoped
  in place. See DEV-T0-3.
- **P-0-F2**: contract parameters are gated by `validate:conformance-coverage`, so every future
  tier that ADDS one must either write a scenario or declare an exception with a close condition.
  New row 0.5 owns retiring the one Tier 0 declared. See DEV-T0-4.
- **P-1-F1**: `applyUnknownObservations` documents a throwing persist it does not perform. New row
  1.4 owns it; the throwing path now exists (DEV-T1-2), so the remaining question is posture, not
  plumbing.
- **P-A-F2 fully discharged 2026-08-30**: row 1.2 landed `replaceRemainder` with `mode`, which is
  the store method A.3 says it shares. A.3's stamp is updated — its only remaining blocker is row
  0.4's unproven allowlist reachability, which row 4.5's live drive settles.
- **P-1-F2**: the knip ratchet counts types exported from a barrel with no consumer, so a decision
  module that publishes its return type before the consuming tier lands fails
  `validate:knip-ratchet`. Resolved by giving the two types a test consumer (typed assertion
  helpers, the pattern `mutation-policy.test.ts` already uses) rather than by loosening the
  baseline. Worth knowing for Tier 2, which will publish more types ahead of their consumers.
- **P-2-F1**: a mock can make a method throw that production can never make throw, and the test
  then measures the mock. `applyUnknownObservations`' persist-failure test passed for four months
  against a swallowing caller. The general shape: when a spy REPLACES a method whose real body
  cannot produce the outcome under test, the assertion is vacuous. The detector is cheap — mutate
  the production call site and confirm the test goes red — and it is what turned this one up.
  See DEV-T2-7. Every persistence spy in the repo now sits on the throwing funnel.
- **P-2-F2**: a response surface has TWO formatting methods (`formatChainResponse`,
  `formatSinglePromptResponse`) and a gated single prompt with a session reaches the second one.
  Anything added to one and not the other is invisible to the chain suite. Closed for the
  interrupt section (DEV-T2-8); the class is open for every future section, and no gate owns it.
- **P-2-F3**: the plan's §Interrupt payload verb list is not true of a paused run — it offers
  "answer the step" where no step was issued. New row 2.6 owns the ruling. See DEV-T2-10.
- **P-3-F1**: a conformance run declaring `workspace: isolated` still writes seven prompts into
  `server/resources/prompts/examples/`, which turns `validate:readme` red for anyone who runs
  `test:e2e` locally. Attributed away from this tier by probe (DEV-T3-5). New row 6.1 owns it.
- **P-3-F2**: a hook that reads run state from RESPONSE TEXT is blind to any hold whose response
  the server deliberately formats differently. The interrupt was invisible to `gate-enforce.py`
  for exactly this reason, and the same shape will recur for the next hold that suppresses the
  gate-review prose. The general form: `session_state`'s parser is a second, text-shaped model of
  server state, and nothing fails when the server stops emitting the marker it keys on. No gate
  owns this; `db_reader` (which reads the DB) has no equivalent blind spot.
