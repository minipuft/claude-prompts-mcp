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

- **Storage**: SQLite database (`runtime-state/state.db`) — a per-run row in `chain_runs` (header
  facts: chain id, run owner, status, current node) plus one row per step in `chain_run_nodes`
  (position, prompt, step lifecycle), both PID-scoped to the owning server process. `chain_sessions`
  is a derived read-projection of those two tables, rebuilt in the same transaction — the row
  Python hooks and cross-language consumers actually read.
- **Resume**: Just provide `chain_id` + `user_response`.
- **Debug**: Use `system_control(action: "status")` to inspect active sessions.

### Automatic Resume

The MCP server recognizes active sessions. If you reply to a chain step, it automatically routes your response to the running session, restoring the execution context.

Resuming a run that already completed returns an "already complete" notice instead of re-opening
it. Resuming a run parked on its final step without an explicit `chain_id` no longer restarts it
from step 1 — only an explicit `force_restart` does.

> [!NOTE]
> Chain sessions are scoped per workspace when [Identity Scope](../guides/identity-scope.md) is configured. Each workspace sees only its own active chains.

---

## Step Identity

Each step in a chain has a stable node id, not just a position. Internally, steps are addressed by
this id — integer step numbers (`current_step`/`total_steps` in the hook dict, `chain_sessions`
state-blob keys, the `v_execution_status` view) are a **derived projection** computed from the node
id at those three boundaries, kept byte-identical to what position-only chains produced before.

- **YAML chains**: a step may declare `id:` explicitly (kebab-case, unique within the chain). When
  omitted, the id defaults to a slug of `stepName`.
- **Symbolic chains** (`>>step1 --> >>step2`, no YAML): the parser mints frozen `n1`, `n2`, …
  ids once at parse time. These never renumber for the life of the run.

Gates may target a step by `target_step_id` in addition to `target_step_number` — see
[MCP Tools Reference](../reference/mcp-tools.md#chain-step-targeting).

> [!NOTE]
> **`step{N}_result` template variables are 1-indexed by ordinal, not by step number.** A step's
> result renders as `step{ordinal+1}_result` — the first step's output is `step2_result`, not
> `step1_result`. `{{step1_result}}` never resolves for a real chain. This is existing,
> unchanged arithmetic (`buildChainVariables`), not something P3 introduced or fixed; it is
> documented here because it is easy to assume otherwise. Prefer `{{step_results}}` (the full map)
> or `steps.{StepName}.result` in `inputMapping` — both are unaffected.

---

## Completion Semantics

A chain **completes on its final step's PASS gate verdict**, not one call earlier. Concretely:

- The footer on the final step, before its verdict is submitted, states the run is awaiting that
  verdict — it does not claim completion early.
- The run's status transitions to `completed` only once the final step's PASS verdict is
  processed.
- The first step is ledgered in `execution_records` on the chain-start call, so
  `system_control(action: "execution_history")` reports the step as planned and executed from the
  first response onward rather than undercounting by one.

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

## Adaptive Mutation

A blocking unknown or an irrelevant resolution can change the run's remaining node list — the
server decides, deterministically, whether and how. The model never edits the graph itself; it
only ever declares typed observations (D2), and the effect on the run is advisory by construction
(D6): a mutation is a reaction to what was declared, never a prediction of what should happen next.

**Flow**: observation (via `observations`) -> ledger entry (open/close) -> policy decision ->
insert or skip -> rendering follows the mutated node list.

| Trigger                                                                                        | Effect                                                                                                   |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `unknown_discovered` with `blocking:true`                                                      | Inserts exactly ONE investigation node (prompt `investigate_unknown`) immediately after the current node |
| `unknown_resolved` with `resolution:"irrelevant"` and a ledger entry carrying `target_step_id` | Skips that target node — but only if it is still strictly ahead of the current step                      |

- **Insertion target is fixed**: the investigation step always lands right after the node where
  the unknown was declared, regardless of what (if anything) `target_step_id` names — a discovered
  entry's `target_step_id` only ever feeds the skip side, later, on resolution.
- **The current node can never be skipped.** A target at or behind the current step is rejected
  (`target-passed`); this keeps the client's already-rendered view from silently going stale with
  no way to signal it.
- **Caps**: 1 insertion per unknown id, 3 insertions per run. A capped or non-qualifying
  observation mutates nothing — the call still succeeds, it just has no side effect on the graph.
- **Skipped nodes are retired, not deleted**: the row stays (`milestone:"skipped"`), so the
  footer's step count and the ledger's row count share one ordinal scale across the whole run.
- **Same call, no extra round-trip**: the policy fires inside the observation-carrying call, right
  after the ledger is updated — an inserted node is already the run's next `chain_id` resume
  target and next CTA by the time the response goes out.

**What a client sees**: after an insertion, the CTA and rendered body name the new
`investigate_unknown` step, not whatever previously sat at that position. After a skip, the
skipped node never renders — the run proceeds straight to the next live node. Rendering, gate
targeting, step totals, the CTA footer, and the Python hook projection all re-derive from the
run's current (possibly mutated) node list rather than the original parse-time step list.

**Gates under mutation**: a gate whose `target_step_id` resolves to a node that later gets
skipped never fires. Inserted investigation nodes carry no gates in v1 — their only output is
observations, so adding review friction to them would work against the point of inserting one.

**Audit trail**: a run's terminal `execution_records` row also carries `nodes_inserted` and
`nodes_skipped` — how many mutations of each kind happened over the life of the run. See
[Run Telemetry](#run-telemetry-record-only) below and the
[MCP Tools Reference](../reference/mcp-tools.md#run-telemetry-line).

---

## Run Telemetry (record-only)

When a run reaches a terminal state, the server stamps complexity facts onto that run's terminal
`execution_records` row: steps planned, steps executed, gate verdict submissions, the FAIL subset
of those submissions, unknowns opened / closed, and — since schema v23 — how many nodes the
adaptive mutation policy inserted and skipped over the run's life (`nodes_inserted`,
`nodes_skipped`; see [Adaptive Mutation](#adaptive-mutation) above).

They are written at the moment they are true because the state they come from does not survive:
`chain_sessions`, `chain_runs`, and `chain_run_nodes` are PID-scoped and deleted when the owning
server exits, and `pendingGateReview.attemptCount` is destroyed the moment a PASS clears the
review. The ledger row is the only place these numbers persist.

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
