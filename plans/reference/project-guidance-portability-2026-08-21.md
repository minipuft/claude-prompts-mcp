---
title: "Portable Project Guidance Projection"
date: 2026-08-21
status: reference
tags: [agent-guidance, codex, opencode, claude-code]
---

# Portable Project Guidance Projection

## Diagnosis

The first generated `AGENTS.md` copied the full Claude handbook and every scoped rule. That kept
authorship canonical but not behavior portable: Codex reads only the first 32 KiB by default, so
later rules disappear, while Codex and OpenCode do not implement Claude Code's per-target `paths`
activation semantics.

## Decisions

1. `CLAUDE.md` and `.claude/rules/*.md` remain the only authored project guidance.
2. The downstream file is a semantic projection: selected decision-bearing handbook sections plus
   conditional rule dispatch entries, never a concatenation of scoped rule bodies.
3. The projection must fit Codex's documented default 32 KiB limit and fail generation when it
   exceeds that budget.
4. Every project rule uses Claude Code's supported `paths:` frontmatter and stays concise enough to
   load conditionally without becoming a procedural reference manual.
5. Deep maintenance procedures live in project docs; rules point to those docs.

## Work

- [x] Repair rule frontmatter, paths, and stale claims.
- [x] Move deep MCP-contract and SQLite procedures into focused docs.
- [x] Replace full concatenation with deterministic handbook extraction and rule dispatch.
- [x] Add structural and byte-budget self-tests.
- [x] Update client propagation documentation and regenerate `AGENTS.md`.
- [x] Validate Claude Code rule metadata, Codex default-budget loading, OpenCode discovery, hooks,
      and repository gates.

## Removal condition

The full-concatenation projection is removed once the compact renderer contains every selected
handbook section and every canonical rule dispatch, remains below 32 KiB, and all three client
validation probes observe the intended guidance.

## Closeout

The replacement condition passed. The repository projection is 21,174 bytes and dispatches all
three scoped rules. The global Claude-owned projection was converted to the same shape at 19,351
bytes and is shared by Codex and OpenCode. Both downstream client probes observed the global and
project dispatch entries under their normal instruction loaders.
