# Integration Assessment: {{library}}

## Context

{{context}}

{% if current_stack %}

## Current Stack

{{current_stack}}
{% endif %}

{% if technical_findings %}

## Technical Findings to Consider

{{technical_findings}}
{% endif %}

---

Assess the **practical integration** of `{{library}}` into your project:

## 1. Compatibility Matrix

| Dependency      | Your Version | Library Requires | Compatible? |
| --------------- | ------------ | ---------------- | ----------- |
| Node.js         |              |                  |             |
| TypeScript      |              |                  |             |
| React/Framework |              |                  |             |
| Build Tool      |              |                  |             |

### Peer Dependencies

List any peer dependencies and version constraints.

## 2. Migration Effort

### If Replacing Existing Solution

| Aspect         | Effort (1-5) | Notes |
| -------------- | ------------ | ----- |
| API changes    |              |       |
| Test updates   |              |       |
| Config changes |              |       |
| Data migration |              |       |

**Total estimated effort**: [Hours/Days/Weeks]

### If New Addition

- Setup complexity
- Learning curve for team
- Documentation needs

## 3. Integration Pattern

```typescript
// Recommended integration approach
// Show how it fits with existing patterns
```

### File/Folder Impact

```
src/
├── [files to add]
├── [files to modify]
└── [files to remove if replacing]
```

## 4. Risk Assessment

| Risk                        | Likelihood | Impact | Mitigation |
| --------------------------- | ---------- | ------ | ---------- |
| Breaking changes in updates |            |        |            |
| Team learning curve         |            |        |            |
| Debugging complexity        |            |        |            |
| Vendor lock-in              |            |        |            |

## 5. Incremental Adoption Path

Can this be adopted incrementally?

- [ ] Yes - describe the path
- [ ] No - requires big-bang migration

### Recommended Phases

1. Phase 1: ...
2. Phase 2: ...
3. Phase 3: ...

## 6. Rollback Plan

If adoption fails, what's the rollback strategy?

- Effort to revert
- Data considerations
- Parallel running possibility

---

**Output**: Actionable integration plan with realistic effort estimates.
