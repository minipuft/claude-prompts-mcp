---
title: "Project Guidance Compatibility Projection — Implementation Notes"
plan: project-guidance-projection-2026-08-21.md
date: 2026-08-21
status: reference
tags: [agent-guidance, implementation-notes]
---

# Project Guidance Compatibility Projection — Implementation Notes

## Deviations

- The existing ignored `AGENTS.md` was not a valid migration source: it declared Node 18 server
  support, SSE parity, and a five-level gate precedence that current contracts explicitly reject.
  It was replaced rather than concatenated. Two still-valid unique constraints were rewritten
  precisely in `CLAUDE.md`: the client-work execution boundary and `PromptGuidanceService`
  ownership.

## Validation

- Generator self-test: 6/6 passed.
- Positive and deliberately drifted `guidance:check` probes behaved correctly.
- Simulated pre-commit with an isolated Git index regenerated and staged byte-identical output.
- Project unit suite: 209 suites, 2,719 tests passed; one skipped.
- `validate:all`: 41/45 steps passed. The new `validate:agent-guidance` step passed. Four unrelated
  existing gates failed: one test type-ratchet file, two knip type findings, nine unstamped rows in
  other active plans, and invalid frontmatter in an unrelated untracked plan. This plan's temporary
  missing implementation-notes frontmatter was corrected before closeout.
