# Prompt & Template Authoring Guide

**Use this guide when** you need to build or update Markdown templates for Claude Prompts MCP. Every prompt, chain, and gateable workflow starts here—and every template you write travels through MCP tools, hot reload, and the PromptExecutionPipeline before reaching the LLM.

**You’ll learn**
- How prompts are registered via `prompt_manager`, stored as Markdown, and rendered through Nunjucks
- How to structure arguments and metadata so the runtime builds Zod schemas automatically
- Where frameworks, inline gates, and chains hook into your templates

This guide reflects the runtime compiled into `server/dist/prompts/**`, `server/dist/types/**`, and the consolidated prompt engine.

## Who This Is For

- Prompt engineers adding or modifying Markdown templates
- Framework experts building CAGEERF/ReACT/5W1H/SCAMPER-focused flows
- Developers migrating legacy prompts into the consolidated registry

Need command references? Pair this guide with the [MCP Tooling Guide](mcp-tooling-guide.md). Designing multi-step experiences? Continue with the [Chain Workflows Guide](chain-workflows.md). Validating inline gates or methodology output? See the [Enhanced Gate System](enhanced-gate-system.md).

## Authoring Workflow Checklist

1. **Plan** the prompt ID, category, and arguments (record in `prompts/promptsConfig.json`).
2. **Create/Edit** via `prompt_manager` (see `docs/mcp-tooling-guide.md`). Never write files directly.
3. **Write Markdown** using the structure below; include argument placeholders.
4. **Describe arguments** in the prompt metadata (types + validation).
5. **Reload** with `prompt_manager(action:"reload")`.
6. **Test** using `prompt_engine(command:">>prompt_id ...")` with and without gate validation.

> Framework callouts in templates are **advisory**—the runtime only applies CAGEERF/ReACT/5W1H/SCAMPER if the operator manually enables that framework via `system_control`. Structural analysis handles execution tiers, not tone or semantic intent.

## Registry & File Layout

- `prompts/promptsConfig.json` lists categories and imported files. Each entry references a `prompts/<category>/prompts.json` file.
- Prompt metadata includes `id`, `name`, `category`, `description`, `file`, `arguments`, optional `isChain`, and `chainSteps` definitions.
- Markdown templates live alongside their category (`prompts/<category>/templates/*.md`). The prompt manager keeps filenames synchronized with IDs.

## Template Anatomy

A template is a Markdown file processed by Nunjucks before being sent to the LLM. Recommended structure:

```markdown
# Prompt Title

Short summary of the objective.

## System Message (optional)
Instructions that become the system prompt when Tier 2/3 execution is selected.

## User Message Template
Narrative that includes variables like {{topic}}, {{goal}}, {{constraints}}.

## Sections (optional)
Repeatable subsections, tables, or checklists.
```

Optional hint block (legacy but still supported):

```markdown
_Optional execution hints_
**🎯 EXECUTION TYPE**: Template
**⚠️ NOTES**: Include gate instructions when required.
```

The semantic analyzer in `server/dist/semantic/configurable-semantic-analyzer.js` infers execution type automatically, so hints are purely advisory.

### Example Template → Rendered Prompt

```markdown
# 🔍 Ops Status Snapshot

Provide a concise summary of the latest MCP ops metrics.

## Inputs
- **Logs**: {{logs}}
- **Gate Summary**: {{gate_summary | default("N/A")}}

## Framework Guidance (optional)
If the runtime selected a framework, incorporate its perspective when evaluating risk.
```

When you run `prompt_engine >>ops_status_snapshot logs="Transport stable"`:
1. `prompt_manager` has already stored metadata/arguments for this template (no manual file edits).
2. Hot reload feeds the Markdown through Nunjucks, injecting `logs` and `gate_summary`.
3. Framework context appears only if `system_control` switched one on *and* `enableSystemPromptInjection=true`; otherwise the Markdown above fully defines the prompt.
4. Gate validation follows whatever inline gates you declared (see [Enhanced Gate System](enhanced-gate-system.md)).

## Argument Schema Metadata

Arguments defined in the prompt metadata feed Zod schemas at runtime.

| `type` | Notes |
| --- | --- |
| `string` (default) | UTF-8 text; can include `minLength`, `maxLength`, `pattern`, `allowedValues`. |
| `number` | Accepts numeric strings; invalid values trigger `SCHEMA_INVALID_NUMBER`. |
| `boolean` | Accepts `true/false` (case insensitive). |
| `array` | JSON array or comma-delimited string, coerced via helper utilities. |
| `object` | JSON objects parsed before validation. |

Example metadata block:

```json
{
  "arguments": [
    {
      "name": "topic",
      "description": "Subject to analyze",
      "required": true,
      "type": "string",
      "validation": {
        "minLength": 5,
        "pattern": "^[A-Za-z0-9 ,.-]+$"
      }
    },
    {
      "name": "iterations",
      "description": "Refinement cycles",
      "required": false,
      "type": "number",
      "defaultValue": 1,
      "validation": {
        "allowedValues": [1, 2, 3]
      }
    }
  ]
}
```

The consolidated prompt engine builds a Zod schema from this metadata (`server/dist/types/types.js`). Keep descriptions accurate; validation errors reference them verbosely.

## Execution Modes & Authoring Choices

| Mode | When to Use | Author Responsibilities |
| --- | --- | --- |
| Prompt (Tier 1) | Simple substitution, minimal structure | Provide concise template text with {{variables}} and keep metadata light. |
| Template (Tier 2) | Structured guidance requiring frameworks | Write rich sections, call out methodology hints, expect framework injection. |
| Chain (Tier 3) | Multi-step workflows orchestrated by the client | Define `chainSteps` JSON (see `docs/chain-workflows.md`) and create supporting prompts referenced by each step. |

Use the semantic analyzer and `prompt_manager(action:"analyze_type")` to confirm the tier before committing.

## Gate Configuration Blocks

Every template can declare reusable gates directly inside the Markdown file. Add a `## Gate Configuration` section at the end of the document and include a JSON payload:

```markdown
## Gate Configuration
```json
{
  "include": ["technical-accuracy", "code-quality"],
  "exclude": ["research-quality"],
  "framework_gates": true,
  "temporary_gates": [
    {
      "name": "Inline Project Checklist",
      "type": "quality",
      "scope": "execution",
      "description": "Custom checklist for this prompt only",
      "guidance": "- Verify requirements\n- Provide next actions",
      "pass_criteria": []
    }
  ]
}
```
```

During loading the server strips this section from the rendered template, stores it on the prompt object, and feeds it into the execution planner. You get the following behavior automatically:

- `include`: canonical gate IDs merged with category auto-gates and anything the chain planner adds later.
- `exclude`: removes specific gates even if they are auto-assigned for the category.
- `framework_gates`: toggle methodology gates on/off per prompt when `system_control` would otherwise enable them globally.
- `temporary_gates`: define inline guidance or validation rules without resorting to the symbolic `::` operator. These behave exactly like temporary gates created via `prompt_engine`.
- `gate_scope`: fine-tune whether a chain step should share execution/session gates or keep them step-local (scope now determines propagation automatically).
- `gate_verdict`: when gate reviewers pause a run, resume by sending `GATE_REVIEW: PASS/FAIL - reason` via this parameter while keeping `user_response` for the actual step output.

For chain prompts you can also attach gates directly to each `chainSteps` entry in the JSON metadata. Those per-step gates join the same planner pipeline and show up in Gate Enhancement Stage without any extra authoring work.

Refer to `docs/enhanced-gate-system.md` if you need deeper details on precedence, but this section is the canonical way to keep gate configuration versioned alongside your Markdown.

## Framework Integration

Framework adapters live under `server/dist/frameworks/methodology/`. When a template requires CAGEERF/ReACT/5W1H/SCAMPER:

- Mention the framework explicitly in the Markdown so human readers understand the structure.
- Provide sections that map to methodology stages (Context, Analysis, Goals, etc.).
- Reference `{{framework}}` or related arguments only when you genuinely need to override defaults; otherwise, `system_control` sets the active framework globally.

Example excerpt:

```markdown
# CAGEERF Analysis: {{topic}}

## Context
Stakeholders: {{stakeholders}}
Constraints: {{constraints}}

## Analysis
{% for component in components %}
- {{component.name}}: {{component.description}}
{% endfor %}
```

The framework instruction injector stitches the right methodology guidance into the execution context automatically.

## Advanced Patterns

- **Text references**: use `{{ref:path/to/file.md}}` to include reusable snippets from the `text-references` registry.
- **Conditionals**: leverage Nunjucks (`{% if flags.critical %}...{% endif %}`) for optional sections.
- **Tables & Lists**: Markdown tables render cleanly in Claude Desktop and SSE clients; align headings with the data you expect from arguments.
- **Gate hints**: Mention quality expectations inline (e.g., “Ensure at least 3 risks are listed”). Gates (`server/dist/gates/`) enforce the same constraints when `api_validation:true` is provided alongside `gate_verdict`.

## Testing & Validation

1. `prompt_manager(action:"list", filter:"id:my_prompt")` to review metadata.
2. `prompt_engine(command:">>my_prompt arg=value", api_validation=true)` to confirm tier behavior and gate results.
3. Inspect logs under `server/logs/` for semantic analyzer traces if the wrong tier is selected.
4. Document unique behaviors (custom arguments, gate expectations) inside the Markdown to help future maintainers.

## Anti-Patterns

- 🚫 Editing Markdown/JSON directly via editors—use MCP tools to keep registries synchronized.
- 🚫 Hard-coding frameworks inside templates when `system_control` already forces a default; prefer parameterized copies only when absolutely unique.
- 🚫 Embedding shell commands or file paths that assume a specific OS. Keep prompts transport-agnostic.

## Where to Go Next

- Multi-step workflows and chains → `docs/chain-workflows.md`
- Tool invocations, reloads, and diagnostics → `docs/mcp-tooling-guide.md`
- Quality gates, precedence, and lint expectations → `docs/enhanced-gate-system.md`
