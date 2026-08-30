---
title: Mid-chain unknown surfacing and adaptive consolidation
date: 2026-08-20
status: active
tags:
  - chains
  - unknowns-ledger
  - adaptive-mutation
  - interrupts
---

# Mid-chain Unknown Surfacing and Adaptive Consolidation

Promoted `backlog → active` 2026-08-30 after an interview ruled every open question (§Rulings).
Two ideas raised in that interview were split into their own backlog plans rather than rows here:
`plans/features/unknowns-corpus-prompt-evolution-2026-08-30.md` and
`plans/features/external-observation-source-2026-08-30.md`.

## Current State (re-verified at HEAD, 2026-08-30)

The `prompt_engine` tool already accepts an `observations` parameter carrying typed unknown
entries, and a deterministic mutation policy already reacts to them:

| Concern                                                              | Where                                                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract source of truth (`observations` description, shapes, notes) | `server/tooling/contracts/prompt-engine.json`                                                                                                                 |
| Zod input schema (`observations`, `gate_action` ~line 325)           | `server/src/mcp/tools/schemas/prompt-engine.schema.ts`                                                                                                        |
| Generated contract schema                                            | `server/src/mcp/contracts/schemas/_generated/prompt_engine.generated.ts`                                                                                      |
| Explicit argument allowlist (params are dead on the wire until here) | `server/src/mcp/tools/index.ts` ~831-842 — four recorded instances of a typechecked-but-unreachable param                                                     |
| Entry types (`UnknownObservation`, `UnknownLedgerEntry`)             | `server/src/shared/types/chain-session.ts`                                                                                                                    |
| Ledger transition rules (pure, all-or-nothing batch, 200-entry cap)  | `server/src/engine/execution/capture/unknown-observation-processor.ts` (`computeUnknownLedger`)                                                               |
| Adaptive mutation decision (pure)                                    | `server/src/engine/execution/pipeline/decisions/mutation/mutation-policy.ts` (`decideMutation`), `types.ts`                                                   |
| Mutation application (Tier 3 orchestration)                          | `server/src/engine/execution/pipeline/stages/16-response-capture-stage.ts` (`applyMutation` ~291; observations read at ~258 — the ONLY source today)          |
| IR budget readback per step                                          | `16-response-capture-stage.ts` ~459-465 (`maxInsertions` off the blueprint) — precedent for any new knob                                                      |
| Storage mutations                                                    | `server/src/modules/chains/manager.ts` (`insertNodeAfter` ~1237, `markNodeSkipped` ~1327, `setPendingGateReview` ~1611)                                       |
| Pending kinds on a session                                           | `pendingGateReview`, `pendingShellVerification` (`chain-session.ts` ~191-193) — both projected into `chain_sessions` and read by `hooks/lib/session_state.py` |
| Reserved synthetic gate id precedent                                 | `PHASE_GUARD_GATE_ID = '__phase_guard__'` (`stages/19-phase-guard-verification-stage.ts:36`), `__gate_review__` synthetic step (`response-assembler.ts` ~337) |
| Hook resolution verbs (generated)                                    | `hooks/lib/_generated/resolution_verbs.py` from `resolvesPendingGate` flags; consumed by `hooks/gate-enforce.py` Check 2                                      |
| Inserted investigation prompt                                        | `server/resources/prompts/workflow/investigate_unknown/prompt.yaml`                                                                                           |
| Behavior docs                                                        | `docs/concepts/chains-lifecycle.md`, `docs/reference/mcp-tools.md`, `docs/reference/workflow-ir.md`                                                           |
| Integration tests                                                    | `server/tests/integration/chain/unknown-observations-flow.integration.test.ts`, `chain-run-storage.integration.test.ts`                                       |

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
    "verbs": ["answer the step", "remainder", "gate_action:abort", "cancel"], // + gate_action:resume|accept_alternative when paused
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

| Row | Status                                                                                                                                 | Where                                                                           | Change                                                                                                                                                                                                                                                                                                   | Verify                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A.1 | ✓ (verified 2026-08-30 · `validate:all` 50/50, 218 unit suites, 5/5 bundled chains load unchanged)                                     | `workflow-ir.schema.ts`, prompt loader, `chain-schema.md`                       | `chainSteps[]` validates against the IR node schema (one Zod source imported by the loader); YAML additionally accepts `edges:` and `budget:` at chain level. `delegation` stays a YAML-only exporter key stripped before validation                                                                     | A gate that fails when the two field lists diverge (`validate:chain-node-parity` or a type-level `satisfies`); 5 bundled chains load unchanged    |
| A.2 | ⚠ (as of 2026-08-30 · premise falsified · flips when a ruling says where `==>` and `::` criteria live)                                 | `04-parsing-stage.ts`, `symbolic-operator-parser.ts`, `workflow-ir/compiler.ts` | A `-->` command parses to an IR (`n1…nN`, linear edges, per-step args/gates/`==>` mapped onto node fields) and enters `compileWorkflowIR` — the string path stops building `chainSteps` on its own                                                                                                       | Byte-identical `chain_run_nodes` for `>>a --> >>b` before/after (snapshot); existing symbolic-chain tests green                                   |
| A.3 | ☐ (as of 2026-08-30 · flips when `remainder` reaches stage 16 and the append store method exists — BLOCKED on rows 0.1, 0.3, 0.4, 1.2) | `tooling/contracts/prompt-engine.json`, `mcp/tools/index.ts` allowlist          | **Append**: `chain_id` + `command` beginning with `-->` extends the running chain — validated as IR nodes, appended after the current remainder via the same store method `remainder` uses (mode `append` vs `replace`). Lifts the `command`×`chain_id` exclusivity for this one leading-`-->` form only | Integration: `chain_id` + `"--> >>x"` adds a node; `chain_id` + `">>x"` (no leading arrow) still rejected as before; live drive for the allowlist |
| A.4 | ☐ (as of 2026-08-30 · flips when the `-->` append syntax A.3 adds is documented — A.1's half already shipped)                          | `docs/reference/workflow-ir.md`, `chain-schema.md`, `mcp-tools.md`              | Document the three inputs → one IR; `budget` in YAML; append syntax                                                                                                                                                                                                                                      | Docs/code lockstep                                                                                                                                |

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

**A.2 is ⚠, not ☐: its premise is falsified.** "per-step args/gates/`==>` mapped onto node fields"
has no node field for two of the three. A symbolic step carries `inlineGateCriteria` (free-text
`::` criteria — `inlineGateIds` is ids, a different channel) and `delegated` (set from `==>`),
and the IR node schema expresses neither. Adding `delegated` would give one runtime flag two
producers, which `compiler.ts` documents as the thing it exists not to do, and — now that
`ChainStepSchema` is derived — would also put a runtime-only flag into YAML. Resolving this is a
ruling, so it stopped here: see the implementation notes, DEV-TA-5.

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

## Tiers

| Row | Status                                                                                                                                | Where                                                                                                               | Change                                                                                                                                                                                                                                                                                                           | Verify                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ☐ (as of 2026-08-30 · flips when `validate:contracts` is green with the new params)                                                   | `tooling/contracts/prompt-engine.json`, `workflow-ir.json`                                                          | `remainder` param (notes: chain_id-only, open-blocking-unknown-only, replaces strictly-after-current); `gate_action` enum += `resume`, `accept_alternative`; flag key `resolvesPendingGate → resolvesPendingRun`; `budget.pauseOnBlocking` (boolean, default false); `observations` notes describe the interrupt | `npm run generate:contracts && npm run validate:contracts`                                                                                                                                                                                      |
| 0.2 | ☐ (as of 2026-08-30 · flips when `rg resolvesPendingGate                                                                              | PENDING_GATE_RESOLUTION`returns nothing and`validate:python` is green)                                              | `scripts/generate-contracts.ts`, `hooks/lib/_generated/resolution_verbs.py`, `hooks/gate-enforce.py`                                                                                                                                                                                                             | Generator reads the renamed flag; artifact constant renamed `PENDING_RUN_RESOLUTION_PARAMS`; hook imports the new name. One commit — the old name must not survive anywhere (`rg resolvesPendingGate\|PENDING_GATE_RESOLUTION` returns nothing) | `npm run validate:python`; `hooks/tests/test_gate_enforce_verdict.py` green |
| 0.3 | ☐ (as of 2026-08-30 · flips when `npm run typecheck` passes with `remainder` in the Zod schema)                                       | `mcp/tools/schemas/prompt-engine.schema.ts`, `workflow-ir.schema.ts`                                                | Zod: `remainder` (reuses IR node + edge schemas, `.strict()`), `gate_action` enum, `pauseOnBlocking`                                                                                                                                                                                                             | `npm run typecheck`                                                                                                                                                                                                                             |
| 0.4 | ☐ (as of 2026-08-30 · flips when the row-4.5 live drive shows `remainder` reaching stage 16 — **fifth-instance guard**)               | `mcp/tools/index.ts` ~831-842                                                                                       | `remainder` added to the explicit argument allowlist. Record it as the fifth instance in the comment                                                                                                                                                                                                             | Live drive (row 4.5) shows `remainder` reaching stage 16 — a green suite cannot prove this                                                                                                                                                      |
| 1.1 | ☐ (as of 2026-08-30 · flips when `decideInterrupt`'s unit tests are green)                                                            | `pipeline/decisions/mutation/types.ts`, new `interrupt-policy.ts`                                                   | Pure `decideInterrupt({ledger, nodes, currentNodeId, pauseOnBlocking})` → `ChainInterrupt \| undefined` with `affectedStepIds` from declared links (OQ-2) and `paused`. `UNKNOWN_INTERRUPT_GATE_ID = '__unknown_interrupt__'` beside the phase-guard constant                                                    | Unit tests: declared-only derivation; undeclared textual reference NOT flagged; no interrupt for non-blocking; `paused` mirrors the knob                                                                                                        |
| 1.2 | ☐ (as of 2026-08-30 · flips when `chain-run-storage.integration.test.ts` covers replace, cap-reached and round-trip)                  | `modules/chains/manager.ts`, `chain-session.ts`                                                                     | `ChainSessionStore.replaceRemainder(sessionId, nodes, unknownId)`: atomic, awaited, throws on failure; nodes strictly after current replaced; `origin='remainder'`, `origin_unknown_id` set; per-unknown-id and per-run caps enforced here with named rejection reasons                                          | `chain-run-storage.integration.test.ts`: replace, cap-reached, current-node-untouched, persistence round-trip                                                                                                                                   |
| 1.3 | ☐ (as of 2026-08-30 · flips when the blueprint-readback unit test is green)                                                           | `16-response-capture-stage.ts` ~459                                                                                 | Blueprint readback of `pauseOnBlocking` next to `maxInsertions`                                                                                                                                                                                                                                                  | Unit: absent → false; declared true → true                                                                                                                                                                                                      |
| 2.1 | ☐ (as of 2026-08-30 · flips when a blocking discovery yields `chain_interrupt` in an integration run)                                 | `16-response-capture-stage.ts`                                                                                      | After `applyMutation`: call `decideInterrupt`; put the interrupt on `context` (never mutate arrays directly); when `paused`, `setPendingGateReview` with the synthetic id                                                                                                                                        | Integration: blocking discovery → investigation step response carries `chain_interrupt`; knob on → no step instructions, synthetic review pending                                                                                               |
| 2.2 | ☐ (as of 2026-08-30 · flips when the paused resume/accept_alternative/refusal integration cases are green)                            | `13-session-stage.ts`, `GateVerdictProcessor`                                                                       | `gate_action:resume` clears the synthetic review and issues the investigation step; `accept_alternative` requires `remainder` in the same call; `abort`/`cancel` behave as today. Refusals name their reason (no remainder, no open unknown, cap)                                                                | Integration: paused → resume → investigation step; paused → accept_alternative+remainder → new remainder; accept_alternative without remainder → named refusal                                                                                  |
| 2.3 | ☐ (as of 2026-08-30 · flips when a soft-interrupt run accepts a `remainder` and a run with no open unknown refuses one)               | `PromptExecutor` / stage that reads `mcpRequest`                                                                    | `remainder` path on an unpaused run with an open blocking unknown: validate → `replaceRemainder` → continue. Rejected when no blocking unknown is open                                                                                                                                                           | Integration: soft-interrupt run submits `remainder` → replaced; same call with no open unknown → refused                                                                                                                                        |
| 2.4 | ☐ (as of 2026-08-30 · flips when both response snapshots exist and assert `structuredContent` as JSON)                                | `execution/formatting/response-assembler.ts`                                                                        | Interrupt text section + `structuredContent.chain_interrupt`; paused variant lists the resolution verbs verbatim from the contract                                                                                                                                                                               | Snapshot of both variants; `structuredContent` asserted as JSON, not by substring                                                                                                                                                               |
| 2.5 | ☐ (as of 2026-08-30 · flips when `validate:table-contracts` and `validate:no-phantom-columns` pass with the new counters)             | `execution_records`, `table-contracts.ts`, `sqlite-engine.ts`                                                       | Terminal counters `interrupts_raised`, `remainders_accepted` (D-8); schema bump; declared in table contracts                                                                                                                                                                                                     | `validate:table-contracts`, `validate:no-phantom-columns`                                                                                                                                                                                       |
| 3.1 | ☐ (as of 2026-08-30 · flips when the hook matrix test exists)                                                                         | `hooks/tests/`, `hooks/lib/session_state.py`, `hooks/README.md`                                                     | Matrix: pending `__unknown_interrupt__` × {resume, accept_alternative, abort, cancel} allowed; bare `chain_id` denied; label rendering for the synthetic id (session_state.py currently names gates from `pendingGateReview.gateIds`)                                                                            | `validate:python`; deny message names the verbs                                                                                                                                                                                                 |
| 4.1 | ☐ (as of 2026-08-30 · flips when the E2E passes)                                                                                      | `tests/e2e/` or `tests/integration/chain/`                                                                          | E2E both branches (OQ-1's old close condition): blocking → soft interrupt → answer step; blocking with knob → paused → resume; blocking with knob → paused → accept_alternative+remainder                                                                                                                        | Three green runs; `execution_records` counters match                                                                                                                                                                                            |
| 4.2 | ☐ (as of 2026-08-30 · flips when a claim on a paused run returns the interrupt in a test)                                             | handoff tests                                                                                                       | D-9: mint handoff on a paused run; claim from a second server returns the interrupt, not a step                                                                                                                                                                                                                  | Extends `verify-handoff.mjs` or the two-server jest scenario if handoff row 2.2 has landed by then                                                                                                                                              |
| 4.5 | ☐ (as of 2026-08-30 · flips when `verify-unknown-interrupt.mjs` exits 0 against a built `dist/`)                                      | `server/scripts/verify-unknown-interrupt.mjs`                                                                       | Live drive against `dist/` (pattern: `verify-handoff.mjs`): declare blocking, read `structuredContent`, submit `remainder`. This is the probe that catches the allowlist trap                                                                                                                                    | Script exits 0 against a built server; refuses on stale `dist/`                                                                                                                                                                                 |
| 5.1 | ☐ (as of 2026-08-30 · flips when the four docs describe the shipped interrupt and `validate:format` passes)                           | `docs/concepts/chains-lifecycle.md`, `docs/reference/mcp-tools.md`, `docs/reference/workflow-ir.md`, `CHANGELOG.md` | Interrupt section, `remainder`, `pauseOnBlocking`, verb table; `chains-lifecycle` documents derivation-only-for-`affected_step_ids` and the killed OQ-5. Note the global skills (`unknowns`, `mcp-prompt-router`) are now true rather than aspirational                                                          | Docs/code lockstep review; `validate:format`                                                                                                                                                                                                    |
| F-1 | ☐ (as of 2026-08-30 · flips when a server-proposed remainder is accepted in a real run; ✗ if none within one release after 5.1 ships) | `interrupt-policy.ts`                                                                                               | Follow-on: server-derived reorder `alternative` (advance nodes with no edge to the affected set) — IR runs with `edges` only; template chains have no dependency data                                                                                                                                            | An accepted server-proposed remainder in a real run                                                                                                                                                                                             |

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
