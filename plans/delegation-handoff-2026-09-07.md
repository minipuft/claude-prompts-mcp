---
title: "Delegation handoff — rulings ledger"
date: 2026-09-07
status: active
tags: [chains, delegation, gates, workflow-ir, hooks]
---

# Delegation Handoff — Rulings Ledger

Running state for the `==>` wait/handoff design discussion. Each turn edits this file; the
message reports the delta. An open row's **Default** is what happens if nobody objects.
Format per `plans/contract-layer-2026-09-06.md` D11.

## Starting diagnosis (2026-09-05)

The server never waits: each `prompt_engine` call renders one step and returns; the run sits at
"node N pending" until a resume arrives. The "wait" is the client's tool-call semantics. Three
mechanisms exist with no shared owner: the brief + `user_response` resume (cross-client, verifies
nothing), `hooks/delegation-enforce.py` (Claude Code only, tracks spawn not completion), and
`resolveDelegationSkipped` (post-hoc, gated steps only). The Claude Code handoff block never
renders `run_in_background: false`, and this host now spawns in the background by default.

## Rulings

| ID  | Date       | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 2026-09-07 | **Purpose hierarchy.** Delegation exists for (1) context isolation so the worker's output is not degraded by the parent's accumulated context or priors, and (2) token economy on the parent, which is usually the larger model. It is not a concurrency feature. Written in `docs/concepts/chains-lifecycle.md` §Delegation as one "why" paragraph (authors choose `==>` and need the reason); the enforcement layering (D3) goes in `docs/architecture/overview.md`. Owner was unsure if user-facing; my reading: the why is author-facing, the layering is contributor-facing. |
| D2  | 2026-09-07 | **Guarantee tiers.** A always: a self-contained brief and the offer of isolation. B when configured: the run does not advance past a blocking delegated node without evidence a worker ran. C: the worker's response matches a declared shape (O1), checked by the server at resume.                                                                                                                                                                                                                                                                                              |
| D3  | 2026-09-07 | **Server owns the contract; clients may only tighten.** The brief and the resume check are the floor and hold on every client. Hooks are per-client adapters that fail earlier and friendlier; a client with no hook (opencode-prompts today) still gets B and C. The render-side adapter already exists (`DelegationStrategy`, one per client profile); the hook side is copied per plugin (gemini-prompts carries its own `delegation-enforce.py`).                                                                                                                             |
| D4  | 2026-09-07 | **Two delegation modes, named by what the run does, not by threads.** `blocking`: the run pauses; the worker's result is the node's output and the next node's input. `detached`: the run continues; the result is collected later and reported before the run closes, a run-level obligation rather than a step-level one. Foreground/background was the wrong axis: the worker always runs elsewhere. `==>` today is blocking only.                                                                                                                                             |
| D5  | 2026-09-07 | **Parallelism is a property of detached mode, not a feature.** No fan-out scheduler. Blocking nodes stay linearized; detached nodes are spawned at their position and joined at run end (or an explicit join, O2).                                                                                                                                                                                                                                                                                                                                                                |
| D6  | 2026-09-07 | **Failure posture: hard refuse.** A resume for a blocking delegated node that carries no evidence a worker ran is refused with a message naming the node and what was missing. The R-4 advisory ruling (2026-08-18) was about not suppressing a worker's FAIL proposal; it stands. Refusing an evidence-free resume is a different decision.                                                                                                                                                                                                                                      |
| D7  | 2026-09-07 | **Foreground pin (mechanical).** Claude Code handoff for a blocking node renders `run_in_background: false`. One line in `ClaudeCodeStrategy.formatToolCall`.                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Open decisions

| ID  | Question                                                       | Default                                                                                                                                                                                                                                                                                 | Flips when                                             |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| O1  | Result Contract shape (the standard the owner asked for in Q1) | Free-text work product + a machine-readable trailer the server validates: `node: <node-id>` (the echo token), optional `proposed_gate_review` in the same shape as `gate_verdict.per_gate`, optional `findings[]` reusing contract-layer D5. Body stays prose; trailer is the contract. | Owner wants a fully structured (JSON) worker reply     |
| O2  | Detached mode: node property or run-level gate?                | Node field `await: node \| run` (default `node`). A detached node's result lands as run-level findings; a built-in run-level obligation "every detached node reported" must be satisfied before the run closes. Symbolic syntax deferred; YAML/IR first.                                | A real chain needs a mid-run join                      |
| O3  | What is "evidence a worker ran" (tier B)?                      | The trailer's node token, present and matching the pending node. Hooks add an earlier check (SubagentStop advances spawned → returned) but are not required.                                                                                                                            | Token proves too easy for a parent to fabricate inline |
| O4  | Testing standard                                               | A conformance fake worker in `tests/` that consumes a brief and emits a contract-conforming reply; every delegation test runs the positive control (resume without token is refused) and the accept path. No test spawns a real agent.                                                  | e2e needs a live client                                |

## Evidence (probes run 2026-09-07)

- Gate activation is category | framework | explicit; no run-scope gate exists (`gate-guide-types.ts:26-46`). Gates bind per step via `target_step_id`.
- Workflow IR node fields: `delegated`, `subagentModel`, `agentType`, `retries`, `inlineGateIds`, visibility; run-level `pauseOnBlocking` (`node-schema.ts:295`, reader not traced) is the closest existing "pause the run" shape.
- Result Contract today (`brief.ts:86`): plain text verbatim + optional `Proposed Gate Review` block. No token, no schema.
- Resume stages trim `user_response` (16, 17, 19); no evidence check for delegated nodes.
- 14 test files mention `==>`; the integration ones assert brief fragments by string. None can observe a spawn — the source of the "hard to test" pain.
- Sibling plugins: gemini-prompts has its own `delegation-enforce.py`; opencode-prompts has none; minipuft-plugins none.
- Contract-layer ledger D5 already defines `findings[]` on `per_gate`; O1/O2 reuse it rather than minting a second shape.
