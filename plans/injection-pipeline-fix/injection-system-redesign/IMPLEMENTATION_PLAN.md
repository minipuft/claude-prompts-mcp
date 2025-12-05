# Modular Injection Control System Redesign

## Status: Planning Complete - Ready for Implementation

**Created**: 2025-12-04
**Branch**: `feature/injection-control-redesign`

---

## Problem Statement

The current framework injection system has several critical issues:

| Problem | Current State | Impact |
|---------|---------------|--------|
| Inverted boolean semantics | `systemPromptApplied = !shouldInject` | Confusing, error-prone |
| Duplicate flags | `systemPromptApplied` AND `suppressFrameworkInjection` | Inconsistent state |
| Hard-coded frequency logic | In FrameworkInjectionControlStage | Not customizable |
| No hierarchical config | Only global frequency setting | Can't customize per-category/chain/step |
| Confusing naming | "Applied" when meaning "should skip" | Maintenance nightmare |

## User Requirements

- [x] **Full hierarchy**: Global → Category → Prompt → Chain → Step
- [x] **Config + MCP control**: JSON config files + runtime `system_control` actions
- [x] **NO prompt metadata decisions**: Prompts don't control injection behavior
- [x] **Conditional injection**: Based on gate status, step type, previous step
- [x] **Multiple injection types**: Control system-prompt, gate-guidance, style-guidance separately
- [x] **Simple frequency**: Clear modes (every N, first-only, never)

---

## Solution Architecture

### New Module Structure

```
server/src/injection/
├── index.ts                              # Public exports
├── types.ts                              # Core type definitions
├── config-types.ts                       # Configuration schema types
├── constants.ts                          # Defaults, type registry
├── authority/
│   ├── injection-decision-authority.ts   # Single source of truth
│   ├── decision-resolver.ts              # Hierarchical resolution
│   └── condition-evaluator.ts            # Conditional rule evaluation
├── config/
│   └── injection-config-loader.ts        # Load from config.json
└── state/
    └── session-overrides.ts              # Runtime session overrides
```

### Core Types

```typescript
// Injection types (controlled separately)
type InjectionType = 'system-prompt' | 'gate-guidance' | 'style-guidance';

// Clear decision semantics (NO inversions!)
interface InjectionDecision {
  inject: boolean;           // true = inject, false = skip
  reason: string;            // Why this decision
  source: InjectionDecisionSource;
  decidedAt: number;
}

// Frequency modes with clear semantics
interface InjectionFrequency {
  mode: 'every' | 'first-only' | 'never';
  interval?: number;  // For 'every' mode
}

// Conditional injection
interface InjectionCondition {
  id: string;
  when: InjectionConditionWhen;
  then: 'inject' | 'skip' | 'inherit';
}
```

### Resolution Priority (Highest to Lowest)

1. **Modifiers** - `%clean`, `%lean`, `%guided`
2. **Runtime overrides** - From `system_control injection:override`
3. **Step config** - Step-specific rules
4. **Chain config** - Chain-level rules
5. **Category config** - Category-level rules
6. **Global config** - `config.json` defaults
7. **System defaults** - Hardcoded fallbacks

---

## Implementation Phases

### Phase 1: Core Injection Module [ ]

**Goal**: Create the foundation types and authority class

**Files to create**:
- [ ] `server/src/injection/index.ts`
- [ ] `server/src/injection/types.ts`
- [ ] `server/src/injection/config-types.ts`
- [ ] `server/src/injection/constants.ts`
- [ ] `server/src/injection/authority/injection-decision-authority.ts`
- [ ] `server/src/injection/authority/decision-resolver.ts`
- [ ] `server/src/injection/authority/condition-evaluator.ts`

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Unit tests for InjectionDecisionAuthority

---

### Phase 2: Configuration Extension [ ]

**Goal**: Add injection config to config.json with backward compatibility

**Files to modify**:
- [ ] `server/src/types.ts` - Add `InjectionConfig` interface
- [ ] `server/src/config/index.ts` - Add injection config loading
- [ ] `server/config.json` - Add `injection` section

**Files to create**:
- [ ] `server/src/injection/config/injection-config-loader.ts`

**Config Structure**:
```json
{
  "injection": {
    "defaults": {
      "system-prompt": true,
      "gate-guidance": true,
      "style-guidance": true
    },
    "system-prompt": {
      "enabled": true,
      "frequency": { "mode": "every", "interval": 2 },
      "conditions": [...]
    },
    "categories": [
      { "categoryId": "development", "system-prompt": { "frequency": { "mode": "every", "interval": 1 } } }
    ],
    "chains": [
      { "chainPattern": "research-*", "system-prompt": { "frequency": { "mode": "first-only" } } }
    ]
  }
}
```

**Backward Compatibility**:
- [ ] Map `frameworks.systemPromptReinjectionFrequency` → `injection.system-prompt.frequency`
- [ ] Emit deprecation warning when old key detected

**Validation**:
- [ ] Old config still works
- [ ] Deprecation warning appears
- [ ] New config loads correctly

---

### Phase 3: Pipeline State Update [ ]

**Goal**: Add new injection state, deprecate old framework state

**Files to modify**:
- [ ] `server/src/execution/context/internal-state.ts`
- [ ] `server/src/execution/context/execution-context.ts`

**New State Structure**:
```typescript
interface PipelineInternalState {
  // NEW
  injection: {
    systemPrompt?: InjectionDecision;
    gateGuidance?: InjectionDecision;
    styleGuidance?: InjectionDecision;
    currentStep?: number;
    lastSystemPromptStep?: number;
    sessionOverrides?: Partial<Record<InjectionType, boolean>>;
  };

  // DEPRECATED (keep during migration)
  framework: {
    /** @deprecated Use injection.systemPrompt.inject */
    systemPromptApplied: boolean;
    // ...
  };
}
```

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Existing tests still pass

---

### Phase 4: New Pipeline Stage [ ]

**Goal**: Create new InjectionControlStage, wire into pipeline

**Files to create**:
- [ ] `server/src/execution/pipeline/stages/07b-injection-control-stage.ts`

**Files to modify**:
- [ ] `server/src/mcp-tools/prompt-engine/core/prompt-execution-service.ts`

**Stage Logic**:
1. Skip if not chain command
2. Get InjectionDecisionAuthority (injected)
3. Build decision input from context
4. Call `authority.decide()` for each injection type
5. Store decisions in `context.state.injection`
6. **DUAL MODE**: Also populate old state for compatibility

**Validation**:
- [ ] Stage registered in correct position (after Session, before Execution)
- [ ] Both old and new state populated
- [ ] Chain frequency works correctly

---

### Phase 5: Update Downstream Consumers [ ]

**Goal**: Update all code that reads injection state

**Files to modify**:

| File | Change |
|------|--------|
| `server/src/execution/operators/chain-operator-executor.ts` | Read `injection.systemPrompt.inject` |
| `server/src/execution/pipeline/stages/06b-prompt-guidance-stage.ts` | Check new state |
| `server/src/execution/pipeline/stages/09-execution-stage.ts` | Pass decisions to executor |

**Before (confusing)**:
```typescript
const suppress = chainContext['suppressFrameworkInjection'] === true;
if (!suppress && !hasFrameworkGuidance(...)) { ... }
```

**After (clear)**:
```typescript
const decision = context.state.injection?.systemPrompt;
if (decision?.inject && !hasFrameworkGuidance(...)) { ... }
```

**Validation**:
- [ ] All tests pass
- [ ] E2E chain execution works
- [ ] No inverted booleans in new code

---

### Phase 6: MCP Tool Control [ ]

**Goal**: Add `injection:*` actions to system_control

**Files to modify**:
- [ ] `server/src/mcp-tools/system-control.ts`
- [ ] `server/src/tooling/action-metadata/definitions/system-control.ts`

**Files to create**:
- [ ] `server/src/injection/state/session-overrides.ts`

**New Actions**:

| Action | Purpose | Parameters |
|--------|---------|------------|
| `injection:status` | Show config + active overrides | - |
| `injection:configure` | Update rules (persists) | `type`, `enabled`, `frequency` |
| `injection:override` | Set session override | `type`, `enabled`, `scope` |
| `injection:reset` | Clear overrides | `confirm` |

**Validation**:
- [ ] `injection:status` returns correct info
- [ ] Overrides affect execution
- [ ] Reset clears overrides

---

### Phase 7: Tests [ ]

**Goal**: Comprehensive test coverage

**Files to create**:
- [ ] `server/tests/unit/injection/authority/injection-decision-authority.test.ts`
- [ ] `server/tests/unit/injection/authority/decision-resolver.test.ts`
- [ ] `server/tests/unit/injection/authority/condition-evaluator.test.ts`
- [ ] `server/tests/unit/execution/pipeline/injection-control-stage.test.ts`

**Test Coverage**:
- [ ] Modifier precedence (%clean, %lean, %guided)
- [ ] Hierarchical resolution (step > chain > category > global)
- [ ] Frequency modes (every N, first-only, never)
- [ ] Conditional injection (gate status, step type)
- [ ] Session override behavior
- [ ] Backward compatibility

**Validation**:
- [ ] `npm run test:coverage` shows >80% for injection module
- [ ] All edge cases covered

---

### Phase 8: Cleanup (Post-Migration) [ ]

**Goal**: Remove deprecated code after validation period

**Files to delete**:
- [ ] `server/src/frameworks/stages/framework-injection-control-stage.ts`
- [ ] Old tests

**Fields to remove**:
- [ ] `context.state.framework.systemPromptApplied`
- [ ] `context.metadata['suppressFrameworkInjection']`
- [ ] `config.frameworks.systemPromptReinjectionFrequency`

**Validation**:
- [ ] All tests pass without deprecated code
- [ ] `npm run validate:all` passes
- [ ] Documentation updated

---

## Critical Files Reference

### Must Create (New)

| File | Purpose |
|------|---------|
| `server/src/injection/index.ts` | Module exports |
| `server/src/injection/types.ts` | Core types |
| `server/src/injection/config-types.ts` | Config types |
| `server/src/injection/constants.ts` | Defaults |
| `server/src/injection/authority/injection-decision-authority.ts` | Main class |
| `server/src/injection/authority/decision-resolver.ts` | Hierarchy resolver |
| `server/src/injection/authority/condition-evaluator.ts` | Condition logic |
| `server/src/injection/config/injection-config-loader.ts` | Config loading |
| `server/src/injection/state/session-overrides.ts` | Runtime overrides |
| `server/src/execution/pipeline/stages/07b-injection-control-stage.ts` | New stage |

### Must Modify

| File | Changes |
|------|---------|
| `server/src/types.ts` | Add InjectionConfig |
| `server/src/config/index.ts` | Load injection config |
| `server/config.json` | Add injection section |
| `server/src/execution/context/internal-state.ts` | Add injection state |
| `server/src/execution/context/execution-context.ts` | Initialize state |
| `server/src/mcp-tools/system-control.ts` | Add injection actions |
| `server/src/execution/operators/chain-operator-executor.ts` | Use new state |
| `server/src/execution/pipeline/stages/06b-prompt-guidance-stage.ts` | Use new state |
| `server/src/execution/pipeline/stages/09-execution-stage.ts` | Use new state |
| `server/src/mcp-tools/prompt-engine/core/prompt-execution-service.ts` | Wire new stage |

### Must Deprecate (Phase 8)

| File | Reason |
|------|--------|
| `server/src/frameworks/stages/framework-injection-control-stage.ts` | Replaced by new stage |

---

## Validation Checklist (Final)

- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `npm run validate:all` passes
- [ ] Old config `systemPromptReinjectionFrequency` works with deprecation warning
- [ ] New `injection:status` MCP action works
- [ ] Chain step frequency works correctly
- [ ] Conditional injection rules evaluated
- [ ] Session overrides work via MCP
- [ ] No inverted booleans in new code
- [ ] Documentation updated

---

## Notes

- Follow existing pattern from `FrameworkDecisionAuthority` for caching
- Follow existing pattern from `GateServiceFactory` for strategy selection
- Maintain dual-mode state during migration (Phase 4-5)
- Only remove deprecated code after thorough validation (Phase 8)
