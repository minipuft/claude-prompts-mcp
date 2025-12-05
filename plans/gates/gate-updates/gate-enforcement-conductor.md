# Gate Enforcement Conductor Implementation Plan

## Status: ✅ Complete
**Created**: 2025-11-28
**Completed**: 2025-11-29
**Priority**: High - Consolidates scattered gate logic into maintainable authority pattern
**Builds On**: `gate-retry-enforcement.md` (completed)

---

## Overview

### Problem Statement

The gate retry enforcement implementation (completed in `gate-retry-enforcement.md`) is scattered across 7+ pipeline stages with:
- **Verdict parsing** embedded in Stage 08 (~60 lines)
- **Review creation** in Stage 07
- **Enforcement mode handling** in Stages 05, 08
- **Action resolution** (retry/skip/abort) in Stage 08
- **State split** between ephemeral context and persistent session

This makes changes error-prone (as evidenced by multiple "band-aid fixes" during initial implementation).

### Solution

Create a `GateEnforcementAuthority` following the existing `FrameworkDecisionAuthority` pattern:
- **Single source of truth** for verdict parsing, enforcement, and retry logic
- **Bridges ephemeral and persistent state** consistently
- **Delegates from stages** rather than embedding logic
- **Testable in isolation** from pipeline stages

### Approach

**Hybrid** - Consolidate verdict + enforcement logic; leave gate accumulation in existing stages

**Pattern** - Authority (cached decisions per request, computed lazily)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ExecutionContext                              │
├─────────────────────────────────────────────────────────────────┤
│  context.gates (GateAccumulator)       ← Existing, unchanged    │
│  context.gateEnforcement (GateEnforcementAuthority) ← NEW       │
│  context.frameworkAuthority            ← Existing pattern       │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  Stage 05               Stage 07               Stage 08
  (Accumulates)          (Creates Review)       (Delegates to
   ↓                      ↓                      Authority)
  context.gates.add()    gateEnforcement        gateEnforcement
                         .createReview()        .parseVerdict()
                                                .recordOutcome()
                                                .resolveAction()
```

---

## Current State

### All Phases Complete ✅
- [x] Types file created: `gate-enforcement-types.ts`
- [x] Authority implementation created: `gate-enforcement-authority.ts`
- [x] Add authority to ExecutionContext interface
- [x] Initialize authority in DI stage (00)
- [x] Write unit tests for authority (46 tests)
- [x] Delegate Stage 07 review creation
- [x] Delegate Stage 08 verdict handling
- [x] Cleanup and documentation

### Validation Results (2025-11-29)
- TypeScript: ✅ No errors
- Tests: ✅ 480 passing
- Build: ✅ Successful

---

## Implementation Phases

### Phase 1: Authority Infrastructure ✅ COMPLETE
**Risk**: Low | **Files**: 2 new

#### Responsibilities Split

The authority handles **decisions and session manager interactions**:
- Verdict parsing with security (pattern matching, source validation)
- Enforcement mode resolution
- Retry config queries
- Pending review CRUD via session manager
- Outcome recording and status determination
- Action resolution (retry/skip/abort)

The calling stages handle **context state updates**:
- `context.metadata['gateVerdictDetection']` - transparency logging
- `context.state.gates.advisoryWarnings` - for advisory mode FAILs
- `context.state.gates.retryLimitExceeded` - when outcome is 'exhausted'
- `context.state.gates.retryExhaustedGateIds` - gate IDs on exhaustion
- `context.sessionContext.pendingReview` - session context sync

This separation ensures the authority is testable without mocking ExecutionContext.

#### Files Created

**1. `src/execution/pipeline/state/authorities/gate-enforcement-types.ts`**
```typescript
// Types for authority operations
export type VerdictSource = 'gate_verdict' | 'user_response';
export type EnforcementMode = 'blocking' | 'advisory' | 'informational';
export type GateAction = 'retry' | 'skip' | 'abort';

export interface ParsedVerdict { /* ... */ }
export interface RetryConfig { /* ... */ }
export interface ReviewOutcome { /* ... */ }
export interface ActionResult { /* ... */ }
export interface GateEnforcementInput { /* ... */ }
export interface GateEnforcementDecision { /* ... */ }
export interface CreateReviewOptions { /* ... */ }
```

**2. `src/execution/pipeline/state/authorities/gate-enforcement-authority.ts`**
```typescript
export class GateEnforcementAuthority {
  // Verdict parsing (5 patterns with security)
  parseVerdict(raw: string, source: VerdictSource): ParsedVerdict | null;

  // Enforcement resolution
  resolveEnforcementMode(configuredMode?: EnforcementMode): EnforcementMode;

  // Retry configuration
  getRetryConfig(sessionId: string): RetryConfig;
  isRetryLimitExceeded(sessionId: string): boolean;

  // Review lifecycle
  createPendingReview(options: CreateReviewOptions): PendingGateReview;
  getPendingReview(sessionId: string): PendingGateReview | undefined;
  setPendingReview(sessionId: string, review: PendingGateReview): Promise<void>;
  clearPendingReview(sessionId: string): Promise<void>;

  // Outcome recording
  recordOutcome(sessionId: string, verdict: ParsedVerdict, mode?: EnforcementMode): Promise<ReviewOutcome>;

  // Action resolution
  resolveAction(sessionId: string, action: GateAction): Promise<ActionResult>;

  // Authority pattern methods
  decide(input: GateEnforcementInput): GateEnforcementDecision;
  hasDecided(): boolean;
  getCachedDecision(): GateEnforcementDecision | null;
  reset(): void;
}
```

---

### Phase 2: Context & DI Integration ✅ COMPLETE
**Risk**: Low | **Files**: 3 modified

#### 2.1 Update Authority Index Export
**File**: `src/execution/pipeline/state/authorities/index.ts`

```typescript
// Add exports
export { GateEnforcementAuthority } from './gate-enforcement-authority.js';
export type {
  ActionResult,
  CreateReviewOptions,
  EnforcementMode,
  GateAction,
  GateEnforcementDecision,
  GateEnforcementInput,
  ParsedVerdict,
  RetryConfig,
  ReviewOutcome,
  VerdictSource,
} from './gate-enforcement-types.js';
```

#### 2.2 Add to ExecutionContext
**File**: `src/execution/context/execution-context.ts`

```typescript
import { GateEnforcementAuthority } from '../pipeline/state/authorities/index.js';

export class ExecutionContext {
  // Existing
  gates: GateAccumulator;
  frameworkAuthority: FrameworkDecisionAuthority;

  // NEW
  gateEnforcement?: GateEnforcementAuthority;
}
```

#### 2.3 Initialize in DI Stage
**File**: `src/execution/pipeline/stages/00-dependency-injection-stage.ts`

```typescript
import { GateEnforcementAuthority } from '../state/authorities/index.js';

// In execute():
context.gateEnforcement = new GateEnforcementAuthority(
  this.chainSessionManager,
  this.logger
);
```

#### Success Criteria
- [x] Authority exportable from authorities index
- [x] ExecutionContext has `gateEnforcement` property
- [x] DI stage initializes authority on every request
- [x] TypeScript compiles without errors

---

### Phase 3: Unit Tests for Authority ✅ COMPLETE
**Risk**: Low | **Files**: 1 new

#### File: `tests/unit/execution/pipeline/state/gate-enforcement-authority.test.ts`

```typescript
describe('GateEnforcementAuthority', () => {
  describe('parseVerdict', () => {
    it('parses primary format: GATE_REVIEW: PASS - reason');
    it('parses high format: GATE_REVIEW: FAIL : reason');
    it('parses simplified format: GATE PASS - reason');
    it('skips fallback pattern for user_response source');
    it('requires non-empty rationale');
    it('returns null for empty input');
    it('handles case insensitivity');
  });

  describe('resolveEnforcementMode', () => {
    it('returns configured mode when provided');
    it('defaults to blocking when not configured');
  });

  describe('getRetryConfig', () => {
    it('returns current attempt and max from session');
    it('marks exhausted when attempts >= max');
    it('uses DEFAULT_RETRY_LIMIT when not specified');
  });

  describe('createPendingReview', () => {
    it('creates review with provided options');
    it('uses default maxAttempts');
    it('initializes empty history');
  });

  describe('recordOutcome', () => {
    it('returns cleared on PASS verdict');
    it('returns pending on FAIL in blocking mode');
    it('returns exhausted when retry limit exceeded');
    it('clears review in advisory mode on FAIL');
    it('clears review in informational mode on FAIL');
  });

  describe('resolveAction', () => {
    it('resets retry count on retry action');
    it('clears review on skip action');
    it('sets abort flag on abort action');
  });

  describe('decide', () => {
    it('caches decision after first call');
    it('returns shouldEnforce=false when no gates');
    it('returns shouldEnforce=true with gate list');
  });
});
```

#### Success Criteria
- [x] All verdict parsing patterns tested
- [x] Enforcement mode resolution tested
- [x] Retry config and exhaustion tested
- [x] All action types tested
- [x] Decision caching tested

---

### Phase 4: Delegate Stage 07 Review Creation ✅ COMPLETE
**Risk**: Medium | **Files**: 1 modified

#### File: `src/execution/pipeline/stages/07-session-stage.ts`

**Before** (current inline creation):
```typescript
const pendingReview: PendingGateReview = {
  combinedPrompt: context.gateInstructions ?? '',
  gateIds,
  prompts: [],
  createdAt: Date.now(),
  attemptCount: 0,
  maxAttempts: DEFAULT_RETRY_LIMIT,
  retryHints: [],
  history: [],
};

await this.chainSessionManager.setPendingGateReview(sessionId, pendingReview);
```

**After** (delegated):
```typescript
const pendingReview = context.gateEnforcement!.createPendingReview({
  gateIds: context.state.gates.accumulatedGateIds ?? [],
  instructions: context.gateInstructions ?? '',
  maxAttempts: DEFAULT_RETRY_LIMIT,
});

await context.gateEnforcement!.setPendingReview(sessionId, pendingReview);
sessionContext.pendingReview = pendingReview;
```

#### Success Criteria
- [x] Review created via authority
- [x] Review persisted to session manager
- [x] Session context updated with pending review
- [x] Existing behavior preserved

---

### Phase 5: Delegate Stage 08 Verdict Handling ✅ COMPLETE
**Risk**: Medium | **Files**: 1 modified

#### File: `src/execution/pipeline/stages/08-response-capture-stage.ts`

**Current** (~120 lines of embedded logic):
- `parseGateVerdict()` method (60 lines)
- `handleGateAction()` method (40 lines)
- Enforcement mode switch (20 lines)

**After** (delegated):
```typescript
// Replace parseGateVerdict call
const verdict = context.gateEnforcement!.parseVerdict(
  context.mcpRequest.gate_verdict,
  'gate_verdict'
) ?? context.gateEnforcement!.parseVerdict(
  userResponse,
  'user_response'
);

// Replace enforcement mode handling
if (verdict) {
  const outcome = await context.gateEnforcement!.recordOutcome(
    sessionId,
    verdict,
    context.state.gates.enforcementMode
  );

  // Handle outcome
  if (outcome.status === 'exhausted') {
    context.state.gates.retryLimitExceeded = true;
    context.state.gates.retryExhaustedGateIds = session.pendingGateReview?.gateIds ?? [];
  }

  // Update session context based on outcome.nextAction
}

// Replace handleGateAction
if (gateAction && context.gateEnforcement!.isRetryLimitExceeded(sessionId)) {
  const result = await context.gateEnforcement!.resolveAction(sessionId, gateAction);

  if (result.sessionAborted) {
    context.state.session.aborted = true;
  }
  if (result.reviewCleared) {
    context.sessionContext = { ...sessionContext, pendingReview: undefined };
  }
  if (result.retryReset) {
    context.state.gates.retryLimitExceeded = false;
  }
}
```

#### Methods to Remove from Stage 08
- `private parseGateVerdict()` - Moved to authority
- `private handleGateAction()` - Moved to authority

#### Success Criteria
- [x] Verdict parsing delegated to authority
- [x] Outcome recording delegated to authority
- [x] Gate action handling delegated to authority
- [x] All gate enforcement tests pass
- Note: Stage 08 retains fallback paths for backward compatibility

---

### Phase 6: Cleanup & Documentation ✅ COMPLETE
**Risk**: Low | **Files**: 3+ modified

#### 6.1 Update Authority Index
**File**: `src/execution/pipeline/state/authorities/index.ts`
- Ensure all types exported

#### 6.2 Update Architecture Docs
**File**: `docs/architecture.md`
- Add GateEnforcementAuthority to authority pattern section
- Document verdict parsing patterns
- Document enforcement mode behavior

#### 6.3 Add Lifecycle Annotations
- All new files have `@lifecycle canonical` tag
- Update stage files with delegation comments

#### 6.4 Validate Build
```bash
npm run typecheck
npm run test
npm run validate:circular
npm run build
```

#### Success Criteria
- [x] No TypeScript errors
- [x] All tests pass
- [x] No new circular dependencies
- [x] Build succeeds
- [x] Plan documentation updated

---

## Files Summary

### New Files (2)
| File | Status | Description |
|------|--------|-------------|
| `state/authorities/gate-enforcement-types.ts` | ✅ Complete | Type definitions |
| `state/authorities/gate-enforcement-authority.ts` | ✅ Complete | Authority implementation |

### Modified Files (5)
| File | Phase | Changes |
|------|-------|---------|
| `state/authorities/index.ts` | 2 | Export authority + types |
| `context/execution-context.ts` | 2 | Add `gateEnforcement` property |
| `stages/00-dependency-injection-stage.ts` | 2 | Initialize authority |
| `stages/07-session-stage.ts` | 4 | Delegate review creation |
| `stages/08-response-capture-stage.ts` | 5 | Delegate verdict/action handling |

### Test Files (1)
| File | Phase | Description |
|------|-------|-------------|
| `tests/unit/.../gate-enforcement-authority.test.ts` | 3 | Unit tests |

---

## Validation Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `npm run validate:circular` - no new cycles
- [ ] Manual test: Start chain with gates
- [ ] Manual test: FAIL verdict → retry prompt
- [ ] Manual test: 2x FAIL → retry limit prompt
- [ ] Manual test: `gate_action: "skip"` works
- [ ] Manual test: `gate_action: "retry"` works
- [ ] Manual test: `gate_action: "abort"` works
- [ ] Stage 08 line count reduced significantly

---

## Risk Mitigation

1. **Backward Compatibility**: Authority wraps existing ChainSessionManager - no persistence format changes
2. **Incremental Rollout**: Authority coexists with existing stage code until delegation complete
3. **Rollback Path**: If issues arise, revert delegation and use authority alongside stages

---

## Benefits (Post-Implementation)

| Metric | Before | After |
|--------|--------|-------|
| Files to change for verdict logic | 3+ stages | 1 (authority) |
| Lines in Stage 08 | ~460 | ~300 |
| Test isolation | Poor (stage deps) | Good (authority testable alone) |
| Enforcement mode consistency | Scattered defaults | Single source of truth |
| State management confusion | High | Eliminated (authority bridges both) |

---

## References

- **Pattern Source**: `FrameworkDecisionAuthority` in `state/authorities/`
- **Original Implementation**: `plans/gate-updates/gate-retry-enforcement.md`
- **Architecture Docs**: `docs/architecture.md` (Ephemeral vs Persistent State section)
- **Industry Patterns**: [Refactoring.guru](https://refactoring.guru/design-patterns/typescript), [DEV Community Pipeline Pattern](https://dev.to/wallacefreitas/the-pipeline-pattern-streamlining-data-processing-in-software-architecture-44hn)
