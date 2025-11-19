# MCP Tooling Guide

**Use this guide when** you want concrete MCP commands for creating prompts, executing templates/chains, or adjusting frameworks at runtime—without touching files manually.

**Before you start**: Make sure the server is running (see [Operations & Deployment Guide](operations-guide.md)). For Markdown structure and schema details, read the [Prompt & Template Authoring Guide](prompt-authoring-guide.md); for multi-step flows, keep the [Chain Workflows Guide](chain-workflows.md) nearby.

**Loop overview**
1. Edit prompts via `prompt_manager`.
2. Reload/inspect via MCP responses (hot reload handles file IO for you).
3. Execute via `prompt_engine` (with optional gates/frameworks).
4. Adjust frameworks/analytics through `system_control`.

Every prompt is essentially a context-engineered template: Markdown + metadata + runtime arguments. This guide shows how to manipulate those templates entirely through MCP commands.

## Tool Matrix

| Tool | Dist Entry | Purpose |
| --- | --- | --- |
| `prompt_manager` | `server/dist/mcp-tools/prompt-manager/index.js` | Prompt/template/chain lifecycle management (create, update, delete, reload, analyze) |
| `prompt_engine` | `server/dist/mcp-tools/prompt-engine/index.js` | Unified execution engine with tier detection, framework injection, chains, and gate validation |
| `system_control` | `server/dist/mcp-tools/system-control/index.js` | Runtime administration (framework switching, analytics, transport info, config snapshots) |

## Workflow Guardrails

- **Never** edit prompt JSON/Markdown files directly. Use `prompt_manager` actions so watchers, schema validation, and registry updates stay in sync.
- Record every change via MCP CLI commands (Claude prompt, CLI harness, or automation). Logs and the tool description manager rely on the structured responses.
- Prefer `prompt_manager(action:"reload")` over manual server restarts; the runtime re-registers prompts with MCP automatically.

## Command Syntax Patterns

### The `>>` Prefix Limitation ⚠️

The `>>` prefix (e.g., `>>prompt_name args`) is **supported in the parser** but may **fail when calling MCP tools via XML-based clients** (like Claude Code) due to XML entity encoding.

**What happens**:
- Command sent: `>>test_prompt input:'value'`
- Server receives: `>test_prompt input:'value'` (one `>` stripped)
- Result: Parse error

**Why**: The `>` character is special in XML (`&gt;`). When parameters are decoded, `>>` becomes `>`, causing parsing to fail.

### Recommended Syntax Patterns

**✅ Use Symbolic Operators** (makes `>>` optional):
```bash
# Chain operator (works even for single prompts)
prompt_engine(command:"test_prompt input:'value' --> ")

# Framework operator
prompt_engine(command:"@CAGEERF test_prompt input:'value'")

# Gate operator
prompt_engine(command:"test_prompt input:'value' :: 'quality check'")
```

**✅ Use JSON Format**:
```bash
prompt_engine(command:"{\"command\": \"test_prompt\", \"args\": {\"input\": \"value\"}}")
```

**❌ Avoid** (may fail via MCP tools):
```bash
prompt_engine(command:">>test_prompt input:'value'")  # >> gets stripped to >
```

### Symbolic Operators Quick Reference

| Operator | Symbol | Example | Purpose |
|----------|--------|---------|---------|
| Chain | `-->` | `step1 --> step2 --> step3` | Sequential execution |
| Framework | `@` | `@CAGEERF prompt_name` | Apply methodology |
| Gate | `::` | `prompt :: "criteria"` | Quality validation |
| Parallel | `+` | `task1 + task2` | Concurrent execution |

**Key insight**: When symbolic operators are present, the `>>` prefix becomes optional. Use this to your advantage when calling via MCP tools.

## `prompt_manager` — Lifecycle Operations

### Listing & Filtering

```bash
prompt_manager(action:"list")
prompt_manager(action:"list", filter:"category:analysis type:template")
prompt_manager(action:"list", filter:"intent:refactor state:published")
```

The filter DSL accepts `category`, `type`, `intent`, `confidence`, and free-text search terms. Results include lifecycle metadata (prompt/template/chain, file path, arguments).

### Creating Prompts

```bash
prompt_manager(action:"create", id:"analysis_report", name:"Analysis Report",
  category:"analysis", description:"Framework-enhanced analysis",
  user_message_template:"Review {{content}} using {{framework}} methodology",
  execution_hint:"template",
  arguments=[
    {"name":"content","required":true},
    {"name":"framework","required":false,"defaultValue":"CAGEERF"}
  ])
```

- `create` auto-detects prompt/template/chain based on `execution_hint` + structure.
- Use `create_prompt` or `create_template` for explicit control.
- Provide descriptive IDs (snake_case) to match filenames under `server/prompts/**`.

### Updating & Modifying

```bash
prompt_manager(action:"update", id:"analysis_report",
  description:"Updated description",
  arguments=[{"name":"content","required":true}])

prompt_manager(action:"modify", id:"analysis_report",
  section_name:"user_message_template",
  new_content:"Analyze {{content}} with {{framework}} focus")
```

- `update` replaces entire sections; `modify` targets a single block (content, metadata, arguments, chain steps).
- Schema validation (Zod) runs before touching disk; errors return `SCHEMA_*` codes.

### Chains & Advanced Actions

- `prompt_manager(action:"create", execution_hint:"chain", chain_steps=[...])`
- `prompt_manager(action:"migrate_type", id:"legacy_prompt", target_type:"template")`
- `prompt_manager(action:"analyze_type", id:"analysis_report")`
- `prompt_manager(action:"reload", reason:"synced after edits")`

### Safe Deletions

```bash
prompt_manager(action:"delete", id:"unused_prompt", confirm=true)
```

Deletes remove Markdown + JSON references and trigger a hot reload. Keep backups via Git before running destructive operations.

## `prompt_engine` — Unified Execution

### Basic Invocation

```bash
# Recommended: Use chain operator (even for single prompts)
prompt_engine(command:"analysis_report content:'Quarterly metrics' --> ")

# Alternative: Use JSON format
prompt_engine(command:"{\"command\": \"analysis_report\", \"args\": {\"content\": \"Quarterly metrics\"}}")

# With framework
prompt_engine(command:"@CAGEERF analysis_report content:'Quarterly metrics'")
```

- The engine inspects prompt metadata and semantic hints to choose prompt/template/chain execution.
- Use `execution_mode` to force behavior: `execution_mode:"template"` or `execution_mode:"chain"`.
- **Note**: Avoid `>>` prefix when calling via MCP tools (see Command Syntax Patterns above).

### Chain Execution & Sessions

**Starting a new chain**:
```bash
prompt_engine(command:"chain://research_pipeline?force_restart=true")
prompt_engine(command:">>research_pipeline topic:'LLM safety'", llm_driven_execution=true)
```

**Continuing an existing chain** (Resume-Only Mode):

The recommended way to continue a chain is to provide **only** the `chain_id` and `user_response`:

```bash
# Continue to next step
prompt_engine(chain_id:"chain-research_pipeline#3", user_response:"Step 2 complete - findings attached")

# Gate review response (send verdict separately)
prompt_engine(chain_id:"chain-analysis_flow#2", gate_verdict:"GATE_REVIEW: PASS - All criteria met")
```

**Key points**:
- The `command` parameter is **optional** when resuming - the system restores the execution plan from the chain session
- This is simpler and avoids potential XML encoding issues with the `>>` prefix
- You can still provide a command if needed (e.g., to modify arguments or restart)

**Advanced options**:
- Query parameters: `force_restart=true`, `framework=ReACT`, `conditional_mode=true`, `max_retries=5`
- The archival `session_id` lives in runtime-state only and never needs to be sent back
- Step metadata includes dependencies, conditional expressions, and gate IDs—mirror the JSON definitions under `server/prompts/**`

### Gate Validation

- Opt into API validation with `api_validation:true`. The engine routes prompts to the gate loaders (`server/dist/gates/core/*`) and returns actionable guidance once you provide a `gate_verdict`.
- Chains automatically trigger gates on steps marked with `inlineGateIds`.

### Diagnostics

- `prompt_engine(command:">>prompt_id", api_validation=true, debug=true)` surfaces parsing + framework traces.
- Errors provide remediation URIs when available (e.g., `chain://...&force_restart=true`).

## `system_control` — Runtime Administration

```bash
system_control(action:"status")
system_control(action:"list_frameworks")
system_control(action:"switch_framework", framework:"CAGEERF")
system_control(action:"analytics", window:"1h")
```

- `status`: transport mode, framework, prompts loaded, runtime-state health.
- `list_frameworks`: enumerates adapters in `server/dist/frameworks/methodology/`.
- `switch_framework`: updates runtime-state so new executions default to the selected methodology. Framework selection is **manual**—structural analysis only decides execution tier, so choose a framework explicitly when you want a different reasoning style.
- `analytics`: surfaces metrics from `server/dist/metrics/analytics-service.js` (execution counts, average runtimes, gate pass rates).
- `config`: inspect `config.json` overlays at runtime without reading files manually.

## Recommended Workflows

1. **Add a new prompt**
   1. `prompt_manager(action:"create", ...)`
   2. `prompt_manager(action:"reload")`
   3. `prompt_engine(command:">>new_prompt ...")` to validate execution tier + gates.

2. **Extend a chain**
   1. `prompt_manager(action:"list", filter:"id:target_chain")`
   2. `prompt_manager(action:"modify", section_name:"chain_steps", new_content=[...])`
   3. `prompt_manager(action:"reload")`
   4. `prompt_engine(command:"chain://target_chain?force_restart=true")`

3. **Rotate frameworks**
   1. `system_control(action:"list_frameworks")`
   2. `system_control(action:"switch_framework", framework:"ReACT")`
   3. Execute prompts; gates + template injection now reference the selected methodology. Auto-selection isn’t implemented yet, so repeat this whenever you need a different “theme.”

## Troubleshooting Tool Calls

| Symptom | Resolution |
| --- | --- |
| `SCHEMA_INVALID` on `prompt_manager` | Check JSON payload—arguments must be arrays of objects with `name`, `required`, and optional validation keys. |
| Prompt edits ignored | Ensure `prompt_manager(action:"reload")` ran; watch logs for hot-reload confirmation. |
| Chain stuck at step N | Use `prompt_engine` with `force_restart:true` or inspect `runtime-state/chain-sessions.json` for corrupted sessions. |
| Framework not switching | `system_control(action:"switch_framework")` updates runtime-state; restart runtime if CLI session caches stale data. |

## Putting It Together — Prompt Iteration Flow

1. **Plan & author**: Follow the [Prompt & Template Authoring Guide](prompt-authoring-guide.md) to sketch your Markdown template + arguments.
2. **Create via MCP**:
   ```bash
   prompt_manager(action:"create", id:"ops_status_snapshot", category:"operations",
     user_message_template:"Summarize {{logs}}", arguments:[{"name":"logs","required":true}])
   ```
3. **Hot reload**: `prompt_manager(action:"reload")` confirms watchers rebuilt the registry.
4. **Test**: `prompt_engine >>ops_status_snapshot logs="Transport latency + gate status"` (add `api_validation:true` if you need gate review reminders).
5. **Adjust frameworks**: `system_control(action:"switch_framework", framework:"CAGEERF")` if this template should inherit structured analysis.
6. **Iterate**: Repeat steps 2-5, referencing this guide for command syntax, the [Chain Workflows Guide](chain-workflows.md) if you evolve it into a chain, and the [Enhanced Gate System](enhanced-gate-system.md) when adding validation.

This loop keeps everything inside the MCP conversation—no manual editing of Markdown files required.

## References

- Implementation: `server/dist/mcp-tools/**`
- Hot reload: `server/dist/prompts/file-observer.js`, `server/dist/prompts/hot-reload-manager.js`
- Chain sessions: `server/dist/chain-session/manager.js`
- Gate configuration: `server/dist/gates/core/gate-loader.js`

Use this guide as the single source of truth for MCP interactions; delete or ignore any legacy docs that describe direct filesystem workflows.
