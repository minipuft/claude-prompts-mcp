# Gates

> Status: canonical

Make Claude check its own work. Gates inject quality criteria—Claude self-evaluates, no manual review needed.

## Quick Start

```bash
# Inline gate with any prompt
prompt_engine(command:">>summarize :: 'under 200 words' :: 'include statistics'")

# Named gates for code review
prompt_engine(command:">>review", gates:["code-quality", "security-awareness"])

# Mix built-in gates with custom criteria
prompt_engine(command:">>analyze", gates:[
  "code-quality",
  {"name": "OWASP Check", "description": "Flag OWASP Top 10 vulnerabilities"}
])
```

**Result**: Claude's response includes a self-assessment. Server auto-retries with feedback if criteria aren't met.

---

## Why Use Gates?

Stop reviewing outputs manually. Gates make Claude verify its own work against your criteria.

| Without Gates | With Gates |
|--------------|------------|
| "Looks good" → ship it → bugs later | Claude checks for error handling → catches issues |
| Manual security review → time sink | `security-awareness` gate → automatic checks |
| Inconsistent quality across prompts | Same gates applied consistently |

---

## Three Ways to Add Gates

| Method | Best For | Example |
|--------|----------|---------|
| **Inline (`::`)** | Quick one-off criteria | `:: 'under 200 words'` |
| **Built-in IDs** | Consistent standards | `gates: ["code-quality"]` |
| **Quick Gates** | Custom LLM-generated validation | `{"name": "...", "description": "..."}` |

**Related**: [MCP Tools Reference](../reference/mcp-tools.md) • [Chains Guide](chains.md)

---

## Discovery Commands

Don't memorize gate IDs—discover them:

```bash
# List all gates
prompt_engine(command: ">>gates")

# Search by keyword
prompt_engine(command: ">>gates security")

# Get syntax help
prompt_engine(command: ">>guide gates")
```

**Typo correction**: `:: code-qualitty` → *"Did you mean: code-quality?"*

---

## Precedence Ladder

Gates stack in this order (first match wins):

| Priority | Type | Source |
|----------|------|--------|
| 1 | Temporary | Inline `::` criteria → execution-scoped |
| 2 | Template | Prompt metadata `inline_gate_definitions` |
| 3 | Category | Auto-applied by prompt category (e.g., `code` → `code-quality`) |
| 4 | Framework | Active methodology (CAGEERF, ReACT, etc.) |
| 5 | Fallback | `content-structure` when nothing else matches |

---

## Runtime Config

Control gates via `server/config.json`:

| Setting | Default | Effect |
|---------|---------|--------|
| `frameworks.enableMethodologyGates` | `true` | `false` = skip framework gates |
| `frameworks.enableSystemPromptInjection` | `true` | `false` = no framework context in prompts |
| `frameworks.enableDynamicToolDescriptions` | `true` | `false` = static tool descriptions |

Use for prototyping or leaner validation.

---

## Gate Definitions

Gate definitions use a **YAML + Markdown** structure, mirroring the methodology system:

```
server/resources/gates/
├── code-quality/
│   ├── gate.yaml       # Gate configuration
│   └── guidance.md     # Guidance content (inlined at load time)
├── security-awareness/
│   ├── gate.yaml
│   └── guidance.md
└── ...
```

Edit files in `server/resources/gates/{id}/`, and changes are hot-reloaded without server restart.

### Built-in Gates

**Code & Development**
| Gate | What it checks |
|------|----------------|
| `code-quality` | Error handling, naming, edge cases |
| `security-awareness` | No hardcoded secrets, input validation |
| `test-coverage` | Tests included with code |

**Documentation**
| Gate | What it checks |
|------|----------------|
| `content-structure` | Headers, lists, examples (fallback gate) |
| `api-documentation` | Endpoints, params, responses, examples |
| `educational-clarity` | Step-by-step, examples, clear explanations |

**Analysis**
| Gate | What it checks |
|------|----------------|
| `technical-accuracy` | Version numbers, citations, specs |
| `research-quality` | Sources cited, credible references |
| `plan-quality` | Files identified, risks noted (severity: high) |

**PR Review** (explicit request required)
| Gate | Severity | What it checks |
|------|----------|----------------|
| `pr-security` | critical | No eval(), no secrets, parameterized queries |
| `pr-performance` | medium | Memoization, no console.log in prod |

**Framework**
| Gate | When active |
|------|-------------|
| `framework-compliance` | Any methodology enabled (CAGEERF, ReACT, 5W1H, SCAMPER) |

### Definition Structure

**gate.yaml** — Gate configuration:

```yaml
id: code-quality
name: Code Quality Standards
type: validation
description: Ensures generated code follows best practices
guidanceFile: guidance.md  # References external guidance file

# Optional severity for enforcement behavior
severity: medium  # low | medium | high | critical

# Optional enforcement mode override
enforcementMode: advisory  # blocking | advisory | informational

pass_criteria:
  - type: content_check
    min_length: 100
    required_patterns:
      - try
      - catch
    forbidden_patterns:  # Optional patterns that should NOT appear
      - 'eval('
      - 'innerHTML ='

retry_config:
  max_attempts: 2
  improvement_hints: true
  preserve_context: true

activation:
  prompt_categories:
    - code
    - development
  explicit_request: false
  framework_context:  # Optional, for framework-specific gates
    - CAGEERF
```

**guidance.md** — Guidance content (separate file for easier editing):

```markdown
**Code Quality Standards:**
- Include error handling and input validation
- Add inline comments for complex logic
- Follow consistent naming conventions
- Consider edge cases and boundary conditions
```

Key fields:
- `guidanceFile` — Path to external guidance file (relative to gate directory)
- `activation` — When this gate applies (categories, frameworks, explicit request)
- `pass_criteria` — Validation rules (currently auto-pass; see Validation Check Types)
- `gate_type` — Classification: `framework`, `category`, or omit for default
- `severity` — Determines enforcement behavior: `low`, `medium`, `high`, `critical`
- `enforcementMode` — Override default enforcement: `blocking`, `advisory`, `informational`

---

## How Validation Works

Gates inject criteria into prompts. Claude self-evaluates. Server routes based on the verdict.

| Check Type | Status |
|------------|--------|
| `content_check` | Auto-passes (guidance-only) |
| `pattern_check` | Auto-passes (guidance-only) |
| `llm_self_check` | Coming soon (LLM API) |

**Why no regex/length checks?** An output can pass string checks while being semantically wrong. We inject guidance and let Claude reason about quality.

---

## Specifying Gates

Three ways to add gates to your prompts, from simplest to most powerful:

### 1. Registered Gate IDs (Strings)

Use predefined gates by their ID:

```bash
prompt_engine(command: ">>review", gates: ["code-quality", "security-awareness"])
```

### 2. Quick Gates (RECOMMENDED)

**Best for LLM-generated validation.** Simple `{name, description}` objects that auto-default to sensible settings:

```bash
prompt_engine(
  command: ">>analysis",
  gates: [
    {"name": "Source Quality", "description": "All claims must cite official docs"},
    {"name": "Actionable Output", "description": "Include specific next steps"}
  ]
)
```

Quick Gates auto-default to:
- `severity: "medium"`
- `type: "validation"`
- `scope: "execution"`

### 3. Full Gate Definitions

For production workflows needing precise control:

```bash
gates: [{
  "id": "security-gate",
  "name": "Security Validation",
  "severity": "critical",
  "criteria": ["No hardcoded secrets", "Input validation present"],
  "guidance": "Flag vulnerabilities with severity ratings",
  "apply_to_steps": [2, 3]
}]
```

### Mixed Types

Combine all three in one array:

```bash
gates: [
  "code-quality",                                           // Registered
  {"name": "OWASP", "description": "Check OWASP Top 10"},  // Quick Gate
  {"id": "gdpr", "criteria": ["No PII"], "severity": "high"} // Full
]
```

### Inline Syntax (:: Operator)

Use the `::` operator for quick inline criteria:

```bash
# Anonymous inline gate (auto-generated ID)
prompt_engine(command: ">>summarize :: 'under 200 words'")

# Named inline gate (custom ID for tracking)
prompt_engine(command: ">>review :: security:'no hardcoded secrets'")

# Canonical gate reference
prompt_engine(command: ">>analyze :: code-quality")

# Combine multiple gates
prompt_engine(command: ">>code :: security:'validate inputs' :: code-quality")
```

**Gate Types**:

| Type | Syntax | Description |
|------|--------|-------------|
| Anonymous | `:: "criteria"` | Auto-generated ID, criteria as guidance |
| Named | `:: id:"criteria"` | Custom ID for tracking in output |
| Canonical | `:: gate-id` | Registered gate with full guidance |
| Shell Verify | `:: verify:"command"` | Ground-truth validation via shell exit code |

---

## Shell Verification Gates

Shell verification gates execute real commands for ground-truth validation instead of LLM self-evaluation.

### Basic Usage

```bash
# Run tests after Claude's work
prompt_engine(command: ">>implement-feature :: verify:'npm test'")

# Multiple verification commands
prompt_engine(command: ">>code :: verify:'npm run typecheck && npm test'")
```

**Flow**: Claude works → Verification runs → Exit 0 = PASS, non-zero = FAIL → Bounce-back on failure

### Autonomous Loops (Ralph Wiggum Style)

Enable `loop:true` for true autonomous execution where Claude keeps working until tests pass:

```bash
prompt_engine(command: ">>fix-all-errors :: verify:'npm test' loop:true max:15")
```

**Flow**: Claude works → Tries to stop → Stop hook runs verification → If FAIL: blocked, error fed back → Loop continues

### Git Safety

Checkpoint and rollback for risky changes:

```bash
prompt_engine(command: ">>refactor :: verify:'npm test' checkpoint:true rollback:true")
```

**Flow**: Git stash created → Verification runs → If FAIL with rollback: changes restored → If PASS: stash cleared

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `timeout:N` | number | 300 | Timeout in seconds |
| `loop:true` | boolean | false | Enable Stop hook for autonomous loops |
| `max:N` | number | 10 | Max iterations when loop enabled |
| `checkpoint:true` | boolean | false | Git stash before verification |
| `rollback:true` | boolean | false | Git restore on failure |

### Example Patterns

```bash
# CI-style validation
>>implement :: verify:"npm test && npm run lint"

# Long-running with extended timeout
>>prepare-release :: verify:"npm run ci" timeout:600 loop:true

# Safe experimentation
>>refactor-auth :: verify:"npm test" checkpoint:true rollback:true
```

**Related**: Invoke `/verify` skill for detailed usage patterns.

---

## Unified Gates Parameter

The `gates` parameter is the **single canonical way** to specify quality gates:

```javascript
// String references to registered gates
gates: ["code-quality", "security-awareness"]

// Inline quick gates (name + description)
gates: [{ name: "Source Check", description: "All claims must cite sources" }]

// Full gate definitions
gates: [{ id: "custom", criteria: ["Check A", "Check B"], severity: "high" }]

// Mixed formats in single array
gates: ["code-quality", { name: "Custom", description: "..." }]
```

**Template-level**: Use `inline_gate_definitions` in prompt metadata.

---

## Execution Flow

```
Request → Stage 2 (extract inline gates) → Stage 5 (inject guidance) → Claude executes → Self-evaluation → PASS/FAIL → Route
```

### Verdicts

Resume chains with a verdict:

```bash
prompt_engine(chain_id: "chain-review#1", gate_verdict: "GATE_REVIEW: PASS - criteria met")
```

Formats accepted: `GATE_REVIEW: PASS - reason` | `GATE PASS - reason` | `PASS - reason`

### When Gates Fail

| Action | When | Effect |
|--------|------|--------|
| Auto-retry | First failure | Server retries with feedback |
| `gate_action: "retry"` | After 2+ failures | Reset counter, try again |
| `gate_action: "skip"` | Want to bypass | Continue without this gate |
| `gate_action: "abort"` | Critical failure | Stop chain execution |

---

## Severity Levels

| Severity | Enforcement | Behavior |
|----------|-------------|----------|
| `critical` | blocking | Pauses until gate passes |
| `high` | advisory | Logs warning, continues |
| `medium` | advisory | Logs warning, continues |
| `low` | informational | Logs only |

Override per-gate with `enforcementMode: blocking | advisory | informational`

---

## Creating Custom Gates

```bash
# 1. Create gate directory
mkdir server/resources/gates/my-gate

# 2. Add gate.yaml
cat > server/resources/gates/my-gate/gate.yaml << 'EOF'
id: my-gate
name: My Custom Gate
type: validation
description: What this gate validates
guidanceFile: guidance.md
activation:
  prompt_categories: [code]
EOF

# 3. Add guidance.md
cat > server/resources/gates/my-gate/guidance.md << 'EOF'
**My Custom Gate Criteria:**
- First check
- Second check
EOF

# 4. Done! Hot-reloaded automatically
```

---

## Architecture Reference

*For developers extending the gate system.*

| Component | Location | Purpose |
|-----------|----------|---------|
| `GateManager` | `gates/gate-manager.ts` | Orchestration layer |
| `GateRegistry` | `gates/registry/gate-registry.ts` | Guide lifecycle |
| `GateDefinitionLoader` | `gates/core/gate-definition-loader.ts` | YAML loading + caching |
| `GateSystemManager` | `gates/gate-state-manager.ts` | Enable/disable state |
| `GateHotReloadCoordinator` | `gates/hot-reload/gate-hot-reload.ts` | File change handling |
| `TemporaryGateRegistry` | `gates/core/temporary-gate-registry.ts` | Inline gate storage |

**Pipeline stages**: 02 (inline extraction) → 05 (guidance injection) → 10 (review)

See also: [Prompt Authoring Guide](prompt-authoring-guide.md) • [Chains Guide](chains.md)
