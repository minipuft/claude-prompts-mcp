# Ralph Mode: Shell Verification Gates

## Summary

Add shell-based verification gates to claude-prompts-mcp using the `:: verify:"command"` syntax. This enables "Ralph Wiggum" style autonomous loops where Claude's work is validated by real shell command execution (ground truth) rather than LLM self-evaluation.

## Syntax

```
>>implement-feature :: verify:"npm test"
>>fix-bug :: verify:"pytest -v" :: "follows coding standards"  # Can combine with criteria gates
```

## Key Insight

**No regex changes needed.** The existing gate parser (line 40 of `symbolic-operator-parser.ts`) already captures:

- `:: verify:"npm test"` → `namedColonId="verify"`, `namedColonText="npm test"`

We just need to detect `namedColonId === 'verify'` and handle it as a shell verification gate.

---

## Implementation Plan

### Phase 1: Type Definitions

**File: `/server/src/gates/shell/types.ts`** (NEW)

```typescript
export interface ShellVerifyGate {
  command: string;
  workingDir?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface ShellVerifyResult {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  command: string;
  timedOut?: boolean;
}

export interface PendingShellVerification {
  shellVerify: ShellVerifyGate;
  previousResults: ShellVerifyResult[];
  attemptCount: number;
  maxAttempts: number;
  gateId: string;
}
```

**File: `/server/src/gates/constants.ts`** (MODIFY)

- Add `SHELL_VERIFY_DEFAULT_MAX_ATTEMPTS = 5`
- Add `SHELL_VERIFY_DEFAULT_TIMEOUT = 60000`

### Phase 2: Shell Executor

**File: `/server/src/gates/shell/shell-verify-executor.ts`** (NEW)

Reuse patterns from `scripts/execution/script-executor.ts`:

- `spawn('sh', ['-c', command])`
- Timeout enforcement via `setTimeout` + `proc.kill()`
- Capture stdout/stderr
- Exit code 0 = PASS, non-zero = FAIL
- Truncate large output (max 5000 chars)

### Phase 3: Parser Integration

**File: `/server/src/execution/parsers/symbolic-operator-parser.ts`** (MODIFY)

In the gate parsing loop (lines 102-138), add detection for `verify:`:

```typescript
// Named gate with colon syntax: :: id:"criteria"
if (namedColonId && namedColonText) {
  // NEW: Detect shell verification
  if (namedColonId === "verify") {
    operators.push({
      type: "gate",
      gateId: `shell-verify-${Date.now()}`,
      shellVerify: {
        command: namedColonText,
        timeout: 60000,
      },
      scope: "execution",
      retryOnFailure: true,
      maxRetries: 5,
    });
    continue;
  }
  // ... existing named gate logic
}
```

**File: `/server/src/execution/parsers/types/operator-types.ts`** (MODIFY)

Add to `GateOperator`:

```typescript
shellVerify?: {
  command: string;
  timeout?: number;
  workingDir?: string;
};
```

### Phase 4: Pipeline State

**File: `/server/src/execution/context/internal-state.ts`** (MODIFY)

Add to `PipelineInternalState.gates`:

```typescript
pendingShellVerification?: PendingShellVerification;
shellVerifyResults?: ShellVerifyResult[];
```

### Phase 5: Pipeline Stage

**File: `/server/src/execution/pipeline/stages/08b-shell-verification-stage.ts`** (NEW)

Position: After `StepResponseCaptureStage` (08), before `ExecutionStage` (09)

Logic:

1. Check for `pendingShellVerification` in state
2. Execute shell command via `ShellVerifyExecutor`
3. If PASS (exit 0): Clear verification, proceed
4. If FAIL (exit != 0):
   - If `attempts < 5`: Return formatted error to chat (bounce-back)
   - If `attempts >= 5`: Return guidance request with `gate_action` options

**Error Format (Bounce-Back):**

```markdown
## Shell Verification FAILED (Attempt 2/5)

**Command:** `npm test`
**Exit Code:** 1

### Error Output
```

test/auth.spec.ts:45 - Expected 200, got 403

```

Please fix the issues and submit again.
```

**Escalation Format (After 5 Failures):**

```markdown
## Shell Verification FAILED - Maximum Attempts Reached

**Command:** `npm test`
**Attempts:** 5/5

Use `gate_action` parameter:

- **retry**: Reset attempt count
- **skip**: Bypass verification
- **abort**: Stop execution
```

### Phase 6: Stage Registration

**File: `/server/src/execution/pipeline/pipeline-builder.ts`** (MODIFY)

Register `ShellVerificationStage` after stage 08:

```typescript
stages.push(
  createShellVerificationStage(shellVerifyExecutor, chainSessionManager, logger)
);
```

### Phase 7: Inline Gate Stage Integration

**File: `/server/src/execution/pipeline/stages/02-inline-gate-stage.ts`** (MODIFY)

When processing named gates, detect `verify:` gates and store in context:

```typescript
if (namedGate.gateId === "verify" || namedGate.shellVerify) {
  // Store shell verification config for later execution
  context.state.gates.pendingShellVerification = {
    shellVerify: { command: namedGate.shellVerify.command },
    attemptCount: 0,
    maxAttempts: 5,
    gateId: `shell-verify-${Date.now()}`,
    previousResults: [],
  };
}
```

---

## Files Summary

### New Files

1. `/server/src/gates/shell/types.ts` - Type definitions
2. `/server/src/gates/shell/shell-verify-executor.ts` - Shell executor service
3. `/server/src/gates/shell/index.ts` - Module exports
4. `/server/src/execution/pipeline/stages/08b-shell-verification-stage.ts` - Pipeline stage

### Modified Files

1. `/server/src/gates/constants.ts` - Add shell verify constants
2. `/server/src/execution/parsers/symbolic-operator-parser.ts` - Detect `verify:` in gate loop
3. `/server/src/execution/parsers/types/operator-types.ts` - Add `shellVerify` to `GateOperator`
4. `/server/src/execution/context/internal-state.ts` - Add shell verification state
5. `/server/src/execution/pipeline/stages/02-inline-gate-stage.ts` - Handle shell verify gates
6. `/server/src/execution/pipeline/pipeline-builder.ts` - Register new stage

---

## Execution Flow

```
User: >>implement-feature :: verify:"npm test"

1. ParsingStage: Parse command
2. SymbolicOperatorParser: Detect `verify:"npm test"`, create GateOperator with shellVerify
3. InlineGateExtractionStage: Store pendingShellVerification in state
4. [Other stages 03-07]
5. StepResponseCaptureStage: Capture user_response
6. ShellVerificationStage (NEW):
   - If no pending verification → skip
   - Execute "npm test"
   - Exit 0 → PASS → clear verification, proceed
   - Exit != 0 → FAIL:
     - attempts < 5 → return error to chat
     - attempts >= 5 → return escalation prompt
7. ExecutionStage: Render prompt for Claude

[Claude implements, submits response]

8. Loop back: user_response triggers verification again
9. Repeat until PASS or user chooses gate_action
```

---

## Testing Strategy

### Unit Tests

- `shell-verify-executor.test.ts`: Command execution, timeout, exit codes
- `symbolic-operator-parser.test.ts`: `verify:"command"` parsing

### Integration Tests

- `shell-verification-stage.test.ts`: Full pipeline flow with mock executor
- `shell-verify-retry-flow.test.ts`: Bounce-back and escalation behavior

### E2E Tests

- Real shell command execution with `npm test` or similar
- Verify retry counting and escalation after 5 failures

---

## Edge Cases

1. **Command Not Found**: Clear error message with command
2. **Timeout**: Kill process, return timeout error
3. **Large Output**: Truncate to 5000 chars
4. **Working Directory**: Default to cwd, allow override
5. **Combine with Criteria Gates**: Both should work together
