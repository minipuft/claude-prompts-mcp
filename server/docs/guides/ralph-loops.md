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
2. If Claude tries to stop (user presses Ctrl+C or Claude decides to stop), the Stop hook reads this file
3. If verification is pending and not at max attempts, the Stop hook blocks the stop and feeds the error back to Claude
4. Claude sees the error and automatically tries again
5. Only when verification passes or max attempts are reached can Claude stop

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
