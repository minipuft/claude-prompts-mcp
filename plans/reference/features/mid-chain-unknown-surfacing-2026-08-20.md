---
title: Mid-chain unknown surfacing and adaptive consolidation
date: 2026-08-20
status: reference
tags:
  - chains
  - unknowns-ledger
  - adaptive-mutation
  - interrupts
---

# Mid-chain Unknown Surfacing and Adaptive Consolidation

Promoted `backlog → active` 2026-08-30 after an interview ruled every open question (§Rulings).

**Landing (2026-08-31):** implementation complete on `feat/mid-chain-unknown-surfacing` — PR #254
(https://github.com/minipuft/claude-prompts-mcp/pull/254), 25 commits, all gates green. Retired 2026-08-31: F-1 killed (no demand), 6.1 killed here and handed to the active
`resource-surface-consolidation` plan that owns write containment. The two follow-on plans below promote from `backlog` once this PR merges.
Two ideas raised in that interview were split into their own backlog plans rather than rows here:
`plans/features/unknowns-corpus-prompt-evolution-2026-08-30.md` and
`plans/features/external-observation-source-2026-08-30.md`.

## Current State (re-verified at HEAD, 2026-08-30)

The `prompt_engine` tool already accepts an `observations` parameter carrying typed unknown
entries, and a deterministic mutation policy already reacts to them:

| Concern                                                              | Where                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract source of truth (`observations` description, shapes, notes) | `server/tooling/contracts/prompt-engine.json`                                                                                                                                                                  |
| Zod input schema (`observations`, `gate_action` ~line 325)           | `server/src/mcp/tools/schemas/prompt-engine.schema.ts`                                                                                                                                                         |
| Generated contract schema                                            | `server/src/mcp/contracts/schemas/_generated/prompt_engine.generated.ts`                                                                                                                                       |
| Explicit argument allowlist (params are dead on the wire until here) | `server/src/mcp/tools/index.ts` ~824-853 — four recorded instances of a typechecked-but-unreachable param (re-measured 2026-08-30: four confirmed; `remainder` is the fifth and is now listed there, unproven) |
| Entry types (`UnknownObservation`, `UnknownLedgerEntry`)             | `server/src/shared/types/chain-session.ts`                                                                                                                                                                     |
| Ledger transition rules (pure, all-or-nothing batch, 200-entry cap)  | `server/src/engine/execution/capture/unknown-observation-processor.ts` (`computeUnknownLedger`)                                                                                                                |
| Adaptive mutation decision (pure)                                    | `server/src/engine/execution/pipeline/decisions/mutation/mutation-policy.ts` (`decideMutation`), `types.ts`                                                                                                    |
| Mutation application (Tier 3 orchestration)                          | `server/src/engine/execution/pipeline/stages/16-response-capture-stage.ts` (`applyMutation` ~291; observations read at ~258 — the ONLY source today)                                                           |
| IR budget readback per step                                          | `16-response-capture-stage.ts` ~459-465 (`maxInsertions` off the blueprint) — precedent for any new knob                                                                                                       |
| Storage mutations                                                    | `server/src/modules/chains/manager.ts` (`insertNodeAfter` ~1237, `markNodeSkipped` ~1327, `setPendingGateReview` ~1611)                                                                                        |
| Pending kinds on a session                                           | `pendingGateReview`, `pendingShellVerification` (`chain-session.ts` ~191-193) — both projected into `chain_sessions` and read by `hooks/lib/session_state.py`                                                  |
| Reserved synthetic gate id precedent                                 | `PHASE_GUARD_GATE_ID = '__phase_guard__'` (`stages/19-phase-guard-verification-stage.ts:36`), `__gate_review__` synthetic step (`response-assembler.ts` ~337)                                                  |
| Hook resolution verbs (generated)                                    | `hooks/lib/_generated/resolution_verbs.py` from `resolvesPendingRun` flags (renamed from `resolvesPendingGate` by row 0.2); consumed by `hooks/gate-enforce.py` Check 2                                        |
| Inserted investigation prompt                                        | `server/resources/prompts/workflow/investigate_unknown/prompt.yaml`                                                                                                                                            |
| Behavior docs                                                        | `docs/concepts/chains-lifecycle.md`, `docs/reference/mcp-tools.md`, `docs/reference/workflow-ir.md`                                                                                                            |
| Integration tests                                                    | `server/tests/integration/chain/unknown-observations-flow.integration.test.ts`, `chain-run-storage.integration.test.ts`                                                                                        |

Observation shapes: `{type:'unknown_discovered', id, statement, blocking?, target_step_id?}`
opens/refreshes a ledger entry; `{type:'unknown_resolved', id, statement, resolution:'answered'|'irrelevant'}`
closes one. The policy is advisory by construction (the model emits observations; the server owns
every mutation) and does exactly two things:

1. **Insert**: a blocking `unknown_discovered` inserts ONE `investigate_unknown` node immediately
   after the current node (capped at 1 per unknown id, 3 per run; insert takes precedence over skip).
2. **Skip**: an `unknown_resolved` with `resolution:'irrelevant'` skips its ledger entry's
   `target_step_id` when that node is strictly ahead of the current step.

**Ground that shifted since 2026-08-20** (all verified 2026-08-30):

- `gate-enforce-resolution-verbs` landed rows 1-6: new resolution verbs are a contract flag plus
  `generate:contracts`, not a hook edit.
- Cross-client handoff (schema v25, `49efdcf1`): `prompt_engine(claim_token)` transfers ownership
  AND resumes in the same call. A paused run must hand the claimer the pause, not the next step.
- The guidance layer already promises this feature: `~/.claude/skills/unknowns` and
  `mcp-prompt-router` §Mid-Chain Unknowns both say a blocking unknown "pauses the chain and
  proposes a revised path." The server does neither. Those paragraphs are the reference spec.
- `observations` has zero consumers in `minipuft-plugins`, `gemini-prompts`, `opencode-prompts`.
- The ledger is ephemeral (per-run session JSON, PID-deleted); `execution_records` keeps only
  terminal counts (`unknowns_opened/closed`, `nodes_inserted/skipped`), never statements.

## Gap

When a blocking unknown lands, the run bends but never stops or reports:

- The chain **continues** into the inserted investigation node with no structured account of what
  the unknown affects. The caller declared `blocking: true` and receives the same response shape
  as any other step.
- There is no way to **propose a better path**. The policy can insert one investigation node or
  skip one declared target; it cannot replace the remainder when the discovery invalidates the
  plan's shape. The run always finishes the original plan modulo those two local edits.

## Rulings (interview 2026-08-30 — every open question closed)

| #    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | ✓ **Consolidated.** The inserted investigation node IS the pause point. Insertion applies at capture exactly as today; the investigation step's response carries the structured `chain_interrupt` block (text section + `structuredContent`). Resume = answer the step. No new run state on the default path. Rationale: the model that sent `blocking:true` already knows it is blocked; a mandatory `resume` round-trip confirms what it just said.                                                                   |
| D-2  | ✓ **Hard pause is a submission knob**, `budget.pauseOnBlocking` (Workflow IR, default `false`), read back off the blueprint per step like `maxInsertions`. When on, stage 16 applies the insertion then sets a **synthetic `pendingGateReview`** with reserved gate id `__unknown_interrupt__`; the response is the interrupt alone. Legitimate dial: autonomous vs supervised runs. Template-chain runs get the default.                                                                                               |
| OQ-4 | ✓ **Extend `gate_action`** with `resume` and `accept_alternative` (`abort` exists; `cancel:true` also exits). The contract flag is renamed `resolvesPendingGate → resolvesPendingRun` (generator + Python artifact + `gate-enforce.py` in one commit). The synthetic review means `chain_sessions`, `session_state.py`, and Check 2 need no structural change. Rejected: third pending kind (`pendingUnknownInterrupt`) — the full shell-verify sibling set for one verb pair.                                          |
| OQ-3 | ✓ **Model authors the alternative; server validates.** New `remainder` param: `{nodes:[…IR nodes], edges?:[…]}`, accepted only with `chain_id` while a blocking unknown is open on the ledger (or `__unknown_interrupt__` is pending). Validated by the Workflow IR node/edge schemas and caps (`maxNodes` counts executed + remainder). Replaces every node strictly after the current node atomically. Rationale: a static server can derive reorder/skip from declared links, never the merge the plan is named for. |
| OQ-2 | ✓ **Declared `target_step_id` links only** for `affected_step_ids`. Consistent with "the server reacts only to declared observations"; deterministic; unit-tested on the pure module. Textual scanning rejected as heuristic.                                                                                                                                                                                                                                                                                           |
| OQ-5 | ✗ KILLED (2026-08-30 · the stated evidence cannot be gathered — only a `diagnostics.info` line exists · revives if a recorded mutation field in `execution_records` shows a non-blocking resolution would have saved ≥2 steps). Scope is blocking-only.                                                                                                                                                                                                                                                                 |
| D-7  | ✓ **§Adapter layer is a constraint, not rows.** The payload is client-agnostic JSON in `structuredContent`; nothing client-specific enters `server/resources/` or the contract. No adapter ships here until a downstream repo asks.                                                                                                                                                                                                                                                                                     |
| D-8  | ✓ **Signal preservation.** A remainder acceptance is recorded (`chain_run_nodes.origin = 'remainder'` + `origin_unknown_id`; terminal `execution_records` counters `interrupts_raised`, `remainders_accepted`) so the corpus follow-on has something durable-adjacent to read. No new durable table here.                                                                                                                                                                                                               |
| D-9  | ✓ **Handoff × pause**: claiming a run with `__unknown_interrupt__` pending returns the interrupt to the claimer. Expected free via the synthetic review (stage 13 surfaces `pendingReview` on resume) — proven by a test, not assumed.                                                                                                                                                                                                                                                                                  |

## Interrupt payload

Rides on the investigation step's response (default) or alone (knob on). Text section mirrors
the gate-pending prose; `structuredContent.chain_interrupt` is the machine-readable form:

```jsonc
{
  "kind": "chain_interrupt",
  "reason": "blocking_unknown",
  "unknown": { "id": "...", "statement": "..." },
  "affected_step_ids": ["..."], // declared target_step_id links only (OQ-2)
  "remaining_nodes": [{ "id": "...", "promptId": "...", "stepName": "..." }], // post-insert
  "paused": false, // true only when budget.pauseOnBlocking is on
  "resume": {
    "chain_id": "...",
    // STATE-DEPENDENT, not additive (ruled by row 2.6, 2026-08-30). Unpaused, as written here.
    // PAUSED: ["gate_action:resume", "gate_action:accept_alternative (with remainder)",
    //          "gate_action:abort", "cancel"] — never "answer the step", because a paused run
    // issues no step, and never a bare "remainder", which does not clear the synthetic review.
    "verbs": ["answer the step", "remainder", "gate_action:abort", "cancel"],
  },
}
```

`remainder` on a call is the alternative; `accept_alternative` is only meaningful with a
`remainder` in the same call (rejected with a named reason otherwise). Caps carry over: one
accepted remainder per unknown id, `maxInsertions`-style ceiling per run.

## Tier A (alpha) — one step representation, three inputs

Ruled 2026-08-30 after the tiers below were written: YAML `chainSteps`, IR `nodes`, and
`-->` symbolic chains carry the same step vocabulary (`promptId, stepName, id, inputMapping,
outputMapping, retries, subagentModel, agentType, framework, inlineGateIds, visibility` —
`chain-schema.md:21-31` vs `workflow-ir/types.ts:38-66`) and compile to identical runs, but
they are validated by separate schemas that merely agree today. Tier A makes the IR the single
representation: YAML is a **stored** IR, `-->` is a **hand-written linear** IR, `workflow` is a
**submitted** IR. Everything below then reasons about one shape, and `budget.pauseOnBlocking`
reaches YAML chains instead of being IR-only (the distinction the 2026-08-30 review flagged).

Measured: 5 bundled YAML chains, 0 in downstream repos; YAML-only `delegation` is an exporter
marker, not runtime delegation (runtime = `subagentModel`/`agentType`/`==>`, stage 06 marks both
paths), so it stays outside the node schema. The `>>`/`-->`/YAML surfaces are protected contract;
every change here is additive.

| Row | Status                                                                                                                                                                                                                                                                                  | Where                                                                                                                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Verify                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A.1 | ✓ (verified 2026-08-30 · `validate:all` 50/50, 218 unit suites, 5/5 bundled chains load unchanged)                                                                                                                                                                                      | `workflow-ir.schema.ts`, prompt loader, `chain-schema.md`                                                                                      | `chainSteps[]` validates against the IR node schema (one Zod source imported by the loader); YAML additionally accepts `edges:` and `budget:` at chain level. `delegation` stays a YAML-only exporter key stripped before validation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | A gate that fails when the two field lists diverge (`validate:chain-node-parity` or a type-level `satisfies`); 5 bundled chains load unchanged                                                                                                                                             |
| A.2 | ✓ (verified 2026-08-30 under OQ-A2b · `chain_run_nodes` AND blueprint steps byte-identical before/after for `>>a --> >>b` and `>>a --> >>b :: 'x' ==> >>c`, captured at `3a012bae`; `symbolic-inline-gate-attribution.test.ts` green; four mutation probes red then restored)           | `symbolic-command-builder.ts`, `workflow-ir/node-schema.ts` + `types.ts` + `compiler.ts`, `06-operator-validation-stage.ts` (see DEV-TA3-1..5) | `buildSymbolicChain` maps a `-->` command to IR nodes (frozen `n1..nN`, linear edges, resolved per-step args, `==>` → `delegated`, per-step `::` → `inlineGateCriteria`) and calls `compileWorkflowIR` through an injected seam; it builds no `ChainStepPrompt[]` of its own. `delegated?` + `inlineGateCriteria?` added to the node schema (additive, reaching YAML via A.1's derivation and carried at all three strippers). Stage 06 widened to `step.delegated === true \|\| step.subagentModel != null`, still the runtime flag's only producer. **Row named `04-parsing-stage.ts` / `symbolic-operator-parser.ts`; neither needed the change**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Byte-identical `chain_run_nodes` for `>>a --> >>b` before/after (snapshot); existing symbolic-chain tests green                                                                                                                                                                            |
| A.5 | ✓ (verified 2026-08-31 · `==>` carried end-to-end and observable on the row in BOTH spellings; `::` REFUSED instead of carried, and the two spellings agree on that too — see the correction below · unit 221/2822, integration 60/785, `validate:all` 50/50, live drive 10/10)         | `capture/remainder-processor.ts` (`projectNodes`), `RemainderNodeSpec`, `modules/chains/manager.ts`                                            | Discovered by A.2. A.3's `-->`-append refuses `::` and `==>`; A.2 removed the reason it CITED (the node vocabulary now says both) but not the blocker. `projectNodes` narrows every submitted node to `{id, promptId, stepName}` for BOTH spellings, so a mapped operator is dropped before the store write — accepting it in the string form would break OQ-A1's "may never diverge" by making it accept an operator that changes nothing. Widen the remainder node spec, the store write and the row projection together, then lift the refusal. Messages already name the real layer (DEV-TA3-3). **Shipped 2026-08-31, and the row's "then lift the refusal" was only half true.** `==>` is lifted: `delegated` is carried by `RemainderNodeSpec` → `ChainNode` → a new `chain_run_nodes.delegated` column (v27) → `synthesizeStep`, which is the layer the row did not name and the only place a contributed node's declaration can reach the rendered step. `::` is NOT lifted and is now refused on BOTH spellings: a raw gate token has no meaning until `InlineGateProcessor` resolves it against the registry, and an appended node joins a RESUMING run where `05-inline-gate-stage` skips on `isBlueprintRestored` — carrying it would have recorded a token that fires nothing, the outcome OQ-A1 forbids. The blocker was again one layer past where the row looked (DEV-T5-2). Scope widened from the two operators to the CLASS: `projectNodes` dropped nine IR node fields, not two, so every field is now carried (`args`, `delegated`) or refused by name, with `remainder-node-fields.test.ts` failing when a new IR node field is neither | `==>` observable on the `chain_run_nodes` row in both spellings (integration, raw columns + cold load); its refusal test DELETED. The `::` test kept and its message rewritten to the real reason — a refusal that survives is not a loosened test. Four mutation probes red then restored |
| A.3 | ✓ (verified 2026-08-30 · `b0955c6c` · live drive 8/8 against a built `dist/` including the string append on the wire; OQ-A1's both-spellings test asserts identical `chain_run_nodes` rows, mutation-probed red then restored)                                                          | `tooling/contracts/prompt-engine.json`, `mcp/tools/index.ts` allowlist                                                                         | **Append**: `chain_id` + `command` beginning with `-->` extends the running chain — validated as IR nodes, appended after the current remainder via the same store method `remainder` uses (mode `append` vs `replace`). Lifts the `command`×`chain_id` exclusivity for this one leading-`-->` form only. **No allowlist change was needed** — the translation happens at `PromptExecutor`, so the call reaches the pipeline as the structured spelling's request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Integration: `chain_id` + `"--> >>x"` adds a node; `chain_id` + `">>x"` (no leading arrow) still rejected as before; live drive for the allowlist                                                                                                                                          |
| A.4 | ✓ (verified 2026-08-31 · `validate:format` green; `workflow-ir.md` gains the two new node fields, `pauseOnBlocking`, and an "Extending or replacing a running plan" section covering both spellings of an append; `chain-schema.md` gains the same fields and `budget.pauseOnBlocking`) | `docs/reference/workflow-ir.md`, `chain-schema.md`, `mcp-tools.md`                                                                             | Document the three inputs → one IR; `budget` in YAML; append syntax                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Docs/code lockstep                                                                                                                                                                                                                                                                         |

### Tier A execution record (2026-08-30)

**A.1 shipped.** `server/src/modules/workflow-ir/node-schema.ts` is the one Zod source;
`ChainStepSchema` is derived from `workflowNodeSchema` (`.omit().extend()`), so the add-a-field
direction cannot drift, and `tests/unit/workflow-ir/chain-node-parity.test.ts` is the gate for the
other direction plus the two identity deltas. Receipts: `npm run validate:all` — 50 steps, 50
passing; 218 unit suites / 2762 tests; all 5 bundled chains load with their authored step order
unchanged.

Two authored counts were falsified and are corrected here rather than in passing:

- **"YAML `chainSteps` and IR `nodes` … merely agree today" — they already disagreed.** Measured:
  `WorkflowNode` declared `args` and `ChainStepSchema` did not; `ChainStepSchema` declared
  `delegation` and `WorkflowNode` did not. The tier's premise understated the drift by exactly the
  two fields the row then had to resolve — `args` is now carried on the YAML path at all three
  strippers, `delegation` is stripped before validation.
- **"5 bundled YAML chains" — 5 confirmed**, but `rg chainSteps resources/prompts` returns SIX
  files: `examples/create_prompt` matches inside a script tool's JSON schema, not a chain. A count
  taken from that grep would have been 6.

_(Superseded 2026-08-31: A.2 later shipped ✓ under OQ-A2b — see row A.2 and the Tier A continuation record. Preserved as the first attempt's stop record.)_

**A.2 is ⚠, not ☐: its premise is falsified.** "per-step args/gates/`==>` mapped onto node fields"
has no node field for two of the three. A symbolic step carries `inlineGateCriteria` (free-text
`::` criteria — `inlineGateIds` is ids, a different channel) and `delegated` (set from `==>`),
and the IR node schema expresses neither. Adding `delegated` would give one runtime flag two
producers, which `compiler.ts` documents as the thing it exists not to do, and — now that
`ChainStepSchema` is derived — would also put a runtime-only flag into YAML. Resolving this is a
ruling, so it stopped here: see the implementation notes, DEV-TA-5.

_(Superseded 2026-08-31: A.3 shipped ✓ at `b0955c6c` once rows 0.1/0.3/0.4/1.2 landed.)_

**A.3 is blocked, not deferred.** It names "the same store method `remainder` uses" and the
`command`×`chain_id` lift for a `remainder`-shaped append, but `remainder` does not exist yet
(rows 0.1, 0.3, 0.4) and neither does `replaceRemainder` (row 1.2). OQ-A1's both-spellings test
cannot be written until the structured spelling does. Tier A is ordered before its own
dependencies; the next tier to run should be 0, then 1, then A.3 + A.4. See DEV-TA-6.

OQ-A1 ✓ RULED 2026-08-30: **one mechanism, two spellings.** The leading-`-->` string and
`remainder: {mode:'append', nodes}` are the same append — the string form parses to the
structured form (A.2) and both take the same store path (A.3). They may never diverge in
validation, caps, or recorded provenance; a test submits both spellings of one append and
asserts identical `chain_run_nodes`.

OQ-A2 ✗ **SUPERSEDED 2026-08-30 by OQ-A2b, and DISCHARGED**: A.2 shipped under the re-ruling, so
the `::` row below is dead text and the `==>` / `* N` rows below are live and implemented. The
falsification record is kept unedited because the reusable part is HOW it was wrong.

OQ-A2 ⚠ **PARTLY FALSIFIED 2026-08-30 by execution — reopened, not re-ruled.** The `==>`,
prompt-fallback and `* N` rows below hold. The `::` row does not: it was ruled from the gate
UNION's shape (`gate-spec.schema.ts` accepts `{criteria, target_step_id}`) without measuring what
the run-level channel's CONSUMER does with such an entry. Measured at HEAD, it cannot preserve
today's behaviour in either spelling — see §Tier A continuation record and DEV-TA2-1. Re-ruling it
is the operator's, so row A.2 is ⚠ and unshipped rather than shipped with a regression.

The ruling as originally written follows, unedited, because the reusable part is HOW it was wrong:

OQ-A2 ✓ RULED 2026-08-30 (main thread, from DEV-TA-5's measurement — operator may overturn):
**every symbolic operator lands on a field the IR already has or a field both forms should have
declared; nothing is post-decorated.**

| Symbolic input                                    | IR target                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `::` free-text criteria on a step                 | Run-level `gates[]` entry `{criteria:[…], target_step_id:'<nK>'}` — the gate union already accepts exactly this (`gate-spec.schema.ts`). No node field                                                                                                                                                                                                                                                                     |
| `==>` on a step                                   | New declared node field `delegated?: boolean` on the IR node schema — and therefore on YAML `chainSteps` via A.1's derivation (additive; YAML gains an explicit context-isolation flag it could only express via `subagentModel` before). `compileNode` passes the DECLARATION through; stage 06 `markDelegatedStepPrompts` stays the single producer of the runtime flag, now reading `node.delegated \|\| subagentModel` |
| Prompt-level `subagentModel`/`agentType` fallback | Stays in stage 06 for every path (it holds `convertedPrompt`). `compileNode` does NOT copy prompt defaults into the node — that promotion is what `compiler.ts` refuses, and it stays refused                                                                                                                                                                                                                              |
| `* N`                                             | Unrolled nodes, as the parser already does                                                                                                                                                                                                                                                                                                                                                                                 |

Rejected: compile-then-post-decorate (makes A.2's own clause false); mapping `==>` onto
`subagentModel` (conflates a context-isolation choice with a model-tier hint — the retired
delegation contract separated those deliberately).

OQ-A2b ✓ RE-RULED 2026-08-30 (main thread, after DEV-TA2-1 falsified the `::` row by probing the
reader — P-A-F3): **`::` criteria do NOT route through run-level `gates[]`.** `TemporaryGateRegistrar`
either literalizes a canonical id into a temp-gate criterion or drops `target_step_id` on resolve —
measured, both halves. Instead the IR node schema declares the channel that already has a correctly
timed reader: `inlineGateCriteria?: string[]` (raw tokens; `InlineGateProcessor` resolves them at
stage 11 with the registry in hand, per step — `inline-gate-processor.ts:164`). It flows into YAML
via A.1's derivation, additive. `compileNode` passes it through exactly like `inlineGateIds`.
The prompt-level `subagentModel`/`agentType` fallback unification is ✗ KILLED (2026-08-30 · it
would change IR-path behaviour — IR runs would gain a fallback they never had · revives if a real
run needs the fallback on an IR node): both paths keep today's fallback semantics unchanged.
The `==>` → `delegated` half of OQ-A2 stands as ruled.

### Tier A continuation record — rows A.3 and 4.5 (2026-08-30)

**A.3 and 4.5 shipped (`b0955c6c`); A.2 stopped at its ruling.** Receipts: `validate:all` — 50
steps, 50 passing; 220 unit suites / 2812 tests (was 219 / 2781); 59 integration suites / 779
tests (was 777); `typecheck` clean; `typecheck:tests:ratchet` 367 and `lint:ratchet` 3097/970 (no
regressions); `validate:arch` 0 errors; `validate:knip-ratchet` green; `generate:contracts` +
`validate:contracts` green.

**A.2 STOPPED: OQ-A2's `::` mapping cannot preserve today's behaviour, and the failure is a
two-way one.** The ruling was taken from the gate union's SHAPE without measuring its CONSUMER.
`TemporaryGateRegistrar` answers a run-level gate entry in exactly two ways, and each loses one of
the two things a per-step `::` token carries today:

| Spelling the IR could emit for `>>a :: code-quality --> >>b` | What the registrar does                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{criteria:['code-quality'], target_step_id:'n1'}`           | `resolveCanonicalGateId` returns early on ANY inline content (`gateInputContainsInlineContent`), so the registered gate is never resolved — a temp gate is created whose pass criterion is the literal string `"code-quality"` |
| `{id:'code-quality', target_step_id:'n1'}`                   | Resolves canonically — and then `continue`s, dropping `target_step_id` with it. Run-wide instead of bound to n1                                                                                                                |

Today's path does both at once because it resolves LATE: `InlineGateProcessor.partitionGateCriteria`
runs at stage 11 with the gate registry in hand, splits each `::` token into registered-id vs
free-text, and writes the result onto that step's `inlineGateIds`. Stage 04, where the IR would be
built, has no registry. So "run-level `gates[]`, no node field" is not a spelling problem — it is a
timing one, and no arrangement of the ruled target can express "resolve this token, then bind the
result to node nK".

Cost of shipping it anyway, measured rather than estimated: `symbolic-inline-gate-attribution.test.ts`
asserts `parsedCommand.steps[0].inlineGateCriteria === ['code-quality']` at the builder level, so
row A.2's own Verify clause ("existing symbolic-chain tests green") fails, and the plan's own
"every change here is additive" constraint fails with it. Stopped per the dispatch's judgment
boundary. See DEV-TA2-1.

**A.3 needed no allowlist entry, and the row's premise about that was wrong in a useful
direction.** The row and its blocked-status note both assumed the append would ride a new
parameter through `mcp/tools/index.ts`. It does not: `PromptExecutor` rewrites the `-->` command
into `remainder: {mode:'append'}` and clears the command, so the call arrives at the pipeline as
the structured spelling's request — byte-for-byte. That is what makes OQ-A1's "may never diverge"
structural rather than maintained: after that one line there is only one spelling left, so
admissibility, `validateWorkflowIR`, the caps, `replaceRemainder` and the recorded
`origin`/`origin_unknown_id` are literally the same code. The both-spellings test compares whole
`chain_run_nodes` ROWS (minus `session_id`), so a future column one spelling sets and the other
does not fails without anyone remembering to assert it; a mutation to the id derivation turned it
red and was restored.

**The string form is narrower than the structured one, and says so by name.** It derives node ids
from the prompt id (`n1` would collide with the symbolic parser's frozen ids and is unguessable
from the structured side), carries no edges, and REFUSES `::` and `==>` with a message naming row
A.2 — because accepting them would mean choosing the mapping A.2 is stopped on.

**The live drive found nothing wrong, which is itself the receipt.** Unlike Tier 2's drive, all 8
checks passed first run — including the string append reaching stage 16 over the wire, and the two
negative controls (an unregistered prompt refused by the named IR rejection; `chain_id` + `>>x`
still refused as two command sources). The stale-`dist/` refusal was probed in both polarities:
green after a build, exit 1 after `touch src/index.ts`.

**`verify-unknown-interrupt.mjs` is declared to knip rather than to `SUITE`.** It spawns a built
server, so it cannot join a suite that runs before the build, and giving it an npm script without
a CI consumer is the exact unwired-check shape `validate:suite-membership` exists to catch. It
follows `verify-handoff.mjs`, which is a `knip.json` entry for the same reason. DEV-TA2-3 records
what wiring it into CI would cost, so the choice is retirable rather than silent.

### Tier A execution record — row A.2 (2026-08-30, third attempt)

**A.2 shipped under OQ-A2b; new row A.5 split out.** Receipts: `validate:all` — 50 steps, 50
passing; 220 unit suites / 2814 tests (was 220 / 2812); 60 integration suites / 782 tests (was 59
/ 779); `typecheck` clean; `typecheck:tests:ratchet` 367 and `lint:ratchet` 3095/970 (no
regressions); `validate:arch` 0 errors, 17 warnings; `generate:contracts` + `validate:contracts`
green; `verify-unknown-interrupt.mjs` 8/8 against a fresh build.

**The row's own Verify clause could not have caught the failure it was written for.** Row A.2 asks
for byte-identical `chain_run_nodes`, and that table has NO column for `delegated`,
`inlineGateCriteria`, `subagentModel` or `args` — the three fields the row moves and the one it
re-times. A rewiring that dropped all four passes it. The check was widened rather than
substituted: the new suite compares every stable `chain_run_nodes` column AND the run blueprint's
whole `parsedCommand.steps`, which is what `buildChainNodes` derives those rows from. Both
expectation sets were captured at `3a012bae` against the old builder and frozen as literals, not
`toMatchSnapshot()` — a snapshot regenerates on `-u`, which would launder the exact regression the
file exists to catch. Promoted as P-A-F4. DEV-TA3-4.

**OQ-A2b's premise was probed before it was relied on, and it held.** The re-ruling routes `::` to
`inlineGateCriteria` on the strength of `InlineGateProcessor` resolving raw tokens per step at
stage 11 with the registry in hand. Measured at `inline-gate-processor.ts:347`: exactly that. This
is the probe P-A-F3 says OQ-A2 skipped — the channel's READER, not its schema — and it is the one
that separates a workable ruling from a shapely one.

Three corrections rather than asides:

- **The row named two files it did not need and missed the one it did.** `symbolic-operator-parser.ts`
  already mints the frozen `n1..nK` and already carries `delegated` / `inlineGateCriteria` on its
  `ExecutionStep`s; stage 04 only dispatches. All of the hand-rolled `ChainStepPrompt[]`
  construction was in `symbolic-command-builder.ts`, which the row does not mention. Nothing
  about the mapping was hard once the site was right, which is the more useful half of this: the
  row read as blocked partly because it was pointing at the wrong two files.
- **The prompt-level fallback had to move onto the NODE, and that is not the unification OQ-A2b
  killed.** `compileNode` reads the node only, so routing the symbolic path through it deletes
  `subagentModel`/`agentType`'s prompt fallback unless the mapping puts them on the node first.
  The killed row was about giving the IR path a fallback it never had; this gives it none, and
  the fallback stays exactly where it has always lived — at the parse site, reading
  `convertedPrompt`. Probed: a fixture prompt declaring `subagentModel: 'heavy'` loses both the
  hint and the `delegated` flag stage 06 derives from it when the fallback is removed. DEV-TA3-1.
- **A.3's refusal is not lifted, and its stated reason had already gone stale.** The messages
  cited row A.2 as the blocker; A.2 shipped, and the real blocker is one layer down —
  `projectNodes` narrows every remainder node to `{id, promptId, stepName}` for BOTH spellings, so
  a mapped operator is dropped before the store write. Accepting it in the string form would break
  OQ-A1 by making it accept an operator that changes nothing. New row A.5 owns the widening; the
  messages now name the layer instead of a closed row. Promoted as P-A-F5. DEV-TA3-3.

**Both new fields were carried at all three YAML strippers, unasked.** `ChainStepSchema` is derived
from the node schema since A.1, so a field added for `-->` is accepted by YAML whether or not
anything carries it — the P6-F7 shape the node schema's own header warns about. `delegated` is the
additive gain OQ-A2 predicted (isolation without naming a model tier); `inlineGateCriteria` is a
larger one, since YAML could previously express only pre-resolved `inlineGateIds`. DEV-TA3-5.

### Tier A execution record — row A.5 (2026-08-31)

**A.5 shipped, and the row's own framing was falsified twice in the same direction.** Receipts:
`validate:all` — 50 steps, 50 passing; 221 unit suites / 2822 tests (was 220 / 2814); 60
integration suites / 785 tests (was 60 / 782); `typecheck` clean; `typecheck:tests:ratchet` 367
and `lint:ratchet` 3095/970 (no regressions); `validate:arch` 0 errors, 17 warnings;
`generate:contracts` + `validate:contracts` green; `verify-unknown-interrupt.mjs` 10/10 against a
fresh build (was 8/8 — two new A.5 checks).

**The blocker moved a second time, and the layer the row named was not the last one.** A.5 named
`projectNodes`, `RemainderNodeSpec` and the store write. Those three are necessary and were not
sufficient: a remainder node has NO entry in `parsedCommand.steps`, so its step is built by
`operators/node-step-projection.synthesizeStep` from the node alone. A field carried to the row
and not read back there is still a field the run never sees. That is the same shape DEV-TA3-3
recorded one layer up (P-A-F5): each time, the refusal's stated blocker was the deepest layer
anyone had looked at, not the deepest layer there is. The receipt that separates them is the
projection unit test, which asserts the rendered step — not the row.

**`::` is refused, not carried, and the two spellings still agree.** The dispatch made lifting
conditional on the field surviving end-to-end. `delegated` does. A raw `::` token does not, and
the reason is the same TIMING argument OQ-A2b settled, one call later in the run's life:
`InlineGateProcessor` is what gives a token meaning, and it runs at stage 05/11 of a FRESH parse —
an appended node joins a run that is resuming, where `05-inline-gate-stage` skips on
`isBlueprintRestored`. Carrying it would record a token that fires nothing, which is precisely the
"accepts an operator that changes nothing" OQ-A1 forbids. So it is refused on the STRUCTURED
spelling too, by name, and the string form's refusal message now states the timing reason instead
of pointing at a plan row.

Three corrections rather than asides:

- **The defect was nine fields wide, not two.** `projectNodes` narrowed every submitted node to
  `{id, promptId, stepName}`, so `args`, `subagentModel`, `agentType`, `framework`, `retries`,
  `inputMapping`, `outputMapping`, `visibility`, `inlineGateIds` and `inlineGateCriteria` were all
  accepted and dropped — the two the append parser named were simply the two someone had looked
  at. Fixing only those would have left the class standing (`dev-workflow.md`: a fix at the sites
  you found is not a fix of the class). Every field is now carried or refused, and
  `tests/unit/execution/capture/remainder-node-fields.test.ts` compares the two lists against
  `WORKFLOW_NODE_FIELDS`, so a field added to the IR node fails until someone decides. DEV-T5-1.
- **`args` were already validated and then dropped, which made the append parser's own docblock
  false.** It said the parsed `key="value"` pairs exist only to satisfy
  `validateWorkflowIR`'s required-argument check — true, and the reason it was true is that they
  never reached the step. An appended prompt with required arguments therefore rendered with none
  of them. Carried now, through the same path as `delegated`.
- **A remainder node was inheriting the investigation's rebuilt arguments.** `synthesizeStep`
  keyed the `unknown_id`/`statement` rebuild on `originUnknownId`, which BOTH inserted and
  remainder nodes carry — so a caller-authored step was rendered with two arguments its prompt
  never declared. The rebuild is now keyed on provenance. Found by writing the projection test,
  not by the suite. DEV-T5-3.

## Tiers

| Row | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Where                                                                                                                                                                                                                                                                                                                                                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Verify                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ✓ (verified 2026-08-30 · `generate:contracts` + `validate:contracts` green with `remainder`, the five-member `gate_action`, `budget.pauseOnBlocking` and the rewritten `observations` notes)                                                                                                                                                                                                                                                                                                                                                                                  | `tooling/contracts/prompt-engine.json`, `workflow-ir.json`                                                                                                                                                                                                                                                                                                            | `remainder` param (notes: chain_id-only, open-blocking-unknown-only, replaces strictly-after-current); `gate_action` enum += `resume`, `accept_alternative`; flag key `resolvesPendingGate → resolvesPendingRun`; `budget.pauseOnBlocking` (boolean, default false); `observations` notes describe the interrupt                                                                                                                                                                                                                    | `npm run generate:contracts && npm run validate:contracts`                                                                                                                                                                                                                                                |
| 0.2 | ✓ (verified 2026-08-30 · the old names survive in NO tracked file outside `plans/`; `validate:python` 254/254)                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `scripts/generate-contracts.ts`, `hooks/lib/_generated/resolution_verbs.py`, `hooks/gate-enforce.py`                                                                                                                                                                                                                                                                  | Generator reads the renamed flag; artifact constant renamed `PENDING_RUN_RESOLUTION_PARAMS`; hook imports the new name. One commit — the old name must not survive anywhere (`rg resolvesPendingGate\|PENDING_GATE_RESOLUTION` returns nothing)                                                                                                                                                                                                                                                                                     | `npm run validate:python`; `hooks/tests/test_gate_enforce_verdict.py` green                                                                                                                                                                                                                               |
| 0.3 | ✓ (verified 2026-08-30 · `typecheck` green; `remainder` reuses `workflowNodeSchema`/`workflowEdgeSchema` and is `.strict()` at every level; `pauseOnBlocking` on `workflowBudgetSchema`; `gate_action` has five members)                                                                                                                                                                                                                                                                                                                                                      | `mcp/tools/schemas/prompt-engine.schema.ts`, `modules/workflow-ir/node-schema.ts` + `types.ts` (see DEV-T0-2)                                                                                                                                                                                                                                                         | Zod: `remainder` (reuses IR node + edge schemas, `.strict()`), `gate_action` enum, `pauseOnBlocking`                                                                                                                                                                                                                                                                                                                                                                                                                                | `npm run typecheck`                                                                                                                                                                                                                                                                                       |
| 0.4 | ✓ (verified 2026-08-30 · live drive against a built `dist/` over Streamable HTTP: a `remainder` naming an unregistered prompt came back `❌ remainder refused … unknown-prompt`, which only stage 16 can produce — a dropped argument would have been an ordinary silent resume. The permanent script is row 4.5; this drive is its receipt, not its replacement. **Re-measured**: the allowlist entry alone was NOT enough — `PromptExecutor` builds its pipeline request separately from its argument bag, so `McpToolRequest.remainder` was a fifth hop, added at row 2.3) | `mcp/tools/index.ts` ~838-853                                                                                                                                                                                                                                                                                                                                         | `remainder` added to the explicit argument allowlist. Record it as the fifth instance in the comment. **Re-measured 2026-08-30: four recorded instances precede it, so "fifth" is correct** (`version_description`, `dry_run` ×2 = the "three times" comment, then `handoff`/`claim_token` = fourth)                                                                                                                                                                                                                                | Live drive (row 4.5) shows `remainder` reaching stage 16 — a green suite cannot prove this                                                                                                                                                                                                                |
| 0.5 | ✓ (verified 2026-08-30 · `validate:conformance-coverage` green with NO `remainder` entry — 57 accepted exceptions, all load-bearing; the new corpus rows are red against a broken assertion, so they observe the effect rather than the call. **The gate found a second satisfied entry**: `observations` too — both deleted, DEV-T3-3)                                                                                                                                                                                                                                       | `server/scripts/validate-conformance-coverage.js`, the conformance corpus                                                                                                                                                                                                                                                                                             | Retire the coverage exception Tier 0 had to add. A scenario declares a blocking unknown on a chain fixture, reads the interrupt, and resumes the SAME run with an authored `remainder`, asserting the replaced node list. **The exception is an unmarked ☐ living in a gate's allowlist** — the gate's own satisfied-exception audit fails it once the parameter is covered, which is the detection this row supplies                                                                                                               | `validate:conformance-coverage` green with NO `remainder` entry in the exception list                                                                                                                                                                                                                     |
| 1.1 | ✓ (verified 2026-08-30 · `interrupt-policy.test.ts` 9/9, two mutation probes red then restored green)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `pipeline/decisions/mutation/types.ts`, new `interrupt-policy.ts`                                                                                                                                                                                                                                                                                                     | Pure `decideInterrupt({ledger, nodes, currentNodeId, pauseOnBlocking})` → `ChainInterrupt \| undefined` with `affectedStepIds` from declared links (OQ-2) and `paused`. `UNKNOWN_INTERRUPT_GATE_ID = '__unknown_interrupt__'` beside the phase-guard constant                                                                                                                                                                                                                                                                       | Unit tests: declared-only derivation; undeclared textual reference NOT flagged; no interrupt for non-blocking; `paused` mirrors the knob                                                                                                                                                                  |
| 1.2 | ✓ (verified 2026-08-30 · `chain-run-storage.integration.test.ts` 23/23 incl. 10 new remainder cases; two mutation probes red then restored)                                                                                                                                                                                                                                                                                                                                                                                                                                   | `modules/chains/manager.ts`, `chain-session.ts`, `chain-execution.ts`, `run-registry.ts`                                                                                                                                                                                                                                                                              | `ChainSessionStore.replaceRemainder(sessionId, nodes, unknownId, mode)`: atomic, awaited, throws on persist failure; `'replace'` swaps every node strictly after current, `'append'` extends the remainder (OQ-A1's shared path); `origin='remainder'`, `origin_unknown_id` set; per-unknown-id and per-run caps enforced here with named rejection reasons. **Authored signature omitted `mode`** — added, since OQ-A1 makes this the one path both spellings take                                                                 | `chain-run-storage.integration.test.ts`: replace, cap-reached, current-node-untouched, persistence round-trip                                                                                                                                                                                             |
| 1.3 | ✓ (verified 2026-08-30 · one assertion per hop — `compiler.test.ts`, `chain-edges-budget.test.ts`, `parsing-stage-commandtype.test.ts`, `step-response-capture-stage.test.ts` — and both strippers mutation-probed)                                                                                                                                                                                                                                                                                                                                                           | `16-response-capture-stage.ts` ~459, `chain-session.ts` (`DeclaredRunBudget`), `workflow-ir/compiler.ts` (`compileBudget`), `modules/prompts/yaml-prompt-loader.ts`                                                                                                                                                                                                   | Blueprint readback of `pauseOnBlocking` next to `maxInsertions`. **Re-scoped by Tier 0**: the field is DECLARATION-ONLY at HEAD (`workflowBudgetSchema` + `WorkflowBudget` carry it, nothing else does). It reaches a step only if `DeclaredRunBudget`, `compileBudget` — which deliberately DROPS every budget field with no post-validation reader — and the YAML loader's budget projection each carry it too: four hops, four independent strippers (DEV-T0-3)                                                                  | Unit: absent → false; declared true → true. Plus one assertion per hop, or the readback reads a field nothing ever wrote                                                                                                                                                                                  |
| 1.4 | ✓ (verified 2026-08-30 · calls `persistSessionsOrThrow`; an integration case proves a persist failure reaches the caller as a thrown error rather than a reported success, and the mutation probe restoring `saveSessions` turns it red)                                                                                                                                                                                                                                                                                                                                      | `modules/chains/manager.ts`                                                                                                                                                                                                                                                                                                                                           | Discovered by row 1.2. `ChainSessionStore.applyUnknownObservations`' docblock and the `ChainSessionService` interface both state it "awaits persistence, and throws on persist failure" — it calls `saveSessions()`, which log-and-swallows. The claim has been false since the method landed. Row 1.2 added `persistSessionsOrThrow` (the same write without the swallow), so the fix is a one-line call-site change; the ruling it needs is whether an observation batch SHOULD fail the call, which is Tier 2's posture question | An integration case where the persist fails and the caller observes it — or a docblock that no longer promises it                                                                                                                                                                                         |
| 2.1 | ✓ (verified 2026-08-30 · `unknown-interrupt-flow.integration.test.ts` — soft interrupt on `context`, knob on → synthetic review pending in BOTH the store and `sessionContext`; pause-gate mutation probe red then restored)                                                                                                                                                                                                                                                                                                                                                  | `16-response-capture-stage.ts`                                                                                                                                                                                                                                                                                                                                        | After `applyMutation`: call `decideInterrupt`; put the interrupt on `context` (never mutate arrays directly); when `paused`, `setPendingGateReview` with the synthetic id                                                                                                                                                                                                                                                                                                                                                           | Integration: blocking discovery → investigation step response carries `chain_interrupt`; knob on → no step instructions, synthetic review pending                                                                                                                                                         |
| 2.2 | ✓ (verified 2026-08-30 · resume, accept_alternative+remainder, and three named refusals — no remainder, ordinary gate review, nothing pending — all green)                                                                                                                                                                                                                                                                                                                                                                                                                    | `13-session-stage.ts`, `GateVerdictProcessor`                                                                                                                                                                                                                                                                                                                         | `gate_action:resume` clears the synthetic review and issues the investigation step; `accept_alternative` requires `remainder` in the same call; `abort`/`cancel` behave as today. Refusals name their reason (no remainder, no open unknown, cap)                                                                                                                                                                                                                                                                                   | Integration: paused → resume → investigation step; paused → accept_alternative+remainder → new remainder; accept_alternative without remainder → named refusal                                                                                                                                            |
| 2.3 | ✓ (verified 2026-08-30 · both cases green, plus unknown-prompt, missing-required-argument and linearized-order cases; row 0.4's live drive proves the parameter reaches the stage on the wire)                                                                                                                                                                                                                                                                                                                                                                                | `PromptExecutor` / stage that reads `mcpRequest`                                                                                                                                                                                                                                                                                                                      | `remainder` path on an unpaused run with an open blocking unknown: validate → `replaceRemainder` → continue. Rejected when no blocking unknown is open                                                                                                                                                                                                                                                                                                                                                                              | Integration: soft-interrupt run submits `remainder` → replaced; same call with no open unknown → refused                                                                                                                                                                                                  |
| 2.4 | ✓ (verified 2026-08-30 · inline snapshots of both variants; `structuredContent.chain_interrupt` asserted as parsed JSON against the §Interrupt payload block, with a no-interrupt positive control)                                                                                                                                                                                                                                                                                                                                                                           | `execution/formatting/response-assembler.ts`                                                                                                                                                                                                                                                                                                                          | Interrupt text section + `structuredContent.chain_interrupt`; paused variant lists the resolution verbs verbatim from the contract                                                                                                                                                                                                                                                                                                                                                                                                  | Snapshot of both variants; `structuredContent` asserted as JSON, not by substring                                                                                                                                                                                                                         |
| 2.5 | ✓ (verified 2026-08-30 · SCHEMA_VERSION 25 → 26; `validate:table-contracts` and `validate:no-phantom-columns` green; an interrupted run stamps both counters NON-zero on its terminal record — the positive control that they are not hardcoded)                                                                                                                                                                                                                                                                                                                              | `execution_records`, `table-contracts.ts`, `sqlite-engine.ts`                                                                                                                                                                                                                                                                                                         | Terminal counters `interrupts_raised`, `remainders_accepted` (D-8); schema bump; declared in table contracts                                                                                                                                                                                                                                                                                                                                                                                                                        | `validate:table-contracts`, `validate:no-phantom-columns`                                                                                                                                                                                                                                                 |
| 2.6 | ✓ (verified 2026-08-30 · paused snapshot and `structuredContent.resume.verbs` both list the four resolution verbs ONLY, asserted with an explicit `not.toContain('answer the step')`; 21/21 in `unknown-interrupt-flow.integration.test.ts`)                                                                                                                                                                                                                                                                                                                                  | `response-assembler.ts` §`INTERRUPT_VERBS`, plan §Interrupt payload                                                                                                                                                                                                                                                                                                   | Discovered by row 2.4. The verb list renders verbatim from the payload block, which puts `answer the step` in BOTH variants — but a PAUSED run issues no step (stage 18 skips on a pending review) and its own footer no longer offers one. Either the paused list drops it, or the block is amended to say why it stays. A RULING, which is why Tier 2 shipped the block as written rather than narrowing it                                                                                                                       | The paused snapshot and `structuredContent.resume.verbs` list only exits the paused run accepts                                                                                                                                                                                                           |
| 3.1 | ✓ (verified 2026-08-30 · `test_unknown_interrupt_hold.py` 15/15, `validate:python` 269/269 (was 254); the allow half was proven by a mutation probe that drops `gate_action` from the generated set and turns `resume` red, and the DENY half did not exist at all until this row — DEV-T3-2)                                                                                                                                                                                                                                                                                 | `hooks/tests/`, `hooks/lib/session_state.py`, `hooks/lib/db_reader.py`, `hooks/gate-enforce.py`, `hooks/README.md`, `scripts/generate-contracts.ts`                                                                                                                                                                                                                   | Matrix: pending `__unknown_interrupt__` × {resume, accept_alternative, abort, cancel} allowed; bare `chain_id` denied; label rendering for the synthetic id. **Authored claim corrected**: `session_state.py` names gates from the RESPONSE TEXT; `db_reader.py` is the module that joins `pendingGateReview.gateIds`, at two sites. Both now call one `label_gate_ids`                                                                                                                                                             | `validate:python`; deny message names the verbs                                                                                                                                                                                                                                                           |
| 4.1 | ✓ (verified 2026-08-31 · `unknown-interrupt-branches.integration.test.ts` 4/4 — three branches driven to a TERMINAL record plus a zero-control run; the counter mutation probe (`interruptsRaised` pinned to 0) turns three of the four red)                                                                                                                                                                                                                                                                                                                                  | `tests/integration/chain/unknown-interrupt-branches.integration.test.ts` — integration, not e2e: the assertion is on `execution_records` rows, which an HTTP drive cannot read without opening the server's SQLite from outside, and every conformance-style e2e run pollutes the repo tree (row 6.1). The on-the-wire half is `scripts/verify-unknown-interrupt.mjs` | E2E both branches (OQ-1's old close condition): blocking → soft interrupt → answer step; blocking with knob → paused → resume; blocking with knob → paused → accept_alternative+remainder                                                                                                                                                                                                                                                                                                                                           | Three green runs; `execution_records` counters match — asserted PER BRANCH with different expected pairs (1/0, 1/0, 1/1) plus a 0/0 control, because one `> 0` would pass against a writer stamping a constant                                                                                            |
| 4.2 | ✓ (verified 2026-08-31 · `verify-handoff.mjs` 11/11 across two live servers: B claims a run holding `__unknown_interrupt__` and receives the PAUSED interrupt — four paused verbs, no "answer the step" — then clears the hold itself. CI-owned half: a registry case in `handoff-claim.test.ts`, mutation-probed by dropping `pendingGateReview` from the residual document)                                                                                                                                                                                                 | `server/scripts/verify-handoff.mjs`, `tests/unit/chain-session/handoff-claim.test.ts`                                                                                                                                                                                                                                                                                 | D-9: mint handoff on a paused run; claim from a second server returns the interrupt, not a step                                                                                                                                                                                                                                                                                                                                                                                                                                     | Extended `verify-handoff.mjs`. The handoff plan's row 2.2 (two-server jest scenario) has NOT landed — re-measured 2026-08-31, still ☐ — and D-9 is a claim ACROSS PROCESSES, which a single-process test answers a different question about. The registry case is what CI runs; the drive is the evidence |
| 4.5 | ✓ (verified 2026-08-30 · `b0955c6c` · 8/8 green against a fresh build; exit 1 with `dist/ is stale` after `touch src/index.ts` — both polarities probed)                                                                                                                                                                                                                                                                                                                                                                                                                      | `server/scripts/verify-unknown-interrupt.mjs`                                                                                                                                                                                                                                                                                                                         | Live drive against `dist/` (pattern: `verify-handoff.mjs`): declare blocking, read `structuredContent`, submit `remainder`. This is the probe that catches the allowlist trap                                                                                                                                                                                                                                                                                                                                                       | Script exits 0 against a built server; refuses on stale `dist/`                                                                                                                                                                                                                                           |
| 5.1 | ✓ (verified 2026-08-31 · `validate:format` green, `validate:all` 50/50; `mcp-tools.md` §Blocking-unknown interrupt carries the verbatim payload, the state-dependent verb table, `remainder` and its named refusals; `chains-lifecycle.md` carries the concept plus the declared-links-only rule and the killed non-blocking scope; `hooks/README.md` was already current from Tier 3 and needed no edit — re-read, not assumed)                                                                                                                                              | `docs/concepts/chains-lifecycle.md`, `docs/reference/mcp-tools.md`, `docs/reference/workflow-ir.md`, `docs/reference/chain-schema.md`, `CHANGELOG.md`                                                                                                                                                                                                                 | Interrupt section, `remainder`, `pauseOnBlocking`, verb table; `chains-lifecycle` documents derivation-only-for-`affected_step_ids` and the killed OQ-5. Note the global skills (`unknowns`, `mcp-prompt-router`) are now true rather than aspirational                                                                                                                                                                                                                                                                             | Docs/code lockstep review; `validate:format`                                                                                                                                                                                                                                                              |
| 6.1 | ✗ KILLED HERE (2026-08-31 · not a chain defect — an isolated conformance run writes prompts into the bundled tree, which is the write-containment class owned by the ACTIVE `plans/technical-debt/resource-surface-consolidation-2026-08-27.md` (P1.7/P1.8, `233b2bf2`/`b6e66d6f`); handed to that plan · revives if that plan retires with `test:e2e` still leaving `conformance_*` dirs under `server/resources/prompts/`)                                                                                                                                                  | `tests/e2e/conformance/workspace-and-mutations.yaml`, `claims-conformance.test.ts` workspace setup                                                                                                                                                                                                                                                                    | Discovered by row 0.5. A conformance run declaring `workspace: isolated` still writes SEVEN `conformance_*` prompt directories into the repo tree, after which `validate:readme` fails claim-coverage (39 claimed vs 46 shipped) until they are deleted by hand. Reproduced with this initiative's own corpus file moved OUT (105 scenarios, same 7 directories), so it is not this plan's doing — but it is a gate no local run can pass twice                                                                                     | `git status --porcelain server/resources/prompts` empty after `npm run test:e2e`                                                                                                                                                                                                                          |
| F-1 | ✗ KILLED (2026-08-31 · model-authored `remainder` is the shipped consolidation path and no run has asked for a server proposal; a static server can only reorder IR runs with edges, never merge · revives if a real run shows the server held enough structure to propose a remainder the model did not)                                                                                                                                                                                                                                                                     | `interrupt-policy.ts`                                                                                                                                                                                                                                                                                                                                                 | Follow-on: server-derived reorder `alternative` (advance nodes with no edge to the affected set) — IR runs with `edges` only; template chains have no dependency data                                                                                                                                                                                                                                                                                                                                                               | An accepted server-proposed remainder in a real run                                                                                                                                                                                                                                                       |

### Tier 0 execution record (2026-08-30)

**0.1, 0.2, 0.3 shipped; 0.4 landed but stayed ☐ until the Tier 2 live drive flipped it ✓ (see row 0.4).** Receipts: `generate:contracts` +
`validate:contracts` green; `validate:python` 254/254; `typecheck` clean; 218 unit suites /
2765 tests; `validate:all` 50/50.

The contract now carries `remainder` (`{mode:'replace'|'append', nodes[], edges?}`), a five-member
`gate_action`, `budget.pauseOnBlocking`, and `observations` notes that describe the interrupt
payload rather than only the insert/skip policy. `resolvesPendingGate → resolvesPendingRun` landed
in ONE commit across the contract, `contracts/schemas/types.ts`, the generator, the generated
Python constant (`PENDING_RUN_RESOLUTION_PARAMS`), `gate-enforce.py` and `hooks/README.md`.

Three things the tier's rows did not anticipate, all of them corrections rather than asides:

- **The old-name check as written can never pass.** Row 0.2's flip condition is
  `rg resolvesPendingGate|PENDING_GATE_RESOLUTION` returning nothing across the worktree — but
  this plan's own row 0.2 and ruling OQ-4 contain the literal, as does the retired
  `plans/gate-enforce-resolution-verbs-2026-08-20.md` that introduced the flag. The check actually
  run, and the one that should be re-run, excludes `plans/` the way `cleanup-standards.md` exempts
  a CHANGELOG: `rg 'resolvesPendingGate|PENDING_GATE_RESOLUTION' --hidden -g '!node_modules' -g '!plans/**'`
  → no hits. See DEV-T0-1.
- **`remainder` needed a coverage exception, not just a schema.** `validate:conformance-coverage`
  fails any contract parameter with neither a scenario nor a declared exception, and a scenario is
  unwritable today — the parameter has no consumer, so a scenario would assert the absence of an
  effect. An exception with a real close condition (rows 2.1–2.3) was added instead; row 0.5 owns
  retiring it. DEV-T0-4.
- **`pauseOnBlocking` is declaration-dead at four hops, not one.** Row 1.3 read as a single
  readback; the field has to be carried by `DeclaredRunBudget`, `compileBudget` and the YAML
  loader's budget projection before stage 16 has anything to read. Row 1.3 is re-scoped in place.
  DEV-T0-3.

**`plan-row-tracking` was already red at HEAD, before this tier touched anything.** Row A.2's
stamp read `(as of 2026-08-30 · OQ-A2 ruled, see below · flips when …)`, and `OPEN_STAMP` requires
`as of <date> · flips when` ADJACENT — the intervening clause broke it. Attributed to commit
`3fa6ba11` (Tier A's OQ-A2 ruling), not to Tier 0, and fixed here anyway because a gate nobody can
pass blocks every later tier.

### Tier 1 execution record (2026-08-30)

**1.1, 1.2 and 1.3 shipped.** Receipts: `validate:all` 50/50; 219 unit suites / 2778 tests; 58
integration suites / 755 tests; `typecheck` clean; `typecheck:tests:ratchet` 367 (no regression);
`lint:ratchet` 3092/970 (no regression); `validate:arch` 0 errors.

Every claim below was probe-run rather than reasoned. Four mutation probes were used as positive
controls — the declared-only derivation, the strictly-ahead filter, the `origin === 'remainder'`
cap source, and the two `pauseOnBlocking` strippers — each turned the relevant tests red and was
then restored. A test that cannot fail is not evidence, and three of these guards are one
character wide.

**No schema bump was needed, and that was measured rather than assumed.** `origin` is
`TEXT NOT NULL` with no CHECK and no DDL default (`sqlite-engine.ts:737-766`), so `'remainder'` is
a new string in an existing column. The one reader that had to learn it is
`run-registry.reconstructNodeOrigin`, which narrows rather than trusts — a cold-load test asserts
the value survives, because a member added to the TS union and not to that function round-trips to
`'planned'` and both caps then recompute against a provenance the writer never lost.

Three corrections rather than asides:

- **Row 1.2's authored signature had no `mode`.** It read
  `replaceRemainder(sessionId, nodes, unknownId)`, which cannot express OQ-A1 — ruled after the
  row was written — where the leading-`-->` string and `remainder:{mode:'append'}` must take ONE
  store path. `mode` is a parameter, not a second method, precisely so validation, caps and
  recorded provenance cannot diverge between the two spellings.
- **"Throws on failure" was not available to be used.** `persistSessions` log-and-swallows, so
  every existing caller that documents a throwing persist is documenting something that does not
  happen. Split into `persistSessionsOrThrow` (the same write, failure left to the caller) with
  `persistSessions` wrapping it — zero behaviour change for the existing callers, and row 1.2 is
  the first caller that can honestly report success. The pre-existing false claim is now row 1.4.
- **Row 1.3's stage-16 readback has no PRODUCTION consumer until row 2.1.** It is exercised by a
  unit test and by four per-hop assertions, which is what the row asked for, but the honest status
  is that `resolveDeclaredPauseOnBlocking` is reachable and correct rather than reached. Row 2.1's
  `decideInterrupt` call is its consumer; it is exported for the test rather than private for
  exactly that reason.

### Tier 2 execution record (2026-08-30)

**2.1-2.5 shipped, and 1.4 with them.** Receipts: `validate:all` — 50 steps, 50 passing; 219 unit
suites / 2781 tests; 59 integration suites / 777 tests; `typecheck` clean;
`typecheck:tests:ratchet` 367 (no regression); `lint:ratchet` 3096/970 (no regression);
`validate:arch` 0 errors; `validate:table-contracts` and `validate:no-phantom-columns` green at
SCHEMA_VERSION 26; `validate:knip-ratchet` green with a TIGHTENED baseline (exports 493 → 492).

**The live drive is the receipt that mattered.** Run ad-hoc against a built `dist/` over
Streamable HTTP, it settled row 0.4 — the argument allowlist's fifth instance — by showing a
`remainder` naming an unregistered prompt coming back as the named IR refusal, an answer only
stage 16 can produce. It also failed a check nobody had written: `>>strategicImplement` is a gated
SINGLE PROMPT that gets a session, so it raises an interrupt and formats through
`formatSinglePromptResponse`, which rendered no interrupt section while `structuredContent`
correctly carried one. The machine half of one payload reported a blocking unknown and the human
half did not. Fixed on both paths, gated by a test. Four assertions covering the chain path were
green throughout.

Corrections rather than asides:

- **`remainder` was dead one hop BELOW the allowlist.** Tier 0 recorded the allowlist entry as the
  fifth instance of that failure shape and typed `PromptExecutor`'s argument bag to match. But the
  executor builds its pipeline request separately, and `McpToolRequest` had no `remainder` field —
  so the value crossed the allowlist and stopped again, one layer lower, invisible to `tsc` at
  every level. The lesson generalizes past the allowlist: the guard was placed at the hop that
  failed last time, and the parameter died at the next one.
- **`gate_action` had five members on the contract and three everywhere inside.** `GateAction`,
  `McpToolRequest.gate_action`, `PromptExecutor`'s arg type and `gateActionSchema` all still
  carried the retry-exhaustion trio. `GateAction` was deliberately NOT widened — `resume` names a
  hold no gate produced, and widening it would have obliged `resolveAction`'s three
  gate-failure branches to answer a question with no answer. The union lives on the request; the
  narrowing lives at one stage. See DEV-T2-3.
- **The hard pause could not follow the interrupt's shape, and the plan does not say so.**
  `decideInterrupt` is a function of what is OPEN, so it re-raises every step; raising the
  synthetic review on that same condition re-holds the run on the call after `resume`, forever.
  The pause is bound to "an insertion landed on this call, or the review is already pending" —
  which is OQ-1's own "the inserted investigation node IS the pause point", read as a rule about
  WHEN rather than only about WHERE. DEV-T2-2, mutation-probed.
- **A test that had passed for four months proved nothing.** The pre-existing
  "applyUnknownObservations propagates a persist failure" case mocked `saveSessions` to reject —
  a method production cannot make reject. Every persistence spy in the repo (5 files) sat on that
  swallowing wrapper; all now sit on `persistSessionsOrThrow`. Restoring the swallow now turns two
  tests red and previously turned nothing red. DEV-T2-7, promoted as P-2-F1.

**One row was shipped as written despite disagreeing with the run's behaviour**, and is now
row 2.6: the §Interrupt payload verb list offers `answer the step` on the PAUSED variant, where
stage 18 issues no step. Narrowing a normative block is a ruling, not an implementation choice.

### Tier 3 execution record (2026-08-30)

**3.1, 2.6 and 0.5 shipped.** Receipts: `validate:all` — 50 steps, 50 passing; `validate:python`
269/269 (was 254 — 15 new, `test_unknown_interrupt_hold.py`); 219 unit suites / 2781 tests; 59
integration suites / 777 tests; 107 conformance scenarios (was 105); `typecheck` clean;
`typecheck:tests:ratchet` 367 (no regression); `lint:ratchet` 3096/970 (no regression);
`validate:conformance-coverage` green with 57 accepted exceptions and no `remainder` entry.

**The row that read as prose was the row with no implementation behind it.** Row 3.1's deny half
("bare `chain_id` denied with a message naming the verbs") could not have been satisfied by a
message change: nothing was denying. Tier 2 correctly made `buildGateReviewCTA` return `null` for
the synthetic review — no `gate_verdict` clears it — which also removed the `**Review Required**`
header that `session_state.parse_prompt_engine_response` keys on. `pending_gate` stayed `None`,
and `gate-enforce.py` Check 2 read a HELD run as a free one. The allow half, which the row flagged
as the uncertain one, worked untouched. DEV-T3-2, and the general shape is promoted as P-3-F2: a
hook that models server state from RESPONSE TEXT is blind to any hold whose response the server
deliberately formats differently, and nothing fails when the marker stops being emitted.

Three corrections rather than asides:

- **Row 3.1 named one label producer and described the other one's mechanism.** `session_state.py`
  derives `pending_gate` from response text; `db_reader.py` joins `pendingGateReview.gateIds`, at
  two sites, and is what compact recovery and `prompt-suggest` read. A fix at the named site alone
  would have left `__unknown_interrupt__` rendering raw on every recovery path. One
  `label_gate_ids` now serves both. DEV-T3-1.
- **Row 0.5 retired TWO exceptions, and the gate found the second.** The corpus rows declare a
  blocking observation to open the ledger, which covered `prompt_engine.observations` as well —
  its exception went SATISFIED and `validate:conformance-coverage` failed on it the moment
  `remainder`'s was deleted. That is the satisfied-exception audit doing exactly what row 0.5's
  text predicted, on an entry nobody was looking at. DEV-T3-3.
- **The paused verb list drops `remainder` too, which the ruling did not have to spell out.** A
  bare `remainder` does not clear the synthetic review; the caller must spell it
  `gate_action:accept_alternative` and carry the remainder along. The paused list is therefore not
  a subset of the soft one in either direction — it is a different list for a different state.
  DEV-T3-4.

**The e2e corpus writes into the repo, and that is not this tier's defect.** Any conformance run
leaves seven untracked `conformance_*` prompt directories under `server/resources/prompts/`,
turning `validate:readme` red on claim-coverage. Attributed by probe — reproduced with this
tier's own corpus file moved out of the directory — and opened as row 6.1 rather than fixed
inside this tier. DEV-T3-5, P-3-F1.

## Constraints carried

- **Advisory posture unchanged**: the model declares; the server validates and applies. The
  server never authors step content (`remainder` is model-authored, schema-validated).
- **Transport parity**: nothing here mutates a registered `McpServer`; all state is on the run.
- **Adapter boundary (D-7)**: `chain_interrupt` is client-agnostic JSON. Client-side hooks may
  translate it, prompt the user, or auto-answer from local knowledge before replying with a verb —
  nothing in `server/resources/prompts/` or the contract names any client's guidance system.
- **Breaking?** No. `remainder`, `pauseOnBlocking`, and two enum members are additive union
  members (CLAUDE.md §Public API Contract). The flag rename is internal to the generator.

## Follow-ons (own plans)

- `plans/features/external-observation-source-2026-08-30.md` — a watcher/second source enqueuing
  observations onto a run (stage 16 drains a queue, not only `mcpRequest`). "Server detects
  something sensitive" is a **gate**, already supported, and is documented as such there.
- `plans/features/unknowns-corpus-prompt-evolution-2026-08-30.md` — durable ledger sink keyed
  by prompt/step, sighting aggregation, proposal path through `resource_manager`. Mechanizes the
  hand-kept prompt-evolution backlog and the 3-sightings maturity rule.

## Execution Dispatch (ruled 2026-08-30)

Implementation is delegated to **opus subagents**, each handed `>>strategicImplement` for one
tier (A first, then 0 → 5); one tier per submission, rows compiled to nodes with their own gates.
The main thread keeps judgment only: tier re-measurement before dispatch, gate verdicts, plan
writeback, and the commit boundary. Contract rows (A.1, 0.1–0.4) are still delegated, with the
main thread reviewing the generated diff before commit. One subagent owns HEAD at a time — no
`checkout`/`switch`/`stash` inside a subagent; the working tree currently carries another
session's uncommitted `contained-path` work, so each commit stages its own files by name.
