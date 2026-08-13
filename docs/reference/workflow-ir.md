# Workflow IR Reference

Schema reference for a planner-submitted workflow: a node-addressed description of a multi-step
run that the server validates and compiles into an ordinary chain run.

## Why This Matters

| Problem                                                            | Solution                   | Result                                              |
| ------------------------------------------------------------------ | -------------------------- | --------------------------------------------------- |
| **String grammar** — `>>a --> >>b` cannot express per-step fields  | Structured `nodes[]`       | Visibility, gates, delegation, mappings per step    |
| **Positional addressing** — "step 3" moves when a step is inserted | Stable kebab-case node ids | Gates and skips keep addressing the right step      |
| **Unbounded submissions**                                          | Structural caps, enforced  | A malformed or oversized workflow is refused, typed |

An accepted IR runs through the same machinery a YAML chain does. There is **no IR-specific
execution path**: `chain_runs` and `chain_run_nodes` rows are structurally identical to a YAML
chain's, and the same writers populate terminal telemetry.

---

## Top-Level Shape

| Field     | Type     | Required | Description                                                           |
| --------- | -------- | -------- | --------------------------------------------------------------------- |
| `version` | `number` | **Yes**  | Literal `1`.                                                          |
| `nodes`   | `array`  | **Yes**  | The steps, in declaration order. At least one, at most 32.            |
| `edges`   | `array`  | No       | Dependency assertions. See [Edges and ordering](#edges-and-ordering). |
| `gates`   | `array`  | No       | Run-level gate bindings, reusing the `prompt_engine` gate union.      |
| `budget`  | `object` | No       | Declared budget. See [Budget](#budget).                               |

Unknown keys are rejected, at both the top level and inside a node. A key the schema does not
declare cannot take effect, and silently stripping it is how a typo (`framwork: ReACT`) becomes a
run under the wrong framework with no signal.

## Node Schema

Every field mirrors a `chainSteps` field the runtime consumes — see
[Chain Schema Reference](chain-schema.md) for the semantics each one carries.

| Field           | Type     | Required | Description                                                                            |
| --------------- | -------- | -------- | -------------------------------------------------------------------------------------- |
| `id`            | `string` | **Yes**  | Stable kebab-case identity, unique in the workflow. Edges and gates address it.        |
| `promptId`      | `string` | **Yes**  | Prompt this node executes. Must be registered.                                         |
| `stepName`      | `string` | No       | Display name. Defaults to `promptId`.                                                  |
| `args`          | `object` | No       | Arguments for the prompt. Every argument the prompt declares required must appear.     |
| `inputMapping`  | `object` | No       | Maps upstream outputs into this node's arguments.                                      |
| `outputMapping` | `object` | No       | Publishes this node's output as `{{outputs.<key>}}`.                                   |
| `visibility`    | `object` | No       | `withhold` / `expose` over `previous_step_output`, `chain_history`, `unknowns_ledger`. |
| `subagentModel` | `enum`   | No       | `heavy`, `standard`, `fast`.                                                           |
| `agentType`     | `string` | No       | Which agent to spawn for this node.                                                    |
| `framework`     | `string` | No       | Framework for this node, overriding the run-wide selection.                            |
| `retries`       | `number` | No       | Retry attempts on failure.                                                             |
| `inlineGateIds` | `array`  | No       | Gate ids applied to this node, at the `inline-operator` rank.                          |

`delegation` is deliberately absent. Its only reader is the skills-sync exporter, which reads
prompt YAML directly, so an IR node carrying it would be a field with no reader on this path.

`id` is required here, unlike `chainSteps.id`, which is optional: a YAML step has a `stepName` to
slug an id from, and a submitted node has no such fallback that edges could address.

---

## Edges and Ordering

An edge is a **dependency assertion**, not control flow:

```json
{ "from": "gather", "to": "synthesize" }
```

means `synthesize` may not run before `gather`. There is no branching runtime — a run is a total
order of nodes, and no step type carries a condition, a `next`, or a `goto`. Edges therefore
compile to an order and nothing downstream ever sees an edge.

### The linearization rule

> Kahn's algorithm over the dependency edges, where the ready set is drained in **declaration
> order** — at every step the runnable node that appears earliest in `nodes[]` is emitted next.
> Declaration order is a total order on the nodes, so the tiebreak is total, so the algorithm is a
> function: one IR has exactly one linearization. Two nodes can never "tie".

Three consequences worth relying on:

- **With no edges, the order is `nodes[]` unchanged.** A client that wants a specific order writes
  it. Edges are for expressing a constraint you want checked, not for expressing an order.
- **Reordering happens only where an edge demands it.** A node with no incoming edge keeps its
  declared place relative to everything it has no path from.
- **The result does not depend on the order of the `edges` array.** The tiebreak reads `nodes[]`,
  never the edge list.

There is no "ambiguous order" rejection, because under a total tiebreak there is no ambiguous
case. The only ordering failure is a cycle.

### Worked example

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "gather",
      "promptId": "research_docs",
      "args": { "topic": "sqlite wal" }
    },
    {
      "id": "review",
      "promptId": "code_review",
      "inlineGateIds": ["code-quality"]
    },
    {
      "id": "synthesize",
      "promptId": "research_synthesis",
      "visibility": { "withhold": ["chain_history"] }
    }
  ],
  "edges": [
    { "from": "gather", "to": "synthesize" },
    { "from": "review", "to": "synthesize" }
  ],
  "gates": [{ "id": "test-coverage", "target_step_id": "review" }],
  "budget": { "maxNodes": 8, "declaredCostCeiling": 40000 }
}
```

Linearizes to `gather, review, synthesize`. `gather` and `review` are both runnable at the start,
and `gather` is declared first, so it goes first. Reversing the two edges changes nothing.

---

## Budget

Split by enforcement posture, and the split is the contract.

| Field                 | Posture      | Default | Behavior                                                          |
| --------------------- | ------------ | ------- | ----------------------------------------------------------------- |
| `maxNodes`            | **Enforced** | 32      | Node count above the effective cap is rejected.                   |
| `maxFanOut`           | **Enforced** | 8       | Outgoing edges from one node above the effective cap is rejected. |
| `maxInsertions`       | **Enforced** | 3       | Narrows the adaptive-mutation insertion ceiling for the run.      |
| `declaredCostCeiling` | Recorded     | —       | Recorded on the run. Never enforced, never compared.              |

A declared cap may only **narrow** the server default. Asking for a wider one is rejected as
`cap-exceeded` rather than silently clamped — a clamped run is a run you did not author.

`declaredCostCeiling` is denominated in tokens the server never observes: the client meters those.
Enforcing it would mean enforcing against a server-side estimate, which is a number precise enough
to be trusted and wrong often enough to be harmful. It is recorded so a run's declared intent is
auditable beside its measured telemetry, and nothing routes on it.

**Where the two durable fields live.** `maxInsertions` and `declaredCostCeiling` are carried on the
run's stored blueprint, which survives a restart and a cold load from rows. The two structural caps
are not: they are answered from the submission itself at validation time and have no reader
afterwards, so persisting them would store two fields nothing ever consults. `maxInsertions` is
read on every later step of the run — each step is its own call, and the budget has to outlive the
call that declared it.

`maxInsertions: 0` is a real value and is not the same as omitting the field: `0` opts the run out
of adaptive insertion entirely, while omission means "server default".

---

## Submitting a Workflow

A workflow is submitted through the `workflow` parameter of `prompt_engine`. There is no separate
tool and no `workflow` resource type — an accepted workflow becomes an ordinary chain run, and a
durable workflow is authored as a chain resource through `resource_manager` instead.

```bash
prompt_engine(workflow:{
  version: 1,
  nodes: [
    { id: "research", promptId: "research_docs", args: { topic: "caching" } },
    { id: "draft",    promptId: "write_summary", visibility: { withhold: ["chain_history"] } }
  ],
  edges: [{ from: "research", to: "draft" }]
})
```

The run then resumes exactly like any other chain — `prompt_engine(chain_id:"…", user_response:"…")`.
The workflow is submitted once, on the first call.

### Mutual exclusivity

`command`, `chain_id` and `workflow` are three different command sources and exactly one may be
present. A call carrying two is **rejected**, not resolved by precedence: the three mean three
different runs — parse this string, resume that run, execute this graph — and picking one silently
would execute something you did not ask for.

The rule is enforced twice, deliberately: by the tool schema (which guards the MCP boundary) and by
the parsing stage (which guards in-process callers that never pass through the schema).

`gates` is **not** mutually exclusive with `workflow`. A workflow's own `gates` and the `gates`
parameter reach the same run-level channel and are concatenated, so a client supplying both keeps
both.

---

## Rejections

A malformed submission is rejected with a list of **typed, addressed** rejections. Every rejection
carries a `reason` from the vocabulary below, a `detail` naming the offending value and the rule
it violated, and the `nodeId` or `edge` it is about. All rejections are reported at once, so a
submission is fixed in one pass rather than one error per round trip.

**Nothing is written on rejection** — no run row, no session, no version.

| Reason                      | Fires when                                                                       |
| --------------------------- | -------------------------------------------------------------------------------- |
| `empty-workflow`            | `nodes` is empty.                                                                |
| `invalid-node-id`           | A node id is not kebab-case.                                                     |
| `duplicate-node-id`         | Two nodes declare the same id.                                                   |
| `unknown-prompt`            | A node's `promptId` is not registered.                                           |
| `required-argument-missing` | A node omits an argument its prompt declares required.                           |
| `unknown-visibility-item`   | A `visibility` entry is outside the item vocabulary.                             |
| `edge-endpoint-missing`     | An edge's `from` or `to` names no declared node.                                 |
| `cycle`                     | Edges form a cycle. The detail names every node in the stuck set.                |
| `cap-exceeded`              | A structural cap is breached, or a declared budget tries to widen one.           |
| `gate-target-missing`       | A gate's `target_step_id` names no declared node, or an inline gate id is empty. |
| `mutually-exclusive-source` | The call carried a workflow **and** a `command` or `chain_id`.                   |

Every reason but the last is produced by validating one workflow in isolation.
`mutually-exclusive-source` is about the shape of the whole request, so it is raised by the parsing
stage rather than the validator — it reaches you through the same addressed-rejection channel.

Id problems short-circuit the rest. With duplicate ids, "the node named X" is not a well-formed
address, so every later rejection would be ambiguous about which node it meant.

---

## Where This Lives

| Concern                      | Location                                                          |
| ---------------------------- | ----------------------------------------------------------------- |
| Validation SSOT (Zod)        | `server/src/mcp/tools/schemas/workflow-ir.schema.ts`              |
| Types + rejection vocabulary | `server/src/modules/workflow-ir/types.ts`                         |
| Validator (pure)             | `server/src/modules/workflow-ir/validator.ts`                     |
| Linearizer (pure)            | `server/src/modules/workflow-ir/linearizer.ts`                    |
| Compiler (pure)              | `server/src/modules/workflow-ir/compiler.ts`                      |
| IR → `ParsedCommand`         | `server/src/engine/execution/parsers/workflow-command-builder.ts` |
| Third command source         | `server/src/engine/execution/pipeline/stages/04-parsing-stage.ts` |
| Description / metadata SSOT  | `server/tooling/contracts/workflow-ir.json`                       |

The compiler emits the runtime's own `ChainStepPrompt[]` and nothing IR-shaped survives past it.
It deliberately does **not** emit `ChainNode[]`: node rows are built once, by the session stage,
from `steps[].nodeId` — a second producer of that projection would drift from the first.

`workflow-ir.json` is the first **resource-shape** contract: it describes the shape of one
parameter's value rather than an MCP tool's parameter list. It therefore declares no
`toolDescription`, `generate:contracts` emits its parameter metadata to
`_generated/workflow_ir.generated.ts`, and it is excluded from `tool-descriptions.contracts.json`
so no phantom tool reaches the tool-description loader. Hand-written Zod remains the validation
authority — the same split every MCP tool uses.

---

## See Also

- [Chain Schema Reference](chain-schema.md) — the YAML form of the same step vocabulary
- [MCP Tools](mcp-tools.md) — the tool surface a workflow is submitted through
- [Gates](../guides/gates.md) — gate resolution ranks and enforcement modes
- [Chains Lifecycle](../concepts/chains-lifecycle.md) — how a run advances
