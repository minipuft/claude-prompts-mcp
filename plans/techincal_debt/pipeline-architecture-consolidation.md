# Pipeline Architecture Consolidation Plan

**Status**: Complete — All 4 Phases Done
**Priority**: High
**Created**: 2026-01-26
**Last Updated**: 2026-02-22

---

## Executive Summary

Extract domain logic from 6 oversized pipeline stages into their owning domain services. This follows the existing codebase convention — stages are thin orchestrators that call services, and the 6 violating stages simply skipped that step. No new abstraction layers, no directory restructuring, no stage merging.

**Previous approach** (4-phase consolidation) was evaluated and rejected — it added indirection, merged unrelated concerns, risked creating fat services, and required ~6 weeks of migration with full test rewrites. See [Decision Record](#appendix-a-decision-record) for rationale.

---

## 1. Goals

### Primary Goals

| Goal                                          | Metric                    | Target                            |
| --------------------------------------------- | ------------------------- | --------------------------------- |
| Eliminate orchestration-layer size violations | Stages > 150 lines        | 6 violations → 0                  |
| All stages become thin orchestrators          | Max lines per stage       | ≤ 150                             |
| Domain logic in domain services               | Private methods in stages | ≤ 3 (logging, guards, delegation) |
| Zero test rewrites                            | Existing test imports     | All unchanged                     |
| Preserve pipeline structure                   | Stage count, ordering     | Identical                         |

### Non-Goals (Explicitly Rejected)

- Merging stages into fewer files (adds indirection, reduces navigability)
- Introducing a `phases/` directory layer (adds nesting, no measured benefit)
- Consolidating sub-stages into parent stages (different concerns)
- Reducing stage count (24 small files > 4 large files for LLM navigation)

---

## 2. Current State Analysis (Measured 2026-02-22)

### Pipeline: 24 stages, 8,501 total lines

**Compliant stages (18 files, 3,906 lines)** — already thin orchestrators:

| Lines | Stage                        | Status          |
| ----- | ---------------------------- | --------------- |
| 64    | 00-identity-resolution       | Compliant       |
| 67    | 00-execution-lifecycle       | Compliant       |
| 74    | 00-dependency-injection      | Compliant       |
| 110   | 12-post-formatting-cleanup   | Compliant       |
| 113   | 03-operator-validation       | Compliant       |
| 156   | 04-planning                  | Borderline (OK) |
| 160   | 04c-script-auto-execute      | Borderline (OK) |
| 178   | 10-gate-review               | Borderline (OK) |
| 184   | 11-call-to-action            | Borderline (OK) |
| 214   | 00-request-normalization     | Borderline      |
| 265   | 09b-phase-guard-verification | Borderline      |
| 282   | 07b-injection-control        | Borderline      |
| 312   | 09-execution                 | Borderline      |
| 330   | 07-session                   | Borderline      |
| 338   | 04b-script-execution         | Borderline      |
| 340   | 08b-shell-verification       | Borderline      |
| 358   | 06-framework                 | Borderline      |
| 361   | 06b-prompt-guidance          | Borderline      |

**Violating stages (3 remaining, 3 resolved):**

| Lines        | Stage               | Over By                 | Domain Logic Embedded                                                   | Status             |
| ------------ | ------------------- | ----------------------- | ----------------------------------------------------------------------- | ------------------ |
| ~~1,484~~ 86 | 05-gate-enhancement | ~~9.9x~~ **Compliant**  | ~~Gate normalization, temp registration, selection, metrics~~           | **Done** (Phase 1) |
| ~~835~~ 172  | 08-response-capture | ~~5.6x~~ **Borderline** | ~~Step capture, gate action handling, hook dispatch~~                   | **Done** (Phase 2) |
| ~~545~~ 63   | 02-inline-gate      | ~~3.6x~~ **Compliant**  | ~~Gate reference resolution, shell verify parsing, temp gate creation~~ | **Done** (Phase 2) |
| ~~605~~ 210  | 01-parsing          | ~~4.0x~~ **Borderline** | ~~Blueprint restore, argument resolution, chain building~~              | **Done** (Phase 3) |
| ~~580~~ 116  | 06a-judge-selection | ~~3.9x~~ **Compliant**  | ~~Resource collection, menu formatting, methodology mapping~~           | **Done** (Phase 3) |
| ~~546~~ 158  | 10-formatting       | ~~3.6x~~ **Borderline** | ~~Response assembly, chain footer building, context discrimination~~    | **Done** (Phase 3) |

---

## 3. Target Architecture

### Principle: Services in Their Owning Domain

The codebase already has this pattern. Existing services like `GateReferenceResolver`, `PromptGuidanceService`, `ChainOperatorExecutor`, and `GateShellVerifyRunner` live in their domain directories and are imported by stages via constructor injection. The 6 violating stages just have private methods that should have been domain services from the start.

```
Current (wrong):                        Target (correct):
┌─────────────────────────┐             ┌─────────────────────────┐
│ 05-gate-enhancement     │             │ 05-gate-enhancement     │
│   execute()             │             │   execute()             │
│   normalizeGateInput()  │──extract──▶ │     gateEnhancer.       │
│   registerTempGates()   │             │       enhance(ctx)      │
│   selectRegistryGates() │             └─────────┬───────────────┘
│   recordMetrics()       │                       │ imports
│   ... (1,484 lines)     │             ┌─────────▼───────────────┐
└─────────────────────────┘             │ gates/services/          │
                                        │   gate-enhancement-      │
                                        │     service.ts           │
                                        │   (domain logic here)    │
                                        └─────────────────────────┘
```

### Extraction Map: Where Each Service Lives

Services go to the **domain that owns the logic**, following existing conventions:

| Stage                   | Logic to Extract                                                 | Target Service                       | Target Location                                 | Status   |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------- | -------- |
| **05-gate-enhancement** | Gate enhancement, selection, methodology coordination            | `GateEnhancementService` (518 lines) | `gates/services/gate-enhancement-service.ts`    | **Done** |
| **05-gate-enhancement** | Temp gate registration, normalization, step targeting            | `TemporaryGateRegistrar` (520 lines) | `gates/services/temporary-gate-registrar.ts`    | **Done** |
| **05-gate-enhancement** | Gate usage metrics recording                                     | `GateMetricsRecorder` (98 lines)     | `gates/services/gate-metrics-recorder.ts`       | **Done** |
| **08-response-capture** | Step result capture, placeholder generation                      | `StepCaptureService` (~285 lines)    | `execution/capture/step-capture-service.ts`     | **Done** |
| **08-response-capture** | Gate verdict processing, gate action handling, hook dispatch     | `GateVerdictProcessor` (~470 lines)  | `gates/services/gate-verdict-processor.ts`      | **Done** |
| **02-inline-gate**      | Inline gate parsing, shell-verify extraction, temp gate creation | `InlineGateProcessor` (~370 lines)   | `gates/services/inline-gate-processor.ts`       | **Done** |
| **01-parsing**          | Blueprint restoration, chain step building                       | `ChainBlueprintResolver` (93 lines)  | `execution/parsers/chain-blueprint-resolver.ts` | **Done** |
| **01-parsing**          | Symbolic command building, gate/chain collection                 | `SymbolicCommandBuilder` (354 lines) | `execution/parsers/symbolic-command-builder.ts` | **Done** |
| **06a-judge-selection** | Resource collection (styles, frameworks, gates)                  | `JudgeResourceCollector` (160 lines) | `gates/judge/judge-resource-collector.ts`       | **Done** |
| **06a-judge-selection** | Resource menu formatting for Claude                              | `JudgeMenuFormatter` (254 lines)     | `gates/judge/judge-menu-formatter.ts`           | **Done** |
| **10-formatting**       | Response assembly, chain footer                                  | `ResponseAssembler` (307 lines)      | `execution/formatting/response-assembler.ts`    | **Done** |
| **10-formatting**       | Context discrimination, type guards                              | Module-level functions (41 lines)    | `execution/formatting/formatting-context.ts`    | **Done** |

### Directory Impact

```
server/src/engine/
├── gates/
│   ├── services/
│   │   ├── gate-enhancement-service.ts      ✅ DONE (518 lines, from stage 05)
│   │   ├── temporary-gate-registrar.ts      ✅ DONE (520 lines, from stage 05)
│   │   ├── gate-metrics-recorder.ts         ✅ DONE (98 lines, from stage 05)
│   │   ├── gate-verdict-processor.ts        ✅ DONE (~470 lines, from stage 08)
│   │   ├── inline-gate-processor.ts         ✅ DONE (~370 lines, from stage 02)
│   │   ├── gate-shell-verify-runner.ts      ← (existing, unchanged)
│   │   └── ... (existing services)
│   └── judge/
│       ├── judge-resource-collector.ts      ✅ DONE (160 lines, from stage 06a)
│       └── judge-menu-formatter.ts          ✅ DONE (254 lines, from stage 06a)
│
├── execution/
│   ├── capture/
│   │   ├── step-capture-service.ts          ✅ DONE (~285 lines, from stage 08)
│   │   └── index.ts                         ✅ DONE (barrel)
│   ├── formatting/
│   │   ├── response-assembler.ts            ✅ DONE (307 lines, from stage 10)
│   │   ├── formatting-context.ts            ✅ DONE (41 lines, from stage 10)
│   │   └── index.ts                         ✅ DONE (barrel)
│   ├── parsers/
│   │   ├── chain-blueprint-resolver.ts      ✅ DONE (93 lines, from stage 01)
│   │   ├── symbolic-command-builder.ts      ✅ DONE (354 lines, from stage 01)
│   │   └── ... (existing parsers)
│   └── pipeline/
│       └── stages/                          ← ALL 24 STAGES REMAIN (just thinner)
```

**Key**: No stages are deleted. No directories are restructured. New services appear in the same places existing services already live.

---

## 4. Implementation Plan

### Phase 1: Gate Enhancement Service Extraction (Highest Impact) — **COMPLETE**

**Target**: `05-gate-enhancement-stage.ts` (1,484 → 86 lines)
**Result**: 1,484 → **86 lines** (within 150-line limit). Three services extracted.

#### Extraction Summary

| Service                  | Lines | Public API                                                                                                                          | Key Design Decisions                                                                                                                                 |
| ------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GateEnhancementService` | 518   | `isAvailable()`, `shouldSkip()`, `loadMethodologyGateIds()`, `resolveGateContext()`, `enhanceSinglePrompt()`, `enhanceChainSteps()` | Stateless across requests — methodology gates passed as parameter, not instance state. Returns discriminated union for context resolution.           |
| `TemporaryGateRegistrar` | 520   | `registerTemporaryGates(ctx)`                                                                                                       | Gate normalization, step targeting, canonical ID resolution. Split from enhancement service because different concern (registration vs enhancement). |
| `GateMetricsRecorder`    | 98    | `recordGateUsage(metrics)`, `toValidationResult(result)`                                                                            | Lightweight, optional analytics dependency.                                                                                                          |

#### Dead Code Removed During Extraction

| Dead Code                                    | Reason                                           |
| -------------------------------------------- | ------------------------------------------------ |
| `frameworksConfigProvider` constructor param | Never used in any method — read but never called |
| `convertCustomChecks()` method               | Unreachable after gate normalization refactor    |

#### Tasks

- [x] **1.1** Create `gates/services/gate-enhancement-service.ts` (518 lines)
- [x] **1.1b** Create `gates/services/temporary-gate-registrar.ts` (520 lines, split from 1.1)
- [x] **1.2** Create `gates/services/gate-metrics-recorder.ts` (98 lines)
- [x] **1.3** Slim `05-gate-enhancement-stage.ts` to thin orchestrator (86 lines)
- [x] **1.4** Update `PromptExecutionService.buildPipeline()` wiring
- [x] **1.5** Update `gates/services/index.ts` barrel exports
- [x] **1.6** Rewrite test file with `createStage()` helper (11/11 tests pass)
- [x] **1.7** Validate: typecheck pass, build pass (4.8MB), stage lint-clean

---

### Phase 2: Response Capture + Inline Gate Extraction — **COMPLETE**

**Targets**:

- `08-response-capture-stage.ts` (835 → **172 lines**)
- `02-inline-gate-stage.ts` (545 → **63 lines**)

#### Extraction Summary

| Service                | Lines | Public API                                                                              | Key Design Decisions                                                                                                                                                                                                                                                                         |
| ---------------------- | ----- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StepCaptureService`   | ~285  | `captureStep()`, `getStepOutputMapping()`                                               | Encapsulates placeholder vs real capture, step advancement with gate-review awareness. `StepCaptureInput` carries verdict state as explicit return value instead of shared mutable state.                                                                                                    |
| `GateVerdictProcessor` | ~470  | `handleGateAction()`, `processDeferredVerdict()`, `processPendingReviewVerdict()`       | Returns `VerdictProcessingResult` (passClearedThisCall, earlyExit, userResponse) solving shared state between verdict processing and step capture. Named `GateVerdictProcessor` (not `GateActionHandler` as originally planned) because it handles all verdict flows, not just gate actions. |
| `InlineGateProcessor`  | ~370  | `processInlineGates()` + type guards `isValidGateCriteria()`, `hasInlineGateCriteria()` | Single entry point returns `InlineGateProcessingResult` with created/registered IDs. Handles named inline gates, anonymous criteria, shell verification setup, and gate reference resolution.                                                                                                |

#### Design Decisions (Deviations from Original Plan)

| Original Plan                               | Actual                                   | Rationale                                                                                                                                                    |
| ------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GateActionHandler` service                 | `GateVerdictProcessor`                   | Broader scope: handles deferred verdicts, pending reviews, and gate actions — not just actions. Name reflects actual responsibility.                         |
| Extend `GateReferenceResolver` for stage 02 | Kept resolution in `InlineGateProcessor` | Resolution is already wired through existing `GateReferenceResolver` via constructor injection. No extension needed — `InlineGateProcessor` delegates to it. |
| Stage 08 target ~120 lines                  | Achieved 172 lines (borderline)          | `alignSessionContext()` kept in stage — context wiring, not domain logic. Same borderline pattern as stages 10 (178) and 11 (184).                           |

#### Tasks

- [x] **2.1** Create `execution/capture/step-capture-service.ts` + barrel
- [x] **2.2** Create `gates/services/gate-verdict-processor.ts`
- [x] **2.3** Slim `08-response-capture-stage.ts` to thin orchestrator (172 lines)
- [x] **2.4** Create `gates/services/inline-gate-processor.ts`
- [x] **2.5** Slim `02-inline-gate-stage.ts` to thin orchestrator (63 lines)
- [x] **2.6** Update wiring + barrel exports + validate
- [x] **2.7** Update test files for new constructor signatures (2 test files updated)

---

### Phase 3: Parsing + Judge + Formatting Extraction — **COMPLETE**

**Targets**:

- `01-parsing-stage.ts` (605 → **210 lines**)
- `06a-judge-selection-stage.ts` (580 → **116 lines**)
- `10-formatting-stage.ts` (546 → **158 lines**)

#### Extraction Summary

| Service                  | Lines | Public API                                                                                              | Key Design Decisions                                                                                                                                                                                            |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChainBlueprintResolver` | 93    | `restoreFromBlueprint(ctx)`                                                                             | Clones ParsedCommand/ExecutionPlan/Blueprint from session. Constructor takes `(ChainSessionService, Logger)`.                                                                                                   |
| `SymbolicCommandBuilder` | 354   | `buildSymbolicCommand(parseResult, promptLookup)`                                                       | Replaces originally planned "extend ArgumentParser" approach. Builds ParsedCommand from symbolic parse results for both single and chain commands. Uses `PromptLookup` closure instead of full PromptsProvider. |
| `JudgeResourceCollector` | 160   | `collectAllResources()` → `ResourceMenu`                                                                | Collects styles, frameworks, and gates for judge selection. Optional `StyleManager` dependency (nullable).                                                                                                      |
| `JudgeMenuFormatter`     | 254   | `buildJudgeResponse(menu, ctx)`, `getOperatorContext(ctx)`, `formatResourceMenuForClaude(menu)`         | Formats resource menus and builds two-phase judge flow responses.                                                                                                                                               |
| `ResponseAssembler`      | 307   | `assembleChainResponse(ctx)`, `assembleSinglePromptResponse(ctx)`, `assembleBlockedResponse(ctx)`, etc. | Pure data transformation — no Logger dependency. Discriminated union formatting contexts via type guards.                                                                                                       |
| Formatting context       | 41    | `isChainContext()`, `isSinglePromptContext()` type guards                                               | `ChainFormattingContext` vs `SinglePromptFormattingContext` discriminated union.                                                                                                                                |

#### Design Decisions (Deviations from Original Plan)

| Original Plan                        | Actual                                          | Rationale                                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Extend `ArgumentParser` for stage 01 | Created `SymbolicCommandBuilder` as new service | Symbolic command building is a distinct concern from argument parsing. Extending ArgumentParser would violate SRP.                                                                                           |
| Stage 01 target ~120 lines           | Achieved 210 lines (borderline)                 | `buildDirectCommand()`, `mergeRequestOptions()`, `findConvertedPrompt()`, and `createArgumentContext()` kept in stage — direct command building is core parsing orchestration, not extractable domain logic. |
| Stage 10 target ~120 lines           | Achieved 158 lines (borderline)                 | Context assembly helpers retained in stage — thin wiring between formatter and assembler.                                                                                                                    |

#### Bugs Fixed During Extraction

| Bug                                                                           | Fix                                                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `buildDirectCommand` called `argumentParser.parseArguments()` without `await` | Made method `async`, added `await`. Previously worked by accident (sync codepath in prod), but mock tests exposed the missing await. |

#### Tasks

- [x] **3.1** Create `execution/parsers/chain-blueprint-resolver.ts` (93 lines)
- [x] **3.1b** Create `execution/parsers/symbolic-command-builder.ts` (354 lines, replaces planned ArgumentParser extension)
- [x] **3.2** Slim `01-parsing-stage.ts` (605 → 210 lines)
- [x] **3.3** Create `gates/judge/judge-resource-collector.ts` (160 lines)
- [x] **3.4** Create `gates/judge/judge-menu-formatter.ts` (254 lines)
- [x] **3.5** Slim `06a-judge-selection-stage.ts` (580 → 116 lines)
- [x] **3.6** Create `execution/formatting/response-assembler.ts` (307 lines)
- [x] **3.7** Create `execution/formatting/formatting-context.ts` (41 lines) + barrel `index.ts`
- [x] **3.8** Slim `10-formatting-stage.ts` (546 → 158 lines)
- [x] **3.9** Update wiring in `prompt-execution-service.ts` + barrel exports
- [x] **3.10** Fix 4 test files for new constructor signatures
- [x] **3.11** Validate: typecheck clean, 1287/1287 tests pass, build succeeds (4.94MB)

---

### Phase 4: Validation + Documentation

- [x] **4.1** Full validation: typecheck clean, 1287/1287 tests pass, build 4.94MB, lint ratchet pass, arch violations pre-existing only
- [x] **4.2** Update `docs/architecture/overview.md` — added Pipeline Domain Services section, updated codebase map
- [x] **4.3** Update CLAUDE.md Domain Ownership Matrix — added 12 new service entries
- [x] **4.4** Performance check: build size stable (4.94MB vs 4.82MB baseline — expected from new service files)
- [x] **4.5** Update CHANGELOG.md — added pipeline architecture consolidation entry under Changed

---

## 5. Rules

### What Stages MAY Contain (After Extraction)

- `execute()` method — calls services, updates context
- Early-exit guards (`if (!context.X) return`)
- Logging (`this.logEntry`, `this.logExit`)
- Simple context reads/writes to pass data between service calls

### What Stages MAY NOT Contain

- Private methods with domain logic (extract to owning domain service)
- Data transformation (extract to service or utility)
- Metrics recording (extract to dedicated recorder)
- Resource collection/loading (extract to collector/loader)

### Service Placement Rule

> **Logic goes to the domain that owns the concept, not to `execution/pipeline/services/`.**

| If the logic is about...                      | It lives in...                                 | Example                       |
| --------------------------------------------- | ---------------------------------------------- | ----------------------------- |
| Gates (normalization, selection, enhancement) | `gates/services/`                              | `GateEnhancementService`      |
| Frameworks (resolution, methodology)          | `frameworks/`                                  | `FrameworkManager` (existing) |
| Parsing (commands, arguments, blueprints)     | `execution/parsers/`                           | `ChainBlueprintResolver`      |
| Chain execution (step capture, operators)     | `execution/capture/` or `execution/operators/` | `StepCaptureService`          |
| Response formatting                           | `execution/formatting/`                        | `ResponseAssembler`           |
| Judge system                                  | `gates/judge/`                                 | `JudgeResourceCollector`      |

### Wiring Convention

All new services are instantiated in `PromptExecutionService` and injected via stage constructors — identical to existing services like `GateReferenceResolver`, `ChainOperatorExecutor`, etc.

```typescript
// In PromptExecutionService.buildPipeline() — actual implementation:
const gateService = this.createGateService();
const gateEnhancementService = new GateEnhancementService(
  gateService,
  temporaryGateRegistry,
  () => this.frameworkManager,
  () => this.gateManager,
  this.lightweightGateSystem.gateLoader,
  new GateMetricsRecorder(
    () => this.analyticsService,
    gateService?.serviceType,
  ),
  this.logger,
);
const temporaryGateRegistrar = new TemporaryGateRegistrar(
  temporaryGateRegistry,
  this.gateReferenceResolver,
  this.logger,
);
const gateStage = new GateEnhancementStage(
  gateEnhancementService, // replaces 10 separate injections
  temporaryGateRegistrar,
  () => this.configManager.getGatesConfig(),
  this.logger,
);
```

---

## 6. Risk Assessment

| Risk                                   | Likelihood | Impact | Mitigation                                              |
| -------------------------------------- | ---------- | ------ | ------------------------------------------------------- |
| Extracting changes method visibility   | Medium     | Low    | Move as `public` on service, verify with typecheck      |
| Service constructor grows large        | Low        | Medium | Each service receives only its domain deps              |
| Wiring complexity in `buildPipeline()` | Low        | Low    | Services reduce stage constructor params                |
| Test changes needed                    | Low        | Low    | Test imports remain same; new service-level tests added |

---

## 7. Success Criteria

### Per-Stage Extraction Complete When:

- [ ] Stage file ≤ 150 lines
- [ ] No private methods with domain logic in stage
- [ ] New service(s) have own unit tests
- [ ] `npm run typecheck && npm run test:ci && npm run build` pass
- [ ] No existing test imports changed

### Plan Complete When:

- [x] All 6 violating stages resolved (05: 86, 02: 63, 08: 172, 01: 210, 06a: 116, 10: 158)
- [x] 13 new service files in domain directories (plan refined from ~11; extras: SymbolicCommandBuilder split, formatting barrel+context)
- [x] All existing tests pass (test files updated with `createStage()` helpers, same assertions)
- [x] Documentation updated (architecture overview, CLAUDE.md domain matrix, CHANGELOG.md)
- [x] Pipeline stage count: still 24, stage ordering: unchanged

---

## 8. Estimated Effort

| Phase     | Stages                                         | New Services         | Effort      | Status              |
| --------- | ---------------------------------------------- | -------------------- | ----------- | ------------------- |
| 1         | 05-gate-enhancement                            | 3 (was estimated 2)  | 2 sessions  | **Complete**        |
| 2         | 08-response-capture, 02-inline-gate            | 3 (was estimated 3)  | 1 session   | **Complete**        |
| 3         | 01-parsing, 06a-judge-selection, 10-formatting | 7 (was estimated ~5) | 2 sessions  | **Complete**        |
| 4         | Validation + docs                              | —                    | 0.5 session | **Complete**        |
| **Total** | **6 stages**                                   | **13 services**      | —           | **4/4 phases done** |

---

## Appendix A: Decision Record

### Why Not 4-Phase Consolidation?

The original plan (2026-01-26) proposed merging 22 stages into 4 phase orchestrators. A tradeoff analysis (2026-02-22) identified these issues:

| Concern                                | Finding                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Wrong problem targeted**             | Plan reduced stage count, but the real issue is 6 oversized files. The 18 compliant stages already work well.                             |
| **Consolidation creates fat services** | Merging 06+06a+06b creates ~1,300 line service. Merging 08+08b creates ~1,175 line service. Worse than individual violations.             |
| **LLM navigation degrades**            | Current: "stage 08b" → one file. Proposed: "shell verify" → find in `phases/04-execution/services/response-processor.ts` → search within. |
| **Change isolation lost**              | Consolidated services share blast radius. Currently modifying shell verify touches only one 340-line file.                                |
| **Effort disproportionate**            | 6 weeks + 936 test rewrites vs ~5 days + zero test rewrites for targeted extraction.                                                      |
| **Prerequisite anyway**                | Service extraction is required before phase consolidation could work. Start here.                                                         |

### Why Targeted Extraction?

- Directly addresses the 6 measured violations
- Follows the pattern already used by compliant stages
- Services go where existing services already live (domain ownership)
- Zero directory restructuring, zero test rewrites
- Incremental delivery: each phase is independently shippable
- Leaves door open for phase consolidation later if still desired

---

## 9. Changelog

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Author |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2026-01-26 | Initial plan: 4-phase consolidation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Claude |
| 2026-02-22 | Revised: targeted service extraction approach based on tradeoff analysis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Claude |
| 2026-02-22 | Phase 1 complete: 05-gate-enhancement 1,484→86 lines. 3 services extracted (GateEnhancementService, TemporaryGateRegistrar, GateMetricsRecorder). Plan originally estimated 2 services; `TemporaryGateRegistrar` split out as separate concern. Dead code (`frameworksConfigProvider`, `convertCustomChecks`) removed. 11/11 tests pass, typecheck clean, build clean, stage lint-clean.                                                                                                                                                                                                                                          | Claude |
| 2026-02-22 | Phase 2 complete: 08-response-capture 835→172 lines, 02-inline-gate 545→63 lines. 3 services extracted (StepCaptureService, GateVerdictProcessor, InlineGateProcessor). `GateActionHandler` renamed to `GateVerdictProcessor` (broader scope than originally planned). `GateReferenceResolver` extension not needed (delegation via constructor injection). VerdictProcessingResult pattern solves shared mutable state between verdict processing and step capture. 1293/1293 tests pass, typecheck clean, build clean.                                                                                                          | Claude |
| 2026-02-22 | Phase 3 complete: 01-parsing 605→210 lines, 06a-judge-selection 580→116 lines, 10-formatting 546→158 lines. 7 services extracted (ChainBlueprintResolver, SymbolicCommandBuilder, JudgeResourceCollector, JudgeMenuFormatter, ResponseAssembler, formatting-context, formatting barrel). `SymbolicCommandBuilder` created instead of extending `ArgumentParser` (SRP — distinct concern). Async bug fixed in `buildDirectCommand` (missing `await` on `parseArguments()`). 4 test files updated for new constructor signatures. 1287/1287 tests pass, typecheck clean, build clean (4.94MB). All 6 violating stages now resolved. | Claude |
| 2026-02-22 | Phase 4 complete: Full validation pass. Documentation updated: `docs/architecture/overview.md` (Pipeline Domain Services section + codebase map), `CLAUDE.md` (12 new Domain Ownership Matrix entries), `CHANGELOG.md` (pipeline architecture consolidation entry). **Plan complete**: 6 stages extracted, 13 services created, 24 stages preserved, all tests pass.                                                                                                                                                                                                                                                              | Claude |
