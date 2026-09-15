# Gate Configuration Reference

Full schema for defining reusable quality gates in `resources/gates/{id}/gate.yaml`.

> **Scope**: this page documents **standalone `gate.yaml` files** — reusable gates the registry
> activates by category or framework. It is not the schema for a prompt's own
> `gateConfiguration.inline_gate_definitions` block, which is narrower and documented in
> [Prompt YAML Schema § Inline Gate Definitions](prompt-yaml-schema.md#inline-gate-definitions).
> The two are related but not interchangeable: an inline definition is scoped to one prompt and
> registered per execution, and it accepts fewer fields.

## Why This Matters

| Problem             | Solution            | Result                                    |
| ------------------- | ------------------- | ----------------------------------------- |
| **Ad-Hoc Review**   | Standardized Config | Same quality bar across the team          |
| **Silent Failures** | Severity Levels     | Block critical issues, warn on minor ones |
| **Repetition**      | Auto-Activation     | Gates apply automatically by category     |

---

## Root Fields

| Field             | Type     | Required | Description                                                                      |
| ----------------- | -------- | -------- | -------------------------------------------------------------------------------- |
| `id`              | `string` | **Yes**  | Unique ID (e.g., `code-quality`).                                                |
| `name`            | `string` | **Yes**  | Human-readable name.                                                             |
| `type`            | `string` | No       | `validation` (checks) or `guidance` (hints).                                     |
| `description`     | `string` | No       | Tooltip description.                                                             |
| `subject`         | `string` | No       | Kebab-case tag naming what this gate reminds about. See [§ `subject`](#subject). |
| `guidanceFile`    | `string` | No       | Path to markdown file with instructions.                                         |
| `severity`        | `string` | No       | `critical`, `high`, `medium`, `low`. Default: `medium`.                          |
| `enforcementMode` | `string` | No       | `blocking` (must pass), `advisory` (warn only).                                  |

---

## Tiers

A gate is a `check` when at least one of its `pass_criteria` entries carries a real runtime
evaluator — `shell_verify` (exit-code ground truth) or `script_tool` (structured verdict from a
registered tool). Every other gate is a `reminder`, including a gate with no `pass_criteria` at
all, and a gate whose `pass_criteria` only sets the pattern/length fields (below) — those render
as prose and have no evaluator that flips a verdict.

| Gate           | Criterion type                   | Tier       |
| -------------- | -------------------------------- | ---------- |
| `test-suite`   | `shell_verify` (runs `npm test`) | `check`    |
| `code-quality` | `inline_guidance`                | `reminder` |

The tier decides how a gate renders and enforces: checks contribute one line naming what runs and
are recorded by the engine, and a `PASS` verdict walking past a recorded failure is refused by
gate id; reminders render full guidance, subject to `harnessCovers` suppression and the token
budget below. See [Gates Guide § Verdicts and reminders](../guides/gates.md#verdicts-and-reminders)
for the enforcement side, and the generated
[`resources/gates/_index.md`](../../server/resources/gates/_index.md) for a `Tier` column per gate
so this never has to be derived by hand.

## `subject`

A free kebab-case tag (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, e.g. `code-quality`, `security`) naming what
a gate's reminder is about. It is optional — a reminder with no `subject` names no coverable topic
and can never be suppressed.

`subject` exists for one downstream use: an installation's `gates.harnessCovers` list (below)
suppresses a reminder whose `subject` appears in it, on the theory that the installation's own
rules or hooks already cover that topic. Checks (`shell_verify` / `script_tool`) are never
suppressed by `subject`, regardless of what it names — a check states a runtime fact, not a
reminder an installation could already be giving some other way.

The generated gate index (`resources/gates/_index.md`) carries a `Subject` column so an operator
can copy the exact spelling into `harnessCovers` rather than guessing at it.

---

## Activation Rules

When does this gate apply automatically?

| Field               | Type             | Description                                                 |
| ------------------- | ---------------- | ----------------------------------------------------------- |
| `prompt_categories` | `string[]`       | Auto-apply to prompts in these folders (e.g., `code`).      |
| `explicit_request`  | `boolean`        | If `true`, only applies when user asks (e.g., `pr-review`). |
| `framework_context` | `string[]`       | Applies when using these frameworks (e.g., `CAGEERF`).      |
| `artifacts`         | `ArtifactKind[]` | When present, DECIDES activation alone — see below.         |

### Example

```yaml
activation:
  prompt_categories: ["development", "api"]
  framework_context: ["ReACT"]
```

### Artifacts decide activation when present (ruling B13)

A gate declares the artifact it checks instead of guessing from the prompt category that
invoked it — a `code-quality` gate should attach because source changed, not because the prompt
happened to live under `development/`. `activation.artifacts` names the kinds this gate cares
about:

```yaml
activation:
  artifacts: ["source"]
```

When a gate names `artifacts`, that field decides ALONE: the gate attaches if the run declared
at least one of the named kinds, and `prompt_categories` is not consulted at all — even if the
block still carries one (a gate that names both is stating what it checks twice; the artifact
statement is the specific one and wins). `explicit_request` and, for framework gates,
`framework_context` are independent conditions and still apply alongside `artifacts`.

The kind vocabulary is fixed and lives in one place, `engine/gates/utils/artifact-kinds.ts`:
`source`, `test`, `docs`, `readme`, `plan`, `changelog`, `config`, `prompt`, `gate`, `pr-body`.
`pr-body` is declaration-only — no file path classifies to it, because a PR body is not a file on
disk. A prompt that manufactures one declares it explicitly (`produces: ["pr-body"]`); the kind
exists so that declaration has somewhere to point.

A run declares the artifacts it touches on the **prompt**, not the gate, with a top-level
`artifacts:` block:

```yaml
# prompt.yaml
artifacts:
  produces: ["plan"] # kinds this prompt always produces, whatever it is invoked with
  fromArgument: files # name of a declared argument carrying the paths this run touches
```

`produces` and `fromArgument` union. `fromArgument` must name an argument the prompt actually
declares in its `arguments:` list — the prompt schema refuses to load one that names an
undeclared argument, catching the typo at authoring time instead of at a silent runtime miss.
At execution, the named argument's value is split into candidate paths and each one is
classified into a kind by the same path table `activation.artifacts` reads against; a prompt
declaring neither `produces` nor `fromArgument`, or whose argument carries no paths, simply
declares nothing — every artifact-scoped gate stays off for that run, since "declared nothing"
and "declared some other kind" must stay distinguishable.

### No Activation Block

Omitting `activation` entirely is opt-in, not always-on: the gate never auto-attaches to any
prompt or chain step. It still activates where something names it directly — a prompt's
`gateConfiguration.include`, or a chain step's `inlineGateIds` — because both of those paths add
the gate id without consulting activation rules at all. To keep the old always-active behavior,
declare an explicit empty block instead of omitting the field:

```yaml
activation: {}
```

A gate with no `activation` block and no `include`/`inlineGateIds` reference anywhere in the
resource tree is unreachable. `npm run validate:prompts` fails on it with `ORPHAN <gate-id>`,
naming the gate that needs either an activation rule or an explicit reference.

---

## Pass Criteria & Retries

Define how strict the gate is. Each `pass_criteria` entry's `type` selects one of four
enforcement modes — this is also what [Tiers](#tiers) reads to decide `check` vs `reminder`.

| `type`                 | Enforcement                                                                                                                                          | When to use                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `inline_guidance`      | None — rendered as an agent-facing checklist.                                                                                                        | Soft criteria the agent self-assesses (style, completeness reminders).               |
| `framework_compliance` | None — auto-passed by `GateValidator`. `PhaseGuardVerificationStage` enforces framework phase guards from `phases.yaml` independently of this value. | Declaring intent only.                                                               |
| `shell_verify`         | Hard — runs `shell_command` as argv, exit 0 = pass.                                                                                                  | Ground-truth checks: tests passing, files existing, content claims matching reality. |
| `script_tool`          | Hard — resolves `script_tool_id` to a registered tool and runs it with JSON stdin, parsing `{passed, reason?}` back.                                 | Checks needing typed arguments and an explained verdict.                             |

`llm_self_check` never had a runner and is not a valid `type`. Declaring it is rejected at schema
validation with an error naming the replacement: use `inline_guidance` (reminder) or
`shell_verify` / `script_tool` (check).

```yaml
pass_criteria:
  - type: inline_guidance

retry_config:
  max_attempts: 2
  improvement_hints: true
```

| Field               | Description                                        |
| ------------------- | -------------------------------------------------- |
| `max_attempts`      | How many times Claude retries before failing.      |
| `improvement_hints` | Feed validation errors back into the retry prompt. |

### Pattern/length fields are rejected at load

`required_patterns`, `forbidden_patterns`, `regex_patterns`, `keyword_count`, `min_length`, and
`max_length` are **not** accepted on a `pass_criteria` entry. None of them ever had a runtime
evaluator — they used to render into the reminder's guidance text as prose and were never
evaluated against the agent's actual output, so setting one never made a gate a `check` (see
[Tiers](#tiers)) even while the schema still accepted it. `validateGateSchema` now refuses a
criterion carrying any of these six fields, naming the field and the fix.

| If you want this...                                           | Do this instead                                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A reminder sentence ("must mention X", "avoid Y", "≥N chars") | Put the sentence in `guidance` / `guidanceFile` — the agent self-assesses against it.                                                                              |
| A real, evaluated check                                       | Use `shell_verify` (exit-code ground truth) or `script_tool` (structured verdict), optionally against the agent's response (`shell_stdin_source: agent_response`). |

---

## Harness coverage and the reminder budget

Two `gates` config keys (`config.json` / `server/config.schema.json`) control how many reminders
reach the model and at what length, once [`subject`](#subject) has named what each reminder is
about:

| Key                         | Type       | Default | Description                                                                                                                                                                           |
| --------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gates.harnessCovers`       | `string[]` | `[]`    | Reminder subjects this installation's harness already covers (its own rules or hooks). A reminder gate whose `subject` is listed is not rendered; checks are never suppressed.        |
| `gates.reminderTokenBudget` | `integer`  | `800`   | Estimated tokens of reminder guidance rendered per dispatch. Reminders over the budget render as one line each, in priority order; nothing is dropped. Checks are outside the budget. |

Copy exact subject spellings from the `Subject` column of
[`resources/gates/_index.md`](../../server/resources/gates/_index.md) into `harnessCovers` —
guessing at the spelling means a reminder that was meant to be suppressed keeps rendering.

**Estimator.** Each rendered reminder's size is estimated as `Math.ceil(chars / 4)` — a coarse
constant (`REMINDER_CHARS_PER_TOKEN`) on purpose, since the budget is a ceiling, not a
measurement.

**Degrade rule.** Reminders are ordered explicitly-requested first, then by severity descending
(`critical` > `high` > `medium` > `low`), then by the order they were supplied in. Once the next
reminder in that order would push the running token total past `reminderTokenBudget`, it and every
later reminder collapse to a single line — `- **Name** — description` — instead of full guidance.
Nothing is dropped: a reminder past the budget still appears, just degraded to its one-liner.

**Checks are never suppressed.** `harnessCovers` and `reminderTokenBudget` apply to reminders
only. A `check` (`shell_verify` / `script_tool`) always renders — one line naming the command or
tool it runs — regardless of `subject`, coverage, or budget, because it states what the engine is
about to measure, not guidance the model could self-assess instead.
