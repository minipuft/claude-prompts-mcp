---
title: "P3 Step Identity — Discovery (consumer enumeration)"
date: 2026-08-11
status: active
tags: []
---

# P3 Step Identity — Discovery

Master plan: `plans/adaptive-chain-runtime-2026-08-09.md` §P3 (D5 amended 2026-08-11: P3 absorbs the
`chain_run_registry` retirement — the execution-ledger Tier-10 spec no longer exists).
Source: very-thorough consumer enumeration (subagent, 2026-08-11), spot-check anchors before use — they WILL drift.

## Answered open unknowns

1. **The Python hook module API DOES leak step integers.** `load_active_chain_state()` returns
   `{"current_step": int, "total_steps": int, ...}` (both `_view_row_to_hook_state` and
   `_session_to_hook_state`, `hooks/lib/db_reader.py:293-294, :444-445`). Consumers:
   **gemini-prompts** (before-agent.py, pre-compact.py, after-tool.py) and **opencode-prompts**
   (`src/lib/types.ts:35-36` mirrors the dict; plugin + session-state read it; e2e tests assert it).
   **minipuft-plugins: measured ZERO matches.** The dict keys are cross-repo public API.
2. **Chain YAML steps have NO stable id.** `ChainStepSchema` = promptId + stepName (+mappings).
   ~~uniqueness is enforced on `stepName` only (prompt-schema.ts:463, :570)~~ **FALSIFIED at Tier 1
   execution (D1): those sites only build soft-warning Sets for inputMapping refs — nothing ever
   rejected a duplicate stepName.** `stepName` values
   hardcode position in prose ("Options (1/3)"). `promptId` is NOT unique within a chain.
   Position is MINTED at exactly two sites: `04-parsing-stage.ts:151` and
   `symbolic-operator-parser.ts:742` (`stepNumber: index + 1`).
3. **A stable-ID skeleton already exists, unused/ID-flavored**: `ChainSession.currentStepId?: string`
   (chain-session.ts:109, zero writers), `chain_step_ids` in the resource index
   (resource-indexer.ts:297, `s.promptId` — consumed by prompt-suggest.py), and
   `07-planning-stage.ts:139` logs `stepIds: steps.map(s => s.promptId)`.

## Blast radius by role (identity/order/cardinality trichotomy)

- **IDENTITY sites** (which step): dominate manager.ts, stages 13/14/16/18/20, gate-verdict-processor,
  step-capture-service, chain-operator-executor, temporary-gate registry (`target_step_number` — a
  USER-FACING prompt_engine param!), text-refs stores. Position-keyed containers needing key-type
  change: `ChainState.stepStates: Map<number,...>`, `TextReferenceStore.chainStepResults[chainId][stepNumber]`,
  `argument-history previousResults: Record<number,string>`, `ChainSession.executionOrder: number[]`.
- **ORDER sites** (what's next / done): `advanceStep` core (manager.ts:989-1020, the canonical `+1`
  at :1006 plus a `>` double-advance guard needing a total order), `isSessionActiveForHooks`
  (manager.ts:445-455 — decides whether a hook-view row EXISTS; highest-leverage ORDER site),
  18-execution-stage completion checks (:61-69), hierarchy-resolver `first|last|odd|even` step
  targeting (+ scopeId key `${chainId}:${currentStep}` at :216), response-assembler next-step lookup.
- **CARDINALITY sites** (how many — survive unchanged): `steps_planned`, `record_count`,
  `stepsExecuted` set-size, planning-stage counts.
- **Latent identity→cardinality coercion bugs** (look like counts, are positions — break silently
  under node IDs, fix during migration): `manager.ts:1881` (`totalSteps += currentStep` in stats),
  `argument-history-tracker.ts:257` (`maxStepNumber + 1` as totalSteps),
  `21-formatting-stage.ts:168` (`stepsExecuted = sessionContext.currentStep`).

## Design stance (proposed, pre-plan — to be ratified in the implementation_plan run)

1. **Node ID becomes the internal identity; integer position becomes a derived projection.**
   The hook dict keys `current_step`/`total_steps`, the `chain_sessions` state-blob keys
   `currentStep`/`totalSteps`, and `v_execution_status` json_extracts KEEP their shape — computed
   from node order at projection time. Zero cross-repo breakage (gemini-prompts / opencode-prompts
   untouched); the in-contract surface never changes type.
2. **New optional `id` on ChainStepSchema**, defaulting to a derived stable slug; `stepName` sheds
   its positional prose over time. `target_step_number` (public param) gains an ID-accepting
   sibling rather than changing type (union rule: adding a member is non-breaking).
3. **The P2-discovered lifecycle defects are P3 acceptance criteria, not side quests**: completion
   defined as terminal-node state (not `currentStep > totalSteps`) fixes the completion-banner lie;
   start-render appends the step-1 working record; post-completion resume answers "already complete".
4. **Registry retirement rides the same storage change**: per-row run/node tables replace the
   `chain_run_registry` blob; `persistSessions()` transaction boundary preserved;
   `chain_sessions` remains the derived hook projection (its writer contract already says so).

## Not in P3

- The unknowns ledger's `discoveredAtStep`/`resolvedAtStep` re-typing is mechanical once node IDs
  exist (entries live in the session blob; equality-only semantics).
- `gate_verdicts_json` value-dead cleanup (Q3 ruling, still deferred).
