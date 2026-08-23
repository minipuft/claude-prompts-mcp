---
title: "Cross-Client Chain Handoff — Explicit Token Export/Claim (Interview 2A)"
date: 2026-08-21
status: active
tags: [chains, cross-client, handoff, sqlite, mcp-tools]
---

# Cross-Client Chain Handoff (2A)

Follow-on to the cross-client leakage fix (`fix(hooks): scope chain recovery to the
owning conversation…`). That fix made chains conversation-scoped: a session recovers
only the chain it recorded, and nothing crosses clients implicitly. 2A adds the
DELIBERATE path the old accidental behavior was standing in for: continuing a chain
started in one client (Claude Code) from another (Codex/OpenCode), via an explicit
export/claim token instead of automatic shared recovery.

## Problem

A chain run is owned by (conversation session, server process). After the scoping
fix there is no supported way to move that ownership. The old implicit path was the
leakage defect; the replacement must be explicit, single-use, and auditable.

## Measured Ground (2026-08-21)

- `chain_runs.state` (residual document, `run-registry.ts:247-266`) already persists
  `pendingGateReview`, `pendingShellVerification`, `unknownsLedger`, and — when set —
  `blueprint` (`session.blueprint !== undefined` guard at :262). Cross-process resume
  may therefore need NO new serialization, only ownership transfer. **The guard means
  optional**: T0 must measure when blueprint is actually absent.
- `chain_runs` / `chain_run_nodes` are `ephemeral`, per-PID DELETEd at cleanup and
  dropped on schema bumps (`table-contracts.ts`). A handoff that must survive the
  donor's exit needs the row to OUTLIVE the donor PID — that is a posture question,
  not just a column question.
- The "missing blueprint" error from the original incident is what a claim WITHOUT
  transfer looks like: the foreign server sees the row but resumes nothing.
- The id-you-hold rule (CHANGELOG, session-cancel move): a `chain_id` is held because
  you are running the chain → chain-lifecycle verbs live on `prompt_engine`.
- **T0 partial measurement (2026-08-21, live db)**: all 7 runs in the shared
  `server/runtime-state/state.db` carry `blueprint` in their residual document —
  every observed run type serializes it. All 7 are owned by ONE server PID, which
  also shows `chain_id` run numbers are a per-server sequence: two servers sharing a
  db can mint the SAME token (`chain-strategicImplement#1` existed independently in
  two dbs this session). A claim keyed on `chain_id` alone can therefore grab the
  wrong run — the claim verb must resolve through the row's `session_id` (or rowid),
  with `chain_id` as the human handle only.

## Design Decisions (confirmed at T0 exit, 2026-08-21)

| Decision            | Chosen                                                                                                        | Rejected                                 | Why                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Verb home           | `prompt_engine(chain_id, handoff:true)` mints; `prompt_engine(chain_id, claim_token:"…")` claims              | `system_control` session ops             | Id-you-hold rule; handoff is part of running the chain                                                 |
| Token shape         | Single-use opaque token, stored on the run row, expiring with the run                                         | Reusable/bearer file token               | Single-use kills replay; row storage dies with the run                                                 |
| Transfer semantics  | Claim REWRITES `run_owner_pid` + scope to the claimer and invalidates the token                               | Copy the run                             | Two live owners of one run is the leakage bug with extra steps                                         |
| Donor-exit survival | Out of scope v1: claim requires the donor row to still exist (donor server alive or exited uncleanly)         | Durable handoff table                    | Posture change to a durable table is a migration-grade decision; measure demand first                  |
| Hook adoption       | Claiming conversation's PostToolUse tracking records the chain on the first post-claim call — no hook changes | Push rows into the claimer's hooks-state | The scoping fix already keys on the session's own recording; claim + first call satisfies it naturally |

## Open Questions (all four RULED 2026-08-21 — T1 was compiled against these rulings)

- **OQ-1 RULED 2026-08-21** (T0 evidence, implementation notes §T0): blueprint present
  in 7/7 observed runs; absence is possible by construction and `manager.ts:2347`
  already refuses it — the claim verb reuses that refusal, loudly naming the run.
- **OQ-2 RULED 2026-08-21 — minor, not major.** The contract's "adding a union member is
  breaking" clause governs the accepted VALUE shapes of an existing parameter
  (`gate_verdict` string vs object) and response shapes, where a consumer can depend on
  a shape being refused. A new OPTIONAL request parameter cannot reject or reinterpret
  any existing call, so `handoff` and `claim_token` ship as `feat(chains)` without `!`.
  Recorded in the CHANGELOG `Added` section, not `BREAKING`.
- **OQ-3 RULED 2026-08-21 — refuse.** A claim whose scope differs from the row's
  `workspace_id` (both non-null) is refused naming both workspaces. Rewriting scope on
  claim is a separate deliberate feature, not a side effect of handoff.
- **OQ-4 RULED 2026-08-21 — token-only claim.** The token is the row key: 20 random
  bytes, base64url, stored in `chain_runs.handoff_token`, nulled on claim (single-use).
  Mint returns `{token, chain_id, session_id}` for display; claim needs only the token,
  so per-server `chain_id` collisions cannot select the wrong run.

## Delegation Applicability (assessed 2026-08-21)

**Yes — the `==>` delegation operator is the same primitive at node scope.** Measured
today (`engine/execution/delegation/strategy.ts`, `agents/chain-executor.md`,
`hooks/delegation-enforce.py`): the parent receives the step plus a "Handoff via Task
tool" footer, spawns `chain-executor` with the step TEXT, the subagent returns text, and
the parent submits it as `user_response`. The subagent never touches `prompt_engine`
(the agent definition grants no MCP tools); enforcement is a prose block in the parent
plus a hook that denies Edit/Write/Bash until Task fires; `delegation_skipped` (S8) is
INFERRED at capture, never observed.

A node-scoped lease — `handoff` minted for one node, token carried in the footer, the
subagent claims and submits that node's output itself — turns delegation into a
server-observed ownership transfer:

| Gain                                         | Why it follows from 2A                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `delegation_skipped` becomes a measured fact | The server knows which session submitted the node                                                     |
| Portable to Codex 0.146                      | Subagent transcripts are encrypted there; a server-side claim needs no transcript                     |
| Retires the hook deadlock class              | The refusal ("this node is leased") is server-side on the exact node, not a prose block on every tool |

Costs that keep it out of v1: `chain-executor` must gain `prompt_engine` access; a node
lease needs `leased_node_id` beside the token (NOT added pre-emptively — a column with no
writer is the phantom class `validate:no-phantom-columns` exists for); subagent session
rows in hooks-state must not inherit the parent's chain. v1 ships run-scoped handoff with
the token mechanism shaped so node scope is additive (T3 below).

## Tiers

| Row | Status | Where                             | Change                                                                                                                       | Verify                                                                                                                                                                                                                                                                                                                                     |
| --- | ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.1 | ✓      | run-registry, live db             | Measure blueprint presence across run types (multi-step chain, gated single prompt, workflow submission); record when absent | MEASURED 2026-08-21: 7/7 live runs (implementation_plan + strategicImplement, working AND completed) carry `blueprint` in their residual. Absence is possible by construction (`options?.blueprint` at manager.ts:557 is optional) and already guarded at manager.ts:2347 — the claim verb reuses that refusal path (partial OQ-1 answer)  |
| 0.2 | ☐      | —                                 | Rule OQ-1..OQ-3 with the T0 evidence; update Decisions table                                                                 | Plan shows RULED with pointers                                                                                                                                                                                                                                                                                                             |
| 1.1 | ✓      | `chains/run-registry.ts`, schema  | `handoff_token` (nullable TEXT) on `chain_runs`; mint/invalidate in registry; schema bump                                    | MEASURED 2026-08-21: schema v25; `validate:table-contracts` OK (10 tables, 2 views), `validate:no-phantom-columns` OK (column named in the INSERT list); `save()` now returns claimed-elsewhere ids (DEV-T1-1)                                                                                                                             |
| 1.2 | ✓      | `prompt_engine` schema + contract | `handoff:true` mints and returns token; `claim_token` claims; refusals for wrong/spent/missing token name the reason         | MEASURED 2026-08-21: `validate:contracts` + conformance coverage green (82 params; exception declared, closedBy = row 2.2); schema snapshot refreshed. Authored row omitted the ROUTER allowlist in `mcp/tools/index.ts` — both verbs were dead on the wire until `server/scripts/verify-handoff.mjs` showed it (DEV-T1-6). Live drive 6/6 |
| 1.3 | ✓      | `chains/manager.ts`               | Claim rewrites `run_owner_pid` + scope, rebuilds `chain_sessions` projection in the same transaction                         | MEASURED 2026-08-21: `handoff-claim.test.ts` (8 tests: persist/transfer/burn/evict/spent/workspace-refusal/mint/no-blueprint) + two-SERVER live drive `server/scripts/verify-handoff.mjs` — A mints, B claims and receives the current step in the same call. Cross-process JEST coverage remains row 2.2                                  |
| 2.1 | ✓      | hooks + downstream docs           | Document the handoff flow (docs/reference/mcp-tools.md, docs/concepts/chains-lifecycle.md); extension-alignment note         | DONE 2026-08-21: docs/reference/mcp-tools.md verbs table, docs/concepts/chains-lifecycle.md §Handing a Run to Another Client, CHANGELOG Added. The extension-alignment note is NOT written — `.claude/rules/extension-alignment.md` is carried uncommitted by a concurrent session; re-open as a row when that lands                       |
| 2.2 | ☐      | tests                             | Cross-process integration test: two spawned servers, one shared db, mint→claim→resume; foreign claim without token refused   | Test red against pre-1.3 code, green after                                                                                                                                                                                                                                                                                                 |

## Execution Dispatch

All rows main-thread (schema + contract work is never-delegate per project rules).
One tier per submission; T0 is measurement-only and gates T1.
