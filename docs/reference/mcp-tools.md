# MCP Tooling Guide

Execute prompts, build workflows, and manage your resource library — all through MCP tool calls. The server hot-reloads everything automatically, so you never touch files directly.

---

## Quick Start

```bash
# Discover prompts (use resources for token efficiency)
ReadMcpResourceTool uri="resource://prompt/"

# Execute a prompt with arguments
prompt_engine(command:"@CAGEERF analysis_report content:'Q4 metrics'")

# Chain two prompts together
prompt_engine(command:"research topic:'AI safety' --> summary")

# Check server status
system_control(action:"status")

# Create a gate (use tools for mutations)
resource_manager(resource_type:"gate", action:"create", id:"my-gate", guidance:"...")

# Switch framework
resource_manager(resource_type:"framework", action:"switch", id:"cageerf")
```

**That's it.** Resources for READ, tools for WRITE. Everything below is details.

---

## The Three Tools

| I want to...                                      | Tool               | Example                                                          |
| ------------------------------------------------- | ------------------ | ---------------------------------------------------------------- |
| **Run a prompt** or chain                         | `prompt_engine`    | `prompt_engine(command:">>review file:'api.ts'")`                |
| **Create, edit, or delete** a resource            | `resource_manager` | `resource_manager(resource_type:"prompt", action:"create", ...)` |
| **Check status**, switch frameworks, view metrics | `system_control`   | `system_control(action:"status")`                                |

---

## MCP Resources — Token-Efficient Discovery

> **Off by default.** `resources.registerWithMcp` ships as `false`, because the tools cover the same
> discovery more cheaply. Until you enable it, `resources/list` returns an empty list and every URI
> below answers `Resource not found`. Turn it on with `cpm enable resources`, or set
> `resources.registerWithMcp: true` in `config.jsonc` (`config.json` is also still read), then restart the server.

MCP Resources provide a **read-only, token-efficient** alternative to tool-based list/inspect operations. Use resources when you need to:

- **Discover** available prompts, gates, and frameworks without consuming execution tokens
- **Read** prompt templates, gate guidance, or framework configs in a structured format
- **Monitor** active chain sessions and pipeline metrics for observability
- **Recover context** after compaction or long tasks via session resources

### Resource URIs

<details>
<summary><strong>Content Resources (Prompts, Gates, Frameworks)</strong></summary>

| URI Pattern                       | Returns                              | Use Case                           |
| --------------------------------- | ------------------------------------ | ---------------------------------- |
| `resource://prompt/`              | All prompts (minimal metadata)       | Discovery - find available prompts |
| `resource://prompt/{id}`          | Full prompt with metadata + template | Inspect a specific prompt          |
| `resource://prompt/{id}/template` | Raw template content only            | Minimal token usage                |
| `resource://gate/`                | All gates (minimal metadata)         | Discovery - find available gates   |
| `resource://gate/{id}`            | Gate definition + guidance           | Inspect a specific gate            |
| `resource://gate/{id}/guidance`   | Raw guidance content only            | Minimal token usage                |
| `resource://framework/`           | All frameworks (name, enabled)       | Discovery - find frameworks        |
| `resource://framework/{id}`       | Framework config + system prompt     | Inspect framework details          |

</details>

<details>
<summary><strong>Observability Resources (Sessions, Metrics)</strong></summary>

| URI Pattern                    | Returns                    | Use Case                                    |
| ------------------------------ | -------------------------- | ------------------------------------------- |
| `resource://session/`          | Active chain sessions      | Context recovery - what chains are running? |
| `resource://session/{chainId}` | Session state + progress   | Inspect chain for resumption                |
| `resource://metrics/pipeline`  | Execution analytics (lean) | Observability - system health               |

> **Note:** Session URIs use the user-facing `chainId` (e.g., `chain-quick_decision#1`) — the same identifier used to resume chains with `chain_id` parameter.

</details>

<details>
<summary><strong>Token Efficiency</strong></summary>

Resources are **4-30x more token efficient** than equivalent tool calls:

| Operation         | Tool Call           | Resource    | Savings |
| ----------------- | ------------------- | ----------- | ------- |
| List 80 prompts   | ~4500 chars         | ~2800 chars | **38%** |
| List 13 gates     | ~600 chars          | ~400 chars  | **33%** |
| List 5 frameworks | ~350 chars          | ~200 chars  | **43%** |
| Pipeline metrics  | ~15KB (raw samples) | ~500 bytes  | **97%** |

</details>

### Session Resources — Context Recovery

After compaction or long tasks, use session resources to recover chain context:

```bash
# List active chains (what am I working on?)
ReadMcpResourceTool uri="resource://session/"

# Response shows chainId for direct resumption:
# [{ "uri": "resource://session/chain-quick_decision#1", "name": "chain-quick_decision#1", ... }]

# Get details for a specific chain
ReadMcpResourceTool uri="resource://session/chain-quick_decision#1"

# Resume the chain directly using the chainId
prompt_engine(chain_id:"chain-quick_decision#1", user_response:"your output here")
```

<details>
<summary><strong>Example Usage (MCP Protocol)</strong></summary>

```json
// List all prompts
{"method": "resources/list"}

// Read a specific prompt
{"method": "resources/read", "params": {"uri": "resource://prompt/code_review"}}

// Read just the template
{"method": "resources/read", "params": {"uri": "resource://prompt/code_review/template"}}

// Check active sessions (context recovery)
{"method": "resources/read", "params": {"uri": "resource://session/"}}

// Get pipeline metrics
{"method": "resources/read", "params": {"uri": "resource://metrics/pipeline"}}
```

</details>

### Resources vs Tools — When to Use What

Both MCP Resources and `resource_manager` tool can list/inspect content. Use the right one:

| Need                               | Use       | Why                                    |
| ---------------------------------- | --------- | -------------------------------------- |
| **Discovery** (list, browse)       | Resources | 4-30x fewer tokens                     |
| **Inspection** (read details)      | Resources | Direct URI, no params needed           |
| **Context recovery**               | Resources | Sessions use `chainId` directly        |
| **Create/Update/Delete**           | Tools     | Resources are read-only                |
| **Filtered search**                | Tools     | `filter:"category:analysis"` supported |
| **Client lacks resources support** | Tools     | Fallback compatibility                 |

**Default rule: Resources for READ, Tools for WRITE.**

```bash
# ✅ Preferred: Use resources for discovery
ReadMcpResourceTool uri="resource://prompt/"

# ⚠️ Fallback: Use tools only if resources unavailable or need filtering
resource_manager(resource_type:"prompt", action:"list", filter:"category:analysis")

# ✅ Required: Use tools for mutations
resource_manager(resource_type:"prompt", action:"create", id:"my-prompt", ...)
```

### Hot-Reload Notifications

When prompts or gates are modified (via `resource_manager` or file changes), connected clients receive a `notifications/resources/list_changed` event. Use this to refresh cached resource lists.

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

# With framework
prompt_engine(command:"@CAGEERF security_audit target:'auth module'")

# With inline quality gates
prompt_engine(command:"research topic:'LLMs' :: 'cite sources, note confidence'")

# Full chain with everything
prompt_engine(command:"@ReACT analysis --> synthesis --> report :: 'include data'")
```

#### Quoting and escapes in argument values

Quoted values are unescaped when parsed, so **a backslash inside a quoted value is an escape
character, not a literal backslash**:

| You write               | The prompt receives | Note                                               |
| ----------------------- | ------------------- | -------------------------------------------------- |
| `path:'C:\Users\dev'`   | `C:Usersdev`        | ⚠️ each `\` is consumed                            |
| `path:'C:\\Users\\dev'` | `C:\Users\dev`      | escape it to keep it                               |
| `sep:'a\nb'`            | `a`, newline, `b`   | `\n` `\t` `\r` `\b` `\f` and `\uXXXX` are honoured |
| `note:'it\'s fine'`     | `it's fine`         | escaping a quote works                             |
| `note:"it's fine"`      | `it's fine`         | or just use the other quote                        |

**Double any backslash you mean literally** — Windows paths and regexes are the common cases.

This applies only to values typed into `command`. Values passed through `inputs` or `options`
bypass the command grammar and retain their original JSON types, so paths, regular expressions,
nested objects, and arrays arrive exactly as sent. Use `inputs` for prompt arguments; `options` is
the legacy/execution-hint channel. Resolution precedence is: explicit inline argument → `inputs`
→ `options` → prompt default.

### Operators Quick Reference

| Operator     | Syntax         | Example                    | Purpose                                 |
| ------------ | -------------- | -------------------------- | --------------------------------------- |
| Framework    | `@NAME`        | `@CAGEERF prompt`          | Apply framework                         |
| Chain        | `-->`          | `step1 --> step2`          | Sequential execution                    |
| Delegation   | `==>`          | `step1 ==> step2`          | Hand off step to sub-agent              |
| Repetition   | `* N`          | `>>prompt * 3`             | Repeat with same args (chain shorthand) |
| Gate (anon)  | `:: "text"`    | `:: 'cite sources'`        | Anonymous quality criteria              |
| Gate (named) | `:: id:"text"` | `:: security:"no secrets"` | Named gate with trackable ID            |
| Style        | `#id`          | `#analytical`              | Response formatting                     |

**Repetition (`* N`) - Same Arguments:**

The `* N` operator unfolds to a chain with **identical arguments** on each step:

```bash
# Expansion: >>brainstorm topic:'ideas' --> >>brainstorm topic:'ideas' --> ...
prompt_engine(command:">>brainstorm * 5 topic:'startup ideas'")

# Mid-chain repetition: >>analyze --> >>analyze --> >>summarize
prompt_engine(command:">>analyze * 2 --> >>summarize")

# Each iteration uses the same plan_path
prompt_engine(command:">>strategic_implement * 3 plan_path:'./plan.md'")
```

**Varied Arguments per Step (use explicit chain):**

For **different arguments** on each step, use explicit `-->` chain syntax instead:

```bash
# Different topics per research step
prompt_engine(command:">>research topic:'A' --> >>research topic:'B' --> >>compare")

# Different inputs per validation step
prompt_engine(command:">>validate input:'step1' --> >>validate input:'step2' --> >>synthesize")
```

**Repetition vs Chain Decision:**

| Pattern     | Syntax                  | Use When                                                   |
| ----------- | ----------------------- | ---------------------------------------------------------- |
| Same-args   | `>>p * N`               | Same task repeated for variety (brainstorming, validation) |
| Varied-args | `>>p arg1 --> >>p arg2` | Different inputs per step                                  |

> **Context propagation:** Each chain step receives the previous step's output automatically, regardless of whether you use `* N` or explicit chains.

**Style examples:**

```bash
# Apply analytical style to a report
prompt_engine(command:"#analytical report topic:'Q4 metrics'")

# Combine style with framework
prompt_engine(command:"#procedural @CAGEERF tutorial subject:'React hooks'")

# Available styles: analytical, procedural, creative, reasoning
```

### Modifiers (Put First)

| Modifier     | Effect                            |
| ------------ | --------------------------------- |
| `%clean`     | No framework/gate injection       |
| `%lean`      | Gates only, skip framework        |
| `%judge`     | Show guidance menu, don't execute |
| `%framework` | Framework only, skip gates        |

```bash
# Skip all injection for quick iteration
prompt_engine(command:"%clean my_prompt input:'test'")

# Get framework/gate recommendations without executing
prompt_engine(command:"%judge analysis_report")
```

<details>
<summary><strong>Parameters</strong></summary>

| Parameter       | Type    | Purpose                                                                                                                                                                                                                                                          |
| --------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`       | string  | Prompt ID with operators and arguments                                                                                                                                                                                                                           |
| `chain_id`      | string  | Resume token for continuing chains                                                                                                                                                                                                                               |
| `user_response` | string  | Your output from previous step (for chain resume)                                                                                                                                                                                                                |
| `gate_verdict`  | string  | Gate review verdict. Preferred: `GATE_REVIEW: PASS/FAIL - reason`. Also accepts `GATE PASS/FAIL - reason` or minimal `PASS/FAIL - reason` (minimal only via `gate_verdict`, not parsed from `user_response`). Rationale required.                                |
| `gate_action`   | enum    | Your move on a run that is waiting for one. After a FAILED GATE with retries exhausted: `retry`, `skip`, `abort`. On a run PAUSED by a blocking unknown: `resume`, `accept_alternative`, `abort`. See [Blocking-unknown interrupt](#blocking-unknown-interrupt). |
| `gates`         | array   | Quality gates (IDs, quick checks, or full definitions)                                                                                                                                                                                                           |
| `force_restart` | boolean | Restart chain from step 1                                                                                                                                                                                                                                        |
| `inputs`        | object  | Typed prompt arguments. Nested objects and arrays stay structured; explicit inline arguments win on key conflicts.                                                                                                                                               |
| `options`       | object  | Legacy prompt values and execution hints. Supports `client_profile` (`clientFamily`, `clientId`, `clientVersion`, `delegationProfile`) when transport metadata is unavailable.                                                                                   |
| `observations`  | array   | Typed unknowns discovered/resolved this step, feeding the per-run unknowns ledger. See [Unknowns Ledger](#unknowns-ledger).                                                                                                                                      |
| `workflow`      | object  | A structured multi-step run submitted instead of a command string. Mutually exclusive with `command` and `chain_id`. See [Workflow Submission](#workflow-submission).                                                                                            |
| `remainder`     | object  | Rewrite the rest of a running chain after a blocking unknown invalidated its shape. `{mode:'replace'\|'append', nodes:[…], edges?:[…]}`, requires `chain_id`. See [Blocking-unknown interrupt](#blocking-unknown-interrupt).                                     |

</details>

### Chain Execution

For step schemas, input mapping, and retries, see the [Chain Schema Reference](./chain-schema.md).

Each step is addressed internally by a stable node id, not by its position. A YAML step may set
`id:` explicitly (kebab-case, unique within the chain); when omitted, the id defaults to a slug of
`stepName`. Symbolic chains (`>>step1 --> >>step2`, no YAML) have no step names to slug, so the
parser mints frozen `n1`, `n2`, … ids once at parse time instead. Either form is a stable node id
you can hand to `target_step_id` — see [Chain Step Targeting](#chain-step-targeting) below. Client
integrations that only track position are unaffected: `chain_id`, resume, and every response shape
still speak integer step numbers.

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

````bash
prompt_engine(
  chain_id:"chain-research#2",
  gate_verdict:"GATE_REVIEW: PASS - All sources cited"
)

**Combined resume (recommended for token efficiency):**

```bash
prompt_engine(
  chain_id:"chain-research#2",
  user_response:"Step 2 output...",
  gate_verdict:"GATE_REVIEW: PASS - criteria met"
)
````

Notes:

- Verdicts are only read from `gate_verdict`; they are not parsed from `user_response`.
- On PASS without an existing review, the chain continues; on FAIL, a review screen is created with context. Use `gate_action:"retry|skip|abort"` when retries are exhausted.

````

### Gates: Four Ways to Validate

For gate configuration, enforcement modes, and custom definitions, see the [Gate Configuration Reference](./gate-configuration.md).

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
````

**Named inline gates** (`:: id:"criteria"`) are useful when you want:

- Trackable gate IDs in output (shows as "security" not "Inline Validation Criteria")
- Multiple distinct validation criteria in one command
- Self-documenting commands that LLMs can parse unambiguously

### Chain Step Targeting

A full gate definition may target one chain step by 1-based position (`target_step_number`) or by
its stable node id (`target_step_id`) — supply whichever you have. A position target is
cross-resolved to a node id once, at gate registration, against the node list as it exists at
that moment; from then on the gate is bound to that node id, and selection matches on node id
first, falling back to the ordinal only for gates or chains carrying no node id. This matters once
a run can mutate (see [Adaptive Mutation](#adaptive-mutation)): binding by node id means an
insertion ahead of the gate's target cannot silently retarget it to whatever step now sits at that
ordinal. A gate whose target node is later skipped never fires — see below.

```bash
# Target by position
prompt_engine(command:"draft-outline --> draft --> polish", gates:[
  {
    "name": "Outline covers required sections",
    "description": "Every required section is listed before drafting begins",
    "target_step_number": 1
  }
])

# Same target, addressed by the step's node id instead
prompt_engine(command:"draft-outline --> draft --> polish", gates:[
  {
    "name": "Outline covers required sections",
    "description": "Every required section is listed before drafting begins",
    "target_step_id": "draft-outline"
  }
])
```

An unresolvable `target_step_id` (no step in the run carries it) is warned and selects nothing —
it is never silently widened to apply to every step. A `target_step_id` that resolves to a node
later retired by the adaptive mutation policy (`milestone:"skipped"`) also selects nothing — the
guard is checked per-call against the run's live node list, not just once at registration.

### Visibility Policy

A `chainSteps` entry in `prompt.yaml` may declare `visibility`, withholding or exposing named
chain-run context items from later steps' default render:

```yaml
chainSteps:
  - promptId: analyze
    stepName: Analyze (step 1)
    visibility:
      withhold: [previous_step_output]
```

`withhold` and `expose` each take zero or more items from the fixed vocabulary
`previous_step_output | chain_history | unknowns_ledger`. An unrecognized item fails the prompt's
load, naming the allowed values. A step's `withhold` affects every LATER step's default render,
never its own; a later step's `expose` overrides that withhold for itself only. No `visibility`
declared anywhere in a chain renders byte-identically to a build without this feature.

A delegated (`==>`) step's envelope excludes withheld items and reports their names on one
manifest line so the sub-agent knows what it does not have. See [Visibility
Policy](../concepts/chains-lifecycle.md#visibility-policy) for full semantics, the per-item
meaning, and its honest ceiling.

### Workflow Submission

`prompt_engine` accepts a **third command source** beside a command string and a chain resume: a
structured Workflow IR on the `workflow` parameter. It expresses what the string grammar cannot —
stable node ids, per-step visibility, gate bindings, delegation hints, input/output mappings and a
declared budget.

```bash
prompt_engine(workflow:{
  version: 1,
  nodes: [
    { id: "research", promptId: "research_docs", args: { topic: "caching" } },
    { id: "review",   promptId: "code_review",   subagentModel: "fast",
      visibility: { withhold: ["chain_history"] } }
  ],
  edges: [{ from: "research", to: "review" }],
  gates: [{ id: "source-quality", target_step_id: "research" }],
  budget: { maxInsertions: 1, declaredCostCeiling: 50000 }
})
```

The call returns the run's first step and a `chain_id`; resume it like any other chain. An accepted
workflow **is** an ordinary chain run — the `chain_runs` and `chain_run_nodes` rows are
structurally identical to an equivalent `>>chain`'s, and node ids are the same id space
`target_step_id` addresses (see [Chain Step Targeting](#chain-step-targeting)).

| Rule                         | Behavior                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exactly one source**       | `command`, `chain_id` and `workflow` are mutually exclusive. Two of them is a rejection, never a precedence decision.                                       |
| **Edges are order**          | Edges are dependencies, linearized into one run order (ties broken by declaration order). There is no branching. With no edges the order is `nodes[]`.      |
| **Caps narrow only**         | `maxNodes` (32), `maxFanOut` (8), `maxInsertions` (3) are enforced; a budget asking for more is rejected, never clamped. `declaredCostCeiling` is recorded. |
| **Rejection writes nothing** | An invalid workflow returns one addressed line per problem and creates no run, no session, no version.                                                      |
| **`gates` still works**      | A workflow's own `gates` and the `gates` parameter are concatenated, not exclusive.                                                                         |

A rejection names its subject and its rule:

```
❌ Workflow rejected — 2 problems found. Nothing was executed and no run was created.

• [unknown-prompt] node "draft": Node "draft" references prompt "write_summry", which is not registered
• [cap-exceeded] workflow: budget.maxNodes of 64 exceeds the server cap of 32; a declared budget may only narrow a cap, never widen it
```

Full field reference, the linearization rule, and the complete rejection vocabulary:
[Workflow IR Reference](./workflow-ir.md).

#### Compiling a plan tier into a submission

You rarely hand-write a submission. `>>strategic_implement` compiles one from a tier-gated plan
file — the table `>>implementation_plan` emits — one tier per submission:

| Plan artifact                   | Compiles to                                                               |
| ------------------------------- | ------------------------------------------------------------------------- |
| Row id `1.2` in tier T1         | Node id `t1-2` (kebab slug; edges and gates address it)                   |
| The row's Change text           | `stepName`                                                                |
| The row's Depends column        | `edges` — `{ "from": "t1-1", "to": "t1-2" }`                              |
| `gates: <id>` in a row's Verify | That node's `inlineGateIds`, so review fires ON the row                   |
| The tier's gate criterion       | A run-level gate whose `target_step_id` is the tier's LAST node id        |
| `execution_dispatch` Agent cell | `subagentModel` (`heavy`/`standard`/`fast`); `main thread` emits no field |
| A delegated row                 | A node whose `promptId` is `strategic_worker` — the worker brief          |

A row with no Depends keeps its declared place, which is what the linearization does with it
anyway. Rows already marked ✓ are skipped. Gate verdicts, tier acceptance, open-question rulings,
handoff acceptance, branch merges, and the scope check are never compiled into a node — they stay
with the calling planner session, which dispatches rows rather than editing source. `subagentModel`
is a hint and binds nothing; the `Agent` tool binds a model per spawn and `Workflow` `agent()` binds
model plus effort.

### Shell Verification Gates (Ralph Mode)

Ground-truth validation via shell command exit codes. Exit 0 = PASS, non-zero = FAIL.

```bash
# Basic verification
prompt_engine(command:">>implement :: verify:'npm test'")

# With preset (controls retry limits)
prompt_engine(command:">>fix-bug :: verify:'pytest' :full")

# Presets: :fast (1 attempt), :full (5), :extended (10)
prompt_engine(command:">>refactor :: verify:'cargo test' :extended")

# Explicit options override presets
prompt_engine(command:">>feature :: verify:'npm test' max:8 timeout:120")

# Autonomous loop (Stop hook integration)
prompt_engine(command:">>bugfix :: verify:'npm test' :full loop:true")
```

**How it works:**

1. Command runs after each response
2. If FAIL + attempts remain → bounce-back (Claude retries automatically)
3. If FAIL + max reached → escalation (user chooses `retry`/`skip`/`abort` via `gate_action`)
4. With `loop:true` → Stop hook blocks completion until tests pass

**Presets:**

| Preset      | Attempts | Timeout |
| ----------- | -------- | ------- |
| `:fast`     | 1        | 30s     |
| `:full`     | 5        | 5 min   |
| `:extended` | 10       | 10 min  |

**Options:**

| Option      | Description                             |
| ----------- | --------------------------------------- |
| `max:N`     | Override max attempts                   |
| `timeout:N` | Override timeout in seconds             |
| `loop:true` | Enable autonomous Stop hook integration |

See [Ralph Loops Guide](../guides/ralph-loops.md) for advanced patterns including context isolation and checkpoints.

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

### Script Tool Execution

Prompts can include script tools that auto-trigger when user args match the tool's JSON schema. This enables wizard-style meta-prompts.

**Two-Phase UX:**

| Phase            | What Happens                                         | Example                                                                                   |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Design**       | Args don't match schema → Template shows guidance    | `>>create_gate name:"Code Quality"`                                                       |
| **Validation**   | Args match schema → Script runs, results in template | `>>create_gate id:"code-quality" name:"Code Quality" type:"validation" description:"..."` |
| **Auto-Execute** | Script returns `valid: true` → MCP tool called       | Creates gate via `resource_manager`                                                       |

**Design phase** (missing required fields — shows guidance):

```bash
prompt_engine(command:">>create_gate name:'Code Quality'")
# Result: Template renders design guidance with field descriptions
```

**Validation phase** (all required fields — script runs):

```bash
prompt_engine(command:">>create_gate id:'code-quality' name:'Code Quality' type:'validation' description:'Ensures code meets standards' guidance:'Check naming, error handling, tests'")
# Result: Script validates → returns {valid: true, auto_execute: {...}} → gate created
```

**Available meta-prompts:**

- `>>create_gate` — Quality gate authoring
- `>>create_prompt` — Prompt/chain authoring
- `>>create_framework` — Framework authoring

`>>create_prompt` uses a stricter lifecycle than the older auto-create examples: design →
`resource_manager(action:"validate")` → user confirmation → `action:"create"` → render smoke
test. Its adapter only maps author-facing field names; canonical validation and writes remain in
`resource_manager`.

See [Script Tools Guide](../guides/script-tools.md) for building your own.

> [!TIP]
> **New to prompts?** The [Build Your First Prompt](../tutorials/build-first-prompt.md) tutorial gets you from zero to a working prompt in under 5 minutes.

---

## `resource_manager` — Unified Resource Management

Create, update, delete, and manage prompts, gates, frameworks, and prompt categories through a single unified interface.

### Basic Syntax

```bash
resource_manager(resource_type:"prompt|gate|framework|category", action:"...", ...)
```

### Resource Types

| Type        | Description                     | Specific Actions                         |
| ----------- | ------------------------------- | ---------------------------------------- |
| `prompt`    | Template and chain management   | `analyze_type`, `analyze_gates`, `guide` |
| `gate`      | Quality validation criteria     | —                                        |
| `framework` | Execution frameworks            | `switch`                                 |
| `category`  | A prompt category's declaration | —                                        |

**`category` manages a `category.yaml`, not the directory of prompts around it.** A category
exists because a directory exists under the prompts root; `category.yaml` is the optional document
that gives it a name, a description, and the two MCP defaults its prompts inherit. So `create`
succeeds on a directory that already holds prompts — that is the first declaration, not a
duplicate — and `delete` removes the declaration and leaves every prompt in place, falling the
category back to a name and description derived from its directory name. The directory is removed
only when the declaration was the last thing in it.

`reload` takes no `id` for this type. There is no per-category registry entry; the whole category
set is rebuilt by the same walk that loads prompts.

### Common Actions

All resource types support these actions:

| Action     | Purpose                  | Required Params                      | Note                                   |
| ---------- | ------------------------ | ------------------------------------ | -------------------------------------- |
| `list`     | List all resources       | —                                    | _Prefer `resource://` URIs_            |
| `inspect`  | Get resource details     | `id`                                 | _Prefer `resource://` URIs_            |
| `validate` | Preview prompt creation  | `id`, `name`, `description`, content | Prompt-only; never writes              |
| `preview`  | Render a mutation        | `id`, `preview_action`               | Never writes; takes no `confirm`       |
| `create`   | Create new resource      | `id`, type-specific                  |                                        |
| `update`   | Modify existing resource | `id`, fields to update               |                                        |
| `delete`   | Remove resource          | `id`, `confirm:true`                 | `preview_action:"delete"` to preview   |
| `reload`   | Hot-reload from disk     | `id` (optional)                      |                                        |
| `history`  | View version history     | `id`                                 |                                        |
| `rollback` | Restore previous version | `id`, `version`, `confirm:true`      | `preview_action:"rollback"` to preview |
| `compare`  | Compare two versions     | `id`, `from_version`, `to_version`   |                                        |

> **Note:** For `list` and `inspect`, prefer [MCP Resources](#mcp-resources--token-efficient-discovery) (4-30x more token efficient). Use tool actions as fallback when filtering is needed or client doesn't support resources.

### Prompts

```bash
# List all prompts (prefer resources)
ReadMcpResourceTool uri="resource://prompt/"

# Filter by category (use tools when filtering needed)
resource_manager(resource_type:"prompt", action:"list", filter:"category:analysis")

# Get prompt details (prefer resources)
ReadMcpResourceTool uri="resource://prompt/security_audit"

# Create a prompt
resource_manager(
  resource_type:"prompt",
  action:"validate",
  id:"weekly_report",
  name:"Weekly Report Generator",
  category:"reporting",
  description:"Generates formatted weekly status report",
  user_message_template:"Generate a weekly report for {{team}} covering {{date_range}}",
  arguments:[
    {"name":"team", "type":"string", "required":true},
    {"name":"date_range", "type":"string", "required":true, "defaultValue":"this_week"}
  ]
)

# After reviewing the normalized draft, repeat the same call with action:"create".

# Update a prompt
resource_manager(resource_type:"prompt", action:"update", id:"weekly_report", description:"Updated")

# Delete a prompt
resource_manager(resource_type:"prompt", action:"delete", id:"old_prompt", confirm:true)

# Get execution type recommendation
resource_manager(resource_type:"prompt", action:"analyze_type", id:"my_prompt")

# Get gate suggestions
resource_manager(resource_type:"prompt", action:"analyze_gates", id:"my_prompt")
```

If `category` isn't shipped in the repo — excluded by `server/resources/prompts/.gitignore` —
`create` and `update` still succeed, and the response appends a warning naming the file and the
exact `!<category>/` and `!<category>/**` lines to add to ship it. A workspace overlay with no
`.gitignore` of its own never warns.

#### Prompt Authoring and Maintenance

`action:"validate"` runs the same prompt-ID, content-union, template, reference, argument, chain,
gate, and complete script-tool checks as `create`, but writes no file, records no version, and does
not refresh the registry. Creation accepts inline content only: `user_message_template`, non-empty
`chain_steps`, or `system_message`. Author-provided file paths are not part of the tool contract.
Script tools must be complete definitions containing at least `id`, `name`, and executable
`script`; an array of tool IDs is not a creation payload.

Successful prompt writes return a machine-readable receipt with `config_path`, `server_root`,
`resource_root`, `affected_files`, category ship status, refresh status, whether the expected state
loaded after refresh, and the current version. A write whose refreshed registry does not match the
produced prompt is reported as an error, even when the filesystem transaction itself succeeded.

Any `resource_manager` result that carries both readable `content` text and `structuredContent` —
`validate`, `create`, `preview`, `update`, and `inspect` all do — also carries the same text in
`structuredContent.message`. Some MCP clients hand the model only `structuredContent` when a
result carries both, so a client reading solely the JSON half still receives the write receipt,
preview notice, or validation outcome. A result with `content` text only is unaffected.

Maintain an existing prompt through one bounded sequence:

```text
inspect(detail:"full")
→ preview(preview_action:"update", expected_version:<current_version>)
→ approval
→ update(expected_version:<current_version>)
→ reload
→ prompt_engine render smoke test
→ retain the write receipt
```

`expected_version` is an optimistic-concurrency token. A stale value returns the current version
and writes nothing; it cannot be combined with `skip_version:true`, because then the token would
not advance.

#### Patch Mode (Partial Update)

`action:"update"` accepts a `patch` array instead of (or alongside) full-body parameters — edit
one anchor in a text field without retransmitting the whole template:

```bash
resource_manager(
  resource_type:"prompt",
  action:"update",
  id:"weekly_report",
  patch:[
    {"field":"user_message_template", "old_string":"{{team}}", "new_string":"{{team_name}}"}
  ]
)
```

Send the identical payload with `action:"preview"` and `preview_action:"update"` to see the result
first:

```bash
resource_manager(
  resource_type:"prompt",
  action:"preview",
  preview_action:"update",
  id:"weekly_report",
  patch:[
    {"field":"user_message_template", "old_string":"{{team}}", "new_string":"{{team_name}}"}
  ]
)
```

Each operation is `{field, old_string, new_string, replace_all?}`:

| Field         | Type                                                               | Notes                                                                    |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `field`       | enum: `user_message_template` \| `system_message` \| `description` | which text body to edit                                                  |
| `old_string`  | string, min length 1                                               | must match the current text exactly and (without `replace_all`) uniquely |
| `new_string`  | string                                                             | replacement text — empty string deletes the anchor                       |
| `replace_all` | boolean, optional                                                  | replace every occurrence instead of rejecting an ambiguous anchor        |

Operations apply in order, each against the previous one's output. A patch that cannot be applied
is rejected as a whole — nothing is written and no version is consumed:

| Rejection reason   | Cause                                                          |
| ------------------ | -------------------------------------------------------------- |
| `empty_old_string` | `old_string` was empty                                         |
| `target_absent`    | the prompt has no text for that field                          |
| `anchor_not_found` | the anchor does not occur in the field's current text          |
| `anchor_ambiguous` | the anchor occurs more than once and `replace_all` was not set |

`patch` cannot be combined with the full-body parameter it targets in the same call: sending
`user_message_template` or `system_message` alongside any `patch` operation is rejected, and
sending `description` alongside a patch that targets `description` is rejected the same way — send
one or the other. `action:"preview"` with `preview_action:"update"` renders the produced text and a
diff without writing anything or consuming a version; resend as `action:"update"` to apply it.
`patch` is update-only, and `action:"create"` rejects both it and `preview_action` explicitly,
since there is no existing prompt to patch or diff against.

#### Argument Updates (Partial Argument Edit)

`action:"update"` also accepts `argument_updates` — a structured, per-field overlay onto
**existing** arguments, addressed by `name`, for when only one argument's `description`, `type`,
`required`, `defaultValue`, or `validation` needs to change and resending the whole `arguments`
array would be wasteful:

```bash
resource_manager(
  resource_type:"prompt",
  action:"update",
  id:"weekly_report",
  argument_updates:[
    {"name":"team", "description":"Team or org name to summarize"}
  ]
)
```

Each entry is `{name, description?, type?, required?, defaultValue?, validation?}` — the same
shape as an `arguments` entry. `name` must match an argument the prompt already declares; there is
no upsert, so adding, removing, or renaming an argument still requires the full `arguments` array.
Every other field overlays onto the matched entry only when supplied — an omitted field leaves
that entry's current value untouched, and every argument not named by an update is unchanged.

`argument_updates` is mutually exclusive with `arguments` in the same call (send one or the
other), update-only like `patch` — `action:"create"` rejects it explicitly, since there is no
existing argument to overlay updates onto. Send the same payload as `action:"preview"` with
`preview_action:"update"` to see the merge before spending a version.

### Removing a field (`unset`)

Supplying a value SETS it; omitting it PRESERVES it. Neither says REMOVE, so clearing a field has
its own parameter:

```bash
resource_manager(
  resource_type:"prompt", action:"update", id:"my_prompt",
  unset:["system_message", "gate_configuration"]
)
```

This matters more than it looks. `system_message:""` writes an _empty_ system message rather than
dropping the key, and for the fields the writer carries forward off disk — `tools`, `injection`,
`register_with_mcp`, `mcp_prompt_mode`, `subagent_model`, `agent_type`, `composer` — omission is
already the signal to keep the current value, so before `unset` they could not be cleared at all.

Unsetting `system_message` also deletes `system-message.md`, so no orphan file is left pointing at
nothing.

**Prompts only.** `unset` is a prompt parameter, and sending it with `resource_type:"gate"`,
`"framework"` or `"category"` is refused by name before anything is written — removing a field
from those resources is not implemented, and the call used to answer "updated successfully", spend
a version, and change nothing. That refusal is not special to `unset`: every parameter the
tool publishes names the resource types that read it, and sending one to a type that does not read
it is refused rather than ignored.

**Refused by name:** `name`, `category`, `description`, `user_message_template`. They stay fully
settable — send a new value to change one — but a prompt missing any of them does not load, so
clearing them is not offered. Sending a field and unsetting it in the same call is also refused,
rather than resolved in an order you cannot see.

**Script tools have their own remove verb**, because unbinding and deleting are different acts:

| Call                                                          | Binding    | `tools/{id}/` on disk |
| ------------------------------------------------------------- | ---------- | --------------------- |
| `tools:[...]` (narrowed array)                                | replaced   | **kept**              |
| `unset:["tools"]`                                             | cleared    | **kept**              |
| `tool_operation:"add"` + `tools:[...]`                        | unioned    | written               |
| `tool_operation:"remove"` + `tool_ids:[...]` + `confirm:true` | subtracted | **deleted**           |

Only the last row destroys a file you sent no replacement for, which is why it is the only
`update` that requires `confirm:true`.

### Undeclared parameters

**All three tools refuse an argument key their contract does not declare, naming the key.** This is
a security property, not a tidiness one — see [Why this is a security
property](#why-this-is-a-security-property) below.

```
'chain_step' is not a parameter of resource_manager.
'force_restrt' is not a parameter of prompt_engine.  Did you mean 'force_restart'?
'previw' and 'confirmed' are not parameters of system_control.
```

One refusal serves all three (`server/src/mcp/tools/shared/undeclared-parameters.ts`). It reads the
declared key set from the tool's **contract** (`server/tooling/contracts/*.json`) — the same set
`tools/list` publishes and a client validates against — names **every** undeclared key in one
message, and suggests the nearest declared name when the spelling is close (`enforcementMode` →
`enforcement_mode`). The refusal happens before dispatch, so nothing is written and no version is
spent.

`resource_manager` has a second, narrower refusal beside it: a parameter that IS declared but
belongs to another `resource_type` is refused naming the types that read it (see the per-type
refusal above). That one names only the first offender, because the owner list is the same
correction for all of them.

#### A declared parameter the current state does not advertise

`prompt_engine` publishes a **union**: `gates`, `gate_verdict` and `gate_action` appear in
`tools/list` only while the gate system is enabled. A client holding a stale `tools/list` that
still sends one gets its own message, not "not a parameter" — the contract does name it:

```
'gate_verdict' is a parameter of prompt_engine, but not one this server is advertising right now:
the gate system is disabled, so nothing reads a gate parameter. Enable it with
`system_control action:"gates", operation:"enable"`, or drop it from this call.
```

#### Why this is a security property

Until this refusal, an undeclared key was accepted, read by nobody, and the call answered
**success**. Measured over both transports before the fix: `prompt_engine {command, force_restrt}`
returned a normal prompt list, and `system_control {action:"status", previw:true}` returned a normal
status overview — both `isError: false`.

The cost is not a dropped convenience flag. A caller — or a model following a prompt-injected
instruction — that sends a **safety** flag under a slightly wrong name got a success reply while the
server did the unguarded thing: a `preview` / `confirm` / `persist` typo ran the guarded action
unguarded.
This repository has already paid that once, through exactly this mechanism: a `skills_sync` preview
wrote 33 real files because the registered schema dropped the undeclared flag. Refusing by name
turns the whole class into a loud error at the boundary.

#### Scope

- **Top-level `arguments` keys only.** `_meta` is a client-protocol field carried on `params`,
  beside `arguments`, never inside it, so it is out of reach and needs no exemption.
- **Nested object keys are covered too, by a different mechanism.** Every object schema reachable
  from a tool's parameters refuses an unknown key, naming the path it sits at
  (`arguments.0: Unrecognized key: "requred"`). That is zod's own refusal rather than the
  suggestion-carrying one above: a nested key is rejected during validation, so the call never
  reaches the handler that would name a correction. `tests/unit/mcp-tools/nested-object-strictness.test.ts`
  walks the whole reachable graph and fails on any object that is neither closed nor listed below,
  so a new nested object cannot join the class unclassified.
- **Deliberately open, with reasons** — the only objects where an unknown key still survives:
  - the three tools' top-level parameters, so the refusal above can name the key and suggest a fix;
  - `chain_steps[]` and `chain_step_data`, because a chain step is an opaque object by decision
    (contrast the sibling `arguments`, which is a typed contract).
- **`gate_verdict` names the full path and the nearest declared key.** It is a union of the
  structured object and the legacy string, and a union failure is reported as ONE issue whose
  sub-issues are nested, which the SDK does not render — so this parameter alone used to answer
  `gate_verdict: Invalid input`, naming neither the key nor its position. It now answers
  `'gate_verdict.per_gate[0].pased' is not a declared key — did you mean 'passed'?`, built from
  the sub-issues that one validation pass already produced. Which branch reports is decided by the
  value's own type: an object gets the structured branch's errors, a string gets the verdict-format
  message, anything else is told what the parameter takes. The legacy string form is unchanged, and
  the published `anyOf` is byte-identical to what it was.
- **A criterion has no `description`.** `pass_criteria[]` declares the fields each `type` reads and
  nothing else; a `description` on a criterion is refused. Nothing reads one — the reviewer-facing
  prose is the gate's own `guidance`, which is what the criteria summary renders.
- **Published schemas stay open at the top level.** `additionalProperties` is not set to `false` on
  a tool's own parameters, deliberately: the key has to ARRIVE for the server to name it and suggest
  a correction. Nested objects DO publish `additionalProperties: false`, which is what lets a client
  catch a nested typo before it sends.
- **Script tools are covered too** — see
  [script-tools.md § Security Model](../guides/script-tools.md#security-model).

### Chain edges

A chain may declare `edges` beside its steps — `{from, to}` dependency constraints naming step ids
(an explicit step `id`, or the kebab slug minted from `stepName`). They are ordering constraints,
never control flow; see [chain-schema.md](chain-schema.md#edges) for what the loader does with them.

**Edges and steps are one state.** An edge naming a step the chain does not declare, or a cycle, is
refused and the whole write is rolled back. So a `chain_steps` rewrite that drops a step an edge
still names must send the corrected `edges` in the same call:

```bash
resource_manager(
  resource_type:"prompt", action:"update", id:"my_chain",
  chain_steps:[{promptId:"research", stepName:"Research"}, {promptId:"draft", stepName:"Draft"}],
  edges:[{from:"research", to:"draft"}]
)
```

To drop every edge and keep the authored step order instead, send `unset:["edges"]`. Omitting
`edges` PRESERVES whatever the prompt already declares, like every other carried-forward field.

### Gates

```bash
# List all gates (prefer resources for discovery)
ReadMcpResourceTool uri="resource://gate/"

# Inspect gate (prefer resources — includes inline guidance)
ReadMcpResourceTool uri="resource://gate/source-verification"

# Guidance only (resources-exclusive)
ReadMcpResourceTool uri="resource://gate/source-verification/guidance"

# Create a gate (tools required)
resource_manager(
  resource_type:"gate",
  action:"create",
  id:"source-verification",
  name:"Source Verification",
  type:"validation",
  description:"Ensures all claims are properly sourced",
  guidance:"All factual claims must cite sources; sources must be authoritative. No unsourced statistics.",
  pass_criteria:[{type:"inline_guidance"}]
)

# Update a gate
resource_manager(resource_type:"gate", action:"update", id:"source-verification", guidance:"Updated guidance...")

# Delete a gate
resource_manager(resource_type:"gate", action:"delete", id:"old-gate", confirm:true)
```

### Frameworks

```bash
# List all frameworks (prefer resources for discovery)
ReadMcpResourceTool uri="resource://framework/"

# Inspect framework (prefer resources — full content)
ReadMcpResourceTool uri="resource://framework/cageerf"

# Switch active framework (tools required)
resource_manager(resource_type:"framework", action:"switch", id:"react", persist:true)

# Create a custom framework
resource_manager(
  resource_type:"framework",
  action:"create",
  id:"my-method",
  name:"My Custom Framework",
  description:"A custom problem-solving framework",
  system_prompt_guidance:"Apply my framework systematically...",
  phases:[
    {"id":"phase1", "name":"Define", "description":"Define the problem"},
    {"id":"phase2", "name":"Solve", "description":"Implement solution"}
  ]
)
```

### Categories

```bash
# List every category across the bundled, primary and overlay prompt roots
resource_manager(resource_type:"category", action:"list")

# Inspect one — renders only what category.yaml declares
resource_manager(resource_type:"category", action:"inspect", id:"analysis")

# Author the declaration a directory of prompts never had
resource_manager(
  resource_type:"category",
  action:"create",
  id:"analysis",
  name:"Analysis",
  description:"Analytical and research prompts",
  mcp_prompt_mode:"launch"
)

# Change one field; the rest is carried forward from the file
resource_manager(resource_type:"category", action:"update", id:"analysis", description:"Updated")

# Remove the declaration. Prompts in the directory are NOT removed.
resource_manager(resource_type:"category", action:"delete", id:"analysis", confirm:true)
```

<details>
<summary><strong>Key Parameters by Resource Type</strong></summary>

**Prompt Parameters:**

| Parameter               | Purpose                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `category`              | Prompt category tag                                                                                                                                            |
| `user_message_template` | Prompt body with `{{variables}}`                                                                                                                               |
| `system_message`        | Optional system message                                                                                                                                        |
| `arguments`             | Array of `{name, type?, required?, description?, defaultValue?, validation?}`                                                                                  |
| `argument_updates`      | Update-only per-field overlay onto existing arguments by `name` — see [Argument Updates](#argument-updates-partial-argument-edit)                              |
| `patch`                 | Anchored replacements for `update` — see [Patch Mode](#patch-mode-partial-update)                                                                              |
| `preview_action`        | With `action:"preview"`: which mutation to render — `update` (prompt only), `rollback`, or `delete`. Writes nothing, consumes no version                       |
| `expected_version`      | Prompt update concurrency token from `inspect`; stale values refuse before versioning or writing                                                               |
| `unset`                 | Update-only: CLEAR the named fields — see [Removing a field](#removing-a-field-unset)                                                                          |
| `chain_steps`           | Chain step definitions — every `promptId` must name a registered prompt or the write is refused                                                                |
| `chain_step_operation`  | `add \| remove \| reorder \| update` — omit it to replace the whole array                                                                                      |
| `budget`                | Chain run-level budget — `maxNodes`, `maxFanOut`, `maxInsertions`, `declaredCostCeiling`, `pauseOnBlocking`. A declared cap may only narrow the server default |
| `artifacts`             | What this run touches — `produces` (artifact kinds) and `fromArgument` (a declared argument carrying paths). Artifact-scoped gates attach from it              |
| `edges`                 | Chain dependency edges — `{from, to}` naming step ids. Send with `chain_steps` when a rewrite invalidates one; see [Chain edges](#chain-edges)                 |
| `tool_operation`        | Update-only: `add` unions with the current tool binding, `remove` unbinds AND deletes — see [Removing a field](#removing-a-field-unset)                        |
| `tool_ids`              | Tool ids for `tool_operation:"remove"`; refused without it                                                                                                     |
| `gate_configuration`    | Gate include/exclude lists                                                                                                                                     |
| `injection`             | Prompt-level injection control — `system-prompt`, `gate-guidance`, `style-guidance`                                                                            |
| `register_with_mcp`     | Register as a native MCP prompt — **freezes the prompt against its category/global default**                                                                   |
| `mcp_prompt_mode`       | `expand` (plain text) or `launch` (route through `prompt_engine`) — **same freeze**                                                                            |
| `subagent_model`        | `heavy \| standard \| fast` capability hint for `==>` delegated steps                                                                                          |
| `agent_type`            | Default host agent for this prompt's `==>` delegated steps                                                                                                     |

`type` accepts `string \| number \| boolean \| object \| array`. `required:true` alone does not
block execution — enforcement only arms when the argument also declares a `validation` block
(`pattern`, `minLength`, `maxLength`).

A chain step naming a prompt that does not exist refuses the whole call, with one addressed line
per step (`step 2 references unknown promptId 'run_smoke_tests'`) — nothing is written, nothing is
scaffolded, and no version is consumed. The one exemption is a step named `<promptId>/<step>`, one
level deep, which this same call scaffolds into a sub-prompt directory. See
[Step References Must Resolve](../concepts/chains-lifecycle.md#step-references-must-resolve).

The last five are written into `prompt.yaml` verbatim and are otherwise carried forward untouched:
supply one and it is set, omit it and the prompt keeps whatever it already declared. Two of them
carry a one-way cost. `register_with_mcp` and `mcp_prompt_mode` are normally **resolved** through
prompt → category → global → built-in default, and setting either writes an explicit prompt-level
value that outranks all of them permanently — the prompt stops following any later change to its
category or global default, and only another explicit call moves it again. Set them when this
prompt must differ from its category; leave them out when it should follow along.

Rollback restores `injection`, `subagent_model`, `agent_type`, `budget` and `artifacts` from the
target version's snapshot. `register_with_mcp` and `mcp_prompt_mode` keep their current on-disk
value across a rollback — a recorded value for those two cannot be distinguished from an inherited
default in older history rows, so restoring one could silently freeze a prompt that never declared
it.

**A chain's `edges` and its `tools` id list are recorded by no version, and a rollback leaves both
at their current on-disk value.** Neither survives loading — the loader linearises `edges` into
step order and drops them, and `tools` survives only as loaded definitions, not as the authored
ids — so the only source for either is the file itself, which four of the seven places that build
a prompt snapshot cannot read. Recording them at some of those places and not the others would
make every prompt edit write a duplicate history row and every prompt write report a false
post-write verification failure, so they are left out rather than half-recorded. ☐ open as of
2026-09-20 · closes when a loaded prompt carries the path to its own entry file. Until then, a
rollback of a chain whose edges have changed restores everything else and leaves the edges alone —
re-send them with `edges:` on an `update`.

**Gate Parameters:**

| Parameter                | Purpose                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `type`                   | `validation` (pass/fail) or `guidance` (advisory)                              |
| `gate_type`              | `framework` \| `category` \| `custom`. Default `custom`                        |
| `severity`               | `critical` \| `high` \| `medium` \| `low`. Default `medium`                    |
| `enforcement_mode`       | `blocking` \| `advisory` \| `informational`. Absent, derived from `severity`   |
| `block_response_on_fail` | `true` withholds the step output on a FAIL and returns the gate review instead |
| `guidance`               | Gate criteria content                                                          |
| `pass_criteria`          | Array of success conditions                                                    |
| `activation`             | When gate activates (categories, frameworks)                                   |

Omitting `severity`, `enforcement_mode` or `block_response_on_fail` on an update leaves the gate's
current value alone; it does not reset to the default. `block_response_on_fail: false` is a value,
not an omission — it clears the key on a gate that declared it.

Every gate parameter is named for the `gate.yaml` key it writes. `type` and `gate_type` are two
different keys and each has its own parameter: `type` is the validation/guidance behaviour,
`gate_type` is the classification the loader filters framework gates on. **Breaking change
(P4.10):** the parameter now called `type` was published as `gate_type` until this release, where
it took the other key's name and left that key unauthorable. Sending the validation/guidance value
under `gate_type` is now rejected by the schema — send it under `type`.

Omitting `gate_type` on an update leaves the gate's current value alone, the same way `severity`
and `enforcement_mode` do. Until this release an update supplying ONLY `gate_type` reported
`✅ Gate 'x' updated successfully` over a byte-identical `gate.yaml`: the key was absent from the
set the writer narrows a write by, so no `gate.yaml` write was planned. That set is now derived
from the writer's own key partition, so every settable gate key is covered by construction.

**Category Parameters:**

| Parameter           | Purpose                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `id`                | The category **directory name** under the prompts root — what the loader names it by |
| `name`              | Display name. Absent, the loader derives one from the id                             |
| `description`       | Description. Absent, the loader derives `Prompts in the <id> category`               |
| `register_with_mcp` | The category-level MCP-registration default every prompt in it inherits              |
| `mcp_prompt_mode`   | `expand` or `launch` — the category-level default every prompt in it inherits        |

`id`, `name` and `description` are all required to `create`; `CategorySchema` requires all three
and the write is refused without them. The two inheritance defaults are carried forward on an
update that omits them, the way gate `severity` is — supply one and it is set, omit it and the
file keeps what it declared.

Unlike the prompt-level versions of the same two parameters, these carry **no freeze hazard**:
this IS the middle level of the `prompt → category → global` chain, so a prompt that declares
nothing keeps following whatever the category says.

`inspect` renders a field only when `category.yaml` declares it, and says so plainly when the file
is absent. Nothing validates a `category.yaml` on load — the loader casts the parsed document — so
the write-time check is the only one there is, and a document whose `id` disagrees with its
directory is refused rather than silently served under the directory's name.

**Framework Parameters:**

| Parameter                | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `system_prompt_guidance` | Injected guidance content                   |
| `phases`                 | Array of phase definitions                  |
| `gates`                  | Gate include/exclude configuration          |
| `persist`                | Save switch to config (for `switch` action) |

**Framework advanced parameters.** All eleven were accepted before they were documented; they are
now declared in the tool schema, so a client can read each one's shape from the contract. Four land
in `framework.yaml`, six in `phases.yaml` and one in its own file, which matters when reasoning
about a partial write.

| Parameter                     | Lands in         | Purpose                                                                             |
| ----------------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `framework_gates`             | `framework.yaml` | **Required to create a framework.** Quality gates; each entry needs `id` and `name` |
| `template_suggestions`        | `framework.yaml` | Prompt-enhancement suggestions surfaced when active                                 |
| `framework_elements`          | `framework.yaml` | Section structure expected of a prompt                                              |
| `argument_suggestions`        | `framework.yaml` | Arguments the framework suggests a prompt declare                                   |
| `judge_prompt`                | own file         | Judge-prompt body, written where `judgePromptFile` points                           |
| `processing_steps`            | `phases.yaml`    | Ordered template-processing steps, with optional guards                             |
| `execution_steps`             | `phases.yaml`    | Execution steps with dependencies and expected output                               |
| `execution_type_enhancements` | `phases.yaml`    | Per-execution-type step overlays (chain vs single)                                  |
| `template_enhancements`       | `phases.yaml`    | System/user prompt additions and contextual hints                                   |
| `execution_flow`              | `phases.yaml`    | Pre/post/validation hooks around execution                                          |
| `quality_indicators`          | `phases.yaml`    | Per-phase keywords and patterns for compliance scoring                              |

**What a framework `update` keeps.** Everything the call does not change. A field you omit keeps
its stored value, and so does `version`: no parameter sets it, and only `create` writes `1.0.0`. A
file whose content the update does not change is not written at all, so its comments and
formatting survive. An edit to `quality_indicators` rewrites `phases.yaml` and leaves
`framework.yaml` byte-identical.

A file the update _does_ change is edited rather than re-rendered. Where every changed field is a
plain value, only that field's own lines move: comments, blank lines, key order, quoting style and
the wrapping of untouched block scalars are left exactly as authored. A change that alters the
file's structure — adding or removing a key, or changing the length of a list — still re-renders
the document, which keeps the comments but may re-wrap a long value.

</details>

> [!TIP]
> **Full schema reference:** [Prompt Schema](prompt-yaml-schema.md) · [Chain Schema](chain-schema.md) · [Gate Configuration](gate-configuration.md)

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

| Action              | Operations                                          | Parameters                                                                                                            | Purpose                                                                                                                                  |
| ------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `status`            | —                                                   | `show_details`, `include_history`, `include_metrics`                                                                  | Runtime overview                                                                                                                         |
| `framework`         | `list`, `switch`, `enable`, `disable`               | `framework`, `reason`, `persist`, `show_details`                                                                      | Framework management                                                                                                                     |
| `gates`             | `list`, `enable`, `disable`, `status`, `health`     | `search_query`, `reason`, `persist`                                                                                   | Gate management                                                                                                                          |
| `analytics`         | `view`, `history`, `reset`                          | `include_history`; `limit` for history; `confirm: true` for reset                                                     | Execution metrics                                                                                                                        |
| `config`            | `list`, `keys`, `get`, `validate`                   | `config: { key, value?, operation }` for `get` (one key's value + source) or `validate` (a per-key candidate check)   | Read-only: whole configuration, declared schema keys, one key's value, or a validity check — see [Config Operations](#config-operations) |
| `maintenance`       | `restart`                                           | `confirm: true`, `reason`                                                                                             | Server restart                                                                                                                           |
| `guide`             | —                                                   | `topic`, `include_planned`                                                                                            | Operation overview                                                                                                                       |
| `injection`         | `status`, `override`, `reset`                       | `type`, `enabled`, `scope`, `scope_id`, `expires_in_ms` for override                                                  | Session injection overrides                                                                                                              |
| `changes`           | `list`                                              | `source`, `resource_type`, `since`, `limit`                                                                           | Resource change audit log                                                                                                                |
| `session`           | `list`, `inspect`, `clear`                          | `session_id`, `show_details`                                                                                          | Chain session lifecycle                                                                                                                  |
| `execution_history` | `list`                                              | `limit`                                                                                                               | Chain execution ledger                                                                                                                   |
| `skills_sync`       | `status`, `export`, `sync`, `diff`, `pull`, `clone` | `client`, `scope`, `resource_type`, `id`, `preview`, `preview_detail`, `prune`, `output`, `file`, `category`, `force` | Export canonical resources as client skills — [Skills Sync](../guides/skills-sync.md)                                                    |

Every parameter is declared in the tool's input schema, which drops any field it does not declare
before the action runs. Two names are shared across actions with different values: `scope` is
`user` or `project` for `skills_sync` and `session`, `chain` or `step` for an injection override,
and `resource_type` takes `prompt`, `gate`, `framework` or `style` for `skills_sync` while the
change log records only `prompt` and `gate`. Each action refuses a value that belongs to the other.

### Config Operations

Read-only over MCP: `list` (the whole loaded configuration), `keys` (the dot-path keys the
packaged `config.schema.json` declares), `get` (one key's effective value and where it came from),
and `validate` (the load-time schema check, or a per-key candidate check via the nested `config`
object).

```bash
# The whole loaded configuration
system_control(action:"config", operation:"list")

# Every dot-path key the schema declares
system_control(action:"config", operation:"keys")

# One key's effective value and source
system_control(action:"config", operation:"get", config:{key:"server.name", operation:"get"})

# The check the server already ran against your config file at load time
system_control(action:"config", operation:"validate")

# Whether a value would be valid for a key, without writing it
system_control(action:"config", operation:"validate", config:{key:"logging.level", value:"debug", operation:"validate"})
```

`get` answers with the key, its effective value as JSON, and a `source` — `file` (the config file
sets it), `default` (the built-in default; the file does not set it and the loader resolves every
section at load time, so this is the value the server actually uses), or `environment` (an
environment variable overrides the file and default). There is no fourth label: a key with no
default in any layer still answers `default` with an `undefined` value, rather than an unresolved
state. A key `keys` does not list is refused, naming `keys` as the way to see what is declared; a
`get` with no key is refused the same way.

`set`, `reset`, and `restore` are not served here. Any other operation — or a request naming none
at all — is refused by name rather than answered with a listing, which is what a malformed request
used to fall back to. Change a value with `cpm config set <key> <value>` or reset with
`cpm config reset --force`.

This is not "configuration cannot be written over MCP": `system_control(action:"gates"|"framework",
operation:"enable"|"disable", persist:true)` still records that one setting in your config file
(`config.jsonc`, or `config.json`). The
boundary is narrower than a blanket read-only surface — a caller cannot name an arbitrary key or
value to write, or restore a backup; an action can only ask the server to persist its own one
setting, under a key the server itself chooses and validates.

### Execution History

Reads the append-only `execution_records` ledger, newest first, grouped by session.

```bash
# Most recent executions for the current workspace (default 50)
system_control(action:"execution_history", operation:"list")

# Narrow the page (clamped to 500)
system_control(action:"execution_history", operation:"list", limit:10)
```

Distinct from `session`, which reports runs that are **currently live**: chain sessions are
deleted per server PID at cleanup, so a finished run disappears from `session` but stays in
`execution_history`.

Records that never reached a terminal state are called out in the output. Terminal records are
emitted on completion, on user abort, and on failure — a run that predates that emission may show
as `working` permanently.

#### Run telemetry line

A session whose newest record is terminal also renders one line of run-level facts:

```
planned 3 / executed 3 · gates fired 2 (retries 1) · unknowns opened 1 / closed 1
```

| Fact              | Means                                                                              |
| ----------------- | ---------------------------------------------------------------------------------- |
| `planned`         | `totalSteps` the run was created with                                              |
| `executed`        | Distinct step numbers present in the returned page — a clamped page reports fewer  |
| `gates fired`     | **Gate verdict submissions**, not distinct gate ids: two verdicts on one gate is 2 |
| `retries`         | The subset of those submissions whose verdict was `FAIL`                           |
| `unknowns opened` | Entries in the run's unknowns ledger (cumulative — resolving does not decrement)   |
| `unknowns closed` | Ledger entries in state `resolved`                                                 |

Schema v23 added two more terminal-row facts alongside these six — `nodes_inserted` and
`nodes_skipped`, the [adaptive mutation](#adaptive-mutation) audit counters. They are persisted
the same terminal-row-only way and returned by `ExecutionRecordStore.queryRecent`, but this
handler's rendered line above does not include them yet; read them via a direct store query.

**These are recorded, never modeled.** Nothing in the server scores, weights, ranks, or routes on
them; they exist so history is available to reason about later. The line is omitted entirely for a
session with no terminal record yet, and for records written before these fields existed — an
absent line means "not measured", never "zero".

#### Per-gate verdict lines

`gates fired` counts submissions and never says which gate held the run up. A record whose step
was reviewed with a `per_gate` list now renders one indented line per graded gate under it:

```
- `completed` step 1 · draft · 2026-09-20T12:00:00.000Z · 41ms
  - ✓ `api-documentation` PASS — contract annotated
  - ✗ `test-coverage` FAIL (attempt 2) — error path untested
  - ≡ `style-guide` PASS — attested satisfied
```

`≡` marks a **reminder-tier** gate: one with no evaluator, which the reviewer attested to via the
verdict's `reminders` field rather than being graded against. It is recorded because the
attestation is a fact worth auditing, and marked differently because it is not a check that
passed.

The gate id is the one the review advertised, resolved from the submitted `[n]` position at the
parse boundary; an index naming no advertised gate is dropped rather than guessed, so it appears
nowhere. A record whose review carried no `per_gate` list renders exactly as before — including
every record written before this was recorded, so an existing ledger is unchanged.

`system_control(action:"analytics")` reads the same rows: **Gate Validations** is the number of
ledger records carrying at least one verdict, and a **Per-Gate Outcomes** list breaks it into
passed/failed per gate id. Reminder attestations are counted separately, as **Reminder
Attestations**, and never inside a gate's pass rate. Both sections are omitted when no record
carries what they report.

### Session Operations

```bash
# List active chain sessions
system_control(action:"session", operation:"list", show_details:true)

# Inspect a specific session (state, step, pending gates, context variables)
system_control(action:"session", operation:"inspect", session_id:"chain-research#1")

# Clear a session entirely — removes state and artifacts (irreversible).
system_control(action:"session", operation:"clear", session_id:"chain-research#1")

# Stopping a run lives on the other tool — see "Which tool stops a run" below.
prompt_engine(chain_id:"chain-research#1", cancel:true)
```

### Which tool stops a run

**The id you hold decides the tool.** A `chain_id` is held _because you are running the chain_, and
stopping the run you are in is part of running it — so `cancel` is on `prompt_engine`. A
`session_id` comes from a listing, and acting on runs you are not in is operator work — so `list`,
`inspect` and `clear` stay on `system_control`. Without that rule the split re-forms the first time
someone adds a verb.

| Verb            | Tool                                                  | Effect                                                                                                                                                                                                                                                     |
| --------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cancel`        | `prompt_engine(chain_id, cancel:true)`                | Soft stop. runStatus becomes `cancelled`, progression is blocked, and the session row and artifacts are **retained** for inspection and audit. Idempotent on an already-cancelled run; refuses one already completed or failed.                            |
| `handoff`       | `prompt_engine(chain_id, handoff:true)`               | Mint a single-use token that exports the run to another client (Codex, OpenCode, another Claude Code conversation). The run stays yours until the claim lands; minting again rotates the token. Your copy is retired on the next persist after a claim.    |
| `claim_token`   | `prompt_engine(claim_token:"hnd_…")`                  | Claim a run minted elsewhere and resume it in the same call — send the token alone. Refused by name when the token is unknown, spent, or rotated, when the run is from another workspace (scope is never rewritten), or when the run carries no blueprint. |
| `clear`         | `system_control(action:"session", operation:"clear")` | Hard removal. Session state and chain history are deleted. Irreversible.                                                                                                                                                                                   |
| `force_restart` | `prompt_engine(command, force_restart:true)`          | Abandons the current run and immediately starts a new one — cancel-then-start in a single call. Use `cancel` when you want to stop and start nothing.                                                                                                      |

Cancel during an active run to halt progression while preserving evidence; clear during cleanup.

### Resource Change Tracking

Know what changed, when, and how. The server logs every prompt and gate modification—whether from MCP tools, filesystem edits, or external processes.

```bash
# View recent changes
system_control(action:"changes", operation:"list")

# Filter by source (who made the change)
system_control(action:"changes", operation:"list", source:"filesystem")
system_control(action:"changes", operation:"list", source:"mcp-tool")

# Filter by resource type
system_control(action:"changes", operation:"list", resource_type:"prompt")
system_control(action:"changes", operation:"list", resource_type:"gate")

# Filter by time
system_control(action:"changes", operation:"list", since:"2026-01-20T00:00:00Z")

# Limit results
system_control(action:"changes", operation:"list", limit:10)
```

**Change Sources:**

| Source       | Meaning                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `filesystem` | Hot-reload detected file change                                                                               |
| `mcp-tool`   | Created/updated via `resource_manager`                                                                        |
| `external`   | Changed while server was down (on startup), or removed before a folder created while it ran was first watched |

**Which folders are tracked:** your primary prompts and gates folders, and every workspace overlay (`<workspace>/prompts`, `<workspace>/gates`) — including one created while the server runs. A resource that exists in more than one of them is recorded once, for the copy that is served, so editing a copy another folder overrides records nothing. The bundled catalog is tracked only when it is your primary folder (no workspace configured): it changes only when the package is updated.

**Why this matters:** Debug sync issues between your editor and the server. Track which prompts changed during a session. Audit who modified what before a deploy.

---

## Injection Control

The server injects guidance into prompts. Control this per-execution or globally.

### Three Injection Types

| Type             | What It Adds        | Default         |
| ---------------- | ------------------- | --------------- |
| `system-prompt`  | Framework           | Every 2 steps   |
| `gate-guidance`  | Quality criteria    | First step only |
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
      "frequency": { "mode": "every", "interval": 2 }
    },
    "gate-guidance": {
      "enabled": true,
      "frequency": { "mode": "every", "interval": 1 }
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

| Format       | Example                      |
| ------------ | ---------------------------- |
| Full         | `GATE_REVIEW: PASS - reason` |
| Full (colon) | `GATE_REVIEW: FAIL: reason`  |
| Simplified   | `GATE PASS - reason`         |
| Minimal\*    | `PASS - reason`              |

\*Minimal format only works via `gate_verdict` parameter, not in `user_response`.

**Requirements:**

- Rationale is always required
- `gate_verdict` takes precedence over parsed `user_response`

---

## Unknowns Ledger

Chain steps declare typed unknowns via the `observations` parameter. The server accumulates
them into a per-run ledger and surfaces it back into every subsequent step's context — see
[Unknowns Ledger lifecycle](../concepts/chains-lifecycle.md#unknowns-ledger) for the full
transition table.

```bash
prompt_engine(
  chain_id:"chain-research#2",
  user_response:"Step 2 output...",
  observations:[
    {"type":"unknown_discovered", "id":"cache-ttl-unknown", "statement":"TTL for the new cache layer is undecided", "blocking":true}
  ]
)
```

**Observation shapes:**

| Type                 | Required fields                 | Optional fields              | Effect                             |
| -------------------- | ------------------------------- | ---------------------------- | ---------------------------------- |
| `unknown_discovered` | `id`, `statement`               | `blocking`, `target_step_id` | Opens (or re-opens) a ledger entry |
| `unknown_resolved`   | `id`, `statement`, `resolution` | —                            | Closes a ledger entry              |

- `id` — stable **kebab-case** slug, unique within the run (e.g. `cache-ttl-unknown`).
- `resolution` — `"answered"` or `"irrelevant"`, required when `type` is `unknown_resolved`.
- `blocking` — discovered-only, defaults to `false`; blocking entries render first.
- `target_step_id` — discovered-only, optional. A stable node id (see
  [Chain Step Targeting](#chain-step-targeting)) naming the downstream step the adaptive mutation
  policy skips if this unknown later resolves `"irrelevant"`. Does not affect insertion — see
  below.
- **Cap:** 200 entries per run. A batch that would open a 201st unknown is rejected — an
  observation on an unknown id that doesn't exist in the ledger, or resolving without
  `resolution`, is a validation error surfaced as a tool-result error (`isError: true`), never a
  thrown exception. A rejected batch is all-or-nothing: nothing in it is applied.

### Adaptive Mutation

Two observation shapes drive a deterministic server-side policy that can insert or skip a node in
the run's remaining step list. The model only ever declares typed observations (D2); the server
owns every graph edit, and only ever makes one in reaction to a declared observation — never
predictively (D6, advisory by construction). Full lifecycle:
[Adaptive Mutation](../concepts/chains-lifecycle.md#adaptive-mutation).

**Insert** — a blocking discovery inserts one investigation step (prompt `investigate_unknown`)
immediately after the current node, regardless of whether `target_step_id` was supplied:

```bash
prompt_engine(
  chain_id:"chain-draft#4",
  user_response:"Step 1 output...",
  observations:[
    {"type":"unknown_discovered", "id":"cache-ttl-unknown", "statement":"TTL for the new cache layer is undecided", "blocking":true, "target_step_id":"review"}
  ]
)
# -> response's CTA now names the inserted `investigate_unknown` step, not whatever
#    would otherwise have run next.
```

**Skip** — resolving that same unknown `"irrelevant"` skips the node its ledger entry's
`target_step_id` named, provided that node is still strictly ahead of the current step:

```bash
prompt_engine(
  chain_id:"chain-draft#4",
  user_response:"Investigation output...",
  observations:[
    {"type":"unknown_resolved", "id":"cache-ttl-unknown", "statement":"Caching is out of scope for this draft", "resolution":"irrelevant"}
  ]
)
# -> the `review` node named by the discovery's target_step_id is retired
#    (never rendered); the run proceeds past it.
```

- **Caps**: 1 insertion per unknown id, 3 insertions per run. A capped or non-qualifying
  observation still applies to the ledger — it just mutates nothing in the node list.
- The current node can never be a skip target — only strictly-ahead, not-yet-executed nodes.
- A run's terminal `execution_records` row carries two more terminal-row facts for this: how many
  nodes were inserted and how many were skipped over the run's life (`nodes_inserted`,
  `nodes_skipped` — same terminal-row-only pattern as the [run telemetry line](#run-telemetry-line)
  facts). They are persisted and returned by `ExecutionRecordStore.queryRecent`; the
  `execution_history` action's rendered telemetry line does not include them yet — query the store
  directly to read them today.

### Blocking-unknown interrupt

A `blocking:true` discovery does more than insert an investigation step: the response carries a
structured account of what the unknown affects and what you may do about it. Two variants, chosen
by the run's `budget.pauseOnBlocking` (Workflow IR budget, or a YAML chain's chain-level
`budget:` — default `false`).

**Soft (default).** The interrupt rides on the inserted investigation step. The run is not held:
answer that step and it continues.

**Paused (`pauseOnBlocking: true`).** The run holds on a synthetic gate review with the reserved
id `__unknown_interrupt__`, issues no step at all, and the response is the interrupt alone. Only a
`gate_action` verb clears it — no `gate_verdict` does, because no gate produced this hold.

Either variant carries `structuredContent.chain_interrupt`:

```jsonc
{
  "kind": "chain_interrupt",
  "reason": "blocking_unknown",
  "unknown": {
    "id": "cache-ttl",
    "statement": "TTL for the new cache layer is undecided",
  },
  "affected_step_ids": ["review"], // declared target_step_id links only
  "remaining_nodes": [{ "id": "…", "promptId": "…", "stepName": "…" }], // post-insert
  "paused": false,
  "resume": {
    "chain_id": "chain-draft#4",
    "verbs": ["answer the step", "remainder", "gate_action:abort", "cancel"],
  },
}
```

**`resume.verbs` is state-dependent, not additive.** A PAUSED run lists a different set, and the
two are not subsets of one another in either direction:

| Run state | Verbs                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------- |
| Soft      | `answer the step`, `remainder`, `gate_action:abort`, `cancel`                                            |
| Paused    | `gate_action:resume`, `gate_action:accept_alternative` (with `remainder`), `gate_action:abort`, `cancel` |

A paused run never offers "answer the step" — it issued no step. It never offers a bare
`remainder` either: a remainder alone does not clear the hold, so the caller must spell it
`gate_action:"accept_alternative"` and carry the remainder in the same call. On a soft interrupt
the remainder alone IS the acceptance.

**`affected_step_ids` is derived from declared links only.** It lists the steps a ledger entry
named with `target_step_id`, and nothing else — the server never scans step text for mentions of
the unknown. A heuristic here would be a server-authored claim about your plan, and the whole
policy is advisory by construction: you declare, the server reacts.

**Rewriting the rest of the plan.** `remainder` replaces (`mode:"replace"`) or extends
(`mode:"append"`) every node strictly after the current one; the current node is never touched.
The nodes are Workflow IR nodes and are held to the same schema, the same validator and the same
caps as a `workflow` submission — including `maxNodes` counted as executed PLUS submitted, so
rewriting the tail repeatedly cannot buy back spent budget. One accepted remainder per unknown id,
and a per-run ceiling.

```bash
# soft interrupt: the remainder alone is the acceptance
prompt_engine(chain_id:"chain-draft#4", remainder:{
  mode:"replace",
  nodes:[{ id:"confirm-ttl", promptId:"investigate_unknown" }]
})

# paused run: the verb and the remainder travel together
prompt_engine(chain_id:"chain-draft#4", gate_action:"accept_alternative", remainder:{
  mode:"replace",
  nodes:[{ id:"confirm-ttl", promptId:"investigate_unknown" }]
})

# the string spelling of an append — the only command form allowed beside chain_id
prompt_engine(chain_id:"chain-draft#4", command:"--> >>write_summary")
```

Refusals are named, never silent: a remainder on a run with no open blocking unknown, an
`accept_alternative` with no remainder, an exhausted cap, a node whose prompt is not registered,
and a node declaring a field a contributed node cannot carry (see
[Extending or replacing a running plan](workflow-ir.md#extending-or-replacing-a-running-plan)) each
come back with the reason.

**Audit trail.** A run's terminal `execution_records` row carries `interrupts_raised` and
`remainders_accepted`. The units are not what the names suggest: `interrupts_raised` counts
BLOCKING LEDGER ENTRIES (the interrupt re-raises on every call while an unknown stays open, so
counting raise events would count calls), and `remainders_accepted` counts DISTINCT unknown ids —
one accepted remainder of four nodes is one remainder. Both are the only surviving record once the
run's ephemeral rows are gone.

---

## Troubleshooting

| Problem                 | Fix                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Prompt not found        | Run `resource_manager(resource_type:"prompt", action:"list")` to see available IDs |
| Edits not showing       | Run `resource_manager(resource_type:"prompt", action:"reload")`                    |
| Chain stuck             | Use `force_restart:true` or check `system_control(action:"status")`                |
| Framework not switching | Use `resource_manager(resource_type:"framework", action:"switch")`                 |
| Gate keeps failing      | Use `gate_action:"skip"` to bypass, or `gate_action:"retry"`                       |

---

## Common Workflows

### Create and Test a New Prompt

```bash
# 1. Create
resource_manager(resource_type:"prompt", action:"create", id:"my_prompt", ...)

# 2. Reload
resource_manager(resource_type:"prompt", action:"reload")

# 3. Test
prompt_engine(command:"my_prompt arg:'value'")

# 4. Iterate
resource_manager(resource_type:"prompt", action:"update", id:"my_prompt", ...)
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

<details>
<summary><strong>Version History</strong></summary>

All resources (prompts, gates, frameworks) automatically track version history. Each edit records
the state it _produces_ — version N holds what edit N produced, so the newest version always
equals what `inspect` shows (go-forward numbering). If the latest stored snapshot doesn't match
the resource's live state before the edit (the first edit after this behavior shipped, or an
out-of-band file change), a self-healing "Bridge" row is recorded first so no state becomes
unreachable.

**An edit that changes nothing records nothing.** Both writers — `resource_manager` and `cpm` —
compare the incoming snapshot against the newest recorded one, inside the same transaction that
assigns the version number, and skip the insert when they match. The reply says so rather than
naming a version it did not write: `📜 No change to record — still at version N`. Key ORDER is not
a difference (two records holding the same data compare equal however their keys were emitted);
array order is, because the order of `chain_steps` or `arguments` is part of the state.

### Configuration

Enable/disable in `config.jsonc` (`config.json` is also still read):

```json
{
  "versioning": {
    "enabled": true,
    "maxVersions": 50,
    "autoVersion": true
  }
}
```

| Setting       | Default | Purpose                                  |
| ------------- | ------- | ---------------------------------------- |
| `enabled`     | `true`  | Enable version tracking globally         |
| `maxVersions` | `50`    | Maximum versions retained (FIFO pruning) |
| `autoVersion` | `true`  | Auto-save on updates (can skip per-call) |

### View History

```bash
# View version history for a prompt
resource_manager(resource_type:"prompt", action:"history", id:"my_prompt")

# View with limit
resource_manager(resource_type:"prompt", action:"history", id:"my_prompt", limit:10)

# Same for gates and frameworks
resource_manager(resource_type:"gate", action:"history", id:"code-quality")
resource_manager(resource_type:"framework", action:"history", id:"cageerf")
```

**Output:** Table showing version number, date, changes summary, and description.

### Rollback to Previous Version

```bash
# Rollback a prompt to version 3
resource_manager(
  resource_type:"prompt",
  action:"rollback",
  id:"my_prompt",
  version:3,
  confirm:true
)
```

**Safety:** A rollback runs in three phases — validate, record, write — and a refusal at any point
before the write leaves both the files and `version_history` untouched. The target version is
resolved and checked for completeness first; only then is the restored state recorded (described as
`Rollback to vN`), and only then is the file written. Recording precedes the write on purpose, so a
persistence failure aborts with nothing on disk. There is no separate "pre-rollback snapshot" —
under go-forward numbering the live state before the rollback is already the previous version. You
can always rollback-from-rollback.

**Incomplete snapshots are refused, not merged.** A version whose snapshot is missing a field the
resource cannot be rebuilt without is not restorable, and the rollback is refused naming the
missing fields. Substituting the current value for a missing one would land the resource on a state
matching neither the target version nor the state before it — under a message saying version N had
been restored.

**Preview any of it.** `action:"preview"` with `preview_action:"rollback"` returns the diff between
the current state and the version you would restore, writing no file and recording no version; it
still refuses an incomplete snapshot, so the preview and the real call agree. With
`preview_action:"delete"` it reports what would be removed — for a prompt, that includes the prompts
that reference it — and it purges nothing. Neither needs `confirm`: `preview` is not a destructive
action, so there is nothing to confirm.

**A real `delete` purges the resource's version history with it**, for all four resource types, and
the reply says how many rows it removed. Deleting a chain takes its steps' history too, since a step
is recorded under the composite id `chain/step`. This is what `cpm delete` always did; over
`resource_manager` the rows used to survive — unreachable by any action, because rollback resolves
the resource first, and inherited by whatever was created under that id next. One caveat remains:
rows `cpm` wrote are keyed by the tenant id the CLI resolved, which is not yet always the one the
server resolves for the same workspace, so an MCP delete purges what the MCP surface wrote.

<!-- preview-vocabulary: migration-note -->

That is the whole reason it is an action rather than the `dry_run` boolean it replaced: a flag sat on
`delete`, and the confirmation guard reads the action, so previewing a deletion demanded that the
deletion be confirmed first. `dry_run` is removed — see the CHANGELOG's breaking-changes entry.

### What a rollback restores

**A version recorded since schema v29 restores its files byte for byte.** Those rows carry the
resource's actual bytes in the object store, so a rollback writes them back verbatim — comments,
key order, flow style, line endings, a BOM, a chain's `edges`, a prompt's `tools/{id}/` scripts.
Nothing is re-rendered from a projection, which is why nothing is lost in the round trip. The reply
names every file it wrote.

**A rollback never deletes a file.** A file the resource has now that the target version did not
record stays on disk, and the reply lists it by path as left in place. The honest consequence: the
resource is then not byte-identical to that version, and `compare` against it shows the extra
files. Delete them yourself if that is what you meant.

A rollback of a resource served from the bundled package tree writes a workspace override, exactly
as an update of one does — the bundled tree is never written to.

Two states refuse rather than restore something else, because both mean the database disagrees with
itself: a row that advertises a file tree whose recorded bytes are missing from the store, and a
recorded path that resolves outside the resource's own directory. Both write nothing at all.

### What a rollback does not restore

Rows written before schema v29, bridge rows, and rows degraded to projection-only (an over-limit
file, a resource whose files could not be located) have no recorded bytes and restore the older
way: the version snapshot records the resource's authored surface, not every byte in its directory,
and what falls outside it is left to the file writers, which carry it forward from disk:

| Resource  | Not in the snapshot                                                             | What happens on rollback                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prompt    | `register_with_mcp`, `mcp_prompt_mode` (resolved through the category chain)    | keep their current on-disk values                                                                                                                                                                  |
| prompt    | script tools under `tools/{id}/`                                                | left unchanged — **the response says so**. A v29-era row restores them byte for byte instead, and then says nothing, because there is nothing left unrestored                                      |
| gate      | `severity`, `enforcementMode`, `gate_type`, `evaluation`, `blockResponseOnFail` | carried forward from `gate.yaml` — still true after `severity`, `enforcementMode`, `gate_type` and `blockResponseOnFail` became settable, since they are preserved keys rather than projected ones |
| framework | `phases` and the advanced authoring fields                                      | carried forward by the writer's merge                                                                                                                                                              |

Where a rollback restores only part of a resource, the response names what it did not restore.
Frameworks additionally report any projected field the target version never recorded, because the
framework writer merges rather than rebuilds and so cannot remove a key.

### Compare Versions

```bash
# Compare version 1 to version 5
resource_manager(
  resource_type:"prompt",
  action:"compare",
  id:"my_prompt",
  from_version:1,
  to_version:5
)
```

**Output:** Unified diff showing additions (+) and removals (-) between versions.

### Skip Auto-Versioning

For bulk updates or minor edits, skip automatic version save:

```bash
resource_manager(
  resource_type:"prompt",
  action:"update",
  id:"my_prompt",
  description:"Minor typo fix",
  skip_version:true
)
```

### Version Storage

Version history lives in SQLite (`state.db`), not on disk beside the resource. Resource
directories hold only the definition itself:

```
resources/prompts/
├── development/
│   └── my_prompt/
│       └── prompt.yaml
resources/gates/
├── code-quality/
│   └── gate.yaml
```

`state.db` is ephemeral and never committed. The per-resource JSON version sidecars this section
previously described were removed when versioning moved to SQLite, and `.gitignore` still carries
a rule for them so stragglers cannot be committed.

</details>

---

<details>
<summary><strong>CLI Configuration</strong></summary>

Override resource paths via CLI flags or environment variables.

### CLI Flags

All flags accept both `--flag=value` and `--flag value` formats.

```bash
node dist/index.js --transport stdio \
  --workspace /path/to/workspace \
  --config /path/to/config.jsonc
```

A path setting the server cannot use stops it before it serves anything, on every transport,
exiting non-zero with the reason on stderr: the variable or flag, the value, the resolved path,
what is wrong, and what removing the setting would fall back to. `--config` and `MCP_CONFIG_PATH`
must name a readable config file, parsed strictly as JSON unless the path ends `.jsonc`, in which
case comments and a trailing comma are accepted; `--workspace`, `MCP_WORKSPACE` and
`MCP_RESOURCES_PATH` must name an existing directory; and a workspace config, when one exists, must
be a readable JSON object. A workspace naming both `config.jsonc` and `config.json` also refuses to
start, naming both paths — keep one. Each of these used to start a server on something else —
ignored settings, a freshly created empty workspace, the bundled catalog in place of yours — with
nothing reporting it. A workspace with no config file uses the packaged one, and an empty value
counts as unset.

There are no per-resource-type flags. `--prompts`, `--gates`, `--frameworks`, `--styles` and
`--scripts` were documented here but are parsed nowhere in the server; point `--workspace` (or
`MCP_RESOURCES_PATH`) at a directory instead. The full parsed set (17, from `server/src/runtime/cli.ts`) is `--client`, `--config`,
`--debug-startup`, `--help`, `--identity-mode`, `--init`, `--log-level`,
`--organization-id`, `--quiet`, `--server-root`, `--startup-test`, `--suppress-debug`,
`--test-mode`, `--transport`, `--verbose`, `--workspace`, `--workspace-id`.

### Transport Options

| Transport       | Flag                          | Use Case                               |
| --------------- | ----------------------------- | -------------------------------------- |
| STDIO           | `--transport=stdio`           | Claude Desktop, Claude Code            |
| Streamable HTTP | `--transport=streamable-http` | Web dashboards, remote APIs            |
| Dual mode       | `--transport=both`            | STDIO + Streamable HTTP simultaneously |

`--transport=sse` was removed with the SDK v2 upgrade and now **exits with an error** naming
`streamable-http`. It does not fall back to another transport: a removed option that silently
resolved to something else started the server on a transport nobody asked for and reported
success. The same check applies to `transport` in your config file.

### Environment Variables

| Variable                    | Description                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `MCP_WORKSPACE`             | Workspace root for config resolution; must be an existing directory, or the server refuses to start                 |
| `MCP_RESOURCES_PATH`        | Base path for all resources (prompts/, gates/, etc.); must be an existing directory, or the server refuses to start |
| `MCP_CONFIG_PATH`           | Override the config file path (`.jsonc` or `.json`); must name a readable file, or the server refuses to start      |
| `MCP_SERVER_ROOT`           | Server package root, used by skills export                                                                          |
| `MCP_SHELL_PRESETS_PATH`    | Override the gate shell-preset definitions file                                                                     |
| `MCP_VERDICT_PATTERNS_PATH` | Override the gate verdict-pattern definitions file                                                                  |

Per-resource-type variables (`MCP_PROMPTS_PATH`, `MCP_GATES_PATH`, `MCP_FRAMEWORKS_PATH`,
`MCP_STYLES_PATH`, `MCP_SCRIPTS_PATH`) were documented here but are read nowhere in the server.

### Resolution Priority

Path resolution follows this priority (first match wins):

1. **Unified env var** — `MCP_RESOURCES_PATH/prompts/` (all resources)
2. **Package defaults** — `server/resources/prompts/` (lowest priority)

Workspace resources overlay the bundled ones. There is no per-resource-type override layer —
the two tiers previously documented above these (CLI flags and individual env vars) do not exist.
A set `MCP_RESOURCES_PATH` that does not exist is not "no match": it refuses startup rather than
falling through to the package defaults, which would serve the bundled catalog under your name.

**Example: MCP config with custom resources**

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts@latest"],
      "env": {
        "MCP_RESOURCES_PATH": "/home/user/my-resources"
      }
    }
  }
}
```

</details>

> [!TIP]
> **Something not working?** The [Troubleshooting Guide](../guides/troubleshooting.md) covers common issues with server startup, client connections, chains, and gates.

---

## Reference

| Component               | Location                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt definitions      | `server/resources/prompts/{category}/{id}/prompt.yaml`                                                                                                               |
| Gate definitions        | `server/resources/gates/{id}/gate.yaml`                                                                                                                              |
| Style definitions       | `server/resources/styles/{id}/style.yaml` (package default; a workspace `resources/styles/{id}/` overlays it, same as prompts/gates/frameworks)                      |
| Script tool definitions | `server/resources/scripts/{id}/tool.yaml` (workspace `resources/scripts/{id}/` when a custom workspace is configured; see [Script Tools](../guides/script-tools.md)) |
| Frameworks              | `server/resources/frameworks/{id}/framework.yaml`                                                                                                                    |
| Chain sessions          | SQLite (`runtime-state/state.db`, table `chain_sessions`)                                                                                                            |
| Resource changes        | `runtime-state/resource-changes.jsonl`                                                                                                                               |
| Server config           | `server/config.json`                                                                                                                                                 |

**Related docs:**

- [Prompt Authoring](../tutorials/build-first-prompt.md) — Tutorial
- [Prompt Schema](./prompt-yaml-schema.md) — Configuration reference
- [Chain Schema](./chain-schema.md) — Chain configuration
- [Gate Configuration](./gate-configuration.md) — Gate configuration
- [Architecture](../architecture/overview.md) — System internals
- [Script Tools](../guides/script-tools.md) — Prompt-scoped script tool configuration
