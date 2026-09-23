---
title: "Primitive rework: review entity, one gate converter, contract binding"
date: 2026-09-23
status: active
tags: [gates, chains, execution, mcp-tools, scripts, tests, docs]
ledger: plans/technical-debt/primitive-rework-2026-09-23-implementation-notes.md
publish: push+merge (2026-09-23 · owner ruling R2 · every slice of this plan, one PR per slice, on a green full suite and a clean merge state; breaking changes and force pushes still stop for the owner)
---

# Primitive rework: review entity, one gate converter, contract binding

Two dispatches on 2026-09-22 opened 33 rows from 7 fixes. Grouped by the primitive they point at
rather than the file they landed in, they fall on five seams: a field with a writer and no reader;
scope held ambiently; a review with no state machine; cross-stage implicit timing; two answers to
one question. Scope is already gated (#368) and the duplicates are deletion work. This plan reworks
the three primitives that own the rest, each closed by a gate that fails on a planted instance, and
then runs the same five-seam classification over the other modules. Rulings, deviations and probe
output live in the ledger.

## Now

_Written 2026-09-23._ Plan authored from the `>>implementation_plan` chain (Steps 1–5 below).
Nothing dispatched. Row 4.8 of the delegation plan (`feat/delegation-detached-mode` successor
`feat/detached-review-at-report`, worker `dr`) is in flight and is the seed of Tier 3: Tier 3 does
not start until it merges. Tiers 1 and 2 can start now, in parallel. Owner rulings R2–R4 (2026-09-23)
settled the `publish:` field, OQ1, OQ3 and OQ4; Tiers 1, 2 and row 4.1 are dispatched.

## Scope

- **Objective:** one review record keyed by node with an explicit phase and its own attempt
  counter; one gate-definition converter; one parameter-reads check across the three tools; a
  per-module five-seam table that ends in rows or kills.
- **Success signal:** (a) `rg pendingGateReview src` matches only the stamped projection until it
  is deleted; every verdict path resolves its review through `resolveReviewTarget`; a review opened
  on node N while the run stands on N+1 is answered on N under a driven test. (b)
  `KNOWN_PROVIDER_GAPS` is deleted and a planted extra gate field survives both load paths. (c) A
  planted declared-but-unread parameter on any of the three tools fails `validate:all` by name. (d)
  Every module in the analysis has a stamped row or a kill with a reason.
- **Non-goals:** a pipeline or stage-model rewrite; the symbolic command language; retiring the
  legacy string verdict (its own breaking change with its own measurement); the owner's `~/.claude`
  rename, P5.16 and P5.13; the tutorial and README arcs; downstream repos; changing rendered review
  text beyond what the phase requires.
- **Constraints:** planner edits plans only; about 350 source lines per slice; a design section in
  the ledger before source when a primitive changes; current-step review readers keep working during
  migration; no durable-table schema change (the review rides in the run's residual document, so no
  schema bump); `docs/guides/gates.md` untouched; breaking changes need an owner ruling; row 4.8 is
  the first slice of the review entity, not a duplicate.

## Discovery (Step 1)

Measured on `main` `1161853f`:

- **Seam 1, the review slot.** `pendingGateReview` has 61 references in 17 source files:
  `modules/chains/manager.ts` (15), `operators/chain-operator-executor.ts` (11),
  `gates/services/gate-verdict-processor.ts` (7), `shared/types/chain-session.ts` (4),
  `modules/chains/run-registry.ts` (4), `system-control/handlers/session-action-handler.ts` (3),
  and eleven files with one or two. Reviews are created in two places (stage 13 line 241 and
  `gate-enhancement-service.ts` line 638, both through `GateEnforcementAuthority.createReviewForStep`
  at line 352) and consumed by two verdict paths (`processDeferredVerdict` 297,
  `processPendingReviewVerdict` 364) that stage 16 calls (267, 350). Row 4.8's design (`2db5959e`)
  keeps the slot for the current step and adds a detached review keyed by node with a state machine;
  it names the unifying fact: the slot holds the review of the node the run stands on or just left,
  and `metadata.nodeId` already says which.
- **Seam 2, the converters.** `GateLoader.toLightweightGate` (`gate-loader.ts:284`) and
  `GateManagerProvider.toLightweight` (`gate-provider-adapter.ts:150`) are the two live converters;
  hot reload passes through since #372; `buildInlineGateDefinition` (`yaml-prompt-loader.ts:201`)
  is a third shape for inline gates. The parity test declares one stamped gap, `sourceRoot`
  (P4.140).
- **Seam 3, contract binding.** `validate-system-control-parameter-reads.js` (483 lines) defines a
  read as a property read off the argument object inside the dispatching case, followed into handler
  methods, with a hand-off to another service as the boundary. `resource_manager` has a per-action
  ownership map derived from the contract (#367); `prompt_engine` has no per-action model
  (`execution_hint` is read by nothing, P4.153).
- **Persistence.** There is no `pending_review_json` column: `run-registry.ts` serializes the review
  inside the run's residual document (lines 368–369, field map 505). Schema stays 31.
- **Modules for the analysis.** 28 `module.yaml` declarations; the named candidates are
  `engine/frameworks` (30 files), `modules/prompts` (17), `modules/chains` (3) plus `run-registry`,
  `modules/versioning` (12), `modules/skills-sync` (3), `cli-shared` (20) plus `cli/`,
  `infra/hooks` (2) plus the Python `hooks/`.

## Design (Step 2)

Pre-flight ran with zero failures (ledger §Pre-flight). Decisions:

| Decision                | Chosen                                                                             | Rejected                         | Why                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Review identity         | `nodeId` on the record, `run.reviews[nodeId]`                                      | position-derived at verdict time | a review outlives the position in three measured cases (phase guard while advancing, detached reports, final-step verdict) |
| Review lifecycle        | explicit `phase` + pure `advanceReview`                                            | booleans inferred per path       | four paths infer four different things today                                                                               |
| Migration of 17 readers | projection getter kept until reader count is 0, new writers refused by a validator | big-bang                         | bound and safety; the gate keeps the class closed while readers move                                                       |
| Row 4.8 relation        | its detached review becomes `reviews[nodeId]` with `kind:'detached'`               | parallel maps                    | one identity                                                                                                               |
| Attempt counter         | on the review only; `resolveAttemptCounter` reads it                               | session-level counter            | counters climbed past budget when the two disagreed (P4.164)                                                               |
| Converter               | one pure function; the inline shape is lifted first                                | provider delegates to loader     | peers, not a hierarchy; the parity test stays as guard                                                                     |
| Binding                 | one validator, three adapters                                                      | codegen of handler types         | codegen cannot see a field copied into an object the callee ignores, the measured instance                                 |
| Evolution analysis      | one analyst worker writes the table; the planner opens rows                        | analyst opens rows               | rows are planner-owned; the analyst measures                                                                               |

Interfaces:

```ts
interface GateReview {
  nodeId: string;
  kind: "gate" | "structural" | "detached";
  phase: "awaiting-verdict" | "awaiting-replacement" | "exhausted";
  gateIds: string[];
  prompts: GateReviewPrompt[];
  combinedPrompt: string;
  createdAt: number;
  attemptCount: number;
  maxAttempts: number;
  retryHints?: string[];
  previousResponse?: string;
  checkResults?: ReadonlyArray<GateCheckResult>;
  gateTiers?: Readonly<Record<string, PendingGateTier>>;
  history?: GateReviewHistoryEntry[];
  metadata?: Record<string, unknown>;
}
type ReviewEvent =
  | { type: "verdict"; verdict: ParsedGateVerdict }
  | { type: "replacement-report" }
  | { type: "gate_action"; action: "retry" | "skip" | "abort" };
function advanceReview(
  review: GateReview,
  event: ReviewEvent,
  enforcement: EnforcementMode,
): {
  review: GateReview | null;
  outcome: "passed" | "failed" | "exhausted" | "cleared" | "aborted";
};
function resolveReviewTarget(input: {
  reviews: Record<string, GateReview>;
  currentNodeId: string | null;
  trailerNodeId?: string;
}):
  | { kind: "review"; nodeId: string }
  | { kind: "refuse"; reason: "unknown-node" | "no-review" };
// ChainSession.reviews: Record<string, GateReview>; pendingGateReview: projection of reviews[currentNodeId], stamped
function toGateDefinition(
  loaded: LoadedGateDefinition,
  opts: { sourceRoot?: string },
): LightweightGateDefinition;
// validate-tool-parameter-reads.js: adapters { system_control, resource_manager, prompt_engine }
//   each yielding { command, parameters, entry: { file, symbol }, boundary: (call) => boolean }
```

## Verified paths (Step 3)

Every design path exists and none is a shim (ledger §Verify-Paths carries the raw output). Symbol
lines: `PendingGateReview` 430; `createReviewForStep` 352; `recordOutcome` 455;
`processDeferredVerdict` 297; `processPendingReviewVerdict` 364; `handleFailedVerdict` 546; stage 16
calls 267/350, `runResumeAdmission` 417; stage 13 creation 241; `resolveDetachedReport` 127;
`toLightweightGate` 284; `toLightweight` 150; `buildInlineGateDefinition` 201;
`KNOWN_PROVIDER_GAPS` 36/103; `LightweightGateDefinition` 194, `enforcementMode` 213, `sourceRoot`
262; `composeStructuralReview` 45; `resolveEnforcementMode` 45; `transitionRunStatus` 955. One
assumption corrected: no `pending_review_json` column exists; the review map persists in the
residual document. `chain-operator-executor.ts` is at its `max-lines` ceiling (1002/1000 counted),
so its slot reads move out rather than grow.

## Plan (Step 4)

### Tier 1 — One gate-definition converter (seam 2)

| #   | St                                                                                                                                       | File                                                                                                                  | Change                                                                                                                                                                                      | ~Lines | Depends | Verify                                                                                              | Justification                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | --------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1.1 | ☐ (as of 2026-09-23 · flips when `GateLoader.toLightweightGate` and `GateManagerProvider.toLightweight` both call one exported function) | NEW `server/src/engine/gates/core/gate-definition-converter.ts`; `gate-loader.ts:284`; `gate-provider-adapter.ts:150` | `toGateDefinition(loaded, {sourceRoot})` carries every declared field incl. `sourceRoot`, `evaluation`, `enforcementMode`, `blockResponseOnFail`; both privates become one-line delegations | ~90    | —       | `rg -n "toGateDefinition" src` = 3 call sites; unit test: a planted extra field survives both paths | one function, one truth             |
| 1.2 | ☐ (as of 2026-09-23 · flips when the inline builder lifts its object into `LoadedGateDefinition` and calls the converter)                | `yaml-prompt-loader.ts:201`                                                                                           | `buildInlineGateDefinition` lifts the inline shape then calls `toGateDefinition`; inline-only keys documented at the lift                                                                   | ~40    | 1.1     | prompt loader tests; an inline gate with `enforcement_mode` resolves it (twin without)              | third converter retired             |
| 1.3 | ☐ (as of 2026-09-23 · flips when `KNOWN_PROVIDER_GAPS` is deleted)                                                                       | `tests/unit/gates/registry/gate-provider-converter-parity.test.ts:36,103`                                             | delete the gap list; assert both providers produce byte-equal definitions for every bundled gate and a planted-extra-key fixture; keep the positive control                                 | ~30    | 1.1     | test red on a provider that re-implements the map (mutation)                                        | guard becomes single-implementation |
| 1.4 | ☐ (as of 2026-09-23 · flips when a workspace gate's relative `shell_verify` script runs from the gate's directory on the live path)      | `tests/e2e` (gate `sourceRoot` drive); CHANGELOG                                                                      | e2e twin: relative script beside `gate.yaml` resolves under the provider path; one `### Fixed` bullet                                                                                       | ~60    | 1.1     | driven e2e; mutation drops `sourceRoot` → red                                                       | P4.140 receipt                      |

Tier 1 gate: `npm run typecheck && npm run lint:ratchet && jest tests/unit/gates tests/unit/prompts && npm run validate:all`

### Tier 2 — Contract-to-handler binding for all three tools (seam 3)

| #   | St                                                                                                                             | File                                                                                                                                                      | Change                                                                                                                                                                            | ~Lines | Depends  | Verify                                                                                                               | Justification                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 2.1 | ☐ (as of 2026-09-23 · flips when the script takes a tool adapter and the `system_control` report is byte-identical to today's) | `scripts/validate-system-control-parameter-reads.js` → RENAME `scripts/validate-tool-parameter-reads.js`; `package.json`; `run-validation-suite.js` SUITE | read model (lines 68–161) unchanged; `adapters = {system_control, resource_manager, prompt_engine}` each yielding `{command, parameters, entry, boundary}`; self-test per adapter | ~120   | —        | `validate-suite-membership`; old name absent from `package.json`; `system_control` report unchanged (88 reads)       | rename, not a new script               |
| 2.2 | ☐ (as of 2026-09-23 · flips when a planted declared-but-unread `resource_manager` parameter fails by name)                     | `scripts/validate-tool-parameter-reads.js`; `resource-manager/core/parameter-ownership.ts:149–155` (read only)                                            | adapter: per-type handler classes are the entry; `<type>:<action>` commands from the contract; boundary = a processor call — past it the parameter belongs to the processor       | ~110   | 2.1      | positive control: plant `severity` unread in gate update → fails naming `gate:update severity`                       | contract already models actions (#367) |
| 2.3 | ☐ (as of 2026-09-23 · flips when a planted declared-but-unread `prompt_engine` parameter fails by name)                        | `scripts/validate-tool-parameter-reads.js`; `prompt-engine/core/prompt-executor.ts`; `stages/01-request-normalization-stage.ts:39–116`                    | adapter: entry = the request object `PromptExecutor` builds; reads counted in the executor and stage 01; boundary = the normalized request handed to the pipeline (OQ2)           | ~110   | 2.1      | positive control: plant a parameter the executor never reads → fails by name; `execution_hint` is the found instance | closes the third tool                  |
| 2.4 | ☐ (as of 2026-09-23 · flips when the first full run of the three-tool check reports zero unread parameters)                    | whatever 2.2/2.3 report (known: `execution_hint` P4.153; framework `switch` `persist` P4.154)                                                             | fix each instance: read it, or remove it from the command's declared list (tool surface unchanged; OQ4)                                                                           | ~60    | 2.2, 2.3 | `validate:all` green with the new step; CHANGELOG bullet per instance                                                | P4.153/P4.154 receipts                 |
| 2.5 | ☐ (as of 2026-09-23 · flips when CONTRIBUTING and mcp-contract-maintenance name the three-tool check)                          | `docs/guides/mcp-contract-maintenance.md`; `CONTRIBUTING.md`; `CLAUDE.md` Command Reference row                                                           | describe the check and what a "read" is                                                                                                                                           | ~25    | 2.1      | `validate:documented-options`; guidance projection                                                                   | docs/code lockstep                     |

Tier 2 gate: `npm run validate:all` (74 → 75 steps) and `node scripts/validate-suite-membership.js`

### Tier 3 — The review as a node-keyed entity (seam 1) — starts after delegation row 4.8 merges

| #   | St                                                                                                                                                                                     | File                                                                                                                                                                                     | Change                                                                                                                                                                                                    | ~Lines                       | Depends  | Verify                                                                                                                                      | Justification                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 3.1 | ☐ (as of 2026-09-23 · flips when `ChainSession.reviews` exists, round-trips through the residual document, and `pendingGateReview` is a projection of `reviews[currentNodeId]`)        | `shared/types/chain-execution.ts:430`; `shared/types/chain-session.ts`; `modules/chains/run-registry.ts:368–369,505`; `modules/chains/manager.ts` (`setPendingGateReview` → `setReview`) | `GateReview = PendingGateReview + {nodeId, kind, phase}`; `reviews: Record<nodeId, GateReview>`; projection getter stamped; 4.8's detached map folded into `reviews` with `kind:'detached'` (OQ3)         | ~140                         | —        | store unit tests: write/read by node, residual round-trip incl. restart; 4.8's integration suite green                                      | one identity                                                    |
| 3.2 | ☐ (as of 2026-09-23 · flips when `resolveReviewTarget` and `advanceReview` exist with the state table pinned as one value)                                                             | NEW `decisions/gates/review-target.ts`; NEW `decisions/gates/review-lifecycle.ts`; `decisions/gates/index.ts`                                                                            | pure resolver and transition covering verdict PASS/FAIL, replacement report, `gate_action` retry/skip/abort, exhaustion; the attempt counter lives here only                                              | ~150                         | 3.1      | unit tests: every transition, the whole table as one sequence value; mutation per transition                                                | the missing state machine                                       |
| 3.3 | ☐ (as of 2026-09-23 · flips when both verdict paths and stage 16 resolve their review through `resolveReviewTarget` and no verdict path derives a node from the run position)          | `gate-verdict-processor.ts:297,364,546`; `16-response-capture-stage.ts:267,282,339`; `13-session-stage.ts:241`; `gate-enforcement-authority.ts:352,455`                                  | create at render keyed by node; verdicts route by target; `resolveAttemptCounter` reads the review; deferred and pending paths become one path with two entry events                                      | ~200 (net ≤ +60)             | 3.2      | `rg "resolveNodeId\(currentStep" src` = 0; integration: a review opened on N while the run stands on N+1 is answered on N (same-node twin)  | the "current node" derivation dies                              |
| 3.4 | ☐ (as of 2026-09-23 · flips when `manager.ts`, `run-registry.ts` and `session-action-handler.ts` read reviews by node and the projection is their only slot reference)                 | `modules/chains/manager.ts` (15 refs; close guard at 955 reads open reviews); `run-registry.ts`; `session-action-handler.ts`; `observability-resources.ts`                               | close guard = unreported ∪ open reviews (one derivation, 4.8's); session inspect lists reviews per node                                                                                                   | ~150                         | 3.3      | `rg -c pendingGateReview` on these files → 0 outside the projection; `chain/complete` fires only after the final review closes (P4.157 e2e) | largest readers                                                 |
| 3.5 | ☐ (as of 2026-09-23 · flips when `chain-operator-executor.ts`, `step-capture-service.ts` and `remainder-processor.ts` read reviews by node and the executor is under its line ceiling) | `chain-operator-executor.ts:95–260` (11 refs; at 1002/1000); `step-capture-service.ts:603`; `remainder-processor.ts`; `detached.ts:130`                                                  | move render-time review reads into a pure `describeReviewForRender(review)` in `decisions/gates`; capture reads `reviews[nodeId]`                                                                         | ~120 (executor net negative) | 3.3      | `max-lines` ratchet passes; render output byte-identical for a current-step review (snapshot)                                               | line ceiling forces the extraction                              |
| 3.6 | ☐ (as of 2026-09-23 · flips when a new write to `session.pendingGateReview` fails `validate:all` by file and line, and the projection is deleted once the reader count is 0)           | NEW `scripts/validate-review-by-node.js`; `package.json`; SUITE; `shared/types/chain-session.ts` (delete the projection; OQ1)                                                            | type-checker walk (`validate-scoped-framework-reads.js` is the pattern): any write to the projection fails; any read outside a stamped exception list fails; delete the projection when the list is empty | ~120                         | 3.4, 3.5 | positive control: plant a write → fails by path; `rg pendingGateReview src` = 0 after deletion                                              | closes the class, not the instances                             |
| 3.7 | ☐ (as of 2026-09-23 · flips when the docs describe reviews per node and the drive passes)                                                                                              | `docs/concepts/chains-lifecycle.md`; `docs/architecture/overview.md` §Assertion–Gate Review Composition; `docs/reference/mcp-tools.md` (`gate_verdict` routing); CHANGELOG; `tests/e2e`  | e2e over Streamable HTTP under shipped defaults: structural review of N answered on N while at N+1; detached report review; final-step verdict; a FAIL past budget offers the retry prompt (P4.164)       | ~120                         | 3.6      | driven e2e with the stream read; positive controls per event                                                                                | docs/code lockstep; P4.159/P4.163/P4.164/P4.166/P4.169 receipts |

Tier 3 gate: full suite via `run-suites.sh` on the slice branch; `validate:all` (76 steps); the Tier 3 e2e

### Tier 4 — Module evolution analysis

| #   | St                                                                                                               | File                       | Change                                                                                                                                                                                                                                                                                                                                                                                                        | ~Lines       | Depends | Verify                                                                          | Justification          |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------- | ------------------------------------------------------------------------------- | ---------------------- |
| 4.1 | ☐ (as of 2026-09-23 · flips when every listed module has a table row per seam with a probe and a measured count) | ledger §Evolution analysis | for `engine/frameworks`, `modules/prompts` (registry), `modules/chains` + `run-registry`, `modules/versioning`, `modules/skills-sync`, `cli-shared` + `cli/`, `infra/hooks` + `hooks/`: one row per seam (writer-without-reader, ambient scope, missing state machine, cross-stage timing, two answers) with the probe run, the count, and the primitive named or "none found after <probe>"; no source edits | ~250 (notes) | —       | each cell cites a probe; a "none" cell cites the probe that would have found it | analysis without edits |
| 4.2 | ☐ (as of 2026-09-23 · flips when every 4.1 finding is a stamped row in a live plan or a kill with a reason)      | this plan (rows P6.x)      | planner triage: open or kill each finding; owner interview for any that changes a surface                                                                                                                                                                                                                                                                                                                     | ~80 (plan)   | 4.1     | `validate-plan-row-tracking`; no finding left in prose                          | do or kill             |

Tier 4 gate: `node server/scripts/validate-plan-row-tracking.js`

### Tier 5 — Validation and completion

| #   | St                                                                                                                                                                | File                           | Change                                                                                                                                                                                       | ~Lines | Depends       | Verify                                                                                | Justification                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------- | ------------------------------------------------------------------------------------- | ------------------------------- |
| 5.1 | ☐ (as of 2026-09-23 · flips when the three class gates each fail their planted instance on `main`)                                                                | —                              | after Tiers 1–3 merge: plant the three instances on a scratch branch (extra gate field dropped; unread `prompt_engine` parameter; write to the retired slot) and record each failure by name | —      | 3.6, 2.4, 1.3 | three red gates, then reverted                                                        | gates proven live               |
| 5.2 | ☐ (as of 2026-09-23 · flips when one chain with a structural review, a detached step and a final-step verdict is driven in Claude Code against the merged `dist`) | — (owner + planner live drive) | build `dist`, `verify:mcp`, drive a `>>` chain through the plugin server; record the replies in the ledger                                                                                   | —      | 5.1           | the run's `execution_history` lists reviews per node; the reply text matches the docs | live flow, not only green gates |

Tier 5 gate: `npm run build && npm run verify:mcp` and the live-drive receipt

## New file justifications

- `gate-definition-converter.ts`: the two callers are peers in different layers (core loader, registry adapter); neither may import the other.
- `decisions/gates/review-target.ts`, `review-lifecycle.ts`: pure decisions beside `enforcement-mode.ts` and `structural-review-composition.ts`; putting them in the 855-line verdict processor buries the state machine in the orchestrator.
- `scripts/validate-review-by-node.js`: a class gate with its own exception list and self-test, the shape of `validate-scoped-framework-reads.js`.
- `validate-tool-parameter-reads.js` is a rename, not a new file.

## Execution dispatch

| Row | Tier            | Effort | Failure shape                                                   | branch_mode                                           |
| --- | --------------- | ------ | --------------------------------------------------------------- | ----------------------------------------------------- |
| 1.1 | opus            | high   | wrong approach (a delegating hierarchy instead of one function) | own-branch (`rework/converter`)                       |
| 1.2 | opus            | medium | wrong output (inline keys dropped at the lift)                  | same slice                                            |
| 1.3 | sonnet          | medium | wrong output (guard keeps a gap list)                           | same slice                                            |
| 1.4 | sonnet          | medium | wrong output (drive not under the provider path)                | same slice                                            |
| 2.1 | opus            | high   | wrong approach (a second read model)                            | own-branch (`rework/binding`)                         |
| 2.2 | opus            | high   | wrong approach (boundary drawn at the wrong call)               | same slice                                            |
| 2.3 | opus            | high   | wrong approach (pipeline reads miscounted)                      | same slice                                            |
| 2.4 | sonnet          | medium | wrong output (instance fixed by suppression)                    | same slice                                            |
| 2.5 | sonnet          | low    | wrong output                                                    | same slice                                            |
| 3.1 | opus            | high   | wrong approach (two maps)                                       | own-branch (`rework/review-entity-1`)                 |
| 3.2 | opus            | high   | wrong approach (transitions inferred per path)                  | same slice                                            |
| 3.3 | opus            | max    | wrong approach (a verdict path keeps deriving the node)         | own-branch (`rework/review-entity-2`)                 |
| 3.4 | opus            | high   | wrong output (a reader left on the projection)                  | own-branch (`rework/review-entity-3`)                 |
| 3.5 | opus            | high   | wrong approach (executor grows past its ceiling)                | same slice                                            |
| 3.6 | opus            | high   | wrong approach (a name-keyed gate)                              | own-branch (`rework/review-entity-4`)                 |
| 3.7 | sonnet          | medium | wrong output (docs describe the slot)                           | same slice                                            |
| 4.1 | fable           | high   | wrong problem (unknown unknowns across seven modules)           | own-branch (`rework/evolution-analysis`, ledger only) |
| 4.2 | planner         | —      | —                                                               | plan file                                             |
| 5.1 | sonnet          | medium | wrong output (a gate that passes its planted instance)          | scratch branch, never pushed                          |
| 5.2 | owner + planner | —      | —                                                               | live drive                                            |

## Open questions

| id  | status                                                                  | precedes | default                                                                                                                                       | alternative                                    |
| --- | ----------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| OQ1 | RULED 2026-09-23 (owner, R3) — delete in this initiative                | 3.6      | the projection is deleted in this initiative once the reader count is 0                                                                       | keep it one release as a stamped compat getter |
| OQ2 | OPEN (as of 2026-09-23 · flips when 2.3's worker measures the boundary) | 2.3      | `prompt_engine`'s boundary is the normalized request `PromptExecutor` hands to the pipeline; stage 01 reads count, later stages do not        | count reads in every stage                     |
| OQ3 | RULED 2026-09-23 (owner, R3) — rename to `GateReview`, alias stamped    | 3.1      | rename the type to `GateReview`; `PendingGateReview` stays as a type alias in the stamped exceptions                                          | keep the old name                              |
| OQ4 | RULED 2026-09-23 (owner, R4) — not breaking                             | 2.4      | removing a declared-but-unread parameter from a command's list is not breaking while the name stays declared on the tool (the #366 precedent) | any narrowing is breaking                      |

## Validation (Step 5)

| What to test                                                         | Test type                                                           | Location                                                                           | Why this type                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| Converter carries every field on both paths                          | unit + parity                                                       | `tests/unit/gates/registry/gate-provider-converter-parity.test.ts`, converter unit | pure function; parity is the class guard      |
| A workspace gate's relative script resolves from its directory       | e2e                                                                 | `tests/e2e`                                                                        | only the live provider path shows it (P4.140) |
| Three-tool parameter-reads check                                     | validator self-test + planted instance                              | `server/scripts`, `validate:all`                                                   | the gate is the deliverable                   |
| Review transitions                                                   | unit, table pinned as one value                                     | `tests/unit/execution/pipeline/decisions/gates`                                    | pure state machine                            |
| Verdict routing by node                                              | integration (`step-lifecycle` harness with real stages 13/16/19/20) | `tests/integration/chain`                                                          | the seam is between stages                    |
| Review of N answered at N+1; detached; final-step; budget exhaustion | e2e over Streamable HTTP with the stream read                       | `tests/e2e`                                                                        | consumer-observable replies and notifications |
| No new writer of the slot                                            | validator with positive control                                     | `validate:all`                                                                     | class closure                                 |
| Live flow                                                            | Claude Code drive                                                   | ledger receipt (5.2)                                                               | exit codes do not show the flow ran           |

| Criterion                   | Validation      | Pass condition                                                      |
| --------------------------- | --------------- | ------------------------------------------------------------------- |
| Seam 2 closed               | 1.3 + 5.1       | gap list gone; planted field survives; planted drop fails the guard |
| Seam 3 closed               | 2.4 + 5.1       | zero unread parameters; planted instance fails by name on each tool |
| Seam 1 closed               | 3.6 + 3.7 + 5.1 | `rg pendingGateReview src` = 0; e2e green; planted write fails      |
| Evolution analysis complete | 4.2             | every finding is a stamped row or a kill                            |
| Nothing else moved          | per slice       | full suite green; ratchets never raised                             |

| Doc                                                                       | Update needed                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `docs/concepts/chains-lifecycle.md`                                       | reviews per node; detached review at report; final-step verdict |
| `docs/architecture/overview.md`                                           | §Assertion–Gate Review Composition on the review entity         |
| `docs/reference/mcp-tools.md`                                             | `gate_verdict` routing by node token                            |
| `docs/guides/mcp-contract-maintenance.md`, `CONTRIBUTING.md`, `CLAUDE.md` | the three-tool parameter-reads check                            |
| `docs/guides/gates.md`                                                    | never edited; a paragraph per slice goes in the handoff         |

| Risk                               | Impact                               | Mitigation                                                                       | Rollback                                                   |
| ---------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Half-migrated review readers       | two identities, the defect class     | 3.6's validator with a stamped exception list; migration ordered by reader count | revert the slice; the projection keeps old readers working |
| 3.3 breaks its bound               | the highest-risk row stalls          | route the pending path first, the deferred path next slice, exception named      | same                                                       |
| Converter drops an inline-only key | inline gates lose a field            | 1.2's lift documents inline-only keys; twin test                                 | revert 1.2                                                 |
| prompt_engine boundary miscounted  | false positives block `validate:all` | OQ2 measured by the worker before the adapter lands; self-test per adapter       | remove the adapter from SUITE                              |
| Analysis opens rows nobody pulls   | backlog                              | 4.2 is do-or-kill in the same session                                            | —                                                          |

Release: `refactor(gates)` / `feat(scripts)` / `fix(chains)` per slice; CHANGELOG `### Fixed`:
a gate review is a record of one node's output with its own attempt counter and phase, and a
verdict lands on the node its review names; every path that loads a gate carries every declared
field; a parameter any of the three tools declares but never reads fails validation by name.

Growth capture: the five-seam classification itself (pattern: classify findings by primitive, not
file); "a merge that lowers a ratchet baseline exposes slack" (3 sightings, logged); "a ruling
whose predicate names a field must show the runtime reads it" (logged).
