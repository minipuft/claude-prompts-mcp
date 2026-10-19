---
title: A prompt update that sends one script tool keeps the prompt's other tools and authored text
date: 2026-10-19
type: implementation-plan
status: active
worker_cap: 2
planner_session: tools-update
initiative_branch: fix/prompt-tools-update
branch_mode: per-row worktree branches merged by the planner
publish: "push+merge (2026-10-19, owner in chat: 'Continue with both', accepting the diagnosis as its own PR)"
tracking: none
tracking_reason: local-only
tags: [mcp-tools, prompts]
---

# A prompt update that sends one script tool keeps the prompt's other tools and authored text

## Now (2026-10-19)

Goal: find out why `resource_manager(resource_type:"prompt", action:"update", tools:[word_count])` on `reference_demo` removed `text_digest` from `prompt.yaml` and dropped its authored comments, and decide which half is intended.
Slice: one PR on `fix/prompt-tools-update`.
Next decision: after row 1, which fork applies to the tools list (replace is intended and undocumented → document it; merge is intended → fix) and to the comment loss.
Constraint: the `tools` parameter description says nothing about update semantics today, so the contract does not decide this by itself.

## Rows

| Row | Task                                                                                                                                                                                                                                                                                                                                                                                                              | Files     | Depends | Tier                                                                         | Verification                                                                                                                            | Status                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Diagnose: reproduce on `main` against `dist/` with hermetic roots; trace how a prompt `update` turns `tools` into `prompt.yaml` `tools:` and `tools/<id>/` files; trace why comments and line wrapping in `prompt.yaml` changed; enumerate sibling list-valued update parameters with the same semantics; return a named diagnosis per symptom with its fork (surplus · superseded · live-and-wrong) and evidence | read-only | —       | opus · xhigh · cause unknown; must derive from code the brief does not quote | before/after `prompt.yaml` and `tools/` listing from the live drive; a positive control that a no-`tools` update leaves `tools:` intact | ☐ (as of 2026-10-19 · flips when the planner accepts the diagnosis handoff) |
