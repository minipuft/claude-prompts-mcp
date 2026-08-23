---
title: "Portable Project Guidance Projection — Implementation Notes"
plan: project-guidance-portability-2026-08-21.md
date: 2026-08-21
status: reference
tags: [agent-guidance, implementation-notes]
---

# Portable Project Guidance Projection — Implementation Notes

## Deviations

- The same truncation/semantic mismatch existed in the user-global projection: it concatenated
  63,913 bytes for Codex and configured OpenCode to load every global rule body unconditionally.
  The fix was extended to `~/.claude`, producing one 19,351-byte shared projection plus a JSON
  ownership manifest. This preserved the declared Claude SSOT rather than leaving the project fix
  as a local exception.
- A live Claude Code model probe could not run because the account had reached its weekly limit.
  Claude's side was validated structurally instead: every scoped rule now uses documented
  `paths:` metadata, no `globs:` key remains, and the generator rejects legacy metadata.
- Full validation exposed a stale substrate declaration for the newly changed guidance check. The
  declaration was updated to its re-derived working-tree inputs and the membership gate then
  passed.

## Validation

- Project renderer self-test: 11/11 passed; working-tree and isolated-index renders were
  byte-identical.
- Project `AGENTS.md`: 21,174/32,768 bytes; drift check and suite integration passed.
- Global renderer tests: 3/3; skill sync tests: 7/7; post-commit routing tests: 3/3.
- Global projection: 19,351/32,768 bytes; ownership manifest is valid JSON; global rule lint passed
  all 15 checked files with only existing soft-size warnings.
- Codex 0.148 probe with `project_doc_max_bytes=32768`: observed both compact projections and every
  requested dispatch marker without reading files.
- OpenCode 1.18.21 probe: observed both compact projections and requested dispatch markers; resolved
  config points at the shared generated global instructions.
- Repository typecheck, lint ratchet, formatting, contract validation, guidance validation,
  architecture validation, and 2,719 unit tests passed.
- `validate:all` initially passed 40/45. The task-owned suite-membership failure was fixed and
  passed on rerun. Four unrelated existing failures remain: one test type-ratchet error, two knip
  type findings, unstamped rows in other active plans, and invalid frontmatter in an unrelated
  untracked plan.
