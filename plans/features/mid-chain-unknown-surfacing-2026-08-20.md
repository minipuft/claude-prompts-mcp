---
title: Mid-chain unknown surfacing and adaptive consolidation
date: 2026-08-20
status: backlog
tags:
  - chains
  - unknowns-ledger
  - adaptive-mutation
  - interrupts
---

# Mid-chain Unknown Surfacing and Adaptive Consolidation

## Current State (verified at HEAD, 2026-08-20)

The `prompt_engine` tool already accepts an `observations` parameter carrying typed unknown
entries, and a deterministic mutation policy already reacts to them:

| Concern                                                              | Where                                                                                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Contract source of truth (`observations` description, shapes, notes) | `server/tooling/contracts/prompt-engine.json`                                                                           |
| Zod input schema (`observations` param)                              | `server/src/mcp/tools/schemas/prompt-engine.schema.ts` (~lines 209, 261)                                                |
| Generated contract schema                                            | `server/src/mcp/contracts/schemas/_generated/prompt_engine.generated.ts`                                                |
| Entry types (`UnknownObservation`, `UnknownLedgerEntry`)             | `server/src/shared/types/chain-session.ts`                                                                              |
| Ledger transition rules (pure, all-or-nothing batch, 200-entry cap)  | `server/src/engine/execution/capture/unknown-observation-processor.ts` (`computeUnknownLedger`)                         |
| Adaptive mutation decision (pure)                                    | `server/src/engine/execution/pipeline/decisions/mutation/mutation-policy.ts` (`decideMutation`)                         |
| Mutation application (Tier 3 orchestration)                          | `server/src/engine/execution/pipeline/stages/16-response-capture-stage.ts` (`applyMutation`, ~line 291)                 |
| Storage mutations                                                    | `server/src/modules/chains/manager.ts` (`ChainSessionStore.insertNodeAfter` ~1163, `markNodeSkipped` ~1253)             |
| Inserted investigation prompt                                        | `server/resources/prompts/workflow/investigate_unknown/prompt.yaml`                                                     |
| Behavior docs                                                        | `docs/concepts/chains-lifecycle.md`, `docs/reference/mcp-tools.md`                                                      |
| Integration tests                                                    | `server/tests/integration/chain/unknown-observations-flow.integration.test.ts`, `chain-run-storage.integration.test.ts` |

Observation shapes: `{type:'unknown_discovered', id, statement, blocking?, target_step_id?}`
opens/refreshes a ledger entry; `{type:'unknown_resolved', id, statement, resolution:'answered'|'irrelevant'}`
closes one. The policy is advisory by construction (the model emits observations; the server owns
every mutation) and does exactly two things:

1. **Insert**: a blocking `unknown_discovered` inserts ONE `investigate_unknown` node immediately
   after the current node (capped at 1 per unknown id, 3 per run; insert takes precedence over skip).
2. **Skip**: an `unknown_resolved` with `resolution:'irrelevant'` skips its ledger entry's
   `target_step_id` when that node is strictly ahead of the current step.

Prior art for pausing: blocking **gates** already pause a run — stage 13
(`server/src/engine/execution/pipeline/stages/13-session-stage.ts`) creates a pending gate review
and the chain halts until `gate_verdict` arrives on the same `chain_id`. So the codebase already
has one "structured stop + typed resume verb" mechanism; unknowns have none.

## Gap

When a blocking unknown lands, the run bends but never stops:

- The chain **continues** to the next node (possibly the inserted investigation node) and keeps
  issuing step instructions. Nothing halts at a step boundary to say "a blocking unknown was
  discovered; here is what it affects."
- The response surfaces the ledger (chains-lifecycle "Unknowns Ledger" section) but there is no
  **structured interrupt**: no machine-readable report of which downstream nodes the unknown
  touches, and no explicit resume handshake distinct from ordinary step resumption.
- The policy can only insert one investigation node or skip one declared target. It cannot
  **propose a better path** — a consolidated or reordered remainder — when the discovery
  invalidates the original plan's shape. The run always finishes the original plan modulo those
  two local edits.

## Proposal

### 1. Pause-on-blocking

When an `observations` batch containing a blocking `unknown_discovered` is applied, the run halts
at the **next step boundary** (after the current step's capture completes — never mid-step) and
the tool result returns a structured interrupt instead of the next step's instructions:

```jsonc
{
  "kind": "chain_interrupt",
  "reason": "blocking_unknown",
  "unknown": { "id": "...", "statement": "..." },
  "affected_step_ids": ["..."], // nodes whose instructions reference the unknown's target
  "remaining_nodes": ["..."], // current remainder, post-mutation
  "resume": {
    "chain_id": "...",
    "verb": "resume | accept_alternative | abort",
  },
}
```

- `chain_id` remains the resume token, mirroring the gate-pending handshake (stage 13); the hook
  layer's generated resolution-verb artifact must learn any new verbs so a paused run can always
  be exited (see `plans/gate-enforce-resolution-verbs-2026-08-20.md` for why a private verb model
  rots).
- Pause is a **policy outcome**, not a new side channel: `decideMutation` (or a sibling pure
  decision module under `pipeline/decisions/`) gains an `interrupt` kind; stage 16 applies it the
  same way it applies insert/skip. Determinism and the advisory posture are preserved — the
  server still only reacts to declared observations.
- Opt-out stays possible: a submission-level knob (alongside `budget.maxInsertions` in the
  workflow IR) can select today's continue-with-insertion behavior.

### 2. Propose-consolidation

The interrupt MAY carry an `alternative`: a revised remainder the caller can accept or reject
rather than blindly finishing the original plan:

```jsonc
"alternative": {
  "revised_nodes": [ { "id": "...", "promptId": "...", "stepName": "..." } ],
  "rationale": "steps n3 and n4 both depend on the unresolved schema shape; merged into one step gated on its resolution"
}
```

- **Server derives structure only** (drop/merge/reorder of existing nodes based on declared
  `target_step_id` links and the ledger); it never authors new prompt content. A caller-supplied
  alternative (the model proposing its own consolidation inside `observations` or a new
  parameter) is the richer variant — see open questions.
- `accept_alternative` atomically replaces the remainder via `ChainSessionStore` (new method
  beside `insertNodeAfter`/`markNodeSkipped`, same persistence contract: awaited, throws on
  failure). `resume` continues the original (post-insert) plan. Either way the decision is
  recorded on the run for later inspection.
- Caps carry over: one alternative per unknown id, bounded per run, exactly like insertions.

### 3. Adapter layer boundary

Client-side personal guidance systems — whatever skills, rules, or memory conventions a given
client maintains — integrate through a thin adapter contract, never by baking client-specific
content into this repo:

- The interrupt payload is **client-agnostic JSON**. This server defines the shape; a client-side
  hook/callback surface (e.g., a tool-result post-processor or the existing hooks layer under
  `hooks/`) may translate it into that client's own guidance vocabulary, prompt the user, or
  auto-answer from local knowledge before submitting the resume verb.
- The adapter contract is: (a) receive `chain_interrupt`, (b) optionally consult local guidance,
  (c) reply with one of the typed resume verbs (+ optional `observations` resolving the unknown).
  Nothing in `server/resources/prompts/` or the contract JSON references any particular client's
  guidance system.
- Downstream ports (the sibling adapter repos consuming this server) get the same contract via
  the existing generated-artifact path (`generate:contracts`), not bespoke integrations.

## Open Questions

| #    | Question                                                                                                                                | Closes when                                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | Does pause-on-blocking replace investigation-node insertion, or wrap it (pause first, insert on `resume`)?                              | An E2E test drives both a paused-then-resumed run and a paused-then-accepted-alternative run, and exactly one insertion semantics survives review. ☐ (as of 2026-08-20 · flips when the E2E lands)                                     |
| OQ-2 | `affected_step_ids` derivation: declared `target_step_id` links only, or also textual reference scanning of remaining node templates?   | A fixture chain with an undeclared-but-textually-referenced step either is or is not flagged, and the chosen rule is asserted in a unit test on the decision module. ☐ (as of 2026-08-20)                                              |
| OQ-3 | May the model author the alternative (new step list in a parameter), or does the server only ever derive structure from existing nodes? | The contract JSON for the new parameter is either merged with model-authored steps allowed and validated against the IR, or rejected in review with the derivation-only rule documented in `chains-lifecycle.md`. ☐ (as of 2026-08-20) |
| OQ-4 | Do resume verbs ride the existing `gate_action`/`gate_verdict` plumbing or get a parallel `interrupt_action` parameter?                 | The hook regression suite (pending gate × pending interrupt matrix) passes with one verb surface and no denied legitimate exit. ☐ (as of 2026-08-20 · flips when the hook matrix test exists)                                          |
| OQ-5 | Is a non-blocking unknown ever allowed to trigger a consolidation proposal (pure optimization, no pause)?                               | Telemetry from real runs shows ≥1 case where a non-blocking resolution would have shortened a run by ≥2 steps — or a month of runs shows none, and the scope stays blocking-only. ☐ (as of 2026-08-20)                                 |
