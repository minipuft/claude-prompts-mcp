# Frameworks Guide

Frameworks are reasoning frameworks that the server injects into your prompts. They structure how the LLM thinks — adding phase labels, quality criteria, and evaluation patterns to every response.

## Why This Matters

| Problem                 | Solution                                            | Result                          |
| ----------------------- | --------------------------------------------------- | ------------------------------- |
| **Unstructured output** | Phase-based reasoning (Context, Analysis, Goals...) | Consistent, reviewable sections |
| **Skipped thinking**    | Framework gates with validation criteria            | Each phase checked for depth    |
| **One-size-fits-all**   | 6 built-in + custom creation                        | Match the framework to the task |

> [!TIP]
> **Quick start:** Run `system_control(action: "framework", operation: "switch", framework: "cageerf")` to activate a framework. Every prompt after that receives CAGEERF phase guidance automatically.

---

## Built-in Frameworks

| ID           | Name          | Best For                                 | Phases                                                                   |
| ------------ | ------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `cageerf`    | C.A.G.E.E.R.F | General-purpose structured reasoning     | Context, Analysis, Goals, Execution, Evaluation, Refinement              |
| `react`      | ReACT         | Iterative reasoning + action loops       | Reason, Act, Observe (repeat)                                            |
| `5w1h`       | 5W1H          | Investigative analysis                   | Who, What, When, Where, Why, How                                         |
| `scamper`    | SCAMPER       | Creative ideation and brainstorming      | Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, Reverse |
| `focus`      | FOCUS         | Problem-solving with root cause analysis | Find, Organize, Clarify, Understand, Solution                            |
| `liquescent` | LIQUESCENT    | Creative flow and artistic exploration   | Layered creative phases                                                  |

---

## Using Frameworks

### Switch the Active Framework

The active framework applies to all subsequent prompts in the session:

```
system_control(action: "framework", operation: "switch", framework: "cageerf")
```

### Pin a Framework Per Project

A switch persists to the calling project's scope, so different repositories can sit on different
frameworks at the same time — CAGEERF for a server codebase, RADIANT for a Spicetify theme.

Declare the starting point in that project's `config.json`:

```json
{
  "frameworks": {
    "defaultFramework": "RADIANT"
  }
}
```

This is the **floor**, not a lock. It applies to any scope with no persisted state; a runtime
`system_control` switch overrides it for that project and survives restarts. A project that
declares nothing falls back to `CAGEERF`.

Isolation depends on each project resolving a distinct scope id. Confirm it in the startup log:

```
[INFO] Project scope id: spicetify-theme (source: CLAUDE_PROJECT_DIR)
```

If two projects report the same id they share one row, and switching in either changes both.
→ [Identity & Scope](identity-scope.md#derived-project-scope) for the resolution order and the fix.

### Per-Request Override

Use the `@` operator to apply a specific framework to a single prompt without changing the session default:

```
prompt_engine(command: "@REACT >>my_prompt")
```

### Disable for a Single Request

Use modifiers to suppress framework injection:

| Modifier     | Effect                                            |
| ------------ | ------------------------------------------------- |
| `%clean`     | Disable all injection (framework + gates + style) |
| `%lean`      | Disable framework and style, keep gates           |
| `%guided`    | Force all injection on                            |
| `%framework` | Force framework injection on                      |

```
prompt_engine(command: "%clean >>my_prompt")
```

> [!NOTE]
> **Standalone prompts** (non-chain) inject the framework once. For chains, injection frequency is configurable — see [Injection Control](./injection-control.md).

---

## What Gets Injected

When a framework is active, the server adds guidance at multiple levels:

| Layer                         | What                                          | Where                       |
| ----------------------------- | --------------------------------------------- | --------------------------- |
| **System prompt guidance**    | Phase descriptions and reasoning instructions | Prepended to system prompt  |
| **Framework gates**           | Per-phase quality validation criteria         | Added to gate review        |
| **Tool description overlays** | Framework-branded tool descriptions           | Visible in MCP tool listing |
| **Phase guards**              | Structural assertions on output sections      | Post-execution verification |

<details>
<summary><strong>Example: CAGEERF system prompt injection</strong></summary>

When CAGEERF is active, this guidance is injected into every prompt:

```
Apply the C.A.G.E.E.R.F framework systematically:

**Context**: Establish comprehensive situational awareness and environmental factors
**Analysis**: Apply structured, systematic examination of the problem or opportunity
**Goals**: Define specific, measurable, actionable objectives with clear success criteria
**Execution**: Develop practical, implementable approach with detailed action steps
**Evaluation**: Create robust success metrics and assessment methods
**Refinement**: Enable continuous improvement and iteration processes
```

</details>

---

## Creating a Custom Framework

Use the built-in `>>create_framework` prompt to design and validate a new framework:

```
prompt_engine(command: ">>create_framework", options: {
  "name": "My Framework",
  "concept": "A framework for systematic API design"
})
```

The prompt guides you through designing phases, then validates against a **5-tier completeness score** (100% required):

| Tier           | Weight | What It Checks                                                      |
| -------------- | ------ | ------------------------------------------------------------------- |
| **Foundation** | 30%    | id, name, system prompt guidance, phases (min 2)                    |
| **Quality**    | 20%    | Framework gates with validation criteria                            |
| **Authoring**  | 25%    | Required sections, argument suggestions, template hints             |
| **Execution**  | 15%    | Processing steps with assertions, execution steps with dependencies |
| **Advanced**   | 10%    | Tool description overlays, quality indicators, judge prompt         |

> [!TIP]
> Study the CAGEERF definition at `server/resources/frameworks/cageerf/` for a complete reference implementation covering all 5 tiers.

### File Structure

Each framework lives in its own directory under `server/resources/frameworks/`:

```
server/resources/frameworks/{id}/
├── framework.yaml    # Configuration, gates, guidance, tool overlays
├── phases.yaml         # Phase definitions, processing steps, assertions
└── judge-prompt.md     # Optional: judge evaluation prompt for %judge modifier
```

Files are hot-reloaded — edit and save, the server picks up changes automatically.

### Phase Guards (Assertions)

Processing steps can include `section_header` + `guards` for deterministic output verification. After execution, the server checks the LLM's response against these rules — no LLM cost, instant feedback:

```yaml
processingSteps:
  - id: context_establishment
    name: Context Establishment
    order: 1
    required: true
    section_header: "## Context"
    guards:
      required: true
      min_length: 100
      forbidden_terms: ["TODO", "TBD", "placeholder"]
```

| Rule              | Type     | Description                        |
| ----------------- | -------- | ---------------------------------- |
| `required`        | boolean  | Section must exist in the response |
| `min_length`      | number   | Minimum character count            |
| `max_length`      | number   | Maximum character count            |
| `contains_any`    | string[] | Must include at least one term     |
| `contains_all`    | string[] | Must include all terms             |
| `matches_pattern` | string   | Regex the section must match       |
| `forbidden_terms` | string[] | Terms that must NOT appear         |

> [!NOTE]
> Phase guards are separate from gates. Guards check **structure** (did the LLM produce a `## Context` section?). Gates check **quality** (is the context analysis thorough?). See [Phase Guards Guide](./phase-guards.md) for details.

---

## Checking Status

```
system_control(action: "status")
```

Returns the active framework, available frameworks, and current injection settings.

```
system_control(action: "framework", operation: "list")
```

Lists all registered frameworks with their enabled status.

---

## See Also

- **[Injection Control](./injection-control.md)** — Frequency, targets, and modifiers for framework injection
- **[Phase Guards](./phase-guards.md)** — Deterministic structural validation of framework phases
- **[Gates Guide](./gates.md)** — Quality validation criteria (complements framework structure)
- **[Judge Mode](./judge-mode.md)** — Context-isolated evaluation using framework judge prompts
- **[Architecture Overview](../architecture/overview.md)** — How frameworks integrate with the pipeline
