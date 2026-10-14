---
title: Run-level abort and complete cancel parameter removal
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

# Run-level abort and complete cancel parameter removal

## Now (2026-10-13)

Goal: one run-level abort action and complete public cancel removal.
Slice: abort source/store/docs and retained full source-wire matrix accepted; final integration corrections are tracked by root boundary plan.
Next: finish test-type/format/generated-catalog checks, then fresh candidate-bound bundle/protocol and reviewed source PR.
Constraint: source/store/docs/caller receipts retained; root owns HEAD; source child remains active at20-row cap.
Boundary: source-wire355RPC/28stages BOTH protocols retained; changed lint-source bindings require fresh proof. Installed/native and downstream port compatibility remain separate.

## Intent and owner ruling

**Work type:** bug_fix and contract consolidation.
**Confidence:** high in the source disagreement and existing durable termination owner; native delivery unmeasured.
**Scope:** prompt_engine's run-stop contract, existing server routing/review/render owners, generated vocabulary, maintained callers, hooks, paired tests and current docs.
**Problem:** ordinary abort stops the run, while detached reviews reject it and prescribe cancel, despite semantic instructions advertising abort. Desired behavior is one run-level abort action across all nonterminal states.

Owner ruling 2026-10-12: “By deprecate it means complete removal to ensure no dead code remains.” This overrides the earlier alias recommendation. The parent [workflow/client plan](workflow-client-evaluation-2026-10-09.md) owns initiative custody, publication scope and source-versus-native evidence rules. Conversational pause/resume is defined in the separate [pause subplan](workflow-conversation-pause-2026-10-12.md); abort remains terminal even while conversation-paused. This child plan exists because the former three-file renderer repair cannot close a cross-layer API removal; it adds no source subsystem.

## Fixed interaction contract

- Canonical call: `prompt_engine(chain_id:"...", gate_action:"abort")`.
- Abort addresses the whole existing run. Active runs, blocking-unknown pauses, ordinary reviews and detached holds all admit it without retry exhaustion, node selection, trailer/report/capture or a command to start work.
- Resolve the external chain identifier to its session under the caller's existing workspace scope. Route abort before command parsing, handoff/claim, review selection and retry-budget admission. Read the run identifier and request scope; it starts no work, consumes no report and bypasses no workspace ownership check.
- Reuse the existing durable store transition. Preserve state/artifacts and persisted `runStatus:"cancelled"`; block later progression, including after a cold load. Repeated abort of an already-cancelled run succeeds idempotently. Completed/failed/missing/out-of-scope runs return truthful non-applied results without mutation.
- Retire the public `cancel` property completely: schema, descriptions/metadata, types, router forwarding, executor branches, generated resolution vocabulary, maintained examples/callers/tests and current docs. No alias, shim, fallback, compatibility flag or postponed removal. In the coherent candidate, retired `cancel:true`, `cancel:false`, and a mixed cancel/abort call are refused by the existing undeclared-parameter mechanism before execution; state remains unchanged. Do not add a special retired-key runtime branch.
- PATH1/Q7: `gate_action` is a core field with the widest current enum. Abort, resume and accept_alternative remain available independently of gate feature enablement; gates-disabled retry/skip receive a named refusal before executor dispatch. `gates` and `gate_verdict` remain withdrawn. Parent row0.3 exclusively owns this feature-toggle repair; this child removes cancel after its acceptance.
- Retry and skip remain review-scoped and retain their phase/node requirements. Review services/lifecycle must stop expressing detached abort as an unsupported public action; eliminate dead run-stop branches after routing consolidation while preserving other live store consumers.
- Source responses, structured interrupt verbs, hook admission/recovery and terminal tracking project the same abort contract. A request to abort is not proof it succeeded: errors/refusals preserve tracking; authoritative terminal evidence clears it.
- Remove the old public spelling rather than all uses of the English word cancel. `cancelChain`, persisted `cancelled`, process cancellation/deadline controls, archived receipts and unrelated APIs remain where genuinely live. No data migration is required. Abort does not establish that an external client worker/process was killed.

## Existing owners and consequence trace

| Surface           | Writer/owner                                                                           | Reader/decision/view                                                                                       | Required change                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Public input      | tooling/contracts/prompt-engine.json; mcp/tools/schemas/prompt-engine.schema.ts        | registration/router index.ts; PromptExecutor input; generated schemas, snapshots and resolution vocabulary | Remove cancel declaration/forwarding; describe universal abort; regenerate through existing scripts                   |
| Run termination   | PromptExecutor boundary; ChainSessionStore.cancelChain                                 | scoped identifier lookup, durable mutation, terminal notification and resume guard                         | Reuse one scoped terminal path; move public abort ahead of review admission                                           |
| Review actions    | gate-verdict-processor.ts; review-lifecycle.ts                                         | gate-review-refusal.ts; detached report routing; shell/gate authority consumers                            | Enumerate live abort paths; remove contradictory restrictions and dead duplicate dispatch without changing retry/skip |
| Instructions      | describe-review-for-render.ts; response-assembler.ts; execution/delegation/detached.ts | response prose/structured interrupt verbs; actor/recovery hooks                                            | Advertise abort consistently as run-scoped and independent of node/trailer                                            |
| Hook state/policy | generated vocabulary; session_state.py; gate-enforce.py; post-prompt-engine.py         | admission, suggestions/recovery/Stop and terminal state tracking                                           | Remove old parameter reads/instructions; admit abort; clear only on authoritative terminal success                    |
| Callers/proof     | source tests/conformance fixtures/current docs; MCP-owned resources if found           | transport/client examples and integration assertions                                                       | Migrate maintained calls; use MCP for any resource edits; distinguish intentional retired-input refusal controls      |

This is a starting inventory, not closure. Row0.1 performs a repository-wide exact-key/behavior edge trace, including tooling, evaluations, scripts, resources and adapter projections. Search hits are classified as live consumers, definitions, unrelated cancellation or historical evidence. Every live consumer is assigned to a row before source dispatch.

## Implementation table

Entry: parent row0.3/Q7 owns the gate-toggle repair; no duplicate child task. Source dispatch waits for parent0.3 accepted receipt and worker exit; root accepted row0.1 inventory/recut on2026-10-12. All exact paths below are relative to repository root. Shared-tree exception: root owns HEAD; one leaf works at a time and overlapping owners sequence. Caps include tests; exceeding a cap returns to planner before edits. No production worker launched by this recut.

All production rows: tier=specified contract migration, effort=high, failure shape=wrong approach to lifecycle/consumer closure; Codex collaboration inherits gpt-6.1-sol/high (or worker-high); root capacity ruling permits gpt-6-sol/high with fork_turns:none after two explicit capacity errors, retaining the same specified-contract tier/failure shape and reporting the applied dispatch. No silent substitution. Numeric delegation cap from claude-code §Session-per-planner topology: root plus this subplanner plus one leaf; total descendants <=2. Row0.1 is bounded evidence/plan work owned here. Per row affected checks only, no boundary suite; root owns final PR boundary. No additional reviewer chain. Capacity recovery may use another declared Codex provider-bound model after explicit root ruling; applied model/effort recorded, no silent substitution.

### Terminal-repair tier — executes before remaining Tier0 cleanup

Entry: owner Q9/R-CANCEL-EVENT approved; child0.1-0.4 accepted source receipts retained. This tier runs before child0.5 despite numeric ordering. Completion entry for remaining Tier0: terminal repair2.2 and closure2.3 accepted. Same-tier Depends only; no duplicate event ownership or source subsystem. Original16 rows; current20 (8 Tier0 +7 Tier1 +3 terminal repair +2 latest-main integration), at the plan cap. The recuts and their evidence are retained below.

| ID  | Status                                                                                                                                            | Responsibility / exact manifest                                                                                                                                       | Cap                                     | Depends | Own check / falsifier                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | ✓ (2026-10-12; root accepted row2-1-event-manifest-v1 fourfile340 recut (authored320, measured327) and metadata/scope policy; no runtimeclaim)    | Reuse stopped0.5 receipt; existing terminal callback/record writer/consumer trace, new typed optional fact, eager event wiring versus lazy gate cleanup               | 1 outside receipt <=80 lines            | —       | All callback callers/readers and authoritative metadata/scope mapped; no hidden unscoped lookup/default guesses                                                                                                                 |
| 2.2 | ✓ (2026-10-12; accepted row2-2-event-source-receipt-v1 actualsourceintegration5/5 +durable-cancel/event-loss mutation, no native/transport claim) | manager.ts; shared/types/chain-session.ts; prompt-executor.ts; existing gate-abort-terminates-run.integration.test.ts (fourth file justified real paired integration) | 4 files <=340 changed lines             | 2.1     | Real durable cancelled+right-scope one terminal event+actualmetadata; refused/idempotent/clear-only none; persistence failure rollback/noevent and existing best-effort append policy; firstcall/coldload abort observer active |
| 2.3 | ✓ (2026-10-12; row2-3-event-acceptance-v1 spotread/writeback links0.5 cleanup, no duplicatedchecks)                                               | Retained source closure receipt/childwriteback; no new source edits/independent tests                                                                                 | 1 outside acceptance receipt <=60 lines | 2.2     | Exact accepted event owner/hash/limits; remaining0.5 deletion owner linked, no duplicate canonical cancellation writer                                                                                                          |

Terminal metadata ruling: actual sessionId/chainId, optional blueprint promptId, completedAt from persisted runCompletedAt; startedAt=completedAt matches prior terminal-event stamp. Existing RunTelemetry delivered from already-held durable session; no node/step/capture/evidence/evaluated gates. Persisted session continuityScopeId authoritative; org/workspace only from validated mutation scope whose canonical resolved key matches session; absent dimensions stay NULL. Canonical buildIdentityScope, no inferred workspace/default or session lookup from callback. ExecutionRecordStore.append warn/best-effort unchanged; durable save failure rollback/throw unchanged. Optional terminal fact present only actual terminal announcement; clear/prune/removal callback retains cleanup behavior and emits no cancellation event. Eager event observer required because PipelineBuilder callback registers lazily after early abort; existing gate-release callback stays separate and unchanged.

### Tier0 — eight bounded rows

| ID  | Status                                                                                                                                                          | Responsibility / exact manifest below                                                                                                                                                                                                                                                                           | Cap                                                                                | Depends       | Own check / falsifier                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ✓ (2026-10-12; accepted63-reference/126-line manifest receipt, source baseline6889b015; no native claim)                                                        | Classified consumer manifest and bounded exact rows; retained receipt references/existence check                                                                                                                                                                                                                | 1 artifact <=180 lines                                                             | —             | Every known live edge has an assigned row; own check resolves named paths, not a repeated search sweep                                                                                             |
| 0.2 | ✓ (2026-10-12; accepted row0-2-source-receipt-v2, 21/21 mocked boundary controls +2 meaningful mutation assertions, no durability/transport/native claim)       | Early abort replaces public cancel boundary; no node/review/exhaustion/command required, named no-chain refusal; preserve durable scoped owner                                                                                                                                                                  | 3 files <=220 changed lines                                                        | 0.1           | Affected executor validation tests; restoring gate-only admission or executing companion command fails                                                                                             |
| 0.3 | ✓ (2026-10-12; accepted row0-3-source-receipt-v1, 28/28 field parity +1 targeted mutation, hermetic HTTP schema capture; no abort durability/native claim)      | Retire cancel declaration/types/descriptions, regenerate fixed manifest; parent gate_action repair retained                                                                                                                                                                                                     | 7 handwritten files <=260 changed lines +8 generator-owned artifacts               | 0.2           | Existing field-contract parity + contracts generator check; cancel reintroduced in declaration/generated vocabulary fails. Retired true/false/mixed no-mutation controls belong final source proof |
| 0.4 | ✓ (2026-10-12; accepted row0-4-source-receipt-v1, 17/17 paired controls +3 meaningful retry-counter mutation failures, source/mocked only)                      | Remove duplicate review-run abort path, lifecycle outcome and detached contradiction; preserve retry/skip contracts                                                                                                                                                                                             | 7 files <=300 changed lines                                                        | 0.2, 0.3      | Affected action/lifecycle tests; review action becoming run termination or changing retry/skip counter/phase fails                                                                                 |
| 0.5 | ✓ (2026-10-12; accepted row0-5-source-receipt-v2, 40/40 pairedunitcontrols +2 false-completed mutation failures, no new realstore/native claim)                 | Retire standalone and duplicate shell abort; remove dead aborted flag/ledger projection after actual writer closure, preserve live outcomes                                                                                                                                                                     | 8 files <=290 changed lines (root recut: +recordstore currentcomments only)        | 0.4           | Affected shell/formatting tests; no-chain abort now named refusal at executor. Dead-flag dependency retained or live ledger outcome lost fails                                                     |
| 0.6 | ✓ (2026-10-13; accepted row0-6-source-receipt-v1, fivefiles129<=230, 106/106 rendercontrols +1 structuredverb mutation; source-only)                            | Canonical abort in held/detached/interrupt instructions, independent of node/trailer                                                                                                                                                                                                                            | 5 files <=230 changed lines                                                        | 0.3, 0.4, 0.5 | Affected delegation/CTA tests; restoring cancel CTA/interrupt verb fails                                                                                                                           |
| 0.7 | ✓ (2026-10-13; v1/v2 source receipts, eight files258<=320, 58/58 four-file controls + meaningful response-ID mutation, affected correction15/15; root accepted) | Remove cancel reads/fallback/advice; truthful terminal abort tracking; paired unchanged registration review                                                                                                                                                                                                     | 8 editable files <=320 changed lines +1 read-only registration                     | 0.3, 0.6      | Four named affected hook tests; errors/refusals clearing or terminal success retaining tracker fails; generated vocabulary controls admission                                                      |
| 0.8 | ✓ (2026-10-13; v1/v2 source receipts, two files175<=220, 12/12 controls +four substantive AND-mutation failures, sole comment correction sealed; source only)   | GateActionHandler status/enable messaging distinguishes runtime switch, ConfigurationEnabled and effective REVIEW/GUIDANCE (=runtime AND config); health metrics explicitly runtime. No input-visibility/config/refresh change; actual reported disable withdrawal remains UNCONFIRMED final1.4 transport proof | 2 editable files <=220 changed lines +current doc reference read-only (updated1.3) | 0.7           | Existing owning status test state matrix and targeted AND/messaging controls; source acceptance only, never transport parity                                                                       |

### Tier1 — seven cleanup/proof rows

Entry: all Tier0 rows accepted. Cross-tier ordering is this entry condition; Depends names only same-tier rows.

| ID  | Status                                                                                                                                                                                                                                            | Responsibility / exact manifest below                                                                                                                                | Cap                                                                                                            | Depends  | Own check / falsifier                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | ✓ (2026-10-13; row1-1-recovery-v2/final-receipt.json, fivefiles106<=160, fresh21/selftest/mutation2/restored21 with immediate seals; mocked source only)                                                                                          | Delete obsolete operation-specific relocation branch; migrate maintained parameter-read fixture/example                                                              | 5 files <=160 changed lines                                                                                    | —        | Two affected session tests + parameter-read self-test; special retired-operation dispatch or broken planted read control fails                                                                                                                                |
| 1.2 | ✓ (2026-10-13; row1-2-source-receipt-v1 v1/v2, eightfiles81<=200; 14 affected passes across initial12/corrected2, meaningful oldcaller refusal/restored1; selected HTTP/source only)                                                              | Migrate e2e/integration/conformance expectations and current public-spelling annotations                                                                             | 8 files <=200 changed lines                                                                                    | 1.1      | Affected changed scenarios only; restoring accepted cancel caller or old interrupt verbs fails                                                                                                                                                                |
| 1.5 | ✓ (2026-10-13; row1-5-source-receipt-v1, eightfiles234<=320; owning23pass/oldproducer2fail/exactrestore2pass; threepreservedchannels unchanged, sourcehooks only)                                                                                 | Object-only verdict hook instructions/examples and object.overall parsing; remove blanket FAIL denial and string-parameter branches; preserve distinct text channels | 8 files <=320 changed lines                                                                                    | 1.2      | Four owning hook test files: object PASS/FAIL admission, string-shape refusal, object reminders/Stop and migrated positive tracker fixtures; restoring string parser/blanket FAIL denial fails; read-only preserved-channel hash check                        |
| 1.3 | ✓ (2026-10-13; six-doc124-line current contract migration,85 assertions; old-example mutation1 failure/restored85; generated guidance PASS unchanged; docs-1-3 final-receipt SHAa72b5d928f64e476f251bc7e3734aa318b207cbc44ee254b242e2ae2f6c67d99) | Documentation-change guidance first; update current contract/examples and breaking change entry, keep WHY and immutable history                                      | 6 handwritten files <=210 changed lines (overview <=10) +AGENTS.md only generated if needed                    | 1.5      | Named current-doc references resolve to canonical abort; schema-feature policy and prose agree; old accepted spelling fails                                                                                                                                   |
| 1.4 | ✓ (2026-10-13; four real-store state controls PASS, outside eight-transition snapshots;54 non-live hits classified,202/260 lines; final-source-receipt SHA6ccce08be4906dbaabccf60c5074d9c1fbaa09bb402dacf9458d72ee4fe27f7e; transport remains1.6) | Canonical real executor/store proof and classified source removal sweep; retain accepted event/cold-load checks                                                      | 1 test +1 retained artifact <=260 changed lines                                                                | 1.3, 1.7 | Active/paused/ordinary/detached state controls, cold load/idempotence/isolation/artifact preservation; terminal event/scope invariants. Runtime retired-input/resume controls assigned to1.6; no transport/native claim here                                  |
| 1.6 | ✓ source-wire (recovered2026-10-14;355RPC/28stages BOTHprotocols;448file seal6c389222c023a99159afb727d2c079186daf57af74e5dc67105913fd27a23d14;62exact/cleanup; failed-run+STDIOforeignscope source/store only; native/crash durability unproved)  | Outside source-runtime driver using existing child-env/HTTP/STDIO seams, one retained transport receipt; no new production subsystem                                 | <=420 driver lines +<=100 receipt lines outside repo; source build only if needed, no handwritten source edits | 1.4      | Both transports: state matrix and abort durability/idempotence/artifact/resume protection; retired true/false/mixed unchanged-state refusal; actual tools/list versus current tools/call under toggles/config; startup/settings mismatch stops dependent work |
| 1.7 | ✓ (2026-10-13; caller/caption4-line migration, real composition-root scenario1 PASS, retired-call mutation1 expected failure/restored1 PASS; final receipt SHA6f79f5dce491e56f92734843346515bda12680dc5839bbcf65f7b4934e9e92c2)                   | server/tests/integration/pipeline/composition-root.integration.test.ts: current stop-action test caption/call only; preserve cancelled result/resume guard           | 1 file <=10 changed lines                                                                                      | 1.3      | One affected source-runtime scenario; restoring accepted cancel caller must fail its success assertion; exact restore passes                                                                                                                                  |

### Exact handwritten and generated manifests

**0.2**

- `server/src/mcp/tools/prompt-engine/core/prompt-executor.ts`
- `server/src/mcp/tools/index.ts` (after parent0.3 worker exits)
- `server/tests/unit/mcp-tools/prompt-engine/prompt-engine-validation.test.ts`

**0.3**

- `server/tooling/contracts/prompt-engine.json`
- `server/tooling/contracts/workflow-ir.json`
- `server/tooling/contracts/system-control.json`
- `server/src/mcp/tools/schemas/prompt-engine.schema.ts` (cancel removal only after parent0.3)
- `server/scripts/generate-contracts.ts`
- `server/src/mcp/contracts/schemas/types.ts`
- `server/tests/unit/mcp-tools/tool-input-fields.test.ts` (existing parity check; edit only if meaningful affected assertion needed)
- Generator `npm run generate:contracts` owns `server/src/mcp/contracts/schemas/_generated/prompt_engine.generated.ts`, `workflow_ir.generated.ts`, `system_control.generated.ts`, `tool-descriptions.contracts.json`, plus `hooks/lib/_generated/resolution_verbs.py` and `resolution-verbs.json`.
- Existing `server/scripts/capture-tool-schemas.mjs` owns `server/tests/snapshots/mcp-input-schemas.json` and `mcp-input-schema-sizes.json` (sizes is read/check unless output actually changes); snapshot refresh waits for a coherent candidate and root writer lease where guard requires it.

**0.4**

- `server/src/engine/gates/services/gate-verdict-processor.ts`
- `server/src/engine/execution/pipeline/decisions/gates/review-lifecycle.ts`
- `server/src/engine/gates/services/gate-review-refusal.ts`
- `server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-types.ts`
- `server/src/engine/execution/pipeline/stages/16-response-capture-stage.ts`
- `server/tests/unit/gates/services/gate-verdict-processor-action.test.ts`
- `server/tests/unit/execution/pipeline/state/review-lifecycle.test.ts`

**0.5**

- `server/src/modules/chains/execution-record-store.ts` (ONLY <=5 revised current-comment lines: three terminal paths; no behavior/API/query change)
- `server/src/engine/execution/pipeline/stages/17-shell-verification-stage.ts`
- `server/tests/unit/execution/pipeline/shell-verification-stage.test.ts`
- `server/src/engine/execution/context/internal-state.ts`
- `server/src/engine/execution/pipeline/stages/21-formatting-stage.ts`
- `server/tests/unit/execution/pipeline/response-formatting-stage.test.ts`
- `server/src/engine/gates/types.ts`
- `server/src/shared/types/execution.ts`

**0.6**

- `server/src/engine/execution/formatting/response-assembler.ts`
- `server/src/engine/execution/delegation/detached.ts`
- `server/tests/unit/execution/delegation/detached.test.ts`
- `server/tests/unit/execution/formatting/response-assembler-chain-cta.test.ts`
- `server/tests/unit/execution/formatting/response-assembler-cta.test.ts`
- Read-only projection closure: `server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts` already advertises abort. A needed edit requires row recut before exceeding manifest.

**0.7**

- `hooks/gate-enforce.py`
- `hooks/post-prompt-engine.py`
- `hooks/lib/session_state.py`
- `hooks/README.md`
- `hooks/tests/test_gate_enforce_verdict.py`
- `hooks/tests/test_post_prompt_engine_clearing.py`
- `hooks/tests/test_unknown_interrupt_hold.py`
- `hooks/tests/test_subagent_scope.py`
- Read-only paired registration: `hooks/hooks.json`; PreToolUse/PostToolUse matcher/event unchanged, no pointless literal registration edit or live deployment.

**0.8**

- `server/src/mcp/tools/system-control/handlers/gate-action-handler.ts`
- `server/tests/unit/mcp-tools/system-control/gate-action.test.ts`
- Read-only current reference `docs/reference/mcp-tools.md`; child1.3 owns update. No `index.ts` or shared admission-helper change for a status-label remedy.
- Effective predicate applies only to global review/guidance policy, not per-call modifiers or shell capability. Existing config getter reused; no implicit config write or redundant refresh.
- Final1.4 owns sameprocess registered disable -> tools/list -> gates request refusal on both transports with scope/instance joins; reported discrepancy unconfirmed until driven. A proved defect returns for named-owner recut, not guessed repair.

**1.1**

- `server/src/mcp/tools/system-control/handlers/session-action-handler.ts`
- `server/tests/unit/mcp-tools/system-control/session-action-handler.test.ts`
- `server/tests/unit/mcp-tools/system-control/session-action.test.ts`
- `server/scripts/lib/parameter-reads/self-test.js`
- `server/scripts/validate-tool-parameter-reads.js`

**1.2**

- `server/tests/e2e/chain-prompt-sources.e2e.test.ts`
- `server/tests/e2e/claimed-run-gates.e2e.test.ts`
- `server/tests/integration/chain/unknown-interrupt-flow.integration.test.ts`
- `server/tests/integration/chain/delegation-detached.integration.test.ts`
- `server/tests/e2e/conformance/prompt-engine-surface.yaml`
- `server/src/engine/execution/pipeline/prompt-execution-pipeline.ts`
- `server/tests/unit/execution/pipeline/pipeline-orchestrator.test.ts`
- `server/src/shared/types/chain-session.ts`

**1.5**

- `hooks/lib/session_state.py` (parameter examples/instructions; returned-text parsing kept where still live)
- `hooks/ralph-stop.py` (parameter guidance only; subagent text protocol unchanged)
- `hooks/gate-enforce.py` (object.overall, no string-parameter parser or blanket FAIL denial; remaining phase admission stays parent work)
- `hooks/README.md`
- `hooks/tests/test_gate_enforce_verdict.py`
- `hooks/tests/test_session_tracker.py`
- `hooks/tests/test_ralph_stop.py`
- `hooks/tests/test_post_prompt_engine_clearing.py` (positive tool-input fixtures to object; retired-string negative controls identified)
- Read-only preserved channels: `hooks/lib/ralph_subagent_contract.py` (SHA256 `6fea7b1fcc891a5bbe4407c0419f847ca93ecfddfc85ec11823e8d280bb19532`), exported-skill Stop owner `server/src/modules/skills-sync/service.ts` (`fb32575453bcc6d9cc4d3129bce45b6de2641fd3ff8b7ba426797de87479f9a5`) and delegation trailer owner `server/src/engine/execution/delegation/handoff-contract.ts` (`1376f7d6d9d042d4a391fe3abb5cf988363543780fe1d11462fdec060a7e0e8d`); frozen before1.5 dispatch, no edits.
- Parameter examples follow PR488: overall PASS or FAIL plus rationale; applicable per_gate/reminders and semantic evaluation follow returned server template. No invented empty universal semantic report. Minimal shape admission may read overall; server owns grading/attempts.

**1.3**

- `docs/reference/mcp-tools.md`
- `docs/guides/gates.md`
- `docs/concepts/chains-lifecycle.md`
- `docs/architecture/overview.md` (current exhausted-review wording only; <=10 changed lines)
- `CHANGELOG.md` (new coherent breaking entry; versioned history retained)
- `CLAUDE.md` (canonical Public API Contract, run-control vs gate-feature ownership)
- `AGENTS.md` only through existing guidance generator when canonical projected section changes; never hand-edit.

**1.4**

- `server/tests/integration/gates/gate-abort-terminates-run.integration.test.ts`
- `/home/minipuft/.local/share/claude-prompts-mcp/evaluations/workflow-client-20261012/abort-removal/final-source-receipt.md` (new retained receipt)
- Existing read/run-only control `server/tests/e2e/shell-verify-final-step-complete.e2e.test.ts` already calls public abort; no speculative edit.

### Custody and policy concerns

- Parent0.3 exclusively owns its schema/router/shared-undeclared and two paired tests until accepted/exit. Child0.2/0.3 then modify only their own boundary/removal concerns; accepted parent checks rerun only if their relevant bytes changed.
- Run-backed abort exits before review/shell dispatch. Root ruled no-chain abort a named unchanged-state refusal; old acceptance assertions intentionally migrate. Remove system-control's obsolete cancel relocation special case; generic existing operation refusal owns it.
- Keep `cancelChain`, persisted `cancelled`, genuine internal store/rollback tests, process controls and versioned historical receipts. Retire public parameter definitions/readers/forwarding/advice and dead abort review/shell paths.
- Abort terminal tracking must preserve existing pending state on refused/error response; request spelling alone is not terminal evidence. Structured interaction packet work remains parent owner; no duplicate packet schema from this child.
- External Gemini/OpenCode changes remain parent Q6; Codex wrappers inherit upstream only when correct package/event/trust is verified. Same-repo source proof does not establish installed-client/all-client parity. No external repository edits/relocking/release here.
- No new source discrepancy reported during this plan-only continuation. Parent PATH1 resolves the formerly unruled policy direction; implementation/validation acceptance is still pending.

## Completion and validation

| Criterion                                     | Evidence                                                                                                              | Boundary                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Canonical abort accepted across run states    | Real store/authority integration, including live detached held run and blocking unknown                               | Source/server-executed; not native proof                                               |
| Termination is durable, scoped and idempotent | Cold reload, no later progression, cross-workspace refusal, repeated abort; artifacts retained                        | Existing cancellation semantics preserved                                              |
| Old parameter completely removed              | Public/generated schema snapshots plus classified consumer manifest; retired true/false/mixed calls refused unchanged | Breaking contract change; no alias or later cleanup                                    |
| Instructions/hooks agree                      | Actual renderer outputs and seeded hook probes across active/paused/ordinary/detached states                          | Source hook execution only                                                             |
| Both transports obey same contract            | Scoped STDIO and Streamable HTTP request/state controls on coherent candidate                                         | HTTP fresh-instance lifetime included                                                  |
| Actual installed client can abort correctly   | Parent Tier2 event/tool/server/target joins and immediate tracker snapshots                                           | Separately native-client-observed; no extra model scenario added solely for repetition |

Run each row's affected test/validator only. Parent source conformance reuses these accepted receipts; rerun only when affected bytes or settings change. Before push, the repository's source typecheck, lint ratchet, tests-type ratchet, validate:all and PR checks apply. Full test:all runs once in PR CI; do not repeat locally unless reproducing failure or no PR carries the change. A new unexpected failure/discrepancy halts dependent work; deliberate retired-input refusals are successful negative controls.

## Risks, docs and rollback

This removes an external parameter intentionally. Update all maintained callers and surface the breaking change in the reviewed PR/changelog under repository convention; consumers outside this repository must adopt abort. Do not mask a missing migration with an alias. Enumerate downstream adapter ownership and any MCP-authored resource changes before delivery; native/all-client parity remains unclaimed until observed.

Do not mechanically delete internal cancellation, unrelated abort signals, immutable old run records or the persisted cancelled status. Preserve artifacts and workspace isolation. Do not claim subprocess/worker termination without independent host lifecycle proof. Ordinary clear and force_restart keep their distinct behavior.

Deliver the migration as one coherent source slice after all source rows pass; no partially migrated contract is pushed as a supported state. Roll back the coherent source change through git, preserving evidence and existing data. No tag/package release/global policy change/shared database cutover is authorized by this revision.

## Sources

- Owner ruling and correction in parent D9 and the sibling [implementation notes](workflow-client-evaluation-2026-10-09-implementation-notes.md).
- PromptExecutor's current cancel entry and scoped identifier/termination implementation; ChainSessionStore.cancelChain and terminal persistence.
- semanticReviewAction exhausted instruction versus processDetachedReviewAction/review-lifecycle detached refusal; current detached/interrupt renderers and generated hook vocabulary.
- Commit f4452ced (2026-08-15): abort previously reported cancellation while runStatus stayed working; durable termination repair and cold-load controls.
- hooks/README.md: hardcoded pending admission previously denied both abort and cancel (fixed 2026-08-20). Naming consolidation alone does not prove all historical defects resolved.

## Integration tier (2026-10-13)

Entry: all prior workers stopped, whole-repository lease released, source checkpoint saved under /tmp/workflow-resume-20261013. Root alone moves HEAD. Worker reads git but never changes refs/index/stash.

| ID  | Status                                                                                                                          | Responsibility                                                                                                                                                                                                  | Cap                                                                                | Own check / falsifier                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | ✓ (2026-10-13; conflict resolved, static comparison sealed in integration-3-1/review-seal.json; runtime acceptance belongs 3.2) | Resolve the single detached.test.ts stash-apply conflict after root fast-forward; retain both upstream semantic routing and accepted abort tests. Read-only overlap review found two follow-ups assigned to 3.2 | <=10 conflicted files, <=350 repair lines; exact manifest measured before dispatch | No conflict markers in resolved file; overlap review sealed. Runtime checks were NOT run; 3.2 closes the two measured integration gaps and owns affected checks. |

Tier: specified integration / high / wrong approach to lifecycle or rendering preservation. Dispatch: native Codex worker-high, gpt-6.1-sol/high, history-free; shared-tree, root owns HEAD. All broader validation remains at PR boundary.

| ID  | Status                                                                                                                                                                                                             | Responsibility                                                                                                                                                                                                                                                                                                                                                                                   | Cap                        | Own check / falsifier                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.2 | ✓ (2026-10-13; three-file23-line repair, six suites104 PASS, semantic CTA mutation3 expected failures/restored3 PASS; outside final-seal.json SHA862fd83e641eb4c7c41e10b18840fffc7bc98a26237280d0abcbe1bdd75ac21f) | server/src/engine/execution/delegation/detached.ts; server/tests/unit/execution/delegation/detached.test.ts; server/tests/integration/gates/gate-abort-terminates-run.integration.test.ts. Include canonical whole-run abort CTA in both semantic/fallback branches while keeping one routed report resume; replace removed executor.cleanup() test call with existing ChainSessionStore cleanup | 3 files <=120 repair lines | Six affected test files from 3.1; semantic-branch CTA omission must fail the new assertion; no broad suite. Existing actual event/durability controls retained. |

**1.6 exact outside manifest**

- /tmp/workflow-resume-20261013/transport-1-6/probe.mts (temporary verification driver, <=420 lines, reuses existing fixture/environment/client seams; no second workflow authority)
- /home/minipuft/.local/share/claude-prompts-mcp/evaluations/workflow-client-20261012/abort-removal/transport-source-receipt.md (<=100 lines, raw payloads/state/identity hashes retained beside it).
- Runtime source launches through existing source-mode helper are permitted; a dist build, if used, must precede freshness check. No fixture prompt/gate manual edits: MCP resource operations only, in isolated roots.

Recut rationale: old1.4 coupled real-store source coverage/removal enumeration with two transport drivers under a single260-line artifact cap. Split distinct evidence boundaries rather than silently expanding it; existing five source checks remain accepted and only new owning assertions run. Docs1.3 accepted before both. Child totals20 bounded rows after upstream caller1.7; parent0.1 still open until all accepted.
