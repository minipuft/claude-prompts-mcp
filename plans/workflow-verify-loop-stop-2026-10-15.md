---
title: Workflow verification loops are enforced at Stop
date: 2026-10-15
type: implementation-plan
status: active
initiative_branch: fix/workflow-verify-loop-stop
worker_cap: 2
branch_mode: shared-tree
publish: "push+merge (2026-10-15, owner: fix both issues and merge per the global code and deployment standard)"
tracking: none
tracking_reason: local-only
tags: [hooks, gates, verification]
---

# Workflow verification loops are enforced at Stop

## Now (2026-10-15)

Goal: a workflow's shell-verification loop (`:: verify:"…"` inside a chain) is held by the Stop hook for every run this conversation drives, not only a run it paused.
Slice: worktree `claude-prompts-mcp-verify-stop`, branch `fix/workflow-verify-loop-stop` from main a6a6e636. Companion: gemini-prompts `fix/tracker-host-session` (row G1), its own PR in that repository.
Next: V1 (record run identity on every tracked chain step) → V2 (native Stop probe) → PR.
Constraint: no structuredContent on ordinary step replies (R-V1); fail closed on an ambiguous identity; release 6.0.0 is cut only on the owner's word.

## Why

The Stop hook (ralph-stop) finds a workflow's verification row by the run's exact key `workflow-run-<runUUID>` and scope (#495). It learns the run's identity only from `run_identity` in hook state, which only a pause, resume or claim packet writes, and the next ordinary step's state replaces it. So a workflow verify loop is enforced at Stop only while this conversation holds a pause — and before #495 it was never enforced natively at all (the hook read rows by the client session id, which never matched a server key).

## Rulings

- **R-V1:** the identity comes from the `chain_sessions` projection the hooks already read (`db_reader`), recorded on every tracked chain step. Ordinary step replies gain no structuredContent: Claude Code 2.1.299 shows the model a JSON string of structuredContent instead of the reply text whenever it is present (measured 2026-10-15), so adding it would change every step's model-visible format. When two scopes hold the same chain id, no identity is recorded (fail closed).
- **R-V2:** gemini-prompts changes one call only — `load_verify_active_state` receives the host session id. Its other hooks, and the uncommitted work in its main checkout, are out of scope.

## Task rows

| ID  | Status                                                                                                                                                | Files                                                                                                                 | Change                                                                                                                                                                                                | Bound / tier / failure shape                                                                                                 | Depends | Own check                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | ☐ (as of 2026-10-15 · flips when an ordinary chain step records the exact run identity and ralph-stop enforces that run's verification row at Stop)   | hooks/post-prompt-engine.py; hooks/lib/session_state.py and/or hooks/lib/db_reader.py; hooks/tests (named in handoff) | Record `run_identity` from the projection on every tracked chain step (exact match, fail closed on ambiguity), keep it across ordinary steps of the same run, drop it when the tracked chain changes. | ≤4 files / 220 lines; upper/high; wrong approach: an identity borrowed from another scope, or a guard that keeps a stale run | —       | Unpaused workflow verify row blocks Stop; two scopes same chain id → no identity; plants: drop the record → Stop allows; record without scope match → foreign row enforced |
| V2  | ☐ (as of 2026-10-15 · flips when a headless Claude Code run with a workflow verify loop is held at Stop by the branch hooks, with a positive control) | probe only under ~/.cache                                                                                             | Native proof: drive a chain carrying `:: verify:"false"` through `claude -p` with the branch hooks registered; observe Stop blocking and the reason.                                                  | probe; upper/high; wrong premise: fixture-only proof of a host event                                                         | V1      | Stop blocked natively with the verification reason; control: same run without the verify loop is not blocked                                                               |
| G1  | ☐ (as of 2026-10-15 · flips when gemini-prompts' tracker passes the host session id and its PR merges green)                                          | gemini-prompts: hooks/ralph-context-tracker.py (+ its test if the repo has one)                                       | Pass `session_id`/`sessionId` from the hook input to `load_verify_active_state`; no session id → no tracking.                                                                                         | 1–2 files / 30 lines; bounded/medium; wrong output: a tracker that reads another session's row                               | —       | Works against the old and new lib signature; repo CI green                                                                                                                 |
