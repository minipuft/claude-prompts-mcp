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

## Unknowns Ledger

Steps declare typed unknowns via the `observations` parameter on `prompt_engine`. The server
accumulates them into a per-run ledger — a two-state machine (`active` <-> `resolved`) keyed by
a stable `id` — and surfaces it back into every later step's rendered context.

| Transition                       | Effect                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Discover, new id                 | Appends an active entry stamped at the current step                              |
| Discover, active id              | Idempotent refresh — statement/blocking update, `discoveredAtStep` unchanged     |
| Discover, resolved id            | **Re-open** — the unknown returned; re-stamps `discoveredAtStep`                 |
| Resolve, active id               | Closes the entry — records `resolution`, `resolutionStatement`, `resolvedAtStep` |
| Resolve, resolved id             | Idempotent refresh — original `resolvedAtStep` is kept, not overwritten          |
| Resolve, id with no ledger entry | Rejected — surfaces as a tool-result error, not a thrown exception               |

A batch is all-or-nothing: the first invalid observation rejects the whole call before any entry
is mutated. Observations within one batch apply in order, so a discover immediately followed by a
resolve for the same `id` in a single call closes that entry right away. The ledger is capped at
200 entries per run.

**Context surfacing**: the ledger is exposed to templates as `unknowns_ledger` on the chain
context — present only while non-empty. Each subsequent step's rendered instructions include an
"Unknowns Ledger" section (blocking-active entries first, then active, then resolved in compact
one-line form), so later steps see what remains open without re-reading prior step output.

See the [MCP Tools Reference](../reference/mcp-tools.md#unknowns-ledger) for the `observations`
parameter shape and validation rules.

---

## Run Telemetry (record-only)

When a run reaches a terminal state, the server stamps six complexity facts onto that run's
terminal `execution_records` row: steps planned, steps executed, gate verdict submissions, the
FAIL subset of those submissions, and unknowns opened / closed.

They are written at the moment they are true because the state they come from does not survive:
`chain_sessions` and `chain_run_registry` are PID-scoped and deleted when the owning server exits,
and `pendingGateReview.attemptCount` is destroyed the moment a PASS clears the review. The ledger
row is the only place these numbers persist.

**Recorded, never modeled.** No coefficient, score, threshold, or routing decision is derived from
any of them, and nothing in the runtime branches on their values. That is a deliberate constraint,
not an unfinished feature: a scoring model with no named consumer is a guess that ossifies. When a
consumer exists, it gets built against real history rather than against invented weights.

Both terminal paths carry them — a run that fails mid-chain records the same facts as one that
completes. Non-terminal per-step rows leave them empty by design.

See [MCP Tools Reference → Run telemetry line](../reference/mcp-tools.md#run-telemetry-line) for
how they render and exactly what each one counts.

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

### Agent Selection

`subagentModel` chooses how capable the sub-agent is. `agentType` chooses which agent it is —
useful when a step wants a specialist rather than the generic chain runner.

```yaml
agentType: Explore # every delegated step in this prompt
chainSteps:
  - promptId: gather
    stepName: "Gather (1/2)"
  - promptId: review
    stepName: "Review (2/2)"
    agentType: code-reviewer # ...except this one
```

**Resolution priority**: step-level `agentType` > prompt-level `agentType` > `chain-executor`.
Names are host-defined and are not validated by the server.

---

## See Also

- **[Chain Authoring Example](../guides/chain-authoring-example.md)** — Build a real multi-step pipeline
- **[Chain Schema Reference](../reference/chain-schema.md)** — `chainSteps` configuration, input mapping, retries
- **[MCP Tools Reference](../reference/mcp-tools.md)** — `prompt_engine` chain parameters
- **[Gates Guide](../guides/gates.md)** — Add validation between chain steps
