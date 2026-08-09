---
title: "P1 — Unknowns Ledger: Implementation Plan"
date: 2026-08-09
status: backlog
tags: []
---

# P1 — Unknowns Ledger: Implementation Plan

Master plan: `plans/adaptive-chain-runtime-2026-08-09.md` (Phase P1). Produced by `>>implementation_plan` chain `chain-implementation_plan#2`, 2026-08-09.
Location deviation: chain template targets `~/.claude/plans/`; this repo's convention (master-plan execution protocol) is in-repo `plans/` — kept in-repo.

**Status**: PLANNED — implementation not started. Create `implementation-notes.md` beside this file before the first edit.

---

## Phase 1 — Discovery (summary)

- Sibling pattern: the gate_verdict pipeline (schema-validated param → GateVerdictProcessor → session state → response section). No competing unknowns concept exists (`rg "unknown|open_question|assumption"` — incidental hits only).
- Seam: `user_response` first touched at `16-response-capture-stage.ts:97`; capture chain: stage 16 → GateVerdictProcessor → StepCaptureService.captureStep → ChainSessionManager.updateSessionState (:829) → persistStepResult (:1019) → TextReferenceStore + runRegistry.save.
- Context assembly: `getChainContext` (manager.ts:1065) contextData → stage 18 (18-execution-stage.ts:137-166) → ChainOperatorExecutor sections; 13 response sections enumerated; injection has exactly 3 types (system-prompt, gate-guidance, style-guidance).
- Path corrections vs early notes: roots are `src/engine/execution/` and `src/engine/gates/`.
- Cleanup candidate found (NOT P1 scope): `context.state.session.chainContext` is write-only — writers at `16-response-capture-stage.ts:64` and `step-capture-service.ts:285`, zero readers.

## Phase 2 — Design decisions

| Decision          | Chosen                                                                               | Rejected                                  | Why                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Transport         | New optional `prompt_engine` param `observations` (schema-validated)                 | Fenced-block parsing from user_response   | Structured cannot be malformed; regex verdict branch is the project's documented retiring mistake; union addition is non-breaking |
| Storage           | `ChainSession.unknownsLedger` → runRegistry → SQLite                                 | execution_records extension; new table    | Ledger IS run state (pendingGateReview precedent); zero table-gate changes; rides P3 registry retirement (master D5)              |
| Processing owner  | New `UnknownObservationProcessor` in `engine/execution/capture/`                     | Extend StepCaptureService; gates services | Capture ≠ ledger mutation; mirrors GateVerdictProcessor sibling precedent; chain-run domain, not gate domain                      |
| Context surfacing | `unknowns_ledger` key in getChainContext + section beside buildOriginalIntentSection | 4th injection type                        | Ledger is task state like previous_step_results, not guidance; avoids the 8-level injection hierarchy; P5 revisits                |
| Lifecycle v1      | states `active\|resolved` + `resolution: answered\|irrelevant`                       | candidate, contradicted states            | No promotion decider / contradiction detection in v1; two-state machine keeps P4 skip path expressible                            |

Pre-flight: 0 failures, no compound. Constraints: model emits typed observations only (D2); no numeric scoring fields (D4); persistence awaited + throwing; transport parity (state in SQLite only).

### Interfaces

```typescript
// shared/types/chain-session.ts
interface UnknownObservation {
  type: "unknown_discovered" | "unknown_resolved";
  id: string; // stable kebab-case slug within run
  statement: string;
  resolution?: "answered" | "irrelevant"; // required iff type=unknown_resolved
  blocking?: boolean; // discovered-only; default false
}
interface UnknownLedgerEntry {
  id: string;
  statement: string;
  state: "active" | "resolved";
  resolution?: "answered" | "irrelevant";
  resolutionStatement?: string;
  blocking: boolean;
  discoveredAtStep: number;
  resolvedAtStep?: number;
}
// ChainSession gains: unknownsLedger?: UnknownLedgerEntry[]
// ChainSessionService gains:
//   applyUnknownObservations(sessionId, stepNumber, obs: UnknownObservation[]): Promise<UnknownLedgerEntry[]>
//   — validates transitions (resolve requires existing active id; re-discover = idempotent statement
//     update), mutates, awaits persist, throws. Invalid transition → tool-result validation error.
```

## Phase 2.5 — Verification (all anchors line-verified 2026-08-09)

Zero drift across 10 targets; no shims. Corrections Phase 3 carries:

1. `ChainSessionService` is at `chain-session.ts:153` (not :171).
2. `tooling/contracts/prompt-engine.json:108` resume-mode `parameters` array is a required additional edit.
   Fields confirmed unclaimed: `observations` (schema + contracts, rg zero matches), `unknownsLedger` (chain-session.ts).

## Phase 3 — Implementation table

### Tier 1: Types + contract surface — gate: `npm run typecheck && npm run validate:contracts`

| #   | File                                          | Change                                                                                                                                     | ~Lines | Depends | Verify                                   |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------- | ---------------------------------------- |
| 1   | src/shared/types/chain-session.ts             | UnknownObservation + UnknownLedgerEntry; `unknownsLedger?` on ChainSession (:76); `applyUnknownObservations` on ChainSessionService (:153) | +45    | —       | tsc; single definition site              |
| 2   | src/mcp/tools/schemas/prompt-engine.schema.ts | `observations: z.array(discriminatedUnion).optional()` + PARAM_DEFAULTS description (pattern: gate_verdict :251-260)                       | +30    | 1       | typecheck                                |
| 3   | tooling/contracts/prompt-engine.json          | Param entry AND resume-mode parameters array (:108)                                                                                        | +15    | —       | generate:contracts && validate:contracts |

### Tier 2: Request plumbing — gate: `npm run typecheck`

| 4 | src/mcp/tools/prompt-engine/core/prompt-executor.ts | Include args.observations in McpToolRequest build (:437-447 region) | +5 | 1,2 | rg single build site |
| 5 | McpToolRequest type (pin via `rg "interface McpToolRequest" src/`) | `observations?: UnknownObservation[]` | +5 | 1 | typecheck |
| 6 | stages/01-request-normalization-stage.ts | Confirm validator passes param through (expected no-op; allowance only if it rejects unknown keys) | +0-5 | 5 | integration reaches stage 16 |

### Tier 3: Ledger service + persistence — gate: `npm run typecheck && npm test -- --testPathPattern="unknown"`

| 7 | **NEW** src/engine/execution/capture/unknown-observation-processor.ts | Processor class: pure transition validation + manager call; invalid → tool-result error | +120 | 1 | unit transition matrix |
| 8 | src/modules/chains/manager.ts | Implement applyUnknownObservations (mutate → await saveSessions → throw; posture of updateSessionState :829); add `unknowns_ledger` in getChainContext (:1118-1139, non-empty only) | +60 | 1 | persistence + awaited-throw tests |

### Tier 4: Pipeline wiring — gate: `npm run typecheck && npm run build && npm run verify:mcp`

| 9 | stages/16-response-capture-stage.ts | After verdict processing (~:99-130): read observations → processor.apply(); stage stays thin | +15 | 7,8 | integration: request → ledger entry |
| 10 | Processor construction site (pin via `rg "new StepCaptureService" src/`) | DI: processor with ChainSessionService + logger into stage 16 | +10 | 7 | clean boot |

### Tier 5: Context rendering — gate: `npm run typecheck && npm run lint:ratchet`

| 11 | src/engine/execution/operators/chain-operator-executor.ts | `buildUnknownsSection` beside buildOriginalIntentSection (:684); called at renderNormalStep (~~:396) + renderGateReviewStep (~~:144); active-blocking first, resolved compact | +45 | 8 | response text contains/omits section correctly |

### Tier 6: Tests, docs, changelog — final gate below

| 12 | **NEW** tests/integration/execution/unknown-ledger-lifecycle.test.ts | Full success-signal drive + invalid-resolve error + persistence across re-read | +180 | 9,11 | test:integration; fails if section removed |
| 13 | tests/e2e/mcp-server-smoke.test.ts | Assert observations advertised in prompt_engine inputSchema | +10 | 3 | test:ci |
| 14 | docs/reference/mcp-tools.md + docs/concepts/chains-lifecycle.md | Param + lifecycle + context section | +30 | 11 | docs match driven behavior |
| 15 | CHANGELOG.md | Unreleased → Added | +2 | 14 | changelog lint |

**Final gate**: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci && npm run validate:arch` — then drive the new path live: `verify:mcp` + one real chain run submitting observations (surface-check ≠ end-to-end; verify:mcp has passed structurally-dead builds).

**New-file justifications**: processor — capture and ledger mutation are different responsibilities; extending StepCaptureService conflates domains and grows toward the cognitive gate; GateVerdictProcessor sibling precedent. Lifecycle test — no existing file owns chain-context lifecycle assertions; smoke proves surface only.

## Phase 4-6 — Validation & completion

### Testing strategy

| What to test                                                                       | Type        | Location                                      | Why                                |
| ---------------------------------------------------------------------------------- | ----------- | --------------------------------------------- | ---------------------------------- |
| Transition matrix (discover / resolve / missing-id / idempotent re-discover / cap) | unit        | beside processor tests (pin dir at edit time) | Pure functions, exhaustive cheaply |
| Ledger persists + awaited-throw on persist failure                                 | integration | unknown-ledger-lifecycle.test.ts              | Crosses manager + SQLite boundary  |
| Context section rendered when non-empty, absent when empty                         | integration | same file                                     | Behavior at the render boundary    |
| Param advertised in tool schema union                                              | e2e         | mcp-server-smoke.test.ts                      | Public API surface                 |
| Full lifecycle through a real server                                               | e2e manual  | verify:mcp + live chain run                   | End-to-end proof, not exit codes   |

### Done criteria

| Criterion                  | Validation                                                                             | Pass condition                    |
| -------------------------- | -------------------------------------------------------------------------------------- | --------------------------------- |
| Success signal (master P1) | Live drive: step1 discover → step2 shows active → step3 resolve → step4 shows resolved | Observed in returned context text |
| Full suite green           | typecheck, lint:ratchet, typecheck:tests:ratchet, test:ci, validate:arch               | All exit 0                        |
| SQLite gates untouched     | validate:table-contracts && validate:no-phantom-columns                                | Green with zero contract edits    |
| Docs lockstep              | mcp-tools.md + chains-lifecycle.md updated same PR                                     | Reviewed against driven behavior  |
| Scope check                | `git diff main --stat`                                                                 | No files outside plan table       |

### Risks

| Risk                                            | Impact                                                | Mitigation                                                                                                     | Rollback                        |
| ----------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Validator (stage 01) rejects unknown param keys | Param never reaches stage 16                          | Row 6 integration check; explicit allowance if needed                                                          | Trivial — allowance is one line |
| Unbounded ledger growth inflates session blob   | Serialization cost on every saveSessions              | Hard cap 200 entries/run; observations beyond cap → validation error (explicit backstop, no silent truncation) | Cap constant                    |
| HTTP transport parity                           | Mutation on registered instance would no-op over HTTP | All state via ChainSessionService → SQLite; no McpServer-resident state                                        | N/A by design                   |
| generate:contracts forgotten after JSON edit    | Stale _generated drift                                | Tier 1 gate + pre-commit contract regen                                                                        | Re-run generator                |
| P3 (node-ID rework) reshapes session storage    | Ledger re-homed later                                 | Ledger lives inside session state precisely so P3 migrates it wholesale (master D5)                            | None needed                     |

### Release

- commit_convention: `feat(chains): add per-run unknowns ledger via prompt_engine observations param`
- scope: `chains`
- changelog: Added — "prompt_engine accepts an optional `observations` parameter — chain steps declare typed unknowns (discovered/resolved) that accumulate in a per-run ledger and surface in subsequent step context."

## Execution Dispatch (subagent split — read this on resume)

**Preconditions (operator, before any P1 edit)**: (1) restart/reconnect the MCP server; (2) apply the staged verification template (`plans/adaptive-chain-runtime-p0-staged-verification-template.md`, body after the `<!-- TEMPLATE BODY BEGINS -->` marker) via `resource_manager` update, then delete the staged file; (3) optional: delete the three orphaned `sub_agent_functionality_chain` nested prompts. Then create `implementation-notes.md` beside this plan (main thread, BEFORE the first edit).

**Model**: workers implement, main thread judges. P1 does NOT re-run `>>implementation_plan` — this file IS the plan; workers execute it directly. Tiers run **sequentially** (dependency-ordered, one live tree — no worktrees needed); rows within a tier may share one agent.

| Work                                                                                                                              | Agent                                                  | Why this tier                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Tier 1 (rows 1-3: types, Zod schema, contract JSON + resume-mode array)                                                           | sonnet                                                 | Bounded output, pattern-copy from gate_verdict precedent; contract workflow spelled out in mcp-contracts.md  |
| Tier 2 (rows 4-6: plumbing + validator check)                                                                                     | sonnet (same agent may continue)                       | Small; includes pinning the two locate-at-edit anchors via rg                                                |
| Tier 3 (rows 7-8: processor + manager persistence)                                                                                | **opus**                                               | Decision-bearing: transition validation semantics, awaited-throw persistence posture, 200-entry cap behavior |
| Tier 4 (rows 9-10: stage-16 wiring + DI)                                                                                          | opus (continue Tier-3 agent — interlocking interfaces) | Touches the capture seam                                                                                     |
| Tier 5 (row 11: context section rendering)                                                                                        | sonnet                                                 | Section pattern verified at chain-operator-executor.ts:684-709                                               |
| Tier 6 (rows 12-15: lifecycle test, smoke assertion, docs, changelog)                                                             | sonnet                                                 | Success signal + test shape fully specified above                                                            |
| Tier-gate verification between tiers (rg/wc spot-checks of agent claims, per `feedback_haiku_deepest_layer_delegation` standards) | haiku                                                  | Mechanical; consume by content keys, not labels                                                              |
| Gate verdicts, tier acceptance, final live drive (real chain run submitting observations), scope check (`git diff main --stat`)   | **main thread**                                        | Judgment never delegates                                                                                     |

**Worker brief requirements** (per captured standards): absolute paths; exact anchors from this file; explicit output contract (diff summary + verbatim validation output); workers run their tier's gate command before reporting; deviations reported, not silently absorbed — main thread logs them to `implementation-notes.md`.

### Growth capture (session 2026-08-09)

- [x] Haiku deepest-layer delegation standards — captured to memory (two clean runs this session; see memory `feedback_haiku_deepest_layer_delegation`)
- [x] Observed defect shape: haiku swapped section labels (TASK1/TASK3) while content stayed accurate → consume haiku output by content keys (file paths), never by abstract task labels
- [ ] Cleanup candidate for a debt sweep: write-only `context.state.session.chainContext` (2 writers, 0 readers)
