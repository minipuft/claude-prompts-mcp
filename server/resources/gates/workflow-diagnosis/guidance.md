# Diagnosis Card Gate

Validates that signals are synthesized into a named diagnosis before implementation begins.

## Required Sections

The Diagnosis Card must contain:

- **Signals**: What was observed, from which skills/checks
- **Pattern**: Named compound from canonical tables, or "novel — [proposed name]"
- **Justification**: Why this pattern maps to the proposed action
- **Growth**: To be filled at Phase 4c (can be placeholder at this stage)

## When Required

- Pre-flight has 2+ failures
- 2+ skills invoked on same area
- Multi-file changes planned
- Secondary work type declared in Intent Declaration

## When Exempt

- Single-file, single-skill, ≤1 pre-flight issue
- Simple tasks (typo, config value, single clear fix)

## Canonical Tables

Cross-reference against:

- refactoring.md Pattern Diagnostics
- CLAUDE.md Pattern Escalation
- CLAUDE.md Multi-Skill Synthesis

## Source

dev-workflow.md Phase 2→3 Gate
