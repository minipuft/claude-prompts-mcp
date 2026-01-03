---
name: prompt-authoring
description: Guidance for creating effective prompts, chains, and gates using CAGEERF methodology
version: 1.0.0
---

# Prompt Authoring Guide

This skill provides patterns for creating prompts in the claude-prompts-mcp system.

## CAGEERF Methodology

Prompts follow the **C.A.G.E.E.R.F** framework:

| Phase | Purpose | Output |
|-------|---------|--------|
| **C**ontext | Gather domain knowledge | Situational understanding |
| **A**nalysis | Break down the problem | Structured insights |
| **G**oals | Define success criteria | Measurable objectives |
| **E**xecution | Implement the solution | Concrete deliverables |
| **E**valuation | Validate against goals | Quality assessment |
| **R**efinement | Iterate based on feedback | Improved output |
| **F**inalization | Complete and document | Final deliverable |

## Prompt Structure

```yaml
---
id: my-prompt
name: My Prompt
description: What this prompt accomplishes
category: development
execution_hint: single  # or 'chain'
arguments:
  - name: input
    type: string
    description: Primary input
---
system_message: |
  You are an expert at [domain].

user_message_template: |
  Task: {input}

  Requirements:
  - Requirement 1
  - Requirement 2
```

## Chain Definition

Chains connect prompts with `-->`:

```
>>analyze --> >>design --> >>implement --> >>test
```

**Chain features:**
- Sequential execution with context passing
- Gate validation between steps
- Resume capability with `chain_id`

## Quality Gates

Gates validate output quality:

```yaml
id: code-quality
name: Code Quality Gate
severity: high
criteria:
  - "Code follows established patterns"
  - "Error handling is comprehensive"
pass_criteria:
  - "All criteria met with evidence"
```

**Severity levels:** critical | high | medium | low

## Creating New Prompts

Use the resource_manager tool:

```typescript
resource_manager({
  resource_type: "prompt",
  action: "create",
  id: "new-prompt",
  name: "New Prompt",
  description: "Purpose",
  category: "development",
  system_message: "...",
  user_message_template: "..."
})
```

## Best Practices

1. **Clear objectives**: Define what success looks like
2. **Structured output**: Specify expected format
3. **Validation criteria**: Include checkable requirements
4. **Composability**: Design prompts that chain well
5. **Gate integration**: Add quality checks for critical outputs
