# Chains

Break complex tasks into discrete steps. Each step's output becomes the next step's input.

```bash
# Inline chain syntax
prompt_engine(command:"research topic:'AI safety' --> analyze --> summarize")

# Resume mid-chain after completing a step
prompt_engine(chain_id:"chain-research#2", user_response:"Analysis complete: ...")
```

---

## Why

**Problem**: Complex tasks need multiple reasoning steps, but a single prompt tries to do everything at once.

**Solution**: Chains split work into discrete steps with persistent session state. The server tracks progress, validates dependencies, and routes output between steps.

**Expect**: Each step executes independently. You see intermediate outputs and can intervene if something goes wrong mid-chain.

---

## What This Guide Covers

| Topic | Section |
|-------|---------|
| Chain step schema | [Chain Step Schema](#chain-step-schema) |
| Resuming and managing sessions | [Session Management](#session-management) |
| Conditional execution and branching | [Conditional Execution](#conditional-execution) |
| Troubleshooting stuck chains | [Troubleshooting](#troubleshooting) |

**Related**: [MCP Tooling Guide](mcp-tools.md) for command syntax, [Gates](gates.md) for per-step validation.

## Core Concepts

- **Chain prompt**: A prompt entry with `isChain: true` and a `chainSteps` array inside its metadata (managed via `prompt_manager`).
- **Chain session**: Runtime state stored in `runtime-state/chain-sessions.json` and managed by `ChainSessionManager`. Sessions link MCP client IDs to the chain’s progress so restarts don’t lose context.
- **Chain executor**: Part of the consolidated prompt engine. It reads definitions, emits step instructions, validates dependencies, and reports gate status.

## Chain Step Schema

Each step inside `chainSteps` follows this shape:

```json
{
  "id": "step_1",
  "name": "Initial Analysis",
  "promptId": "content_analysis",
  "order": 0,
  "description": "Human-readable summary",
  "dependencies": [],
  "inputMapping": {
    "content": "content",
    "initial_analysis": "steps.step_0.result"
  },
  "outputMapping": {
    "result": "analysis_output"
  },
  "optional": false,
  "timeout": 300000,
  "conditionalExecution": {
    "type": "conditional",
    "expression": "utils.length(args.content) > 0",
    "description": "Skip if no content"
  },
  "inlineGateIds": ["analysis_quality"]
}
```

### Field Reference

| Field | Purpose |
| --- | --- |
| `id` | Unique identifier (use snake_case). Referenced in dependencies and logs.
| `name` / `description` | User-facing context for editors and logs.
| `promptId` | ID of the prompt executed for this step.
| `order` | Zero-based ordering; must be unique per chain.
| `dependencies` | Step IDs that must be completed successfully before this step can run.
| `inputMapping` | Maps values from chain arguments, previous step outputs, or runtime context into the step prompt arguments.
| `outputMapping` | Exposes parts of the step response for downstream steps.
| `optional` | When `true`, the executor treats failure as non-blocking.
| `timeout` | Optional per-step timeout in milliseconds.
| `conditionalExecution` | Controls branching. Types: `always`, `conditional` (expression evaluates via safe JS sandbox), `skip_if_error`, `skip_if_success`.
| `inlineGateIds` | Optional list of gate definitions to evaluate after the step finishes.
| `blueprint` | Extended metadata stored per session to recreate chain structure; managed automatically.

### Example: Analysis → Draft → QA Chain

```json
[
  {
    "id": "analyze",
    "name": "Context Analysis",
    "promptId": "context_analysis",
    "order": 0,
    "inlineGateIds": ["analysis_quality"]
  },
  {
    "id": "draft",
    "name": "Generate Draft",
    "promptId": "draft_generator",
    "order": 1,
    "dependencies": ["analyze"],
    "inputMapping": {
      "analysis": "steps.analyze.result",
      "requirements": "requirements"
    }
  },
  {
    "id": "qa",
    "name": "Quality Review",
    "promptId": "qa_template",
    "order": 2,
    "dependencies": ["draft"],
    "inlineGateIds": ["technical-accuracy", "style-adherence"]
  }
]
```

How it ties together:
1. Each `promptId` references Markdown templates authored via the [Prompt & Template Authoring Guide](prompt-authoring-guide.md).
2. Inline gates are defined in the gate registry—see the [Gates Guide](gates.md) for precedence.
3. The MCP client drives progression by calling `prompt_engine` with `chain_id` + `user_response`; session data lives in `runtime-state/chain-sessions.json`.

## Lifecycle & Execution Flow

1. **Initialization**: `prompt_engine` receives a chain command (e.g., `step1 --> step2 --> step3`). A session ID is created or resumed.
2. **Planning**: Dependencies are sorted and `conditionalExecution` rules evaluated inside `execution/planning/`.
3. **Instruction Emission**: The executor builds an instruction payload (step details, arguments, dependencies) and returns it to the MCP client.
4. **LLM Execution**: The MCP client completes the step, posting results back via the same `prompt_engine` tool call.
5. **Validation**: Inline gates (if any) run; failures produce remediation guidance.
6. **State Persistence**: Session progress, outputs, and gate statuses are written to `runtime-state/chain-sessions.json`.
7. **Completion / Looping**: When the final step completes, the session is closed unless the client restarts (`force_restart=true`).

## Continuing Chain Execution

When a chain step completes and waits for your response, you can continue in two ways:

### Option 1: Resume-Only Mode (Recommended)

The system supports **command-free continuation** - just provide the chain identifier and your response:

```json
{
  "chain_id": "chain-research_pipeline#3",
  "user_response": "Step 2 analysis complete - findings attached"
}
```

**Key points**:
- The `command` parameter is **optional** when resuming
- The system restores the execution blueprint from the chain session automatically
- This is the simplest and recommended approach for continuing chains
- LLM-friendly guardrail: If you send the chain identifier as `command` (e.g., `command:"chain-research_pipeline#3"`) with a `user_response` or `gate_verdict`, the runtime now normalizes it into `chain_id` for you.

**For gate reviews**, use the special format:

```json
{
  "chain_id": "chain-analysis_flow#2",
  "user_response": "GATE_REVIEW: PASS - All quality criteria met. Code follows standards and includes comprehensive tests."
}
```

Or if the gate fails:

```json
{
  "chain_id": "chain-analysis_flow#2",
  "user_response": "GATE_REVIEW: FAIL - Missing test coverage for edge cases. Please add tests for null inputs and boundary conditions."
}
```

### Option 2: Command-Based Resume (Explicit)

You can also provide the original command when resuming:

```json
{
  "command": ">>research_pipeline topic:'AI Ethics'",
  "chain_id": "chain-research_pipeline#3",
  "user_response": "Step 2 complete"
}
```

**When to use this**:
- When you want to modify arguments for the next step
- For debugging purposes (to see the full command)
- When explicitly restarting with `force_restart: true`

### Resume Shortcuts

The chain footer provides convenient shortcuts:

```
Resume via prompt_engine with `chain_id: "chain-my_prompt#2"` plus user_response:"<latest step output>" — no need to resend the original command — Shortcut: `chain-my_prompt#2 --> (optional input) --> user_response:"<latest step output>"`
```

Use this as the template for continuing execution. Fill in the latest response content or switch to `gate_verdict` when clearing a review.

## Authoring & Editing Chains

1. **Inspect the chain**
   ```bash
   prompt_manager(action:"list", filter:"id:notes_modular")
   prompt_manager(action:"inspect", id:"notes_modular")
   ```
2. **Create or update steps**
   ```bash
   prompt_manager(action:"update", id:"notes_modular", chain_steps=[ ... ])
   ```
3. **Reload registry**
   ```bash
   prompt_manager(action:"reload", reason:"notes_modular update")
   ```
4. **Test end-to-end**
   ```bash
   prompt_engine(command:"notes_modular", force_restart:true)
   ```

Always add supporting prompts (`promptId` targets) before referencing them inside chain steps. Chains can only call registered prompt IDs.

## Conditional Branching

- Expressions execute inside a sandbox with helpers (`utils.*`, `steps`, `args`).
- Use `conditionalExecution.type="skip_if_success"` to run remediation steps only when previous steps fail.
- Debug by checking server logs (`server/logs/`) for planning traces and expression evaluation results.

## Session Management

- Resume automatically by providing `chain_id` and `user_response` without `force_restart`.
- Start fresh with `force_restart:true` to clear cached session state.
- Inspect persisted sessions by reading `runtime-state/chain-sessions.json` (for debugging only). Do not edit manually; use `force_restart` to clear state.

## Diagnostics

| Issue | Resolution |
| --- | --- |
| Chain stuck on a step | Check dependencies and conditional expressions. Review server logs for planning traces. |
| Session fails to save | Ensure repo root is writable; STDIO transport writes runtime-state next to `server/`. |
| Gate failures | See [Gates Guide](gates.md) and update inline gate IDs or prompt content. |
| Chain edits ignored | Confirm `prompt_manager(action:"reload")` finished; check `server/logs/*` for HotReloadManager output. |

## Best Practices

- Keep chains small and composable; create focused prompts per step instead of giant templates.
- Reuse prompt outputs via `outputMapping` names (e.g., `"analysis": "deep_analysis_output"`).
- Document complex branches inside the chain description for future maintainers.
- Prefer relative paths and arguments for vault or filesystem references; avoid hard-coded user paths.
- When adding asynchronous or long-running steps, extend `timeout` accordingly and reflect expectations in the prompt text.

For prompt formatting or general authoring guidance, see `docs/prompt-authoring-guide.md`. For MCP tool syntax, see `docs/mcp-tools.md`.
