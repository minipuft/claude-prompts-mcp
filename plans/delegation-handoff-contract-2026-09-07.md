---
title: "Delegation handoff contract"
date: 2026-09-07
status: active
tags: [chains, delegation, gates, workflow-ir, hooks, tests]
ledger: plans/delegation-handoff-2026-09-07.md
---

# Delegation Handoff Contract

The server renders an EXECUTION BRIEF for a `==>` step and accepts a resume for it with nothing
verifying the two belong together. This plan makes the server the owner of that handoff: the
brief carries a node token, the worker's reply carries it back in a `HANDOFF RESULT` trailer, and
a configured server refuses a resume that arrives without it. Rulings and evidence:
`plans/delegation-handoff-2026-09-07.md` (D1–D7, O1–O5).

## Scope

- **objective**: a blocking delegated node's resume must carry the brief's node token; a detached
  node's late result routes by that same token.
- **success_signal**: with no config set (default `required`), resuming a `==>` node with
  prose only is refused naming the node and the missing line; the same resume with the trailer is
  captured and the chain advances; the Claude Code handoff contains `run_in_background: false`.
- **non-goals**: fan-out scheduler; symbolic syntax for detached; JSON worker reply; SubagentStop
  hook as a requirement; a `scope: 'chain'` gate reader; legacy verdict-string retirement.
- **constraints**: `user_response` shape unchanged; stage 16 `execute` ≤15 cognitive (now 13,
  becomes 14); `captureStep` (14) gains no branch; `module.yaml` + CLAUDE.md matrix row together;
  hooks may only tighten.

## Contract

```
HANDOFF RESULT
node: <token>                 # token = nodeId ?? 'n' + stepNumber, ONE exported derivation
Proposed Gate Review:         # existing block, unchanged, only when the step carries gates
- [gate name]: PASS|FAIL — <one line>
findings:                     # reserved; passed through unparsed until contract-layer D5 lands
```

`execution.delegation.evidence: 'advisory' | 'required'` — resolved by a pure function with
default `required` (owner ruling 2026-09-08, R3; supersedes "B when configured"). `required` =
refuse the resume; `advisory` = accept and record. Both modes record the REASON the resume
carried in `execution_records.handoff_evidence` (`ok` · `trailer` · `node-line` · `node-mismatch`,
NULL for a non-delegated step — R1).

## Tier 1 — Contract module, brief token, foreground pin

| #   | St  | File                                                                                                      | Change                                                                                                                                                                                                                            | ~Lines | Depends       | Verify                                                                                                                               | Justification                                                                   |
| --- | --- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1.1 | ✓   | `server/src/engine/execution/delegation/handoff-contract.ts` (NEW)                                        | `HANDOFF_RESULT_HEADING`, `HandoffEvidenceMode`, `resolveHandoffEvidenceMode`, `handoffNodeToken`, `ParsedHandoffTrailer`, `parseHandoffTrailer`, `HandoffEvidence`, `resolveHandoffEvidence`, `buildHandoffResultSection` — pure | ~120   | —             | `tests/unit/execution/delegation/handoff-contract.test.ts`: token both branches; parse with/without heading; mismatch; advisory → ok | one module both render and capture import, so the token cannot be derived twice |
| 1.2 | ✓   | `server/src/engine/execution/delegation/types.ts:12`                                                      | `DelegationPayload` += `readonly nodeToken: string; readonly mode: 'blocking' \| 'detached'`                                                                                                                                      | ~6     | 1.1           | `npm run typecheck` surfaces every construction site                                                                                 | payload is the only channel from executor to strategy                           |
| 1.3 | ✓   | `server/src/engine/execution/delegation/brief.ts:86,138`                                                  | `buildResultContractSection(token, hasGates)` delegates to `buildHandoffResultSection`; `BriefBodyInputs` += `nodeToken`                                                                                                          | ~20    | 1.1           | existing brief tests + new assertion: brief contains `node: <token>` as the last section                                             | contract closes the brief (section order is part of the contract)               |
| 1.4 | ✓   | `server/src/engine/execution/operators/chain-operator-executor.ts:573,878` + `delegation/renderer.ts:116` | both payload sites set `nodeToken: handoffNodeToken(step)` and `mode: 'blocking'`                                                                                                                                                 | ~12    | 1.2           | `delegated-resume-brief.integration.test.ts` asserts the token line for a chain with node ids and one without (`n2`)                 | verify-paths found two construction sites, not one                              |
| 1.5 | ✓   | `server/src/engine/execution/delegation/strategy.ts:18,132,164,185,…`                                     | `formatToolCall(agentType, model, mode)`; Claude renders `• run_in_background: false` when `mode === 'blocking'`; other 5 strategies accept and ignore                                                                            | ~20    | 1.2           | `tests/unit/execution/delegation/strategy.test.ts`: Claude block has the line; others byte-identical to before                       | this harness spawns in the background by default; the pin is one rendered line  |
| 1.6 | ✓   | tests named in 1.1, 1.3, 1.4, 1.5                                                                         | write/extend                                                                                                                                                                                                                      | ~150   | 1.3, 1.4, 1.5 | `npm test -- delegation`                                                                                                             | —                                                                               |

Tier 1 gate: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:unit && npm run test:integration`
(not `npm test -- delegation`: jest's path filter matches the worktree directory name, so that form runs the whole suite — notes deviation 6).

**Tier 1 receipt (✓ 2026-09-07, `feat/delegation-handoff`)** — rows 1.1–1.6 flipped on their Verify commands:
`handoff-contract.test.ts` 19 tests; `brief.test.ts`, `acknowledgment.test.ts`, `delegation-renderer.test.ts`
(blocking pin + five-strategy byte-identity), `delegated-resume-brief.integration.test.ts` (`node: step-review`,
`node: n2` legacy fallback, `run_in_background: false` reached through the pipeline) — 9 suites, 107 tests green
under the ESM flag; `typecheck` clean; `lint:ratchet` 3094/971 no regression; `typecheck:tests:ratchet` 367 no
regression; `test:unit` 230 suites / 3043 passed (1 skipped, pre-existing); `test:integration` 63 suites / 806 passed.
Three payload sites, not two (notes deviation 2).

## Tier 2 — Evidence at resume

| #   | St  | File                                                                                                                                                                                               | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ~Lines | Depends  | Verify                                                                                                                                                               | Justification                                                                                                                    |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | ☐   | `server/src/shared/types/core-config.ts:163` + `server/src/cli-shared/config-input-validator.ts:34,155`                                                                                            | `ExecutionConfig` += `delegation?: { evidence?: HandoffEvidenceMode }` (NOT the legacy `judge` at :605); validator gains the key with an enum case `advisory\|required` (precedent `server.transport` :130)                                                                                                                                                                                                                                                                                                                                                                                                                                           | ~20    | —        | typecheck; validator unit test: both values accepted, `maybe` refused                                                                                                | mirrors `execution.judge` placement; a knob `cpm config set` cannot reach is half a feature (OQ3)                                |
| 2.2 | ☐   | `server/src/engine/execution/delegation/acknowledgment.ts` (DELETE) + its unit test (MOVE cases into `handoff-contract.test.ts`)                                                                   | The S8 boolean predicate is retired: the reason a resume carries is `resolveHandoffEvidence(...)` projected to `HandoffEvidenceReason = 'ok' \| 'trailer' \| 'node-line' \| 'node-mismatch'`, exported from `handoff-contract.ts` as `resolveHandoffEvidenceReason({ delegated, expectedToken, reply })` → reason, or `undefined` when not delegated. `PROPOSED_GATE_REVIEW_TOKEN` stays exported (the brief renders it).                                                                                                                                                                                                                             | ~30    | 1.1      | unit: ungated delegated reply without trailer → `'trailer'`; wrong node → `'node-mismatch'`; with trailer → `'ok'`; not delegated → `undefined`                      | R1: the boolean was a projection of the reason; two channels for one fact is the parallel-system shape cleanup-standards forbids |
| 2.3 | ☐   | `server/src/engine/execution/capture/step-capture-service.ts:200-246`                                                                                                                              | `ledgerCapturedStep` binds `handoffEvidence: resolveHandoffEvidenceReason({ delegated: step?.delegated, expectedToken: handoffNodeToken(step ?? { stepNumber: target.ordinal }), reply })` in place of `delegationSkipped`; `stepGateText` no longer consulted                                                                                                                                                                                                                                                                                                                                                                                        | ~12    | 2.2, 2.8 | `delegation-handoff-evidence.integration.test.ts` reads the column; sonarjs `captureStep` still 14                                                                   | no branch added to `captureStep`                                                                                                 |
| 2.4 | ☐   | `server/src/engine/execution/pipeline/stages/16-response-capture-stage.ts:92,100,136` + `src/mcp/tools/prompt-engine/core/pipeline-builder.ts:327`                                                 | `collaborators` bag += `handoffEvidenceMode?: () => HandoffEvidenceMode` (OQ1; absent → `resolveHandoffEvidenceMode(undefined)`); builder passes `() => resolveHandoffEvidenceMode(deps.configManager.getConfig().execution?.delegation?.evidence)`. New private `runHandoffEvidencePhase(context, session, currentNodeIdAtStart)` called in `execute` BEFORE `runUnknownsPhase`: resolves the current node's step, `resolveHandoffEvidence`, on `missing` → `context.setResponse(this.buildErrorResponse('❌ Delegated node <token>: resume carries no <what>. End the worker reply with:\n```\nHANDOFF RESULT\nnode: <token>\n```'))`, return false | ~45    | 2.1      | sonarjs `execute` = 14; integration positive control in 2.7                                                                                                          | refusal precedes every mutation (unknowns, lifecycle, verdict); sibling of the three existing refusals                           |
| 2.5 | ☐   | `server/src/infra/database/table-contracts.ts:382`                                                                                                                                                 | contract comment: `handoff_evidence` bound for every delegated step (reason), NULL only for non-delegated; replaces the S8 `delegation_skipped` paragraph                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ~6     | 2.8      | `validate:all` table-contract check                                                                                                                                  | SSOT comment must match the writer                                                                                               |
| 2.6 | ☐   | `server/src/engine/execution/module.yaml:7` + `CLAUDE.md:166`                                                                                                                                      | owns row "Delegation handoff evidence" → `resolveHandoffEvidence` (`execution/delegation/handoff-contract.ts`); stage may only call it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ~6     | 1.1      | `npm run validate:domain-ownership`                                                                                                                                  | matrix is a checked contract (PR #266)                                                                                           |
| 2.7 | ☐   | `server/tests/helpers/delegation/fake-worker.ts` (NEW) + `server/tests/integration/chain/delegation-handoff-evidence.integration.test.ts` (NEW, REPLACES `delegation-skipped.integration.test.ts`) | `runFakeWorker(brief)` reads token + gates from the brief text, returns prose + trailer. Tests under the DEFAULT config (no key set = `required`): positive control (prose-only → refused, message names token and shows the block; nothing captured, no verdict recorded); accept path (fake worker reply → captured, advances, `handoff_evidence='ok'`); wrong-node path (trailer names another token → refused `node-mismatch`); advisory path (config `advisory`, prose-only → captured, `handoff_evidence='trailer'`); legacy chain → `n<ordinal>`                                                                                               | ~260   | 2.4, 2.8 | `npm run test:integration -- tests/integration/chain/delegation-handoff-evidence`                                                                                    | no delegation test can observe a spawn; the fake worker is the conformance standard                                              |
| 2.8 | ☐   | `server/src/infra/database/sqlite-engine.ts:88,236,872`, `src/modules/chains/execution-record-store.ts:65,119,159,257,298`, `src/shared/types/chain-execution.ts:232`                              | `SCHEMA_VERSION` 27 → 28; `execution_records.delegation_skipped INTEGER` → `handoff_evidence TEXT` (CHECK in `('ok','trailer','node-line','node-mismatch')` or NULL); row type, insert binding, and projection rename to `handoffEvidence?: HandoffEvidenceReason`; header comment at :88 rewritten; confirm `v_execution_status` does not select the old column                                                                                                                                                                                                                                                                                      | ~40    | 2.2      | schema tests; `rg delegation_skipped server hooks docs` → 0 outside CHANGELOG; `validate:python` (no hook reader existed — positive control: grep before the rename) | R1: the reason is the record; ephemeral table, drop/recreate, no migration                                                       |

Tier 2 gate: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:all && npm run validate:arch && npm run validate:domain-ownership`

## Tier 3 — Docs, changelog, ledger writeback

| #   | St  | File                                                                                                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ~Lines | Depends | Verify                                             | Justification                                                                                      |
| --- | --- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 3.1 | ☐   | `docs/concepts/chains-lifecycle.md:327-383`                                                                         | "Why delegate" paragraph (D1); `HANDOFF RESULT` trailer under The Execution Brief; `execution.delegation.evidence`; foreground pin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ~40    | —       | `npm --prefix server run format` check; prose read | authors choose `==>` and need the why                                                              |
| 3.2 | ☐   | `docs/architecture/overview.md:477`                                                                                 | enforcement layering: server floor (brief + resume check), client hooks tighten, opencode has none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ~15    | —       | format check                                       | contributor-facing layering (D3)                                                                   |
| 3.3 | ☐   | `CHANGELOG.md` [Unreleased]                                                                                         | Added entry (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ~6     | —       | `validate:changelog` (in `validate:all`)           | consumer-facing                                                                                    |
| 3.4 | ☐   | `hooks/delegation-enforce.py:79-82` + NEW `hooks/lib/spawn_pin.py` + NEW `hooks/tests/test_delegation_spawn_pin.py` | R2: on `Task`/`Agent` while `pending_delegation`, allow-and-clear ONLY when `tool_input.run_in_background` is literally `false`; absent or `true` → DENY naming the parameter and the fix. The predicate lives in `hooks/lib/spawn_pin.py` (`spawn_call_is_pinned(client, tool_input) -> tuple[bool, str]`) keyed by client with the Claude row only, so the Codex (`codex-prompts`) and Gemini (`gemini-prompts`) ports — which symlink `hooks/lib` from this package — add one row each when their spawn tools expose a foreground flag. Docstring at :1-13 states the server floor / hook-tightens layering. pytest: absent → deny, `true` → deny, `false` → allow+clear, no pending → no-op | ~70    | —       | `npm run validate:python`; pytest file green       | hooks may only tighten; the adapter layer already exists as per-client hook ports sharing this lib |
| 3.5 | ☐   | `plans/delegation-handoff-2026-09-07.md`                                                                            | O1–O4 → rulings D8–D11 (defaults accepted); O5 KILLED (R3 ships `required` as the default — nothing to flip); D12 = R1 reason column, D13 = R2 hook tightening, D14 = R3 required default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ~20    | —       | plan frontmatter check                             | ledger is the decision record                                                                      |

Tier 3 gate: `scripts/classify-validation-scope.js` → full (mixed change); pre-push runs the full route.

## Tier 4 — Detached mode (after Tiers 1–3 merge and one release measures `delegation_skipped`)

| #   | St  | File                                                                                             | Change                                                                                                                             | ~Lines | Depends  | Verify                                                       | Justification                                     |
| --- | --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ------------------------------------------------------------ | ------------------------------------------------- |
| 4.1 | ☐   | `modules/workflow-ir/node-schema.ts:196`, `operators/types.ts:39`, `workflow-ir/compiler.ts:158` | `await?: 'node' \| 'run'` declared, carried, passed through                                                                        | ~20    | —        | IR schema snapshot regenerated; `typecheck:tests:ratchet`    | YAML/IR field first (non-goal: symbolic syntax)   |
| 4.2 | ☐   | `infra/database/sqlite-engine.ts:236,872` + `table-contracts.ts`                                 | `SCHEMA_VERSION` 28 → 29; `chain_run_nodes` += `await_mode TEXT`, `reported_at INTEGER`                                            | ~30    | 4.1      | schema tests; ephemeral tables drop/recreate                 | detached needs a node lifecycle the run can query |
| 4.3 | ☐   | `modules/chains/manager.ts:914-922` + run registry                                               | detached node marked spawned at render, reported on late result; terminal transition refused while any detached node is unreported | ~80    | 4.2      | integration: close refused until the late result lands       | the run-level obligation (D4)                     |
| 4.4 | ☐   | stage 16 `runHandoffEvidencePhase`                                                               | a trailer naming a non-current `await: run` node routes the result to that node instead of the current one                         | ~40    | 4.3      | integration with fake worker                                 | reuses the token as the router; no new parameter  |
| 4.5 | ☐   | `delegation/brief.ts`, `strategy.ts`                                                             | detached brief: "report later with this node token"; Claude `run_in_background: true`                                              | ~20    | 4.1      | unit                                                         | —                                                 |
| 4.6 | ☐   | tests + `docs/concepts/chains-lifecycle.md`                                                      | detached flow end to end; docs section                                                                                             | ~230   | 4.4, 4.5 | full suite + live drive of one detached chain in Claude Code | —                                                 |

Tier 4 gate: full suite + `npm run build && npm run verify:mcp` + a live drive.

Every ☐ above: (as of 2026-09-07 · flips when the row's Verify command passes on `feat/delegation-handoff`).

## New file justifications

- `delegation/handoff-contract.ts` — the brief renderer and the resume capture must import ONE
  derivation of the token and ONE parser of the trailer; `acknowledgment.ts` documents itself as
  owning the skip predicate and nothing else, and `brief.ts` is render-only.
- `tests/helpers/delegation/fake-worker.ts` — no existing helper produces a worker reply;
  `test-helpers.ts` is pipeline plumbing. The fake worker is the conformance standard every
  delegation test shares.
- `tests/integration/chain/delegation-handoff-evidence.integration.test.ts` — the three existing
  delegation suites assert brief fragments; the refusal path is a new behavior with its own
  positive control.

## Execution dispatch

| Work                                                                      | Agent       | Why this tier                                                                                |
| ------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| Tier 1                                                                    | standard    | bounded: interfaces are fixed in the design; failure shape is wrong output on a bounded task |
| Tier 2                                                                    | heavy       | decision-bearing: stage wiring, refusal wording, config access (OQ1), complexity headroom    |
| Tier 3                                                                    | standard    | prose with judgment about reader need; bounded by the ledger                                 |
| Tier 4                                                                    | heavy       | schema bump + node lifecycle + close guard; separate PR after Tier 1–3 measured              |
| Gate verdicts, tier acceptance, OQ rulings, final live drive, scope check | main thread | never delegated                                                                              |

## Open questions

| id  | status                    | precedes | default                                                                                                                                                                                                                                                                                                                                                                                     | alternative                                                                                         |
| --- | ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| OQ1 | RULED-BY-PROBE 2026-09-08 | 2.4      | stage 16's `collaborators` bag gains `handoffEvidenceMode?: () => HandoffEvidenceMode`; `PipelineBuilder` passes `() => resolveHandoffEvidenceMode(deps.configManager.getConfig().execution?.delegation?.evidence)` — the sibling pattern (identity stage and gates config are both getters over `configManager`, so hot-reloaded config is honored; no seventh positional, `max-params` 6) | resolved once at build (stale after hot reload); read `context` at call time (no config on context) |
| OQ2 | RULED 2026-09-08 (owner)  | —        | `required` ships as the DEFAULT; `advisory` is the opt-out. `resolveHandoffEvidenceMode(undefined)` → `'required'` (Tier 1's "defaults to advisory" unit test flips). Ledger O5 is killed — there is no flip to schedule                                                                                                                                                                    | keep `advisory` default one release                                                                 |
| OQ3 | RULED-BY-PROBE 2026-09-08 | 2.1      | `config-input-validator.ts` DOES enumerate keys (`execution.judge` at :34/:155, typed cases; enum precedent `server.transport` :130) → add `execution.delegation.evidence` as an enum case `advisory                                                                                                                                                                                        | required`so`cpm config set` can reach it                                                            | leave validator untouched (knob only reachable by editing config.json) |
| OQ4 | OPEN                      | 4.1      | no per-run override of evidence mode via workflow `budget`                                                                                                                                                                                                                                                                                                                                  | `budget.delegationEvidence`                                                                         |

## Changelog entry

- **Added**: Delegated chain steps (`==>`) now render a `HANDOFF RESULT` trailer contract in the
  execution brief — the worker echoes the node token back with its work. By default the server
  refuses a resume for a delegated step that arrives without it, naming the step and the missing
  line; `execution.delegation.evidence: advisory` accepts instead. Every delegated step's
  execution record carries `handoff_evidence` (the reason the resume was or was not acceptable).
  Claude Code handoffs pin `run_in_background: false`, and the Claude Code delegation hook refuses
  a Task call for a delegated step that does not carry it.
- **Changed**: `execution_records.delegation_skipped` is replaced by `handoff_evidence` (schema 28).

## Discovery (step 1)

- The server never waits: `prompt_engine` renders one step and returns; the run sits in
  `chain_runs` at `current_node_id` until a resume arrives. No timer, no tail, no SubagentStop
  hook.
- Three mechanisms, no shared owner: the brief + `user_response` resume (cross-client, verifies
  nothing), `hooks/delegation-enforce.py` (Claude Code only, clears state at Task/Agent
  invocation, so it tracks spawn, not completion), `resolveDelegationSkipped` (post-hoc, gated
  steps only). gemini-prompts carries its own hook copy; opencode-prompts has none.
- Sibling pattern for a refusal at resume: stage 16 already refuses observations, remainder and
  interrupt verbs by setting an error response and returning `false` before any mutation.
- Gate `scope: 'chain'` is declared (`execution/types.ts:343`) and read by nothing. Contract-layer
  D5 `findings[]` is in `tooling/contracts/prompt-engine.json` only, not in code.
- Intent: feature (secondary refactor), risk medium (a refuse in the resume hot path; mitigated by
  the `advisory` default and a positive-control test), external deps none.

## Design (step 2)

Pre-flight: 0 failures, compound none. Identification: pure functions, no state, one module under
`engine/execution/delegation/` imported by both the brief renderer and the resume capture. Probed
complexity: `step-capture-service.ts:61 captureStep` 14, `16-response-capture-stage.ts:100
execute` 13. Rejected alternatives: a `DelegationHandoffService` class (no state to hold), a new
`prompt_engine` parameter for the token (union addition, major bump), hook-only enforcement
(single client, spawn-not-completion).

Interfaces:

```ts
// delegation/handoff-contract.ts
export const HANDOFF_RESULT_HEADING = "HANDOFF RESULT";
export type HandoffEvidenceMode = "advisory" | "required";
export function resolveHandoffEvidenceMode(
  configured?: HandoffEvidenceMode,
): HandoffEvidenceMode; // ?? 'advisory'
export function handoffNodeToken(step: {
  nodeId?: string;
  stepNumber: number;
}): string;
export interface ParsedHandoffTrailer {
  readonly node: string | null;
  readonly proposedGateReview: string | null;
  readonly findingsBlock: string | null;
}
export function parseHandoffTrailer(reply: string): ParsedHandoffTrailer;
export type HandoffEvidence =
  | { kind: "ok" }
  | {
      kind: "missing";
      expected: string;
      missing: "trailer" | "node-line" | "node-mismatch";
      found: string | null;
    };
export function resolveHandoffEvidence(input: {
  delegated: boolean | undefined;
  mode: HandoffEvidenceMode;
  expectedToken: string;
  reply: string;
}): HandoffEvidence;
export function buildHandoffResultSection(
  token: string,
  hasGates: boolean,
): string;
// delegation/types.ts      DelegationPayload += readonly nodeToken: string; readonly mode: 'blocking' | 'detached';
// delegation/strategy.ts   formatToolCall(agentType, model, mode)
// acknowledgment.ts        resolveDelegationSkipped({ delegated, capturedResponse, expectedToken }) → boolean | undefined
// core-config.ts           ExecutionConfig += delegation?: { evidence?: HandoffEvidenceMode }
// tests/helpers/delegation/fake-worker.ts   runFakeWorker(brief: string): string
```

## Verified paths (step 3)

27 references probed with `ls`, `wc -l`, `rg -n`; no shims. Corrections the tables above already
carry: fake worker under `server/tests/helpers/` (no `tests/support`); `SCHEMA_VERSION` is 27, so
Tier 4 bumps to 28; two payload construction sites (`chain-operator-executor.ts:573` via
`renderDelegatedStepHandoff`, and `:878`); `ExecutionConfig` at `core-config.ts:163` (the `judge`
at `:605` is a legacy interface); `ledgerCapturedStep` at `:209`; architecture overview insertion
at `:477`.

## Validation (step 5)

### Testing strategy

| What to test                                                                                         | Test type   | Location                                                                                                       | Why this type                                                                                              |
| ---------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| token derivation (`nodeId` / `n<ordinal>`), trailer parse, evidence decision, advisory short-circuit | unit        | `server/tests/unit/execution/delegation/handoff-contract.test.ts`                                              | pure functions; every branch reachable without a pipeline                                                  |
| Claude handoff renders `run_in_background: false`; other strategies unchanged                        | unit        | `server/tests/unit/execution/delegation/strategy.test.ts`                                                      | string rendering, six strategies                                                                           |
| brief ends with `HANDOFF RESULT` + `node: <token>`; gates block kept                                 | unit        | existing brief tests                                                                                           | render-only                                                                                                |
| `resolveDelegationSkipped` for ungated delegated steps                                               | unit        | `server/tests/unit/execution/delegation/acknowledgment.test.ts`                                                | predicate                                                                                                  |
| positive control: `required` + prose-only resume → refused naming token                              | integration | `server/tests/integration/chain/delegation-handoff-evidence.integration.test.ts`                               | must run the real pipeline against `node:sqlite`; a unit test cannot show the refusal reaches the response |
| accept path: fake-worker reply → captured, chain advances                                            | integration | same file                                                                                                      | same                                                                                                       |
| advisory path: prose-only → captured, `delegation_skipped = 1`                                       | integration | same file + `delegation-skipped.integration.test.ts`                                                           | column write is the observable                                                                             |
| legacy chain without node ids uses `n<ordinal>` at both sites                                        | integration | `delegated-resume-brief.integration.test.ts`                                                                   | both sites in one run                                                                                      |
| ownership row ↔ `module.yaml` `owns`                                                                 | validator   | `npm run validate:domain-ownership`                                                                            | checked contract                                                                                           |
| Tier 1–3 end to end in a client                                                                      | live drive  | Claude Code: `>>reference_demo ==> >>reference_demo` with `evidence: required`, then with the worker's trailer | green gates do not show the client flow                                                                    |

### Done criteria

| Criterion              | Validation                                                                                                                  | Pass condition                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| positive control fires | integration suite, `required` mode                                                                                          | refusal response names the node token and the missing line   |
| accept path advances   | integration suite                                                                                                           | `chain_runs.current_node_id` moves to the next node          |
| advisory records       | `execution_records.delegation_skipped`                                                                                      | 1 for prose-only, 0 for trailer, NULL only for non-delegated |
| foreground pinned      | strategy unit test                                                                                                          | Claude block contains `run_in_background: false`             |
| complexity budget held | `sonarjs/cognitive-complexity`                                                                                              | `execute` ≤ 15, `captureStep` = 14                           |
| ownership contract     | `npm run validate:domain-ownership`                                                                                         | exit 0 with the new row                                      |
| full suite             | `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:all && npm run validate:arch` | exit 0                                                       |
| docs current           | `docs/concepts/chains-lifecycle.md`, `docs/architecture/overview.md`, `CHANGELOG.md`                                        | describe the trailer, the config key, the layering           |
| live drive             | Claude Code with the built `dist/`                                                                                          | refusal seen, then acceptance seen                           |

### Documentation

| Doc                                     | Update needed                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `docs/concepts/chains-lifecycle.md`     | why delegate (D1); `HANDOFF RESULT` trailer; `execution.delegation.evidence`; foreground pin |
| `docs/architecture/overview.md`         | enforcement layering under Execution Domain                                                  |
| `CHANGELOG.md`                          | Added entry (above)                                                                          |
| `CLAUDE.md`                             | Domain Ownership Matrix row (with `module.yaml`)                                             |
| `hooks/delegation-enforce.py` docstring | server evidence is the floor                                                                 |

### Risks

| Risk                                                              | Impact                                | Mitigation                                                                   | Rollback                                             |
| ----------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| false refusal blocks every delegated chain                        | high                                  | default `advisory`; positive control AND accept path in CI                   | set `evidence: advisory`; no schema change to revert |
| parent pastes the worker reply without the trailer                | medium (advisory) / blocks (required) | brief's last section is the contract; refusal message names the missing line | same                                                 |
| `formatToolCall` signature ripples through six strategies + tests | medium                                | `typecheck:tests:ratchet` before commit                                      | revert Tier 1 commit                                 |
| `delegation_skipped` semantics widen (ungated steps now 0/1)      | low                                   | `table-contracts.ts` comment updated in the same commit                      | none needed; append-only log                         |
| Tier 4 schema bump drops ephemeral tables                         | low (documented posture)              | separate PR, after one release of Tier 1–3 measurement                       | revert the bump                                      |

### Release

- commit convention: `feat(execution): the brief's node token is the evidence a delegated step needs to resume`
- scope: `execution` (Tier 1–2), `docs` (Tier 3), `chains` (Tier 4)

### Growth capture

- [ ] `/knowledge-capture`: "the wait is the client's tool call" — a request/response server
      cannot wait; enforce the handshake at the boundary it owns (render ↔ accept)
- [ ] memory: update `reference_chain_execution_internals` with the trailer contract once landed
- [ ] skill: none until a second sighting

## Implementation notes

Deviations and ruling rationales: `plans/delegation-handoff-contract-2026-09-07-implementation-notes.md`.
