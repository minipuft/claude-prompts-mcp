# Judge Mode Guide

Judge mode provides context-isolated gate evaluation to prevent self-evaluation bias. Instead of the same LLM reviewing its own output with full generation context, a separate "judge" sub-agent receives ONLY the output and criteria.

## The Problem: Self-Evaluation Bias

In standard gate review (self mode), the LLM that generated the output also evaluates it:

```
LLM generates response → Same LLM evaluates "Did I do well?"
                                      │
                          Has access to:
                          - Original prompt
                          - Chain history
                          - Framework reasoning
                          - Its own generation context
                          │
                          Result: Tendency to confirm own work
```

## The Solution: Judge Mode

Judge mode strips all generation context. The evaluator sees only output + criteria:

```
LLM generates response → Judge sub-agent evaluates
                                  │
                        Receives ONLY:
                        - Raw output text
                        - Gate criteria list
                        - Verdict format instructions
                        │
                        Result: Objective evaluation
```

### Key Design Decisions

- **"You did NOT produce this output"** — explicitly breaks self-identification
- **Standard verdict format** — `GATE_REVIEW: PASS|FAIL - reason` reuses existing parsing
- **No chain history** — judge has zero context about generation process
- **Strict framing available** — forces "list failures FIRST" for evidence-based evaluation

## Configuration

### Per-Gate Configuration

In `gate.yaml`:

```yaml
id: my-gate
name: Quality Gate
evaluation:
  mode: judge # 'self' (default) or 'judge'
  model: claude-haiku # Optional: cheaper model for evaluation
  strict: true # Optional: strict evaluation protocol
```

### Global Defaults

In `framework.yaml` or `config.json`:

```yaml
gates:
  evaluation:
    defaultMode: self # Default mode for all gates
    defaultModel: claude-haiku
    strict: false # Default strict setting
```

### Resolution Hierarchy

Gate-level settings override global defaults:

```
gate.evaluation.mode    > config.gates.evaluation.defaultMode  > 'self'
gate.evaluation.model   > config.gates.evaluation.defaultModel > (none)
gate.evaluation.strict  > config.gates.evaluation.strict       > (mode === 'judge')
```

When `strict` is not explicitly set, it defaults to `true` for judge mode and `false` for self mode.

## Evaluation Modes

| Mode    | Evaluator          | Context                 | Default strict |
| ------- | ------------------ | ----------------------- | -------------- |
| `self`  | Same LLM           | Full generation context | `false`        |
| `judge` | Separate sub-agent | Output + criteria only  | `true`         |

## Strict vs Balanced Evaluation

The `strict` flag controls the evaluation protocol the judge follows:

### Strict (`strict: true`)

```
1. For each criterion, list specific ways the output FAILS to meet it
2. Provide direct evidence from the output for each failure
3. Only PASS if you cannot find genuine failures after thorough examination
```

Best for: High-stakes output, production content, security-sensitive criteria.

### Balanced (`strict: false`)

```
1. For each criterion, assess whether the output meets the requirement
2. Provide evidence from the output supporting your assessment
3. PASS if the output substantially meets all criteria; FAIL otherwise
```

Best for: Creative work, drafts, exploratory analysis.

## Using Judge Mode in Chains

Judge mode is particularly valuable in multi-step chains where quality compounds:

```bash
# Research → Analysis with judge-evaluated gate
>>research --> >>analyze :: code-quality
```

When `code-quality` gate has `evaluation.mode: judge`, the analysis output is sent to an independent evaluator that cannot see the research step or framework reasoning.

### Cost Optimization

Use a smaller model for judge evaluation to reduce cost while maintaining independence:

```yaml
evaluation:
  mode: judge
  model: claude-haiku # Cheaper model for structural evaluation
```

The judge doesn't need the full model's capabilities — it only needs to match output against criteria.

## The Judge Envelope

Internally, judge mode constructs a `JudgeEnvelope` containing only:

| Field           | Content                  | Source                       |
| --------------- | ------------------------ | ---------------------------- |
| `output`        | Raw LLM output text      | The response being evaluated |
| `criteria`      | Gate criteria list       | From gate definition         |
| `gateName`      | Gate name for context    | From gate definition         |
| `gateId`        | Gate identifier          | From gate definition         |
| `strict`        | Evaluation protocol flag | Resolved from config         |
| `verdictFormat` | Expected verdict format  | Standard format              |

Everything else — prompt template, chain history, framework context, generation reasoning — is excluded.

## Judge Prompt Template

The rendered judge prompt follows this structure:

```markdown
## Judge Evaluation — Independent Quality Audit

You are an independent quality reviewer.
Evaluate the following output against the criteria below.

**IMPORTANT: You did NOT produce this output. Evaluate it objectively.**

### Output Under Review

[raw output text]

### Evaluation Criteria (Gate Name)

- Criterion 1
- Criterion 2

### Evaluation Protocol

[strict or balanced instructions]

Respond with: `GATE_REVIEW: PASS|FAIL - reason`
```

## Composition with Assertions

Judge mode and assertions are complementary:

| Layer         | Validates                           | Cost                     | Independence            |
| ------------- | ----------------------------------- | ------------------------ | ----------------------- |
| Assertions    | Structure (sections, length, terms) | Zero (deterministic)     | N/A — rule-based        |
| Gates (self)  | Content quality                     | LLM cost                 | Low — self-review       |
| Gates (judge) | Content quality                     | LLM cost (separate call) | High — context-isolated |

Typical stack for highest quality:

```
Assertions (structural) → Judge gate (content quality)
```

## See Also

- [Gates Guide](./gates.md) — Gate system overview
- [Assertions Guide](./assertions.md) — Deterministic structural validation
- [Architecture Overview](../architecture/overview.md) — Pipeline stage details
