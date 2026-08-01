# Chains: Lifecycle & Concepts

Chains break complex workflows into steps that run one at a time, threading context from each step to the next.

## Why This Matters

| Problem                | Solution         | Result                                |
| ---------------------- | ---------------- | ------------------------------------- |
| **Cognitive Overload** | Discrete Steps   | Higher accuracy on complex tasks      |
| **Lost Context**       | State Management | Data flows cleanly from A to B        |
| **Black Box**          | Visible Progress | User sees/verifies intermediate steps |

> [!TIP]
> **Want to build one?** The [Chain Authoring Example](../guides/chain-authoring-example.md) walks through a real 4-step docs-to-skills pipeline.

---

## How a Chain Executes

The server tracks your workflow across steps — saving results, checking dependencies, and advancing to the next step automatically.

### 1. Create Session

User invokes a chain (`>>research_chain`). The server creates a session ID (`chain-research#123`) to track progress.

### 2. Resolve Step Order

Steps execute sequentially in the order defined.

- Step A: Runs first.
- Step B: Receives A's output via `inputMapping`.
- Step C: Receives B's output via `inputMapping`.

### 3. Run Step

The server tells the client: "Run Step A".
Client runs the prompt → returns output.

### 4. Save & Advance

Server saves the output to the session. Checks dependencies: "Step B is now unblocked."

### 5. Repeat

Repeat until all steps complete.

---

## Session Management

Chains persist across messages. You don't need to feed the entire history back to the model.

- **Storage**: SQLite database (`runtime-state/state.db`, table `chain_sessions`)
- **Resume**: Just provide `chain_id` + `user_response`.
- **Debug**: Use `system_control(action: "status")` to inspect active sessions.

### Automatic Resume

The MCP server recognizes active sessions. If you reply to a chain step, it automatically routes your response to the running session, restoring the execution context.

> [!NOTE]
> Chain sessions are scoped per workspace when [Identity Scope](../guides/identity-scope.md) is configured. Each workspace sees only its own active chains.

---

## Delegation

Steps can be handed off to sub-agents using the `==>` operator. Delegated steps run in isolated context, keeping the main conversation clean.

```bash
# Step 2 runs in a sub-agent
prompt_engine(command:">>research ==> >>analyze --> >>summarize")
```

### Model Selection

Each prompt (or individual chain step) can declare a `subagentModel` to control which model tier the sub-agent uses. The hint is client-agnostic — each client maps it to its own models.

| Hint       | Meaning                                 |
| ---------- | --------------------------------------- |
| `heavy`    | Most capable model (e.g., opus)         |
| `standard` | Balanced model (e.g., sonnet) — default |
| `fast`     | Lightweight model (e.g., haiku)         |

Set in `prompt.yaml` at the prompt level or per chain step. See the [Chain Schema Reference](../reference/chain-schema.md) for details.

---

## See Also

- **[Chain Authoring Example](../guides/chain-authoring-example.md)** — Build a real multi-step pipeline
- **[Chain Schema Reference](../reference/chain-schema.md)** — `chainSteps` configuration, input mapping, retries
- **[MCP Tools Reference](../reference/mcp-tools.md)** — `prompt_engine` chain parameters
- **[Gates Guide](../guides/gates.md)** — Add validation between chain steps
