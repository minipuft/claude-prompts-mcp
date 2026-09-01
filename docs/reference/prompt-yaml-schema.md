# Prompt YAML Schema

The definitive reference for `prompt.yaml` configuration fields.

## Why This Matters

| Problem             | Solution        | Result                         |
| ------------------- | --------------- | ------------------------------ |
| **Guesswork**       | Strict Schema   | Errors caught at load time     |
| **Silent Failures** | Type Validation | Bad inputs fail fast           |
| **Hidden Features** | Explicit Config | Full control over MCP behavior |

---

## Id Conventions

**Ids that appear in the `>>` / `-->` command grammar are `snake_case`. Every other id is
`kebab-case`.**

| Id                          | Convention                                                             | Example                      |
| --------------------------- | ---------------------------------------------------------------------- | ---------------------------- |
| prompt `id`                 | `snake_case`                                                           | `code_review`                |
| nested chain-step directory | `snake_case` — it is a prompt-id segment, addressed as `>>parent/step` | `deep_analysis/initial_scan` |
| category directory          | `kebab-case`                                                           | `knowledge-capture`          |
| gate id                     | `kebab-case`                                                           | `information-placement`      |
| `chainSteps[].id` (node id) | `kebab-case` — a node id, not a prompt id                              | `jd-analysis`                |

The split is not stylistic. Chains are tokenized by splitting on `-->`, `==>`, `+` and `?`, so a
hyphen inside a prompt id makes `>>a-->b` ambiguous between the prompt `a-->b` and the prompt `a`
chained to `b`. Prompt ids therefore avoid hyphens; a kebab spelling is accepted as an **alias**
and folded to the canonical underscore form, which is why `my-prompt` and `my_prompt` cannot both
exist. No other id enters that grammar, so kebab is free everywhere else.

The two things most easily confused sit inside one chain step: the **directory** is snake because
it names a prompt, while the step's `id:` field is kebab because it names a graph node.

`npm run validate:prompts` enforces this and takes `--root`, so it can check a personal library
outside the repository. `server/src/shared/utils/resource-ids.ts` owns the patterns and the
rationale; the validator reads them rather than restating them.

## Root Fields

Top-level properties for `prompt.yaml`.

| Field                     | Type       | Required | Description                                                       |
| ------------------------- | ---------- | -------- | ----------------------------------------------------------------- |
| `id`                      | `string`   | **Yes**  | Unique identifier (e.g., `code_review`). Used in `>>id`.          |
| `name`                    | `string`   | **Yes**  | Human-readable name for MCP clients.                              |
| `description`             | `string`   | No       | Tooltip description shown in clients.                             |
| `userMessageTemplate`     | `string`   | No\*     | Inline content. _One of `...Template` or `...File` required._     |
| `userMessageTemplateFile` | `string`   | No\*     | Path to external `.md` file.                                      |
| `systemMessageFile`       | `string`   | No       | Path to system prompt file.                                       |
| `registerWithMcp`         | `boolean`  | No       | Show in client lists? Default `true`.                             |
| `tools`                   | `string[]` | No       | Script tools to attach (auto-trigger).                            |
| `gateConfiguration`       | `object`   | No       | Quality gate settings.                                            |
| `injection`               | `object`   | No       | Per-prompt injection control. See [Injection](#injection).        |
| `subagentModel`           | `enum`     | No       | Model tier hint for delegation: `heavy`, `standard`, `fast`.      |
| `agentType`               | `string`   | No       | Default agent for delegated steps. A step may override it.        |
| `chainSteps`              | `object[]` | No       | Multi-step chain definition. See [Chain Schema](chain-schema.md). |

### Example

```yaml
id: analyze_data
name: Data Analysis
description: Analyzes CSV data using Python
userMessageTemplateFile: user-message.md
registerWithMcp: true
tools: [csv_validator]
subagentModel: fast # delegated steps use a lightweight model
agentType: Explore # ...and spawn this agent unless a step says otherwise
```

---

## Arguments Schema

Defines inputs passed to the prompt (`>>prompt arg='value'`).

| Field          | Type      | Default  | Description                                       |
| -------------- | --------- | -------- | ------------------------------------------------- |
| `name`         | `string`  | —        | Argument name (used in template `{{name}}`).      |
| `type`         | `string`  | `string` | `string`, `number`, `boolean`, `array`, `object`. |
| `required`     | `boolean` | `false`  | If true, execution fails if missing.              |
| `defaultValue` | `any`     | —        | Used if argument is missing.                      |
| `description`  | `string`  | —        | shown in MCP client UI.                           |
| `validation`   | `object`  | —        | Validation rules.                                 |

### Validation Rules

| Rule        | Type     | Description                                 |
| ----------- | -------- | ------------------------------------------- |
| `minLength` | `number` | Minimum string length.                      |
| `maxLength` | `number` | Maximum string length.                      |
| `pattern`   | `string` | Regex pattern to match (e.g., `^https://`). |

### Example

```yaml
arguments:
  - name: url
    type: string
    required: true
    validation:
      pattern: "^https://"
  - name: retries
    type: number
    defaultValue: 3
```

---

## Gate Configuration

Control which quality gates apply to this prompt.

| Field                     | Type       | Description                             |
| ------------------------- | ---------- | --------------------------------------- |
| `include`                 | `string[]` | Canonical gate IDs to enforce.          |
| `exclude`                 | `string[]` | Auto-assigned gates to ignore.          |
| `framework_gates`         | `boolean`  | Enable framework gates? Default `true`. |
| `inline_gate_definitions` | `object[]` | Custom gate rules for this prompt.      |

### Example

```yaml
gateConfiguration:
  include: ["technical-accuracy"]
  exclude: ["creative-writing"]
  framework_gates: false
```

### Inline Gate Definitions

A prompt may define a gate inline rather than referencing a registered one. This is narrower than a
standalone [`gate.yaml`](gate-configuration.md) — it is scoped to this prompt and registered per
execution.

| Field           | Type                                          | Required | Survives normalization         |
| --------------- | --------------------------------------------- | -------- | ------------------------------ |
| `name`          | `string`                                      | **Yes**  | Yes                            |
| `type`          | `validation` \| `guidance`                    | **Yes**  | Yes                            |
| `scope`         | `execution` \| `session` \| `chain` \| `step` | **Yes**  | Yes                            |
| `description`   | `string`                                      | **Yes**  | Yes                            |
| `guidance`      | `string`                                      | **Yes**  | Yes                            |
| `id`            | `string`                                      | No       | Yes — omit and one is assigned |
| `pass_criteria` | `any[]`                                       | No       | Yes — defaults to `[]`         |
| `expires_at`    | `number`                                      | No       | Yes                            |
| `source`        | `manual` \| `automatic` \| `analysis`         | No       | Yes — defaults to `manual`     |
| `context`       | `object`                                      | No       | Yes                            |

**All five required fields must be present and correctly typed, or the definition is dropped.** A
dropped definition does not fail the load — the prompt still loads without that gate — and the
loader logs a warning naming the prompt, the gate, and every offending field. Any field not in the
table above is discarded silently; it is not part of the contract.

```yaml
gateConfiguration:
  inline_gate_definitions:
    - id: section-contract
      name: Section Contract
      type: validation
      scope: execution
      description: Every declared section is present
      guidance: Check the output against each section the prompt declares.
      pass_criteria:
        - All declared sections present
```

#### Execution status

Inline definitions are **not executed in this release** — they are displayed and analyzed only. They
begin executing in the next release, gated by `gates.executeInlineGateDefinitions`, per the
warn-then-arm migration in [ADR 0001 (d)](../adr/0001-gate-resolution-precedence.md). The warnings
above are the point of the interval: they let an operator see, one release ahead, which prompts in
their workspace would newly arm a gate.

When they do execute:

- The definition contributes its ID at **rank 60 (`prompt-config`)** — the prompt author's tier. It
  does not outrank a gate supplied by whoever invoked the prompt, and a prompt-level `exclude`
  removes it.
- If the ID matches an already-registered gate, the ID stays a **single entry** and the body is
  resolved field by field: **a declared field replaces, an omitted field inherits.** Arrays
  (`pass_criteria`) replace the whole array rather than appending, and objects (`context`,
  `retry_config`) replace wholesale rather than merging key by key — so a narrowed criteria list
  stays narrowed, and a `retry_config` is never a blend neither source authored.

## Injection

Control what guidance is injected when this prompt runs. Resolved between step and chain config —
this prompt's declaration outranks the chain and category it runs inside. See
[Injection Control](../guides/injection-control.md) for the full hierarchy.

Each of the three injection types accepts the same three fields:

| Field       | Type      | Description                                                  |
| ----------- | --------- | ------------------------------------------------------------ |
| `enabled`   | `boolean` | Inject this type for this prompt? Omitted means inherit.     |
| `frequency` | `object`  | `{ mode: every \| first-only \| never, interval?: number }`. |
| `target`    | `enum`    | `steps`, `gates`, or `both`.                                 |

Injection types: `system-prompt` (framework), `gate-guidance` (gate criteria),
`style-guidance` (response formatting).

### Fields that survive normalization

Only `enabled`, `frequency`, and `target` are read. Two consequences worth knowing:

- **Unknown fields are rejected at load time**, not silently ignored — a typo fails validation
  instead of producing a rule that never fires.
- **`conditions` is not available here**, unlike category/chain/step configs. Every condition case
  (`chain-position`, `step-number`, `previous-step-result`) describes a position within a chain
  rather than a property of a prompt, so a prompt declaring one would declare a field nothing could
  act on.

A rule declaring no fields normalizes away entirely, so an empty block cannot shadow the tiers
below it.

### Example

```yaml
injection:
  system-prompt:
    enabled: false # no framework for this prompt, under any active framework
  style-guidance:
    frequency:
      mode: first-only
    target: steps
```

**`system-prompt.enabled: false` also withholds framework-scoring gates.** Scoring adherence to a
framework that was never injected is incoherent, so the gates go with the injection
([ADR 0001](../adr/0001-gate-resolution-precedence.md)). Gates unrelated to framework are
unaffected, and `%judge` overrides the opt-out because judge selection requires the framework.
