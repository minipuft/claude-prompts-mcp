# Gates

> Status: canonical

Make Claude check its own work. Gates inject quality criteria that Claude self-evaluates—no manual review needed.

```bash
# Inline gates with any prompt
prompt_engine(command:"summarize :: 'under 200 words' :: 'include statistics'")

# Named gates for code review
prompt_engine(command:"review", gates:["code-quality", "security-awareness"])
```

---

## Why

**Problem**: Claude returns plausible-sounding outputs, but you need specific criteria met—and you want Claude to verify, not you.

**Solution**: Gates inject quality criteria. Claude self-evaluates and reports PASS/FAIL with reasoning. Failed gates trigger retries or pause for your decision.

**Expect**: Response includes a self-assessment section. The server auto-retries with feedback if criteria aren't met.

---

## What This Guide Covers

| Topic | Section |
|-------|---------|
| Discover available gates | [Discovery Commands](#discovery-commands) |
| Three ways to specify gates | [Specifying Gates](#specifying-gates) |
| Five-level precedence ladder | [Precedence Ladder](#precedence-ladder) |
| Gate definition format | [Defining Gates](#defining-gates) |
| Hot-reload and runtime control | [Runtime Control](#runtime-control) |

**Related**: [MCP Tooling Guide](../reference/mcp-tools.md) for command syntax, [Chains](chains.md) for multi-step gate validation.

---

## Discovery Commands

Find and explore available gates without memorizing IDs:

```bash
# List all canonical gates
prompt_engine(command: ">>gates")

# Search gates by keyword
prompt_engine(command: ">>gates security")
prompt_engine(command: ">>gates quality")

# Get comprehensive syntax reference
prompt_engine(command: ">>guide gates")
```

**Fuzzy Matching**: Mistyped gate IDs suggest corrections:
```bash
:: code-qualitty   # → "Did you mean: code-quality?"
:: securtiy        # → "Did you mean: security-awareness?"
```

---

## Architecture Map

### Core Components

| Component | Location | Purpose |
| --- | --- | --- |
| `GateManager` | `gates/gate-manager.ts` | Orchestration layer coordinating registry, loader, and selection. |
| `GateRegistry` | `gates/registry/gate-registry.ts` | Lifecycle management for gate guides (mirrors MethodologyRegistry). |
| `GenericGateGuide` | `gates/registry/generic-gate-guide.ts` | Data-driven IGateGuide implementation from YAML definitions. |
| `GateDefinitionLoader` | `gates/core/gate-definition-loader.ts` | YAML + MD loading with caching, guidance inlining, and path resolution. |
| `GateHotReloadCoordinator` | `gates/hot-reload/gate-hot-reload.ts` | Hot-reload handling for gate file changes. |

### Supporting Components

| Component | Location | Purpose |
| --- | --- | --- |
| `GateValidator` | `gates/core/gate-validator.ts` | Orchestrates validation (string checks auto-pass; LLM validation pending). |
| `GateSystemManager` | `gates/gate-state-manager.ts` | Persists gate enable/disable state and validation metrics. |
| `GateGuidanceRenderer` | `gates/guidance/GateGuidanceRenderer.ts` | Formats guidance text for prompts. |
| `TemporaryGateRegistry` | `gates/core/temporary-gate-registry.ts` | Manages in-memory, execution-scoped gates (max 1000, auto-cleanup). |
| `GateReferenceResolver` | `gates/services/gate-reference-resolver.ts` | Distinguishes registered gate IDs from inline criteria. |
| Pipeline stages | `execution/pipeline/stages/02,05,10-*` | Inline extraction (02), gate enhancement (05), gate review (10). |

---

## Precedence Ladder

Gates are applied in this five-level order (first match wins):

1. **Temporary gates** — Highest priority. In-memory, execution-scoped gates from `TemporaryGateRegistry`.
2. **Template gates** — Declared in prompt metadata (`inline_gate_definitions`). Apply to specific prompts only.
3. **Category gates** — Derived from the prompt's category (e.g., `code` → `code-quality`).
4. **Framework gates** — Based on active methodology. Gates with `gate_type: "framework"` apply universally when a framework is active.
5. **Fallback gates** — Default `content-structure` gate when nothing else matches.

The `GateLoader.getActiveGates()` composes the final list before passing to the guidance renderer.

---

## Runtime Toggles

Control framework influence on gates via `server/config.json`:

| Setting | Default | Effect |
| --- | --- | --- |
| `frameworks.enableMethodologyGates` | `true` | When `false`, framework-derived gates drop out; template/category/temporary gates still run. |
| `frameworks.enableSystemPromptInjection` | `true` | When `false`, gates still execute, but framework context isn't injected into prompts. |
| `frameworks.enableDynamicToolDescriptions` | `true` | When `false`, MCP tool descriptions won't mention gate/framework requirements. |

Use these for prototyping or when you want leaner validation without removing gate metadata from templates.

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

### Predefined Gates

| Gate ID | gate_type | Severity | Activation |
| --- | --- | --- | --- |
| `framework-compliance` | `framework` | — | Any active methodology (CAGEERF, ReACT, 5W1H, SCAMPER) |
| `code-quality` | — | — | Categories: `code`, `development` |
| `content-structure` | — | — | Categories: `documentation`, `content_processing`, `education` (also fallback) |
| `educational-clarity` | — | — | Categories: `education`, `documentation`, `content_processing`, `development` |
| `technical-accuracy` | — | — | Categories: `development`, `analysis`, `research` + explicit request |
| `research-quality` | — | — | Categories: `research`, `analysis` + explicit request |
| `security-awareness` | — | — | Categories: `code`, `development` |
| `api-documentation` | — | — | Categories: `documentation`, `api`, `development` |
| `plan-quality` | — | `high` | Categories: `planning`, `development` |
| `pr-security` | `category` | `critical` | Categories: `pr-review` + explicit request |
| `pr-performance` | `category` | `medium` | Categories: `pr-review` + explicit request |
| `test-coverage` | — | — | Categories: `code`, `development` |

**Framework Gates** (`gate_type: "framework"`): Apply universally when a framework is active, independent of prompt categories.

**Category Gates** (`gate_type: "category"`): Apply to specific prompt categories, useful for domain-specific validation like PR reviews.

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

## Validation Check Types

**Design Decision**: String-based validation (length checks, regex, keyword matching) has been **intentionally removed**. These checks don't correlate with LLM output quality—an output can pass all string checks while being semantically incorrect, or fail them while being excellent.

| Check Type | Status | Notes |
| --- | --- | --- |
| `content_check` | Auto-passes | Length/pattern checks no longer enforced |
| `pattern_check` | Auto-passes | Regex/keyword matching no longer enforced |
| `llm_self_check` | Pending | Reserved for LLM API integration |
| `methodology_compliance` | Auto-passes | Framework compliance via guidance only |

**Current Approach**: Gates function as **guidance injection only**. The server injects criteria into prompts, Claude self-evaluates and reports PASS/FAIL, and the server routes based on the verdict.

**Future**: When `llm_self_check` is implemented, it will use semantic analysis via LLM calls to validate output quality.

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

### How Gates Work at Runtime

1. **Request arrives** with `gates` parameter or `::` inline criteria
2. **Stage 2** extracts inline gates and registers them in `TemporaryGateRegistry`
3. **Stage 5** injects gate guidance into prompts
4. **Claude executes** the prompt with embedded gate criteria
5. **Claude self-evaluates** and reports PASS/FAIL with reasoning
6. **Server routes** based on verdict: next step (PASS), retry (FAIL), or pause (retry limit hit)

### Gate Verdicts

When resuming after gate review, send a verdict via `gate_verdict`:

```bash
prompt_engine(chain_id: "chain-review#1", gate_verdict: "GATE_REVIEW: PASS - all criteria met")
```

**Supported formats** (case-insensitive):
- Primary: `GATE_REVIEW: PASS - reason` / `GATE_REVIEW: FAIL - reason`
- Simplified: `GATE PASS - reason` / `GATE FAIL - reason`
- Minimal (parameter only): `PASS - reason` / `FAIL - reason`

Rationale is required for all verdicts.

### Gate Actions (Retry Limit Exceeded)

When a gate fails 2+ times, use `gate_action`:

| Action | Effect |
| --- | --- |
| `retry` | Reset attempt counter, try again |
| `skip` | Bypass this gate, continue execution |
| `abort` | Stop chain execution entirely |

```bash
prompt_engine(chain_id: "chain-review#1", gate_action: "skip")
```

---

## Severity & Enforcement

Gates have severity levels that map to enforcement behavior:

| Severity | Enforcement | Behavior |
| --- | --- | --- |
| `critical` | `blocking` | Pauses execution until gate passes |
| `high` | `advisory` | Logs warning, continues anyway |
| `medium` | `advisory` | Logs warning, continues anyway |
| `low` | `informational` | Logs only, no user impact |

Override defaults with `enforcementMode` in gate definitions.

---

## Shorthand Features

- **Slug references**: `["code-quality"]` resolves to the canonical gate—no JSON needed
- **Template aliases**: `{"template": "security-awareness", "severity": "critical"}` reuses existing gate with overrides
- **Inline references**: Gates with `id` can be reused later via `:: gate-id`
- **Deduping**: Duplicate gates are merged to keep guidance concise

---

## Maintenance

### Adding a New Gate

1. Create directory: `server/resources/gates/{gate-id}/`
2. Create `gate.yaml` with configuration (see Definition Structure above)
3. Create `guidance.md` with guidance content
4. The gate is automatically hot-reloaded (no server restart needed)
5. Document new gates here and in [Prompt Authoring Guide](prompt-authoring-guide.md)

### Modifying an Existing Gate

1. Edit `server/resources/gates/{gate-id}/gate.yaml` or `guidance.md`
2. Changes are hot-reloaded automatically
3. Run `npm run validate:all` to verify schema if making structural changes

### Directory Structure

```
server/resources/gates/
├── api-documentation/
│   ├── gate.yaml
│   └── guidance.md
├── code-quality/
│   ├── gate.yaml
│   └── guidance.md
├── content-structure/
│   ├── gate.yaml
│   └── guidance.md
├── educational-clarity/
│   ├── gate.yaml
│   └── guidance.md
├── framework-compliance/
│   ├── gate.yaml
│   └── guidance.md
├── plan-quality/
│   ├── gate.yaml
│   └── guidance.md
├── pr-performance/
│   ├── gate.yaml
│   └── guidance.md
├── pr-security/
│   ├── gate.yaml
│   └── guidance.md
├── research-quality/
│   ├── gate.yaml
│   └── guidance.md
├── security-awareness/
│   ├── gate.yaml
│   └── guidance.md
├── technical-accuracy/
│   ├── gate.yaml
│   └── guidance.md
└── test-coverage/
    ├── gate.yaml
    └── guidance.md
```

For template gate configuration, see [Prompt Authoring Guide](prompt-authoring-guide.md). For chain gate patterns, see [Chains Guide](chains.md).
