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

## Design Decisions (proposed — confirm at T0 exit)

| Decision            | Chosen                                                                                                        | Rejected                                 | Why                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Verb home           | `prompt_engine(chain_id, handoff:true)` mints; `prompt_engine(chain_id, claim_token:"…")` claims              | `system_control` session ops             | Id-you-hold rule; handoff is part of running the chain                                                 |
| Token shape         | Single-use opaque token, stored on the run row, expiring with the run                                         | Reusable/bearer file token               | Single-use kills replay; row storage dies with the run                                                 |
| Transfer semantics  | Claim REWRITES `run_owner_pid` + scope to the claimer and invalidates the token                               | Copy the run                             | Two live owners of one run is the leakage bug with extra steps                                         |
| Donor-exit survival | Out of scope v1: claim requires the donor row to still exist (donor server alive or exited uncleanly)         | Durable handoff table                    | Posture change to a durable table is a migration-grade decision; measure demand first                  |
| Hook adoption       | Claiming conversation's PostToolUse tracking records the chain on the first post-claim call — no hook changes | Push rows into the claimer's hooks-state | The scoping fix already keys on the session's own recording; claim + first call satisfies it naturally |

## Open Questions (rule before compiling T1)

- **OQ-1 RULED 2026-08-21** (T0 evidence, implementation notes §T0): blueprint present
  in 7/7 observed runs; absence is possible by construction and `manager.ts:2347`
  already refuses it — the claim verb reuses that refusal, loudly naming the run.
- **OQ-2**: Semver treatment — two new optional `prompt_engine` parameters extend the
  reachable-shape union. Per the Public API Contract, adding a union member is
  breaking. Is this priced as a major, or advertised conditionally like the gate
  params (present only when the feature is enabled)?
- **OQ-3**: Cross-workspace claims — the run row carries `workspace_id`; is a claim
  from a different workspace refused, or does the row's scope rewrite too?
- **OQ-4**: Claim identity — given per-server `chain_id` collisions (Measured
  Ground), does the mint return `{token, session_id}` and the claim require both,
  or does the single-use token alone suffice as the unambiguous row key?

## Tiers

| Row | Status | Where                             | Change                                                                                                                       | Verify                                                                                                                                                                                                                                                                                                                                    |
| --- | ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ✓      | run-registry, live db             | Measure blueprint presence across run types (multi-step chain, gated single prompt, workflow submission); record when absent | MEASURED 2026-08-21: 7/7 live runs (implementation_plan + strategicImplement, working AND completed) carry `blueprint` in their residual. Absence is possible by construction (`options?.blueprint` at manager.ts:557 is optional) and already guarded at manager.ts:2347 — the claim verb reuses that refusal path (partial OQ-1 answer) |
| 0.2 | ☐      | —                                 | Rule OQ-1..OQ-3 with the T0 evidence; update Decisions table                                                                 | Plan shows RULED with pointers                                                                                                                                                                                                                                                                                                            |
| 1.1 | ☐      | `chains/run-registry.ts`, schema  | `handoff_token` (nullable TEXT) on `chain_runs`; mint/invalidate in registry; schema bump                                    | `validate:table-contracts` + `validate:no-phantom-columns` green                                                                                                                                                                                                                                                                          |
| 1.2 | ☐      | `prompt_engine` schema + contract | `handoff:true` mints and returns token; `claim_token` claims; refusals for wrong/spent/missing token name the reason         | Contract layers agree (schema/contract/router/manager); `verify:mcp` + one live mint/claim                                                                                                                                                                                                                                                |
| 1.3 | ☐      | `chains/manager.ts`               | Claim rewrites `run_owner_pid` + scope, rebuilds `chain_sessions` projection in the same transaction                         | Integration test: mint in process A, claim in process B, resume executes                                                                                                                                                                                                                                                                  |
| 2.1 | ☐      | hooks + downstream docs           | Document the handoff flow (docs/reference/mcp-tools.md, docs/concepts/chains-lifecycle.md); extension-alignment note         | Docs lockstep check                                                                                                                                                                                                                                                                                                                       |
| 2.2 | ☐      | tests                             | Cross-process integration test: two spawned servers, one shared db, mint→claim→resume; foreign claim without token refused   | Test red against pre-1.3 code, green after                                                                                                                                                                                                                                                                                                |

## Execution Dispatch

All rows main-thread (schema + contract work is never-delegate per project rules).
One tier per submission; T0 is measurement-only and gates T1.
