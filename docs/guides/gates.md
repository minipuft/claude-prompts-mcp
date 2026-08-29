# Gates Guide

Gates are quality validation mechanisms that ensure Claude's outputs meet specific criteria before proceeding.

## Enforcement Modes

Every gate in a `gate.yaml` declares one or more `pass_criteria` entries; the `type:` field selects the enforcement mode. Five modes exist, and they differ in **what the runtime actually does** when the gate fires — not all are equally enforced.

| `type:`                | What runs at execution time                                                                                                                                                                                                                                                                                             | Enforcement strength          | Use for                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `inline_guidance`      | Renders a checklist into the chain response for agent self-assessment. No runtime check.                                                                                                                                                                                                                                | Display only                  | Conventions, style hints, self-evaluation prompts                                                |
| `llm_self_check`       | _Reserved._ No runner. Contributes no ground-truth result, so it can never clear a review on its own — the gate falls through to normal model review.                                                                                                                                                                   | Not enforced                  | (none — use `inline_guidance`, or [`%judge`](./judge-mode.md) for model-graded review)           |
| `framework_compliance` | Nothing. No criteria runner handles this type. Stage 19 does inspect the response against the active framework's `phases.yaml` (section headers, `min_length`, `forbidden_terms`) — but it triggers on `phases.yaml` guards, not on this value.                                                                         | Declarative only              | Documenting intent. To actually enforce sections, define guards in the framework's `phases.yaml` |
| `shell_verify`         | Spawns the configured shell command and checks its exit code (0 = pass). Optional response injection pipes the agent response to stdin.                                                                                                                                                                                 | Hard ground-truth enforcement | Tests, linting, builds, response-content verification                                            |
| `script_tool`          | Resolves `script_tool_id` against the registered script tools and runs THAT tool with JSON stdin, expecting `{ passed, reason?, details? }` back. Runs beside `shell_verify` during gate review; a gate may declare both. Fails closed when it cannot run, and a criterion with no `script_tool_id` is refused at load. | Hard structured enforcement   | Checks needing typed arguments and an explained verdict, not just an exit code                   |

> [!IMPORTANT]
> **Single prompts do not run criteria.** Stage 20 renders synthetic gate-review steps and
> requires chain steps to do it, so a gated single prompt runs no `pass_criteria` at all — not
> `shell_verify`, not `script_tool`. Its gates still reach the model as review guidance; they just
> carry no ground truth. Declare ground-truth criteria on gates you attach to chains.
>
> **A criterion that cannot be enforced is now refused at load.** `shell_verify` without a
> `shell_command`, and `script_tool` without a `script_tool_id`, fail gate loading with a message
> naming the missing field. Previously both auto-passed at review time, so a gate declaring a check
> it could not perform read as verified. This is a breaking change for any gate file relying on the
> old permissiveness.
>
> The history is worth keeping: until 2026-08-19 `script_tool` was accepted by the schema and
> executed by nothing. Stage 20 (`20-gate-review-stage.ts`) is the only live consumer of
> `pass_criteria` and it filtered for `shell_verify` alone, so a gate declaring `script_tool`
> cleared review having verified nothing — silently, with no warning and no output. It now runs
> beside `shell_verify` through the same coverage decision, which reads only gate id and pass/fail
> and is therefore mechanism-agnostic.
>
> A second criteria runner (`GateValidator`) existed alongside Stage 20 with its own, weaker
> `shell_verify` implementation and no production caller at all. It was deleted on 2026-08-19
> rather than revived: every criteria type now has exactly one owner, and the pipeline stages are
> it.

> [!NOTE]
> The former `content_check` and `pattern_check` types have been renamed to `inline_guidance` (commit `380655e4`). Neither had a runtime enforcement path wired — both rendered guidance text and relied on the agent's `GATE_REVIEW` self-report. The rename makes the actual behavior honest. See [Phase Guards Guide](./phase-guards.md) for `framework_compliance` and the schema header in `server/src/engine/gates/core/gate-schema.ts` for the canonical taxonomy.

### Declared Headers — A Guard Cannot Block on What the Prompt Never Said

Stage 19's structural checks used to grade a response against `section_header` strings that lived
only in `phases.yaml`, with nothing deriving the prompt-time instruction from that same source — a
guard could block on a header the model was never told to produce. `server/src/engine/frameworks/declared-sections.ts`
is now the single source both the render path (chain steps, and gated single prompts carrying
explicit `gates`) and the grading path read; a header the prompt never named is advisory only — it
warns, it never blocks. See the [Phase Guards Guide](./phase-guards.md#declared-sections) for the
full mechanism, including which guard criteria (`contains_any`, `max_length`, …) are safe to declare
to the model and which never are.

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

### What a Gate Author May and May Not Control

A `shell_verify` criterion carries three author-supplied values, and the operator holds a
different kind of control over each. The split is by MECHANISM, not by how dangerous the
field sounds.

| Field               | Author may set | Operator control                                                         | Why this shape                                                                         |
| ------------------- | -------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `shell_command`     | argv only      | `MCP_SHELL_VERIFY_ALLOWLIST` — unset refuses everything                  | The command is the capability; the operator decides which ones exist                   |
| `shell_working_dir` | yes            | `MCP_SHELL_VERIFY_ALLOWED_DIRS` — defaults to the server's own directory | A directory only WIDENS reach; the command is still one the operator allowed           |
| `shell_env`         | mostly         | resolution-affecting keys are **refused outright, no opt-out**           | These decide what the allowed command MEANS, so allowing them would void the allowlist |

### `shell_command` is argv, not a string

```yaml
pass_criteria:
  - type: shell_verify
    shell_command: ["npm", "test"] # argv
```

A bare string **fails to load**, with a message naming the fix. It used to be joined into
`sh -c '<string>'`, so the shell parsed whatever the gate author wrote — and a gate file is
exactly what an attacker drops into a workspace.

What that cost: the operator's allowlist was checking TEXT rather than a command. A prefix
entry like `npm *` had to be defended by enumerating shell metacharacters, and an
enumeration is only ever as good as its last review. Argv is the structural version of the
same guarantee, and it is the move this codebase already made for resource writes — assert
the property rather than enumerate the vectors. `["npm", "test"]` cannot become two commands,
so a prefix entry is sound and the metacharacter rule no longer applies to this shape.

**It does not put a shell out of reach**, and pretending otherwise would be the more
dangerous claim. `["sh", "-c", "..."]` is still expressible — it simply has to appear in
`MCP_SHELL_VERIFY_ALLOWLIST`, where the operator can read it and has to have chosen it.
Measured 2026-08-29 against a running server: with `echo *` allowlisted,
`["echo", "ok; touch /tmp/marker"]` printed the semicolon and created nothing.

The inline `:: verify:"npm test"` operator is unchanged and still takes a string. That
channel is typed into the invocation by whoever is driving the server, not carried in a
file, so it keeps the metacharacter rule instead.

Refused environment keys: `PATH`, anything starting `LD_` or `DYLD_`, `NODE_OPTIONS`,
`PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`, `BASH_ENV`, `ENV`, `IFS`, `SHELLOPTS`,
`BASHOPTS`, `PERL5LIB`, `PERL5OPT`, `RUBYLIB`, `RUBYOPT`. Ordinary variables — including
anything your own scripts read — pass through untouched.

Why the third row has no dial: measured 2026-08-29 against a running server, an operator
who allowlisted exactly `git status` and a gate that set
`PATH: /gate-author/bin:/usr/bin:/bin` ran the gate author's `git`. A dial that can be
turned to "yes" here is a dial that turns the command allowlist off without saying so.

The same rules reach script tools. `tool.env` is screened identically, and `tool.workingDir`
is contained to the tool's own installed directory — a relative `../..` in either field
resolves before it is checked, not after.

`shell_response_env_var` names an environment key too, so it is screened by the same rule:
a gate cannot smuggle `PATH` in by asking for the agent response to be mirrored into it.

### Response Injection (Agent-Output Verification)

A `shell_verify` gate can pipe the agent's response into the shell command's stdin, enabling ground-truth checks against what the agent actually claimed.

```yaml
pass_criteria:
  - type: shell_verify
    shell_command: ["node", "scripts/verify-path-claims.mjs"]
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
    shell_command: ["node", "scripts/verify-path-claims.mjs"]
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

`abort` is terminal: the run moves to `cancelled`, and resuming that `chain_id` answers
"Chain run already complete" instead of re-rendering the step. Start a fresh run with the chain
command, or pass `force_restart`. To end a run that is not sitting at a gate, use
`prompt_engine(chain_id:"...", cancel:true)`.

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

| If you want to...                                                          | Use                                                      | Why                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display a self-assessment checklist to the agent                           | `inline_guidance`                                        | No runtime check exists; the checklist is rendered into context and the agent self-reports via `GATE_REVIEW`. Accept that a fabricated `PASS` slips through.                                                                                                                                                                     |
| Enforce required framework sections (e.g., CAGEERF Context/Analysis/Goals) | Guards in the framework's `phases.yaml`                  | Stage 19 inspects section headers + length + forbidden terms deterministically, and only blocks on a header the render actually [declared](./phase-guards.md#declared-sections). Zero LLM cost; clear "Improvements Needed" feedback on failure. Setting `pass_criteria.type: framework_compliance` does **not** switch this on. |
| Verify the agent's claims against the filesystem or other ground truth     | `shell_verify` with `shell_stdin_source: agent_response` | Pipes the response into a script that can run `statSync`, `rg`, `wc -l`, etc. Exit code is ground truth — the agent cannot fake it. See `path-verification` worked example above.                                                                                                                                                |
| Run tests, lint, or build against the codebase (no response inspection)    | `shell_verify` (no `shell_stdin_source`)                 | Plain exit-code check. The response is irrelevant; the command operates on files on disk.                                                                                                                                                                                                                                        |
| Invoke a registered script tool with typed JSON input                      | `script_tool`                                            | When the check needs structured arguments and you want a typed `{passed, reason}` back — the script explains WHY, which lands in the review feedback. `shell_verify` remains the simpler default when an exit code says enough. `script_tool_id` names a **registered tool**, never a command.                                   |

### Anti-patterns

- **Using `inline_guidance` for a check the runtime could verify cheaply** — the checklist is display-only, and `GATE_REVIEW: PASS` from a fabricated self-assessment is indistinguishable from a real one. If a 3-line shell script can confirm the claim, prefer `shell_verify`.
- **Using `shell_verify` for section-structure enforcement** — phase guards in `phases.yaml` are faster (no subprocess), produce clearer per-section feedback, and integrate with the phase-guards UI. Reserve `shell_verify` for checks that genuinely need to run a command.
- **Mixing `shell_stdin_source: agent_response` with commands that don't read stdin** — the response is discarded silently and the gate becomes a plain exit-code check with extra overhead. The receiving script must `readFileSync(0)` (or equivalent) to consume the response.
- **Trusting `llm_self_check`** — the runner is reserved but not implemented, and it no longer reads any configuration, so there is no setting that turns it on. A gate that declares `type: llm_self_check` auto-passes with a skip message. Use one of the four other types, or [`%judge`](./judge-mode.md) / `gates.evaluation.defaultMode` when you want a model to grade the output — that path runs in the client's own subagent and returns through `gate_verdict`.

## Best Practices

1. **Use shell verification for objective criteria** (tests, linting, builds)
2. **Use criteria gates for subjective quality** (style, completeness)
3. **Use assertions for structural compliance** (framework phases, required sections)
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
- [Phase Guards Guide](./phase-guards.md) - `phases.yaml` guard rules, declared headers, and enforcement modes
- [Judge Mode Guide](./judge-mode.md) - Context-isolated gate evaluation
- [Ralph Loops Guide](./ralph-loops.md) - Detailed shell verification documentation
- [Chains Lifecycle](../concepts/chains-lifecycle.md) - Multi-step execution
- [MCP Tools Reference](../reference/mcp-tools.md) - Full parameter documentation
