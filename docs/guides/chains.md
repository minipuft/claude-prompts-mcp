# Chains

> Status: canonical

Break complex tasks into discrete steps. Each step's output feeds the next.

```bash
# Inline chain syntax
prompt_engine(command:">>research topic:'AI safety' --> >>analyze --> >>summarize")

# Resume mid-chain
prompt_engine(chain_id:"chain-research#2", user_response:"Analysis complete: ...")
```

---

## Why Chains

**Problem**: Complex tasks need multiple reasoning steps, but a single prompt tries to do everything at once.

**Solution**: Chains split work into discrete steps with persistent session state. The server tracks progress, validates dependencies, and routes output between steps.

**What you get**: Each step executes independently. You see intermediate outputs and can intervene if something goes wrong.

---

## Quick Reference

| Topic | Section |
|-------|---------|
| Chain step schema | [Chain Step Schema](#chain-step-schema) |
| Session management | [Session Management](#session-management) |
| Continuing chains | [Continuing Execution](#continuing-chain-execution) |
| Troubleshooting | [Diagnostics](#diagnostics) |

**Related**: [MCP Tools](../reference/mcp-tools.md) for command syntax, [Gates](gates.md) for validation.

---

## Core Concepts

- **Chain prompt**: A prompt with `chainSteps` array in its YAML definition
- **Chain session**: Runtime state in `runtime-state/chain-sessions.json`, managed by `ChainSessionManager`
- **Chain executor**: Part of `prompt_engine` — reads definitions, emits step instructions, validates dependencies

---

## Chain Step Schema

Each step in `chainSteps` follows this shape:

```yaml
chainSteps:
  - promptId: content_analysis      # Required: prompt to execute
    stepName: "Analysis (1/3)"      # Required: display name
    inputMapping:                   # Optional: map values into this step
      content: content
      prior: steps.step_0.result
    outputMapping:                  # Optional: expose outputs for downstream
      result: analysis_output
    retries: 2                      # Optional: retry attempts on failure
```

### Field Reference

| Field | Required | Purpose |
|-------|----------|---------|
| `promptId` | Yes | ID of the prompt to execute |
| `stepName` | Yes | Display name shown in progress |
| `inputMapping` | No | Maps chain args or prior step outputs into this step's arguments |
| `outputMapping` | No | Names this step's output for downstream steps |
| `retries` | No | Retry count on failure (default: 0) |

### Example: Analysis → Draft → QA Chain

```yaml
# resources/prompts/analysis/review_chain/prompt.yaml
id: review_chain
name: Review Chain
category: analysis
description: Three-step review workflow
userMessageTemplateFile: user-message.md

arguments:
  - name: content
    required: true
    type: string
    description: Content to review

chainSteps:
  - promptId: content_analysis
    stepName: "Analyze (1/3)"
  - promptId: draft_generator
    stepName: "Draft (2/3)"
    inputMapping:
      analysis: steps.content_analysis.result
  - promptId: qa_review
    stepName: "Review (3/3)"
    inputMapping:
      draft: steps.draft_generator.result
```

How it connects:
1. Each `promptId` references a prompt in `resources/prompts/{category}/{id}/prompt.yaml`
2. `inputMapping` pulls outputs from prior steps using `steps.{stepName}.result`
3. Session state persists in `runtime-state/chain-sessions.json`

---

## Lifecycle

1. **Init**: `prompt_engine` receives chain command → creates session
2. **Plan**: Dependencies sorted, execution order determined
3. **Emit**: Executor builds instruction payload → returns to client
4. **Execute**: Client completes step → posts result back
5. **Persist**: Session progress written to `runtime-state/chain-sessions.json`
6. **Complete**: Final step completes → session closes

---

## Continuing Chain Execution

When a step completes and waits for your response:

### Option 1: Resume-Only (Recommended)

Just provide chain ID and your response — no command needed:

```json
{
  "chain_id": "chain-research_pipeline#3",
  "user_response": "Step 2 analysis complete - findings attached"
}
```

The system restores the execution blueprint automatically.

### Option 2: Gate Reviews

For gate validation, use the special format:

```json
{
  "chain_id": "chain-analysis_flow#2",
  "user_response": "GATE_REVIEW: PASS - All quality criteria met."
}
```

Or if failing:

```json
{
  "chain_id": "chain-analysis_flow#2",
  "user_response": "GATE_REVIEW: FAIL - Missing test coverage for edge cases."
}
```

### Option 3: Command-Based Resume

Include original command when modifying arguments or debugging:

```json
{
  "command": ">>research_pipeline topic:'AI Ethics'",
  "chain_id": "chain-research_pipeline#3",
  "user_response": "Step 2 complete"
}
```

---

## Authoring Chains

### Create a new chain

```yaml
# resources/prompts/{category}/{chain_id}/prompt.yaml
id: my_chain
name: My Chain
category: development
description: Does thing A then thing B
userMessageTemplateFile: user-message.md

chainSteps:
  - promptId: step_a
    stepName: "Step A (1/2)"
  - promptId: step_b
    stepName: "Step B (2/2)"
    inputMapping:
      prior_result: steps.step_a.result
```

### Test the chain

```bash
prompt_engine(command:">>my_chain", force_restart:true)
```

### Edit via MCP tools

```bash
resource_manager(resource_type:"prompt", action:"inspect", id:"my_chain")
resource_manager(resource_type:"prompt", action:"update", id:"my_chain", chain_steps:[...])
resource_manager(resource_type:"prompt", action:"reload")
```

---

## Session Management

| Action | How |
|--------|-----|
| Resume | Provide `chain_id` + `user_response` |
| Restart | Add `force_restart: true` |
| Inspect | Read `runtime-state/chain-sessions.json` (debug only) |

Don't edit session files manually — use `force_restart` to clear state.

---

## Diagnostics

| Issue | Resolution |
|-------|------------|
| Chain stuck | Check step names in `inputMapping` references |
| Session won't save | Verify `runtime-state/` is writable |
| Gate failures | See [Gates Guide](gates.md) |
| Edits ignored | Run `resource_manager(action:"reload")` |

---

## Best Practices

- **Keep chains small** — focused prompts per step, not giant templates
- **Name outputs clearly** — `outputMapping: { result: "analysis_summary" }`
- **Document branches** — complex flows need inline comments
- **Use relative references** — avoid hardcoded paths

For prompt authoring, see [Prompt Authoring Guide](prompt-authoring-guide.md).
