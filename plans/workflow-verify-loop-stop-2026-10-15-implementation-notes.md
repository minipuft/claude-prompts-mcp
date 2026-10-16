---
title: Workflow verification loops are enforced at Stop — implementation notes
date: 2026-10-15
status: active
tags: [hooks, gates, verification]
---

# Implementation notes

## 2026-10-15 — opened

Owner ruled on 2026-10-15 to fix both open questions from the conversation-pause close-out and merge per the global standard. gemini-prompts' main checkout carries uncommitted changes in four hook files from another actor; G1 works in a separate worktree (`gemini-prompts-tracker`) off origin/main and never touches that checkout. gemini-prompts reaches `hooks/lib` through a symlink into the installed `claude-prompts` package, so the new library reaches it only when its dependency is bumped; the old `load_verify_active_state(session_id)` already filtered by session id, so G1 is correct against both.
