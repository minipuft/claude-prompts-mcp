---
title: A chain prompt's own gates run once, on the chain's final step
type: implementation
status: active
date: 2026-10-05
tags: [gates, chains]
initiative_branch: fix/chain-prompt-gates-final-step
branch_mode: shared-tree
worker_cap: 1
publish: "push+merge (2026-10-05, owner in chat: the recommended approach is the right implementation, continue with it)"
tracking: none
tracking_reason: one-slice fix
---

# A chain prompt's own gates run once, on the chain's final step

## Now

_Written 2026-10-05._ **Goal:** the gates a chain prompt declares for itself are reviewed once,
against the chain's finished output. **Current slice:** the only one; rows 1.1 and 1.2 are with one
worker. **Next decision:** none open. **Constraint in force:** CI owns the full test suite; the
worker runs only its rows' own checks.

## Scope

A chain prompt (the prompt that owns `chainSteps`) can declare gates for itself in its
`gateConfiguration`. Measured on 2026-10-05 over Streamable HTTP and STDIO: those gates reach no
step. The bundled `implementation_plan` declares `code-quality` and `plan-quality`, and neither is
rendered or reviewed on any of its five steps. The chain's plan records them and the step walk
never reads them.

**Objective:** a chain prompt's own gates are rendered and reviewed on the chain's final step, and
on no other step.

**Not in scope:** gates written on a step or supplied by a step's own prompt (they stay on that
step, #442 and #444); request-level gates and framework gates (they still reach every step);
inline gate definitions executed under `executeInlineGateDefinitions`; ad hoc arrow chains, which
have no chain prompt.

## Rulings

| ID  | Date       | Ruling                                                                                                                                                                                                                                                                                                                     |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 2026-10-05 | **OWNER**, in chat, choosing between "once, on the final step" and "on every step": the final step. A gate on a chain prompt grades the chain's finished output; no intermediate step is graded against a gate it did not ask for.                                                                                         |
| R2  | 2026-10-05 | Planner: "the chain prompt's own gates" are the ids its `gateConfiguration.include` lists and the gates its category activates for it, less its `exclude`; its `framework_gates` switch keeps today's meaning.                                                                                                             |
| R3  | 2026-10-05 | Planner: "the final step" is the last node of the run's node order at the time that node is rendered and reviewed, resolved by node id, never by position. If a `remainder` replaces or extends the tail, the gates follow to the new last node. An inserted investigation node is never the final step unless it is last. |
| R4  | 2026-10-05 | Planner: a step whose prompt is itself a chain follows the same rule for its own expansion (its gates land on the last node it expands to) if the existing expansion makes that a small change; otherwise the nested case is reported and left as measured.                                                                |
| R5  | 2026-10-05 | Planner: the final step's review holds the union of its own gates and the chain prompt's gates in one review, as a step with several gates does today. No new review kind.                                                                                                                                                 |

## Tasks

| ID  | Status                                                                                                                                                                                                           | Files                                                                                                                 | Change                                                                                                                                                             | Bound                       | Depends | Verification                                                                                                                                                                             | Tier                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | ☐ (as of 2026-10-05 · flips when a chain prompt's own gate is rendered and reviewed on the run's last node and on no other, over both transports)                                                                | `server/src/engine/gates/services/gate-enhancement-service.ts`; `server/tests/e2e/gates-only-review-join.e2e.test.ts` | bind the chain prompt's own gates to the last node of the run in the chain walk's step bindings, so `filterGatesForTarget` passes them there only                  | ≤ 3 source files, ~60 lines | —       | driven twin over both transports, one value per run; red before, green after; a mutation that drops the binding turns it red; `validate:step-lookup-by-node` green with no new exception | opus · high · wrong approach (where the chain plan's gates are lost before the walk, and which node is last after a remainder) |
| 1.2 | ☐ (as of 2026-10-05 · flips when `>>implementation_plan` driven over a transport shows `code-quality` and `plan-quality` reviewed on its last step only, and the changelog and the chains lifecycle page say so) | `CHANGELOG.md`; `docs/concepts/chains-lifecycle.md`; existing tests that pinned the old absence                       | drive the bundled chain before and after; rewrite pins that asserted no chain-level gate; changelog entry under Changed; the reach paragraph in the lifecycle page | ≤ 4 files                   | 1.1     | the before and after run values; each rewritten pin named with its reason                                                                                                                | same worker                                                                                                                    |

## Dispatch

| Rows    | Tier | Effort                                                              | Failure shape  | Branch mode                                                                   |
| ------- | ---- | ------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| 1.1+1.2 | opus | high (the `worker-high` agent definition, model overridden to opus) | wrong approach | shared-tree (`fix/chain-prompt-gates-final-step`), one worker commits per row |
