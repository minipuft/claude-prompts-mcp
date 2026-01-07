# Ralph Mode: Shell Verification Gates

> **Status:** Planning Complete
> **Created:** 2026-01-06
> **Feature:** Add shell-based verification gates using `:: verify:"command"` syntax

## Background: Ralph Wiggum Comparison

This feature implements "Ralph Wiggum" style autonomous loops as server-side middleware, differentiating from client-side bash script approaches.

### Market Analysis

| Aspect          | Client-Side Ralph (bash scripts) | Our Approach (MCP Middleware)            |
| --------------- | -------------------------------- | ---------------------------------------- |
| **Location**    | User's terminal                  | MCP Server                               |
| **Portability** | Requires specific CLI + scripts  | Works with any MCP client                |
| **Visibility**  | Terminal logs                    | Chat UI (Glass Box)                      |
| **Control**     | Agent self-loops                 | Client-initiated (host LLM orchestrates) |
| **Safety**      | Harder to interrupt              | Easy intervention via `gate_action`      |

### Why This Matters

Moving verification from the **Edge** (user's terminal) to the **Protocol** (MCP Server) is the same architectural leap as moving form validation from client-side JavaScript to server-side logic. It's safer, cleaner, and platform-agnostic.

---

## Summary

Add shell-based verification gates to claude-prompts-mcp using the `:: verify:"command"` syntax. This enables autonomous loops where Claude's work is validated by real shell command execution (ground truth) rather than LLM self-evaluation.

## Syntax

```
>>implement-feature :: verify:"npm test"
>>fix-bug :: verify:"pytest -v" :: "follows coding standards"  # Can combine with criteria gates
```

## Key Design Decisions

### 1. Naming: `verify:` over `shell:` or `script:`

- **`verify:`** - Semantic naming (describes intent, not mechanism)
- Distinct from existing `scripts/` infrastructure (prompt-scoped tools)
- Clear purpose: verification gate, not arbitrary execution

### 2. Visibility: Hybrid "Glass Box"

- **Bounce-back by default**: Each failure returns to chat (visible to user and model)
- **Escalate after limit**: After 5 failures, prompt user for guidance
- **No black box**: User can intervene, steer, or abort at any point

### 3. Integration: Expand `::` gates

- Reuses existing gate regex (no pattern changes needed)
- Leverages gate retry infrastructure
- Consistent with existing `:: "criteria"` syntax

### 4. Control: Client-Initiated Loops

- Host LLM (Claude Code) maintains control
- Server executes verification, returns result to chat
- No autonomous server-side looping (prevents runaway agents)

---

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
  if (namedColonId === 'verify') {
    operators.push({
      type: 'gate',
      gateId: `shell-verify-${Date.now()}`,
      shellVerify: {
        command: namedColonText,
        timeout: 60000,
      },
      scope: 'execution',
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
if (namedGate.gateId === 'verify' || namedGate.shellVerify) {
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

### New Files (4)
1. `/server/src/gates/shell/types.ts` - Type definitions
2. `/server/src/gates/shell/shell-verify-executor.ts` - Shell executor service
3. `/server/src/gates/shell/index.ts` - Module exports
4. `/server/src/execution/pipeline/stages/08b-shell-verification-stage.ts` - Pipeline stage

### Modified Files (6)
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

## Architecture Comparison

### Current Gates vs. Shell Verification

| Aspect           | Current Gates (`::`)  | Shell Verification (`verify:`) |
| ---------------- | --------------------- | ------------------------------ |
| **Verification** | LLM self-evaluation   | Shell command execution        |
| **Ground Truth** | Model's judgment      | Exit code (0 = pass)           |
| **Evidence**     | PASS/FAIL verdict     | stdout/stderr output           |
| **Retry Logic**  | 2 attempts default    | 5 attempts default             |
| **Escalation**   | `gate_action` options | Same `gate_action` options     |

### Existing Infrastructure Leveraged

1. **Session persistence** - `chain-run-registry.json` survives transport
2. **Retry mechanism** - `pendingGateReview.attemptCount` tracking
3. **Gate precedence** - Temporary → Template → Category → Framework
4. **Pipeline stages** - Including `GateReviewStage` patterns
5. **ScriptExecutor patterns** - Subprocess, timeout, output capture

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
6. **Environment Variables**: Pass through safe env vars (same as ScriptExecutor)

---

## Marketing Value Proposition

> "Everyone is running 'Ralph Loops' with dumb bash scripts. That's dangerous.
> `claude-prompts-mcp` introduces **Universal Verification Middleware**.
> - **Safe:** Stops infinite loops server-side with configurable limits
> - **Smart:** Uses Shell Execution (ground truth) alongside LLM Gates
> - **Portable:** Works with Claude Desktop, Cursor, VS Code—any MCP client
> - **Visible:** Glass Box architecture - see every error, steer mid-loop"

---

## References

- [Ralph Wiggum Blog Post](https://paddo.dev/blog/ralph-wiggum-autonomous-loops/)
- Existing infrastructure: `/server/src/scripts/execution/script-executor.ts`
- Gate system: `/server/src/gates/`
- Pipeline: `/server/src/execution/pipeline/`
