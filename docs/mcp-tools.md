# MCP Tooling Guide

Control prompts, chains, and frameworks entirely through MCP tool calls.

Stop copy-pasting prompt templates. This guide shows you how to create, execute, and iterate on prompts without touching files—the server hot-reloads everything automatically.

---

## Quick Start

```bash
# List available prompts
prompt_manager(action:"list")

# Execute a prompt with arguments
prompt_engine(command:"@CAGEERF analysis_report content:'Q4 metrics'")

# Chain two prompts together
prompt_engine(command:"research topic:'AI safety' --> summary")

# Check server status
system_control(action:"status")
```

**That's it.** Three tools, one syntax. Everything below is details.

---

## The Three Tools

| Tool | What It Does | When to Use |
|------|--------------|-------------|
| `prompt_manager` | Create, list, inspect, update, delete prompts | Managing prompt library |
| `prompt_engine` | Execute prompts with frameworks and gates | Running prompts |
| `system_control` | Switch frameworks, view analytics, check health | Admin operations |

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

| Operator | Syntax | Example | Purpose |
|----------|--------|---------|---------|
| Framework | `@NAME` | `@CAGEERF prompt` | Apply methodology |
| Chain | `-->` | `step1 --> step2` | Sequential execution |
| Gate (anon) | `:: "text"` | `:: 'cite sources'` | Anonymous quality criteria |
| Gate (named) | `:: id:"text"` | `:: security:"no secrets"` | Named gate with trackable ID |
| Style | `#id` | `#analytical` | Response formatting |

**Style examples:**
```bash
# Apply analytical style to a report
prompt_engine(command:"#analytical report topic:'Q4 metrics'")

# Combine style with framework
prompt_engine(command:"#procedural @CAGEERF tutorial subject:'React hooks'")

# Available styles: analytical, procedural, creative, reasoning
```

### Modifiers (Put First)

| Modifier | Effect |
|----------|--------|
| `%clean` | No framework/gate injection |
| `%lean` | Gates only, skip framework |
| `%judge` | Show guidance menu, don't execute |
| `%framework` | Framework only, skip gates |

```bash
# Skip all injection for quick iteration
prompt_engine(command:"%clean my_prompt input:'test'")

# Get framework/gate recommendations without executing
prompt_engine(command:"%judge analysis_report")
```

### Parameters

| Parameter | Type | Purpose |
|-----------|------|---------|
| `command` | string | Prompt ID with operators and arguments |
| `chain_id` | string | Resume token for continuing chains |
| `user_response` | string | Your output from previous step (for chain resume) |
| `gate_verdict` | string | `GATE_REVIEW: PASS/FAIL - reason` |
| `gate_action` | enum | `retry`, `skip`, or `abort` after gate failure |
| `gates` | array | Quality gates (IDs, quick checks, or full definitions) |
| `force_restart` | boolean | Restart chain from step 1 |

### Chain Execution

For step schemas, conditional branching, and parallel execution patterns, see the [Chains Guide](chains.md).

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
```

### Gates: Four Ways to Validate

For gate configuration, enforcement modes, and custom definitions, see the [Gates Guide](gates.md).

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

---

## `prompt_manager` — Manage Prompts

Create and modify prompts without editing files.

### List & Inspect

```bash
# List all prompts
prompt_manager(action:"list")

# Filter by category
prompt_manager(action:"list", filter:"category:analysis")

# Get prompt details
prompt_manager(action:"inspect", id:"security_audit")
```

### Create a Prompt

```bash
prompt_manager(
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
```

### Update & Delete

```bash
# Update description
prompt_manager(action:"update", id:"weekly_report", description:"Updated description")

# Delete (requires confirmation)
prompt_manager(action:"delete", id:"old_prompt", confirm:true)

# Force reload all prompts
prompt_manager(action:"reload")
```

### Key Parameters

| Parameter | Purpose |
|-----------|---------|
| `action` | `list`, `inspect`, `create`, `update`, `delete`, `reload` |
| `id` | Prompt identifier |
| `filter` | Search query for list action |
| `category` | Prompt category tag |
| `user_message_template` | Prompt body with `{{variables}}` |
| `arguments` | Array of `{name, required, description}` |

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

| Action | Operations | Purpose |
|--------|------------|---------|
| `status` | — | Runtime overview |
| `framework` | `list`, `switch`, `enable`, `disable` | Methodology management |
| `gates` | `list`, `enable`, `disable`, `status` | Gate management |
| `analytics` | — | Execution metrics |
| `config` | — | View config overlays |

---

## Injection Control

The server injects guidance into prompts. Control this per-execution or globally.

### Three Injection Types

| Type | What It Adds | Default |
|------|--------------|---------|
| `system-prompt` | Framework methodology | Every 2 steps |
| `gate-guidance` | Quality criteria | Every step |
| `style-guidance` | Response formatting | First step only |

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

| Format | Example |
|--------|---------|
| Full | `GATE_REVIEW: PASS - reason` |
| Full (colon) | `GATE_REVIEW: FAIL: reason` |
| Simplified | `GATE PASS - reason` |
| Minimal* | `PASS - reason` |

*Minimal format only works via `gate_verdict` parameter, not in `user_response`.

**Requirements:**
- Rationale is always required
- `gate_verdict` takes precedence over parsed `user_response`

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Prompt not found | Run `prompt_manager(action:"list")` to see available IDs |
| Edits not showing | Run `prompt_manager(action:"reload")` |
| Chain stuck | Use `force_restart:true` or check `runtime-state/chain-sessions.json` |
| Framework not switching | Use `system_control(action:"framework", operation:"switch")` |
| Gate keeps failing | Use `gate_action:"skip"` to bypass, or `gate_action:"retry"` |

---

## Common Workflows

### Create and Test a New Prompt

```bash
# 1. Create
prompt_manager(action:"create", id:"my_prompt", ...)

# 2. Reload
prompt_manager(action:"reload")

# 3. Test
prompt_engine(command:"my_prompt arg:'value'")

# 4. Iterate
prompt_manager(action:"update", id:"my_prompt", ...)
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

## Reference

| Component | Location |
|-----------|----------|
| Prompt definitions | `server/prompts/**/*.{json,md}` |
| Gate definitions | `server/gates/*/gate.yaml` |
| Style definitions | `server/styles/*/style.yaml` |
| Methodologies | `server/methodologies/*/methodology.yaml` |
| Chain sessions | `runtime-state/chain-sessions.json` |
| Server config | `server/config.json` |

**Related docs:**
- [Prompt Authoring Guide](prompt-authoring-guide.md) — Template syntax and schema
- [Chains](chains.md) — Multi-step execution patterns
- [Gates](gates.md) — Quality validation configuration
- [Architecture](architecture.md) — System internals
