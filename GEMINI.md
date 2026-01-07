# Gemini Prompts Extension

This extension provides reusable prompt templates, quality gates, and multi-step workflows for consistent AI outputs.

## Quick Start

### Invoke a Prompt
```
>>prompt_id
```
Example: `>>deep_analysis`, `>>code_review`, `>>reasoning`

### Chain Prompts
```
>>analyze --> >>design --> >>implement
```
Chains execute sequentially with context passing between steps.

### List Available Prompts
```
resource_manager(resource_type: "prompt", action: "list")
```

## MCP Tools

### prompt_engine
Execute prompts and chains with CAGEERF methodology.

**Single prompt:**
```
prompt_engine(command: ">>reasoning")
```

**With arguments:**
```
prompt_engine(command: ">>code_review", options: {"focus": "security"})
```

**Chain execution:**
```
prompt_engine(command: ">>analyze --> >>implement --> >>test")
```

**Resume chain:**
```
prompt_engine(chain_id: "chain-xyz#2", user_response: "...", gate_verdict: "GATE_REVIEW: PASS - ...")
```

### resource_manager
CRUD operations for prompts, gates, and methodologies.

**List resources:**
```
resource_manager(resource_type: "prompt", action: "list")
resource_manager(resource_type: "gate", action: "list")
resource_manager(resource_type: "methodology", action: "list")
```

**Create prompt:**
```
resource_manager(
  resource_type: "prompt",
  action: "create",
  id: "my-prompt",
  name: "My Prompt",
  description: "Purpose",
  category: "development",
  system_message: "You are an expert...",
  user_message_template: "Task: {input}"
)
```

### system_control
System administration and status.

```
system_control(action: "status")
system_control(action: "framework", operation: "list")
```

## CAGEERF Methodology

Prompts follow the C.A.G.E.E.R.F framework:

| Phase | Purpose |
|-------|---------|
| **C**ontext | Gather domain knowledge |
| **A**nalysis | Break down the problem |
| **G**oals | Define success criteria |
| **E**xecution | Implement the solution |
| **E**valuation | Validate against goals |
| **R**efinement | Iterate based on feedback |
| **F**inalization | Complete and document |

## Quality Gates

Gates validate output quality between chain steps.

**Gate response format:**
```
GATE_REVIEW: PASS - All criteria met
GATE_REVIEW: FAIL - Missing error handling
```

**Severity levels:** critical | high | medium | low

## Syntax Reference

| Syntax | Purpose |
|--------|---------|
| `>>prompt_id` | Invoke single prompt |
| `>>a --> >>b` | Chain prompts |
| `:: 'criteria'` | Inline gate |
| `chain_id` | Resume chain |

## Prompt Categories

- **development** - Code-related tasks
- **guidance** - Methodology and reasoning
- **analysis** - Deep investigation
- **workflows** - Multi-step processes

## Optional: Enable Hooks

Hooks provide automatic `>>prompt` syntax detection. Add to your `~/.gemini/settings.json`:

```json
{
  "hooks": {
    "BeforeAgent": [
      {
        "matcher": "*",
        "hooks": [{
          "name": "prompt-suggest",
          "type": "command",
          "command": "python3 ~/.gemini/extensions/gemini-prompts/.gemini/hooks/prompt-suggest.py"
        }]
      }
    ],
    "AfterTool": [
      {
        "matcher": "prompt_engine",
        "hooks": [{
          "name": "chain-tracker",
          "type": "command",
          "command": "python3 ~/.gemini/extensions/gemini-prompts/.gemini/hooks/post-prompt-engine.py"
        }]
      }
    ],
    "PreCompress": [
      {
        "matcher": "*",
        "hooks": [{
          "name": "pre-compact",
          "type": "command",
          "command": "python3 ~/.gemini/extensions/gemini-prompts/hooks/gemini/pre-compact.py"
        }]
      }
    ]
  }
}
```

Without hooks, use MCP tools directly: `prompt_engine(command: ">>reasoning")`
