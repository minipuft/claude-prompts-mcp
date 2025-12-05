# Gate Enforcement System - Future Design

## Status: SUPERSEDED
**Created**: 2025-11-23
**Superseded**: 2025-11-28
**Superseded By**: [`/plans/gate-retry-enforcement.md`](../gate-retry-enforcement.md)

> **Note**: This plan was blocked on semantic layer integration (Phases 2-4). The replacement plan integrates enforcement and retry logic into the existing tool-based validation system without requiring a semantic layer.

---

**Original Status**: Planning Phase
**Original Target**: Post Semantic Layer Integration
**Current State**: Infrastructure ready, enforcement logic not yet implemented

---

## Overview

This document describes the future gate enforcement system that will provide three-tier validation (ENFORCE/ADVISE/REPORT) for prompt outputs. The infrastructure exists but awaits semantic layer integration for full functionality.

## Current State (v3.0.0)

### What Works Today
- **Quality Gates Parameter**: Users can request specific quality gates via `quality_gates` parameter
- **Gate Definitions**: Complete gate registry with severity levels (`critical`, `high`, `medium`, `low`)
- **Gate Types**: Five distinct types (`validation`, `guidance`, `approval`, `condition`, `quality`)
- **PendingGateReview API**: Session manager methods for pause/resume validation flows
- **Gate Instructions**: Guidance rendered in responses for manual review
- **Gate Verdict Flow**: Users can respond with `gate_verdict` parameter for manual approvals

### What's Not Yet Implemented
- **Automatic Enforcement**: Gates don't block execution or pause automatically
- **Severity-Based Behavior**: `critical`/`high`/`medium`/`low` doesn't affect execution flow
- **Type-Specific Logic**: All gate types treated identically regardless of `type` field
- **Semantic Analysis**: No automated pass/fail determination
- **Enforcement Modes**: No distinction between ENFORCE/ADVISE/REPORT

## Three-Tier Enforcement Model

### ENFORCE Mode (Blocking)
**Behavior**: Execution pauses until gate criteria are met. User must provide `gate_verdict: "GATE_REVIEW: PASS - reason"` to continue.

**When to Use**:
- `critical` severity gates
- Security validations
- Compliance requirements
- Data integrity checks

**Example**:
```typescript
{
  id: "security-validation",
  severity: "critical",
  type: "validation",
  criteria: ["No credential leaks", "Input validation present", "Auth checks enforced"],
  enforcementMode: "ENFORCE"  // <-- Future field
}
```

**Execution Flow**:
1. Gate validation runs after content generation
2. If criteria not met → execution PAUSES
3. `PendingGateReview` created in session
4. Response includes gate guidance + verdict prompt
5. User submits `gate_verdict` to resume
6. If PASS → continue to next step
7. If FAIL → optionally retry with corrections

### ADVISE Mode (Warning)
**Behavior**: Execution continues but warnings surface in response. User can optionally review but chain proceeds automatically.

**When to Use**:
- `high` or `medium` severity gates
- Best practice recommendations
- Style guide enforcement
- Performance optimizations

**Example**:
```typescript
{
  id: "code-quality",
  severity: "high",
  type: "quality",
  criteria: ["Clear naming", "Documented functions", "Error handling"],
  enforcementMode: "ADVISE"  // <-- Future field
}
```

**Execution Flow**:
1. Gate validation runs after content generation
2. If criteria not met → log WARNING
3. Include advisory text in response footer
4. Chain continues to next step automatically
5. Warnings aggregated in final summary

### REPORT Mode (Informational)
**Behavior**: Passive observation. Gate check runs and results logged but no user-facing impact.

**When to Use**:
- `low` severity gates
- Telemetry and metrics collection
- A/B testing new gates
- Educational feedback

**Example**:
```typescript
{
  id: "documentation-completeness",
  severity: "low",
  type: "guidance",
  criteria: ["Examples included", "References cited"],
  enforcementMode: "REPORT"  // <-- Future field
}
```

**Execution Flow**:
1. Gate validation runs silently
2. Results logged to analytics service
3. No impact on response content
4. No blocking or warnings
5. Metrics available via `system_control` analytics

## Severity → Enforcement Mapping

| Severity Level | Default Enforcement Mode | Override Allowed? | Use Cases |
|----------------|-------------------------|-------------------|-----------|
| `critical` | ENFORCE (blocking) | ⚠️ Yes, with warnings | Security, compliance, data integrity |
| `high` | ADVISE (warnings) | ✅ Yes | Best practices, code quality, performance |
| `medium` | ADVISE (warnings) | ✅ Yes | Style guides, documentation, conventions |
| `low` | REPORT (silent) | ✅ Yes | Metrics, telemetry, experimentation |

**Override Syntax** (Future):
```typescript
quality_gates: [
  "security-validation",  // Uses default severity-based mode
  { id: "code-quality", enforcementMode: "ENFORCE" }  // Override to blocking
]
```

## Semantic Layer Integration Points

### Required Capabilities
The semantic layer must provide:

1. **Automated Pass/Fail Detection**
   - Analyze content against gate criteria
   - Return structured validation results
   - Provide confidence scores
   - Generate explanatory feedback

2. **Criteria Evaluation**
   - Parse natural language criteria
   - Map criteria to validation checks
   - Support boolean combinations (AND/OR)
   - Handle contextual rules

3. **Retry Intelligence**
   - Suggest specific corrections
   - Track attempt history
   - Limit retry cycles
   - Escalate persistent failures

### Integration Architecture

```typescript
interface SemanticGateValidator {
  /**
   * Evaluate content against gate criteria
   */
  evaluate(params: {
    content: string;
    gate: GateSpecification;
    context: ExecutionContext;
  }): Promise<GateValidationResult>;

  /**
   * Generate corrective guidance for failures
   */
  generateCorrections(params: {
    content: string;
    failedCriteria: string[];
    attemptHistory: GateReviewHistoryEntry[];
  }): Promise<string>;
}

interface GateValidationResult {
  passed: boolean;
  confidence: number;  // 0.0 - 1.0
  failedCriteria: string[];
  passedCriteria: string[];
  explanation: string;
  suggestedCorrections?: string;
}
```

### Pipeline Integration

**New Pipeline Stage**: Insert between Step 09 (Execution) and Step 10 (Formatting)

```
09-execution-stage.ts
  ↓
  [NEW] 09.5-semantic-gate-validation-stage.ts  ← Enforcement happens here
  ↓
10-formatting-stage.ts
```

**Stage Responsibilities**:
- Load gate specifications from plan
- Determine enforcement mode (severity-based or override)
- Call semantic validator for each gate
- Handle ENFORCE mode pauses (populate PendingGateReview)
- Aggregate ADVISE mode warnings
- Log REPORT mode results

## Migration Path

### Phase 1: Infrastructure Cleanup ✅ (v3.0.0)
- [x] Remove non-functional `llm_validation` parameter
- [x] Document severity as metadata-only
- [x] Document gate types as forward-compatible
- [x] Preserve `PendingGateReview` APIs
- [x] Update all documentation

### Phase 2: Enforcement Mode Foundation (v3.1.0)
- [ ] Add `enforcementMode` field to GateSpecification type
- [ ] Implement severity → mode mapping logic
- [ ] Add `GateEnforcementOptions` interface
- [ ] Update gate definitions with enforcement modes
- [ ] Add enforcement mode validation

### Phase 3: Semantic Integration Prep (v3.2.0)
- [ ] Define `SemanticGateValidator` interface
- [ ] Create semantic gate validation pipeline stage
- [ ] Implement ENFORCE mode pause logic
- [ ] Implement ADVISE mode warning aggregation
- [ ] Implement REPORT mode telemetry

### Phase 4: Semantic Layer Connection (v4.0.0)
- [ ] Integrate actual semantic analysis service
- [ ] Enable automated pass/fail detection
- [ ] Activate retry intelligence
- [ ] Launch with limited gate set
- [ ] Gather feedback and iterate

## GateEnforcementOptions Interface

**Future Type Definition**:

```typescript
/**
 * Configuration for gate enforcement behavior
 */
interface GateEnforcementOptions {
  /**
   * Enforcement mode override for specific gates
   */
  modeOverrides?: Array<{
    gateId: string;
    mode: 'ENFORCE' | 'ADVISE' | 'REPORT';
  }>;

  /**
   * Global enforcement level
   * - strict: All gates use severity-based defaults
   * - permissive: All gates downgraded to ADVISE or REPORT
   * - custom: Use modeOverrides
   */
  level?: 'strict' | 'permissive' | 'custom';

  /**
   * Maximum retry attempts for ENFORCE mode gates
   */
  maxRetries?: number;

  /**
   * Auto-approve gates below this severity
   * (bypass ENFORCE mode for low/medium gates)
   */
  autoApproveBelow?: 'critical' | 'high' | 'medium' | 'low';

  /**
   * Include gate results in response even for REPORT mode
   */
  verboseReporting?: boolean;
}
```

**Usage Example** (Future):
```typescript
prompt_engine({
  command: ">>secure-analysis",
  quality_gates: ["security-validation", "code-quality", "documentation"],
  enforcement: {
    level: "strict",
    maxRetries: 3,
    modeOverrides: [
      { gateId: "documentation", mode: "REPORT" }  // Downgrade doc checks
    ]
  }
})
```

## Backward Compatibility

### Existing Workflows
All current workflows continue to work identically:

**Before** (v2.x):
```typescript
prompt_engine({
  command: ">>analysis",
  quality_gates: ["technical-accuracy"]
})
```

**After** (v3.0.0+):
```typescript
// Same syntax, same behavior
prompt_engine({
  command: ">>analysis",
  quality_gates: ["technical-accuracy"]
})

// Opt-in to enforcement when semantic layer available
prompt_engine({
  command: ">>analysis",
  quality_gates: ["technical-accuracy"],
  enforcement: { level: "strict" }  // Future field
})
```

### Gradual Activation
1. **v3.0**: Current state - gates provide guidance only
2. **v3.1-3.2**: Enforcement infrastructure added (disabled by default)
3. **v4.0**: Semantic layer integrated - opt-in enforcement via `enforcement` parameter
4. **v4.1+**: Default enforcement activated for specific gate categories

## Performance Considerations

### Execution Time Impact
- **ENFORCE Mode**: +500-2000ms per gate (semantic analysis + pause setup)
- **ADVISE Mode**: +200-500ms per gate (semantic analysis only)
- **REPORT Mode**: +50-200ms per gate (lightweight check + logging)

### Optimization Strategies
1. **Parallel Gate Evaluation**: Run multiple gates concurrently
2. **Caching**: Memoize gate results for identical content
3. **Progressive Enhancement**: Start with simple rules, escalate to semantic only when needed
4. **Timeout Guards**: Fail-open after 5s per gate

## Testing Strategy

### Unit Tests
- [ ] Severity → mode mapping logic
- [ ] Enforcement mode override validation
- [ ] PendingGateReview creation for ENFORCE mode
- [ ] Warning aggregation for ADVISE mode
- [ ] Telemetry logging for REPORT mode

### Integration Tests
- [ ] ENFORCE mode pause/resume flow
- [ ] ADVISE mode warning propagation
- [ ] REPORT mode silent execution
- [ ] Mixed-mode gate combinations
- [ ] Override precedence rules

### End-to-End Tests
- [ ] Security gate blocks execution with critical issue
- [ ] Code quality gate warns but continues
- [ ] Documentation gate runs silently
- [ ] Retry flow with corrections
- [ ] Max retry limit enforcement

## Open Questions

1. **Should enforcement be per-request or per-gate?**
   - Per-request: Single `enforcement` parameter for all gates
   - Per-gate: Each gate can specify its own mode
   - **Recommendation**: Both - global default with per-gate overrides

2. **How to handle transient semantic layer failures?**
   - Fail-open (skip gate, log warning)
   - Fail-closed (treat as gate failure)
   - **Recommendation**: Configurable with fail-open default

3. **Should ADVISE mode block on user request?**
   - Add `pause_on_warnings: boolean` flag
   - **Recommendation**: Yes, for educational/training scenarios

4. **Integration with chain progress tracking?**
   - Gate failures count toward step attempts
   - **Recommendation**: Yes, track in ChainSession.lifecycle

## References

- **Current Gate System**: `docs/enhanced-gate-system.md`
- **Gate Definitions**: `src/gates/core/gate-definitions.ts`
- **Session Management**: `src/chain-session/manager.ts`
- **PendingGateReview API**: `src/chain-session/types.ts:37-50`
- **Severity Levels**: `src/types/execution.ts` (documented as metadata-only)
- **Gate Types**: `src/types/execution.ts` (forward-compatible)

---

**Status**: Ready for Phase 2 implementation once semantic layer infrastructure is available.
**Next Steps**: Monitor semantic analysis progress, prepare pipeline stage integration, define validator interface contract.
