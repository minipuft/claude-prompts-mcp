# Claude Prompts MCP — Documentation Index

This index tracks the canonical documentation set after the docs migration. Each entry lists its lifecycle status so contributors know where to add new content. Refer to `plans/docs-migration-plan.md` for migration history and follow-up tasks.

## Server Capabilities & Learning Path

The Claude Prompts MCP server bundles three MCP tools (`prompt_engine`, `prompt_manager`, `system_control`) behind a single runtime with the PromptExecutionPipeline, methodology-aware gate system, hot reload, and STDIO/SSE transports. Use this path if you are new to the project:

1. **Understand the architecture** → Read the [Architecture Overview](architecture.md) for the runtime map, transports, and pipeline.
2. **Install & run the server** → Follow the [Operations & Deployment Guide](operations-guide.md) to set up Node, transports, and supervisor mode.
3. **Interact using MCP tools** → Learn the commands in the [MCP Tooling Guide](mcp-tooling-guide.md).
4. **Author prompts & templates** → Use the [Prompt & Template Authoring Guide](prompt-authoring-guide.md) for Markdown structure and schema tips.
5. **Build multi-step chains** → Extend workflows via the [Chain Workflows Guide](chain-workflows.md).
6. **Tune gate behavior** → Consult the [Enhanced Gate System](enhanced-gate-system.md) for precedence and guidance.

Each step revolves around context engineering: prompts start as Markdown templates, `prompt_manager` registers them with schema metadata, the hot-reload pipeline renders them through Nunjucks, and `prompt_engine` delivers them (optionally with frameworks) to the LLM.

### Quick Entry Points

- **Ship it**: Follow the [Operations & Deployment Guide](operations-guide.md) to get STDIO/SSE transports online.
- **Customize prompts fast**: Pair the [MCP Tooling Guide](mcp-tooling-guide.md) with the [Prompt & Template Authoring Guide](prompt-authoring-guide.md) to create or edit templates in-place.
- **Design complex flows**: Use the [Chain Workflows Guide](chain-workflows.md) plus the [Enhanced Gate System](enhanced-gate-system.md) for multi-step reasoning with guardrails.
- **Understand the “why”**: Revisit the [Architecture Overview](architecture.md) once you’ve experimented—it ties transports, sessions, frameworks, and commands into a single story.

## Canonical References

| Doc | Status | Purpose |
| --- | --- | --- |
| [Architecture Overview](architecture.md) | canonical | Runtime lifecycle, subsystem map, execution tiers, transport overview. |
| [Operations & Deployment Guide](operations-guide.md) | canonical | Installation, transports, supervisor usage, diagnostics. |
| [MCP Tooling Guide](mcp-tooling-guide.md) | canonical | Usage patterns for `prompt_manager`, `prompt_engine`, and `system_control`. |
| [Prompt & Template Authoring Guide](prompt-authoring-guide.md) | canonical | Markdown structure, argument schemas, framework integration. |
| [Chain Workflows Guide](chain-workflows.md) | canonical | Chain schema, session state, branching, diagnostics. |
| [Enhanced Gate System](enhanced-gate-system.md) | canonical | Gate precedence, definitions, guidance renderer behavior. |
| [Release Notes](release-notes.md) | canonical | Version highlights mapped to runtime modules. |
| [Contributing Guide](../CONTRIBUTING.md) | canonical | Development workflow, hooks, testing expectations. |

## Supporting Docs

| Doc | Status | Purpose |
| --- | --- | --- |
| [Plans](../plans/) | canonical | Long-running migrations (docs plan, lifecycle, lint fixes, etc.). |
| [TODO](TODO.md) | legacy | Historical notes. Move actionable work into `plans/` during cleanup. |

## How to Use This Index

1. When editing docs, update the status column here if the lifecycle changes (e.g., once `operations-guide.md` is considered canonical).
2. Avoid creating new docs without first updating `plans/docs-migration-plan.md`; we prefer consolidating into the files above.
3. Cross-link guides when referencing overlapping content (prompt authoring ↔ chain workflows ↔ gate system) so users can navigate easily.

If you notice drift between these docs and `server/dist/**`, prioritize fixing the docs alongside code changes.
