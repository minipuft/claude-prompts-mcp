# MCP Tooling Guide

**Use this guide when** you want concrete MCP commands for creating prompts, executing templates/chains, or adjusting frameworks at runtime—without touching files manually.

**Before you start**: Make sure the server is running (see [Operations & Deployment Guide](operations-guide.md)). For Markdown structure and schema details, read the [Prompt & Template Authoring Guide](prompt-authoring-guide.md); for multi-step flows, keep the [Chain Workflows Guide](chain-workflows.md) nearby.

**Loop overview**
1. Edit prompts via `prompt_manager`.
2. Reload/inspect via MCP responses (hot reload handles file IO for you).
3. Execute via `prompt_engine` (with optional gates/frameworks or the `%judge` resource menu).
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

### The `>>` Prefix: LLM Hint & Automatic Normalization ✨

The `>>` prefix serves as a **hint to LLMs** that a command should be executed via MCP tools. The parser now **automatically normalizes** the prefix across all symbolic operators, making it entirely optional.

**How it works**:
- `>>` is automatically stripped from the start of commands and after all symbolic operators
- Original command is preserved in metadata for debugging
- Works consistently across chain (`-->`), framework (`@`), and gate (`::`) operators

**Examples** (all equivalent):
```bash
# With >> prefix (LLM-friendly hint)
prompt_engine(command:">> @react >>p1 --> >>p2 :: 'quality'")

# Without >> prefix (cleaner)
prompt_engine(command:"@react p1 --> p2 :: 'quality'")
```

**XML Encoding Note**: If you experience issues with `>>` being stripped to `>` in XML-based clients, the normalization system handles this gracefully—the parser accepts both forms.

### Recommended Syntax Patterns

**✅ Symbolic Operators** (with or without `>>` prefix):
```bash
# Chain operator - both work
prompt_engine(command:">>test_prompt input:'value' --> >>next_step")
prompt_engine(command:"test_prompt input:'value' --> next_step")

# Framework operator - both work
prompt_engine(command:">> @cageerf >>test_prompt input:'value'")
prompt_engine(command:"@cageerf test_prompt input:'value'")

# Mixed operators - both work
prompt_engine(command:">> @react >>p1 --> >>p2 :: 'quality'")
prompt_engine(command:"@react p1 --> p2 :: 'quality'")
```

**✅ JSON Format**:
```bash
prompt_engine(command:"{\"command\": \"test_prompt\", \"args\": {\"input\": \"value\"}}")
```

### Symbolic Operators Quick Reference

| Operator | Symbol | Example | Purpose | Status |
|----------|--------|---------|---------|--------|
| Chain | `-->` | `>>p1 --> >>p2 --> >>p3` | Sequential execution | ✅ Implemented |
| Framework | `@` | `>> @cageerf >>prompt` | Apply methodology | ✅ Implemented |
| Gate | `::` | `>>prompt :: "criteria"` | Quality validation | ✅ Implemented |
| Parallel | `+` | `>>task1 + >>task2` | Concurrent execution | 🔮 Reserved |
| Conditional | `?` | `>>p1 ? "cond" : >>p2` | Branch execution | 🔮 Reserved |

**Key insight**: The `>>` prefix is **automatically normalized** across all implemented operators. Parallel (`+`) and conditional (`?`) operators are reserved for future implementation.

### Inline Quality Criteria with `::` (Recommended) 🎯

The `::` operator lets you add validation criteria directly in your commands as natural language. This is the **simplest and most flexible** way to guide output quality without pre-defining gate structures.

**Basic Usage**:
```bash
# Single prompt with criteria
prompt_engine(command:"audit_plan topic:'security' :: 'cite two examples, list mitigations, flag open questions' --> ")

# Chain with criteria applied to all steps
prompt_engine(command:"analysis --> summary :: 'include sources, note confidence levels' --> ")

# Multiple criteria
prompt_engine(command:"code_review :: 'check naming conventions, verify error handling, confirm tests' --> ")
```

**Benefits**:
- **No setup required** - just add criteria as text
- **Flexible** - adjust criteria per execution
- **Natural language** - write criteria as you would explain them to a person
- **Applies to chains** - criteria automatically apply to all steps

**Examples by Use Case**:
```bash
# Documentation review
prompt_engine(command:"doc_review :: 'check for broken links, verify code examples, note outdated sections' --> ")

# Data analysis
prompt_engine(command:"data_analysis :: 'cite data sources, include confidence intervals, flag anomalies' --> ")

# Security audit
prompt_engine(command:"security_audit :: 'identify vulnerabilities, rate severity, suggest mitigations' --> ")

# Code generation
prompt_engine(command:"generate_api :: 'include error handling, add input validation, write tests' --> ")
```

**Advanced**: For complex reusable validation scenarios, use the unified `gates` parameter (see below).

### Unified Gate Specification with `gates` Parameter 🎯

The `gates` parameter provides a **unified interface** for all gate specifications, replacing the previous separate parameters (`quality_gates`, `custom_checks`, `temporary_gates`). This simplification reduces API surface area while maintaining full flexibility.

**Why Unified Gates?**
- **Single parameter** instead of three separate ones
- **Mixed types** - combine gate IDs, custom checks, and full definitions in one array
- **Cleaner API** - easier to understand and use
- **Backward compatible** - old parameters still work (with deprecation warnings)

**Basic Usage**:
```bash
# Gate IDs (canonical gates)
prompt_engine(command:"analysis --> ", gates:["technical-accuracy", "research-quality"])

# Custom checks (inline validation criteria)
prompt_engine(command:"code_review --> ", gates:[
  {"name": "Test Coverage", "description": "Ensure all functions have unit tests"},
  {"name": "Error Handling", "description": "Verify proper error handling"}
])

# Mixed types (the real power!)
prompt_engine(command:"security_audit --> ", gates:[
  "security-awareness",  // Canonical gate ID
  {"name": "OWASP Compliance", "description": "Check against OWASP Top 10"},  // Custom check
  {"id": "gdpr-check", "criteria": ["No PII in logs"], "severity": "high"}  // Full gate definition
])
```

**Migration Examples**:
```bash
# OLD (deprecated - still works with warnings):
prompt_engine(
  command:"analysis --> ",
  quality_gates:["technical-accuracy"],
  custom_checks:[{"name": "Sources", "description": "Cite sources"}],
  temporary_gates:[{"id": "temp", "criteria": ["Check refs"]}]
)

# NEW (recommended):
prompt_engine(
  command:"analysis --> ",
  gates:[
    "technical-accuracy",  // Was quality_gates
    {"name": "Sources", "description": "Cite sources"},  // Was custom_checks
    {"id": "temp", "criteria": ["Check refs"]}  // Was temporary_gates
  ]
)
```

**Step-Targeted Gates** (for chains):
```bash
# Apply gate only to step 2
prompt_engine(
  command:"step1 --> step2 --> step3",
  gates:[
    {"name": "Step 2 Validation", "target_step_number": 2, "criteria": ["Verify step 2 output"]}
  ]
)

# Apply gate to multiple specific steps
prompt_engine(
  command:"step1 --> step2 --> step3",
  gates:[
    {"name": "Critical Steps", "apply_to_steps": [1, 3], "criteria": ["Extra validation"]}
  ]
)
```

**Benefits**:
- **Type safety** - Zod schema validates the union type (string | CustomCheck | TemporaryGateInput)
- **Normalization** - Automatically converted to standard format internally
- **Deduplication** - Duplicate gate IDs are filtered out
- **Flexibility** - Mix and match gate types as needed

**For more details**, see:
- Gate configuration: `docs/enhanced-gate-system.md`
- Prompt authoring: `docs/prompt-authoring-guide.md`

## Judge Menu (`%judge`) for Guided Selection ✨

The judge phase is now built into the pipeline. Add `%judge` (alias `%guided`) to a `prompt_engine` command to get a menu of frameworks, response styles, and quality gates. If a framework is already active, the judge instructions come from its `judge-prompt.md` in `server/methodologies/<framework>/`.

### How it Works
1. **Trigger**: Run `prompt_engine(command:"%judge >>my_prompt arg='value'")`.
2. **Menu**: The server gathers available guidance styles, methodology frameworks, and gate definitions and returns a judge response with inline operator instructions.
3. **Apply**: Rerun `prompt_engine` *without* `%judge` using inline operators the judge recommended: `@Framework`, `:: gate-id`, `#style(<id>)`.

### Available Guidance Resources
- Response styles: `guidance/analytical.md`, `guidance/procedural.md`, `guidance/creative.md`, `guidance/reasoning.md`
- Methodology frameworks: sourced directly from `server/methodologies/*/methodology.yaml` (names/descriptions/enablement)
- Quality gates: discovered from `src/gates/definitions`

### Usage Example
```bash
# Phase 1: request a judge menu
prompt_engine(command:"%judge >>docs-final-assembly")

# Phase 2: apply selections (example)
prompt_engine(command:">>docs-final-assembly @CAGEERF #style(analytical) :: framework-compliance")
```

### Benefits
- **Framework-aware**: judge instructions are pulled from methodology definitions when active.
- **Hot-reloadable**: guidance remains in Markdown and gate definitions; no prompt ID needed.
- **Focused**: judge phase stops early with a menu; follow-up call runs the actual prompt.

---

## `prompt_manager` — Lifecycle Operations

<!-- prompt_manager.params:start -->

| Name | Type | Status | Required | Description |
| --- | --- | --- | --- | --- |
| `action` | enum[create\|update\|delete\|reload\|list\|inspect\|analyze_type\|analyze_gates\|guide] | working | yes | The operation to perform: create (new prompt), update (modify existing), delete (remove), list (discover IDs), inspect (view details), analyze_type/analyze_gates (get recommendations), reload (refresh from disk), guide (get action suggestions). Single-shot operations; chain multiple calls when sequencing edits or reloads. Required fields per action: create (id, name, description, user_message_template, optional arguments/chain_steps), update (id + section/section_content or fields), delete (id + confirm), reload (reason optional), list/inspect/analyze/guide use filters/detail as needed. |
| `arguments` | array<{name,required?,description?,type?}> | working | no | Prompt arguments metadata (create/update). |
| `category` | string | working | no | Category tag (create/update). |
| `chain_steps` | array<step> | working | no | Chain steps definition (create/update for chains). |
| `confirm` | boolean | working | no | Safety confirmation (delete). |
| `description` | string | working | no | Prompt description (create/update). |
| `detail` | enum[summary\|full] | working | no | Inspect detail level. |
| `execution_hint` | enum[single\|chain] | working | no | Hint for execution type on creation. |
| `filter` | string | working | no | List filter query (list action). |
| `format` | enum[table\|json\|text] | working | no | Output format for list/inspect. |
| `id` | string | working | no | Prompt identifier (required for most actions). |
| `name` | string | working | no | Human-friendly name (create/update). |
| `reason` | string | working | no | Audit reason (reload/delete). |
| `section` | enum[name\|description\|system_message\|user_message_template\|arguments\|chain_steps] | working | no | Targeted update section. |
| `section_content` | string | working | no | Content for targeted section updates. |
| `system_message` | string | working | no | Optional system message (create/update). |
| `user_message_template` | string | working | no | Prompt body/template (create/update). |

<!-- prompt_manager.params:end -->

### Listing & Filtering

```bash
prompt_manager(action:"list")
prompt_manager(action:"list", filter:"category:analysis type:template")
prompt_manager(action:"list", filter:"intent:refactor state:published")
```

The filter DSL accepts `category`, `type`, `intent`, `confidence`, and free-text search terms. Results include lifecycle metadata (execution path, file path, arguments) and note any default `%` modifiers.

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

- `create` auto-detects single vs chain based on `execution_hint` + structure and applies `%` modifiers from metadata when present.
- Use `create_prompt` or `create_template` for explicit control.
- Provide descriptive IDs (snake_case) to match filenames under `server/prompts/**`.

### Updating Prompts

```bash
prompt_manager(action:"update", id:"analysis_report",
  description:"Updated description",
  arguments=[{"name":"content","required":true}])
```

- `update` is idempotent—send only the fields you need to change and the manager preserves the rest.
- Schema validation (Zod) runs before touching disk; errors return `SCHEMA_*` codes.

### Chains & Advanced Actions

- `prompt_manager(action:"create", execution_hint:"chain", chain_steps=[...])`
_Deprecated_: `migrate_type` has been removed; use unified `create`/`update` with execution modifiers instead.

### Execution Modifiers (`%`)

Use `%` prefixes to control framework and gate behavior for single-step runs:
- `%clean` — no framework, no gates (minimal).
- `%guided` — framework + gates (full guidance).
- `%lean` — gates only, no framework guidance.
- `%framework` — framework guidance only, no gates.

**Preferred for runtime control**: Use `%` modifiers instead of `framework_gates` parameter. The `framework_gates` parameter is for template-level defaults only.

#### Understanding Framework Injection Frequency

Framework methodology guidance is injected **once per prompt execution**—not on every message or continuously throughout a conversation. Each `prompt_engine` call independently evaluates whether to include the methodology reminder based on your modifier and system settings.

**You control the frequency**: Since guidance is per-execution, you decide how often you want the methodology reminder by choosing when to include it:

| Scenario | Approach |
|----------|----------|
| First prompt in a session | Use `@Framework` or `%guided` to set the thinking pattern |
| Follow-up prompts in same context | Use `%clean` to skip redundant guidance |
| Switching methodologies | Use `@NewFramework` to inject the new methodology |
| Quick iterations | Use `%clean` for minimal overhead |

**Example workflow:**
```bash
# Start with full methodology guidance
prompt_engine(command:"@CAGEERF %guided analysis topic:'Q4 metrics'")

# Follow-up without redundant guidance (methodology already established)
prompt_engine(command:"%clean refine_analysis data:'updated figures'")

# Later, switch to a different methodology
prompt_engine(command:"@ReACT problem_solving issue:'performance bottleneck'")
```

**Key insight**: The framework guidance serves as a structured thinking reminder—inject it when starting new analytical work or switching approaches, skip it for follow-up prompts where the methodology is already established.

Examples:
- `prompt_engine(command:"%clean my_prompt input:'text'")`
- `prompt_engine(command:"%guided audit_plan topic:'api' --> ")`
- `prompt_manager(action:"analyze_type", id:"analysis_report")`
- `prompt_manager(action:"reload", reason:"synced after edits")`

### Safe Deletions

```bash
prompt_manager(action:"delete", id:"unused_prompt", confirm=true)
```

Deletes remove Markdown + JSON references and trigger a hot reload. Keep backups via Git before running destructive operations.

## `prompt_engine` — Unified Execution

<!-- prompt_engine.params:start -->

| Name | Type | Status | Required | Description |
| --- | --- | --- | --- | --- |
| `chain_id` | string | working | no | Resume token (chain-{prompt} or chain-{prompt}#runNumber). RESUME: chain_id + user_response only. Omit command. RESUME WORKFLOW: Provide chain_id + user_response (or gate_verdict). Do NOT re-send command parameter. Preferred resume path. Use with user_response or gate_verdict. |
| `command` | string | working | no | Prompt ID to expand with optional arguments. Format: >>prompt_id key="value".

Chains: >>step1 --> >>step2 (N-1 arrows for N steps).
Modifiers (place before ID): @Framework \| :: "criteria" \| %clean/%lean.

Do NOT invent IDs - use prompt_manager(action:"list") to discover valid prompts. Operators: `-->` chain, `@` framework, `::` gates, `#style(<id>)` style, `%judge` menu; `%clean`/`%lean` disable framework injection. Modifiers belong at the front and apply to the whole chain. Every chain step must start with a prompt id prefix (`>>` or `/`). Plain text step labels are invalid; use prompt_manager(list/inspect) to find valid ids instead of fabricating them. Free text belongs after the prompt id, quoted ("...") or as key:value pairs. Avoid unquoted bare strings that look like prompt names. Two request shapes: execute (`command` required, optional gates/options); resume (`chain_id` with user_response and/or gate_verdict/gate_action, command optional). Chaining runs all steps back-to-back; issue separate calls if you need to pause between phases. |
| `force_restart` | boolean | working | no | Restart chain from step 1, ignoring cached state. |
| `gate_action` | enum | working | no | User choice after gate retry limit exhaustion. 'retry' resets attempt count for another try, 'skip' bypasses the failed gate and continues, 'abort' stops chain execution entirely. Only effective when gate retry limit is exceeded (default: 2 attempts) Use with chain_id to specify which chain session to apply the action to Blocking gates prompt for this choice; advisory/informational gates auto-continue |
| `gate_verdict` | string | working | no | Gate review verdict with flexible format support. Primary: 'GATE_REVIEW: PASS\|FAIL - reason'. Also accepts: 'GATE PASS - reason', 'GATE_REVIEW: FAIL: reason', 'PASS - reason' (minimal). Multiple format variants supported (v3.1+) Case-insensitive matching with hyphen or colon separators Rationale required for all verdicts Takes precedence over verdicts parsed from user_response Minimal format ('PASS - reason') only accepted via this parameter, not from user_response |
| `gates` | array<string\|{name,description}\|gate> | working | no | Quality gates for output validation. Three formats supported:

**1. Registered IDs** (strings): Use predefined gates like 'code-quality', 'research-quality'.

**2. Quick Gates** (RECOMMENDED for LLM-generated validation): `{name, description}` - Create named, domain-specific checks on the fly. Example: `{name: 'Source Quality', description: 'All sources must be official docs'}`.

**3. Full Definitions**: Complete schema with severity, criteria[], pass_criteria[], guidance for production workflows. RECOMMENDED: Use Quick Gates `{name, description}` when dynamically creating validation - simple to generate, properly named in output. Quick Gates auto-default to severity:medium, type:validation, scope:execution. Full schema supports: id, name, description, severity (critical\|high\|medium\|low), type, scope, criteria[], pass_criteria[], guidance, apply_to_steps[]. Supports mixed types in single array for maximum flexibility. Step-targeted gates: Use target_step_number or apply_to_steps in full gate definitions. |
| `llm_validation` | boolean | **experimental** | no | Experimental: Advanced LLM-based semantic validation for prompt quality. Currently blocked pending architectural design. Reserved for future implementation of semantic validation features. Currently blocked by validator with migration guidance. May be reintroduced in future version with enhanced gate architecture. Status: Experimental (under development, not yet functional). |
| `options` | record | working | no | Execution options forwarded downstream. |
| `user_response` | string | working | no | Your completed output from executing the previous step. Paste your work here when resuming a chain. Use with chain_id; do not include command when resuming. |

<!-- prompt_engine.params:end -->

### Basic Invocation

```bash
# Recommended: Use chain operator (even for single prompts)
prompt_engine(command:"analysis_report content:'Quarterly metrics' --> ")

# Alternative: Use JSON format
prompt_engine(command:"{\"command\": \"analysis_report\", \"args\": {\"content\": \"Quarterly metrics\"}}")

# With framework
prompt_engine(command:"@CAGEERF analysis_report content:'Quarterly metrics'")
```

**Judge Menu Example**:
```bash
# Ask the judge for guidance selections
prompt_engine(command:"%judge >>my_marketing_prompt topic:'Q4 ideas'")

# Apply the recommended operators from the judge response
prompt_engine(command:">>my_marketing_prompt @ReACT #style(creative) :: framework-compliance")
```
- The judge phase returns a menu and exits early; rerun without `%judge` to execute the prompt with the suggested framework, style, and gates.

- The engine inspects the command and prompt metadata to pick the right path automatically. `%clean`, `%guided`, `%lean`, and `%framework` control framework/gate behavior without extra parameters.
- `execution_mode` is still accepted for compatibility (values: `auto`, `single`, `chain`) but is rarely needed—omit it unless you must force a mode for debugging.
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
- If you accidentally send the chain ID as `command` alongside `user_response` or `gate_verdict`, the runtime normalizes it into `chain_id` so the resume still succeeds.

**Advanced options**:
- Query parameters: `force_restart=true`, `framework=ReACT`, `conditional_mode=true`, `max_retries=5`
- The archival `session_id` lives in runtime-state only and never needs to be sent back
- Step metadata includes dependencies, conditional expressions, and gate IDs—mirror the JSON definitions under `server/prompts/**`

### Gate Reviews

- Send gate verdicts with the dedicated `gate_verdict:"GATE_REVIEW: PASS|FAIL - reason"` parameter whenever Stage 5 pauses a run. Keep `user_response` for actual step output.
- Chains automatically trigger gates on steps marked with `inlineGateIds`.

#### Enhanced Gate Verdict Formats (v3.1+)

The system now supports **flexible verdict formats** for improved usability:

**Supported Formats** (all case-insensitive with `-` or `:` separators):

| Format | Example | Use Case |
|--------|---------|----------|
| Full (primary) | `GATE_REVIEW: PASS - reason` | Backward compatible, explicit |
| Full + colon | `GATE_REVIEW: FAIL: reason` | Alternative separator |
| Simplified | `GATE PASS - reason` | Natural language |
| Simplified + colon | `GATE FAIL: reason` | Concise |
| Minimal | `PASS - reason` | gate_verdict param only* |

*Minimal format only accepted via `gate_verdict` parameter, not parsed from `user_response` (prevents false positives).

**Requirements**:
- ✅ **Rationale required**: All verdicts must include explanation
- ✅ **Precedence**: `gate_verdict` parameter > parsed `user_response`
- ✅ **Auto-extraction**: Verdict in `user_response` is NOT also used as step output

**Examples**:

```json
// Method 1: Dedicated parameter (cleanest)
{
  "chain_id": "chain-test#2",
  "gate_verdict": "GATE PASS - All criteria met",
  "user_response": "Actual step 2 output..."
}

// Method 2: Natural language (LLM-friendly)
{
  "chain_id": "chain-test#2",
  "user_response": "GATE_REVIEW: PASS - Looks good!\n\nStep 2 analysis complete..."
}
```

### Diagnostics

- `prompt_engine(command:">>prompt_id", debug=true)` surfaces parsing + framework traces.
- Errors provide remediation URIs when available (e.g., `chain://...&force_restart=true`).

## `system_control` — Runtime Administration

<!-- system_control.params:start -->

| Name | Type | Status | Required | Description |
| --- | --- | --- | --- | --- |
| `action` | enum[status\|framework\|gates\|analytics\|config\|maintenance\|guide\|injection] | working | yes | The operation to perform: status (runtime overview), framework (switch/enable/disable methodologies), gates (manage quality gates), analytics (usage metrics), config (view/modify settings), maintenance (restart), guide (get recommendations). Single-call operations; sequence multiple admin steps with separate requests. |
| `framework` | string | working | no | Target framework for switch operations (CAGEERF, ReACT, 5W1H, SCAMPER). |
| `include_history` | boolean | working | no | Include recorded history where supported. |
| `operation` | string | working | no | Sub-command for the selected action (e.g., framework switch/list/enable/disable; gates enable/disable/status/health/list). |
| `persist` | boolean | working | no | When true, gate/framework enable/disable changes are also written to config.json. Applies to gate operations (enable/disable) and framework system enable/disable. Uses SafeConfigWriter; falls back to runtime-only if unavailable. |
| `reason` | string | working | no | Audit reason for framework/gate toggles or admin actions. |
| `show_details` | boolean | working | no | Include detailed output (status/analytics/framework/gate reports). |
| `topic` | string | working | no | Guide topic when requesting guidance. |

<!-- system_control.params:end -->

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
   2. `prompt_manager(action:"update", id:"notes", chain_steps=[...])`
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
4. **Test**: `prompt_engine >>ops_status_snapshot logs="Transport latency + gate status"`.
5. **Adjust frameworks**: `system_control(action:"switch_framework", framework:"CAGEERF")` if this template should inherit structured analysis.
6. **Iterate**: Repeat steps 2-5, referencing this guide for command syntax, the [Chain Workflows Guide](chain-workflows.md) if you evolve it into a chain, and the [Enhanced Gate System](enhanced-gate-system.md) when adding validation.

This loop keeps everything inside the MCP conversation—no manual editing of Markdown files required.

## References

- Implementation: `server/dist/mcp-tools/**`
- Hot reload: `server/dist/prompts/file-observer.js`, `server/dist/prompts/hot-reload-manager.js`
- Chain sessions: `server/dist/chain-session/manager.js`
- Gate configuration: `server/dist/gates/core/gate-loader.js`

Use this guide as the single source of truth for MCP interactions; delete or ignore any legacy docs that describe direct filesystem workflows.
