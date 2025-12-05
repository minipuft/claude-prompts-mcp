# Plan: Injection System Simplification and Pipeline Reordering

**Status**: In Progress
**Created**: 2025-12-04

---

## Problem Statement

The injection module has two critical issues:
1. **Pipeline ordering is wrong**: InjectionControlStage (07b) runs AFTER PromptGuidanceStage (06b), so decisions come too late
2. **Decisions are not consumed**: Single prompts ignore `state.injection`; chains use metadata workaround; 06b uses legacy inverted field

## Goals

- **Keep**: 7-level hierarchical resolution (modifier → runtime → step → chain → category → global → system-default)
- **Simplify**: Remove unnecessary service complexity
- **Reorder**: Move injection decisions BEFORE prompt guidance
- **Fix**: Ensure all consumers read `context.state.injection`

---

## Phase 1: Pipeline Reordering

**Objective**: Move injection decisions earlier so they can control downstream stages.

### Current Order (BROKEN) - from prompt-execution-pipeline.ts lines 191-211
```
 1. RequestNormalization
 2. DependencyInjection
 3. ExecutionLifecycle
 4. CommandParsing
 5. InlineGateExtraction
 6. OperatorValidation
 7. ExecutionPlanning
 8. JudgeSelection (06a)
 9. GateEnhancement (05)
10. FrameworkResolution (06)
11. PromptGuidance (06b)      ← Applies guidance BEFORE injection decision!
12. SessionManagement (07)    ← Populates currentStep
13. InjectionControl (07b)    ← Makes decisions TOO LATE!
14. ResponseCapture (08)
15. StepExecution (09)
16. GateReview (10)
17. CallToAction (11)
18. ResponseFormatting (10)
19. PostFormattingCleanup (12)
```

### New Order (FIXED)
```
 1-7. [Same as before - pre-processing stages]
 8. JudgeSelection (06a)
 9. GateEnhancement (05)
10. FrameworkResolution (06)
11. SessionManagement (07)    ← MOVED EARLIER (before injection)
12. InjectionControl (07b)    ← NOW BEFORE PromptGuidance
13. PromptGuidance (06b)      ← NOW AFTER injection decisions
14. ResponseCapture (08)
15. StepExecution (09)
16-19. [Same as before]
```

### Files to Modify

1. **Update pipeline order** in `prompt-execution-pipeline.ts` (lines 191-211):
   - Move `sessionStage` BEFORE `promptGuidanceStage`
   - Move `frameworkInjectionControlStage` BEFORE `promptGuidanceStage`
   - New order in `registerStages()`:
     ```typescript
     this.stages = [
       // ... stages 1-10 same ...
       this.frameworkStage,         // 10. Framework resolution
       this.sessionStage,           // 11. MOVED: Session management (populates currentStep)
       this.frameworkInjectionControlStage, // 12. MOVED: Injection decisions
       this.promptGuidanceStage,    // 13. NOW AFTER: Uses injection decisions
       this.responseCaptureStage,   // 14. Response capture
       // ... rest same ...
     ];
     ```

2. **Keep stage file name** (no rename needed):
   - `07b-injection-control-stage.ts` - name reflects logical position, not execution order
   - Stage numbering is documentation, not enforcement

---

## Phase 2: Simplify Internal Services (DEFERRED)

**Objective**: Reduce service count while keeping 7-level resolution.

### Current Structure (4 services)
```
/execution/injection/
├── injection-decision-service.ts  ← Coordinator
├── decision-resolver.ts           ← 7-level hierarchy
├── condition-evaluator.ts         ← Conditional rules
├── session-overrides.ts           ← Runtime overrides
```

### Decision
Keep all services for now. Evaluate simplification after pipeline reordering is complete.

---

## Phase 3: Fix Decision Consumers

**Objective**: Make all consumers read `context.state.injection` instead of legacy fields.

### 3.1 PromptGuidanceStage (06b)

**File**: `server/src/execution/pipeline/stages/06b-prompt-guidance-stage.ts`

**Current** (lines 234-248):
```typescript
// Check if Framework Stage already applied system prompt to prevent duplication
const frameworkAlreadyApplied = context.state.framework.systemPromptApplied;

const guidance = await this.promptGuidanceService!.applyGuidance(prompt, {
  includeSystemPromptInjection: !frameworkAlreadyApplied,  // INVERTED legacy
  ...
});
```

**Change to**:
```typescript
// Use injection decision from InjectionControlStage (now runs BEFORE this stage)
const injectionDecision = context.state.injection?.systemPrompt;
const includeSystemPrompt = injectionDecision?.inject ?? true;

const guidance = await this.promptGuidanceService!.applyGuidance(prompt, {
  includeSystemPromptInjection: includeSystemPrompt,  // Direct boolean, no inversion
  ...
});
```

### 3.2 StepExecutionStage (09) - Single Prompts

**File**: `server/src/execution/pipeline/stages/09-execution-stage.ts`

**Current** (lines 148-227):
- Checks `context.frameworkContext?.systemPrompt`
- Checks `hasFrameworkGuidance(prompt.systemMessage)`
- Uses `context.frameworkAuthority.decide()` for modifiers
- Does NOT read `context.state.injection`

**Change to**:
```typescript
const injectionDecision = context.state.injection?.systemPrompt;
if (injectionDecision?.inject === false) {
  // Skip framework guidance injection
}
```

### 3.3 StepExecutionStage (09) - Chain Steps

**Current**: Passes `metadata['suppressFrameworkInjection']` to executor

**Change**: Pass `context.state.injection` to executor directly, remove metadata workaround

### 3.4 ChainOperatorExecutor

**File**: `server/src/execution/operators/chain-operator-executor.ts`

**Current** (line 395):
```typescript
const suppressFrameworkInjection = chainContext['suppressFrameworkInjection'] === true;
```

**Change to**:
```typescript
const injectionState = chainContext.injectionState;
const suppressFrameworkInjection = injectionState?.systemPrompt?.inject === false;
```

---

## Phase 4: Remove Legacy Compatibility Layer

**Objective**: Delete inverted semantics and dual-mode state population.

### 4.1 InjectionControlStage - Remove Legacy Population

**File**: `server/src/execution/pipeline/stages/07b-injection-control-stage.ts`

**Remove** (lines 214-240):
```typescript
// DUAL MODE: Also populate legacy state for backward compatibility
this.populateLegacyState(context, injectionState);
```

And the entire `populateLegacyState` method.

### 4.2 Remove Legacy State Fields

**File**: `server/src/execution/pipeline/state/internal-state.ts` (or wherever defined)

**Remove** from `framework` state:
- `systemPromptApplied` (inverted boolean - confusing)
- Keep `lastSystemPromptInjectionStep` but move to `injection` state

### 4.3 Remove Metadata Workaround

**Remove**: `context.metadata['suppressFrameworkInjection']` usage everywhere

---

## Phase 5: Add previousStepResult Tracking

**Objective**: Support Dynamic Nunjucks Chain Orchestration.

### 5.1 Session Context Enhancement

**File**: `server/src/chain-session/types.ts`

**Add**:
```typescript
interface SessionContext {
  // ... existing fields
  previousStepResult?: 'success' | 'failure' | 'partial';
  previousStepQualityScore?: number;
}
```

### 5.2 ResponseCaptureStage Enhancement

**File**: `server/src/execution/pipeline/stages/08-response-capture-stage.ts`

**Add**: Capture step result status and quality score (if gate evaluation provides one)

### 5.3 InjectionDecisionInput Enhancement

**File**: `server/src/execution/injection/types.ts`

**Already has**: `previousStepResult?: 'success' | 'failure' | 'partial'`

**Need**: Wire it up from session context

---

## Implementation Order

1. **Phase 1**: Pipeline reordering (most critical)
2. **Phase 3**: Fix consumers to read new state
3. **Phase 4**: Remove legacy compatibility
4. **Phase 5**: Add previousStepResult (for future features)
5. **Phase 2**: Simplify services (deferred)

---

## Critical Files

| File | Changes |
|------|---------|
| `server/src/execution/pipeline/prompt-execution-pipeline.ts` | Reorder stages (Session → Injection → Guidance) |
| `server/src/execution/pipeline/stages/07b-injection-control-stage.ts` | Remove `populateLegacyState` method |
| `server/src/execution/pipeline/stages/06b-prompt-guidance-stage.ts` | Read `state.injection` instead of legacy field |
| `server/src/execution/pipeline/stages/09-execution-stage.ts` | Read `state.injection` for single/chain execution |
| `server/src/execution/operators/chain-operator-executor.ts` | Use `injectionState` instead of metadata flag |
| `server/src/chain-session/types.ts` | Add `previousStepResult`, `previousStepQualityScore` |
| `server/src/execution/context/internal-state.ts` | Remove `systemPromptApplied` from framework state |

---

## Testing Strategy

1. **Unit tests**: Update existing injection tests for new stage position
2. **Integration tests**: Verify `%clean`, `%lean` modifiers actually suppress injection
3. **Chain tests**: Verify per-step injection frequency works
4. **system_control tests**: Verify runtime overrides work

---

## Success Criteria

- [ ] `%clean` modifier suppresses system prompt for SINGLE prompts (currently broken)
- [ ] `%lean` modifier suppresses style guidance (verify)
- [ ] Chain step injection frequency works (step 1 vs step N)
- [ ] `system_control injection:override` works
- [ ] No legacy `systemPromptApplied` references remain
- [ ] No `suppressFrameworkInjection` metadata workaround remains
