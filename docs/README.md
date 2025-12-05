# Documentation Index

This is the map for the Claude Prompts MCP server. All canonical guides live here.

## Learning Path

If you are new, follow this sequence:

1.  **[Operations Guide](operations-guide.md)**: Install Node, build the server, and connect Claude Desktop.
2.  **[MCP Tooling Guide](mcp-tooling-guide.md)**: Learn the commands (`prompt_engine`, `prompt_manager`, `system_control`).
3.  **[Authoring Guide](prompt-authoring-guide.md)**: Write your first hot-reloadable prompt template.
4.  **[Chain Workflows](chain-workflows.md)**: Connect prompts into multi-step workflows.
5.  **[Architecture](architecture.md)**: Deep dive into the runtime, transports, and pipeline.

## Reference Manual

| Doc                                          | Purpose                                                   |
| -------------------------------------------- | --------------------------------------------------------- |
| [Architecture Overview](architecture.md)     | Runtime lifecycle, execution pipeline, and transport map. |
| [Operations Guide](operations-guide.md)      | Installation, troubleshooting, and supervisor mode.       |
| [MCP Tooling Guide](mcp-tooling-guide.md)    | API reference for all MCP tools.                          |
| [Authoring Guide](prompt-authoring-guide.md) | Markdown schemas, Nunjucks templates, and arguments.      |
| [Chain Workflows](chain-workflows.md)        | Defining steps, branching logic, and state.               |
| [Gate System](enhanced-gate-system.md)       | Configuring quality gates and validation.                 |
| [Release Notes](release-notes.md)            | Changelog and migration notes.                            |
| [Contributing](../CONTRIBUTING.md)           | How to build, test, and submit PRs.                       |

## Meta

- **[Plans](../plans/)**: Implementation plans and roadmap for LLM context.
- **[TODO](TODO.md)**: Official task list.

**Note**: If you find a discrepancy between these docs and the code in `server/src/`, the code is the source of truth. Please submit a PR to fix the doc.
