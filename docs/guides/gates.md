# Gates Guide

Gates are quality validation mechanisms that ensure Claude's outputs meet specific criteria before proceeding.

## Enforcement Modes

Every gate in a `gate.yaml` declares one or more `pass_criteria` entries; the `type:` field selects the enforcement mode. Five modes exist, and they differ in **what the runtime actually does** when the gate fires — not all are equally enforced.

| `type:`                  | What runs at execution time                                                                                                                                                                 | Enforcement strength          | Use for                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `inline_guidance`        | Renders a checklist into the chain response for agent self-assessment. No runtime check.                                                                                                    | Display only                  | Conventions, style hints, self-evaluation prompts                             |
| `llm_self_check`         | _Reserved._ No runner wired yet. Treat as `inline_guidance` until implemented.                                                                                                              | Not enforced                  | (none — use `inline_guidance` today)                                          |
| `methodology_compliance` | Pipeline stage 09b inspects the response against the active methodology's `phases.yaml` (section headers, `min_length`, `forbidden_terms`). Failure injects "Improvements Needed" feedback. | Hard structural enforcement   | Required methodology sections (e.g., "## Context must exist with ≥100 chars") |
| `shell_verify`           | Spawns the configured shell command and checks its exit code (0 = pass). Optional response injection pipes the agent response to stdin.                                                     | Hard ground-truth enforcement | Tests, linting, builds, response-content verification                         |
| `script_tool`            | Invokes a registered script tool with JSON stdin; expects a structured pass/fail result.                                                                                                    | Hard structured enforcement   | Programmatic checks against external systems                                  |

> [!NOTE]
> The former `content_check` and `pattern_check` types have been renamed to `inline_guidance` (commit `380655e4`). Neither had a runtime enforcement path wired — both rendered guidance text and relied on the agent's `GATE_REVIEW` self-report. The rename makes the actual behavior honest. See [Phase Guards Guide](./phase-guards.md) for `methodology_compliance` and the schema header in `server/src/engine/gates/core/gate-schema.ts` for the canonical taxonomy.

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

| Preset      | Max Attempts | Timeout | Use Case       |
| ----------- | ------------ | ------- | -------------- |
| `:fast`     | 1            | 30s     | Quick feedback |
| `:full`     | 5            | 300s    | CI validation  |
| `:extended` | 10           | 600s    | Long tests     |

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

| Option      | Default | Description           |
| ----------- | ------- | --------------------- |
| `max:N`     | 5       | Maximum attempts      |
| `timeout:N` | 300     | Timeout in seconds    |
| `loop:true` | false   | Stop hook integration |

See [Ralph Loops Guide](./ralph-loops.md) for comprehensive shell verification documentation.

### Response Injection (Agent-Output Verification)

A `shell_verify` gate can pipe the agent's response into the shell command's stdin, enabling ground-truth checks against what the agent actually claimed.

```yaml
pass_criteria:
  - type: shell_verify
    shell_command: "node scripts/verify-path-claims.mjs"
    shell_stdin_source: agent_response # pipe response to stdin
    shell_response_env_var: AGENT_RESPONSE # optional mirror via env var
    shell_timeout: 10000
```

| Field                                | Description                                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `shell_stdin_source: agent_response` | Pipes the agent response to the script's stdin. Truncated to `SHELL_VERIFY_MAX_RESPONSE_BYTES` (default 256 KB) with head/tail markers. |
| `shell_response_env_var`             | Optional env var that mirrors stdin. Useful for scripts that re-read the response without buffering stdin.                              |

#### Worked Example: `path-verification`

The shipped `path-verification` gate (`resources/gates/path-verification/`) is the canonical consumer of response injection. It catches plan-author drift — fabricated file paths, wrong line counts, missing symbols — by inspecting a structured block emitted by the agent.

**Agent emits a verification block** inside its response:

```yaml
verified_paths:
  - file: server/src/engine/gates/core/gate-schema.ts
    exists: yes
    line_count: 142
    target_symbols:
      - symbol: GatePassCriteriaSchema
        actual_line: 23
```

**Gate config** pipes the response into the verification script:

```yaml
# resources/gates/path-verification/gate.yaml
pass_criteria:
  - type: shell_verify
    shell_command: "node scripts/verify-path-claims.mjs"
    shell_stdin_source: agent_response
    shell_timeout: 10000
activation:
  prompt_categories: [planning]
  explicit_request: true
```

**The script** (`server/scripts/verify-path-claims.mjs`) parses the YAML block, walks up to the repo root if needed, then runs `statSync` / `wc -l` / `rg` against the filesystem. Exit 0 = all claims verified clean; exit 1 = at least one mismatch (with the diagnostic on stderr); exit 2 = malformed input.

**Integration tests** (`server/tests/integration/gates/path-verification.test.ts`) cover ten scenarios: truthful claims pass, fabricated line counts fail with `line_count=99999 actual=…`, missing files fail with `exists=yes/false`, symbol verification catches both wrong-line and absent-symbol claims.

The end-to-end shape is: **agent response → injected stdin → script verification → exit code → gate verdict**. The gate is the only mechanism in this codebase that can verify the _content_ of an agent's response against external ground truth.

## Canonical Gates

Pre-defined gates stored in `resources/gates/` for reusable quality patterns.

<details>
<summary><strong>Available Gates</strong></summary>

| Gate ID              | Severity | Purpose                            |
| -------------------- | -------- | ---------------------------------- |
| `code-quality`       | medium   | Error handling, naming, edge cases |
| `security-awareness` | medium   | No secrets, input validation       |
| `test-coverage`      | medium   | Tests included                     |
| `content-structure`  | low      | Headers, lists, examples           |
| `api-documentation`  | medium   | Endpoints, params, examples        |
| `pr-security`        | critical | No eval, parameterized queries     |
| `pr-performance`     | medium   | Memoization, no console.log        |
| `plan-quality`       | high     | Files, risks, assumptions          |

</details>

### Usage

```bash
# Reference by ID
>>code_review :: code-quality :: security-awareness

# Combine with inline criteria
>>implement :: code-quality :: "under 500 lines"
```

<details>
<summary><strong>User Gates (Workspace Overlays)</strong></summary>

When `MCP_WORKSPACE` points to a directory outside the package root, the server automatically discovers additional gates from the workspace. This allows users to define custom gates alongside shipped defaults.

### Directory Structure

User gates support both flat and grouped layouts:

```
${MCP_WORKSPACE}/gates/          # Workspace gates directory
├── my-custom-gate/              # Flat: directly under gates/
│   ├── gate.yaml
│   └── guidance.md
└── workflow/                    # Grouped: category → gate
    ├── pre-flight-completion/
    │   ├── gate.yaml
    │   └── guidance.md
    └── growth-capture/
        ├── gate.yaml
        └── guidance.md
```

The server also checks `${MCP_WORKSPACE}/resources/gates/` as an alternative convention.

### Conflict Resolution

When a user gate has the same ID as a shipped gate, the **shipped (primary) gate wins**. This prevents accidental overrides of built-in quality standards.

### Example: Claude Code Integration

When using the Claude Code plugin with `MCP_WORKSPACE=~/.claude/`:

```
~/.claude/gates/
└── workflow/
    ├── pre-flight-completion/
    │   ├── gate.yaml
    │   └── guidance.md
    └── diagnosis-card/
        ├── gate.yaml
        └── guidance.md
```

These gates appear in `system_control(action:"gates", operation:"list")` alongside shipped gates.

### Hot Reload

User gates are hot-reloaded. Editing `gate.yaml` or `guidance.md` in workspace gates directories updates the gate without server restart.

</details>

## Gate Responses

> [!WARNING]
> The response format is strict: `GATE_REVIEW: PASS - reason` or `GATE_REVIEW: FAIL - reason`. Omitting the prefix or using a different format causes the gate to hang waiting for a verdict.

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

## Assertion + Gate Composition

Gates validate **content quality** (subjective, LLM-evaluated). Assertions validate **structure** (deterministic, zero-cost). They compose orthogonally:

| Layer         | Validates                           | Cost     | Method                  |
| ------------- | ----------------------------------- | -------- | ----------------------- |
| Assertions    | Structure (sections, length, terms) | Zero     | Deterministic checks    |
| Gates (self)  | Content quality                     | LLM cost | Self-review             |
| Gates (judge) | Content quality                     | LLM cost | Context-isolated review |

When assertions pass, the gate reviewer is told: "Structure is verified — focus on content quality." When assertions fail, the LLM must fix structural issues before content quality is evaluated.

See [Assertions Guide](./assertions.md) for full details.

## Judge Mode

By default, the same LLM evaluates its own gate criteria (self mode). Judge mode sends output + criteria to a context-isolated sub-agent that cannot see generation reasoning:

```yaml
# In gate.yaml
evaluation:
  mode: judge # Context-isolated evaluation
  strict: true # Evidence-based: list failures first
```

See [Judge Mode Guide](./judge-mode.md) for configuration and usage.

## Choosing an Enforcement Mode

A decision table for picking the right `pass_criteria.type` for the check you actually want:

| If you want to...                                                            | Use                                                      | Why                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display a self-assessment checklist to the agent                             | `inline_guidance`                                        | No runtime check exists; the checklist is rendered into context and the agent self-reports via `GATE_REVIEW`. Accept that a fabricated `PASS` slips through.                      |
| Enforce required methodology sections (e.g., CAGEERF Context/Analysis/Goals) | `methodology_compliance` (via phase guards)              | Stage 09b inspects section headers + length + forbidden terms deterministically. Zero LLM cost; clear "Improvements Needed" feedback on failure.                                  |
| Verify the agent's claims against the filesystem or other ground truth       | `shell_verify` with `shell_stdin_source: agent_response` | Pipes the response into a script that can run `statSync`, `rg`, `wc -l`, etc. Exit code is ground truth — the agent cannot fake it. See `path-verification` worked example above. |
| Run tests, lint, or build against the codebase (no response inspection)      | `shell_verify` (no `shell_stdin_source`)                 | Plain exit-code check. The response is irrelevant; the command operates on files on disk.                                                                                         |
| Invoke a registered script tool with typed JSON input                        | `script_tool`                                            | When the check needs structured arguments instead of free-form response, and you want a typed pass/fail result back.                                                              |

### Anti-patterns

- **Using `inline_guidance` for a check the runtime could verify cheaply** — the checklist is display-only, and `GATE_REVIEW: PASS` from a fabricated self-assessment is indistinguishable from a real one. If a 3-line shell script can confirm the claim, prefer `shell_verify`.
- **Using `shell_verify` for section-structure enforcement** — `methodology_compliance` is faster (no subprocess), produces clearer per-section feedback, and integrates with the phase-guards UI. Reserve `shell_verify` for checks that genuinely need to run a command.
- **Mixing `shell_stdin_source: agent_response` with commands that don't read stdin** — the response is discarded silently and the gate becomes a plain exit-code check with extra overhead. The receiving script must `readFileSync(0)` (or equivalent) to consume the response.
- **Trusting `llm_self_check`** — the runner is reserved but not implemented. A gate that declares `type: llm_self_check` today behaves like `inline_guidance`. Use one of the four other types.

## Best Practices

1. **Use shell verification for objective criteria** (tests, linting, builds)
2. **Use criteria gates for subjective quality** (style, completeness)
3. **Use assertions for structural compliance** (methodology phases, required sections)
4. **Use judge mode for high-stakes evaluation** (prevents self-confirmation bias)
5. **Combine layers for comprehensive validation**:
   ```bash
   >>implement :: verify:"npm test" :: "readable code" :: "documented functions"
   ```
6. **Use presets** for consistent verification across projects
7. **Reference canonical gates** for team-wide standards

> [!TIP]
> **Too many gates firing?** [Injection Control](./injection-control.md) lets you tune how often gate guidance injects — from every step to first-step-only.
> For the full `gate.yaml` schema, see [Gate Configuration Reference](../reference/gate-configuration.md).

## See Also

- [Assertions Guide](./assertions.md) - Deterministic structural validation
- [Judge Mode Guide](./judge-mode.md) - Context-isolated gate evaluation
- [Ralph Loops Guide](./ralph-loops.md) - Detailed shell verification documentation
- [Chains Lifecycle](../concepts/chains-lifecycle.md) - Multi-step execution
- [MCP Tools Reference](../reference/mcp-tools.md) - Full parameter documentation
