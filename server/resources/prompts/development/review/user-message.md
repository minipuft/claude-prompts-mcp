Review the following code:

**Target**: {{target}}
{% if context %}**Context**: {{context}}{% endif %}
{% if stack %}**Stack**: {{stack}}{% endif %}

---

## Phase 1: Context Discovery

First, understand the code's environment:

- What is the purpose of this code?
- What technology stack and libraries are involved?
- What existing patterns does this codebase use?

## Phase 2: Standards Analysis

Evaluate against modern standards:

### 2.1 Language/Framework Standards

- [ ] Follows current language idioms (not legacy patterns)
- [ ] Uses framework features correctly (hooks, lifecycle, etc.)
- [ ] Applies library best practices (check official docs if uncertain)

### 2.2 Code Quality

- [ ] Clear naming (descriptive, consistent, domain-appropriate)
- [ ] Appropriate abstraction level (not over/under-engineered)
- [ ] Error handling (explicit, meaningful, recoverable where possible)
- [ ] Type safety (if applicable)

### 2.3 Security

- [ ] Input validation at boundaries
- [ ] No secrets or credentials exposed
- [ ] Safe data handling

## Phase 3: Lifecycle & State Safety (CRITICAL)

**Verify no services race for state or steal ownership:**

### 3.1 State Persistence Audit

- [ ] All state mutations are awaited (no fire-and-forget)
- [ ] Persistence errors propagate (not swallowed in catch blocks)
- [ ] In-memory and persisted state cannot diverge (single write path)
- [ ] No dual-write patterns (writing same state to two locations)

### 3.2 Service Race Detection

- [ ] No two services write to the same state file or table row
- [ ] Pipeline stages don't mutate state owned by another stage
- [ ] Clear ownership: each state file/table has exactly one writer
- [ ] Event-driven communication where multiple services need the same data

### 3.3 Lifecycle Integrity

- [ ] New systems fully replace old (no parallel coexistence without migration plan)
- [ ] No orphaned references to removed systems (`rg` for old names)
- [ ] Interfaces consumed match interfaces declared (no hidden transformations)
- [ ] Constructor dependencies injected (no global/singleton state access)

## Phase 4: Consolidation Check (CRITICAL)

**Before approving ANY new code, verify:**

### 4.1 Duplicate Detection

Search the codebase for:

- Similar function names or purposes
- Overlapping functionality
- Parallel implementations of the same concept

### 4.2 Reuse Opportunities

Identify if:

- Existing utilities could be used instead
- Shared abstractions already exist
- Common patterns should be extracted

### 4.3 Integration Points

Check if:

- This duplicates work from another module
- An existing service should be extended instead
- Cross-cutting concerns are already handled elsewhere

## Phase 5: Findings Report

### Issues Found

| Severity | Location | Issue | Recommendation |
| -------- | -------- | ----- | -------------- |
| ...      | ...      | ...   | ...            |

### Consolidation Opportunities

| Existing System | New Code | Action                     |
| --------------- | -------- | -------------------------- |
| ...             | ...      | Reuse/Extend/Keep separate |

### Summary

- **Approve / Request Changes / Needs Discussion**
- Key strengths
- Critical issues (if any)
- Recommended next steps
