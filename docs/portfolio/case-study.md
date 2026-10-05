# Case Study: Recursive Prompt Engineering

Built a prompt engineering tool. Used it to build itself.

---

## The Problem

Prompt iteration is slow. Edit → restart → test → repeat. Each cycle: 5-10 minutes.

- Prompts scattered across projects, no version control
- Output quality varies without structured reasoning
- Quality validation is manual

## The Solution

**Claude Prompts MCP Server**—a hot-reloadable prompt engine with structured execution.

```bash
npx -y claude-prompts@latest
```

```
resource_manager(resource_type:"prompt", action:"list")                        # See your prompts
prompt_engine(command:">>analyze_code @CAGEERF")     # Run with framework
```

| Before                           | After                          |
| -------------------------------- | ------------------------------ |
| Edit → restart → test (5-10 min) | Edit → test instantly (<1 min) |
| Scattered prompt files           | Git-versioned Markdown library |
| Variable reasoning quality       | 4 frameworks enforce structure |
| Manual quality checks            | Quality gates auto-validate    |

---

## Demo

```bash
# List prompts
resource_manager(resource_type:"prompt", action:"list")

# Run with framework
prompt_engine(command:">>diagnose @CAGEERF scope:'performance'")

# Chain steps
prompt_engine(command:"Analyze code --> Identify issues --> Propose fixes")

# Inline quality gates
prompt_engine(command:"Summarize :: 'under 200 words' :: 'include stats'")
```

---

## Technical Architecture

**Pipeline-First Design**: Every request flows through a unified 21-stage pipeline.

```
Parse → Validate → Plan → Enhance → Execute → Format → Return
```

- **Predictable**: Same path for every request. When something fails, you know exactly where.
- **Extensible**: New feature = new stage. No rewiring.
- **Debuggable**: LLM interactions need deterministic flow.

**Symbolic Command Language**:

```
>>analyze_code @CAGEERF :: 'security review' --> >>summarize

Operators:
>>   Execute prompt by ID
@    Apply framework (CAGEERF, ReACT, 5W1H, SCAMPER)
::   Quality gate (inline criteria)
-->  Chain to next step
```

**Hot-Reload**: Edit a prompt file, changes apply immediately. No restart.

---

## Results

| Metric         | Value                   |
| -------------- | ----------------------- |
| GitHub Stars   | 115+                    |
| Forks          | 27                      |
| Iteration Time | 5-10 min → <1 min (10x) |

---

## The Recursive Part

This case study was refined using the tool itself:

```
prompt_engine(command:">>readme_improver context:'case-study.md' :: 'must include metrics'")
```

When a prompt underperforms:

```
User: "The output is too verbose"
Claude: resource_manager(resource_type:"prompt", action:"update", id:"readme_improver", ...)
User: "Test it"
Claude: prompt_engine(command:">>readme_improver")  # Updated version, instantly
```

No manual editing. No restart. The tool improves its own prompts.

**Meta-Prompts: Prompts That Create Prompts**

```
>>create_gate name:"API Docs"
```

The authoring prompts guide a draft before it is written:

1. **Design**: Partial inputs show guidance and supported fields.
2. **Prepare**: `create_prompt` submits a non-mutating canonical validation call;
   `create_gate` and `create_framework` return draft create parameters without executing them.
3. **Create**: The client submits the reviewed draft when authorized, resolves server refusals,
   and verifies the write receipt and loaded resource.

The server owns resource validation. Builders map fields and preserve nested definitions;
a contract guard detects drift as that surface changes. See the
[authoring lifecycle reference](../reference/mcp-tools.md#script-tool-execution).

---

## Key Decisions

| Decision                                    | Trade-off                                                    |
| ------------------------------------------- | ------------------------------------------------------------ |
| **Unified pipeline** over per-tool handlers | Higher complexity upfront, but predictable debugging         |
| **File-based state** over database          | No dependencies, survives restarts, but single-instance only |
| **Symbolic DSL** over JSON-only API         | Learning curve, but natural prompt composition               |

---

## Architectural Evolution

- **Scattered → Unified**: First iteration had individual handlers. Debugging was unpredictable. Single pipeline made LLM interactions deterministic.
- **Grow → Understand → Decompose**: Components started broad, grew while discovering requirements. Premature abstraction creates wrong boundaries—decomposition happened once the domain was clear.
- **DSL emerged from usage**: Started JSON-heavy. After watching real composition patterns, operators became obvious. Extracted, not designed upfront.
- **Gates as core**: Quality validation was initially bolted on. Promoting gates to first-class (own registry, hot-reload, activation rules) made the difference between "prompts that might work" and "prompts that reliably work."

---

## Links

- [GitHub](https://github.com/minipuft/claude-prompts-mcp)
- [NPM](https://www.npmjs.com/package/claude-prompts)
- [Architecture](../architecture/overview.md)
- [Design Decisions](design-decisions.md)
