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

## 2026-10-15 — V2 first native run: a defect no fixture saw

Headless `claude -p` (2.1.299, Haiku, `--restricted` so only the branch hooks ran), branch server, `>>quick_decision … :: verify:"false" loop:true max:3`, never paused. The post hook recorded `run_identity` {organization_id: null, workspace_id: "cwd", continuity_scope_id: "cwd"}; the server filed `workflow-run-<uuid>` with scope {organizationId: "cwd", …}. ralph-stop found the row by key and refused it ("its scope is not the run's scope"), so `false` never ran at Stop; the session was held by the attribution fallback, whose reason (only the internal key) led the model to give up. Control run (no verify): no verify-state.db; held by the chain's gate-review reason. V1's fixture tests passed because they built both sides with matching scopes.

- **R-V3 (ruled):** fix at the writer — stage 17 recorded the request scope (organizationId falls back to the workspace id, request-identity-resolver ~732) while run-registry stores `scope?.organizationId ?? null`; one run has one scope, so the verify row records the run's stored scope. The hook's strict comparison stays.
- **Lesson:** the live probe is the check that matters for a cross-process join; the fixtures encoded the planner's assumption that both writers agree.

## 2026-10-15 — V3 accepted

Root cause: the run's stored scope already had one owner, `ChainSessionStore.getConversationControlScope` (pause, resume, inspect, the conversation-control packet); stage 17's verify row was the one run-identity writer that bypassed it with the request scope, whose organization falls back to the workspace while stores built with `defaultScope: {workspaceId}` persist none. `workflowIdentity(context, chainSessionService)` now uses it at render arm, loop re-run and rearm; release uses `workflowRunKey` (key only). `ChainSessionService` declares the method (the 5th file). Finding (no row): a claimed run's `chain_runs` keeps the original org/workspace via COALESCE while the projection writes the claimant store's namespace; the row matches the projection, which is what the hook reads.
