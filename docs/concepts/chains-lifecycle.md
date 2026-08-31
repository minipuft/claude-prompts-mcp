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

### Handing a Run to Another Client

A run is owned by the conversation that started it and the server process serving that
conversation; nothing crosses clients implicitly. To continue a run from another client
(Codex, OpenCode, a different Claude Code conversation), the owner exports it and the
other side claims it:

```
prompt_engine(chain_id:"chain-research#1", handoff:true)   # owner: mints hnd_… token
prompt_engine(claim_token:"hnd_…")                         # other client: claims + resumes
```

The token is single-use and is the only key the claimer sends — run numbers are a
per-server sequence, so two servers sharing one `state.db` can both hold a
`chain-research#1`, and a claim by name could pick the wrong one. The claim rewrites the
row's owner and burns the token in one statement, then resumes the run in the same call so
the claimer receives the current step immediately. The donor keeps its copy until its next
persist, where it notices the row is no longer its own and retires it. A claim never
rewrites workspace scope, and a run whose persisted state carries no blueprint is refused
by name rather than loaded as something nothing can resume.

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
skipped never fires. A step-targeted gate also enters gate REVIEW only on the step it targets —
an untargeted gate still reviews every step, run-wide inheritance unchanged. Known residual: a
mutation-inserted node standing as the current step matches no parse-time step, so review falls
back to run-wide for that step. Inserted investigation nodes carry no gates in v1 — their only
output is observations, so adding review friction to them would work against the point of
inserting one.

**Audit trail**: a run's terminal `execution_records` row also carries `nodes_inserted` and
`nodes_skipped` — how many mutations of each kind happened over the life of the run. See
[Run Telemetry](#run-telemetry-record-only) below and the
[MCP Tools Reference](../reference/mcp-tools.md#run-telemetry-line).

---

## Blocking-Unknown Interrupt

Insertion and skip change the plan quietly. A **blocking** unknown also says so: the run reports
what is blocked, what the unknown affects, and what remains — and, if the run asked for it, stops
until you answer.

| Run declared             | What a blocking discovery does                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| nothing (default)        | **Soft interrupt.** The investigation node is inserted and the interrupt rides on its response. The run keeps going.          |
| `budget.pauseOnBlocking` | **Pause.** The insertion still happens, and the run then HOLDS on a synthetic review, issuing no step until a verb clears it. |

The inserted investigation node IS the pause point in both variants — the model that declared
`blocking:true` already knows it is blocked, so the default costs no extra round trip. The knob is
a legitimate dial rather than a defect toggle: an autonomous run wants to keep moving, a supervised
one wants to stop. Template chains get the default.

**Resolving a pause** uses `gate_action`, not `gate_verdict`: no gate produced this hold, so no
verdict clears it. `resume` clears the hold and issues the investigation step as written;
`accept_alternative` (carrying a `remainder` in the same call) replaces the rest of the plan;
`abort` and `cancel:true` exit. The verb list a run prints is the list that run accepts — a paused
run never offers "answer the step", because it issued no step.

**Replacing the remainder.** The insert/skip policy makes two local edits and cannot express "this
discovery invalidated the shape of the plan". `remainder` can: the caller authors the alternative
as Workflow IR nodes and the server validates it against the same schema, validator and caps a
`workflow` submission meets. The server never authors step content — the posture is unchanged, the
model declares and the server validates. Accepted nodes are recorded with `origin:'remainder'` and
the id of the unknown that motivated them. See
[MCP Tools](../reference/mcp-tools.md#blocking-unknown-interrupt).

**`affected_step_ids` is derived from DECLARED LINKS ONLY.** It lists exactly the steps some
ledger entry named through `target_step_id`. The server does not scan step text for references to
the unknown: a textual match is a guess about your plan, and every other part of this policy reacts
only to what was declared. A step that is genuinely affected but was never linked will not appear —
declare the link.

**Scope is blocking-only, deliberately.** Whether a NON-blocking unknown should ever raise an
interrupt was considered and killed: the evidence that would settle it does not exist today (only a
`diagnostics.info` line records the near-miss). It revives if a recorded mutation field shows a
non-blocking resolution would have saved two or more steps.

**Audit trail**: `interrupts_raised` and `remainders_accepted` on the run's terminal
`execution_records` row. `interrupts_raised` counts blocking LEDGER ENTRIES rather than raise
events — the interrupt re-raises on every call while the unknown stays open — and
`remainders_accepted` counts distinct unknown ids.

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

## Visibility Policy

A chain step may declare `visibility: { withhold?, expose? }` in `prompt.yaml`, naming which
chain-run context items later steps do or don't see by default. The vocabulary is fixed —
`previous_step_output | chain_history | unknowns_ledger` (`VisibilityItem`) — and an unrecognized
item is rejected when the prompt loads, naming the allowed values.

| Item                   | Governs                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `previous_step_output` | The `{{previous_step_output}}` / `{{previous_step_result}}` template context. Withheld → a neutral `**[CONTEXT WITHHELD]**` instruction takes its place                                              |
| `chain_history`        | The `step_results`, `previous_step_results`, `step{N}_result` and `outputs.*` template context — stripped before `inputMapping` runs, so an alias can't re-publish a withheld entry under a new name |
| `unknowns_ledger`      | The [Unknowns Ledger](#unknowns-ledger) section rendered into a step's instructions — suppressed entirely, not summarized, on both the normal render and the gate-review render                      |

**Semantics**: a step's `withhold` withholds those items from every LATER step's default render;
a later step's own `expose` overrides that withhold for itself only — a step's own `withhold`
never affects its own render, and `expose`-ing an item nobody withheld is a harmless no-op. No
`visibility` declared anywhere in a chain renders byte-identically to a build without this
feature.

**Named outputs are covered.** `outputMapping` names are published under the reserved `outputs`
object (`{{outputs.findings}}`, never `{{findings}}`), so withholding `chain_history` removes them
with the rest of the history. They are deliberately NOT removed by `previous_step_output`: a named
output is the same content `step{N}_result` publishes positionally, and that item leaves the
positional keys in place — withholding the alias but not the thing it aliases would make the rule
depend on which name the author chose. See
[Named outputs](../reference/chain-schema.md#named-outputs).

### What Visibility Cannot Do

The server cannot unsee the client's own conversation. Withholding applies only to the context
items the server itself renders into a step (the table above) — anything already sitting in the
client's context window from an earlier turn stays visible to whatever model reads it there.
True isolation is the `==>` delegation operator below, which builds the sub-agent a fresh
context rather than filtering an existing one.

See [MCP Tools Reference](../reference/mcp-tools.md#visibility-policy) for the YAML schema.

---

## Delegation

Steps can be handed off to sub-agents using the `==>` operator. A delegated step renders a
self-contained **EXECUTION BRIEF** in its own response at resume time — the same moment an
inline step renders, so template content, per-step gate text, prior-step output, and chain
history are all available together in one block, instead of being split across two responses.

```bash
# Step 2 runs in a sub-agent
prompt_engine(command:">>research ==> >>analyze --> >>summarize")
```

**A step-level `subagentModel` also marks its step delegated on ANY chain invocation**, not only
after `==>` — a plain `>>chain` call renders the same execution brief for a step declaring
`subagentModel` in `prompt.yaml` as a command that spells `==>` before it. `agentType` alone does
not have this effect — see [Subagent Model](../reference/chain-schema.md#subagent-model).

### The Execution Brief

The brief renders between `══...EXECUTION BRIEF...══` delimiters, followed by HANDOFF
INSTRUCTIONS that point the parent at the delimited block as the sub-agent's prompt. It carries:

- **Template content** — the step's rendered prompt and args, identical to what an inline step
  would render.
- **`### Quality Gates`** — the step's own gate text. The heading is load-bearing: Python hooks
  key on it. Omitted when the step declares no gates.
- **`### Chain History`** — prior-step output and chain history for steps before the previous
  one, filtered by the [visibility policy](#visibility-policy): any item a prior step withheld is
  excluded, and the withheld item names are listed rather than their values —
  ```
  CONTEXT WITHHELD (names only, values not provided): chain_history
  ```
  — names only, never the withheld values, across every client profile.
- **`### Result Contract`** — instructs the worker to return its work product plus, when the step
  carries gates, a **Proposed Gate Review** (per-gate pass/fail and a one-line rationale, the
  same shape as `gate_verdict.per_gate`). The worker proposes; it never submits — the parent
  reviews the proposal against the same criteria, may override any entry, and is the only party
  that submits `gate_verdict`.

**The step immediately before a delegated step gets a one-line advisory**
(`⚡ Note: Step N ... is delegated`) instead of a full handoff — everything the worker needs is
in the brief the delegated step renders for itself.

The worker carries no `mcp__` tools by design, so the chain resume token never leaves the parent:
chain state flows brief → worker (per visibility), and the worker's result and proposed review
flow worker → parent → `user_response`, which the parent submits. Delegation is advisory — the
server renders the brief and handoff instructions but cannot verify that a client actually
spawned a sub-agent to run it.

**The handoff target is resolved by node id, not by position.** After an [adaptive
mutation](#adaptive-mutation) inserts or skips a node, the step a positional offset would name is
no longer the step the run actually hands off to next; the run's live next-node id is asked for
directly and matched back to the step it names, so the advisory note and the brief itself both
point at the step that will really execute. Legacy chains whose steps carry no `id` (and calls
made with no active run to ask) keep the pre-existing positional answer unchanged.

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
useful when a step wants a specialist rather than the host's general executor. Both are advisory
hints: any executor can run the brief that gets rendered. The plugin ships no agent of its own —
with nothing more specific set, a Claude Code handoff names the host's `general-purpose` agent,
and other clients' handoffs leave the agent to the client's default.

```yaml
agentType: Explore # every delegated step in this prompt
chainSteps:
  - promptId: gather
    stepName: "Gather (1/2)"
  - promptId: review
    stepName: "Review (2/2)"
    agentType: code-reviewer # ...except this one
```

**Resolution priority**: step-level `agentType` > prompt-level `agentType` > the host's default.
Names are host-defined, pass through exactly as written, and are not validated by the server.

---

## See Also

- **[Chain Authoring Example](../guides/chain-authoring-example.md)** — Build a real multi-step pipeline
- **[Chain Schema Reference](../reference/chain-schema.md)** — `chainSteps` configuration, input mapping, retries
- **[Workflow IR Reference](../reference/workflow-ir.md)** — submit a structured, node-addressed multi-step run through `prompt_engine`'s `workflow` parameter; compiles to an ordinary chain run through this same lifecycle
- **[MCP Tools Reference](../reference/mcp-tools.md)** — `prompt_engine` chain parameters, [Visibility Policy schema](../reference/mcp-tools.md#visibility-policy)
- **[Gates Guide](../guides/gates.md)** — Add validation between chain steps
