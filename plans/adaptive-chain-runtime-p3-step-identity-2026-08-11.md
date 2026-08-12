---
title: "P3 Step Identity + Registry Retirement — Implementation Plan"
date: 2026-08-11
status: active
tags: []
---

# P3 — Step Identity + Registry Retirement

Master plan: `plans/adaptive-chain-runtime-2026-08-09.md` §P3 (D5 amended: P3 absorbs the `chain_run_registry` retirement).
Discovery: `plans/adaptive-chain-runtime-p3-discovery-2026-08-11.md` (consumer enumeration; design stance RATIFIED by this plan with amendments below).
Produced by `chain-implementation_plan#2`, 2026-08-11 — planning in-thread, verification legwork dispatched to a subagent (path-verification worker).

## Phase 1 — Discovery (summary; full detail in discovery file)

- Position minted at exactly 2 sites: `04-parsing-stage.ts:151`, `symbolic-operator-parser.ts:742` (`stepNumber: index + 1`) — re-verified live.
- Python hook module API leaks step ints (`db_reader.py:293-294,:444-445`); consumers: gemini-prompts + opencode-prompts; minipuft-plugins zero. Dict keys are cross-repo public API — must not change shape.
- ChainStepSchema (prompt-schema.ts:75) has NO id; stepName is the enforced-unique key (:463/:570). `ChainSession.currentStepId` unused skeleton (chain-session.ts:109).
- advanceStep census: exactly 6 call sites outside the store — gate-verdict-processor.ts :175/:248/:395/:420, step-capture-service.ts :215/:256.
- 3 latent identity→cardinality coercion bugs: manager.ts:1881, argument-history-tracker.ts:257, 21-formatting-stage.ts:168.

## Phase 2 — Design (ratified stance + amendments)

**Stance (ratified)**: node ID = internal identity; integer position = derived projection computed at the three boundaries (hook dict, state-blob keys, `v_execution_status`) — external shapes byte-compatible, zero cross-repo breakage. Optional `id` on ChainStepSchema (default: slug of stepName; parser chains mint frozen `n1..nK`). The three P2 lifecycle defects are acceptance criteria. Per-row `chain_runs` + `chain_run_nodes` replace the registry blob inside the preserved `persistSessions()` transaction.

**Amendments added by this run**:

- `execution_records` gains nullable `node_id` column (identity without renumbering the append-only log; `step_number` stays as ordinal-at-write).
- The three registry mapping dicts (`runMapping`/`baseRunMapping`/`runToBase`) are NOT stored — rebuilt from `chain_id`/`base_chain_id` columns at load.
- `advanceStep` keeps its name; param becomes nodeId; returns `{nodeId: string|null, ordinal: number} | false` (null = run complete).
- `executionOrder` becomes `string[]` (node IDs).
- Unused `currentStepId` skeleton deleted (replaced by `state.currentNodeId`).

**Interfaces** (contract-first):

```ts
// prompt-schema.ts
ChainStepSchema += id?: string  // kebab-case, unique per chain

// chain-execution.ts
interface ChainNode { id: string; promptId: string; stepName: string }
interface ChainState {
  currentNodeId: string | null;   // null = complete
  nodes: ChainNode[];             // frozen order at run creation; P4 mutates in-txn
  lastUpdated: number;
  stepStates?: Map<string, StepMetadata>;
}

// shared/utils/node-order.ts (NEW, pure — moved from modules/chains/ per D2, dependency-cruiser)
mintNodeIds(steps) · mintSequentialIds(count) · ordinalOf(nodes, id) · totalOf(nodes) · nextAfter(nodes, id) · isTerminal(nodes, id)

// chain-session.ts
advanceStep(sessionId, nodeId): Promise<{nodeId: string|null, ordinal: number} | false>
executionOrder: string[]
```

```sql
CREATE TABLE chain_runs (
  session_id TEXT PRIMARY KEY, chain_id TEXT NOT NULL, base_chain_id TEXT NOT NULL,
  run_owner_pid TEXT NOT NULL, organization_id TEXT, workspace_id TEXT,
  run_status TEXT NOT NULL, current_node_id TEXT,
  state TEXT NOT NULL,  -- residual document: blueprint, originalArgs, ledger, pending reviews, telemetry counters
  created_at INTEGER, last_activity INTEGER, run_completed_at INTEGER
);
CREATE TABLE chain_run_nodes (
  session_id TEXT NOT NULL, node_id TEXT NOT NULL,
  position INTEGER NOT NULL,  -- per-run order, mutable only in-txn; NOT identity
  prompt_id TEXT NOT NULL, step_name TEXT, milestone TEXT, updated_at INTEGER,
  PRIMARY KEY (session_id, node_id)
);
-- chain_run_registry DDL (sqlite-engine.ts:636) DELETED; SCHEMA_VERSION 21→22
-- execution_records += node_id TEXT NULL
```

Pre-flight: 0 failures (probed; evidence in chain transcript). Compound: none.

## Phase 2.5 — Verified paths (Phase 3 rows use ONLY these)

| Cited                                                    | Actual                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/gates/services/gate-verdict-processor.ts             | **src/engine/gates/services/gate-verdict-processor.ts** (advanceStep :175,:248,:395,:420)                                                                 |
| src/gates/services/hierarchy-resolver.ts                 | **src/engine/execution/pipeline/decisions/injection/internal/hierarchy-resolver.ts** (scopeId :216, targeting :250-269; owner = InjectionDecisionService) |
| src/engine/execution/text-refs/index.ts                  | **src/modules/text-refs/index.ts** (chainStepResults :19)                                                                                                 |
| src/engine/execution/context/argument-history-tracker.ts | **src/modules/text-refs/argument-history-tracker.ts** (:247-257)                                                                                          |

Exact (no drift): manager.ts :384/:408/:445/:989/:1881 · 18-execution-stage :63-64/:111 · step-capture :215/:256 · sqlite-engine chain_sessions :545, registry DDL :636, view :700-708 · table-contracts registry :272 · execution-record-store INSERT :118 · prompt-engine.schema :43 · prompt-schema :75 · db_reader.py :293-294/:444-445. Temp gates: src/engine/gates/core/temporary-gate-registry.ts + src/engine/gates/services/temporary-gate-registrar.ts. No shims detected.

## Phase 3 — Plan table

### Tier 1: Additive identity surface (no behavior change) — ✓ COMPLETE 2026-08-11

| #   | Status | File                                                                                                                                                                                                                                                                                                                     | Change                                                                                                                                                                                                                                                                                       | Verify                                                               |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | ✓      | src/modules/prompts/prompt-schema.ts                                                                                                                                                                                                                                                                                     | ChainStepSchema += `id?: string` (kebab regex); dup-explicit-id rejection added at :477/:593. **Authored-vs-measured (D1)**: plan claimed stepName uniqueness was enforced at :463/:570 — FALSE, those sites only built soft-warning Sets; the id check is NEW enforcement, not an extension | dup-id tests + falsification green                                   |
| 2   | ✓      | chain-execution.ts + shared/types/index.ts + operators/types.ts + parsers/types/operator-types.ts                                                                                                                                                                                                                        | ChainNode added. **Measured (D3)**: TWO parsed-step types exist, not one — `ChainStepPrompt` (04-parsing-stage) and `ExecutionStep` (symbolic-operator-parser); both got `nodeId?: string` **OPTIONAL** (D4: ≥30 fixture files) — row 6b flips required                                      | typecheck                                                            |
| 3   | ✓      | **src/shared/utils/node-order.ts** (SUPERSEDES modules/chains/ path — D2: dependency-cruiser `engine-no-modules-or-mcp-value` forbids engine→modules value imports; siblings chain-id-codec.ts/chainUtils.ts already live there)                                                                                         | all 6 pure fns as specced + mintSequentialIds                                                                                                                                                                                                                                                | 23 unit tests at tests/unit/shared/node-order.test.ts (D8 placement) |
| 4   | ✓      | 04-parsing-stage.ts (:147-156) + symbolic-operator-parser.ts (:743-760) + **symbolic-command-builder.ts (:230 — D5, third construction site the plan missed; without it minted ids were dropped one hop later)**                                                                                                         | mint + attach + propagate                                                                                                                                                                                                                                                                    | falsification: 4 mutations reddened 4 distinct tests                 |
| 5   | ✓      | ~~resource-manager.schema.ts + cli-shared/index.ts~~ **premise false (D7): zero chain-step shape references in either.** Real mirrors (D6): yaml-prompt-loader.ts `normalizeChainSteps` + `LoadedPromptFile` + canonical `ChainStep` (shared/types/index.ts:636) — without these the YAML `id` was inert past validation | typecheck + yaml-to-prompt-data tests                                                                                                                                                                                                                                                        |

**Tier 1 gate**: ✓ PASSED main-thread 2026-08-11 — typecheck clean · lint:ratchet OK (no regressions) · typecheck:tests:ratchet OK (385 baseline) · test:ci 174/174 suites, 2106 tests. Falsification 4/4 distinct. Execution record + D1-D9 in implementation-notes.

**Tier 1 discovered rows (appended per realignment)**:

| #   | Status                       | File                                                                                                                           | Change                                                                                                                                                                   | Verify                    |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| 6b  | ☐ (Tier 2)                   | operators/types.ts + parsers/types/operator-types.ts + fixtures                                                                | flip `nodeId?: string` → required on ChainStepPrompt + ExecutionStep once the store consumes node ids                                                                    | typecheck + tests ratchet |
| F1  | ☐ (backlog, condition-gated) | mcp/tools/types/shared-types.ts, prompt-engine/core/types.ts, modules/resources/*, skills-sync/service.ts, resource-indexer.ts | read-side display/index step shapes gain `id` ONLY when a display/export consumer needs it — check at Tier 5 docs pass                                                   | rg + consumer check       |
| F2  | ☐ (backlog)                  | markdown-prompt-parser.ts + cli-shared/resource-scaffold.ts                                                                    | markdown-embedded chains have no `id:` support (always slug from stepName — consistent with OQ1 default, not a regression); scaffold template could show `# id:` example | cosmetic; not P3-blocking |

### Tier 2: Atomic type flip — ✓ COMPLETE 2026-08-11

| #   | Status                       | Change (as landed)                                                                                                                                                                                                                                                                                                                                       | Verify                                                                                                                |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 6   | ✓                            | ChainState flipped (chain-execution.ts:362-364); ordinal arithmetic has ONE definition — `currentOrdinal`/`nodeIdAt` added to node-order.ts (not nine copies)                                                                                                                                                                                            | typecheck + snapshot suite                                                                                            |
| 7   | ✓                            | executionOrder string[]; currentStepId deleted; service re-keyed; advanceStep returns {nodeId, ordinal}                                                                                                                                                                                                                                                  | typecheck                                                                                                             |
| 8   | ✓                            | manager.ts +225/-74. **Measured (worker)**: stats bug's only consumer is `averageStepsPerChain` (observability-resources.ts:210) — old code made the average CLIMB during runs; now totalOf. Load shim covers all THREE position-keyed structures (D13: plan named one — stepStates + executionOrder also re-keyed on load, `// Tier 4 removes` markers) | **NEW tests/unit/chain-session/chain-session-hook-projection.test.ts (14 tests)** — byte-parity pinned on active rows |
| 9   | ✓                            | 6 caller sites re-keyed. **Falsification gap found (D20)**: mutating resolveNodeId survived 466 tests — every gate test mocks advanceStep without asserting WHICH node; 5 new tests added                                                                                                                                                                | gate-verdict units + new asserts                                                                                      |
| 10  | ✓                            | stages 13/16/21 changed (+106/-12); 14/18/20 needed no edit (consume derived ordinal unchanged); 13-session resolves by nodeId with ordinal fallback                                                                                                                                                                                                     | integration 501/501                                                                                                   |
| 11  | ✓                            | **D17**: containers keyed by nodeId BUT ordinal stored inside the record — `buildChainVariables` derives `stepN_result` names from ordinals, so emitted names stay byte-identical with zero renderer change                                                                                                                                              | argument-history suite                                                                                                |
| 12  | ✓                            | stepsExecuted = executed-node count with fallback (D18/D19)                                                                                                                                                                                                                                                                                              | run-telemetry suite                                                                                                   |
| 6b  | ✓ resolved-as-optional (D10) | required-flip reddened 43 errors / 8 files (>25 threshold) — both fields STAY optional; `buildChainNodes` warns + falls back to sequential ids when a parsed chain arrives unminted (detector at consumption, where it can fire — mint sites always set the field so an assert there is vacuous)                                                         | typecheck + warn path                                                                                                 |

**Tier 2 gate**: ✓ PASSED main-thread 2026-08-11 — typecheck clean · lint:ratchet OK (3208 total but every rule at/below ceiling; per-rule diff shows −107/−41/−38 on top rules — ratchet ceiling ≠ measurement) · tests:ratchet 385 baseline · test:ci 175/2123 · test:integration 41/501 · validate:arch OK (3 pre-existing type-only warnings). Falsification: 6 mutations → 6 distinct reddened tests (incl. rewritten double-advance case: guard defends advancing PAST a node, not re-advancing the same one — idempotency covers that). D10-D20 in notes.

**Tier 2 discovered rows**:

| #   | Status             | Change                                                                                                                                                                                                                                                                                                                                                                                                                               | Verify                    |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| F3  | ☐ (rule at Tier 5) | `{{step1_result}}` unreachable for real chains — buildChainVariables emits `step${ordinal+1}_result` while manager stores 1-based ordinals, so step 1 renders as step2_result; `resources/prompts/analysis/notes` documents step1_result..step4_result which cannot match. PRE-EXISTING (byte-parity required reproducing it). Decide: fix off-by-one (behavior change, needs its own falsification + doc sweep) or document reality | repro test then rule      |
| F4  | ☐ (debt sweep)     | deletion candidates measured at zero callers: `isStepComplete` (0 callers in src/+tests/), `ReviewContext.totalSteps` (0 readers in src/ — why its coercion bug survived)                                                                                                                                                                                                                                                            | rg + knip                 |
| N1  | note for Tier 3    | `isSessionActiveForHooks` hides a run parked on its final step (`currentStep < totalSteps`) unless a review is pending — pinned by test as-is; Tier 3's completion-semantics change must decide whether final-step-awaiting-verdict becomes hook-visible                                                                                                                                                                             | Tier 3 brief carries this |

### Tier 3: Lifecycle defect fixes + ID targeting — ✓ COMPLETE 2026-08-11

| #   | Status              | Change (as landed)                                                                                                                                                                                                                                                                                                                                                                                                                                                | Verify                                                                                  |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 13  | ✓                   | Latch at manager.ts:1151 (advanceStep past terminal → transitionRunStatus 'completed'); stage 18 + `buildChainFooter` + `buildFinalStepMessage` (D23 — plan missed the second liar) + shared `isRunComplete` predicate (chain-session.ts:169); **D24 bonus defect**: 13-session isChainComplete used the same ordinal lie as auto-restart input — resuming a final-step run without chain_id silently restarted it from step 1; re-pointed at isRunComplete       | step-lifecycle suite; falsification 1+2                                                 |
| 14  | ✓                   | **OQ6 trace OVERTURNED the plan's site (D21)**: gap is in GateReviewStage (stage 20) — stage 13 creates the first pending review so stage 18 early-exits at :47 and stage 20 renders step 1 with no append; step-capture-service is not a render site at all. Fix: `ledgerFirstRenderedStep()` on stage 20 (:55, called :155/:221), executionRecordStore injected via pipeline-builder, guarded to create-new/force-restart (resume already has its stage-18 row) | step-lifecycle: step-1 ledgered + every-planned-step ledgered; falsification 3          |
| 15  | ✓                   | **D25: plan named ChainSessionRouter — measured: resumes never reach it.** Earliest session-holding point is 13-session-stage BEFORE createPendingGateReviewIfNeeded; terminal check there returns completion notice WITHOUT publishing sessionContext (load-bearing — publishing re-opens downstream stages)                                                                                                                                                     | step-lifecycle: already-complete notice, no review; falsification 4                     |
| 16  | ✓                   | `target_step_id` union addition (schema :43 region, registrar resolveStepTarget cross-resolves BOTH forms at registration — D26: enhancement-service selects positionally per OQ5, so id-only targets must gain an ordinal or select nothing; unresolvable ids warn, never drop); contracts regenerated; **D27: index.ts had NO foreign hunks (brief premise false); prompt-engine.json foreign hunks verified intact line-by-line**                              | temporary-gate-step-targeting suite (162 lines); falsification 5+5b; validate:contracts |
| 17  | ✓                   | NEW tests/integration/chain/step-lifecycle.integration.test.ts — 432 lines (authored ~150), drives ONLY the public client surface, constructs no internal state; modeled on run-telemetry harness                                                                                                                                                                                                                                                                 | suite green; is the falsification vehicle for 1-4                                       |
| N1  | ✓ evidence, no code | final-step-pending runs ARE hook-visible via the pendingGateReview clause (manager.ts:521-531); pinned test green unchanged; completed runs exit via terminal-status clause                                                                                                                                                                                                                                                                                       | hook-projection suite                                                                   |

**Tier 3 gate**: ✓ PASSED main-thread 2026-08-11 — typecheck clean · both ratchets baseline · test:ci 176/2134 · test:integration 42/506 · validate:contracts green · validate:arch OK (4th type-only warning matches existing pattern). Falsification 6/6 distinct. D21-D28 in notes.

**Tier 3 discovered rows**:

| #   | Status                   | Change                                                                                                                                                                                                                                                    | Verify                           |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| F5  | ☐ (P4 candidate)         | gated-chain call pattern is 2 calls/step (stage 13 opens step N's review on the call AFTER N renders — render and gate never share a call); honest now but doubles client round-trips                                                                     | measure in P4 design             |
| F6  | ☐ (P4, declared finding) | `target_step_id` is registered + carried but NEVER selected by id — enhancement-service matches positionally (OQ5). Declared-but-unread field until P4 mutation semantics; if P4 slips, this is a reader-without-producer finding                         | rg at P4 open                    |
| F7  | ☐ (watch)                | concurrent session actively rewriting tooling/contracts/prompt-engine.json (13 unicode re-escapes + force_restart description mid-tier); generate:contracts proven NOT the cause; if encoding flip-flops persist the file needs a canonical writer ruling | git log after both sessions land |

### Tier 4: Storage swap — ✓ COMPLETE 2026-08-11

| #   | Status | Change (as landed)                                                                                                                                                                                                                                                                                                                                                                                                | Verify                                                                               |
| --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 18  | ✓      | DDL at sqlite-engine.ts:668/:689; registry DDL deleted; SCHEMA_VERSION 22 with reasoning docblock. **D30**: DROPPED_ON_THIS_BUMP needs NO declaration — exclusion set is consulted only inside the durable-tables loop (:438-445) and the registry was ephemeral; set stays empty, DROPPED_AT_VERSION stays 19                                                                                                    | sqlite-backend suite; falsification 1                                                |
| 19  | ✓      | 2 new contracts with ZERO accepted exceptions (**D31**: registry's acceptedForeignWriters entry NOT recreated — deleteRunsForOwners() moved the DELETE into the owner); chain_sessions rebuiltFrom re-pointed; **D29**: plan's single `milestone TEXT` under-specified — StepMetadata has 5 fields, isPlaceholder genuinely read (step-capture:73/77); 4 companion columns, not a JSON blob (OQ3's own rationale) | both SQLite gates; falsification 2a/2b/2c                                            |
| 20  | ✓      | run-registry.ts rewritten in place (+303/−22). **D32**: current_node_id COLUMN is the single source (residual deliberately omits it, pinned by test). **D33**: only chainSessionMapping needed rebuilding — ensureRunMappingConsistency() derives the other two via stripRunNumber; base_chain_id stored/indexed but NOT the rebuild input (one derivation, not two)                                              | NEW chain-run-storage.integration.test.ts (357 lines, 9 tests); falsification 3/3b/4 |
| 21  | ✓      | per-row writes inside SAME txn as projectToHookView; mapping serialization deleted; Tier 2 compat shim REMOVED. Atomicity falsification took two attempts — an in-memory double issues no SQL so it CANNOT fail; passing version drives the real engine with a DatabasePort throwing on the chain_sessions INSERT                                                                                                 | rollback test; hook-projection suite green unchanged; falsification 5                |
| 22  | ✓      | PersistedChainRunRegistry: zero hits src/+tests/                                                                                                                                                                                                                                                                                                                                                                  | rg gate; falsification 8                                                             |
| 23  | ✓      | node_id threaded through ExecutionRecord + all 4 writers (stage 18 working, stage 20 first-render, stage 21 terminal, pipeline failure); value-dead probe asserts non-NULL read-back                                                                                                                                                                                                                              | no-phantom-columns; falsification 2c/7                                               |
| 24  | ✓      | v22 literals + table list; mirrored DDL updated in THREE suites (plan named two — run-telemetry also mirrors); **D34**: 65-line position-keyed-upgrade suite DELETED (pins a path that cannot execute at v22); **D35**: mirrors + swallowing append() = silent drift — new suite drives the REAL SqliteEngine instead of a fourth mirror                                                                          | test:integration 43/515                                                              |

**Tier 4 gate**: ✓ PASSED main-thread 2026-08-11 — typecheck clean · lint:ratchet 3200/1020 · tests:ratchet 385 · test:ci 176/2133 · test:integration 43/515 · both SQLite gates OK (pre-existing declared exceptions only) · validate:arch OK. Falsification 8/8. D29-D37 in notes.

**Tier 4 discovered rows**:

| #   | Status             | Change                                                                                                                                                                                                                                                             | Verify                                      |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| F8  | ☐ (Tier 5 row 25)  | hooks/lib/db_reader.py:363 still SELECTs the dropped registry (D36 — guarded, degrades to no-fallback-row; a fallback that can never return a row) + 4 test fixtures; docs naming the registry (overview.md, chains-lifecycle.md, project-decisions.md, CHANGELOG) | rg chain_run_registry across hooks/ + docs/ |
| F9  | ☐ (debt sweep)     | append() swallows SQL errors while three suites mirror its DDL — schema drift has no direct detector (suite docblocks claim otherwise)                                                                                                                             | design at debt sweep                        |
| F10 | ☐ (P4 decision)    | getLatestSessionForBaseChain filters dormant with no includeDormant option → returns undefined for every cold-loaded run after restart (pre-existing; blob load also demoted) — P4 resume semantics must decide                                                    | rg + P4 design                              |
| F11 | ☐ (contract vocab) | chain_run_nodes scope carried transitively via parent row but ScopeKind has no "scoped-via-parent" vocabulary — candidate `scopedVia` field                                                                                                                        | table-contracts type                        |

### Tier 5: Docs + live drive — ✓ COMPLETE 2026-08-11 · **P3 PHASE COMPLETE**

| #   | Status | Change (as landed)                                                                                                                                                                                                                                                                                                                                 | Verify                                                           |
| --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 25  | ✓      | 7 docs updated (chains-lifecycle +55, mcp-tools +43 incl. Chain Step Targeting section, overview, sqlite-persistence rule 9→10 tables, root CLAUDE.md runtime-state table, project-decisions §3, CHANGELOG Added/Changed/Fixed); F3 documented as reality (stepN_result off-by-one); foreign hunks intact per-file; prettier clean on edited files | docs checks + rg sweeps                                          |
| F8  | ✓      | db_reader.py dead registry read path removed (−38); test fixtures updated (−80); final registry sweep = 9 hits, all legitimately historical, zero live SQL                                                                                                                                                                                         | pytest 223/223 + validate:python green (after fixture fix below) |
| 26  | ✓      | **Live drive (main thread): ALL FOUR CRITERIA OBSERVED** — completes on final verdict (no nudge); planned 3 / executed 3 with step-1 row; already-complete resume ×9 probes, zero reviews re-opened; mid-run hook view current_step=2/total_steps=3 as ints with per-row tables live. Full record in implementation-notes §Tier 5 row 26           | drive logs + direct DB reads                                     |

**Tier 5 gate**: ✓ PASSED — full suite + both SQLite gates + arch + contracts + verify:mcp 12/12 + pytest 223/223 + observed live signal.

**Tier 5 discovered rows (main-thread fixes + follow-ups)**:

| #       | Status                     | Change                                                                                                                                                                                                                                                                                        | Verify                                                 |
| ------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| D38-fix | ✓ (main thread)            | **Stale views survive schema bumps** — CREATE VIEW IF NOT EXISTS never replaces; bump recreate drops tables only; live v22 file still ran the pre-v20 broken view. Fix: `applyViews()` drop+recreate on every boot (applySchema + version-match path)                                         | live DB verified refreshed; table-contracts gate green |
| D39-fix | ✓ (main thread)            | **Chain-session persistence silently dead on every fresh server** — constructor init early-returns before the runtime's late-bound setDatabasePort, which never re-armed. Fix: setter chains deferred init onto initPromise. PRE-EXISTING (hooks worked only via the old-build plugin server) | probe: 0 rows → full projection; full gate green       |
| D42-fix | ✓ (main thread)            | applyViews split broke hooks `_extract_server_schema()` (read only the FIRST exec literal) → 8 pytest red. Fix: fixture concatenates every exec literal in source order                                                                                                                       | pytest 223/223                                         |
| F12     | ☐ (backlog)                | docs/reference/chain-schema.md Step Schema table lacks the new `id` field (natural home; wasn't in row 25's list — worker D39)                                                                                                                                                                | add row + example                                      |
| F13     | ☐ (follow-up)              | db_reader `_session_to_hook_state()` nested-state fallback branch plausibly dead now no writer emits that shape (worker D40) — separately-scoped removal                                                                                                                                      | trace + pytest                                         |
| F14     | ☐ (cosmetic)               | completing response appends a stale `Next: chain_id=… user_response=…` CTA line AFTER the completion footer                                                                                                                                                                                   | response-assembler CTA guard                           |
| F15     | ☐ (watch)                  | lint:ratchet total fluctuates (3199→3208→3200→3204) across runs with no JS/TS edits — per-rule always at/below ceiling; ratchet non-determinism worth a look (worker D41 + tier observations)                                                                                                 | reproduce + scripts/eslint-ratchet.js                  |
| F16     | ☐ (pre-existing docs debt) | overview.md Global-Persistent-State table lists pre-kv_state table names; project-decisions.md carries stale version/schema numbers                                                                                                                                                           | future docs refresh                                    |
| —       | trigger FIRED              | silent prompt-load-null second occurrence (`resume_variant_build` — {id,name,prompt} steps never valid, loader returns null silently) → prompt-evolution backlog item 2 promotes to implementation                                                                                            | backlog memory updated                                 |

**P3 done criteria — ALL MET** (linear chains identical end-to-end via live drive; completion latches on final verdict; step 1 ledgered; already-complete resume; hook dict byte-parity; registry fully retired with both SQLite gates green; full suite + arch + verify:mcp green). Commit pending user approval — scope: 101 files, +3270/−801 vs HEAD (plus 25 untracked new files incl. plans and tests), interleaved in the tree with the concurrent session's foreign hunks (hunk-split staging required for: sqlite-engine.ts, parser-utils.ts, command-parser.ts, response-assembler.ts, prompt-engine.json, package.json, scripts/, hooks/prompt-suggest.py, mcp-tools.md, overview.md).

## Execution Dispatch

| Work                  | Agent                                                                                                | Why                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Tier 1                | sonnet subagent                                                                                      | bounded additive, mechanical verify                                 |
| Tier 2                | opus (high) subagent                                                                                 | atomic wide type-flip; wrong-approach failure shape                 |
| Tier 3                | opus subagent                                                                                        | lifecycle semantics decision-bearing; OQ5/OQ6 ruled before dispatch |
| Tier 4                | opus subagent                                                                                        | storage swap + contract gates; serializes on live DB schema         |
| Tier 5 row 25         | sonnet subagent                                                                                      | docs from landed behavior                                           |
| Row 26 + ALL judgment | **MAIN THREAD** — gate verdicts, tier acceptance, OQ rulings, live drive, scope check never delegate |

## Open Questions (rule before dependent tier)

| #   | Question                          | Default                                                                                | Alternative                                       | Blocks        |
| --- | --------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------- |
| OQ1 | Symbolic-chain mint scheme        | frozen `n1..nK` at parse; P4 insertions get fresh suffixed ids                         | promptId-slug+counter                             | Tier 1        |
| OQ2 | Completed-run projection sentinel | reproduce today's `totalOf+1` exactly; **verify against live pre-migration row first** | emit totalSteps                                   | Tier 2        |
| OQ3 | stepStates storage                | per-row in chain_run_nodes.milestone                                                   | Map in residual JSON                              | Tier 4        |
| OQ4 | chain_sessions.state blob         | unchanged full-session JSON                                                            | shrink to hook subset                             | Tier 4        |
| OQ5 | hierarchy-resolver scopeId (:216) | stays ordinal-keyed (targeting is positional by semantics)                             | nodeId-keyed (premature until P4)                 | Tier 3        |
| OQ6 | step-1 record append site         | step-capture-service mirroring resume path; trace actual chain-start flow FIRST        | pipeline (16-response-capture) if gap lives there | Tier 3 row 14 |

## Phase 4-6 — Validation & Completion

### Testing strategy

| What to test                             | Type            | Location                                                                   | Why                                       |
| ---------------------------------------- | --------------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| mint stability, dedup, ordinal math      | unit            | tests/unit/chains/node-order.test.ts (NEW, beside sibling unit convention) | pure fns, edge-heavy                      |
| store re-key + projections byte-equal    | unit + snapshot | tests/unit/chain-session/chain-session-store.test.ts                       | hook-view rows must be identical pre/post |
| 3 lifecycle defects via REAL client flow | integration     | tests/integration/chain/step-lifecycle.integration.test.ts (NEW)           | test-reachable ≠ client-reachable         |
| per-row save→load round-trip             | integration     | tests/integration/chain/ (extend)                                          | storage swap equivalence                  |
| schema bump + mirrors                    | integration     | sqlite-backend.test.ts, execution-record-store.integration.test.ts         | P2 deviations 3-4 precedent               |
| target_step_id acceptance                | unit            | schema tests                                                               | union addition correctness                |
| end-to-end + hook parity                 | live drive      | main thread, throwaway server                                              | only layer that catches choreography lies |

### Done criteria

| Criterion                           | Validation                                    | Pass                                                                                |
| ----------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Linear chains behave identically    | live drive + integration                      | drive completes with identical rendered contract                                    |
| Completion latches on final verdict | live drive                                    | runStatus 'completed', no extra call, honest footer                                 |
| Step 1 ledgered                     | execution_history                             | `planned 3 / executed 3`                                                            |
| Post-completion resume              | live drive                                    | "already complete", no review                                                       |
| Hook dict shape unchanged           | python read of chain_sessions                 | keys + int types identical                                                          |
| Registry fully retired              | rg + gates                                    | 0 hits PersistedChainRunRegistry/chain_run_registry (code); both SQLite gates green |
| Full suite                          | validation suite + validate:arch + verify:mcp | all green                                                                           |

### Documentation

| Doc                                 | Update                                                 |
| ----------------------------------- | ------------------------------------------------------ |
| docs/concepts/chains-lifecycle.md   | node identity, completion semantics, per-row storage   |
| docs/reference/mcp-tools.md         | target_step_id, chain YAML `id` field                  |
| .claude/rules/sqlite-persistence.md | table map: registry out, chain_runs/chain_run_nodes in |
| CHANGELOG.md                        | entry below                                            |
| CLAUDE.md runtime-state table       | registry row replaced                                  |

### Risks

| Risk                                                                                | Impact                        | Mitigation                                                                                | Rollback                                           |
| ----------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Projection arithmetic drifts from today's bytes                                     | hooks misread runs cross-repo | snapshot equality test (row 8) + OQ2 live-row verification                                | revert commit; tables ephemeral, no data migration |
| Tier 2 flip too large for one worker session                                        | stalled tier                  | flip is type-driven; typecheck errors enumerate remaining sites; worker iterates to green | re-dispatch with error list                        |
| Hidden registry reader outside census                                               | runtime break                 | census measured (4 files); rg gate in row 22                                              | restore type + blob writer from git                |
| Concurrent session's uncommitted foreign hunks (sqlite-engine getInstance, parsers) | merge conflicts mid-execution | hunk-split staging as in P2; workers edit additively, never checkout                      | —                                                  |
| SCHEMA_VERSION bump drops durable tables                                            | version_history loss          | ensureSchema snapshots durables by design; both SQLite gates                              | restore from snapshot path                         |

### Release

- commit_convention: `feat(chains): address steps by stable node ids; retire chain_run_registry into per-row tables`
- scope: `chains`

### Growth capture

- [ ] Third sighting of the dispatch pattern (tier_execute Phase 4-D) — grade the codification per prompt-evolution backlog
- [ ] Path-drift rate (4/17 files) in a subagent-produced discovery doc — candidate correction: discovery workers must emit `fd`-verified paths
- [ ] Snapshot-equality test as the standard tool for "projection must not change bytes" migrations

## Deviations

See `plans/adaptive-chain-runtime-p3-step-identity-2026-08-11-implementation-notes.md` (created before first edit).
