# Growth Capture Gate

Validates that the task declares its learning outcome before completion.

## Growth Declaration Format

```markdown
## Growth Declaration

**Diagnosis Card Pattern**: [name from card, or "no card required"]
**Growth**: [novel → captured where | confirmed → which pattern | nothing new]
**System Delta**: [what the config/skills/rules learned, if anything]
```

## Growth Types

| Type              | Action                                      | Example                                 |
| ----------------- | ------------------------------------------- | --------------------------------------- |
| Novel pattern     | /knowledge-capture — add to canonical table | "Steps 2+5 co-fail = new compound"      |
| Confirmed pattern | Note confirmation, no action needed         | "Service extraction needed — confirmed" |
| Nothing new       | Declare explicitly                          | "Routine fix, no compound patterns"     |

## Rules

- "Nothing new" is acceptable. Silence is not.
- Novel patterns should be captured via /knowledge-capture
- The Growth field in the Diagnosis Card must be filled

## Source

dev-workflow.md Phase 4c
