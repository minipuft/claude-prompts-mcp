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

## Findings promoted to the plan

- **P-A-F1**: the `-->` → IR premise (A.2) is falsified; see DEV-TA-5. Needs a ruling.
- **P-A-F2**: A.3 is ordered before its dependencies (0.1, 0.3, 0.4, 1.2); see DEV-TA-6. **Half
  discharged 2026-08-30**: rows 0.1/0.3/0.4 have landed, so `remainder` and its `mode` now exist
  for A.3 to name. A.3 remains blocked on row 1.2 (`replaceRemainder`), which is still the store
  method it says it shares.
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
