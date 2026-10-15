---
title: Workflow client implementation handoff
date: 2026-10-12
status: active
tags: [workflows, handoff]
---

# Claude session handoff — workflow/client contract alignment

Prepared 2026-10-12. This is a curated transfer of the Codex/T3 conversation, not a raw transcript or a claim that implementation is complete.

## Start here

Read these files from /home/minipuft/Applications/claude-prompts-mcp-workflow-evaluation (the sole execution-plan writeback authority):

1. plans/workflow-client-evaluation-2026-10-09.md — governing consolidated plan, 20 parent rows; source availability0.3 and integration0.4 accepted, remaining rows open including both Tier0 capabilities.
2. plans/workflow-client-evaluation-2026-10-09-implementation-notes.md — history, corrections, stopped findings and old/new row mapping.
3. This handoff — compact context, problem register and execution boundaries.
4. Consult plans/workflow-client-evaluation-2026-10-09-path-evidence.md only for the referenced paths/symbols, not as a reason to repeat the entire audit.

5. plans/workflow-run-abort-removal-2026-10-12.md — eight bounded migration rows implementing the owner's settled run-termination contract.
6. plans/workflow-conversation-pause-2026-10-12.md — eight bounded rows for durable conversation pause/resume and matching hooks.

The user authorized local strategic implementation. The detached-abort policy was settled; the prior inventory stopped on the gates-disabled schema/router gap. The owner subsequently selected path1 and resumed its repair: gate_action stays core; run/unknown controls independent, review-only retry/skip feature/phase restricted (parent0.3, Q7 RULED). A separate Gemini adapter denial is source-only and reserved by Q6. On 2026-10-12 the user settled that discrepancy and requested this plan revision: accept gate_action abort everywhere and completely remove cancel:true, with no compatibility alias. The owner also requested conversational pause/resume with appropriate hook enforcement/reminders. This turn revises plans only. Finish both Tier0 child inventories/capabilities before row1.1's remaining contract/consumer decisions. Do not reopen the abort/removal policy fork; still halt dependent work on new unexpected failures/discrepancies.

## User goal and agreed direction

Semantic gates should be small, trackable evaluations with explicit targets, questions, evidence, bounded results and acceptance predicates. Positive/negative/alternative/boundary/insufficient-evidence testing evolves with gates; suites retain distinct revisions and protected labels.

The next initiative aligns what lands in the actual client—MCP instructions, plugin hooks, allowed calls, model review and recovery—with the server's intended workflow and target outcome. A testing prompt may drive ordinary product use while independent frozen checks judge the outcome. Extend existing systems into an opt-in shared workflow evaluation runner.

Authority: resource_manager owns resources; prompt_engine/server review services own workflow state, admission, grades, retries and progression. Hooks/adapters project valid next actions and enforce host-specific policy. Align hooks to legitimate source semantics; source projection changes are appropriate where clients lack a consumable contract. Do not preserve a faulty hook denial by weakening server capture/report/binding semantics.

## Delivered work — keep closed

- PR474 merged semantic schema/acceptance kernel; PR475 merged optional immutable archive/calibration/replay; PR476 merged runtime activation. Main source observed at 6889b0154e44eebd38cb1f622089c9650769aa1b, PR476 squash.
- Final semantic implementation had 12 required CI checks passing. Those are historical accepted receipts; no need to rerun them absent relevant invalidation.
- Global recovery guidance was applied locally in ~/.claude, commit a7273b5: explicit agent activation, accepted receipt reuse, no duplicate reviewer chains and writer leases for guarded runtime tests. No measured time savings or inferred global publication.
- Native calibration pilot: 11 calls, small-suite structured/prose comparison showed no quality advantage; disposition INCONCLUSIVE; automatic promotion disabled. Do not replay the pilot or claim live MCP-workflow improvement from it.
- Public controlled SDK demo: real STDIO server, five cases—weak judgment FAIL held, corrected judgment PASS advanced, stale binding refused, fabricated quote invalid/FAIL, client PASS with false observation derived FAIL. Prepared texts were reviewed by a separate agent; server did not call a provider itself. The successful correction was in a fresh run, the final observation step was not completed, and stale-refusal immediate after-state was missing.

## Current repository/custody state

- Primary checkout /home/minipuft/Applications/claude-prompts-mcp is on main. Before this planning pass its only changes were untracked local planning drafts. This pass changes planning/transfer artifacts only.
- Existing initiative worktree /home/minipuft/Applications/claude-prompts-mcp-workflow-evaluation, branch feat/workflow-client-evaluation, was clean at source6889b015 on the last check. Safe repo worktree bootstrap exists in server/package.json, not root package.json:
  npm --prefix server run worktree:create -- <path> <branch> --from origin/main
- Earlier untracked execution drafts disappeared (cause unknown); they were restored from preserved primary drafts. The current worktree plans/notes/handoff now own writeback. Primary drafts and old durable exports are snapshots. Preserve source/worktrees; do not use an old agent name as current custody.
- No client-alignment source row is accepted or implemented. Row1.1 was stopped with a partial inventory; production and native dependent work remain unexecuted.
- Original semantic GitHub push/merge authorization R6 is historical. The current plan keeps follow-up delivery scope OPEN rather than inventing new approval. Retain authorization that genuinely applies; no release/tag/npm publication, global promotion or shared-DB migration.

## Durable evidence

Preflight root:
/home/minipuft/.local/share/claude-prompts-mcp/evaluations/workflow-client-20261010/preflight/

Contains workflow-client-row1-1-inventory.md, workflow-client-native-preflight.md and digest manifest. Inventory is partial/unaccepted and its own artifact check was not run after STOP. Native preflight observed CLI0.161.0 help/features historically, not actual installed hook behavior.

Public demo root:
/home/minipuft/.local/share/claude-prompts-mcp/demos/semantic-gate-showcase-20261008/

Contains results.json, judge-receipt.json, manifest.json, verification.json and raw receipts/snapshots. Forty sealed files matched their hashes in the earlier review. These are development demonstration records; they are not private holdouts or model-accuracy evidence. The browser page serves recorded data and does not execute MCP when case buttons are clicked.

## Problem register — do not merge evidence levels

| ID  | Finding                                                                 | Evidence and closure still needed                                                                                                                                   |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01 | Honest overall FAIL is denied before server delivery                    | Executed checkout-hook probe confirmed; installed native path unmeasured. Need FAIL delivered/persisted with proper retry                                           |
| P02 | Tracked pending-gate rule excludes required capture-first user_response | Source-confirmed server instruction/predicate conflict. Need phase-aware admission and native proof; do not add universal user_response resolution                  |
| P03 | Recovery/suggestion wording prescribes insufficient legacy verdict      | Source inspected. Need shared correct action and observed installed-client instructions                                                                             |
| P04 | Markerless verdict/error reply may clear pending tracking               | Source conditional risk. Need actual host error-event delivery plus immediate before/after state                                                                    |
| P05 | DB/response-to-hook state drops semantic submission/phase               | Partial source inventory. Complete producer/reader/decision/view closure and compatibility                                                                          |
| P06 | Demo driver stopped on expected stale refusal                           | Harness failure and teardown recorded; fix expected-error classification and retain after-state                                                                     |
| P07 | Framework disable reset after restart                                   | Documented in-memory behavior and later framework guidance observed; configuration-control gap, not inherently a server defect                                      |
| P08 | Installed native identity/trust/events/runtime agreement incomplete     | CLI help/features observed only. Need actual install/source/event/transport/target joins                                                                            |
| P09 | Safe config probe failed importing tomllib                              | Harness environment failure before config/auth access. Use available supported tooling; no new package/auth manipulation assumed                                    |
| P10 | Same-run repair, full completion and stale after-state not demonstrated | Recorded runs differ and last prompt delivery is not completion. Need one continuous native/target proof                                                            |
| P11 | Stop consumer adds another legacy instruction                           | ralph-stop.py::chain_block_reason now inspected and confirmed. Earlier uninspected wording claim was retracted, then independently verified; native Stop unmeasured |

Additional operational observation: linked-worktree execution drafts disappeared while primary drafts and durable artifacts survived. Cause unknown; restore from verified transfer, do not attribute to MCP code.

Evidence labels: source-inspected, source-probed, server-executed, native-client-observed, harness-observed, unknown/retracted. A manifest/help flag/source call does not establish native hook execution or provider identity. Expected stale/quote/contradictory-PASS refusals are successful controls, not unexpected product failures.

## Settled run-termination contract (2026-10-12)

- Canonical call: prompt_engine(chain_id:"...", gate_action:"abort"). Stop the whole run across active/paused/ordinary/detached states without retry exhaustion or node/trailer address.
- Remove cancel from public schema/contract/types/routing, generated hook vocabulary, action guidance, maintained callers/tests and current documentation. No alias, compatibility flag, fallback or deferred removal.
- Reuse the scoped durable store; retain artifacts and the existing cancelled status. Repeated abort is idempotent; completed/failed/missing/out-of-scope runs produce truthful non-applied results.
- Reject retired cancel parameters through ordinary undeclared-parameter validation, with no state mutation. Prove restart/resume isolation and both transports at source; native host delivery/tracking is separate proof.
- This contract does not assert that abort kills external client workers or subprocesses; their lifecycle remains a distinct evidence boundary.

## Settled conversation pause contract (2026-10-12)

- gate_action pause durably parks the scoped nonterminal run without changing the active step, captured output, review/unknown/shell holds, counters or detached report tokens.
- The model may discuss/clarify with the user and end its turn. Hooks keep recoverable tracking, suppress forced continuation/verdict/fix CTAs and show a concise paused-step/resume reminder without repeated injections.
- Explicit gate_action resume clears only the conversation hold and returns the prior pending action without capture/grading/advancement. Existing blocking-unknown resume semantics remain intact; an underlying hold remains owed.
- Scoped Stop handling allows this paused workflow's turn to end while unrelated verification/run/host policy still applies. Errors/refusals/missing markers never clear pause or imply completion. Compaction/restart preserve pause.
- Abort still ends the run; pause does not stop an already-running external worker or shell process. Same-run source snapshots and native discussion/Stop/resume are separate proof.

## Breaking upgrade and recovery policy (2026-10-12)

Old calls and genuinely incompatible transient runs may fail/reset during a declared breaking upgrade; no cancel alias is kept for them. Retain compatible run state and durable resource/history data. Reuse table-contract postures and the existing migration owner: preserve durable rows, rebuild derived projections, reset ephemeral state under the supported transition or targeted session clear. Automatic cleanup requires deterministic scope/compatibility rules; no blanket state.db/plugin-cache wipe. Existing MCP processes keep loaded code until reconnect/restart, so actual server/hook identity joins still matter. Gates-disabled stop-action availability is a source fix affecting fresh runs too; DB cleanup does not resolve it. No live reset or shared-runtime cutover has been performed.

## Planned hook behavior

- Preserve canonical review phase and submission action across session_state, both db_reader paths and client result tracking.
- gate-enforce admits valid FAIL and capture/recapture in the correct phase; server owns grade/counters/new attempts. Report, exhaustion, unavailable authority, ordinary legacy and blocking-unknown holds have distinct actions.
- post-prompt-engine preserves state on refusal/error/missing markers and clears only with authoritative terminal evidence. Final-step ordinal or requested PASS is insufficient.
- prompt-suggest, compact-recovery, post-tool reminders and ralph-stop consume one shared action projection rather than local legacy action tables.
- Host adapters preserve actual identifiers/result/error fields; register/change events only after real positive-control evidence. Shared policy is upstream Python; Gemini/Codex adapters remain thin; OpenCode is a separate behavioral port.
- Tests/docs are updated with behavior; source controls are distinct from native verification.

Useful verified producer chain:
ChainManager.collectActiveSessionRows (server/src/modules/chains/manager.ts) serializes currentStepReview/runStatus -> SqliteEngine.applyViews exposes current_step_review -> hooks/lib/db_reader.py currently retains gate IDs/attempt count but loses richer review semantics.
Canonical semantic projection/actions already exist in semantic-review-context.ts and describe-review-for-render.ts. Reuse their semantics; exact added wire fields/version/location remain row1.1/Q1 decisions. No DDL migration is presumed.

## Execution and validation boundaries

- Follow the project's current CLAUDE.md/AGENTS.md and applicable rules; planner plans/judges/owns HEAD, strategic workers edit production. Worker cap2; ordinary repair cap3files; row1.2 explicitly allows a fourth boundary-test file. Recut before scope expansion.
- First native host default is isolated Codex CLI even if the planner is Claude. Switching verification host requires a recorded ruling; do not claim T3/native or all-client parity.
- Refresh actual native version, source/cache/install, hook activation/trust and relevant event delivery. Reuse existing staging/collector interfaces; do not fork a provider/benchmark runner or read private graders/auth.
- Trial limits: at most3task scenarios plus1reviewer each,600s/invocation,concurrency1,zero automatic reruns. Existing account only; effective model/effort and execution scope must be recorded before trials. Cost stays unknown if complete collection is absent. No comparative paid batch/model ranking.
- Each row runs its artifact check. Preserve accepted receipts; rerun only affected checks when relevant bytes/settings changed. Planner reads artifacts once; no duplicate reviewer chains.
- Before push, project mandatory source typecheck/lint ratchet/tests-type ratchet/validate:all. Full test:all once in PR CI; local full suite only to reproduce a CI failure or when no PR carries the change. Required CI must be green before merge. No bypass/force push.
- Runtime guards freeze their observed writer scope through teardown and seal; whole-tree guards pause all writers including plans/tests/generated files. Shared dependency symlinks must not receive npm ci/install writes.
- Prompts/chains/gates are authored through MCP tools only. Existing archive owns immutable trial evidence; resource_manager owns resources and prompt_engine progression. Reserved labels and solution history are outside actor/reviewer context.
- Owner stop rule: unexpected validation failure or discrepancy halts dependent work and is reported. Deliberate negative controls do not trigger this stop. Preserve partial evidence and classify failure instead of automatically retrying or hiding it behind a later PASS.

## Plan sequence and next action

Tier0: finish workflow-run-abort-removal-2026-10-12.md, then workflow-conversation-pause-2026-10-12.md; terminal abort with full cancel removal, durable conversation pause/resume and matching scoped hook behavior; source controls accepted.
Tier1 rows1.1-1.8: finish contract, existing server projection, shared hook state, admission, tracking, reminders/recovery, Stop, source conformance.
Tier2 rows2.1-2.4: portable safe native preflight, isolated adapter/event verification, continuous repair/stale control, independently checked code task.
Tier3 rows3.1-3.4: optional workflow specialization, replay/report, one end-of-evidence delegated diagnosis, MCP-authored testing prompt and third bounded native drive/docs.

Do not reopen delivered semantic work or activate the entire older benchmark-authoring backlog. Finish Tier0 first, then row1.1's exact namespace/compatibility/consumer decisions and account for downstream ownership. The planner rules open questions before dependent dispatch. No implementation/native PASS has been earned yet.

Owner selected path1 and resumed: implement gate-independent core gate_action availability at parent0.3 (Q7 RULED), then abort removal and pause; Gemini port scope remains Q6. No source worker launched and no implementation receipt exists.

Suggested continuation after the user directs implementation to resume:

> > strategic_implement task:"Resume the client workflow contract/evaluation plan at Tier0, honoring complete cancel removal, terminal abort, resumable conversation pause and matching hook enforcement/reminders, then row1.1. Preserve the evidence register, complete the contract before source edits, execute dependent rows through reviewed bounded slices, and stop on unexpected validation failure/discrepancy." plan_path:"/home/minipuft/Applications/claude-prompts-mcp-workflow-evaluation/plans/workflow-client-evaluation-2026-10-09.md" worker_cap:2

When binding an execution copy in the initiative worktree, use its reconciled path in the actual command and make that the only writeback authority.

## Latest integration checkpoint (2026-10-12)

Current initiative HEAD cf619a61 includes PRs #477–#482. Claude planner c0 identified the earlier draft deletion after committing unchanged copies; that cause is now known. Our lanes are separate. The checkpoint preserves 28 files, a binary patch and hash manifest, plus retained stash 81891d14978978b42a82ac4ce8bf086a64cb4bec.

The expected generated conflicts were resolved through their generators. Parent 0.3 and 0.4 are accepted; abort child 0.1–0.4 are accepted. Four affected post-integration test files passed 171/171; build, HTTP schema capture and contracts checks passed. Schema size is 17,479/18,000 bytes. No native proof exists. Preserve R11.2 semantic-report refusals, new review timing/reasons and legacy support. Hook tests and commits must unset CLAUDE_PLUGIN_ROOT. The transferred 0D.7 status/withdrawal finding belongs to our lane; its transport reproduction remains unconfirmed. Release PR #473 advice is not release authorization.

## Current STOP (2026-10-12)

Root stopped child 0.5 before edits after tracing a reachable prior ordinary gate-abort path to stage 21's cancelled terminal history writer. The new early abort route bypasses that writer. This is a source-established potential event loss; it has not been reproduced at runtime.

Parent Q9 and child 0.5 require a bounded repair through the existing execution-record owner before flag deletion. Preserve the actual cancellation event without adding a synthetic completed step, evaluated gate verdict or parallel ledger. Accepted changes remain local. No native trial, full CI suite, PR or publication occurred. Current run status, terminal notifications and historical events must be verified separately.
