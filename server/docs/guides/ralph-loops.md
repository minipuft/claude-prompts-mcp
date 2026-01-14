# Ralph Loops: Autonomous Verification

"Ralph loops" are verification-driven development cycles where Claude keeps working until tests pass - ground-truth validation via shell commands rather than LLM self-evaluation.

## Quick Start

```bash
# Basic: verify with test command
>>implement-feature :: verify:"npm test"

# With preset: full CI validation
>>fix-bug :: verify:"pytest" :full

# Auto-loop: Stop hook integration
>>refactor :: verify:"cargo test" loop:true
```

## How It Works

1. Claude implements the requested change
2. Shell command runs (e.g., `npm test`)
3. If exit code 0 → **SUCCESS**, continue to next step
4. If exit code non-zero → Claude sees error, tries again
5. After max tries → User decides (retry/skip/abort)

```
┌─────────────────┐
│  User Request   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Claude Executes │────▶│  Shell Command  │
│    Prompt       │     │   (npm test)    │
└─────────────────┘     └────────┬────────┘
         ▲                       │
         │              ┌────────▼────────┐
         │              │   Exit Code?    │
         │              └────────┬────────┘
         │                       │
         │           ┌───────────┴───────────┐
         │           │                       │
         │     exit 0 (PASS)           exit != 0 (FAIL)
         │           │                       │
         │           ▼                       ▼
         │    ┌─────────────┐        ┌──────────────┐
         │    │  Continue   │        │ More tries?  │
         │    └─────────────┘        └──────┬───────┘
         │                                  │
         │                        ┌─────────┴─────────┐
         │                        │                   │
         │                       YES                 NO
         │                        │                   │
         └────────────────────────┘                   ▼
                   (bounce-back)              ┌──────────────┐
                                              │  Escalate    │
                                              │  to User     │
                                              └──────────────┘
```

## Presets

Presets provide common configurations for different development scenarios:

| Preset | Max Attempts | Timeout | Best For |
|--------|-------------|---------|----------|
| `:fast` | 1 | 30s | Quick iteration during development |
| `:full` | 5 | 300s (5 min) | CI-style validation |
| `:extended` | 10 | 600s (10 min) | Long-running test suites |

```bash
# Quick feedback during development
>>fix-typo :: verify:"npm run lint" :fast

# Standard CI validation (recommended default)
>>implement-auth :: verify:"npm test" :full

# Comprehensive testing for complex changes
>>refactor-db :: verify:"npm run test:integration" :extended
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `max:N` | 5 | Maximum verification attempts before escalation |
| `timeout:N` | 300 | Command timeout in seconds |
| `loop:true` | false | Enable Stop hook for autonomous loops |

### Combining Options with Presets

Explicit options override preset values:

```bash
# Use :fast preset but with more attempts
:: verify:"npm test" :fast max:3

# Use :full preset but shorter timeout
:: verify:"npm test" :full timeout:60
```

## Stop Hook Integration

When `loop:true` is enabled, the Stop hook prevents Claude from stopping until verification passes or max tries are exhausted. This enables fully autonomous verification loops.

```bash
# Autonomous loop - Claude keeps trying until tests pass
>>implement-feature :: verify:"npm test" loop:true

# Combined with preset
>>refactor :: verify:"pytest" :full loop:true
```

### How Stop Hook Works

1. When verification starts with `loop:true`, state is written to `runtime-state/verify-active.json`
2. Claude makes changes and attempts to finish responding (end of turn)
3. The Stop hook intercepts the stop and runs the verification command
4. If PASS → Claude stops normally, user sees success
5. If FAIL → Stop hook blocks, feeds error back to Claude, Claude continues automatically
6. Only when verification passes or max attempts are reached can Claude stop

**Important:** The Stop hook runs at the **end of Claude's turn**, not after each tool call. This means:
- Claude makes all changes in one turn
- When Claude finishes responding, the hook verifies the work
- If verification fails, Claude gets another turn to fix issues

## Context Isolation (Advanced)

Long-running verification loops can accumulate significant context - code changes, test output, reasoning about failures. After several iterations, this "context rot" consumes tokens and may hit context limits.

**Context isolation** addresses this by spawning fresh Claude CLI instances for later iterations, keeping the parent context lean.

### How It Works

```
Iteration 1-3: In-context (fast, direct feedback)
Iteration 4+:  CLI spawn (isolated, fresh context)
```

```
┌─────────────────────────────────────────────────────────────────┐
│                     Parent Claude Session                        │
│  (context preserved - only sees spawn/result summaries)          │
├─────────────────────────────────────────────────────────────────┤
│  Iteration 1: [in-context] Fix attempt → FAIL → bounce back     │
│  Iteration 2: [in-context] Fix attempt → FAIL → bounce back     │
│  Iteration 3: [in-context] Fix attempt → FAIL → trigger isolation│
│  Iteration 4: [CLI spawn] ──────────────────────┐               │
│                                                  ↓               │
│                              ┌──────────────────────────────────┐│
│                              │  claude --print process          ││
│                              │  - Fresh context                 ││
│                              │  - Receives session story        ││
│                              │  - Makes fix, runs verification  ││
│                              │  - Returns PASS/FAIL + summary   ││
│                              └──────────────────────────────────┘│
│  [Reads result] ← PASS → Report success to user                 │
│  [Reads result] ← FAIL → Report isolated attempt, bounce back   │
└─────────────────────────────────────────────────────────────────┘
```

### Session Story

Spawned instances receive rich context about the debugging journey:

- **Original Goal**: What the user asked for
- **Session Story**: What was tried, what failed, what was learned
- **Git-Style Diff Summary**: Files modified during the session
- **Last Failure Output**: The error that triggered isolation
- **What To Try Next**: Suggestions based on accumulated lessons

This ensures spawned instances don't repeat previous mistakes.

### Configuration

Configure isolation in `server/config.json`:

```json
{
  "verification": {
    "inContextAttempts": 3,
    "isolation": {
      "enabled": true,
      "maxBudget": 1.00,
      "timeout": 300,
      "permissionMode": "delegate"
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `verification.inContextAttempts` | `3` | Iterations before spawning CLI (1-3 = in-context, 4+ = isolated) |
| `verification.isolation.enabled` | `true` | Enable context isolation |
| `verification.isolation.maxBudget` | `1.00` | Max USD budget per spawn |
| `verification.isolation.timeout` | `300` | Timeout in seconds for spawned instance |
| `verification.isolation.permissionMode` | `delegate` | CLI permission mode (`delegate`, `ask`, `deny`) |

### Spawn Output (What You Get Back)

When isolation runs, the Stop hook returns structured data:

```
## ✅ Verification PASSED (Iteration 4)

**Method:** Isolated execution (fresh context)
**Command:** `npm test`

**Spawn Stats:**
- Cost: $0.1770
- Duration: 31.0s
- Tokens: 2 in / 509 out (cache: 168,511)
- Turns: 6

### Result
Spawned instance fixed the issue.
PASS: all tests passing
```

The response includes orchestration metadata:

```json
{
  "metadata": {
    "type": "ralph_verification",
    "passed": true,
    "iteration": 4,
    "method": "isolated",
    "stats": {
      "input_tokens": 2,
      "output_tokens": 509,
      "cache_read_tokens": 168511,
      "total_cost_usd": 0.177,
      "duration_ms": 31000,
      "num_turns": 6
    }
  }
}
```

Use this metadata to:
- Track costs across verification loops
- Make budget-based decisions
- Log debugging sessions
- Build dashboards

### Disabling Isolation

To keep all iterations in-context (no spawning):

```json
{
  "verification": {
    "isolation": {
      "enabled": false
    }
  }
}
```

### Best Practices for Isolation

1. **Use for long loops**: Isolation shines when you expect 5+ iterations
2. **Monitor budget**: Each spawn costs up to `maxBudgetPerIteration`
3. **Review spawned output**: The parent session reports what the isolated instance tried
4. **Checkpoint before isolation**: Use `resource_manager checkpoint` for safety

## Escalation and Gate Actions

After max attempts, the user is prompted for a decision:

```
## Shell Verification FAILED - Maximum Attempts Reached

**Command:** `npm test`
**Attempts:** 5/5
**Last Exit Code:** 1

### Error Output:
```
FAIL src/auth.test.ts
  ✕ should validate token (15ms)
```

**Choose an action using `gate_action` parameter:**
- `retry` - Reset attempts and try again
- `skip` - Continue without verification
- `abort` - Stop execution
```

### Using gate_action

```bash
# Reset attempt count and try again
prompt_engine(chain_id:"chain-abc", gate_action:"retry")

# Skip verification and continue
prompt_engine(chain_id:"chain-abc", gate_action:"skip")

# Abort the chain
prompt_engine(chain_id:"chain-abc", gate_action:"abort")
```

## Common Patterns

### Bug Fix with Test Verification

```bash
>>fix-bug :: verify:"npm test -- --testPathPattern=auth" :fast
```

### Feature Implementation with Full Test Suite

```bash
>>implement-login :: verify:"npm test" :full
```

### Lint Before Commit

```bash
>>cleanup-code :: verify:"npm run lint && npm run typecheck" :fast
```

### Database Migration Testing

```bash
>>add-migration :: verify:"npm run migrate && npm run test:db" :extended
```

### Multi-Command Verification

```bash
# Run multiple commands in sequence
>>feature :: verify:"npm run typecheck && npm run lint && npm test" :full
```

## Checkpoint and Rollback

For checkpoint and rollback functionality (git stash before verification, restore on failure), use the `resource_manager` tool:

```bash
# Create a checkpoint before risky changes
resource_manager(resource_type:"checkpoint", action:"create", name:"pre-refactor")

# Run verification
>>refactor :: verify:"npm test" :full

# If something goes wrong, rollback
resource_manager(resource_type:"checkpoint", action:"rollback", name:"pre-refactor")
```

## Best Practices

1. **Start with `:fast`** during active development for quick feedback
2. **Use `:full`** before committing to ensure CI will pass
3. **Use `:extended`** for integration tests or large test suites
4. **Combine with criteria gates** for comprehensive validation:
   ```bash
   >>implement :: verify:"npm test" :full :: "follows coding standards"
   ```
5. **Use specific test patterns** to speed up verification:
   ```bash
   :: verify:"npm test -- --testPathPattern=auth"
   ```

## Troubleshooting

### Verification keeps failing

- Check the error output in the bounce-back message
- Try running the command manually to debug
- Use `:fast` to iterate quickly on fixes

### Timeout issues

- Increase timeout with `timeout:N` option
- Use `:extended` preset for long-running tests
- Check if tests are hanging

### Stop hook not working

- Ensure `loop:true` is set
- Check that `runtime-state/verify-active.json` is being created
- Verify Stop hook is configured in Claude Code settings

## See Also

- [Gates Guide](./gates.md) - Quality validation gates
- [Chains Guide](./chains.md) - Multi-step execution
- [MCP Tools Reference](../reference/mcp-tools.md) - Full parameter documentation
