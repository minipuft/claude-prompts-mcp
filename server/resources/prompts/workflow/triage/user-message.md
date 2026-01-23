## Triage Request

**User Request**: {{request}}

{% if context %}**Additional Context**: {{context}}{% endif %}

{% if files %}**Relevant Files**: {{files}}{% endif %}

---

## Analysis Steps (Execute in Order)

### 1. OBSERVE: Current Behavior

Search the codebase to understand what currently exists.

- What code handles this area?
- What is the current behavior?
- Are there existing tests?

### 2. EXPECT: Desired Behavior

- What should happen instead?
- Is this documented anywhere?
- What does the user actually want?

### 3. CLASSIFY: Work Type

Compare current vs expected to determine:

- **bug_fix**: Current ≠ Expected (something broken)
- **feature**: Expected doesn't exist yet
- **refactor**: Current = Expected, but structure needs improvement
- **explore**: Can't classify yet, need more investigation
- **optimize**: Current = Expected, but too slow/resource-heavy

### 4. SCOPE: Impact Analysis

- What files/modules are affected?
- What systems does this touch?
- What's the risk level?

---

## Required Output: Intent Declaration

After analysis, produce this EXACT format:

```markdown
## Intent Declaration

**Work Type**: [bug_fix | feature | refactor | explore | optimize]
**Confidence**: [high | medium | low]

**Scope**:

- Files: [list specific files]
- Systems: [list affected systems]
- Risk: [low | medium | high]

**Problem Statement**:
[Current state] → [Desired state]

**Recommended Approach**:
[2-3 sentences on how to proceed]

**Next Phase**: [/refactoring | /testing | continue exploration]
```

**Routing Rules**:

- bug_fix → `/testing` (reproduce bug first)
- feature → `/refactoring` (pre-flight check)
- refactor → `/refactoring` (architecture validation)
- explore → Continue `/search` (loop until intent emerges)
- optimize → Profile first, then implement
