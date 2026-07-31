# Phase Guards Guide

Phase guards provide deterministic structural validation of LLM output against framework phase definitions. They run at zero LLM cost and compose with gate reviews for comprehensive quality assurance.

## How Phase Guards Work

When a framework defines `processingSteps` with `section_header` and `guards` fields in `phases.yaml`, Pipeline Stage 09b automatically checks the LLM's response after execution.

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
4. The execution is within a chain session (phase guards validate chain step responses)

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

Output: `resources/schemas/phases.schema.json` and `resources/schemas/methodology.schema.json`

These enable autocomplete and inline validation in editors that support YAML Language Server.

## See Also

- [Gates Guide](./gates.md) — LLM-based quality validation
- [Judge Mode Guide](./judge-mode.md) — Context-isolated gate evaluation
- [Architecture Overview](../architecture/overview.md) — Pipeline stage details
