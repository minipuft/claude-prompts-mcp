# MCP Tooling Guide

> Status: canonical

Control prompts, chains, and frameworks entirely through MCP tool calls.

Stop copy-pasting prompt templates. This guide shows you how to create, execute, and iterate on prompts without touching files—the server hot-reloads everything automatically.

---

## Quick Start

```bash
# List available prompts
resource_manager(resource_type:"prompt", action:"list")

# Execute a prompt with arguments
prompt_engine(command:"@CAGEERF analysis_report content:'Q4 metrics'")

# Chain two prompts together
prompt_engine(command:"research topic:'AI safety' --> summary")

# Check server status
system_control(action:"status")

# Create a gate
resource_manager(resource_type:"gate", action:"create", id:"my-gate", guidance:"...")

# Switch methodology
resource_manager(resource_type:"methodology", action:"switch", id:"cageerf")
```

**That's it.** Three tools, one syntax. Everything below is details.

---

## The Three Tools

| Tool               | What It Does                                       | When to Use            |
| ------------------ | -------------------------------------------------- | ---------------------- |
| `resource_manager` | Unified CRUD for prompts, gates, and methodologies | Managing all resources |
| `prompt_engine`    | Execute prompts with frameworks and gates          | Running prompts        |
| `system_control`   | View status, analytics, check health               | Admin operations       |

> **Migrating from v1.x?** See [Migration Guide](#migration-guide) for transitioning from the legacy `prompt_manager`, `gate_manager`, and `framework_manager` tools to the unified `resource_manager`.

---

## `prompt_engine` — Execute Prompts

The workhorse. Takes a command, resolves the prompt, applies frameworks/gates, returns structured instructions.

### Command Syntax

```bash
prompt_engine(command:"[modifiers] [framework] prompt_id [args] [gates]")
```

**Real examples:**

```bash
# Simple prompt execution
prompt_engine(command:"code_review file:'api.ts'")

# With framework methodology
prompt_engine(command:"@CAGEERF security_audit target:'auth module'")

# With inline quality gates
prompt_engine(command:"research topic:'LLMs' :: 'cite sources, note confidence'")

# Full chain with everything
prompt_engine(command:"@ReACT analysis --> synthesis --> report :: 'include data'")
```

### Operators Quick Reference

| Operator     | Syntax         | Example                    | Purpose                      |
| ------------ | -------------- | -------------------------- | ---------------------------- |
| Framework    | `@NAME`        | `@CAGEERF prompt`          | Apply methodology            |
| Chain        | `-->`          | `step1 --> step2`          | Sequential execution         |
| Repetition   | `* N`          | `>>prompt * 3`             | Chain shorthand (repeat N×)  |
| Gate (anon)  | `:: "text"`    | `:: 'cite sources'`        | Anonymous quality criteria   |
| Gate (named) | `:: id:"text"` | `:: security:"no secrets"` | Named gate with trackable ID |
| Style        | `#id`          | `#analytical`              | Response formatting          |

**Repetition examples:**

```bash
# Run brainstorm 5 times for diverse ideas
prompt_engine(command:">>brainstorm * 5 topic:'startup ideas'")

# Repeat step1 twice, then chain to step2
prompt_engine(command:">>analyze * 2 --> >>summarize")

# Execute implementation prompt for each phase in a plan
prompt_engine(command:">>strategicImplement * 3 plan_path:'./plan.md'")
```

**Style examples:**

```bash
# Apply analytical style to a report
prompt_engine(command:"#analytical report topic:'Q4 metrics'")

# Combine style with framework
prompt_engine(command:"#procedural @CAGEERF tutorial subject:'React hooks'")

# Available styles: analytical, procedural, creative, reasoning
```

### Modifiers (Put First)

| Modifier     | Effect                            |
| ------------ | --------------------------------- |
| `%clean`     | No framework/gate injection       |
| `%lean`      | Gates only, skip framework        |
| `%judge`     | Show guidance menu, don't execute |
| `%framework` | Framework only, skip gates        |

```bash
# Skip all injection for quick iteration
prompt_engine(command:"%clean my_prompt input:'test'")

# Get framework/gate recommendations without executing
prompt_engine(command:"%judge analysis_report")
```

### Parameters

| Parameter       | Type    | Purpose                                                |
| --------------- | ------- | ------------------------------------------------------ |
| `command`       | string  | Prompt ID with operators and arguments                 |
| `chain_id`      | string  | Resume token for continuing chains                     |
| `user_response` | string  | Your output from previous step (for chain resume)      |
| `gate_verdict`  | string  | Gate review verdict. Preferred: `GATE_REVIEW: PASS/FAIL - reason`. Also accepts `GATE PASS/FAIL - reason` or minimal `PASS/FAIL - reason` (minimal only via `gate_verdict`, not parsed from `user_response`). Rationale required. |
| `gate_action`   | enum    | `retry`, `skip`, or `abort` after gate failure         |
| `gates`         | array   | Quality gates (IDs, quick checks, or full definitions) |
| `force_restart` | boolean | Restart chain from step 1                              |

### Chain Execution

For step schemas, conditional branching, and parallel execution patterns, see the [Chain Schema Reference](../reference/chain-schema.md).

**Start a chain:**

```bash
prompt_engine(command:"research topic:'security' --> analysis --> recommendations")
```

**Resume a chain** (after completing a step):

```bash
prompt_engine(
  chain_id:"chain-research#2",
  user_response:"Step 1 complete. Key findings: ..."
)
```

**Handle gate reviews:**

```bash
prompt_engine(
  chain_id:"chain-research#2",
  gate_verdict:"GATE_REVIEW: PASS - All sources cited"
)

**Combined resume (recommended for token efficiency):**

```bash
prompt_engine(
  chain_id:"chain-research#2",
  user_response:"Step 2 output...",
  gate_verdict:"GATE_REVIEW: PASS - criteria met"
)
```

Notes:
- Verdicts are only read from `gate_verdict`; they are not parsed from `user_response`.
- On PASS without an existing review, the chain continues; on FAIL, a review screen is created with context. Use `gate_action:"retry|skip|abort"` when retries are exhausted.
```

### Gates: Four Ways to Validate

For gate configuration, enforcement modes, and custom definitions, see the [Gate Configuration Reference](../reference/gate-configuration.md).

```bash
# 1. Anonymous inline criteria (simplest)
prompt_engine(command:"report :: 'cite sources, include confidence levels'")

# 2. Named inline gates (with trackable IDs)
prompt_engine(command:"code_review :: security:'no secrets' :: perf:'O(n) or better'")
# Creates gates with IDs "security" and "perf" for tracking in output

# 3. Registered gate IDs
prompt_engine(command:"analysis", gates:["technical-accuracy", "research-quality"])

# 4. Quick gates (recommended for dynamic validation)
prompt_engine(command:"code_review", gates:[
  {"name": "Test Coverage", "description": "All functions have unit tests"},
  {"name": "Error Handling", "description": "Proper try/catch patterns"}
])
```

**Named inline gates** (`:: id:"criteria"`) are useful when you want:

- Trackable gate IDs in output (shows as "security" not "Inline Validation Criteria")
- Multiple distinct validation criteria in one command
- Self-documenting commands that LLMs can parse unambiguously

### Shell Verification Gates (Ralph Mode)

Ground-truth validation via shell command exit codes. Exit 0 = PASS, non-zero = FAIL.

```bash
# Basic verification
prompt_engine(command:">>implement :: verify:'npm test'")

# With preset (controls retry limits)
prompt_engine(command:">>fix-bug :: verify:'pytest' :full")

# Presets: :fast (1 attempt), :full (5), :extended (10)
prompt_engine(command:">>refactor :: verify:'cargo test' :extended")

# Explicit options override presets
prompt_engine(command:">>feature :: verify:'npm test' max:8 timeout:120")

# Autonomous loop (Stop hook integration)
prompt_engine(command:">>bugfix :: verify:'npm test' :full loop:true")
```

**How it works:**

1. Command runs after each response
2. If FAIL + attempts remain → bounce-back (Claude retries automatically)
3. If FAIL + max reached → escalation (user chooses `retry`/`skip`/`abort` via `gate_action`)
4. With `loop:true` → Stop hook blocks completion until tests pass

**Presets:**

| Preset      | Attempts | Timeout |
| ----------- | -------- | ------- |
| `:fast`     | 1        | 30s     |
| `:full`     | 5        | 5 min   |
| `:extended` | 10       | 10 min  |

**Options:**

| Option    | Description                                   |
| --------- | --------------------------------------------- |
| `max:N`   | Override max attempts                         |
| `timeout:N` | Override timeout in seconds                 |
| `loop:true` | Enable autonomous Stop hook integration     |

See [Ralph Loops Guide](../guides/ralph-loops.md) for advanced patterns including context isolation and checkpoints.

### Built-in Commands

These work without defining prompts:

```bash
prompt_engine(command:">>listprompts")     # List all prompts
prompt_engine(command:">>help")            # Show help
prompt_engine(command:">>status")          # Server status
prompt_engine(command:">>gates")           # List canonical gates
prompt_engine(command:">>gates security")  # Search gates by keyword
prompt_engine(command:">>guide gates")     # Gate syntax reference
```

### Script Tool Execution

Prompts can include script tools that auto-trigger when user args match the tool's JSON schema. This enables wizard-style meta-prompts.

**Two-Phase UX:**

| Phase            | What Happens                                         | Example                                                                                   |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Design**       | Args don't match schema → Template shows guidance    | `>>create_gate name:"Code Quality"`                                                       |
| **Validation**   | Args match schema → Script runs, results in template | `>>create_gate id:"code-quality" name:"Code Quality" type:"validation" description:"..."` |
| **Auto-Execute** | Script returns `valid: true` → MCP tool called       | Creates gate via `resource_manager`                                                       |

**Design phase** (missing required fields — shows guidance):

```bash
prompt_engine(command:">>create_gate name:'Code Quality'")
# Result: Template renders design guidance with field descriptions
```

**Validation phase** (all required fields — script runs):

```bash
prompt_engine(command:">>create_gate id:'code-quality' name:'Code Quality' type:'validation' description:'Ensures code meets standards' guidance:'Check naming, error handling, tests'")
# Result: Script validates → returns {valid: true, auto_execute: {...}} → gate created
```

**Available meta-prompts:**

- `>>create_gate` — Quality gate authoring
- `>>create_prompt` — Prompt/chain authoring
- `>>create_methodology` — Framework authoring

See [Script Tools Guide](../guides/script-tools.md) for building your own.

---

## `resource_manager` — Unified Resource Management

Create, update, delete, and manage prompts, gates, and methodologies through a single unified interface.

### Basic Syntax

```bash
resource_manager(resource_type:"prompt|gate|methodology", action:"...", ...)
```

### Resource Types

| Type          | Description                   | Specific Actions                         |
| ------------- | ----------------------------- | ---------------------------------------- |
| `prompt`      | Template and chain management | `analyze_type`, `analyze_gates`, `guide` |
| `gate`        | Quality validation criteria   | —                                        |
| `methodology` | Execution frameworks          | `switch`                                 |

### Common Actions

All resource types support these actions:

| Action     | Purpose                  | Required Params                    |
| ---------- | ------------------------ | ---------------------------------- |
| `list`     | List all resources       | —                                  |
| `inspect`  | Get resource details     | `id`                               |
| `create`   | Create new resource      | `id`, type-specific                |
| `update`   | Modify existing resource | `id`, fields to update             |
| `delete`   | Remove resource          | `id`, `confirm:true`               |
| `reload`   | Hot-reload from disk     | `id` (optional)                    |
| `history`  | View version history     | `id`                               |
| `rollback` | Restore previous version | `id`, `version`, `confirm:true`    |
| `compare`  | Compare two versions     | `id`, `from_version`, `to_version` |

### Prompts

```bash
# List all prompts
resource_manager(resource_type:"prompt", action:"list")

# Filter by category
resource_manager(resource_type:"prompt", action:"list", filter:"category:analysis")

# Get prompt details
resource_manager(resource_type:"prompt", action:"inspect", id:"security_audit")

# Create a prompt
resource_manager(
  resource_type:"prompt",
  action:"create",
  id:"weekly_report",
  name:"Weekly Report Generator",
  category:"reporting",
  description:"Generates formatted weekly status report",
  user_message_template:"Generate a weekly report for {{team}} covering {{date_range}}",
  arguments:[
    {"name":"team", "required":true},
    {"name":"date_range", "required":true}
  ]
)

# Update a prompt
resource_manager(resource_type:"prompt", action:"update", id:"weekly_report", description:"Updated")

# Delete a prompt
resource_manager(resource_type:"prompt", action:"delete", id:"old_prompt", confirm:true)

# Get execution type recommendation
resource_manager(resource_type:"prompt", action:"analyze_type", id:"my_prompt")

# Get gate suggestions
resource_manager(resource_type:"prompt", action:"analyze_gates", id:"my_prompt")
```

### Gates

```bash
# List all gates
resource_manager(resource_type:"gate", action:"list")

# Create a gate
resource_manager(
  resource_type:"gate",
  action:"create",
  id:"source-verification",
  name:"Source Verification",
  gate_type:"validation",
  description:"Ensures all claims are properly sourced",
  guidance:"All factual claims must cite sources. No unsourced statistics.",
  pass_criteria:["All claims have citations", "Sources are authoritative"]
)

# Update a gate
resource_manager(resource_type:"gate", action:"update", id:"source-verification", guidance:"Updated guidance...")

# Delete a gate
resource_manager(resource_type:"gate", action:"delete", id:"old-gate", confirm:true)
```

### Methodologies

```bash
# List all methodologies
resource_manager(resource_type:"methodology", action:"list")

# Inspect a methodology
resource_manager(resource_type:"methodology", action:"inspect", id:"cageerf")

# Switch active methodology
resource_manager(resource_type:"methodology", action:"switch", id:"react", persist:true)

# Create a custom methodology
resource_manager(
  resource_type:"methodology",
  action:"create",
  id:"my-method",
  name:"My Custom Methodology",
  description:"A custom problem-solving framework",
  system_prompt_guidance:"Apply my methodology systematically...",
  phases:[
    {"id":"phase1", "name":"Define", "description":"Define the problem"},
    {"id":"phase2", "name":"Solve", "description":"Implement solution"}
  ]
)
```

### Key Parameters by Resource Type

**Prompt Parameters:**

| Parameter               | Purpose                                  |
| ----------------------- | ---------------------------------------- |
| `category`              | Prompt category tag                      |
| `user_message_template` | Prompt body with `{{variables}}`         |
| `system_message`        | Optional system message                  |
| `arguments`             | Array of `{name, required, description}` |
| `chain_steps`           | Chain step definitions                   |
| `gate_configuration`    | Gate include/exclude lists               |

**Gate Parameters:**

| Parameter       | Purpose                                           |
| --------------- | ------------------------------------------------- |
| `gate_type`     | `validation` (pass/fail) or `guidance` (advisory) |
| `guidance`      | Gate criteria content                             |
| `pass_criteria` | Array of success conditions                       |
| `activation`    | When gate activates (categories, frameworks)      |

**Methodology Parameters:**

| Parameter                | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `system_prompt_guidance` | Injected guidance content                   |
| `phases`                 | Array of phase definitions                  |
| `gates`                  | Gate include/exclude configuration          |
| `persist`                | Save switch to config (for `switch` action) |

---

## `system_control` — Admin Operations

Runtime configuration and monitoring.

```bash
# Server health check
system_control(action:"status")

# List available frameworks
system_control(action:"framework", operation:"list")

# Switch active framework
system_control(action:"framework", operation:"switch", framework:"ReACT")

# View execution analytics
system_control(action:"analytics", show_details:true)

# List available gates
system_control(action:"gates", operation:"list")
```

### Actions

| Action      | Operations                            | Purpose                |
| ----------- | ------------------------------------- | ---------------------- |
| `status`    | —                                     | Runtime overview       |
| `framework` | `list`, `switch`, `enable`, `disable` | Methodology management |
| `gates`     | `list`, `enable`, `disable`, `status` | Gate management        |
| `analytics` | —                                     | Execution metrics      |
| `config`    | —                                     | View config overlays   |

---

## Injection Control

The server injects guidance into prompts. Control this per-execution or globally.

### Three Injection Types

| Type             | What It Adds          | Default         |
| ---------------- | --------------------- | --------------- |
| `system-prompt`  | Framework methodology | Every 2 steps   |
| `gate-guidance`  | Quality criteria      | Every step      |
| `style-guidance` | Response formatting   | First step only |

### Quick Control with Modifiers

```bash
# Full injection (default for new analysis)
prompt_engine(command:"%guided @CAGEERF audit_plan topic:'security'")

# No injection (follow-up in same context)
prompt_engine(command:"%clean next_step input:'data'")

# Gates only (skip framework reminder)
prompt_engine(command:"%lean code_review file:'api.ts'")
```

### Config-Based Control

```json
{
  "injection": {
    "system-prompt": {
      "enabled": true,
      "frequency": {"mode": "every", "interval": 2}
    },
    "gate-guidance": {
      "enabled": true,
      "frequency": {"mode": "every", "interval": 1}
    }
  }
}
```

---

## Gate Verdict Formats

When a chain pauses for gate review, respond with a verdict:

```bash
prompt_engine(
  chain_id:"chain-analysis#2",
  gate_verdict:"GATE_REVIEW: PASS - All criteria met"
)
```

**Accepted formats** (case-insensitive):

| Format       | Example                      |
| ------------ | ---------------------------- |
| Full         | `GATE_REVIEW: PASS - reason` |
| Full (colon) | `GATE_REVIEW: FAIL: reason`  |
| Simplified   | `GATE PASS - reason`         |
| Minimal*     | `PASS - reason`              |

*Minimal format only works via `gate_verdict` parameter, not in `user_response`.

**Requirements:**

- Rationale is always required
- `gate_verdict` takes precedence over parsed `user_response`

---

## Troubleshooting

| Problem                 | Fix                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Prompt not found        | Run `resource_manager(resource_type:"prompt", action:"list")` to see available IDs |
| Edits not showing       | Run `resource_manager(resource_type:"prompt", action:"reload")`                    |
| Chain stuck             | Use `force_restart:true` or check `runtime-state/chain-sessions.json`              |
| Framework not switching | Use `resource_manager(resource_type:"methodology", action:"switch")`               |
| Gate keeps failing      | Use `gate_action:"skip"` to bypass, or `gate_action:"retry"`                       |

---

## Common Workflows

### Create and Test a New Prompt

```bash
# 1. Create
resource_manager(resource_type:"prompt", action:"create", id:"my_prompt", ...)

# 2. Reload
resource_manager(resource_type:"prompt", action:"reload")

# 3. Test
prompt_engine(command:"my_prompt arg:'value'")

# 4. Iterate
resource_manager(resource_type:"prompt", action:"update", id:"my_prompt", ...)
```

### Run a Multi-Step Analysis

```bash
# 1. Start chain with framework
prompt_engine(command:"@CAGEERF research topic:'X' --> analysis --> report")

# 2. Complete step 1, resume
prompt_engine(chain_id:"chain-research#1", user_response:"Research complete: ...")

# 3. Handle gate review if needed
prompt_engine(chain_id:"chain-research#2", gate_verdict:"GATE_REVIEW: PASS - Sources verified")

# 4. Continue to completion
prompt_engine(chain_id:"chain-research#3", user_response:"Analysis complete: ...")
```

### Switch Frameworks Mid-Session

```bash
# Check current
system_control(action:"status")

# Switch
system_control(action:"framework", operation:"switch", framework:"5W1H")

# Execute with new framework
prompt_engine(command:"investigation target:'incident'")
```

---

## Version History

All resources (prompts, gates, methodologies) automatically track version history. Each update saves a snapshot before changes, enabling rollback and comparison.

### Configuration

Enable/disable in `config.json`:

```json
{
  "versioning": {
    "enabled": true,
    "max_versions": 50,
    "auto_version": true
  }
}
```

| Setting        | Default | Purpose                                  |
| -------------- | ------- | ---------------------------------------- |
| `enabled`      | `true`  | Enable version tracking globally         |
| `max_versions` | `50`    | Maximum versions retained (FIFO pruning) |
| `auto_version` | `true`  | Auto-save on updates (can skip per-call) |

### View History

```bash
# View version history for a prompt
resource_manager(resource_type:"prompt", action:"history", id:"my_prompt")

# View with limit
resource_manager(resource_type:"prompt", action:"history", id:"my_prompt", limit:10)

# Same for gates and methodologies
resource_manager(resource_type:"gate", action:"history", id:"code-quality")
resource_manager(resource_type:"methodology", action:"history", id:"cageerf")
```

**Output:** Table showing version number, date, changes summary, and description.

### Rollback to Previous Version

```bash
# Rollback a prompt to version 3
resource_manager(
  resource_type:"prompt",
  action:"rollback",
  id:"my_prompt",
  version:3,
  confirm:true
)
```

**Safety:** Current state is automatically saved as a new version before rollback. You can always rollback-from-rollback.

### Compare Versions

```bash
# Compare version 1 to version 5
resource_manager(
  resource_type:"prompt",
  action:"compare",
  id:"my_prompt",
  from_version:1,
  to_version:5
)
```

**Output:** Unified diff showing additions (+) and removals (-) between versions.

### Skip Auto-Versioning

For bulk updates or minor edits, skip automatic version save:

```bash
resource_manager(
  resource_type:"prompt",
  action:"update",
  id:"my_prompt",
  description:"Minor typo fix",
  skip_version:true
)
```

### Version Storage

Version history is stored in `.history.json` sidecar files alongside each resource:

```
resources/prompts/
├── development/
│   └── my_prompt/
│       ├── prompt.yaml
│       └── .history.json    # Version history
resources/gates/
├── code-quality/
│   ├── gate.yaml
│   └── .history.json
```

---

## CLI Configuration

Override resource paths via CLI flags or environment variables.

### CLI Flags

```bash
node dist/index.js --transport=stdio \
  --prompts=/path/to/prompts \
  --gates=/path/to/gates \
  --methodologies=/path/to/methodologies \
  --styles=/path/to/styles \
  --scripts=/path/to/scripts \
  --workspace=/path/to/workspace \
  --config=/path/to/config.json
```

### Transport Options

| Transport         | Flag                          | Use Case                              |
| ----------------- | ----------------------------- | ------------------------------------- |
| STDIO             | `--transport=stdio`           | Claude Desktop, Claude Code           |
| Streamable HTTP   | `--transport=streamable-http` | Web dashboards, remote APIs (**use this for HTTP**) |
| SSE (deprecated)  | `--transport=sse`             | Legacy integrations                   |
| Dual mode         | `--transport=both`            | STDIO + SSE simultaneously            |

For HTTP clients, use Streamable HTTP. It's the current MCP standard and replaces SSE.

### Environment Variables

| Variable                 | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `MCP_RESOURCES_PATH`     | Base path for all resources (prompts/, gates/, etc.) |
| `MCP_PROMPTS_PATH`       | Override prompts directory                           |
| `MCP_GATES_PATH`         | Override gates directory                             |
| `MCP_METHODOLOGIES_PATH` | Override methodologies directory                     |
| `MCP_STYLES_PATH`        | Override styles directory                            |
| `MCP_SCRIPTS_PATH`       | Override scripts directory                           |
| `MCP_WORKSPACE`          | Workspace root for config resolution                 |
| `MCP_CONFIG_PATH`        | Override config.json path                            |

### Resolution Priority

Path resolution follows this priority (first match wins):

1. **CLI flags** — `--prompts=/path` (highest priority, explicit override)
2. **Individual env vars** — `MCP_PROMPTS_PATH` (per-resource override)
3. **Unified env var** — `MCP_RESOURCES_PATH/prompts/` (all resources)
4. **Package defaults** — `server/resources/prompts/` (lowest priority)

**Example: MCP config with custom resources**

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts@latest"],
      "env": {
        "MCP_RESOURCES_PATH": "/home/user/my-resources"
      }
    }
  }
}
```

---

## Reference

| Component          | Location                                            |
| ------------------ | --------------------------------------------------- |
| Prompt definitions | `server/resources/prompts/{category}/{id}/prompt.yaml` |
| Gate definitions   | `server/resources/gates/{id}/gate.yaml`             |
| Style definitions  | `server/resources/styles/{id}/style.yaml`           |
| Methodologies      | `server/resources/methodologies/{id}/methodology.yaml` |
| Chain sessions     | `runtime-state/chain-sessions.json`                 |
| Server config      | `server/config.json`                                |

**Related docs:**

- [Prompt Authoring](../tutorials/build-first-prompt.md) — Tutorial
- [Prompt Schema](../reference/prompt-yaml-schema.md) — Configuration reference
- [Chain Schema](../reference/chain-schema.md) — Chain configuration
- [Gate Configuration](../reference/gate-configuration.md) — Gate configuration
- [Architecture](../architecture/overview.md) — System internals
- [Script Tools](../guides/script-tools.md) — Prompt-scoped script tool configuration
