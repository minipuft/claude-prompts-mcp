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
- **success_signal**: with `execution.delegation.evidence: required`, resuming a `==>` node with
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
default `advisory` (owner ruling: "B when configured"). `advisory` = parse + record
`delegation_skipped`; `required` = refuse the resume.

## Tier 1 — Contract module, brief token, foreground pin

| #   | St  | File                                                                                                      | Change                                                                                                                                                                                                                            | ~Lines | Depends       | Verify                                                                                                                               | Justification                                                                   |
| --- | --- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1.1 | ☐   | `server/src/engine/execution/delegation/handoff-contract.ts` (NEW)                                        | `HANDOFF_RESULT_HEADING`, `HandoffEvidenceMode`, `resolveHandoffEvidenceMode`, `handoffNodeToken`, `ParsedHandoffTrailer`, `parseHandoffTrailer`, `HandoffEvidence`, `resolveHandoffEvidence`, `buildHandoffResultSection` — pure | ~120   | —             | `tests/unit/execution/delegation/handoff-contract.test.ts`: token both branches; parse with/without heading; mismatch; advisory → ok | one module both render and capture import, so the token cannot be derived twice |
| 1.2 | ☐   | `server/src/engine/execution/delegation/types.ts:12`                                                      | `DelegationPayload` += `readonly nodeToken: string; readonly mode: 'blocking' \| 'detached'`                                                                                                                                      | ~6     | 1.1           | `npm run typecheck` surfaces every construction site                                                                                 | payload is the only channel from executor to strategy                           |
| 1.3 | ☐   | `server/src/engine/execution/delegation/brief.ts:86,138`                                                  | `buildResultContractSection(token, hasGates)` delegates to `buildHandoffResultSection`; `BriefBodyInputs` += `nodeToken`                                                                                                          | ~20    | 1.1           | existing brief tests + new assertion: brief contains `node: <token>` as the last section                                             | contract closes the brief (section order is part of the contract)               |
| 1.4 | ☐   | `server/src/engine/execution/operators/chain-operator-executor.ts:573,878` + `delegation/renderer.ts:116` | both payload sites set `nodeToken: handoffNodeToken(step)` and `mode: 'blocking'`                                                                                                                                                 | ~12    | 1.2           | `delegated-resume-brief.integration.test.ts` asserts the token line for a chain with node ids and one without (`n2`)                 | verify-paths found two construction sites, not one                              |
| 1.5 | ☐   | `server/src/engine/execution/delegation/strategy.ts:18,132,164,185,…`                                     | `formatToolCall(agentType, model, mode)`; Claude renders `• run_in_background: false` when `mode === 'blocking'`; other 5 strategies accept and ignore                                                                            | ~20    | 1.2           | `tests/unit/execution/delegation/strategy.test.ts`: Claude block has the line; others byte-identical to before                       | this harness spawns in the background by default; the pin is one rendered line  |
| 1.6 | ☐   | tests named in 1.1, 1.3, 1.4, 1.5                                                                         | write/extend                                                                                                                                                                                                                      | ~150   | 1.3, 1.4, 1.5 | `npm test -- delegation`                                                                                                             | —                                                                               |

Tier 1 gate: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm test -- delegation`

## Tier 2 — Evidence at resume

| #   | St  | File                                                                                                                                            | Change                                                                                                                                                                                                                                                                                                                     | ~Lines | Depends  | Verify                                                                                                  | Justification                                                                       |
| --- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 2.1 | ☐   | `server/src/shared/types/core-config.ts:163` (+ `cli-shared/config-input-validator.ts` if it enumerates `execution` keys — OQ3)                 | `ExecutionConfig` += `delegation?: { evidence?: HandoffEvidenceMode }`; NOT the legacy `judge` at :605                                                                                                                                                                                                                     | ~10    | —        | typecheck; config validator test if touched                                                             | mirrors `execution.judge` placement                                                 |
| 2.2 | ☐   | `server/src/engine/execution/delegation/acknowledgment.ts:37`                                                                                   | `resolveDelegationSkipped({ delegated, capturedResponse, expectedToken })` reads `parseHandoffTrailer`; `undefined` only when not delegated                                                                                                                                                                                | ~15    | 1.1      | unit: ungated delegated reply without token → `true`; with token → `false`; not delegated → `undefined` | in-place upgrade closes the ungated blind spot with the same column                 |
| 2.3 | ☐   | `server/src/engine/execution/capture/step-capture-service.ts:209-246`                                                                           | `ledgerCapturedStep` passes `expectedToken: handoffNodeToken(step ?? { stepNumber: target.ordinal })`                                                                                                                                                                                                                      | ~8     | 2.2      | `delegation-skipped.integration.test.ts` updated; sonarjs `captureStep` still 14                        | no branch added to `captureStep`                                                    |
| 2.4 | ☐   | `server/src/engine/execution/pipeline/stages/16-response-capture-stage.ts:100,130`                                                              | new private `runHandoffEvidencePhase(context, session, currentNodeIdAtStart)`: mode from config (OQ1), `resolveHandoffEvidence`, on `missing` → `context.setResponse(buildErrorResponse('❌ Delegated node <token>: <missing> …'))`, return false; called in `execute` before `runUnknownsPhase`                           | ~35    | 2.1, 2.2 | sonarjs `execute` = 14; integration positive control in 2.7                                             | refusal must precede every mutation; sibling of the three existing refusals         |
| 2.5 | ☐   | `server/src/infra/database/table-contracts.ts:382`                                                                                              | comment: `delegation_skipped` bound for every delegated step (token presence), NULL only for non-delegated                                                                                                                                                                                                                 | ~4     | 2.2      | `validate:all` table-contract check                                                                     | SSOT comment must match the writer                                                  |
| 2.6 | ☐   | `server/src/engine/execution/module.yaml:7` + `CLAUDE.md:166`                                                                                   | owns row "Delegation handoff evidence" → `resolveHandoffEvidence` (`execution/delegation/handoff-contract.ts`); stage may only call it                                                                                                                                                                                     | ~6     | 1.1      | `npm run validate:domain-ownership`                                                                     | matrix is a checked contract (PR #266)                                              |
| 2.7 | ☐   | `server/tests/helpers/delegation/fake-worker.ts` (NEW) + `server/tests/integration/chain/delegation-handoff-evidence.integration.test.ts` (NEW) | `runFakeWorker(brief)` reads token + gates from the brief text, returns prose + trailer. Tests: positive control (`required`, prose-only → refused, message names token); accept path (fake worker reply → captured, advances); advisory path (prose-only → captured, `delegation_skipped=1`); legacy chain → `n<ordinal>` | ~220   | 2.4      | `npm run test:integration -- delegation-handoff-evidence`                                               | no delegation test can observe a spawn; the fake worker is the conformance standard |

Tier 2 gate: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:all && npm run validate:arch && npm run validate:domain-ownership`

## Tier 3 — Docs, changelog, ledger writeback

| #   | St  | File                                         | Change                                                                                                                             | ~Lines | Depends | Verify                                             | Justification                         |
| --- | --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | -------------------------------------------------- | ------------------------------------- |
| 3.1 | ☐   | `docs/concepts/chains-lifecycle.md:327-383`  | "Why delegate" paragraph (D1); `HANDOFF RESULT` trailer under The Execution Brief; `execution.delegation.evidence`; foreground pin | ~40    | —       | `npm --prefix server run format` check; prose read | authors choose `==>` and need the why |
| 3.2 | ☐   | `docs/architecture/overview.md:477`          | enforcement layering: server floor (brief + resume check), client hooks tighten, opencode has none                                 | ~15    | —       | format check                                       | contributor-facing layering (D3)      |
| 3.3 | ☐   | `CHANGELOG.md` [Unreleased]                  | Added entry (below)                                                                                                                | ~6     | —       | `validate:changelog` (in `validate:all`)           | consumer-facing                       |
| 3.4 | ☐   | `hooks/delegation-enforce.py:1-13` docstring | server-side evidence is the floor; this hook tightens for Claude Code only                                                         | ~4     | —       | `validate:python`                                  | hooks tighten only                    |
| 3.5 | ☐   | `plans/delegation-handoff-2026-09-07.md`     | O1–O4 → rulings D8–D11 (defaults accepted); O5 (default flip to `required`) opened with falsifier                                  | ~20    | —       | plan frontmatter check                             | ledger is the decision record         |

Tier 3 gate: `scripts/classify-validation-scope.js` → full (mixed change); pre-push runs the full route.

## Tier 4 — Detached mode (after Tiers 1–3 merge and one release measures `delegation_skipped`)

| #   | St  | File                                                                                             | Change                                                                                                                             | ~Lines | Depends  | Verify                                                       | Justification                                     |
| --- | --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ------------------------------------------------------------ | ------------------------------------------------- |
| 4.1 | ☐   | `modules/workflow-ir/node-schema.ts:196`, `operators/types.ts:39`, `workflow-ir/compiler.ts:158` | `await?: 'node' \| 'run'` declared, carried, passed through                                                                        | ~20    | —        | IR schema snapshot regenerated; `typecheck:tests:ratchet`    | YAML/IR field first (non-goal: symbolic syntax)   |
| 4.2 | ☐   | `infra/database/sqlite-engine.ts:236,872` + `table-contracts.ts`                                 | `SCHEMA_VERSION` 27 → 28; `chain_run_nodes` += `await_mode TEXT`, `reported_at INTEGER`                                            | ~30    | 4.1      | schema tests; ephemeral tables drop/recreate                 | detached needs a node lifecycle the run can query |
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

| id  | status | precedes | default                                                                                                                                         | alternative                               |
| --- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| OQ1 | OPEN   | 2.4      | `HandoffEvidenceMode` resolved once at `PipelineBuilder` from config and injected into stage 16's constructor                                   | stage reads `context` config at call time |
| OQ2 | OPEN   | —        | default stays `advisory` this release; flips to `required` after one release with the fake worker in CI and no false-refusal report (ledger O5) | ship `required` now                       |
| OQ3 | OPEN   | 2.1      | if `cli-shared/config-input-validator.ts` enumerates `execution` keys, add `delegation.evidence`; else no change                                | leave validator untouched                 |
| OQ4 | OPEN   | 4.1      | no per-run override of evidence mode via workflow `budget`                                                                                      | `budget.delegationEvidence`               |

## Changelog entry

- **Added**: Delegated chain steps (`==>`) now render a `HANDOFF RESULT` trailer contract in the
  execution brief — the worker echoes the node token back with its work. With
  `execution.delegation.evidence: required` the server refuses a resume for a delegated step that
  arrives without it, naming the step and the missing line; the default `advisory` records
  `delegation_skipped` for every delegated step, gated or not. Claude Code handoffs now pin
  `run_in_background: false`.
