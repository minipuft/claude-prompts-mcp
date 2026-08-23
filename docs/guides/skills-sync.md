# Skills Sync CLI

Define prompts once as YAML. Export as native skills to Claude Code, Cursor, Codex, and OpenCode.

## Why

Each AI coding tool expects a different skill format. MCP prompts live as YAML in
`server/resources/` — the source of truth for repository-compiled prompt skills. Skills Sync
compiles them into each client's native format so you author once and distribute everywhere.

This is distinct from the user's cross-client operational configuration: shared hand-authored
skills, rules, and global instructions are canonical in `~/.claude`, with Codex and OpenCode as
one-way downstream projections. Do not pull downstream edits into `~/.claude`; edit the Claude
source. Codex's `~/.codex/rules/` is command-execution policy rather than a Markdown-rule target.
The global instruction projection retains `CLAUDE.md` and emits one on-demand dispatch entry per
rule for both clients; it does not concatenate every rule body into always-loaded context.

Repository instructions use a separate compatibility projection. The repository's `CLAUDE.md`
and `.claude/rules/*.md` are authored sources; `npm run guidance:sync` renders a compact semantic
projection into the tracked `AGENTS.md` that Codex and OpenCode prefer. The projection includes
selected handbook sections and one dispatch entry per scoped rule, not the full rule bodies. The
pre-commit hook renders from the Git index so partially staged files cannot leak unstaged
instructions, while `npm run guidance:check` and CI reject a stale or over-budget projection. Do
not edit `AGENTS.md` directly.

### Project rule portability

| Client      | Native project guidance                                   | Target-scoped rule activation                                         |
| ----------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Claude Code | `CLAUDE.md` + `.claude/rules/*.md`                        | Yes, through rule frontmatter `paths:`                                |
| Codex       | hierarchical `AGENTS.md` files                            | No frontmatter equivalent; default project guidance budget is 32 KiB  |
| OpenCode    | `AGENTS.md`/`CLAUDE.md` + configured `instructions` files | No target-matching equivalent; instruction globs choose files to load |

The generated dispatch preserves the conditional decision without pretending the clients share
Claude Code's loader: when a task touches a listed pattern, Codex or OpenCode reads the referenced
canonical rule before editing. Adding per-file client hooks for three rules would duplicate native
loader logic and is intentionally deferred until measured misses justify mechanical enforcement.

Behavior references: [Claude Code memory](https://code.claude.com/docs/en/memory),
[Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md), and
[OpenCode rules](https://opencode.ai/docs/rules/).

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

# Merge prose you edited in an exported skill back into the canonical YAML
npm run skills:pull

# Machine-readable summary for scripts and agents
npm run skills:export -- --json
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

| Client      | Output Dir (user)            | Output Dir (project) | Adapter                       |
| ----------- | ---------------------------- | -------------------- | ----------------------------- |
| claude-code | `~/.claude/skills/`          | `.claude/skills/`    | Claude Code frontmatter       |
| cursor      | `~/.cursor/skills/`          | `.cursor/skills/`    | Agent Skills (Cursor variant) |
| codex       | `~/.codex/skills/`           | `agents/`            | Agent Skills (standard)       |
| opencode    | `~/.config/opencode/skills/` | `.opencode/skills/`  | Agent Skills (strict subset)  |

Override any output directory via the `overrides` key in `skills-sync.yaml`.

</details>

## Auto-Deregistration

A prompt exported as a skill is served by that client's native harness, so listing it again under MCP `prompts/list` offers the same prompt twice. The server reads `skills-sync.yaml` during prompt registration and skips any prompt whose `{category}/{id}` is registered for export.

```
skills-sync.yaml registrations → data-loader reads at startup → registry skips prompts/list registration
```

- Reads `registrations` (every client and every scope, unioned). The pre-`registrations` flat `exports` list is still honored on read
- A client set to `'all'` deregisters every prompt
- No manual `registerWithMcp: false` flags needed

**`>>` still works.** Deregistration removes only the MCP prompts-protocol listing. `prompt_engine` resolves `>>id` against its own prompt set, which this never touches — so an exported prompt keeps its full gate, chain, and framework machinery when you invoke it symbolically. That is the intended split:

| Path                          | What you get                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Skill (native client harness) | Prose, arguments as a hint, bundled gate guidance, gate-review hook                                  |
| `>>id` (MCP)                  | Full pipeline — runtime gate enforcement, chain sessions, framework injection, argument substitution |

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

### Gate Enforcement in Exported Skills

For **Claude Code only**, a prompt with active gates exports a `Stop` hook that makes the Enforcement Protocol real rather than advisory:

```
strategicImplement/
  SKILL.md              # frontmatter `hooks:` block → Stop → gate-review.py
  hooks/gate-review.py  # self-contained; no plugin required
  gates/<id>/guidance.md
```

The hook reads `last_assistant_message` for a `GATE_REVIEW: PASS|FAIL` verdict and exits 2 to block the end of the turn until PASS is emitted. It is declared `once: true` — skill frontmatter is the only place that flag is honored — so it fires exactly once per session and cannot block later, unrelated turns.

Two constraints shape the emitted command path. A hook command runs in the session's current directory, and `${CLAUDE_SKILL_DIR}` is **not** substituted inside a `hooks` block, so a relative path would resolve against the wrong root. Therefore:

| Scope     | Emitted command                                                                               |
| --------- | --------------------------------------------------------------------------------------------- |
| `user`    | Absolute path resolved at export time — not relocatable; move the skill and re-run the export |
| `project` | `${CLAUDE_PROJECT_DIR}/...` — portable across checkouts                                       |

Clients on the Agent Skills adapter (Cursor, Codex, OpenCode, Agent Plugins) assign no meaning to a frontmatter `hooks` key, so they receive the prose protocol and their gate section says so explicitly rather than claiming enforcement that is not there.

**OpenCode enforcement via plugin.** Every gated export also ships a machine-readable `gates/index.json` manifest (skill id + per-gate id/name/type/description/pass_criteria) beside the per-gate artifacts. The [opencode-prompts](https://github.com/minipuft/opencode-prompts) plugin reads that manifest: when the agent reads a skill whose folder carries it, the session's gates arm, further tool calls are blocked until a `GATE_REVIEW: PASS|FAIL` verdict clears them, and armed state persists across restarts. This restores mechanical review for OpenCode without a Stop event — blocking the next tool call instead of the turn's end.

### Template Compilation Fidelity

Export compiles `{% if %}` chains — including `{% elif %}` ladders, nested chains, and complex expressions (`==`, `or`, `not`) — for every client. At export time no argument values exist, so every condition is falsy: an else branch wins, an elif/expression chain without else renders empty, and a lone bare-word `{% if %}` keeps its content (that block is usually the primary instruction path). The exporter warns by name when a source uses elif or expression conditions, because their non-fallback branches will not appear in the skill.

> [!NOTE]
> Beyond this gate hook, Skills Sync exports **prompt content** only. Runtime features like chain tracking, session state, and argument substitution require a **client plugin** installed separately — e.g., [opencode-prompts](https://github.com/minipuft/opencode-prompts) for OpenCode, [gemini-prompts](https://github.com/minipuft/gemini-prompts) for Gemini. Each plugin layers on top of the base installation to add client-specific hooks.

> [!IMPORTANT]
> Skill arguments are **not** substituted. `argument-hint` is a hint for the caller; the invoking client appends arguments as free text and the body keeps its `{name}` placeholders. A prompt whose value depends on argument interpolation — or on `{{ref:...}}` / `{{script:...}}` — should be invoked with `>>` instead of exported.

> [!TIP]
> For per-client setup and MCP configuration, see the [Client Integration Guide](./client-integration.md).

## Writing Prompts That Export Well

A skill has no runtime: the client hands your prose to the model and appends whatever the user
typed as trailing text. Nothing substitutes `{{ argument }}`. That shapes how a prompt should be
written if it is also going to ship as a skill.

**Write the `{% else %}` branch for the skill reader.** Export compiles
`{% if work_type %}{{ work_type }}{% else %}[bug_fix | feature | refactor]{% endif %}` down to
`[bug_fix | feature | refactor]`, because the if-branch is the case where the argument was
supplied and in a skill it never is. The fallback is the only branch a reader ever sees, so it is
worth making it say something useful — an enumeration, a default, an example value.

**A bare `{{ argument }}` with no fallback stays literal.** It reaches the reader as `{argument}`.
When that happens, export adds one line under `## Arguments` telling the reader to state the value
in their message instead. That note appears only when a placeholder actually survives the compile —
declaring arguments you never interpolate produces no note, and neither does a prompt whose
branches all have fallbacks.

Run `npm run skills:export` and read the warnings: they name every placeholder that stayed literal,
per prompt, before you ship it.

## Which Gates an Exported Skill Carries

A skill does not bundle every gate in the registry, and it does not bundle only the ones a prompt
names. Export resolves gates through the **same activation rules the engine uses at runtime**, so
the guidance in a skill matches what `>>id` would enforce:

| Source                                                                    | Included                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------- |
| Named in the prompt's `gates.include`                                     | Always                                            |
| Named in `gates.exclude`                                                  | Never                                             |
| Declares `prompt_categories` matching the prompt                          | Yes — activation is by category, not by naming it |
| Declares no activation rules at all                                       | Yes — an unrestricted gate is active everywhere   |
| Requires a framework (`gate_type: framework`, or any `framework_context`) | **Never**                                         |

The last row is the one that differs from runtime. The engine reads an absent framework as
_unconstrained_, which is right for a live execution where a framework may yet be selected, but
wrong for a static artifact: an exported skill has no framework, so a gate that only makes sense
under one would ship guidance the reader cannot act on.

## Drift Detection

Each export records a manifest in the `skills_sync_manifests` table of `server/runtime-state/state.db`, holding SHA-256 hashes per resource. The `diff` command compares current source against that manifest to detect:

- Modified source YAML (content changed since last export)
- Missing exports (resource in manifest but not on disk)
- New resources (in exports list but not yet exported)

## Commands

| Command  | NPM Script              | Purpose                                                                        |
| -------- | ----------------------- | ------------------------------------------------------------------------------ |
| `export` | `npm run skills:export` | Write skill packages to configured output directories                          |
| `sync`   | —                       | Export, then prune managed skills whose resource is no longer registered       |
| `diff`   | `npm run skills:diff`   | Compare source against exported skills; `--output <dir>` writes `.patch` files |
| `pull`   | `npm run skills:pull`   | Merge prose edited in an exported skill back into the canonical YAML           |
| `clone`  | —                       | Create a canonical resource from an external `SKILL.md`                        |

Every command accepts `--json`, which suppresses the progress log and writes a single
machine-readable run summary to stdout — counts plus a `failures` array naming each resource
that did not export cleanly and why.

The same operations are reachable over MCP as `system_control` with
`action: "skills_sync"` and `operation: "status" | "export" | "sync" | "diff" | "pull" | "clone"`.
Prefer that path when a database is attached: it is the route that persists manifests, and
without a manifest `diff` and prune cannot see what was exported.

## See Also

- **[Build Your First Prompt](../tutorials/build-first-prompt.md)** — Create YAML prompts that Skills Sync can export
- **[Client Integration Guide](./client-integration.md)** — Per-client MCP setup and configuration
- **[Architecture Overview](../architecture/overview.md)** — System design, registration flow, and auto-deregistration
- **[MCP Tools Reference](../reference/mcp-tools.md)** — `system_control` `skills_sync` actions, and `resource_manager inspect` for the canonical resource behind a skill
