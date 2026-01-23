# Gates Guide

Gates are quality validation mechanisms that ensure Claude's outputs meet specific criteria before proceeding.

## Gate Types

| Type | Validation Method | Best For |
|------|-------------------|----------|
| **Criteria Gates** | LLM self-evaluation | Subjective quality checks |
| **Shell Verification** | Exit code (ground truth) | Test suites, linting, builds |
| **Canonical Gates** | Pre-defined standards | Reusable quality patterns |

## Criteria Gates (LLM Self-Evaluation)

Criteria gates use inline text criteria that Claude evaluates against its own output.

### Syntax

```bash
# Single criterion
>>prompt :: "criteria text"

# Multiple criteria
>>prompt :: "criterion 1" :: "criterion 2"

# Named gate reference
>>prompt :: code-quality
```

### Examples

```bash
# Conciseness check
>>summarize :: "under 200 words"

# Content requirements
>>analyze :: "include statistics" :: "cite sources"

# Style enforcement
>>write-docs :: "use active voice" :: "include code examples"
```

### How It Works

1. Claude executes the prompt
2. Gate criteria are injected into the response context
3. Claude self-evaluates: `GATE_REVIEW: PASS|FAIL - reason`
4. If FAIL, automatic retry with feedback (up to 2 attempts)
5. After max retries, user decides via `gate_action`

## Shell Verification Gates (Ground Truth)

Shell verification uses actual command execution for validation—exit code 0 = PASS, non-zero = FAIL.

### Syntax

```bash
# Basic
:: verify:"command"

# With options
:: verify:"command" max:N timeout:N

# With presets
:: verify:"command" :fast|:full|:extended
```

### Presets

| Preset | Max Attempts | Timeout | Use Case |
|--------|-------------|---------|----------|
| `:fast` | 1 | 30s | Quick feedback |
| `:full` | 5 | 300s | CI validation |
| `:extended` | 10 | 600s | Long tests |

### Examples

```bash
# Run tests after implementation
>>implement-feature :: verify:"npm test"

# Quick lint check
>>cleanup :: verify:"npm run lint" :fast

# Full test suite
>>refactor :: verify:"npm test" :full

# Combined with criteria
>>implement :: verify:"npm test" :: "follows coding standards"
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `max:N` | 5 | Maximum attempts |
| `timeout:N` | 300 | Timeout in seconds |
| `loop:true` | false | Stop hook integration |

See [Ralph Loops Guide](./ralph-loops.md) for comprehensive shell verification documentation.

## Canonical Gates

Pre-defined gates stored in `resources/gates/` for reusable quality patterns.

### Available Gates

| Gate ID | Severity | Purpose |
|---------|----------|---------|
| `code-quality` | medium | Error handling, naming, edge cases |
| `security-awareness` | medium | No secrets, input validation |
| `test-coverage` | medium | Tests included |
| `content-structure` | low | Headers, lists, examples |
| `api-documentation` | medium | Endpoints, params, examples |
| `pr-security` | critical | No eval, parameterized queries |
| `pr-performance` | medium | Memoization, no console.log |
| `plan-quality` | high | Files, risks, assumptions |

### Usage

```bash
# Reference by ID
>>code_review :: code-quality :: security-awareness

# Combine with inline criteria
>>implement :: code-quality :: "under 500 lines"
```

## Gate Responses

### Pass Response

```
GATE_REVIEW: PASS - All criteria met. Code includes error handling and follows naming conventions.
```

### Fail Response (Retry Available)

```
GATE_REVIEW: FAIL - Missing error handling for edge case X.

[Claude automatically retries with this feedback]
```

### Escalation (Max Retries)

After max attempts, user is prompted for `gate_action`:

- `retry` - Reset attempts and try again
- `skip` - Continue without validation
- `abort` - Stop execution

```bash
prompt_engine(chain_id:"chain-abc", gate_action:"retry")
```

## Combining Gates

Gates can be combined with other operators:

```bash
# Framework + Gate
@CAGEERF >>analyze :: "comprehensive analysis"

# Chain + Gate (gate applies to final step)
>>research --> >>analyze :: "cite sources"

# Style + Gate
#analytical >>report :: "include data visualizations"

# Multiple gate types
>>implement :: verify:"npm test" :: code-quality :: "follows DRY principle"
```

## Best Practices

1. **Use shell verification for objective criteria** (tests, linting, builds)
2. **Use criteria gates for subjective quality** (style, completeness)
3. **Combine both for comprehensive validation**:
   ```bash
   >>implement :: verify:"npm test" :: "readable code" :: "documented functions"
   ```
4. **Use presets** for consistent verification across projects
5. **Reference canonical gates** for team-wide standards

## See Also

- [Ralph Loops Guide](./ralph-loops.md) - Detailed shell verification documentation
- [Chains Lifecycle](../concepts/chains-lifecycle.md) - Multi-step execution
- [MCP Tools Reference](../reference/mcp-tools.md) - Full parameter documentation
