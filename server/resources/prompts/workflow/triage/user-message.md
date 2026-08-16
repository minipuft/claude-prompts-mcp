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

If the request involves two work types, identify both. The higher-risk type is primary.

### 4. SCOPE: Impact Analysis

- What files/modules are affected?
- What systems does this touch?
- What's the risk level?
- Are external libraries involved? Which versions?

### 5. SOURCE SPEC: Acceptance Criteria

- Does the request reference a spec, ticket, plan, or user story?
- If yes: extract concrete acceptance criteria with observable behaviors
- If no: state "none" — do not invent criteria

---

## Required Output: Intent Declaration

After analysis, produce this EXACT format:

```markdown
## Intent Declaration

**Work Type**: [bug_fix | feature | refactor | explore | optimize]
**Secondary Type**: [none | bug_fix | feature | refactor | optimize]
**Confidence**: [high | medium | low]

**Scope**:

- Files: [list specific files]
- Systems: [list affected systems]
- Risk: [low | medium | high]

**External Dependencies**: [none | lib@version, lib@version]

**Source Spec**: [none | ticket URL | spec.md | checkpoint plan | user story]

**Acceptance Criteria** (when source spec exists):
| # | Criterion | Observable Behavior | Verification |
|---|-----------|-------------------|--------------|
| 1 | [what must be true] | [how to observe it] | [test type or manual check] |

**Problem Statement**:
[Current state] → [Desired state]

**Recommended Approach**:
[2-3 sentences on how to proceed]

**Next Phase**: [/refactoring | /testing | continue exploration]
```

**Routing Rules**:

| Work Type | Next Phase         | Rationale                 |
| --------- | ------------------ | ------------------------- |
| bug_fix   | `/testing`         | Reproduce bug first       |
| feature   | `/refactoring`     | Pre-flight check          |
| refactor  | `/refactoring`     | Architecture validation   |
| explore   | Continue `/search` | Loop until intent emerges |
| optimize  | Profile first      | Measure before optimizing |

**Compound Routing** (when secondary type declared):

| Primary + Secondary | Route                             | Added Constraint                                   |
| ------------------- | --------------------------------- | -------------------------------------------------- |
| feature + refactor  | `/refactoring`                    | Pre-flight covers BOTH new code and displaced code |
| bug_fix + refactor  | `/testing` → fix → `/refactoring` | After fix, refactor surrounding structure          |
| feature + optimize  | `/refactoring`                    | Performance budget check during implementation     |
| refactor + optimize | `/refactoring`                    | Profile before AND after structural changes        |
