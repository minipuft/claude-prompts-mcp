# Documentation Index

This is the map for the Claude Prompts MCP server. All canonical guides live here.

## Learning Path

If you are new, follow this sequence:

1.  **[Main README](../README.md)**: Quick Start with NPM or from source.
2.  **[MCP Tooling Guide](mcp-tools.md)**: Learn the commands (`prompt_engine`, `prompt_manager`, `system_control`).
3.  **[Authoring Guide](prompt-authoring-guide.md)**: Write your first hot-reloadable prompt template.
4.  **[Chains](chains.md)**: Connect prompts into multi-step workflows.
5.  **[Architecture](architecture.md)**: Deep dive into the runtime, transports, and pipeline.

## Reference Manual

| Doc                                          | Purpose                                                   |
| -------------------------------------------- | --------------------------------------------------------- |
| [Architecture Overview](architecture.md)     | Runtime lifecycle, execution pipeline, and transport map. |
| [MCP Tooling Guide](mcp-tools.md)    | API reference for all MCP tools.                          |
| [Authoring Guide](prompt-authoring-guide.md) | Markdown schemas, Nunjucks templates, and arguments.      |
| [Chains](chains.md)                          | Defining steps, branching logic, and state.               |
| [Gates](gates.md)                            | Configuring quality gates and validation.                 |
| [Troubleshooting](troubleshooting.md)        | Common issues and how to fix them.                        |
| [Changelog](../CHANGELOG.md)                 | Version history and migration notes.                      |
| [Contributing](../CONTRIBUTING.md)           | How to build, test, and submit PRs.                       |

## Meta

- **[Plans](../plans/)**: Implementation plans and roadmap for LLM context.
- **[TODO](TODO.md)**: Official task list.

**Note**: If you find a discrepancy between these docs and the code in `server/src/`, the code is the source of truth. Please submit a PR to fix the doc.
