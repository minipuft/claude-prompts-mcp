# Ralph Mode: Test Scenarios & User Expectations

## Overview

This document outlines comprehensive test scenarios for shell verification gates and defines what users should expect from this expanded MCP tool capability.

---

## What the User Should Expect

### Core Value Proposition

**Before Ralph Mode:**
```
User: "Fix the auth bug"
Claude: [Writes code]
User: [Manually runs tests]
User: "Tests fail, try again"
Claude: [Fixes code]
User: [Runs tests again]
... repeat until passing
```

**With Ralph Mode:**
```
User: ">>fix-auth-bug :: verify:'npm test'"
Claude: [Writes code → runs npm test → sees failure → fixes → runs again → PASSES]
User: [Gets working solution on first response]
```

### Syntax Users Will Use

```bash
# Basic verification
>>implement-feature :: verify:"npm test"

# With retry loop (continues until success or max attempts)
>>fix-bug :: verify:"pytest -v" loop:true

# With git checkpoint (auto-rollback on failure)
>>refactor-module :: verify:"npm run build" checkpoint:true rollback:true

# With custom limits
>>optimize-code :: verify:"npm run lint" max:10 timeout:120

# Combined with quality gates
>>write-api :: verify:"npm test" :: code-quality :: "follows REST conventions"
```

### Expected Behavior Flow

| Phase | User Sees | What Happens |
|-------|-----------|--------------|
| 1. Command | Prompt submitted | Parser detects `verify:` gate |
| 2. Implementation | Claude's response | Code changes made |
| 3. Verification | "Running: npm test..." | Shell executor runs command |
| 4a. PASS | Final response with success | Verification cleared, execution completes |
| 4b. FAIL | "Attempt 2/5 - fixing..." | Error feedback, Claude retries |
| 5. Escalation | gate_action options | After 5 failures, user decides |

### Error Feedback Format

**Bounce-Back (Attempt < Max):**
```markdown
## Shell Verification FAILED (Attempt 2/5)

**Command:** `npm test`
**Exit Code:** 1

### Error Output
```
FAIL src/auth.test.ts
  ✗ should validate token (23ms)
    Expected: 200
    Received: 401
```

Analyzing failure and adjusting implementation...
```

**Escalation (Attempt = Max):**
```markdown
## Shell Verification FAILED - Maximum Attempts Reached

**Command:** `npm test`
**Attempts:** 5/5

### Recent Error Output
```
Cannot resolve module './missing-dep'
```

Use `gate_action` parameter:
- **retry**: Reset attempt count and try again
- **skip**: Bypass verification and continue
- **abort**: Stop execution
```

---

## Comprehensive Test Scenarios

### Scenario 1: Happy Path - First-Try Success

**Setup:** Simple prompt with passing verification

```typescript
// Prompt command
'>>echo-test :: verify:"echo SUCCESS && exit 0"'

// Expected flow:
// 1. Parser creates shell-verify gate
// 2. Claude generates response
// 3. Executor runs `echo SUCCESS`
// 4. Exit code 0 → PASS
// 5. Response delivered without retry loop
```

**Validates:**
- Parser correctly extracts verify syntax
- Executor handles passing commands
- No unnecessary retry attempts
- Clean user experience

---

### Scenario 2: Retry Loop - Fix on Second Attempt

**Setup:** Simulated test that fails once, then passes

```typescript
// Create a test file that tracks attempts
await writeFile(tempDir + '/attempt.txt', '0');

// Prompt command with a script that fails first, passes second
'>>fix-issue :: verify:"./check-attempts.sh"'

// check-attempts.sh:
// count=$(cat attempt.txt)
// echo $((count + 1)) > attempt.txt
// if [ $count -lt 1 ]; then exit 1; else exit 0; fi
```

**Validates:**
- Retry counter increments correctly
- Error output captured and fed back
- Second attempt executes after first failure
- State persists across attempts

---

### Scenario 3: Max Attempts Escalation

**Setup:** Command that always fails

```typescript
'>>impossible-task :: verify:"exit 1"'

// Expected flow:
// Attempt 1/5 → FAIL → bounce back
// Attempt 2/5 → FAIL → bounce back
// Attempt 3/5 → FAIL → bounce back
// Attempt 4/5 → FAIL → bounce back
// Attempt 5/5 → FAIL → ESCALATION with gate_action options
```

**Validates:**
- Counter reaches max correctly
- Escalation message appears
- `gate_action` options presented
- No infinite loop

---

### Scenario 4: gate_action: retry

**Setup:** After escalation, user sends `gate_action: "retry"`

```typescript
// State before retry action:
pendingVerification.attemptCount = 5
pendingVerification.previousResults.length = 5

// User sends:
prompt_engine(command: ">>continue", gate_action: "retry")

// Expected state after:
pendingVerification.attemptCount = 0
pendingVerification.previousResults = []
```

**Validates:**
- Attempt counter resets to 0
- Previous results cleared
- Execution resumes from fresh state

---

### Scenario 5: gate_action: skip

**Setup:** After escalation, user sends `gate_action: "skip"`

```typescript
// User sends:
prompt_engine(command: ">>continue", gate_action: "skip")

// Expected:
// 1. pendingShellVerification cleared
// 2. Execution continues without verification
// 3. Response delivered
```

**Validates:**
- Verification bypassed cleanly
- No error thrown
- Subsequent execution proceeds normally

---

### Scenario 6: gate_action: abort

**Setup:** After escalation, user sends `gate_action: "abort"`

```typescript
// User sends:
prompt_engine(command: ">>continue", gate_action: "abort")

// Expected:
// 1. Session marked as aborted
// 2. Appropriate abort message returned
// 3. No further execution
```

**Validates:**
- Execution stops immediately
- Clear abort confirmation
- State cleaned up

---

### Scenario 7: Timeout Handling

**Setup:** Command that exceeds timeout

```typescript
'>>slow-task :: verify:"sleep 60" timeout:2'

// Expected:
// 1. Command starts
// 2. After 2 seconds, process killed
// 3. result.timedOut = true
// 4. Bounce back with timeout error
```

**Validates:**
- Timeout enforced correctly
- Process killed cleanly
- Timeout distinguished from exit code failure
- Resource cleanup (no zombie processes)

---

### Scenario 8: Large Output Truncation

**Setup:** Command producing output > 5000 chars

```typescript
'>>verbose-task :: verify:"seq 1 10000"'

// Expected:
// stdout truncated to ~5000 chars
// Truncation notice: "[...truncated, showing last 5000 chars...]"
// End of output preserved (tail, not head)
```

**Validates:**
- Output capped at `SHELL_OUTPUT_MAX_CHARS`
- Important end-of-output preserved
- Clear truncation indicator
- No memory issues

---

### Scenario 9: Command Not Found

**Setup:** Invalid command

```typescript
'>>task :: verify:"nonexistent_command_xyz"'

// Expected:
// exitCode = 127 (or similar)
// stderr contains "command not found"
// Error reported clearly
```

**Validates:**
- Shell errors captured
- Appropriate exit code
- Actionable error message

---

### Scenario 10: Environment Variable Security

**Setup:** Command attempting to access secrets

```typescript
// Set in parent process
process.env.GITHUB_TOKEN = 'ghp_secret123';
process.env.AWS_SECRET_ACCESS_KEY = 'secret-key';

'>>task :: verify:"echo $GITHUB_TOKEN $AWS_SECRET_ACCESS_KEY"'

// Expected:
// stdout contains empty values
// Secrets NOT leaked to subprocess
```

**Validates:**
- Sensitive env vars filtered
- PATH, HOME still available
- Custom env vars via override work
- Security boundary maintained

---

### Scenario 11: Git Checkpoint - Success Path

**Setup:** Verification passes, checkpoint cleared

```typescript
'>>refactor :: verify:"npm test" checkpoint:true'

// Flow:
// 1. Checkpoint created (git stash)
// 2. Claude makes changes
// 3. npm test → PASS
// 4. Checkpoint cleared (stash dropped)
```

**Validates:**
- Checkpoint created before execution
- Stash dropped on success
- Working tree clean after completion

---

### Scenario 12: Git Checkpoint - Rollback Path

**Setup:** Verification fails, rollback triggered

```typescript
'>>risky-change :: verify:"npm test" checkpoint:true rollback:true'

// Flow:
// 1. Checkpoint created (stash working changes)
// 2. Claude makes bad changes
// 3. npm test → FAIL
// 4. Rollback triggered (stash pop)
// 5. Original changes restored
```

**Validates:**
- Working changes stashed
- Bad changes discarded on failure
- Original state restored via stash pop
- No data loss

---

### Scenario 13: Combined Verify + Criteria Gates

**Setup:** Both shell verification and LLM criteria

```typescript
'>>write-api :: verify:"npm test" :: code-quality'

// Expected:
// 1. Both gates parsed
// 2. Shell verification runs first (ground truth)
// 3. Criteria gate applied to response (LLM evaluation)
// 4. Both must pass for success
```

**Validates:**
- Multiple gate types coexist
- Execution order correct
- Each gate type enforced independently

---

### Scenario 14: Working Directory Override

**Setup:** Verify in specific directory

```typescript
// Assuming workingDir can be specified (future enhancement)
'>>test-submodule :: verify:"npm test" workingDir:"./packages/core"'

// Expected:
// Command executes in ./packages/core
// pwd output confirms directory
```

**Validates:**
- Working directory honored
- Relative paths resolved correctly
- Command isolation

---

### Scenario 15: Loop Mode (Continuous Until Success)

**Setup:** Loop until verification passes

```typescript
'>>fix-all-tests :: verify:"npm test" loop:true max:10'

// Expected:
// Continues attempting until exit 0 or 10 attempts
// Each attempt incorporates previous failure context
// Success breaks the loop
```

**Validates:**
- Loop continues autonomously
- Max iterations respected
- Context accumulates across attempts
- Loop exits on success

---

## MCP Tool Integration Points

### User-Facing Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `command` | string (in `:: verify:"..."`) | - | Shell command to execute |
| `loop` | boolean | false | Continue until success |
| `max` | number | 5 | Maximum attempts |
| `timeout` | number | 300 (5 min) | Seconds before kill |
| `checkpoint` | boolean | false | Create git stash backup |
| `rollback` | boolean | false | Restore on failure |
| `gate_action` | enum | - | User response after escalation |

### Expected Tool Response Structure

```json
{
  "success": true,
  "verification": {
    "command": "npm test",
    "attempts": 2,
    "passed": true,
    "lastResult": {
      "exitCode": 0,
      "stdout": "Tests: 5 passed, 5 total",
      "durationMs": 3420
    }
  },
  "content": "Feature implemented and verified..."
}
```

---

## Edge Cases to Watch

1. **Concurrent verifications** - Multiple verify gates in parallel chains
2. **Nested chains** - Verify gate inside a chain step
3. **Empty command output** - Silent success/failure
4. **Unicode in output** - Non-ASCII test output
5. **Signal handling** - SIGTERM vs SIGKILL
6. **File descriptor limits** - Many rapid executions
7. **Interactive commands** - Commands expecting stdin
8. **Network-dependent tests** - Flaky external calls

---

## Performance Expectations

| Metric | Target | Measurement |
|--------|--------|-------------|
| Command spawn latency | < 50ms | Time from invoke to process start |
| Output streaming | < 100ms lag | Time from output to capture |
| Timeout precision | ±500ms | Kill timing accuracy |
| Memory per execution | < 10MB | Output buffer + metadata |
| Concurrent executions | Up to 5 | Without resource exhaustion |

---

## Summary: User Value

**Ralph Mode transforms Claude from "suggest and hope" to "implement and verify":**

1. **Ground Truth** - Shell commands are objective validators (no LLM hallucination)
2. **Autonomous Loop** - Claude fixes its own mistakes without user intervention
3. **Safety Net** - Git checkpoints prevent destructive failures
4. **Transparency** - Full visibility into verification attempts and output
5. **Control** - User decides what happens after max attempts

The feature enables true "set and forget" prompting for implementation tasks.
