# Skills Sync CLI

Define prompts once as YAML. Export as native skills to Claude Code, Cursor, Codex, and OpenCode.

## Why

Each AI coding tool expects a different skill format. Your prompts live as YAML in `server/resources/` — the single source of truth. Skills Sync compiles them into each client's native format so you author once and distribute everywhere.

| Problem                            | Solution                                       | Result                                                    |
| ---------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| Prompts locked inside MCP server   | `skills-sync export` compiles to native format | `/review` works as a Claude Code skill, Cursor rule, etc. |
| Exported prompts duplicated in MCP | Auto-deregistration via exports list           | Single source, no duplication                             |
| Drift between source and exports   | `skills-sync diff` with SHA-256 manifests      | Know when skills are stale                                |

## Quick Start

```bash
cd server

# Copy the example config and customize your exports
cp skills-sync.example.yaml skills-sync.yaml

# Export prompts to all configured clients
npm run skills:export

# Check for drift between source and exported skills
npm run skills:diff

# Generate .patch files for out-of-sync skills
npm run skills:pull
```

## Configuration

`skills-sync.yaml` is your personal config. Copy from `skills-sync.example.yaml` to get started. Client knowledge (adapters, output directories, capabilities) is built into the CLI — you only configure **what** to export:

> [!NOTE]
> `skills-sync.yaml` is git-ignored by default — it contains user-specific output paths and export selections. Commit `skills-sync.example.yaml` as a team template instead.

```yaml
# Opt-in allow-list. Only listed resources are exported.
exports:
  - prompt:development/validate_work
  - prompt:development/review

# Optional: override default output directories per client
# overrides:
#   claude-code:
#     outputDir:
#       user: ~/custom/claude-skills
```

### Export Format

Only prompts are exported as standalone skills. Format is `prompt:{category}/{id}`:

```yaml
exports:
  - prompt:development/validate_work # → resources/prompts/development/validate_work/
  - prompt:development/review # → resources/prompts/development/review/
```

**Gate bundling**: Prompts that declare `gateConfiguration.include` in their `prompt.yaml` get referenced gates bundled into the skill directory as `gates/{id}/gate.yaml` + `guidance.md`, with an inline `## Quality Gates` criteria table in the SKILL.md.

**Doc bundling**: Prompts with a `docs/` subdirectory get all `.md` files bundled into `docs/` in the exported skill directory. Use this for templates, reference material, and supporting documentation that supplements the main SKILL.md. Doc files are included in the content hash for drift detection.

**Frameworks and styles** are MCP pipeline-injected context — they are not exported as skills. They operate at runtime through the prompt engine and framework system.

<details>
<summary><strong>Built-in Client Defaults</strong></summary>

The CLI knows how to target each client without configuration:

| Client      | Output Dir (user)     | Output Dir (project) | Adapter                       |
| ----------- | --------------------- | -------------------- | ----------------------------- |
| claude-code | `~/.claude/skills/`   | `.claude/skills/`    | Claude Code frontmatter       |
| cursor      | `~/.cursor/skills/`   | `.cursor/skills/`    | Agent Skills (Cursor variant) |
| codex       | `~/.codex/skills/`    | `agents/`            | Agent Skills (standard)       |
| opencode    | `~/.opencode/skills/` | `.opencode/skills/`  | Agent Skills (strict subset)  |

Override any output directory via the `overrides` key in `skills-sync.yaml`.

</details>

## Auto-Deregistration

Prompts in the `exports` list are automatically hidden from MCP `prompts/list` at startup. The server reads `skills-sync.yaml` during prompt registration and skips any prompt whose `{category}/{id}` appears in the exports list.

```
skills-sync.yaml exports → data-loader reads at startup → registry skips MCP registration
```

- No manual `registerWithMcp: false` flags needed
- Prompts remain in the internal registry (accessible via `resource_manager inspect`)
- Only affects MCP protocol responses — chains and pipeline can still reference exported prompts

## Adapters

### Claude Code Adapter

Generates `SKILL.md` files with YAML frontmatter:

```markdown
---
name: review
description: Comprehensive code review...
arguments:
  - name: target
    type: string
    required: true
---

[compiled prompt content with $0, $1 argument syntax]
```

### Agent Skills Adapter

Generates plain markdown for Cursor, Codex, and OpenCode:

```markdown
# Review

Comprehensive code review...

[compiled prompt content with plain argument references]
```

Client variants control minor format differences (e.g., Cursor's `alwaysApply` frontmatter).

> [!NOTE]
> Skills Sync exports **prompt content** only. Runtime features like chain tracking, gate enforcement, and session hooks require a **client plugin** installed separately — e.g., [opencode-prompts](https://github.com/minipuft/opencode-prompts) for OpenCode, [gemini-prompts](https://github.com/minipuft/gemini-prompts) for Gemini. Each plugin layers on top of the base installation to add client-specific hooks.

> [!TIP]
> For per-client setup and MCP configuration, see the [Client Integration Guide](./client-integration.md).

## Drift Detection

Each export generates a manifest at `server/cache/skills-sync.{clientId}.json` containing SHA-256 hashes per resource. The `diff` command compares current source against the manifest to detect:

- Modified source YAML (content changed since last export)
- Missing exports (resource in manifest but not on disk)
- New resources (in exports list but not yet exported)

## Commands

| Command  | NPM Script              | Purpose                                               |
| -------- | ----------------------- | ----------------------------------------------------- |
| `export` | `npm run skills:export` | Write skill packages to configured output directories |
| `diff`   | `npm run skills:diff`   | Compare source against exported skills                |
| `pull`   | `npm run skills:pull`   | Generate `.patch` files for out-of-sync skills        |

## See Also

- **[Build Your First Prompt](../tutorials/build-first-prompt.md)** — Create YAML prompts that Skills Sync can export
- **[Client Integration Guide](./client-integration.md)** — Per-client MCP setup and configuration
- **[Architecture Overview](../architecture/overview.md)** — System design, registration flow, and auto-deregistration
- **[MCP Tools Reference](../reference/mcp-tools.md)** — `resource_manager inspect` for checking exported prompts
