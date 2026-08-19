# Phase Guards Guide

Phase guards provide deterministic structural validation of LLM output against framework phase definitions. They run at zero LLM cost and compose with gate reviews for comprehensive quality assurance.

## How Phase Guards Work

When a framework defines `processingSteps` with `section_header` and `guards` fields in `phases.yaml`, Pipeline Stage 19 (`19-phase-guard-verification-stage.ts`) automatically checks the LLM's response after execution.

```
LLM Output → Section Splitter → Phase Guard Evaluator → Result
                   │                      │
             Finds sections by         Checks each phase:
             section_header            required, min_length,
             (e.g., "## Context")      contains_any, etc.
```

### Requirements

Phase guards activate when ALL of these are true:

1. A framework is active (via `@CAGEERF`, `@5W1H`, etc.)
2. The framework's `phases.yaml` has processing steps with `section_header` + `guards`
3. Phase guards mode is not `off` in config
4. The execution carries a session — a chain step, or a single prompt with explicit `gates`, a `gate` operator, or `chainSteps` (any of which sets `executionPlan.requiresSession`). Phase guards are not chain-exclusive: a gated single prompt reaches Stage 19 the same way a chain step does

## Defining Phase Guards

Phase guards are defined per processing step in `phases.yaml`:

```yaml
processingSteps:
  - id: context_establishment
    name: Context Establishment
    description: Establish clear situational context
    frameworkBasis: CAGEERF Context phase
    order: 1
    required: true
    section_header: "## Context" # Required for phase guard detection
    guards: # Optional — defines structural rules
      required: true # Section must exist
      min_length: 100 # Minimum character count
      forbidden_terms: # Terms that must NOT appear
        - "TODO"
        - "TBD"
        - "placeholder"
```

### Available Guard Rules

| Rule              | Type     | Description                                                         |
| ----------------- | -------- | ------------------------------------------------------------------- |
| `required`        | boolean  | Section must exist in the output                                    |
| `min_length`      | number   | Minimum character count for the section                             |
| `max_length`      | number   | Maximum character count for the section                             |
| `contains_any`    | string[] | Section must include at least one of these terms (case-insensitive) |
| `contains_all`    | string[] | Section must include ALL of these terms (case-insensitive)          |
| `matches_pattern` | string   | Section must match this regex pattern                               |
| `forbidden_terms` | string[] | Section must NOT contain any of these terms (word-boundary match)   |

### Coherence Requirements

- A step with `guards` **must** also have a `section_header` (validation error otherwise)
- A step with `section_header` but no `guards` triggers a warning (the header serves no purpose without guards)
- `min_length` must not exceed `max_length` when both are defined

## Declared Sections

Phase guards used to grade a response against `section_header` strings that lived only in
`phases.yaml` — nothing derived the prompt-time instruction from that same source, so a guard could
block on a header the model was never told to produce. `server/src/engine/frameworks/declared-sections.ts`
closes that gap: it is the single source both the render path and the grading path read.

```
phases.yaml (section_header + guards)
            │
            └── declared-sections.ts
                        │
                        ├─> resolveDeclaredSections() ──> rendered into the prompt
                        │                                  • chain-operator-executor.ts
                        │                                    (every chain step's Required
                        │                                    Response Format block)
                        │                                  • response-assembler
                        │                                    .formatSinglePromptResponse
                        │                                    (gated single prompts — see below)
                        │
                        └─> resolveGuardedProcessingSteps() ──> Stage 19 evaluation
```

### Gated single prompts declare too

A single (non-chain) prompt reaches Stage 19 whenever it carries an explicit `gates` parameter, a
`gate` operator, or `chainSteps` — any of those sets `executionPlan.requiresSession`, which grants a
session. Before this contract, that path rendered no header vocabulary at all, so a gated single
prompt was graded against headers it was never given. `response-assembler.formatSinglePromptResponse`
now renders the same declared-header block the chain path renders, gated on session presence; an
ungated single prompt still renders nothing.

### Which guard rules the model is told about

Not every `guards` field is safe to declare. `phase-guards/criteria.ts` is a registry that owns both
evaluation and declarability per criterion:

| Criterion         | Declared to the model? | Why                                                                         |
| ----------------- | ---------------------- | --------------------------------------------------------------------------- |
| `contains_any`    | yes                    | An unguessable keyword list — discovering it by trial costs a retry         |
| `contains_all`    | yes                    | Same                                                                        |
| `max_length`      | yes                    | An unstated ceiling is invisible until breached and cannot be fixed in-turn |
| `min_length`      | no (evaluated only)    | Retry feedback already names the exact threshold — not worth the token cost |
| `forbidden_terms` | **never**              | Declaring what is rejected hands over the evasion target                    |
| `matches_pattern` | **never**              | Same — and the natural home for a future sensitive-data check               |

`required` is not in this table: it addresses _which_ header must be present, not what its content
must satisfy, so it is not a criterion. The two negative criteria carry `declare?: never` in their
type — a criterion that tries to declare itself is a compile error, not a review comment that can be
missed.

### A guard may only block on a header the render actually declared

This is the load-bearing rule the rest of the contract exists to support:

- What a chain step or gated single prompt actually rendered is recorded per run-node, in
  `chain_run_nodes.declared_sections_json` (schema v24) — a durable fact, not a re-derivation from
  `phases.yaml`. Re-deriving would make "declared" and "guarded" identical by construction, which
  would make the advisory branch below unreachable by design.
- Stage 19 reads that record back and partitions a phase's guarded sections into two groups: headers
  the render declared (still block on absence, per the existing `required` rule) and headers it did
  not (advisory only — a warning is logged, the run is not blocked).
- A run with no recorded declaration at all is treated as having declared nothing, never as having
  declared everything. This direction is deliberate: the contract can only make blocking **rarer**
  than before, never stricter.

### Guarded-but-unaddressable frameworks are refused at load

A `guards` block with no `section_header` was always a schema error, but the validator that catches
it had no production caller. Framework load now calls it: a framework that declares `guards` on a
phase with no `section_header` is refused at load, and the logged error names the offending phase.

### Drift between the prompt copy and `phases.yaml` is a CI gate

A handful of prompts (the `implementation_plan` chain and `examples/create_framework`) restate the
header vocabulary in hand-written pedagogy — the tables carry per-header guidance that generation
would lose, so they are kept rather than derived. `server/scripts/validate-phase-header-drift.js`
catches the failure mode that motivated this contract: a prompt file that restates a `section_header`
no `phases.yaml` declares. It distinguishes a genuine declaration (named inside a phase-guard table,
or a fenced example corroborated elsewhere in the same file) from an ordinary Markdown heading, so
unrelated prompts using a heading like `## Context` for their own purposes do not false-positive.
Registered in `validate:all`.

## Enforcement Modes

Phase guard behavior is controlled by the `phaseGuards.mode` config setting:

| Mode      | Behavior                                                                           | When to Use                            |
| --------- | ---------------------------------------------------------------------------------- | -------------------------------------- |
| `enforce` | Creates a pending gate review on failure — blocks chain advancement until resolved | Production quality enforcement         |
| `warn`    | Logs a warning but does not block                                                  | Development, exploration               |
| `off`     | Phase guards are completely skipped                                                | When structural checks are not desired |

### Configuration

In `config.json`:

```json
{
  "phaseGuards": {
    "mode": "enforce",
    "maxRetries": 2
  }
}
```

### Enforce Mode Flow

```
Phase guards fail
  → PendingGateReview created with retry feedback
  → Stage 10 renders feedback to the LLM
  → LLM revises response addressing structural issues
  → Stage 09b re-evaluates on next turn
  → After maxRetries: user gets gate_action prompt (retry/skip/abort)
```

### Warn Mode Flow

```
Phase guards fail
  → Warning logged to diagnostics
  → Advisory warning added to context
  → Chain proceeds normally (no blocking)
```

## Phase Guard + Gate Composition

Phase guards and LLM gates validate **orthogonal dimensions** — structure vs content quality. They compose rather than replace each other.

### When Phase Guards Pass

The phase guard pass summary is prepended to the gate review prompt:

```markdown
## Structural Verification: PASS

Deterministic phase guard checks passed (4/4 phases verified):

- **context_establishment**: found, 3/3 checks passed
- **systematic_analysis**: found, 3/3 checks passed
- **goal_definition**: found, 3/3 checks passed
- **execution_planning**: found, 3/3 checks passed

Structure is verified. Focus your review on **content quality** — depth of analysis,
actionability, and adherence to gate criteria below.
```

This tells the gate reviewer: "Structure is solid — focus on substance."

### When Phase Guards Fail

Phase guard failures take priority. A pending gate review is created with structural feedback, and the LLM must fix the structural issues first before content quality is evaluated.

### Composition Matrix

| Phase Guards | Gates     | Result                                |
| ------------ | --------- | ------------------------------------- |
| Pass         | Pass      | Clean pass — highest quality          |
| Pass         | Fail      | Structure OK, content needs revision  |
| Fail         | (skipped) | Structure must be fixed first         |
| Off          | Pass/Fail | Gates only — no structural validation |

## JSON Schema

IDE-friendly JSON Schemas for `phases.yaml` and `framework.yaml` are generated from the Zod SSOT:

```bash
npm run generate:schemas
```

Output: `resources/schemas/phases.schema.json` and `resources/schemas/framework.schema.json`

These enable autocomplete and inline validation in editors that support YAML Language Server.

## See Also

- [Gates Guide](./gates.md) — LLM-based quality validation
- [Judge Mode Guide](./judge-mode.md) — Context-isolated gate evaluation
- [Architecture Overview](../architecture/overview.md) — Pipeline stage details
