---
title: Resumable conversation pause and matching hook behavior
date: 2026-10-12
type: implementation-plan
status: active
initiative_branch: feat/workflow-client-evaluation
worker_cap: 2
planner_session: workflow-client-evaluation-plan
branch_mode: shared-tree
tracking: none
tracking_reason: local-only
tags: [hooks, workflows, contracts, execution]
---

# Resumable conversation pause and matching hook behavior

## Now (2026-10-12)

Goal: park workflow execution so the model can discuss the task with the user and resume the same step.
Slice: owner requested pause/resume plus appropriate enforcement/reminders; all eight child rows OPEN.
Next: freeze the existing-owner persistence/action projection and scope joins, then implement after abort/removal closure.
Constraint: no advancement, review bypass, terminal status, worker-kill claim or automatic resume from conversation.
Boundary: source/hook controls first; installed-client Stop/event behavior requires separate native proof.

## Intent and references

**Work type:** feature with contract and hook integration.
**Confidence:** high in the desired behavior and source gaps; native client enforcement is unmeasured.
**Scope:** existing run store/types/serialization, prompt_engine actions and projections, shared hook state/admission/reminders/Stop, owning tests and docs.
**Problem:** abort is terminal; waiting between MCP calls does not establish a durable conversational pause respected by hooks. The model needs to yield to the user while the same workflow and step remain recoverable.

Owner request 2026-10-12: update the plan alongside hooks so enforcement/reminders appear appropriately. The [parent plan](workflow-client-evaluation-2026-10-09.md) owns custody, validation cadence, native budget and publication limits. The [abort/removal subplan](workflow-run-abort-removal-2026-10-12.md) remains required: abort ends the run; cancel is removed completely. This separate child plan keeps the newly requested resumable capability bounded without inflating parent rows or introducing another workflow authority.

Source references: ChainSessionStore owns durable run mutation; run-registry.ts explicitly serializes and reconstructs residual session state; collectActiveSessionRows writes the hook projection. resolveUnknownInterrupt handles only the synthetic blocking-unknown review; it is not a generic pause. ralph-stop.py currently blocks when a recoverable chain exists, and shared reminders urge continuation/review. These are source observations, not installed-client proof.

## Interaction contract

| Action/state                                                                  | Required behavior                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt_engine(chain_id:"...", gate_action:"pause")`                          | Persist a conversation pause on the scoped nonterminal run; acknowledge the retained step and tell the model to discuss/clarify with the user. Do not issue new work or capture conversational text. |
| Conversation while paused                                                     | Keep the workflow recoverable; permit the client turn to end. No automatic progression, repeated continuation enforcement, gate verdict demand or invented completion.                               |
| `prompt_engine(chain_id:"...", gate_action:"resume")` on a conversation pause | Clear only that pause and return the unchanged current-step/review action. Do not capture, grade or advance in the resume call; follow the returned action in a separate call.                       |
| Existing blocking-unknown `resume`                                            | Preserve its current meaning when no conversation pause is present. If both holds exist, the first resume clears the conversation pause only and exposes the still-pending unknown hold.             |
| `gate_action:"abort"` while paused                                            | End the run through the same scoped durable terminal owner; never treat pause as a barrier to termination.                                                                                           |
| Bare resume, report, capture or other workflow mutation while paused          | Refuse before mutation and instruct explicit conversation resume or abort. Do not silently consume content, clear a review or reset attempts. Inspection remains available.                          |

Pause is independent of retry exhaustion, ordinary/detached review kind and a blocking-unknown hold. It requires an existing scoped nonterminal run, but no node trailer. A run held after its last issued node by an owed detached report may also pause; retain that hold and its node identities. Completed/failed/cancelled/missing/out-of-scope runs refuse pause/resume truthfully without mutation.

The server owns a small durable conversation-pause record on the existing session, provisionally `conversationPause: {kind:"conversation", nodeId:string|null, pausedAt:number}`. It is orthogonal to run terminal status and review phase. Row0.1 freezes the exact field/projection and existing serializer paths before edits; no parallel hook-only pause flag, synthetic gate, inserted investigation node, new workflow manager or DDL migration is presumed. Old sessions without a pause record remain readable.

Preserve session UUID, chain identifier, currentNodeId/ordinal, node milestones, captured response/target bindings, every pending review, gate counters/attempt identities, shell-verification holds and owed detached report tokens. Pause/resume themselves change none of those facts. Repeated pause is idempotent and retains the original pause record. A late detached result remains owed until explicitly resumed and submitted; stopping or queuing an external worker is outside this capability. Discussion that changes the target still requires the existing recapture/new-attempt rules afterward.

Control calls must not combine pause/resume with user_response, gate_verdict, remainder, unknown observations, new-work commands or handoff/claim. Refuse ambiguous combinations through the existing validation owner before mutation rather than ignoring meaningful input. After terminal abort, ordinary terminal guards win; no pause record can make a cancelled run resumable. No timer, reconnect, compact recovery or model prose implicitly resumes a conversation pause.

## Consequence trace and hook policy

| Owner/writer                                           | Readers and decisions                                                                | Projection/required change                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Existing session store pause/resume mutation           | Executor action routing, advancement/capture/report admission, terminal/claim guards | Durable scoped state; explicit control before work; enumerate all mutating paths and direct public entry points |
| run-registry residual serializer/hydrator              | Store cold load and subsequent requests                                              | Preserve the pause across restart; absence means legacy unpaused session, not completed                         |
| collectActiveSessionRows and response formatting owner | Both db_reader routes, response tracker, inspect and shared hook state               | Publish the same pause/step facts through existing response/state projections; keep the paused run visible      |
| session_state shared projection                        | gate-enforce, prompt-suggest, compact-recovery, post-tool reminder, ralph-stop       | One state-aware policy; no per-hook independent lifecycle or action table                                       |
| Actual host adapter                                    | Tool result/error and Stop events                                                    | Normalize identifiers/fields only; source probes do not prove the client delivered these events                 |

Hook behavior must change in the same coherent pause slice:

- Admission allows pause, explicit resume and abort in the applicable state; the server still decides acceptance. While paused, invalid workflow mutations receive the correct paused-state instruction rather than generic PASS/FAIL guidance. Conversation and unrelated user-directed tools are not denied merely because a workflow is paused; ordinary host capability policy still applies.
- PostToolUse preserves paused state and the active-step identity. Only successful authoritative resume/terminal evidence changes tracking. Refusal/error/missing markers never imply resume or completion.
- Suggestions/recovery/post-tool reminders say “Workflow paused at step N. Discuss with the user; resume explicitly when ready.” They keep the identity and available control actions, suppress mandatory continue/fix/verdict CTAs, and avoid repeated injections on every unrelated tool result. On resume, reinstate the prior phase-specific instruction.
- Stop permits the model to finish its response while this workflow is conversation-paused. Keep the recoverable chain record; do not clear it to permit Stop. Scope the exception to the exact paused run/client/workspace. Independently active verification, other runs and host safety/capability enforcement retain their own policy; trace verify-active ownership before any exemption.
- Compaction/restart restore the pause and concise reminder without automatically resuming. A paused chain must not disappear from state refresh merely because it is not executable.

## Implementation table

Entry: parent abort/removal closure accepted. Row0.1 freezes exact manifests, scope joins and all mutation entry points; recut before widening caps. Same parent worker cap/tier guidance applies; planner alone owns HEAD. These are one coherent source/hook capability, not separately supported intermediate states.

| ID  | Status                                                                                   | Files / responsibility                                                                                                            | Change                                                                                                                           | Cap                                                                                               | Depends  | Own check / falsifier                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ☐ (as of 2026-10-12 · flips when pause contract and complete edge manifest are accepted) | Retained contract/inventory; exact existing owner/consumer manifests                                                              | Freeze state field, serializer/projection, control validation, mutation guards, host/verify scope and all named consumers        | 1 receipt, 180 lines                                                                              | —        | Every write/read/decision/view and public mutation path assigned; no generic blocking-unknown reuse or unowned pause flag                                |
| 0.2 | ☐ (as of 2026-10-12 · flips when durable pause/resume controls pass)                     | shared/types/chain-session.ts; modules/chains/manager.ts; modules/chains/run-registry.ts; paired store integration test           | Add orthogonal run pause and scoped idempotent mutation through existing store/residual persistence                              | 4 files, 280 changed lines                                                                        | 0.1      | Cold load retains same node/reviews/captures/counters; old session reads; cross-scope/terminal refusal; dropping residual field fails                    |
| 0.3 | ☐ (as of 2026-10-12 · flips when control validation and no-mutation guards pass)         | prompt-executor.ts; prompt-engine.schema.ts; prompt-engine.json; owning control test; generated contract/vocabulary manifest      | Add pause action; route conversation resume separately from unknown resume; guard every traced mutation path before side effects | <=4 hand-written files, 280 lines plus generated manifest; recut if guard inventory requires more | 0.2      | Pause accepted across holds; ambiguous calls and paused capture/report/advance refused unchanged; resume restores pending action without capture/advance |
| 0.4 | ☐ (as of 2026-10-12 · flips when response/DB pause projections agree)                    | Existing response formatting stage/assembler; manager hook serializer; view/query only if required; paired projection test        | Publish pause and retained-step facts via existing response/inspect/hook projections; paused run remains visible                 | <=5 files, 240 changed lines; exact set frozen in 0.1                                             | 0.3      | Real output and both persisted refresh routes agree; missing packet does not clear tracking; omitted producer field fails                                |
| 0.5 | ☐ (as of 2026-10-12 · flips when shared hook state/admission/tracking controls pass)     | session_state.py; db_reader.py; gate-enforce.py; post-prompt-engine.py; paired reader/admission/tracker tests                     | Round-trip pause; admit correct control calls; preserve recoverability on refusal/error; prevent hook-only fake resolution       | <=7 files, 300 changed lines; explicit cross-consumer migration                                   | 0.4      | Actual hooks consume seeded projections; paused controls/state preservation; resume restores original review; no generic user_response escape            |
| 0.6 | ☐ (as of 2026-10-12 · flips when all reminder/recovery outputs pass)                     | prompt-suggest.py; compact-recovery.py; shared reminder owner; paired tracker/recovery tests                                      | Concise pause reminder without compulsory continuation/verdict; preserve identity and explicit resume/abort through compaction   | <=5 files, 180 changed lines                                                                      | 0.5      | Real directive output in paused/resumed states; unrelated tools do not cause reminder storm; restoring continue CTA fails                                |
| 0.7 | ☐ (as of 2026-10-12 · flips when Stop and verify ownership controls pass)                | ralph-stop.py; tests/test_ralph_stop.py; verify-active scope consumer if required                                                 | Permit turn completion for exact conversation-paused workflow; retain chain and independent verification policy                  | <=3 files, 200 changed lines; recut if actual scope join differs                                  | 0.5, 0.6 | Stop allowed while paused; unchanged chain persists; resumed active run enforced; unrelated verification/run still enforced                              |
| 0.8 | ☐ (as of 2026-10-12 · flips when transport/conformance/docs source closure passes)       | Existing real-server conformance scenario/driver; hooks/README.md; docs/concepts/chains-lifecycle.md; docs/reference/mcp-tools.md | Pause/conversation/resume same run; document control/hold semantics; seal source receipts and native unknowns                    | <=4 files, 260 changed lines                                                                      | 0.7      | STDIO/HTTP and restart preserve exact step; no terminal event on pause; pending review still required after resume; abort remains terminal               |

## Completion and demonstration

The demonstration uses the same run: issue a step with a pending review, record identities/counters, pause, let the model explain an uncertainty and end its turn, then explicitly resume. The pending review and step remain identical; only after fresh required evidence/report submission may progression occur. Include a pause over a blocking-unknown hold, a detached hold, restart recovery and an unrelated verification control. Native conversation/Stop evidence is collected within an existing parent Tier2 scenario, not an extra unbounded model batch.

| Criterion                               | Required evidence                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow/step retained                  | Immediate before/paused/resumed snapshots plus cold load; unchanged node/review/capture/attempt/token identities                                |
| Pause is nonterminal and explicit       | No completion/abort notification; paused mutation refused; no automatic resume from tool text/reconnect; abort still ends run                   |
| Hooks give breathing room               | Source hook output and Stop controls; no forced continue/verdict/reminder storm; concise recovery/action reminder                               |
| Enforcement stays scoped                | Other verification/run/client cases remain enforced; pause cannot manufacture PASS or clear an underlying hold                                  |
| Resume restores pending obligations     | Review/unknown hold persists and its original action is shown; discussion is not captured as step output                                        |
| Transport and native evidence separated | Real STDIO/HTTP persistence controls first; then actual native pause acknowledgement, discussion/Stop, explicit resume and server/tracker joins |

Run affected own checks only. Parent conformance reuses accepted receipts; full test:all remains once in PR CI. Planning revision earns no source/native PASS. New unexpected discrepancies halt dependent implementation; intentional paused-mutation refusal is a successful negative control.

## Risks and rollback

Pause cannot stop an already-running shell command or external agent solely by changing server state; declare this boundary in docs and native receipts. Serialize concurrent mutations through existing store ownership and test late detached-report refusal; do not create a second worker scheduler. Keep existing blocking-unknown semantics and reviews separate. Freeze exact projection and verify-active scope before dispatch; if either lacks a usable existing seam, recut the bounded row rather than pretending an adapter proves parity.

No live shared DB migration, plugin installation, package release or global policy promotion follows from this plan. Deliver source/hooks/docs coherently; rollback through git while preserving durable evidence. Do not reinterpret abort as pause or reintroduce cancel as a compatibility exit.
