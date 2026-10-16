---
title: Workflow verification loops are enforced at Stop — implementation notes
date: 2026-10-15
status: active
tags: [hooks, gates, verification]
---

# Implementation notes

## 2026-10-15 — opened

Owner ruled on 2026-10-15 to fix both open questions from the conversation-pause close-out and merge per the global standard. gemini-prompts' main checkout carries uncommitted changes in four hook files from another actor; G1 works in a separate worktree (`gemini-prompts-tracker`) off origin/main and never touches that checkout. gemini-prompts reaches `hooks/lib` through a symlink into the installed `claude-prompts` package, so the new library reaches it only when its dependency is bumped; the old `load_verify_active_state(session_id)` already filtered by session id, so G1 is correct against both.

## 2026-10-15 — G1 merged (gemini-prompts#48)

Worktree-only `npm ci --ignore-scripts` (claude-prompts 4.0.1 installed; package.json pins `^4.0.0`, so 6.0.0 reaches gemini-prompts only through a dependency bump). The repo's CI checks structure only (required files, the hooks/lib symlink) — no Python check would have caught the tracker going silent. The main checkout's uncommitted hook edits by another actor were never touched. Finding (no row): gemini's tracker, like upstream's, looks up only the host-keyed row, so server-filed `workflow-run-<uuid>` rows are invisible to it — same behavior as upstream.

## 2026-10-15 — V1 accepted

`resolve_run_identity(chain_id)` shares `_owner_alive` with `_select_row` and visibility with `_session_to_hook_state`; a candidate with an incomplete identity can make the answer ambiguous but never supply one. `_step_identity` keeps an exact tracked identity for the same chain (so a pause packet's identity survives later ordinary steps) and resolves otherwise.

- **Accepted deviation:** keep-over-re-resolve, pinned by a test.
- **Findings (no rows):** with two live scopes on one chain id, ralph-stop takes its no-identity path and blocks with the chain-continue reason, not the T3.5 attribution diagnostic — fails closed, no command, no borrow; if the server dies after the identity was recorded, the unpaused run is not live and its workflow row is not enforced (db_reader keeps a dead owner's row only when paused).
