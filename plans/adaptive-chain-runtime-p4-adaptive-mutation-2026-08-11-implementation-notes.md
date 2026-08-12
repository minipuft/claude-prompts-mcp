---
title: "P4 Adaptive Mutation — Implementation Notes"
date: 2026-08-11
status: active
tags: [adaptive-chain-runtime, deviations]
---

# P4 Implementation Notes

Deviation log + rulings for `adaptive-chain-runtime-p4-adaptive-mutation-2026-08-11.md`. Created BEFORE the first edit per the execution protocol.

## Rulings (main thread — never delegated)

- **OQ-P4-2 RULED (pre-T1)**: the policy may NOT skip the current node — only strictly-ahead, not-yet-executed nodes. The current node is already rendered client-side; skipping it would desynchronize the client's view from run state with no way to signal it (D6 advisory posture). `kind:'none', reason:'target-passed'` covers a target at-or-behind current.
- **OQ-P4-5 RULED (pre-T1)**: caps are 1 insertion per unknown id, 3 insertions per run. Per-unknown dedup prevents a re-declared unknown from re-inserting; the run cap of 3 is the runaway backstop. Both rejections are named none-reasons ('cap-reached') and unit-tested. Skips are uncapped in v1 — each requires a distinct declared target, which is its own bound.
- **OQ-P4-1 RULED (2026-08-12, pre-T3 — SUPERSEDES the plan-table sketch default "synthetic inline node")**: the inserted investigation step carries the promptId of a NEW bundled `investigate_unknown` prompt resource (created via resource_manager in T3, taking the unknown's statement as argument). Rationale for overriding the default: node rendering resolves promptId through PromptRegistry.get(); a synthetic promptId would require a special-case branch in the render path — pipeline invasiveness for zero gain — while a bundled resource rides every existing surface (registry, hot-reload, verify:mcp) untouched. The original default optimized for "no new resources" but priced the render-path special case at zero, which was wrong.
- **OQ-P4-4 RULED (2026-08-12, pre-T3)**: hook projection totals reflect the mutated node list. The T2 worker measured that `projectToHookView` derives current/total from `session.state.nodes` at write time, so this is already true with zero code change; T3 adds an explicit integration assertion so it stays true by test rather than by accident. P3's byte-parity was a no-mutation invariant, not a contract under mutation.
- **OQ-P4-6 RULED (2026-08-12, pre-T3)**: inserted investigation nodes get NO gates in v1 — gate selection is untouched for them; a blocking unknown's investigation step should have the lowest possible friction (its output is observations, not gated work product). Gates targeting SKIPPED nodes must never fire — that lands in T4.1.
- **OQ-P4-3 RULED (2026-08-12, pre-T4)**: temporary-gate step scoping re-keys by node id. A gate arriving with `target_step_number` (ordinal form) resolves to a node id ONCE, at registration time, against the node list as it exists at that moment — and is stored/matched by node id from then on. Mutations after registration therefore cannot shift which step a gate binds to (an ordinal stored as an ordinal would silently retarget when a node is inserted ahead of it). `resolveStepTarget` (temporary-gate-registrar.ts:348) already cross-resolves both forms, so registration-time resolution is a call-order change, not new machinery. Gates whose resolved target is later SKIPPED never fire (OQ-P4-6 companion); gates registered against a node that no longer has a future (target passed) follow the existing expiry semantics. Freeze-ordinals was rejected because it preserves the number, not the meaning — the gate was authored against a step, not an index.

## Deviations

(logged as they happen — an empty section at phase end is a claim the plan survived contact intact)

- **D-T1-1**: `DecideMutationInput` (Tier 1.5) carries a sixth field, `insertedUnknownIds: readonly string[]`, beyond the plan's illustrative five-field sketch (`{ delta, ledger, nodes, currentNodeId, insertedCount }`). A scalar `insertedCount` alone cannot answer OQ-P4-5's per-unknown-id dedup question ("has THIS unknown already received its one insertion") without either restating state inside the pure function or reaching outside it — both against the "pure, no I/O" constraint. `decideMutation` stays pure; Tier 3 is now expected to track and pass this set alongside the run-wide count when it wires stage 16.
- **D-T1-2**: `expect(x).toEqual<ChainMutation>({...})` generic-call syntax is rejected by this repo's `@jest/globals` type definitions (`tsc` TS2558, caught by `typecheck:tests:ratchet` after the first draft of `mutation-policy.test.ts` shipped 12 new errors). Routed every mutation-shape assertion through a small `expectMutation(actual: ChainMutation, expected: ChainMutation)` helper instead, which gives the same compile-time literal-shape checking without depending on unsupported generic method syntax.
- **D-T1-3**: the Tier 1 gate's `test:match -- "mutation-policy|node-order|prompt-schema"` regex does not match `tests/unit/mcp-tools/prompt-engine-surface.test.ts` — the file that actually imports and exercises `unknownDiscoveredSchema`/`buildPromptEngineSchema` (confirmed via `--listTests`; the `prompt-schema` token instead matches the unrelated `tests/unit/prompts/prompt-schema.test.ts`, which covers the YAML prompt schema, not the MCP tool schema). Extended `prompt-engine-surface.test.ts` with the target_step_id validation cases (1.1's stated test target) and ran it explicitly (`test:match -- "prompt-engine-surface"`) in addition to the literal gate command — both green, reported separately in the Tier 1 report.
- **D-T1-4**: `shared/types/execution.ts` needed no direct edit for 1.3. It imports `UnknownObservation` from `chain-session.ts` and re-uses it structurally (`readonly observations?: readonly UnknownObservation[]`) — there is no separate `UnknownDiscovered`/`UnknownObservation`-shaped type declared in `execution.ts` itself to extend. All 1.3 type work landed in `chain-session.ts`, where both `UnknownObservation` and `UnknownLedgerEntry` are actually declared.
- **D-T1-5** (informational, non-blocking): the plan's Tier 1.3 row names the pure ledger-apply function as "`applyUnknownLedger` region, ~line 29+" in `unknown-observation-processor.ts`. The function is named `computeUnknownLedger` (declared ~line 50; its semantics docblock starts ~line 28). No functional drift — the line anchor and region were correct, only the quoted function name was off.

- **DEV-T2-1**: `origin` ships as `TEXT NOT NULL` with **no DDL DEFAULT**, not the plan's `DEFAULT 'planned'`. `validate:no-phantom-columns` exempts every defaulted column by design, so a default would have made this column structurally invisible to the one gate that exists to catch a writer dropping it — and if a future edit did drop it from the INSERT list, the default would silently fill 'planned' on every row, which is exactly the value-dead shape `execution_records` has produced twice. Without a default the same mistake fails loudly on the NOT NULL constraint. Nothing is lost: `chain_run_nodes` has one declared writer, the bump recreates the table (ephemeral), so no pre-v23 row can arrive without the column.

- **DEV-T2-2**: schema v23 adds a SECOND column the plan did not name — `origin_unknown_id TEXT` (nullable) — and `ChainNode` gains a matching optional `originUnknownId`. Tier 3 must supply `insertedUnknownIds` (D-T1-1) and must be able to rebuild it after a cold load, and `origin` alone answers only the run-wide cap, never "has THIS unknown already had its insertion". The alternative the dispatch note floated — encoding the unknown in the node id via `mintInsertionId` base `inv-<unknownId>` — is not a decodable inverse: `slugify` is lossy (`UNK-1` and `unk_1` collide) and collisions append `-2`, `-3`, so parsing the id back would be a guess. The base string is still `inv-<unknownId>` for human legibility, but the machine-readable fact is the column. NULL on planned rows is partial population BY ROW TYPE (the v21 telemetry pattern), not a value-dead column.

- **DEV-T2-3**: the plan's Tier 2.4 row points at `shared/types/chain-session.ts` for `ChainNode`. `ChainNode` is declared in `shared/types/chain-execution.ts:353`; `chain-session.ts` only imports it. Same shape as D-T1-4. All 2.4 type work landed in `chain-execution.ts`. The two new store methods WERE added to `ChainSessionService` in `chain-session.ts`, so that file is still touched — Tier 3 can call them through the interface rather than through the concrete class.

- **DEV-T2-4**: `ChainNode.origin` is **optional** (`origin?: 'planned' | 'inserted'`), not the plan's required field. Four unrelated sites mint a `ChainNode` (`13-session-stage.buildChainNodes`, `ChainSessionStore.resolveCreationNodes`, `run-registry.reconstructSession`, test helpers) and only the mutation path has an opinion; a required field would force three of them to restate the default, two of them in files owned by other in-flight workstreams. Compensating decision: `resolveCreationNodes` now NORMALIZES `origin` to `'planned'` on session creation, and `reconstructSession` always sets it explicitly, so a node that is inside a session or has been through storage always carries its provenance. Without that normalization the same node read `undefined` in memory and `'planned'` after a cold load — caught immediately by the pre-existing `expect(after.state.nodes).toEqual(before.state.nodes)` assertion in `chain-run-storage.integration.test.ts`.

- **DEV-T2-5**: the plan's `milestone='skipped'` premise HOLDS, but only after widening two shared unions: `StepLifecycle` and `StepMilestone` each gain `'skipped'`. The `milestone` COLUMN stores `StepMetadata.state`, which is a `StepLifecycle`, so "milestone='skipped'" is not expressible without the union. Consumers enumerated before committing (`rg "StepLifecycle" src/ tests/ hooks/`): `run-registry.toStepStates` casts (fine), `execution-record-store.status` is a TEXT column (fine, and a skipped step never emits an execution record), `execution-history-action-handler.statusIcon` has a `default` branch (fine), Python hooks read `chain_sessions.state` JSON + `run_status` and never a step lifecycle (fine), `validate:no-stepstate` guards the retired ENUM identifier and is unaffected (verified green). The alternative — a separate `skipped` column or flag — was rejected: `milestone` already persists per node, already reconstructs on cold load (F10), and already has stickiness enforcement, so a parallel marker would be a second copy of one fact with nothing keeping the two in step.

- **DEV-T2-6**: `markNodeSkipped` returns `Promise<boolean>`, not the plan's `Promise<void>`, and `insertNodeAfter` returns `Promise<ChainNode | null>` rather than `Promise<ChainNode>`. This store's error posture is uniformly falsy-return-plus-warn (`advanceStep`, `completeStep`, `setStepState`, `transitionStepState`, `cancelChain` all do it); throwing would be the only other way to make a refusal observable, and it would be the odd one out. `void` would make every refusal a silent no-op, which is the failure mode the dispatch brief explicitly named. Refusal reasons are unit-tested one per case.

- **DEV-T2-7**: `markNodeSkipped`'s `unknownId` parameter is recorded in the debug log only — it is NOT persisted. Skips are uncapped in v1 (OQ-P4-5 ruling), so no reader needs to recover which resolution caused a skip, and a column nothing reads is the value-dead class this schema has already produced twice. Stated here rather than left implicit so the asymmetry with `origin_unknown_id` (which IS persisted, because the insertion cap reads it) is a decision on the record and not an oversight. If a Tier 3/4 consumer ever needs it, the column is a small additive change with a real reader attached.

- **DEV-T2-8**: skipped nodes do NOT enter `session.executionOrder`. That list is the record of what the run actually EXECUTED and is read back to reconstruct step results; a node in it with no stored result would read as an executed step with a missing response. The skip is instead observable through `stepStates` (`state: 'skipped'`) and the `milestone` column. Asserted directly in `advanceStep passes over a skipped node and lands on the next live one`.

- **DEV-T2-9** (scope addition, defect-shaped): `transitionStepState`'s stickiness guard was `currentState === 'completed' && newMilestone !== 'completed'`. Generalized to a `TERMINAL_STEP_LIFECYCLES` set containing `'completed'` and `'skipped'`, compared via `lifecycleForMilestone(newMilestone) !== currentState`. Behaviour for `'completed'` is unchanged (verified by the pre-existing suite); without the change a skipped node could be transitioned back to `rendered` by any later capture, which would un-do the skip client-side. Not gated behind a flag — `cleanup-standards.md` §Parity Gates: this has a provably-correct target verifiable offline.

- **DEV-T2-10** (vacuous-gate substitution): the Tier 2 gate command does not observe `tests/integration/database/sqlite-backend.test.ts`, which pins the schema version in TWO places (`:56`, `:266`) — both had to move 22→23, and the `chain-run-storage|chain-session|manager` pattern matches neither. Ran `test:match -- "sqlite-backend|cli-schema-ownership"` alongside the literal gate (23/23 green). Also ran, unprompted but implied by the vocabulary widening and the schema bump: `validate:no-stepstate` (green), `hooks/tests/test_db_reader.py` (23 passed — it re-extracts the DDL and `SCHEMA_VERSION` from the TypeScript source, so a bump reaches it), plus the full `test:ci` (2171) and `test:integration` (520).

- **DEV-T3-1** (tool defect, wider than P7-D1 recorded it): `resource_manager` strips `required: true` from `arguments` on **create**, not only on `update`. Both `investigate_unknown` arguments were sent with `required: true`; the written `prompt.yaml` carries `name`/`type`/`description` only. Not fought, per the dispatch brief. Consequence accepted for v1: the mutation path always supplies both arguments itself (`unknown_id`, `statement` are bound by `insertNodeAfter`'s spec and the template), so nothing reaches the template with a missing required arg. It matters only if a human invokes `>>investigate_unknown` by hand.

- **DEV-T3-2** (OQ-P4-1 placement — the ruling's rationale forced a category change): the prompt was first created under `analysis/` per the brief's "category development or analysis", then **deleted and recreated under `workflow/`**. `server/resources/prompts/.gitignore` is `*` with allow-entries for exactly four categories — `examples/`, `guidance/`, `codebase-setup/`, `workflow/`. A prompt authored into `analysis/` is gitignored, so it would exist only on the machine that ran the tool and every other install would insert a node whose `promptId` resolves to nothing. That defeats OQ-P4-1's whole rationale ("a bundled resource rides every existing surface"). `workflow/` is the closest bundled fit (siblings: `triage`, `github_repo_setup`). Verified tracked: `git status` reports `?? server/resources/prompts/workflow/investigate_unknown/` (untracked, NOT ignored), where the `analysis/` copy showed nothing at all.

- **DEV-T3-3** (premise checked, no change needed): stage 16 required **no new dependency and no construction-site changes**. `ChainSessionService` already declares `insertNodeAfter`/`markNodeSkipped` (Tier 2.5 added them to the interface, DEV-T2-3), and the stage already holds a `ChainSessionService` as its third constructor argument. All six construction sites (`pipeline-builder.ts` plus five test builders) are untouched.

- **DEV-T3-4** (SSOT, against the brief's literal instruction): the stage does **not** call `mintInsertionId`. The brief said "mint id via mintInsertionId (base `inv-<unknownId>`)", but `ChainSessionStore.insertNodeAfter` already does exactly that internally (`manager.ts` — `mintInsertionId(spec.unknownId !== undefined ? \`inv-${spec.unknownId}\` : spec.stepName, ...)`). Minting at the stage as well would put the never-renumber contract in two places and let them disagree. The stage passes `unknownId` and lets the node list's owner mint.

- **DEV-T3-5** (shape change to an existing private method): `applyObservations` returned `Promise<boolean>` ("rejected?"). It now returns a three-state `ObservationOutcome` (`none` | `rejected` | `applied` + `ledger` + `delta`). The policy needs both the delta and the post-apply ledger, and the processor already returns the ledger — it was being discarded. Three states rather than a nullable ledger because `none` and `rejected` are different non-firing reasons and collapsing them would make a rejected batch indistinguishable from an empty one at the one call site that must tell them apart.

- **DEV-T3-6** (scope addition beyond 3.3's "fix only if a consumer cached totals"): `context.sessionContext` **is** a cached copy of the totals — `alignSessionContext` publishes them BEFORE `applyObservations`, so every consumer downstream of a mutation reads a pre-mutation denominator. Added `refreshTotals`, called only when a mutation actually applied. Falsification: on the **capture** path it is redundant (`StepCaptureService.syncSessionContext` re-derives totals after capture, and neutering `refreshTotals` changed nothing) — but on the **create-new early exit** it is load-bearing, because that path returns before capture ever runs. Test `an early-exit call republishes the mutated totals` fails with it neutered and passes with it restored; without that test the method would have been unobservable dead code.

- **DEV-T3-7** (BLOCKING FINDING — promote to the master ledger; blocks done-criterion "CTA names inserted node" and therefore Tier 5.1): **the chain render path is ordinal-indexed against the PARSE-TIME step list, not the run's node list.** `18-execution-stage.ts:112,128-141` reads `context.parsedCommand.steps`, sets `totalSteps = steps.length`, clamps `currentStep` to it, and renders `steps[currentStep - 1]`; `chain-operator-executor.renderStep` then resolves the prompt from that same array. Measured end-to-end through the real pipeline (`step-lifecycle`, probe run 2026-08-12): after a blocking unknown at step 1 of `>>draft --> >>review`, the node list is correctly `[draft, inv-cache-ttl, review]`, `currentNodeId` is correctly `inv-cache-ttl`, and the footer correctly reads `Progress 2/3` — but the rendered body is **`Do Review.`**, the `review` prompt. The inserted node cannot render its own prompt, every node after an insertion renders the prompt one ordinal earlier, and the `Math.min(currentStep, steps.length)` clamp means the last real node is unreachable once anything is inserted. This is a decision-bearing fix in a stage and an executor that other in-flight workstreams also hold, and it is not "a consumer cached totals" — so it is reported, not silently fixed. Storage, policy, traversal, totals and audit are all correct; only rendering is not node-driven. Suggested home: a new Tier 4 row (before 4.2), since 5.1's acceptance assertion cannot pass without it.

- **DEV-T3-8** (plan row 3.2 named more edit sites than exist): the row lists "sqlite-engine.ts + BOTH terminal writers (21-formatting-stage, prompt-execution-pipeline) + telemetry source". **Neither terminal writer needed an edit.** Both already spread the whole `getRunTelemetry` result (`...(telemetry ?? {})`), so extending `RunTelemetry` reaches both at once. The v21 both-writers invariant is therefore structural here rather than duplicated — which is exactly why the new columns were added to that object instead of being computed at either call site. The invariant is still asserted, not assumed: a new run-telemetry test drives both writers over a mutated run and requires identical non-NULL counters on the `completed` and the `failed` row.

- **DEV-T3-9** (OQ-P4-4 assertion moved): the plan puts the hook-projection assertion in the step-lifecycle test. It cannot live there — that suite mocks `saveSessions`, so `persistSessions` (and with it `projectToHookView`) never runs. Landed instead in `tests/unit/chain-session/chain-session-hook-projection.test.ts`, which drives a `RecordingDatabasePort` and reads the projected `state` blob verbatim: an insertion moves `totalSteps` 3 -> 4 with the key set unchanged, and a skip leaves `totalSteps` at 3 (the node is retired, not deleted) while `advanceStep` walks over it.

- **DEV-T3-10** (vacuous-gate substitution): the Tier 3 gate pattern `"response-capture|run-telemetry|step-lifecycle"` does not match `tests/unit/chain-session/chain-session-hook-projection.test.ts`, which carries the OQ-P4-4 criterion (confirmed with `--listTests`: the pattern selects six suites, not including it). Ran `test:match -- "chain-session-hook-projection"` in addition to the literal gate command, plus both SQLite gates and `typecheck:tests:ratchet`, which the stated Tier 3 gate also omits despite this tier touching the schema and five test files.

- **DEV-T4-1** (row 3.4 shape): the node-driven render landed as a NEW pure module,
  `engine/execution/operators/node-step-projection.ts` (`planNodeDrivenRender`), not as inline
  arithmetic in stage 18. Three consumers now need the same answer (stage 18, stage 20, and the
  unit suite), and the resolution rule has three branches with different failure modes — a stage
  private would have put a decision inside orchestration and made the second consumer copy it.
  **`chain-operator-executor` needed no edit at all**, contrary to the row's "if it shares the
  pattern": it indexes whatever array it is handed, so handing it a node-aligned array moves the
  whole executor onto node identity for free. Render-path readers of `parsedCommand.steps`
  enumerated before editing (`rg -n "parsedCommand\.steps|parsedCommand\?\.steps" src/`, 20
  source sites): 18-execution (fixed), 20-gate-review (fixed, DEV-T4-2), 14-injection (fixed,
  DEV-T4-3), manager.getCurrentStepArgs (DEV-T4-4), response-assembler ×2 (DEV-T4-5); the rest
  are collections or parse-time minting, which are position-free by construction.

- **DEV-T4-2** (row 3.4 was larger than one stage — and this half was not optional): the gate
  REVIEW render is the same defect. `20-gate-review-stage` passes `parsedCommand.steps` to
  `renderStep`, and `resolveReviewStep` locates the reviewed step with `chainContext.current_step`
  — an ordinal `getChainContext` derives from the RUN's node list. On a mutated run the two are
  different scales, so a review opened on a step after an insertion quoted the NEXT step's task
  back to the client. Found by 4.2, not by inspection: the cold-load resume assertion failed
  against `Do Review.` while the run stood on `analyze`. Fixed with the same projection, which is
  also its falsification — the test failed before the stage 20 hunk and passes after.

- **DEV-T4-3** (scope addition, same defect class): `14-injection-control-stage.getPromptInjection`
  and `getStepType` both read `steps[currentStep - 1]`, so after an insertion a step's framework/
  injection block came from a neighbour. Extracted `resolveCurrentChainStep`: node id first,
  positional fallback only when no parse step carries an id (P3 D10). An INSERTED node resolves to
  `undefined` rather than falling through positionally — it declares no prompt-tier injection, and
  reading a neighbour's block is a misattribution, not a missing declaration.

- **DEV-T4-4** (a reader that could NOT be made node-driven): `ChainSessionStore.getCurrentStepArgs`
  (manager.ts:2376) indexes the BLUEPRINT's step array by run ordinal to publish `currentStepArgs`
  and `input`. It cannot resolve by node id: `ParsedCommandSnapshot.steps` declares only
  `{inlineGateIds?, args?}` — no `nodeId` — so fixing it properly means widening a persisted
  blueprint shape, which is its own row. Stage 18 already overrode `currentStepArgs`; it now also
  overrides `input` with the resolved node's args, guarded to non-empty so a run that never had an
  `input` key does not acquire one. The blueprint-shape fix is left for a later row.

- **DEV-T4-5** (enumerated, deliberately NOT fixed): `response-assembler.findNextDelegatedStep` and
  `resolveCurrentPrompt` both locate the current step with `.find(s => s.stepNumber === currentStep)`
  against the parse-time array, so after an insertion they name the wrong step. Both are FORMATTING
  reads (delegation CTA target, invocation string), not the rendered body, and neither is in row
  3.4's stated criteria. Reported rather than fixed: response-assembler carries another
  workstream's uncommitted hunks, and the fix wants the same projection threaded through the
  formatter — a row, not a hunk.

- **DEV-T4-6** (OQ-P4-3 needed MORE than the ruling's "a call-order change"): registration-time
  resolution was ALREADY happening — `normalizeGateInput` calls `resolveStepTarget` on every gate.
  What silently retargeted under mutation was **selection**: `filterGatesByStepNumber` matched
  `target_step_number === step.stepNumber`. So the real work was `filterGatesByStepTarget`, which
  matches `target_step_id === step.nodeId` first and falls back to the ordinal only for gates or
  chains carrying no id. The resolution SOURCE still moved too: a client's ordinals come from the
  rendered footer, which counts the RUN's nodes, so on an already-mutated run the parse-time array
  answers a different question. New narrow read model `engine/gates/services/run-step-view.ts`
  (`RunStepView` + `createRunStepViewProvider`), one instance wired in `pipeline-builder`, consumed
  by both the registrar and the enhancement service as an OPTIONAL constructor argument — the
  `ActiveFrameworkIdProvider` pattern, not a `ChainSessionService` injection into the gate layer.
  Reached by CHAIN id, not session id: gates register at stage 11 and
  `ExecutionContext.getSessionId()` is not populated until stage 13, so `chain_id` is the only run
  handle available that early.

- **DEV-T4-7** (where the skipped-node guard lives): in SELECTION, not registration. A node can be
  retired long after its gate was registered, so a registration-time check would pass and then be
  wrong; `RunStepView.skippedNodeIds` is read per call instead. The guard returns `false` for every
  step rather than falling through to the ordinal branch — falling through would attach the gate to
  whatever step now sits at that position, which is the retarget the whole ruling exists to stop.
  Paired with a falsification partner test (`the same gate DOES fire while its target node is still
live`), because `[]` is also what a filter that drops every id-targeted gate would produce.

- **DEV-T4-8** (mock-integrity break the stated gate could not see): stage 20 now calls
  `chainSessionStore.getSession`, and two `ChainSessionService` doubles did not declare it —
  `tests/unit/execution/pipeline/gate-review-stage.test.ts` and
  `tests/integration/gates/gate-judge-pipeline-wiring.test.ts` (8 failures). Neither is matched by
  the Tier 4 gate pattern, and the integration one is not matched by ANY `test:match` token in this
  plan's gates; both were found only by running `test:integration` whole. Both doubles now return
  `undefined` from `getSession`, which is a real answer (a formatter-only harness has no run) and
  exercises the projection's parse-time fallback rather than papering over it.

- **DEV-T4-9** (vacuous-gate substitution): the stated Tier 4 gate
  `test:match -- "temporary-gate|step-lifecycle|execution-stage"` selects 4 suites and observes
  none of: `node-step-projection` (new), `gate-enhancement-stage`, `gate-review-stage`,
  `injection`, `inline-gate-registration`, `chain-run-storage`, `chain-session-*`. Confirmed with
  `--listTests`. Ran the literal command AND
  `"temporary-gate|step-lifecycle|execution-stage|node-step-projection|gate-enhancement|gate-review|injection|inline-gate|chain-run-storage|chain-session|response-capture|run-telemetry"`
  (25 suites / 323 tests), plus full `test:ci`, `test:integration`, `test:e2e`, `lint:ratchet`,
  `validate:arch` and both SQLite gates. The `execution-stage` token matches
  `step-execution-stage`/`script-execution-stage`, not the pipeline stage file's own coverage.

- **DEV-T4-10** (row 4.2 could not live where the plan put it): the existing
  `step-lifecycle.integration.test.ts` describe mocks `saveSessions` AND `loadSessions` on the
  prototype, so it is structurally blind to persistence — an insertion that never reached a row
  passes there. F10 landed as a SECOND describe in the same file, over a real `SqliteEngine` in a
  tmpdir, with a second `ChainSessionStore` doing the reload (a reconstruction is only a
  reconstruction if the reader was never the writer — same rationale as
  `chain-run-storage.integration.test.ts`). Required extracting the inline stage wiring into a
  module-level `buildPipeline({sessionStore, recordStore, logger, steps})`, since the reload needs
  a second pipeline over the second store. The pre-existing describe now calls the same factory.

- **DEV-T4-11** (the harness could not falsify the clamp): a TWO-step parsed chain cannot
  distinguish "renders the right node" from "clamps to the last parse step and is right by
  accident" — `Math.min(ordinal, steps.length)` always lands on the final parse step, which IS the
  final node. Added `parsedThreeStepChain` (`draft --> analyze --> review`) and a swappable
  `parsedSteps` hook (defaulting to the two-step chain every pre-existing test drives) so one test
  can stand the run on a node BETWEEN the first and the last. Verified by neutering: with stage 18
  restored to the old clamp, 2 of the 3 row-3.4 tests fail; with the two-step chain only 1 did.

- **DEV-T4-12** (pre-existing, out of scope, reported): step targeting only filters a gate's
  per-step INSTRUCTION text. `enhanceChainSteps` calls `addGatesToAccumulator` for every registered
  temporary gate before the step loop, so a step-targeted gate is in `context.gates` run-wide and
  participates in the gate REVIEW of every step regardless of its target. That is true of
  `target_step_number` today and predates P4 — mutation does not make it worse — so it is recorded
  here rather than fixed inside this row. It does mean "a gate targeting a skipped node never
  fires" holds for guidance injection, which is what step targeting controls, and not for review
  participation, which nothing scopes per step.

- **DEV-T5-1** (docs accuracy finding, not fixed — out of scope for a docs worker): the
  `execution_history` action handler's rendered telemetry line
  (`execution-history-action-handler.ts::formatTelemetryLine`) destructures only
  `stepsPlanned`/`gatesFired`/`gateRetries`/`unknownsOpened`/`unknownsClosed` from `ExecutionRecord`
  — it does NOT read or render `nodesInserted`/`nodesSkipped`, even though `ExecutionRecordStore`
  persists and returns both (columns land in the raw row and round-trip through `queryRecent`,
  confirmed via `run-telemetry.integration.test.ts`). The Tier 3 plan row's "reader =
  `execution_history`" was true of the STORE layer, not of the handler's markdown output. Docs are
  written to say precisely this (persisted + queryable, not yet in the rendered line) rather than
  claim the counters are visible in `system_control execution_history` output today. Wiring
  `formatTelemetryLine` to include them is a one-line addition with a real reader — flagging rather
  than fixing, since it is a code change outside a docs-lockstep task's remit.

- **DEV-T5-2** (Chain Step Targeting section was independently stale, pre-P4): mcp-tools.md's
  existing "Chain Step Targeting" prose said selection "resolves positionally: an id target is
  cross-resolved to its ordinal at gate registration" — true before OQ-P4-3/DEV-T4-6 changed
  SELECTION (not just registration) to match `target_step_id === step.nodeId` first, ordinal
  fallback only for id-less steps (`gate-enhancement-service.ts::filterGatesByStepTarget`).
  Corrected in the same edit as the mutation-under-gates note, since leaving the old sentence next
  to the new skipped-node-guard sentence would have stated two different resolution models in one
  section.

- **DEV-T5-3** (prettier, not a source drift): `npx prettier --check` flagged the two docs files
  after editing — table column padding only (my new/edited table rows were not re-aligned to the
  widest cell in column). `npx prettier --write` on the two files changed only the hunks I
  authored (verified via `git diff` hunk ranges before/after); no foreign content in either file
  was touched.

- **DEV-T5-4 (main thread)**: formatTelemetryLine extended with ` · nodes inserted N / skipped M`, rendered ONLY when a mutation happened — an unmutated run's line stays byte-identical to its pre-P4 shape. Closes DEV-T5-1 in-tier because the phase done-criterion names the execution_history SURFACE, and persisted-but-unrendered would have met the letter of the storage row while failing the criterion's reader.
- **DEV-T5-5 (main thread, row 5.4)**: the assembler's two fallback readers went node-id-first with ordinal fallback; the falsification pass required a harness-name fix first (the new tests initially failed on `makeContext` vs the file's actual `createChainContext` — a red for the wrong reason, caught before it could masquerade as behavioral coverage), then the behavioral falsification reddened all 3 tests with the node-id branch neutered.
- **DEV-T5-6 (drive harness)**: dist server ignores `--port` and binds its configured 9090; the drive derives the base URL from the server's own "running on" log line instead of trusting the flag. Worth remembering for every future live drive.

## Validation ledger

(hook-authored + manual entries)

## Validation runs

- 2026-08-12 02:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -8` · ran
- 2026-08-12 02:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:contracts 2>&1 | tail -12` · ran
- 2026-08-12 01:26 · `cd /home/minipuft/Applications/claude-prompts-mcp/server; npm run test:ci 2>&1 | rg "Suites:|Tests:" | head -2; npm run ` · ran
- 2026-08-12 01:25 · `cd /home/minipuft/Applications/claude-prompts-mcp/server; rg -n "nodesInserted" src/shared/types/chain-execution.ts src/` · ran
- 2026-08-12 01:22 · `cd /home/minipuft/Applications/claude-prompts-mcp/server npm run validate:contracts 2>&1 | tail -5` · ran
- 2026-08-12 01:22 · `cd /home/minipuft/Applications/claude-prompts-mcp npx --prefix server prettier --check CLAUDE.md CHANGELOG.md docs/conce` · ran
- 2026-08-12 01:22 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== validate:contracts (final) ===" && npm run validate:c` · ran
- 2026-08-12 01:21 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== validate:format (full doc scope, may be slow) ===" ti` · ran
- 2026-08-12 01:21 · `cd /home/minipuft/Applications/claude-prompts-mcp/server; npm run typecheck 2>&1 | tail -1; npm run lint:ratchet 2>&1 | ` · ran
- 2026-08-12 01:21 · `cd /home/minipuft/Applications/claude-prompts-mcp/server npm run validate:contracts 2>&1 | tail -10` · ran
- 2026-08-12 01:21 · `cd /home/minipuft/Applications/claude-prompts-mcp git diff docs/concepts/chains-lifecycle.md docs/reference/mcp-tools.md` · ran
- 2026-08-12 01:20 · `cd /home/minipuft/Applications/claude-prompts-mcp npx --prefix server prettier --check /tmp/claude-1000/-home-minipuft-A` · ran
- 2026-08-12 01:19 · `cd /home/minipuft/Applications/claude-prompts-mcp/server; cp src/engine/execution/formatting/response-assembler.ts /tmp/` · ran
- 2026-08-12 01:19 · `npm run test:match -- "response-assembler-chain-cta" 2>&1 | rg "Tests:|✕" | head -4; npm run typecheck:tests:ratchet 2>&` · ran
- 2026-08-12 01:19 · `npm run test:match -- "response-assembler-chain-cta" 2>&1 | rg -A 8 "standing on a PLANNED" | head -16` · ran
- 2026-08-12 01:19 · `npm run test:match -- "response-assembler-chain-cta" 2>&1 | rg "✕|●" | head -8` · ran
- 2026-08-12 01:19 · `npm run test:match -- "response-assembler-chain-cta" 2>&1 | tail -4; npm run typecheck 2>&1 | tail -1; npm run typecheck` · ran
- 2026-08-12 01:18 · `npm run validate:contracts 2>&1 | tail -30` · ran
- 2026-08-12 01:18 · `cd /home/minipuft/Applications/claude-prompts-mcp/server; ls /tmp/claude-1000/mp.bak && cp /tmp/claude-1000/mp.bak src/e` · ran
- 2026-08-12 01:17 · `npm run test:match -- "step-lifecycle" 2>&1 | tail -8` · ran
- 2026-08-12 01:12 · `npm run typecheck 2>&1 | tail -1; npm run typecheck:tests:ratchet 2>&1 | tail -1; npm run test:match -- "temporary-gate|` · ran
- 2026-08-12 01:10 · `npm run typecheck 2>&1 | tail -2 && echo "TYPECHECK_EXIT=$?" && npm run typecheck:tests:ratchet 2>&1 | tail -2 && npm ru` · ran
- 2026-08-12 01:08 · `timeout 900 npm run test:integration 2>&1 | tail -8; echo "=== e2e ==="; timeout 900 npm run test:e2e 2>&1 | tail -8` · ran
- 2026-08-12 01:07 · `npm run test:match -- "gate-judge-pipeline-wiring" 2>&1 | tail -12` · ran
- 2026-08-12 01:07 · `python3 - <<'PY' p='tests/integration/gates/gate-judge-pipeline-wiring.test.ts' s=open(p).read() old=""" getChainContext` · ran
- 2026-08-12 01:07 · `timeout 900 npm run test:integration 2>&1 | tail -10; echo "=== SQLite gates ==="; npm run validate:table-contracts 2>&1` · ran
- 2026-08-12 01:06 · `echo "=== validate:arch ==="; npm run validate:arch 2>&1 | tail -6; echo "=== test:ci ==="; timeout 900 npm run test:ci ` · ran
- 2026-08-12 01:06 · `npm run test:match -- "temporary-gate|step-lifecycle|execution-stage|node-step-projection|gate-enhancement|gate-review|i` · ran
- 2026-08-12 01:05 · `python3 - <<'PY' p='tests/unit/execution/pipeline/gate-review-stage.test.ts' s=open(p).read() old=""" getChainContext: j` · ran
- 2026-08-12 01:05 · `npm run test:match -- "gate-review-stage" 2>&1 | sed -n '1,60p'` · ran
- 2026-08-12 01:05 · `echo "=== 3b. test:match (substituted, observes every touched file) ==="; npm run test:match -- "temporary-gate|step-lif` · ran
- 2026-08-12 01:05 · `echo "=== 1. typecheck ==="; npm run typecheck 2>&1 | tail -3 echo "=== 2. typecheck:tests:ratchet ==="; npm run typeche` · ran
- 2026-08-12 01:05 · `NODE_OPTIONS="--experimental-vm-modules" npx jest --listTests --testPathPatterns "temporary-gate|step-lifecycle|executio` · ran
- 2026-08-12 01:05 · `NODE_OPTIONS="--experimental-vm-modules" npx jest --listTests --testPathPatterns "temporary-gate|step-lifecycle|executio` · ran
- 2026-08-12 01:05 · `npx prettier --write tests/integration/chain/step-lifecycle.integration.test.ts tests/unit/gates/services/temporary-gate` · ran
- 2026-08-12 01:05 · `python3 - <<'PY' p='tests/unit/execution/operators/node-step-projection.test.ts' s=open(p).read() old=""" test('a skippe` · ran
- 2026-08-12 01:04 · `npm run test:match -- "node-step-projection" 2>&1 | tail -30` · ran
- 2026-08-12 01:04 · `python3 - <<'PY' p='src/engine/execution/pipeline/stages/20-gate-review-stage.ts' s=open(p).read() old=""" currentNodeId` · ran
- 2026-08-12 01:03 · `npx eslint --format json src/engine/execution/pipeline/stages/20-gate-review-stage.ts src/engine/execution/pipeline/stag` · ran
- 2026-08-12 01:03 · `python3 - <<'PY' p='tests/integration/chain/step-lifecycle.integration.test.ts' s=open(p).read() old=""" // Ties row 4.2` · ran
- 2026-08-12 01:02 · `npm run test:match -- "step-lifecycle" 2>&1 | tail -25` · ran
- 2026-08-12 01:02 · `python3 - <<'PY' p='src/engine/execution/pipeline/stages/20-gate-review-stage.ts' s=open(p).read() old = """ const chain` · ran
- 2026-08-12 01:02 · `npm run test:match -- "step-lifecycle" 2>&1 | sed -n '/reloaded run resumes/,/Progress 3\/4/p' | head -40` · ran
- 2026-08-12 01:01 · `python3 - <<'PY' p='tests/integration/chain/step-lifecycle.integration.test.ts' s=open(p).read() # imports old_imp = "im` · ran
- 2026-08-12 01:00 · `python3 - <<'PY' p='tests/integration/chain/step-lifecycle.integration.test.ts' s=open(p).read() # 1. Extract a module-l` · ran
- 2026-08-12 01:00 · `set -e SC=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpa` · ran
- 2026-08-12 01:00 · `python3 - <<'PY' p='tests/integration/chain/step-lifecycle.integration.test.ts' s=open(p).read() old = """ test('the las` · ran
- 2026-08-12 00:59 · `python3 - <<'PY' p='tests/integration/chain/step-lifecycle.integration.test.ts' s=open(p).read() old = """ let scheduler` · ran
- 2026-08-12 00:58 · `set -e SC=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpa` · ran
- 2026-08-12 00:58 · `set -e SC=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpa` · ran
- 2026-08-12 00:58 · `python3 - <<'PY' p='tests/unit/gates/services/temporary-gate-step-targeting.test.ts' s=open(p).read() old=""" test('an u` · ran
- 2026-08-12 00:58 · `npm run test:match -- "temporary-gate-step-targeting" 2>&1 | tail -50` · ran
- 2026-08-12 00:56 · `python3 - <<'PY' p='src/engine/execution/pipeline/stages/14-injection-control-stage.ts' s=open(p).read() old="import typ` · ran
- 2026-08-12 00:55 · `npx eslint --format json src/ 2>/dev/null | python3 -c " import json,sys d=json.load(sys.stdin) for f in d: for m in f['` · ran
- 2026-08-12 00:55 · `npx eslint --fix src/engine/gates/services/run-step-view.ts src/engine/execution/operators/node-step-projection.ts src/m` · ran
- 2026-08-12 00:54 · `npx eslint src/engine/gates/services/run-step-view.ts src/engine/execution/operators/node-step-projection.ts 2>&1 | tail` · ran
- 2026-08-12 00:54 · `npx eslint src/engine/gates/services/run-step-view.ts src/engine/gates/services/temporary-gate-registrar.ts src/engine/g` · ran
- 2026-08-12 00:54 · `python3 - <<'PY' p='src/mcp/tools/prompt-engine/core/pipeline-builder.ts' s=open(p).read() old = """ const gateService =` · ran
- 2026-08-12 00:52 · `python3 - <<'PY' p='tests/integration/chain/step-lifecycle.integration.test.ts' s=open(p).read() s=s.replace(" expect(at` · ran
- 2026-08-12 00:52 · `npm run test:match -- "step-lifecycle" 2>&1 | sed -n '1,80p'` · ran
- 2026-08-12 00:52 · `npm run test:match -- "step-lifecycle" 2>&1 | tail -60` · ran
- 2026-08-12 00:51 · `npm run test:match -- "step-lifecycle|injection-control|execution-stage|chain-operator" 2>&1 | tail -30` · ran
- 2026-08-12 00:51 · `npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 00:51 · `npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 00:47 · `wc -l tests/integration/chain/step-lifecycle.integration.test.ts; rg -n "^ (test|describe)\(|^ })|loadSessions|dormant|s` · ran
- 2026-08-12 00:40 · `npm run typecheck 2>&1 | tail -1; npm run typecheck:tests:ratchet 2>&1 | tail -1; npm run test:match -- "response-captur` · ran
- 2026-08-12 00:39 · `npm run typecheck 2>&1 | tail -2 && npm run typecheck:tests:ratchet 2>&1 | tail -1 && npm run test:match -- "response-ca` · ran
- 2026-08-12 00:38 · `for f in src/engine/execution/pipeline/stages/16-response-capture-stage.ts src/modules/chains/execution-record-store.ts ` · ran
- 2026-08-12 00:37 · `echo "=== lint on changed src files ==="; npx eslint src/engine/execution/pipeline/stages/16-response-capture-stage.ts s` · ran
- 2026-08-12 00:37 · `echo "=== 4. validate:no-phantom-columns ==="; npm run validate:no-phantom-columns 2>&1 | tail -8 echo "=== 5. validate:` · ran
- 2026-08-12 00:37 · `echo "=== 1. typecheck ==="; npm run typecheck 2>&1 | tail -3 echo "=== 2. typecheck:tests:ratchet ==="; npm run typeche` · ran
- 2026-08-12 00:36 · `npx prettier --write tests/integration/chain/step-lifecycle.integration.test.ts tests/integration/chain/run-telemetry.in` · ran
- 2026-08-12 00:36 · `python3 - <<'PY' p='tests/integration/chain/step-lifecycle.integration.test.ts' s=open(p).read() start=s.index(" test('P` · ran
- 2026-08-12 00:35 · `npm run test:match -- "step-lifecycle" 2>&1 | sed -n '1,40p'` · ran
- 2026-08-12 00:35 · `python3 - <<'PY' p='tests/integration/chain/step-lifecycle.integration.test.ts' s=open(p).read() start=s.index(" test('P` · ran
- 2026-08-12 00:35 · `python3 - <<'PY' p='tests/integration/chain/step-lifecycle.integration.test.ts' s=open(p).read() old=""" test('the rende` · ran
- 2026-08-12 00:34 · `python3 - <<'PY' p='src/engine/execution/pipeline/stages/16-response-capture-stage.ts' s=open(p).read() old=" if (applie` · ran
- 2026-08-12 00:34 · `python3 - <<'PY' p='tests/integration/chain/step-lifecycle.integration.test.ts' s=open(p).read() start = s.index(" test(` · ran
- 2026-08-12 00:34 · `cat > /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/pr` · ran
- 2026-08-12 00:34 · `npm run test:match -- "chain-session-hook-projection" 2>&1 | tail -8` · ran
- 2026-08-12 00:33 · `npm run test:match -- "chain-session-hook-projection" 2>&1 | tail -25` · ran
- 2026-08-12 00:32 · `npm run test:match -- "step-response-capture" 2>&1 | grep -E "●.*›|Tests:"; echo "=== FALSIFY: ledger-derived delta on e` · ran
- 2026-08-12 00:32 · `python3 - <<'PY' p='src/engine/execution/pipeline/stages/16-response-capture-stage.ts' s=open(p).read() # defect A: fire` · ran
- 2026-08-12 00:31 · `npm run test:match -- "step-response-capture" 2>&1 | grep -E "●.*›|Tests:"; echo "=== FALSIFY: fire on every call regard` · ran
- 2026-08-12 00:31 · `python3 - <<'PY' p='src/engine/execution/pipeline/stages/16-response-capture-stage.ts' s=open(p).read() old=" insertedCo` · ran
- 2026-08-12 00:31 · `cp src/engine/execution/pipeline/stages/16-response-capture-stage.ts /tmp/claude-1000/-home-minipuft-Applications-claude` · ran
- 2026-08-12 00:31 · `npm run test:match -- "step-response-capture" 2>&1 | tail -40` · ran
- 2026-08-12 00:30 · `npm run test:match -- "run-telemetry" 2>&1 | tail -30` · ran
- 2026-08-12 00:29 · `npm run test:match -- "response-capture|run-telemetry|step-lifecycle" 2>&1 | grep -E "✕|FAIL|●.*›" | head -20` · ran
- 2026-08-12 00:29 · `npm run test:match -- "response-capture|run-telemetry|step-lifecycle" 2>&1 | tail -30` · ran
- 2026-08-12 00:28 · `npx tsc --noEmit --project tsconfig.test.json 2>&1 | grep -E "run-telemetry|step-lifecycle|execution-record-store|respon` · ran
- 2026-08-12 00:28 · `npm run typecheck 2>&1 | tail -10; echo "=== TESTS TC ==="; npx tsc --noEmit --project tsconfig.test.json 2>&1 | tail -2` · ran
- 2026-08-12 00:26 · `npx eslint src/engine/execution/pipeline/stages/16-response-capture-stage.ts 2>&1 | tail -20` · ran
- 2026-08-12 00:26 · `npx prettier --write src/engine/execution/pipeline/stages/16-response-capture-stage.ts >/dev/null 2>&1; npx eslint src/e` · ran
- 2026-08-12 00:26 · `npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 00:18 · `npm run typecheck 2>&1 | tail -1; npm run typecheck:tests:ratchet 2>&1 | tail -1; npm run test:match -- "chain-run-stora` · ran
- 2026-08-12 00:15 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 900 npm run test:integration 2>&1 | tail -12` · ran
- 2026-08-12 00:14 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 900 npm run test:ci 2>&1 | tail -25` · ran
- 2026-08-12 00:13 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && echo "=== 1. typecheck ===" && npm run typecheck 2>&1 | tail` · ran
- 2026-08-12 00:13 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint scripts eslint-rules --format json 2>/dev/null | ` · ran
- 2026-08-12 00:13 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && node scripts/eslint-ratchet.js check 2>&1 | head -20; echo "` · ran
- 2026-08-12 00:12 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint --format json src/ 2>/dev/null | python3 -c " imp` · ran
- 2026-08-12 00:12 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && python3 - <<'PY' p='src/modules/chains/manager.ts' s=open(p)` · ran
- 2026-08-12 00:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint --format json src/modules/chains/manager.ts src/m` · ran
- 2026-08-12 00:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint --format json src/modules/chains/manager.ts src/m` · ran
- 2026-08-12 00:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -20` · ran
- 2026-08-12 00:10 · `cd /home/minipuft/Applications/claude-prompts-mcp && python3 -m pytest hooks/tests/test_db_reader.py -q 2>&1 | tail -10` · ran
- 2026-08-12 00:10 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/modules/chains/manager.ts src/modules/chains/` · ran
- 2026-08-12 00:10 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && rg -n "toBe\(2[0-9]\)|=== 2[0-9]|schemaVersion" tests/ src/ ` · ran
- 2026-08-12 00:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && echo "=== SUBSTITUTION: sqlite-backend + cli-schema-ownershi` · ran
- 2026-08-12 00:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && echo "=== validate:table-contracts ===" && npm run validate:` · ran
- 2026-08-12 00:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "chain-run-storage|chain-session|manag` · ran
- 2026-08-12 00:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck:tests:ratchet 2>&1 | tail -8` · ran
- 2026-08-12 00:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx tsc --noEmit --project tsconfig.test.json 2>&1 | grep "c` · ran
- 2026-08-12 00:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && echo "=== typecheck ===" && npm run typecheck 2>&1 | tail -4` · ran
- 2026-08-12 00:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && cp /tmp/claude-1000/-home-minipuft-Applications-claude-promp` · ran
- 2026-08-12 00:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && cp src/modules/chains/manager.ts /tmp/claude-1000/-home-mini` · ran
- 2026-08-12 00:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && cat >> tests/unit/chain-session/chain-session-store.test.ts ` · ran
- 2026-08-12 00:07 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "chain-run-storage" 2>&1 | tail -20` · ran
- 2026-08-12 00:07 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "chain-run-storage" 2>&1 | tail -40` · ran
- 2026-08-12 00:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -25` · ran
- 2026-08-12 00:01 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --listTest` · ran
- 2026-08-11 21:45 · `npm run typecheck 2>&1 | tail -2; npm run test:match -- "mutation-policy|node-order|prompt-engine-surface|unknown-observ` · ran
- 2026-08-11 21:44 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== typecheck ===" && npm run typecheck 2>&1 | tail -10 e` · ran
- 2026-08-11 21:42 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== eslint ===" npx eslint src/engine/execution/pipeline/` · ran
- 2026-08-11 21:42 · `cd /home/minipuft/Applications/claude-prompts-mcp/server npx eslint --fix src/engine/execution/pipeline/decisions/mutati` · ran
- 2026-08-11 21:41 · `cd /home/minipuft/Applications/claude-prompts-mcp/server npx eslint src/engine/execution/pipeline/decisions/mutation/ sr` · ran
- 2026-08-11 21:41 · `cd /home/minipuft/Applications/claude-prompts-mcp/server npx eslint src/engine/execution/pipeline/decisions/mutation/ sr` · ran
- 2026-08-11 21:40 · `cd /home/minipuft/Applications/claude-prompts-mcp/server cp /tmp/mutation-policy.ts.bak src/engine/execution/pipeline/de` · ran
- 2026-08-11 21:40 · `cd /home/minipuft/Applications/claude-prompts-mcp/server python3 - <<'EOF' path = "src/engine/execution/pipeline/decisio` · ran
- 2026-08-11 21:40 · `cp /tmp/mutation-policy.ts.bak src/engine/execution/pipeline/decisions/mutation/mutation-policy.ts npm run test:match --` · ran
- 2026-08-11 21:40 · `cp src/engine/execution/pipeline/decisions/mutation/mutation-policy.ts /tmp/mutation-policy.ts.bak sed -i 's/if (targetO` · ran
- 2026-08-11 21:40 · `npm run test:match -- "prompt-engine-surface|unknown-observation-processor" 2>&1 | tail -20` · ran
- 2026-08-11 21:40 · `npm run test:match -- "mutation-policy|node-order|prompt-schema" 2>&1 | tail -20 && echo "---VALIDATE-CONTRACTS---" && n` · ran
- 2026-08-11 21:40 · `npx tsc --noEmit --project tsconfig.test.json 2>&1 | tail -20; echo "---"; npm run typecheck:tests:ratchet 2>&1 | tail -` · ran
- 2026-08-11 21:39 · `npx tsc --noEmit --project tsconfig.test.json 2>&1 | grep "mutation-policy"; echo "exit:$?"` · ran
- 2026-08-11 21:38 · `npx tsc --noEmit --project tsconfig.test.json 2>&1 | grep "mutation-policy"` · ran
- 2026-08-11 21:38 · `npm run typecheck:tests:ratchet 2>&1 | tail -60` · ran
- 2026-08-11 21:38 · `npm run test:match -- "mutation-policy|node-order|prompt-schema|prompt-engine-surface|unknown-observation-processor" 2>&` · ran
- 2026-08-11 21:38 · `npm run test:match -- "mutation-policy|node-order|prompt-schema|prompt-engine-surface|unknown-observation-processor" 2>&` · ran
- 2026-08-11 21:37 · `npm run test:match -- "prompt-engine-surface" 2>&1 | tail -40` · ran
- 2026-08-11 21:37 · `NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBand --testPathPatterns "mutation-policy|node-order|prompt-sche` · ran
- 2026-08-11 21:37 · `npm run test:match -- "mutation-policy|node-order|prompt-schema" 2>&1 | grep -i "PASS\|FAIL"` · ran
- 2026-08-11 21:37 · `npm run test:match -- "mutation-policy|node-order|prompt-schema" 2>&1 | tail -100` · ran
- 2026-08-11 21:37 · `npm run typecheck 2>&1 | tail -60` · ran
- 2026-08-11 21:30 · `npm run validate:contracts 2>&1 | tail -30` · ran
