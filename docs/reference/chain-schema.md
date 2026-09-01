# Chain Schema Reference

Configuration reference for `chainSteps` in `prompt.yaml`.

**One step vocabulary, three inputs.** A YAML `chainSteps[]` entry, a submitted Workflow IR
`nodes[]` entry, and a step of a `-->` symbolic chain all describe the same thing, and since Tier A
they are validated by ONE Zod schema — `workflowNodeSchema` in
`server/src/modules/workflow-ir/node-schema.ts`. `ChainStepSchema` is derived from it, so the table
below is the IR node table with two identity fields swapped in optionality, and a field added to
one input reaches all three. See [Workflow IR](workflow-ir.md).

## Why This Matters

| Problem           | Solution       | Result                            |
| ----------------- | -------------- | --------------------------------- |
| **Manual Piping** | `inputMapping` | Auto-pass Step A output to Step B |
| **Fragility**     | `retries`      | Auto-retry failed network calls   |
| **Complexity**    | Step Names     | Clear debugging trace             |

---

## Step Schema

A chain is a list of steps defined in `chainSteps`.

| Field                | Type      | Required | Description                                                                                                                                                                                                                                                                                   |
| -------------------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `promptId`           | `string`  | **Yes**  | The ID of the prompt to execute.                                                                                                                                                                                                                                                              |
| `stepName`           | `string`  | **Yes**  | Display name for logs and mapping references. Optional on an IR node, which has an explicit `id` instead.                                                                                                                                                                                     |
| `id`                 | `string`  | No       | Stable kebab-case node identity. Auto-minted from `stepName` when omitted; explicit ids must be unique within the chain. Required on an IR node.                                                                                                                                              |
| `args`               | `object`  | No       | Static arguments for this step. OVERRIDE the run's invocation arguments for this step only. See [Step args](#step-args).                                                                                                                                                                      |
| `inputMapping`       | `object`  | No       | Maps previous outputs to this step's arguments.                                                                                                                                                                                                                                               |
| `outputMapping`      | `object`  | No       | Publishes this step's output to later steps under each declared KEY, as `{{outputs.<key>}}`. See [Named outputs](#named-outputs).                                                                                                                                                             |
| `retries`            | `number`  | No       | Retry attempts on failure (default 0).                                                                                                                                                                                                                                                        |
| `subagentModel`      | `enum`    | No       | Model tier for delegation: `heavy`, `standard`, `fast`. Overrides prompt-level hint.                                                                                                                                                                                                          |
| `agentType`          | `string`  | No       | Which agent to spawn for this step. Overrides the prompt-level default.                                                                                                                                                                                                                       |
| `framework`          | `string`  | No       | Framework this step runs under, overriding the run-wide selection. An unrecognized id falls back to the run-wide framework rather than failing the load.                                                                                                                                      |
| `inlineGateCriteria` | `array`   | No       | RAW `::` gate tokens for this step — ids and free text mixed, resolved per step at review time. A sibling of `inlineGateIds`, not a spelling of it: `inlineGateIds` is already-resolved ids.                                                                                                  |
| `delegated`          | `boolean` | No       | Declared context isolation: this step runs in a sub-agent. What the `==>` operator sets on a symbolic chain, and the only way to ask for isolation in YAML without also naming a model tier.                                                                                                  |
| `inlineGateIds`      | `array`   | No       | Gate ids applied to this step. See [Inline gate ids](#inline-gate-ids).                                                                                                                                                                                                                       |
| `visibility`         | `object`  | No       | Per-step policy (`withhold`/`expose`) for which chain-run context items this step's render sees. See [Visibility](#visibility).                                                                                                                                                               |
| `delegation`         | `boolean` | No       | Marks this step for skills-sync export as a delegated skill. Read ONLY by the skills-sync exporter, never by the execution pipeline — so it is not part of the step vocabulary above. It is accepted in YAML and stripped before validation; it does not exist on an IR node or a `-->` step. |

## Chain-Level Fields

Declared beside `chainSteps`, not inside it. Both use the same shape a submitted Workflow IR uses.

| Field    | Type     | Required | Description                                                                                                                  |
| -------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `edges`  | `array`  | No       | `{ from, to }` dependency constraints between steps, addressed by node id. See [Edges](#edges).                              |
| `budget` | `object` | No       | Run-level budget: `maxNodes`, `maxFanOut`, `maxInsertions`, `declaredCostCeiling`, `pauseOnBlocking`. See [Budget](#budget). |

### Edges

An edge is a DEPENDENCY, never control flow: `{ from: a, to: b }` means `b` may not run before `a`.
The loader linearizes edges into `chainSteps` order at load time (Kahn's algorithm, ties broken by
declaration order), so a chain with no edges runs exactly as authored and everything downstream of
the loader sees a plain ordered list.

Endpoints are the ids `mintNodeIds` derives — an explicit step `id` when declared, otherwise a slug
of `stepName`. An endpoint naming no step, or a cycle, fails the prompt's load with the offending
id named.

```yaml
chainSteps:
  - promptId: research
    stepName: Research
  - promptId: draft
    stepName: Draft
edges:
  - from: research
    to: draft
```

### Budget

`maxInsertions` and `declaredCostCeiling` survive validation and ride the run; `maxNodes` and
`maxFanOut` are answered from the submission itself and are dropped afterwards rather than kept as
write-only fields. A declared cap may only NARROW the server default — a chain asking for a wider
one fails to load rather than being silently clamped.

`pauseOnBlocking` (default `false`) decides what a blocking unknown does to the run: `false` raises
a soft interrupt beside the inserted investigation step and keeps going, `true` HOLDS the run until
a `gate_action` verb clears it. Declaring it in YAML is what lets a template chain opt into
supervised behaviour — see
[Blocking-unknown interrupt](mcp-tools.md#blocking-unknown-interrupt).

```yaml
budget:
  maxInsertions: 1
  pauseOnBlocking: true
```

### Step args

`args` declared on a step are merged OVER the run's invocation arguments for that step only, so a
constant declared on the step beats whatever the caller passed. Upstream step results still arrive
through `inputMapping`.

```yaml
chainSteps:
  - promptId: review
    stepName: Review
    args:
      depth: exhaustive
```

### Subagent Model

Controls which model tier a delegated step uses. The hint is client-agnostic — each delegation strategy maps it to the appropriate model:

| Hint       | Claude Code | Codex          | Others         |
| ---------- | ----------- | -------------- | -------------- |
| `heavy`    | opus        | codex-high     | Client decides |
| `standard` | sonnet      | codex-standard | Client decides |
| `fast`     | haiku       | codex-fast     | Client decides |

**Resolution priority**: step-level `subagentModel` > prompt-level `subagentModel` > strategy default.

**Declaring `subagentModel` marks the step delegated on ANY chain invocation**, not only after an
explicit `==>` operator. A plain `>>chain` call renders the same delegation CTA and handoff
envelope for a step carrying `subagentModel` as a command that spells `==>` before it — the
resolution priority above is unchanged either way. `agentType` alone does not trigger this;
declaring it without `subagentModel` picks which agent a `==>`-delegated step uses without making
an otherwise-plain step delegated.

### Agent Type

`subagentModel` picks how capable the sub-agent is; `agentType` picks _which_ agent it is. Set it
when a step needs a specific specialist rather than the host's general executor.

**Resolution priority**: step-level `agentType` > prompt-level `agentType` > the host's default.
With neither declared, a Claude Code handoff names `general-purpose` (the `Task` tool requires a
`subagent_type`); Codex, Gemini, OpenCode and Cursor handoffs carry no `agent_type` parameter, so
the client's own default agent runs the brief.

Agent names are host-defined — whatever the client exposes (`Explore`, `general-purpose`, an
agent from `~/.claude/agents/`, or a plugin agent written as `plugin:agent`) — and pass through
exactly as written. The server does not validate the name against the host's registry, because it
cannot see one: an unknown agent surfaces as an error from the client, naming the agent it could
not find. The plugin ships no agent of its own: the EXECUTION BRIEF a delegated step renders is
self-contained, so any executor can run it.

### Inline Gate Ids

Gate ids applied to this step alone, in addition to whatever the run already accumulated. They
enter gate resolution at the `inline-operator` rank — the same rank a `::` operator typed in the
command uses — so a step-level binding is not outranked by a caller-supplied gate.

```yaml
chainSteps:
  - promptId: implement
    stepName: Implement
    inlineGateIds:
      - code-quality
```

Gate accumulation is cumulative: step N inherits the gates accumulated by steps 1..N-1, so a gate
bound to an early step continues to apply to later ones.

An id naming no registered gate is not rejected, and produces no guidance text. That matches every
other gate source — an unknown id supplied through the `gates` parameter behaves the same way —
rather than making gate resolution mean different things depending on where an id came from. Use
`resource_manager` gate `list` to check an id before binding it.

### Visibility

Controls which chain-run context items are withheld from or exposed to a step's render, consumed
by `decideVisibility` at the operator render and delegation-envelope chokepoints. An item may
appear in `withhold` or `expose`; the schema does not reject the same item in both — `expose` is
only meaningful against a prior step's `withhold`.

| Item                   | Meaning                                  |
| ---------------------- | ---------------------------------------- |
| `previous_step_output` | The immediately preceding step's result. |
| `chain_history`        | Accumulated history of prior steps.      |
| `unknowns_ledger`      | The run's declared-unknowns ledger.      |

```yaml
chainSteps:
  - promptId: draft_step
    stepName: Draft
    visibility:
      withhold: [chain_history]
```

### Example

```yaml
chainSteps:
  - promptId: fetch_data
    stepName: "Fetch (1/2)"
    retries: 2
    subagentModel: fast # lightweight model for data fetching

  - promptId: summarize_data
    stepName: "Summarize (2/2)"
    subagentModel: heavy # heavy model for synthesis
    agentType: code-reviewer # a specific host agent instead of the default
    inputMapping:
      content: steps.Fetch (1/2).result
```

---

## Input Mapping

How to pass data between steps.

**Syntax**: `target_arg: source_path`

### Source Paths

| Source                | Syntax                            | Example                             |
| --------------------- | --------------------------------- | ----------------------------------- |
| **Step Result**       | `steps.{StepName}.result`         | `steps.Analysis.result`             |
| **Initial Args**      | `chain_args.{ArgName}`            | `chain_args.topic`                  |
| **Step Output Field** | `steps.{StepName}.output.{field}` | `steps.Scan.output.vulnerabilities` |

### Example Mapping

```yaml
inputMapping:
  # 'context' arg gets value from 'Research' step
  context: steps.Research.result

  # 'format' arg gets value from initial chain call
  format: chain_args.requested_format
```

## Named Outputs

`outputMapping` publishes a completed step's output to later steps under author-chosen names.
Every name lands in one reserved context object, `outputs`, and is read as `{{outputs.<name>}}`:

```yaml
chainSteps:
  - promptId: analyze
    stepName: Analysis
    outputMapping:
      findings: output # later steps read {{outputs.findings}}
```

**The declared VALUE is not read.** Each key receives the step's _whole_ output, so
`{ findings: output, verdict: output }` publishes the same text twice under two names. The value
slot is reserved for a future sub-content selector; no selector exists today, and nothing in the
runtime inspects it. Write the key you want to read and treat the value as documentation.

**Namespaced, not flat.** A named output is a chain-history value under an author-chosen name, so
it is withheld exactly when the positional history surface is — see
[Visibility](#visibility) and the `chain_history` item. Publishing these names flat (as
`{{findings}}`) made them indistinguishable from an ordinary argument, so a step withholding
`chain_history` still received them. There is no dual read: `{{findings}}` is not published, and a
template written against the bare name renders empty.

`inputMapping` is unaffected and stays flat — it renames values into the step's own context,
whereas `outputMapping` publishes chain-wide.

---

## See Also

- **[Chains: Lifecycle & Concepts](../concepts/chains-lifecycle.md)** — how a chain executes, step
  identity, adaptive mutation, visibility policy, delegation
- **[Workflow IR Reference](./workflow-ir.md)** — submit a structured, node-addressed multi-step
  run via `prompt_engine`'s `workflow` parameter instead of a `chainSteps` YAML block or a command
  string; the same node fields documented above (`id`, `visibility`, `subagentModel`, `agentType`,
  `inputMapping`, `outputMapping`, `inlineGateIds`) as an authoring-time IR
- **[MCP Tools Reference](./mcp-tools.md)** — `prompt_engine` chain parameters, workflow submission
