# Gate Retry & Enforcement System

## Status: ✅ Complete
**Created**: 2025-11-28
**Completed**: 2025-11-28
**Supersedes**: `plans/gate-enforcement-system.md`
**Priority**: Medium - Improves reliability of gate-based validation
**Progress**: 4/4 phases complete

---

## Overview

This plan integrates enforcement concepts and retry logic into the current tool-based validation system. Unlike the original `gate-enforcement-system.md` which required semantic layer integration, this approach works with the existing `gate_verdict` flow and user-driven validation.

### Key Design Decisions
- **Default Retries**: 2 attempts before prompting user for instructions
- **On Exhaustion**: Block & offer choice (retry/skip/abort)
- **No Semantic Layer**: Uses existing tool-based validation, not LLM analysis

---

## Current State Analysis

### Infrastructure Ready (Exists but Not Wired)
| Component | Location | Status |
|-----------|----------|--------|
| `gate_verdict` parsing | `08-response-capture-stage.ts` | Working |
| `attemptCount` tracking | `PendingGateReview` | Working |
| `maxAttempts` field | `PendingGateReview` | Stored, **not enforced** |
| `retry_config` in gates | Gate JSON definitions | Exists, **not integrated** |
| `failureAction` field | `GateDefinition` type | Defined, **not used** |
| `history[]` tracking | `PendingGateReview` | Working |

### What's Missing
1. `maxAttempts` never compared to `attemptCount`
2. No user choice prompt after retry exhaustion
3. `retry_config` not loaded into `PendingGateReview`
4. No enforcement mode distinction (blocking vs advisory)
5. No escalation logic with user interaction

---

## Implementation Phases

### Phase 1: Activate Retry Limit Enforcement
**Risk**: Low | **Estimate**: 2-3 hours

#### Goal
Make `maxAttempts` actually enforce retry limits and track exhaustion state.

#### Changes

**1. Pipeline Internal State** (`src/execution/context/internal-state.ts`)
```typescript
// Add to GatesState interface
retryLimitExceeded?: boolean;
retryExhaustedGateIds?: string[];
```

**2. Response Capture Stage** (`src/execution/pipeline/stages/08-response-capture-stage.ts`)
```typescript
// After recordGateReviewOutcome() returns 'pending'
const pendingReview = this.chainSessionManager.getPendingGateReview(sessionId);
if (pendingReview && pendingReview.attemptCount >= pendingReview.maxAttempts) {
  context.state.gates.retryLimitExceeded = true;
  context.state.gates.retryExhaustedGateIds = pendingReview.gateIds;
  context.diagnostics.warn(this.name, 'Gate retry limit exceeded', {
    attemptCount: pendingReview.attemptCount,
    maxAttempts: pendingReview.maxAttempts,
    gateIds: pendingReview.gateIds,
  });
}
```

**3. Chain Session Manager** (`src/chain-session/manager.ts`)
```typescript
// Add helper method
isRetryLimitExceeded(sessionId: string): boolean {
  const review = this.getPendingGateReview(sessionId);
  if (!review) return false;
  return review.attemptCount >= review.maxAttempts;
}
```

#### Success Criteria
- [x] `retryLimitExceeded` set when attempts >= maxAttempts
- [x] Diagnostic logged on exhaustion
- [x] Helper method returns correct status

---

### Phase 2: Gate Retry Config Integration
**Risk**: Low | **Estimate**: 2-3 hours

#### Goal
Load `retry_config` from gate definitions into `PendingGateReview`.

#### Changes

**1. Default Constants** (`src/gates/constants.ts` or inline)
```typescript
export const DEFAULT_GATE_RETRY_CONFIG = {
  maxAttempts: 2,
  improvementHints: true,
  preserveContext: true,
};
```

**2. Gate Review Stage** (`src/execution/pipeline/stages/10-gate-review-stage.ts`)
```typescript
// When creating PendingGateReview, load retry_config from gate definition
private async buildPendingReview(gateIds: string[]): Promise<Partial<PendingGateReview>> {
  // Load gate definitions to get retry_config
  const gates = await Promise.all(gateIds.map(id => this.gateLoader?.getGate(id)));

  // Find most restrictive maxAttempts (lowest value wins)
  const maxAttempts = gates.reduce((min, gate) => {
    const gateMax = gate?.retry_config?.max_attempts ?? DEFAULT_GATE_RETRY_CONFIG.maxAttempts;
    return Math.min(min, gateMax);
  }, Infinity);

  // Collect improvement hints from all gates
  const retryHints = gates
    .filter(g => g?.retry_config?.improvement_hints)
    .flatMap(g => g?.criteria ?? []);

  return {
    maxAttempts: maxAttempts === Infinity ? DEFAULT_GATE_RETRY_CONFIG.maxAttempts : maxAttempts,
    retryHints: retryHints.length > 0 ? retryHints : undefined,
  };
}
```

**3. Gate Review Rendering** (same file)
```typescript
// Include retry hints and attempt progress in rendered content
private renderRetryGuidance(pendingReview: PendingGateReview): string {
  const lines = [
    `**Attempt ${pendingReview.attemptCount + 1} of ${pendingReview.maxAttempts}**`,
  ];

  if (pendingReview.retryHints?.length) {
    lines.push('', '**Consider these improvements:**');
    pendingReview.retryHints.forEach(hint => lines.push(`- ${hint}`));
  }

  if (pendingReview.history?.length) {
    const lastAttempt = pendingReview.history[pendingReview.history.length - 1];
    lines.push('', `**Previous feedback:** ${lastAttempt.reasoning}`);
  }

  return lines.join('\n');
}
```

#### Success Criteria
- [x] Gate definitions' `retry_config` loaded into `PendingGateReview`
- [x] Default of 2 attempts when not specified
- [x] Retry hints shown in review prompts
- [x] Attempt progress displayed (e.g., "Attempt 1 of 2")

---

### Phase 3: Enforcement Modes
**Risk**: Medium | **Estimate**: 3-4 hours

#### Goal
Support blocking vs advisory vs informational behavior based on gate configuration.

#### New Types

**1. Gate Types** (`src/gates/types.ts`)
```typescript
export type GateEnforcementMode = 'blocking' | 'advisory' | 'informational';

// Add to LightweightGateDefinition
enforcementMode?: GateEnforcementMode;

// Severity to mode mapping (default if not specified)
export const SEVERITY_TO_ENFORCEMENT: Record<string, GateEnforcementMode> = {
  critical: 'blocking',
  high: 'advisory',
  medium: 'advisory',
  low: 'informational',
};
```

**2. Pipeline Internal State** (`src/execution/context/internal-state.ts`)
```typescript
// Add to GatesState interface
enforcementMode?: GateEnforcementMode;
advisoryWarnings?: string[];
```

#### Changes

**3. Gate Enhancement Stage** (`src/execution/pipeline/stages/05-gate-enhancement-stage.ts`)
```typescript
// Determine enforcement mode from gates
private determineEnforcementMode(gateIds: string[]): GateEnforcementMode {
  // Load gates and check for blocking mode (most restrictive wins)
  const modes = gateIds.map(id => {
    const gate = this.gateLoader?.getGate(id);
    return gate?.enforcementMode ?? SEVERITY_TO_ENFORCEMENT[gate?.severity ?? 'medium'];
  });

  if (modes.includes('blocking')) return 'blocking';
  if (modes.includes('advisory')) return 'advisory';
  return 'informational';
}
```

**4. Response Capture Stage** (enforcement logic)
```typescript
// After verdict processing
const mode = context.state.gates.enforcementMode ?? 'blocking';

if (verdict === 'FAIL') {
  switch (mode) {
    case 'blocking':
      // Stay on step, don't advance (current behavior)
      context.diagnostics.info(this.name, 'Gate FAIL - blocking mode, awaiting retry');
      break;
    case 'advisory':
      // Log warning but allow advancement
      context.state.gates.advisoryWarnings ??= [];
      context.state.gates.advisoryWarnings.push(`Gate ${gateId} failed: ${rationale}`);
      context.diagnostics.warn(this.name, 'Gate FAIL - advisory mode, continuing');
      // Clear pending review to allow step advancement
      this.chainSessionManager.clearPendingGateReview(sessionId);
      break;
    case 'informational':
      // Log only, no user impact
      context.diagnostics.info(this.name, 'Gate FAIL - informational mode, logged only');
      this.chainSessionManager.clearPendingGateReview(sessionId);
      break;
  }
}
```

**5. Formatting Stage** (surface warnings)
```typescript
// Include advisory warnings in response footer
if (context.state.gates.advisoryWarnings?.length) {
  sections.push('\n---\n**Advisory Gate Warnings:**');
  context.state.gates.advisoryWarnings.forEach(w => sections.push(`- ${w}`));
}
```

#### Success Criteria
- [x] Blocking mode prevents step advancement on FAIL
- [x] Advisory mode logs warning but continues
- [x] Informational mode only logs
- [x] Severity maps to default enforcement mode
- [x] Advisory warnings surfaced in response

---

### Phase 4: User Choice Escalation
**Risk**: Medium | **Estimate**: 3-4 hours

#### Goal
After retry exhaustion, prompt user with options instead of auto-failing.

#### New Types

**1. Gate Types** (`src/gates/types.ts`)
```typescript
export type GateAction = 'retry' | 'skip' | 'abort';

// Add to MCP request schema
gate_action?: GateAction;
```

**2. Pipeline Internal State**
```typescript
// Add to GatesState interface
awaitingUserChoice?: boolean;
userChoicePrompted?: boolean;
```

#### Changes

**3. Gate Review Stage** (choice prompt rendering)
```typescript
// When retry limit exceeded, render choice prompt
private renderChoicePrompt(pendingReview: PendingGateReview): string {
  const failedGates = pendingReview.gateIds.join(', ');

  return `
## Gate Review Retry Limit Reached

The following gates failed after ${pendingReview.attemptCount} attempts: **${failedGates}**

### Options

1. **Retry** - Provide corrections and try again
2. **Skip** - Skip this gate check and continue the chain
3. **Abort** - Stop the chain execution entirely

**To continue, respond with:**
\`\`\`
gate_action: "retry" | "skip" | "abort"
\`\`\`

${pendingReview.retryHints?.length ? `
### Improvement Suggestions
${pendingReview.retryHints.map(h => `- ${h}`).join('\n')}
` : ''}
`;
}
```

**4. Response Capture Stage** (handle gate_action)
```typescript
// Check for gate_action parameter
const gateAction = context.mcpRequest.gate_action as GateAction | undefined;

if (gateAction && context.state.gates.retryLimitExceeded) {
  switch (gateAction) {
    case 'retry':
      // Reset attempt count, allow another try
      this.chainSessionManager.resetRetryCount(sessionId);
      context.state.gates.retryLimitExceeded = false;
      context.diagnostics.info(this.name, 'User chose to retry after exhaustion');
      break;
    case 'skip':
      // Clear pending review, continue chain
      this.chainSessionManager.clearPendingGateReview(sessionId);
      context.state.gates.retryLimitExceeded = false;
      context.diagnostics.warn(this.name, 'User chose to skip failed gate');
      break;
    case 'abort':
      // Set abort flag, pipeline will terminate
      context.state.session.aborted = true;
      context.diagnostics.info(this.name, 'User chose to abort chain after gate failure');
      break;
  }
}
```

**5. Chain Session Manager** (reset helper)
```typescript
resetRetryCount(sessionId: string): void {
  const session = this.sessions.get(sessionId);
  if (session?.pendingGateReview) {
    session.pendingGateReview.attemptCount = 0;
    session.pendingGateReview.history?.push({
      timestamp: Date.now(),
      status: 'reset',
      reasoning: 'User requested retry after exhaustion',
    });
    this.saveToFile();
  }
}
```

#### Success Criteria
- [x] Choice prompt rendered after retry exhaustion
- [x] `gate_action: "retry"` resets attempt count
- [x] `gate_action: "skip"` clears review and continues
- [x] `gate_action: "abort"` stops chain execution
- [x] User choice logged in diagnostics

---

## Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `src/execution/context/internal-state.ts` | 1,3,4 | Add gate state fields |
| `src/execution/pipeline/stages/08-response-capture-stage.ts` | 1,3,4 | Retry check, enforcement, gate_action |
| `src/execution/pipeline/stages/10-gate-review-stage.ts` | 2,4 | Retry hints, choice prompt |
| `src/chain-session/manager.ts` | 1,4 | Helper methods |
| `src/gates/types.ts` | 3,4 | New types |
| `src/gates/constants.ts` | 2 | Default retry config |
| `src/execution/pipeline/stages/05-gate-enhancement-stage.ts` | 3 | Enforcement mode |
| `src/execution/pipeline/stages/10-formatting-stage.ts` | 3 | Advisory warnings |
| `tests/unit/execution/pipeline/*.test.ts` | All | Test coverage |

---

## Testing Strategy

### Unit Tests
- [ ] Retry limit detection (`attemptCount >= maxAttempts`)
- [ ] Default maxAttempts (2) when not specified
- [ ] Retry config loading from gate definitions
- [ ] Enforcement mode determination (severity mapping)
- [ ] Gate action handling (retry/skip/abort)
- [ ] Attempt reset on user retry choice

### Integration Tests
- [ ] Full retry flow: FAIL → retry → FAIL → choice prompt
- [ ] Skip flow: FAIL × 2 → skip → chain continues
- [ ] Abort flow: FAIL × 2 → abort → chain stops
- [ ] Advisory mode: FAIL → warning logged → chain continues
- [ ] Mixed gates: blocking + advisory behavior

---

## Backward Compatibility

All changes are additive:
- Existing `gate_verdict` flow unchanged
- New `gate_action` parameter optional
- Default enforcement mode = blocking (current behavior)
- Gates without `retry_config` use defaults

---

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Default maxAttempts? | **2** |
| Behavior on exhaustion? | **Block & offer choice** |
| Retry delay between attempts? | **Not implemented** (future enhancement) |
| Cross-step enforcement? | **Per-gate** (most restrictive wins) |

---

## References

- **Supersedes**: `plans/gate-enforcement-system.md` (semantic layer approach)
- **Gate Types**: `src/gates/types.ts`
- **Session Manager**: `src/chain-session/manager.ts`
- **Response Capture**: `src/execution/pipeline/stages/08-response-capture-stage.ts`
- **Gate Review Stage**: `src/execution/pipeline/stages/10-gate-review-stage.ts`
