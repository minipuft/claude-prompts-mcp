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

## Tiers

| Row | Status                                                                                     | Where                                                                                                               | Change                                                                                                                                                                                                                                                                                                           | Verify                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ☐ (as of 2026-08-30 · flips when `validate:contracts` is green with the new params)        | `tooling/contracts/prompt-engine.json`, `workflow-ir.json`                                                          | `remainder` param (notes: chain_id-only, open-blocking-unknown-only, replaces strictly-after-current); `gate_action` enum += `resume`, `accept_alternative`; flag key `resolvesPendingGate → resolvesPendingRun`; `budget.pauseOnBlocking` (boolean, default false); `observations` notes describe the interrupt | `npm run generate:contracts && npm run validate:contracts`                                                                                                     |
| 0.2 | ☐ (as of 2026-08-30)                                                                       | `scripts/generate-contracts.ts`, `hooks/lib/_generated/resolution_verbs.py`, `hooks/gate-enforce.py`                | Generator reads the renamed flag; artifact constant renamed `PENDING_RUN_RESOLUTION_PARAMS`; hook imports the new name. One commit — the old name must not survive anywhere (`rg resolvesPendingGate\|PENDING_GATE_RESOLUTION` returns nothing)                                                                  | `npm run validate:python`; `hooks/tests/test_gate_enforce_verdict.py` green                                                                                    |
| 0.3 | ☐ (as of 2026-08-30)                                                                       | `mcp/tools/schemas/prompt-engine.schema.ts`, `workflow-ir.schema.ts`                                                | Zod: `remainder` (reuses IR node + edge schemas, `.strict()`), `gate_action` enum, `pauseOnBlocking`                                                                                                                                                                                                             | `npm run typecheck`                                                                                                                                            |
| 0.4 | ☐ (as of 2026-08-30 · **fifth-instance guard**)                                            | `mcp/tools/index.ts` ~831-842                                                                                       | `remainder` added to the explicit argument allowlist. Record it as the fifth instance in the comment                                                                                                                                                                                                             | Live drive (row 4.5) shows `remainder` reaching stage 16 — a green suite cannot prove this                                                                     |
| 1.1 | ☐ (as of 2026-08-30)                                                                       | `pipeline/decisions/mutation/types.ts`, new `interrupt-policy.ts`                                                   | Pure `decideInterrupt({ledger, nodes, currentNodeId, pauseOnBlocking})` → `ChainInterrupt \| undefined` with `affectedStepIds` from declared links (OQ-2) and `paused`. `UNKNOWN_INTERRUPT_GATE_ID = '__unknown_interrupt__'` beside the phase-guard constant                                                    | Unit tests: declared-only derivation; undeclared textual reference NOT flagged; no interrupt for non-blocking; `paused` mirrors the knob                       |
| 1.2 | ☐ (as of 2026-08-30)                                                                       | `modules/chains/manager.ts`, `chain-session.ts`                                                                     | `ChainSessionStore.replaceRemainder(sessionId, nodes, unknownId)`: atomic, awaited, throws on failure; nodes strictly after current replaced; `origin='remainder'`, `origin_unknown_id` set; per-unknown-id and per-run caps enforced here with named rejection reasons                                          | `chain-run-storage.integration.test.ts`: replace, cap-reached, current-node-untouched, persistence round-trip                                                  |
| 1.3 | ☐ (as of 2026-08-30)                                                                       | `16-response-capture-stage.ts` ~459                                                                                 | Blueprint readback of `pauseOnBlocking` next to `maxInsertions`                                                                                                                                                                                                                                                  | Unit: absent → false; declared true → true                                                                                                                     |
| 2.1 | ☐ (as of 2026-08-30)                                                                       | `16-response-capture-stage.ts`                                                                                      | After `applyMutation`: call `decideInterrupt`; put the interrupt on `context` (never mutate arrays directly); when `paused`, `setPendingGateReview` with the synthetic id                                                                                                                                        | Integration: blocking discovery → investigation step response carries `chain_interrupt`; knob on → no step instructions, synthetic review pending              |
| 2.2 | ☐ (as of 2026-08-30)                                                                       | `13-session-stage.ts`, `GateVerdictProcessor`                                                                       | `gate_action:resume` clears the synthetic review and issues the investigation step; `accept_alternative` requires `remainder` in the same call; `abort`/`cancel` behave as today. Refusals name their reason (no remainder, no open unknown, cap)                                                                | Integration: paused → resume → investigation step; paused → accept_alternative+remainder → new remainder; accept_alternative without remainder → named refusal |
| 2.3 | ☐ (as of 2026-08-30)                                                                       | `PromptExecutor` / stage that reads `mcpRequest`                                                                    | `remainder` path on an unpaused run with an open blocking unknown: validate → `replaceRemainder` → continue. Rejected when no blocking unknown is open                                                                                                                                                           | Integration: soft-interrupt run submits `remainder` → replaced; same call with no open unknown → refused                                                       |
| 2.4 | ☐ (as of 2026-08-30)                                                                       | `execution/formatting/response-assembler.ts`                                                                        | Interrupt text section + `structuredContent.chain_interrupt`; paused variant lists the resolution verbs verbatim from the contract                                                                                                                                                                               | Snapshot of both variants; `structuredContent` asserted as JSON, not by substring                                                                              |
| 2.5 | ☐ (as of 2026-08-30)                                                                       | `execution_records`, `table-contracts.ts`, `sqlite-engine.ts`                                                       | Terminal counters `interrupts_raised`, `remainders_accepted` (D-8); schema bump; declared in table contracts                                                                                                                                                                                                     | `validate:table-contracts`, `validate:no-phantom-columns`                                                                                                      |
| 3.1 | ☐ (as of 2026-08-30 · flips when the hook matrix test exists)                              | `hooks/tests/`, `hooks/lib/session_state.py`, `hooks/README.md`                                                     | Matrix: pending `__unknown_interrupt__` × {resume, accept_alternative, abort, cancel} allowed; bare `chain_id` denied; label rendering for the synthetic id (session_state.py currently names gates from `pendingGateReview.gateIds`)                                                                            | `validate:python`; deny message names the verbs                                                                                                                |
| 4.1 | ☐ (as of 2026-08-30 · flips when the E2E passes)                                           | `tests/e2e/` or `tests/integration/chain/`                                                                          | E2E both branches (OQ-1's old close condition): blocking → soft interrupt → answer step; blocking with knob → paused → resume; blocking with knob → paused → accept_alternative+remainder                                                                                                                        | Three green runs; `execution_records` counters match                                                                                                           |
| 4.2 | ☐ (as of 2026-08-30)                                                                       | handoff tests                                                                                                       | D-9: mint handoff on a paused run; claim from a second server returns the interrupt, not a step                                                                                                                                                                                                                  | Extends `verify-handoff.mjs` or the two-server jest scenario if handoff row 2.2 has landed by then                                                             |
| 4.5 | ☐ (as of 2026-08-30)                                                                       | `server/scripts/verify-unknown-interrupt.mjs`                                                                       | Live drive against `dist/` (pattern: `verify-handoff.mjs`): declare blocking, read `structuredContent`, submit `remainder`. This is the probe that catches the allowlist trap                                                                                                                                    | Script exits 0 against a built server; refuses on stale `dist/`                                                                                                |
| 5.1 | ☐ (as of 2026-08-30)                                                                       | `docs/concepts/chains-lifecycle.md`, `docs/reference/mcp-tools.md`, `docs/reference/workflow-ir.md`, `CHANGELOG.md` | Interrupt section, `remainder`, `pauseOnBlocking`, verb table; `chains-lifecycle` documents derivation-only-for-`affected_step_ids` and the killed OQ-5. Note the global skills (`unknowns`, `mcp-prompt-router`) are now true rather than aspirational                                                          | Docs/code lockstep review; `validate:format`                                                                                                                   |
| F-1 | ☐ (as of 2026-08-30 · ✗ if no accepted server proposal within one release after 5.1 ships) | `interrupt-policy.ts`                                                                                               | Follow-on: server-derived reorder `alternative` (advance nodes with no edge to the affected set) — IR runs with `edges` only; template chains have no dependency data                                                                                                                                            | An accepted server-proposed remainder in a real run                                                                                                            |

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
