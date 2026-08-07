## Intent Declaration Validation

This gate ensures the triage output is actionable and complete.

### Required Elements

1. **Work Type** - Must be exactly one of the defined types
2. **Secondary Type** - Must be "none" or a valid work type
3. **Confidence** - Indicates how certain the analysis is
4. **Scope** - Specific files and systems, not vague descriptions
5. **Risk** - Assessment of potential impact
6. **External Dependencies** - "none" or specific lib@version entries
7. **Source Spec** - "none" or reference to spec/ticket/plan
8. **Acceptance Criteria** - When source spec exists, at least one criterion with observable behavior and verification method
9. **Problem Statement** - Clear current→desired transformation
10. **Approach** - Concrete next steps
11. **Next Phase** - Correct routing based on work type

### Routing Rules

| Work Type | Next Phase       | Rationale                     |
| --------- | ---------------- | ----------------------------- |
| bug_fix   | /testing         | Reproduce bug before fixing   |
| feature   | /refactoring     | Pre-flight architecture check |
| refactor  | /refactoring     | Validate structure changes    |
| explore   | Continue /search | Need more information         |
| optimize  | Profile first    | Measure before optimizing     |

When secondary type is declared, primary determines route. Secondary adds a constraint (see compound routing table in triage prompt).

### Common Failures

- Vague scope ("some files" instead of specific paths)
- Missing confidence level
- Problem statement without clear transformation
- Next phase doesn't match work type
- Source spec referenced but no acceptance criteria extracted
- Acceptance criteria without observable behaviors (untestable)
- Compound work type but secondary type not declared
- External dependencies listed without version
