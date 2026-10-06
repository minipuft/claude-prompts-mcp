---
number: NNNN
title: "<title>"
status: proposed
date: YYYY-MM-DD
initiative:
supersedes:
superseded_by:
---

# ADR NNNN: <title>

## Context

What problem are we solving? What forces and constraints apply?

- Current behavior and pain points
- Requirements (functional, non-functional)
- Constraints (compatibility, supported runtime versions, CI)

## Decision

What are we doing, specifically?

- The decision, stated as a clear commitment
- Scope of change (what is in / out)
- Interfaces/contracts impacted (public APIs, schemas, runtime state)
- Migration plan (if applicable) and the “remove legacy” criteria

## Alternatives considered

List realistic options and why they were not chosen.

1. Option A
2. Option B
3. Do nothing

## Consequences

What changes after this decision?

### Positive

- Expected benefits

### Negative / risks

- Tradeoffs, risks, and mitigations

### Follow-ups

- Concrete next steps (issues/PRs/plans)

## Validation

How do we prove this decision works?

- Commands to run (typecheck/lint/tests/validate)
- Runtime checks (smoke tests against the changed surface)
- Compatibility notes (supported environment matrix)

## References

- Related PRs/issues/plans
- Supersedes / superseded-by links (if applicable)
