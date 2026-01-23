## Intent Declaration Validation

This gate ensures the triage output is actionable and complete.

### Required Elements

1. **Work Type** - Must be exactly one of the defined types
2. **Confidence** - Indicates how certain the analysis is
3. **Scope** - Specific files and systems, not vague descriptions
4. **Risk** - Assessment of potential impact
5. **Problem Statement** - Clear current→desired transformation
6. **Approach** - Concrete next steps
7. **Next Phase** - Correct routing based on work type

### Routing Rules

| Work Type | Next Phase | Rationale |
|-----------|------------|-----------|
| bug_fix | /testing | Reproduce bug before fixing |
| feature | /refactoring | Pre-flight architecture check |
| refactor | /refactoring | Validate structure changes |
| explore | Continue /search | Need more information |
| optimize | Profile first | Measure before optimizing |

### Common Failures

- Vague scope ("some files" instead of specific paths)
- Missing confidence level
- Problem statement without clear transformation
- Next phase doesn't match work type