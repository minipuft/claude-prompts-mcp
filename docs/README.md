# Documentation Index

This is the map for the Claude Prompts MCP server. Canonical operational docs are organized by **user intent** (Diátaxis framework).

## Why This Matters

| Problem               | Solution            | Result                    |
| --------------------- | ------------------- | ------------------------- |
| **Learner Overwhelm** | Dedicated Tutorials | Step-by-step learning     |
| **Expert Friction**   | Pure Reference      | Fast lookup without fluff |
| **Maintenance Drift** | Intent Separation   | Clear home for every doc  |

---

## 1. Tutorials (Learning-Oriented)

_I want to learn by doing._

- **[Build Your First Prompt](tutorials/build-first-prompt.md)**: Create and run a hot-reloadable prompt.
- _(Coming Soon)_: Create an Approval Chain.

> [!TIP]
> **New here?** Start with [Build Your First Prompt](tutorials/build-first-prompt.md) — you'll have a working prompt in under 5 minutes.

## 2. How-To (Problem-Oriented)

_I have a specific problem to solve._

- **[Add Validation](how-to/add-validation.md)**: Ensure arguments match patterns (e.g., URLs).
- **[Frameworks](guides/frameworks.md)**: Reasoning frameworks (CAGEERF, ReACT, etc.) — switch, create, and customize.
- **[Gates](guides/gates.md)**: Quality validation with criteria, shell verification, and canonical gates.
- **[Phase Guards](guides/phase-guards.md)**: Deterministic structural validation of LLM output against framework phases.
- **[Injection Control](guides/injection-control.md)**: Configure frequency, targets, and modifiers for framework, gate, and style injection.
- **[Judge Mode](guides/judge-mode.md)**: Context-isolated gate evaluation to prevent self-evaluation bias.
- **[Ralph Loops](guides/ralph-loops.md)**: Autonomous verification loops until tests pass.
- **[Script Tools](guides/script-tools.md)**: Run Python scripts inside prompts.
- **[Client Integration](guides/client-integration.md)**: Configure per-client MCP installation with `--client` presets.
- **[Identity Scope](guides/identity-scope.md)**: Configure multi-tenant workspace/organization isolation.
- **[Troubleshooting](guides/troubleshooting.md)**: Diagnose common errors.
- **[Release Process](guides/release-process.md)**: How we ship updates.

> [!TIP]
> **Most common tasks:** [Gates](guides/gates.md) for output validation, [Injection Control](guides/injection-control.md) for token management, [Troubleshooting](guides/troubleshooting.md) for quick fixes.

## 3. Reference (Information-Oriented)

_I need to look up syntax or API details._

- **[MCP Tools](reference/mcp-tools.md)**: `prompt_engine`, `resource_manager`, `system_control`.
- **[Prompt Schema](reference/prompt-yaml-schema.md)**: `prompt.yaml` configuration.
- **[Chain Schema](reference/chain-schema.md)**: `chainSteps` configuration.
- **[Gate Configuration](reference/gate-configuration.md)**: `gate.yaml` configuration.
- **[Template Syntax](reference/template-syntax.md)**: Nunjucks + custom extensions.
- **[Client Capabilities](reference/client-capabilities.md)**: Client preset matrix, profile mapping, and integration limits.

> [!TIP]
> **Looking up a parameter?** [MCP Tools](reference/mcp-tools.md) covers all three tools with examples. [Prompt Schema](reference/prompt-yaml-schema.md) covers every `prompt.yaml` field.

## 4. Concepts (Understanding-Oriented)

_I want to understand how it works._

- **[Chains Lifecycle](concepts/chains-lifecycle.md)**: State machine and session management.
- **[Quality Gates](concepts/quality-gates.md)**: Precedence ladder and verification types.
- **[Architecture Overview](architecture/overview.md)**: Runtime, transports, pipeline.

> [!TIP]
> **Want the big picture?** [Architecture Overview](architecture/overview.md) maps the full request lifecycle from input to validated output.

---

## Meta & Portfolio

- **Decisions**: `docs/adr/`
- **Portfolio**: `docs/portfolio/`
- **Plans**: `plans/`
- **Changelog**: `CHANGELOG.md`
- **Contributing**: `CONTRIBUTING.md`
