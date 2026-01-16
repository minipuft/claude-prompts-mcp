# Documentation Index

> Status: canonical

This is the map for the Claude Prompts MCP server. Canonical operational docs are organized by **user intent** (Diátaxis framework).

## Why This Matters

| Problem | Solution | Result |
|---------|----------|--------|
| **Learner Overwhelm** | Dedicated Tutorials | Step-by-step learning |
| **Expert Friction** | Pure Reference | Fast lookup without fluff |
| **Maintenance Drift** | Intent Separation | Clear home for every doc |

---

## 1. Tutorials (Learning-Oriented)

*I want to learn by doing.*

- **[Build Your First Prompt](tutorials/build-first-prompt.md)**: Create and run a hot-reloadable prompt.
- *(Coming Soon)*: Create an Approval Chain.

## 2. How-To (Problem-Oriented)

*I have a specific problem to solve.*

- **[Add Validation](how-to/add-validation.md)**: Ensure arguments match patterns (e.g., URLs).
- **[Script Tools](guides/script-tools.md)**: Run Python scripts inside prompts.
- **[Troubleshooting](guides/troubleshooting.md)**: Diagnose common errors.
- **[Release Process](guides/release-process.md)**: How we ship updates.

## 3. Reference (Information-Oriented)

*I need to look up syntax or API details.*

- **[MCP Tools](reference/mcp-tools.md)**: `prompt_engine`, `resource_manager`, `system_control`.
- **[Prompt Schema](reference/prompt-yaml-schema.md)**: `prompt.yaml` configuration.
- **[Chain Schema](reference/chain-schema.md)**: `chainSteps` configuration.
- **[Gate Configuration](reference/gate-configuration.md)**: `gate.yaml` configuration.
- **[Template Syntax](reference/template-syntax.md)**: Nunjucks + custom extensions.

## 4. Concepts (Understanding-Oriented)

*I want to understand how it works.*

- **[Chains Lifecycle](concepts/chains-lifecycle.md)**: State machine and session management.
- **[Quality Gates](concepts/quality-gates.md)**: Precedence ladder and verification types.
- **[Architecture Overview](architecture/overview.md)**: Runtime, transports, pipeline.

---

## Meta & Portfolio

- **Decisions**: `docs/adr/`
- **Portfolio**: `docs/portfolio/`
- **Plans**: `plans/`
- **Changelog**: `server/CHANGELOG.md`
- **Contributing**: `CONTRIBUTING.md`
