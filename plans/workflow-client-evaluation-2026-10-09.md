---
title: Client workflow contracts and repeatable evaluation
date: 2026-10-09
type: implementation-plan
status: active
initiative_branch: feat/workflow-client-evaluation
worker_cap: 2
planner_session: workflow-client-evaluation-plan
branch_mode: shared-tree
publish: push+merge # R-PUBLISH, 2026-10-13; reviewed repo slices only, no release
tracking: none
tracking_reason: local-only
tags: [hooks, workflows, evaluation, clients]
---

# Client workflow contracts and repeatable evaluation

## Now (2026-10-13)

Goal: coherent abort, conversation pause, and truthful client workflow evidence.
Slice: full retained source-wire matrix accepted:355RPC/28stages BOTH STDIO/HTTP,62exactbindings,8hosts/4ports cleaned; recovered seal448files/6c389222c023a99159afb727d2c079186daf57af74e5dc67105913fd27a23d14. Source abort/namespace/F24/F25 repairs accepted; no runtime replay after crash.
Next: source, fixture, format and canonical baseline/catalog corrections accepted. Commit accepted source/writeback, run final integrated local gate, then exclusive final bundle/source-wire row0.35 and source PR checks. Downstream port ownership/change gate remains unresolved; no native/install/release readiness claim.
Constraint: root owns HEAD; checkpoint/stashes and accepted receipts retained; no CloudySky/global/downstream install/shared DB/npm/tag/release; public delivery scope remains separately bound.
Boundary: source/STDIO/HTTP proof accepted with failed-run and STDIOforeignscope source/store limits; native/client installation and crash durability unproved. No release or installed mutation authorized.

## Intent

**Work type:** bounded bug fixes followed by an opt-in evaluation feature.
**Confidence:** high on direct-MCP behavior and checkout-hook findings; medium on native client adapters and final wire projections.
**Scope:** existing hook enforcement/reminders/recovery, server interaction projections where required, existing conformance tests, optional evaluations package, related documentation.
**Problem:** direct server correctness does not establish that installed clients receive, submit and recover the same contract. Desired behavior connects the intended target change, current workflow state, valid client actions, actual verification and authoritative server transitions.

This document records the next initiative. It does not reopen the completed semantic-gate implementation, authorize a paid benchmark batch, change installed plugins, or authorize global policy promotion. Publication scope must be bound to this initiative before delivery; preserve existing authorization within its actual scope.

## Delivered foundation

| State                                        | Receipt                                                                               | Reuse boundary                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Merged semantic schema and acceptance kernel | PR #474; squash 2b8805aa3b2466b5e264ac900b6b67169d72a4a9                              | Typed criteria, bounded values, evidence and acceptance rules                                                    |
| Merged private archive/calibration/replay    | PR #475; squash 9644ba2712f02fb8c1b1c176403ef28a1682eba1                              | Durable evidence and independent suite revisions                                                                 |
| Merged runtime activation                    | PR #476; squash 6889b0154e44eebd38cb1f622089c9650769aa1b                              | Frozen definitions, captured targets, attempts, derived verdicts and history                                     |
| Global recovery guidance applied locally     | Global repository commit a7273b5                                                      | Activate workers explicitly; retain accepted checks; avoid repeated review chains; respect runtime writer leases |
| Recorded five-case MCP demo                  | Private local demo results/receipts/snapshots; 40 sealed files verified during review | STDIO execution evidence; prepared texts and external model judgments; no native plugin/hook proof               |

The native calibration pilot remains scoped evidence: 11 calls, no observed structured-versus-prose quality advantage on the small suite, disposition INCONCLUSIVE and automatic promotion disabled. It is not the baseline for a new native-client comparison.

## Settled decisions

- **D1 — Authority:** prompt_engine owns workflow progression; resource_manager owns resources. Hooks project and reinforce valid server interactions. The optional runner observes and checks outcomes; it does not introduce another workflow state machine.
- **D2 — Honest failure:** a valid structured FAIL must reach the server so its ledger, retry budget and next attempt can be updated. Hook guidance may explain the failure without suppressing that submission.
- **D3 — State-aware guidance:** reminders distinguish capture, semantic report submission, retry exhaustion and other holds. Ordinary legacy gates retain supported legacy behavior; required semantic criteria need the structured report.
- **D4 — Refusal:** a refused report is a distinct interaction outcome. Preserve current pending state unless authoritative evidence establishes resolution; recapture/review against current bindings where required.
- **D5 — Target proof:** declare the goal, target workspace/artifact and intended change before the run. Code tasks need actual changed-file and verification evidence tied to the relevant revision. Step-output citations alone establish a narrower claim. Unsupported artifact capture must remain explicit.
- **D6 — Independent checking:** a testing prompt can drive ordinary product use, while frozen expectations and final acceptance checks remain outside the workflow being tested. Keep private labels and holdouts out of actor/reviewer context.
- **D7 — Reuse and isolation:** extend claims-conformance scenarios and evaluations contracts/archive. Keep evaluation execution opt-in and outside default MCP startup. Preserve shared DBs, dependency symlinks and installed configurations.
- **D8 — Reporting and cadence:** separate product defects, harness defects, incomplete/inconclusive execution and verified success. Keep correctness, client behavior, target quality, latency and cost separate; unavailable billing is unknown. Run affected checks locally and required full tests once at PR CI.

- **D9 — Run termination (owner ruling 2026-10-12):** `prompt_engine(chain_id:"...", gate_action:"abort")` stops the whole named run across active, paused, ordinary and detached-review states, without retry exhaustion or node addressing. Remove the public `cancel` parameter, its routing/branches/types, generated metadata/vocabulary, maintained callers, tests and current documentation in the same coherent delivery. No alias, fallback, flag or later-removal row. Keep the existing scoped durable cancellation store and persisted `cancelled` status; this is an API/action consolidation, not a data/status migration. Reject retired `cancel:true` and `cancel:false` through ordinary undeclared-parameter validation without changing run state. Source and native verification stay distinct.

- **D10 — Conversation pause (owner ruling 2026-10-12):** add `gate_action:"pause"` and explicit `gate_action:"resume"` for an orthogonal, durable conversation hold. Retain the workflow, current node/step, captured output, pending review/unknown/shell holds and retry identities. Pause/resume do not capture, grade, advance, skip or complete work. While paused, hooks allow the model to finish its turn and talk to the user, preserve recoverable tracking, and show a concise pause/resume reminder instead of mandatory continuation/verdict demands. Resume restores the original pending action; it clears only the conversation hold, preserving blocking-unknown resume semantics. Abort stays terminal and public cancel is completely removed. Independent host/verification policy remains scoped and enforced. See the bounded [pause subplan](workflow-conversation-pause-2026-10-12.md).

- **D11 — Breaking calls and state recovery (owner clarification 2026-10-12):** rejection of retired calls and loss of genuinely incompatible transient runs during a breaking upgrade are acceptable; do not keep cancel aliases solely to preserve old clients. This is not permission to erase the shared state.db or durable resource history. Current abort/pause work presumes no DDL bump: retain compatible run state and verify old-record loading; a renamed input alone does not require flushing it. Reuse existing table contracts and SqliteEngine migration ownership: durable data preserved/migrated, derived projections rebuilt, ephemeral state reset only under the declared supported transition or precisely scoped clear. Automatic selection is deterministic compatibility/retention policy, not model judgment. Any real corrupt/shared-runtime recovery first coordinates writers and preserves a coherent backup; do not treat code-level action admission as a storage failure. Client refresh/reconnect must join actual server/hook versions; existing MCP processes do not automatically reload installed code. No live DB/cache reset is performed or authorized as part of this note.

- **D12 — Object-only verdict parameter (owner handoff 2026-10-13):** draft PR #488 owns server string-verdict retirement and lands back to back with complete cancel removal in the same 6.0.0 release train. Our coherent abort slice also updates hook parameter instructions/examples and parsing to the structured object (`overall`, `rationale`, applicable `per_gate`/`reminders` and semantic `evaluation`). Honest object FAIL must reach server adjudication; no blanket FAIL denial. Retire string-parameter parser branches without an alias. Preserve distinct text channels: ralph_subagent_contract.py's GATE_REVIEW line, exported-skill Stop hook and delegation trailer. Hook source controls and combined-server/native proof remain separate; a draft PR's reported checks do not establish this worktree's combined runtime. No package/tag/release-PR publication follows from identifying the release train.

## Evidence and limits

| ID  | Finding                                                                                                                                   | Evidence boundary / closure condition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Old report mismatch was deliberately injected after FAIL renewed the attempt and revised output was captured                              | Raw demo calls 08-10 and before/after snapshots; expected protection, not accidental client drift                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F2  | Checkout gate-enforce.py denies the actual valid FAIL request                                                                             | Original source-hook probe with demo08 retained. Actual2026-10-13 native PreToolUse blocks honest structured FAIL for active strategic chain before server: Gate FAIL / review failing criteria. /tmp/workflow-implementation-20261013/native-pretool-fail-20261013.json; exact hook executable/source provenance not joined, installed repair unclaimed                                                                                                                                                                                                                                                                                                                                                                                                          |
| F3  | Recovery reminders prescribe a plain PASS/FAIL string for pending gates                                                                   | hooks/lib/session_state.py format_chain_reminder source; no semantic review-type projection found in the examined hook consumers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F4  | Post-tool fallback can clear tracked state when verdict response has no parsed markers                                                    | Source inspection of hooks/post-prompt-engine.py; prove actual error-event delivery and refusal preservation per selected client before claiming native reproduction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F5  | Expected stale refusal stopped the initial demo driver                                                                                    | Recovery notes and raw refusal receipt; immediate after-state snapshot absent, so retry preservation remains unverified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| F6  | Framework disable was in-memory and restart restored framework guidance                                                                   | Framework-disable response, later CAGEERF response and advisory header warnings; experimental configuration changed across runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F7  | Corrected PASS advanced to observation in a fresh run                                                                                     | Different session UUIDs and completed handoff ledger; no continuous repair loop or completed observation step demonstrated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F8  | The page serves recorded evidence                                                                                                         | Static HTTP GET logs; browser case selection does not invoke MCP or a reviewer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F9  | Required semantic capture-first is excluded by tracked pending-gate admission                                                             | Source-confirmed server user_response-only instruction versus generated resolution set; native occurrence unmeasured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F10 | Historical safe metadata probe lacked tomllib                                                                                             | Harness failure before config access; now safe allowlisted metadata parsed with existing smol-toml, without installs/auth reads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F15 | NEW stop: early abort bypasses a reachable prior cancelled terminal execution-history event                                               | Prior origin/main ordinary exhausted review abort can reach stage21 cancelled writer; new early handler returns before pipeline. Child0.5 source trace, no runtime reproduction; existing-owner event preservation/recut required before flag deletion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F13 | NEW stop: gates-disabled surface omits/rejects gate_action, which would leave no stop action after core cancel removal                    | Source-inspected buildCoreFields/buildWidestSchema split and router GATE_PARAMETERS_UNAVAILABLE; future migration contract blocked, no source edits/native reproduction. Row0.3 owns repair                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F14 | Gemini adapter directly denies verdict-less pending calls and independently tracks results                                                | Subplanner read-only downstream source inventory; source-only, no native reproduction or external edits. Q6 owns required port scope before parity/publication                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F12 | General conversation pause lacks a durable state and matching Stop/reminder contract                                                      | Source-observed: unknown pause is specialized; residual serialization is explicit; ralph-stop blocks on recoverable chain presence. D10 adds the capability rather than assuming installed-client behavior; native proof remains OPEN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F11 | Source mismatch: exhausted semantic renderer advertises abort for detached reviews, but processor/lifecycle refuse it                     | Source-confirmed; owner settled desired behavior as universal run-level abort with full cancel parameter removal (D9). Tier0 remains OPEN until source controls pass; native/runtime reproduction unclaimed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F16 | Critical probe isolation stop: MCP fixture creation wrote four files under candidate server/resources despite declared isolated roots     | Cause/source31controls/3mutationfailures accepted; actual2026-10-13 STDIO create/inspect/scaffold proves first writes into absent type dirs under exact private base, guardempty. HTTP/fullmatrix closure remains open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F17 | Abort persisted cancelled but the next node materialized previously absent DB render/working fields, breaking strict snapshot comparison  | Prior issued/rendered node flushed at cancellation plus normal SQL updated_at rewrite; pointer/order/capture unchanged. Corrected outside oracle preparation accepts archived positive and rejects11 deliberate corruptions; actual wire reprobe still OPEN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F20 | SourceHTTP confirmed wrong request continuity consumes handoff token before late pipeline refusal                                         | Targeted42sourcebound diagnostic:2correct-scope positivesPASS,3wrong-scope negativesFAIL; actual tokens cleared before NoStoredBlueprint and same-token correct-scope retry refused. SQLlaunch namespace/PID/requestcontinuity separatelybound. ConditionalR7 cause-bound repair now required before fullmatrix; no URI cause inferred                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F21 | SourceHTTP session URI namespace/encoding gap confirmed after corrected envelope                                                          | 12actual reads:4ordinaryraw/advertisedpositives returnedexact#1/#2andSID; qualifiedraw/advertised4failmatching-32602; encodedroot/qualified4reachlookupwithliteralpercentescapesandfail-32603. AllDBsnapshotsunchanged. URIwriter mustencodecomponent, URIreader decodeonce/validatefullchainID; rawstore/toolidentity unchanged. Rootcauseboundrepair nowapproved, no compat alias or doubleddecode                                                                                                                                                                                                                                                                                                                                                              |
| F22 | Real-store stale explicit run resolves a bare legacy run                                                                                  | R7 initial57controls found chain-plan/table#99->bare row; final exact-only scoped lookup removes10obsolete fallback lines.9affected lookup controlsPASS, actual restored historical fallback1staleFAIL, exact restorationPASS. Barelegacy/#0/#01 identities retained; no latest alias or migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F23 | Actual STDIO documented JSON command args lose greater-than characters while equivalent literal quoted args preserve them                 | Frozen405line source driver019/020 root markers select same prompt; literal originalArgs/promptArgs/body exact, JSON rawArgs exact but originalArgs/promptArgs/body strip both greater-than characters from arrow tokens. Unique sessions/scopes/actor bound in matrixexecution independent-proof; source cause unknown, dependent work stopped.36file sealSHA2c08c343d862223c4ccf1de48c9039d2718ca59d38ddfd6764ca65227c86423a                                                                                                                                                                                                                                                                                                                                    |
| F24 | Actual gates-off blockingunknown resume clears hold then rerenders an already completedroot while inserted investigation remains unissued | FocusedSTDIO063 root responded/completed, pointerroot/syntheticreviewroot;064 pointerroot, milestone completed->working/completed_atsticky, ROOT Progress1/3, invnode no renderrecord. One capturedrootartifact preserved. Source cause repaired/accepted: source124, final16/full74 PASS, TS0/newlint0/guard0, five omissionfaults3/3/5/6/1FAIL/exactsixrestore; receipt052637888fad073b4652d06cd28a4c9ccdebc37dcb91e119a384bcdb1299d11b. Fresh STDIO strongpause/resumePASS; full lifecycle/HTTP remains held on F25. Immutable82filesealc0a6479269725bf9d204d7fe9f45638b9146d24f03076c0d486d20e289427150;60bindings/clean teardown,HTTP/append unrun                                                                                                           |
| F25 | Accepted qualified append persists five nodes but formats stale Progress2/3                                                               | Actual freshSTDIO065 isErrorfalse, DB3->5/currentinv/tailqualifiedargs+origin/acceptedAt2 correct/capturestable;064 correctly issuedinvestigation afterretaining completedroot. SID94a703c1-601d-481c-a04a-58659861aeff chain-wire_namespace#4. 83file sealaddaa933d8fb7ae4277ed39c5614539045ccb897cc5b12b8a1067812edb72ab0; cleanup/62bindings/driver/HEAD unchanged. Source owner cause accepted via cardf9ef21ec3d817431a35a9ae73d7d12352221c70c308e559cacf939613cbdd2e5; existing16refresh omitted on applied remainder, cached3 survives completed-prior capture earlyreturn. Three-path/1production/2NEW/doc2 source repair accepted; receipt9a4a2e545a4597bbc7caf2c8b5b3e21addf63d349871a70117877e0ebb33341c; HTTP/resolve/tail unrun,2/5 oracle unchanged |
| F26 | Before-claim bare-token refusal diagnostic differs from driver expectation; classification pending                                        | FullSTDIOreceiver003 exactfulltoken chain-wire_namespace/child#5 ->isErrortrue ParseError; fullDB/oldowner/token/capture/review unchanged/no adoption observed. SID01fd864b-dc40-496a-b86d-7512cc76099b, donorPID255921/receiver255949;92RPC/5stages;117file seald8e8f581bf65ed99be61a2d5741a6bdc6389a1c2db25dace3295939acfc09456; allcleanup/62tuple unchanged. Contract classification accepted: bare withoutnonblankresponse/verdict alwaysparse-refuses (includingowned), so003 NOTownershipguardproof. Source0; explicitchain_id no-answer caller correction authorized with unchangeddiagnostic+fullDB invariants; no replayyet; remainingfullmatrix/native unrun                                                                                           |

## Queued diagnostic: namespaced identifiers (2026-10-13)

Owner accepted the proposal/contract and authorized delegated fixes2026-10-13. [Namespaced identifier subplan](workflow-namespaced-identifiers-2026-10-13.md) owns F18/NS1 returned slash-ID admission and F19/NS2 command/catalog mismatch. Subplanner accepts dependency-driven source rows; root owns F16/F17, guarded runtime and integrated publication. R1/R2/R3/R6 source controls accepted; R4/R5/R7 and wire/installed proof remain distinct. F20/F21 are new static risks requiring scoped red proof before dependent repair. Origin root planning5/5 remains installed positive; the cleared namespace ID remains historical only. No CloudySky/installed/global/external-repository mutation.

## Existing systems audit

| Existing owner / surface                                                                               | Intended reuse                                                                                 |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| hooks/gate-enforce.py and hooks/tests/test_gate_enforce_verdict.py                                     | Honest-report submission and pending-resolution enforcement controls                           |
| hooks/post-prompt-engine.py and hooks/tests/test_post_prompt_engine_clearing.py                        | Pending-state preservation and explicit completion boundaries                                  |
| hooks/lib/session_state.py, hooks/lib/db_reader.py, hooks/prompt-suggest.py, hooks/compact-recovery.py | State-aware reminder/recovery projections; enumerate all consumers before changing a field     |
| server/src/engine/execution/formatting/response-assembler.ts and existing review-render decisions      | Authoritative client-facing state and next-action projection where required                    |
| Generated resolution verbs / MCP contracts                                                             | Shared allowed-resolution vocabulary; never hand-copy another list                             |
| server/tests/e2e/claims-conformance.test.ts and conformance corpus                                     | Real-server request/response scenarios and setup-error versus expected-refusal separation      |
| evaluations/core/contracts.ts and archive.ts                                                           | Frozen identities, records, evidence references and replay                                     |
| evaluations/gates/*                                                                                    | Existing semantic specialization; preserve private suites and canonical schemas                |
| Existing benchmark-authoring backlog                                                                   | Reconcile implemented foundations and retain wider authoring/ingestion work outside this slice |

The older benchmark backlog describes some archive/package foundations as proposed; those passages are historical planning evidence and must be reconciled before its E-rows are activated. Do not execute the whole backlog as this slice.

## Proposed hook alignment changes (2026-10-12)

No hook source changes are performed by this scope note. Current source remains at the delivered semantic implementation. Exact added fields are not selected until writer/reader/view tracing finishes.

| Order | Files / owner                                                                                                 | Proposed change                                                                                                                                                                                                        | Required behavioral check                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | hooks/lib/session_state.py; hooks/lib/db_reader.py; existing server review-render/state projections if needed | Preserve the authoritative review phase and required submission action through response parsing and both DB refresh paths. Use one shared projection for consumers; do not independently reimplement server acceptance | Capture-first, report, exhausted, unavailable, ordinary legacy and blocking-interrupt states project their own valid actions; unknown state stays explicit |
| 2     | hooks/gate-enforce.py                                                                                         | Remove verdict-content denial that suppresses an honest FAIL before the server can record it. Keep genuine host-level policy separate from semantic acceptance                                                         | Valid FAIL reaches server, records a verdict and renews/exhausts under server policy; contradictory client PASS still fails in the server                  |
| 3     | hooks/gate-enforce.py and generated contract vocabulary consumer                                              | Make pending-review admission phase-aware: allow capture/recapture when the server requests user_response alone, require report submission in report phase, preserve exhausted/interrupt exit semantics                | A tracked semantic review admits capture-first; unrelated holds do not gain a universal user_response exit; generated artifacts are never hand-edited      |
| 4     | hooks/post-prompt-engine.py; shared state refresh                                                             | Preserve tracking on refused/error results or missing markers; update/clear state from authoritative response/state and explicit terminal evidence                                                                     | Stale refusal retains correct pending state; confirmed completion/cancellation clears it; delivery of the final step alone does not clear it               |
| 5     | hooks/lib/session_state.py; hooks/prompt-suggest.py; hooks/compact-recovery.py; hooks/post-prompt-engine.py   | Replace generic Submit gate_verdict / bare PASS                                                                                                                                                                        | FAIL reminders with the current shared action projection                                                                                                   | Client sees capture, structured report, retry/skip/abort, unavailable-authority or interrupt instructions appropriate to current state; ordinary legacy formats remain supported |
| 6     | hooks/ralph-stop.py and shared projection                                                                     | Render a phase-appropriate Stop reason rather than prescribing a legacy verdict for every pending gate. Do not duplicate another local action table                                                                    | Stop for semantic capture/report and blocking interrupt names the valid action; native completion remains distinct from last-step delivery                 |
| 7     | hooks/hooks.json and downstream host adapters, only where measured necessary                                  | Carry actual result/error fields and identifiers to the shared policy; align matchers and event normalization with the selected native client                                                                          | Joined native trace proves hook fired on the intended event/tool and server received the admitted call. Do not register an assumed failure event           |
| 8     | Owning hook tests, hooks/README.md, client-capability documentation and server conformance cases              | Replace tests/docs that encode outdated denials; add meaningful capture/refusal/phase controls and source/client verification labels                                                                                   | Source controls observe the changed decisions; one pinned installed-client run verifies delivery, state and completion independently                       |

Repair these existing boundaries in place. Do not weaken the server's captured-target/report binding, mint retry identities in hooks, copy semantic grade logic into hooks, or add another workflow-state authority. The tomllib failure is a separate evaluation-preflight portability repair, not a hook behavior change.

## Consequence tracing before contract freeze

No new field or schema is selected by this planning note. Row 1.1 must enumerate the existing state and resolve the minimum projection required:

| Concern                                  | Writer                                                       | Readers / decisions                                                                  | View and checks                                                            |
| ---------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Review kind, phase and valid next action | Existing server review lifecycle / capture owners            | Enforcement, prompt suggestion, post-tool tracking, compact recovery, client adapter | Response renderer, generated verb vocabulary, state-aware hook controls    |
| Refusal versus completion                | Existing server result projection                            | Native host event adapter and post-tool tracker                                      | Actual error/result payloads and before/after state controls               |
| Attempt and captured-target identity     | Existing semantic context/capture owners                     | Actor/reviewer report assembly and server acceptance                                 | Frozen binding, target digest, persisted verdict and stale-report controls |
| Trial outcome and target proof           | External runner/collector; independent checker writes grades | Replay and report projection                                                         | Existing archive references plus native trace/artifact evidence            |

## Implementation table (2026-10-12)

All rows remain open; planning does not complete implementation. Numeric bounds are dispatch caps, not permission to omit necessary consumers. Split a row before widening it. Recutting replaces unfinished broad rows only; notes retain the old-to-new mapping.

### Tier 0: Run-level abort and complete cancel removal

The owner resolved the policy fork on 2026-10-12. Replace the earlier renderer-only repair with the bounded [abort/removal subplan](workflow-run-abort-removal-2026-10-12.md). Its separate rows enumerate boundary routing, public/generated contracts, review decisions, rendering, hooks, callers/docs and real-server closure. A kind-aware wording patch alone does not satisfy the ruling. Deliver the migration coherently; intermediate row artifacts are not publishable compatibility states.

| ID  | Status                                                                                                                                                      | Files / responsibility                                                                                                                                                   | Change                                                                                                                                                                                                                                                       | Numeric bound                                                                                          | Depends | Own check / falsifier                                                                                                                                                                                                                                            | Reuse justification                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ☐ (as of 2026-10-12; flips when every abort/removal subplan row has an accepted receipt and the removal sweep closes)                                       | workflow-run-abort-removal-2026-10-12.md; named existing termination/contract/review/render/hook owners and paired tests                                                 | Accept run-level gate_action abort across all nonterminal run states; remove public cancel and all maintained consumers atomically                                                                                                                           | 20 bounded child rows including latest-main integration/caller cleanup; exact caps in child plan       | 0.3     | Durable scoped abort plus prior terminal history event across states/restart, resume refusal, idempotence, STDIO/HTTP parity; retired cancel rejected with no mutation; zero remaining executable/public cancel-parameter consumers                              | Keep existing cancelChain and cancelled state; replace API entry/projections rather than adding an authority or compatibility layer |
| 0.2 | ☐ (as of 2026-10-12; flips when all conversation-pause child source receipts and scoped hook controls are accepted)                                         | workflow-conversation-pause-2026-10-12.md; existing session/control/projection/hook owners and paired controls                                                           | Add durable pause/explicit resume preserving the same active step and holds; align admission/tracking/reminders/recovery/Stop in one coherent capability                                                                                                     | 8 bounded child rows; exact manifests before source dispatch                                           | 0.1     | Same-run before/pause/discussion/resume snapshots; no advancement or completion; cold load; scoped Stop allowed; resumed obligations restored; independent verification retained                                                                                 | Existing store, residual persistence and hook projections; no synthetic gate or second scheduler                                    |
| 0.3 | ✓ (2026-10-12; accepted path1-core-availability/receipt.md;122 focused controls pass, both old-restriction mutations fail; native/lifecycle proof separate) | server/src/mcp/tools/schemas/prompt-engine.schema.ts; server/src/mcp/tools/index.ts; server/src/mcp/tools/shared/undeclared-parameters.ts; paired schema/router controls | Implement owner-selected path1: core gate_action with existing supported enum; gates-off named refusal of retry/skip, independent admission of run/unknown controls before removing core cancel; review-only actions retain their feature/phase restrictions | <=3 source files plus <=2 paired test files, <=220 changed lines; recut on exact manifest              | —       | Fresh and restored gates-off runs retain tools/list and tools/call access to run abort and later conversation pause/resume; database clearing is not the fix; review-only actions remain unavailable; old unavailable-map/schema branch fails meaningful control | Extend existing schema/router undeclared-key owners; no new control tool or compatibility alias                                     |
| 0.4 | ✓ (2026-10-12; integration-checkpoint/receipt.md;171/171 affected controls, generator/build/HTTP schema pass atcf619a61)                                    | Explicit overlap manifest from origin/main; schema/index/executor/undeclared tests/contracts and generated outputs; no edits to the other planner's lane                 | Checkpoint our exact files, merge latest main, delegate conflict reconciliation preserving R11.2/fixes and path1/abort removal; regenerate from canonical resolved sources                                                                                   | <=8 handwritten conflict paths plus fixed generated manifest; recut if measured conflicts exceed bound | 0.3     | No conflict markers; overlapping selected controls pass after named invalidation; main fixes retained; schema <=18000; no duplicated full suite                                                                                                                  | Integration steering from owner handoff, not a new implementation failure; planner moves HEAD, worker resolves source               |

### Tier 1: Server/hook contract alignment

Entry: accept both Tier0 abort/removal and conversation-pause source closures, then row1.1's full contract inventory before dependent producer edits. Reuse accepted Tier0 pause/hook receipts; do not repeat them as Tier1 work. Abort exclusively ends a run; pause preserves it.

| ID  | Status                                                                | Files / responsibility                                                                                                                                      | Change                                                                                                                                   | Numeric bound                  | Depends            | Own check / falsifier                                                                                                                                                                             | Reuse justification                                                                               |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1.1 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | docs/architecture/overview.md; docs/guides/gates.md; retained inventory                                                                                     | Finish writer/reader/view trace; planner rules minimal versioned action/result projection and compatibility before source edits.         | <=2 docs, <=200 changed lines  | —                  | Named producer/consumer/decision/view for each selected field; correct capture/report/exhausted/interrupt/conversation-pause/refusal/terminal actions.                                            | Existing contract owners; no new coordinator.                                                     |
| 1.2 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | semantic-review-context.ts; modules/chains/manager.ts; response-assembler.ts; focused owning projection test selected by 1.1                                | Extend existing derived review/run projection for hooks and response consumers; preserve canonical capture/grade behavior.               | <=4 files, <=350 changed lines | 1.1                | Both output/DB routes expose equivalent authoritative action; omit producer field/control must fail; no DDL presumed.                                                                             | One derived interface published through existing owners; fourth file is the paired boundary test. |
| 1.3 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | hooks/lib/session_state.py; hooks/lib/db_reader.py; hooks/tests/test_db_reader.py                                                                           | Retain the frozen action/phase and identities through response parsing and both DB refresh routes; shared consumer projection.           | <=3 files, <=250 changed lines | 1.2                | Capture/report/exhausted/unavailable/interrupt/conversation-pause/legacy round trips; field-drop control fails.                                                                                   | Extend current ChainState and reader paths; no parallel hook store.                               |
| 1.4 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | hooks/gate-enforce.py; hooks/tests/test_gate_enforce_verdict.py; hooks/README.md                                                                            | Admit honest FAIL and phase-valid capture; retain actual host policy and state-specific exits, including accepted pause/resume behavior. | <=3 files, <=220 changed lines | 1.3                | FAIL reaches server; capture-first admitted under tracked review; report/exhausted/interrupt cases; restore old-denial branches makes distinct controls fail.                                     | Server decides acceptance/retries; broad user_response escape rejected.                           |
| 1.5 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | hooks/post-prompt-engine.py; hooks/tests/test_post_prompt_engine_clearing.py; hooks/README.md                                                               | Preserve pending state on refused/error/missing-marker results; clear only on authoritative terminal evidence.                           | <=3 files, <=200 changed lines | 1.3                | Refusal keeps state; authoritative completion/abort clears; last-step delivery stays active; old clearing branch fails negative control.                                                          | Upgrade existing tracker, no duplicated lifecycle.                                                |
| 1.6 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | hooks/prompt-suggest.py; hooks/compact-recovery.py; hooks/tests/test_session_tracker.py                                                                     | Consume shared phase-aware instructions for prompt injection and recovery; remove generic conflicting CTAs.                              | <=3 files, <=180 changed lines | 1.3                | Actual directives request capture/report/action per executable state; paused reminder yields to conversation; ordinary/interrupt behavior retained; reuse accepted pause receipts.                | Existing shared formatting path; no per-consumer action tables.                                   |
| 1.7 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | hooks/ralph-stop.py; hooks/tests/test_ralph_stop.py; hooks/README.md                                                                                        | Use shared action projection for held runs and stop guidance; preserve explicit completion distinction.                                  | <=3 files, <=180 changed lines | 1.3                | Semantic/interrupt Stop messages; conversation pause permits Stop without clearing the run; other verification remains enforced; generic bare-PASS mutation fails; reuse accepted pause receipts. | Existing Stop consumer now source-confirmed as contradictory.                                     |
| 1.8 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | server/tests/e2e/conformance/workflow-client-contract.yaml (new); hooks/tests/test_gate_enforce_verdict.py; hooks/tests/test_post_prompt_engine_clearing.py | Add real-server transition and hook-policy controls using existing drivers; classify setup errors independently.                         | <=3 files, <=260 changed lines | 1.4, 1.5, 1.6, 1.7 | Matched requests/state for valid FAIL/capture/stale/quote/contradiction; named reason checks and terminal evidence.                                                                               | New scenario corpus file groups this contract; existing conformance engine reused.                |

Tier gate: planner accepts artifacts and documented concerns once; retains passing own-check receipts. Required repository checks and full suite are owned by the reviewed PR boundary, not repeated per row.

### Tier 2: Pinned native client and independent target proof

Entry: Tier 1 accepted source controls and a reviewed coherent candidate build. No cross-tier IDs in Depends.

| ID  | Status                                                                | Files / responsibility                                                                                                           | Change                                                                                                                                   | Numeric bound                                               | Depends | Own check / falsifier                                                                                                              | Reuse justification                                                                                   |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 2.1 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | scripts/codex-dev-plugin.mjs; scripts/codex-server.mjs; existing public collector/configure interfaces                           | Safely complete metadata/capability preflight using supported available tooling; select isolated launch/config and collector reuse.      | <=3 existing-interface edits if needed, <=150 changed lines | —       | No auth read/config mutation; current version/features/install/source/runtime agreement measured; explain unavailable fields.      | Repair tomllib assumption in the caller; no global collector fork or added parser dependency assumed. |
| 2.2 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | scripts/codex-dev-plugin.mjs; hooks/tests/test_codex_client_seams.py; selected downstream adapter/manifest if measured necessary | Create isolated reviewed candidate installation and normalize actual relevant events/tool aliases; record source/stage/install identity. | <=3 files, <=200 changed lines                              | 2.1     | Actual hook activation/error-result event and MCP delivery joined; feature flags alone insufficient; never register assumed event. | Existing staging adapters; downstream repo custody explicit before any cross-repo edit.               |
| 2.3 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | existing native collector adapter; isolated workflow fixture/scenario                                                            | One native repair workflow with stale-refusal control, honest FAIL, revised capture/report, PASS and terminal completion.                | <=3 fixture/adapter files, <=220 changed lines              | 2.2     | Before/after refusal state and counters; actual installed events; server ledger; completed target; no same-run proof fabricated.   | First native scenario; prepared initial deficient fixture declared as development control.            |
| 2.4 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | isolated small-code fixture; external checker; existing collector adapter                                                        | Second native scenario makes a bounded code change verified by real tests and a planted failing alternative.                             | <=3 fixture/checker files, <=220 changed lines              | 2.2     | Initial defect observed; expected change/test output/revision match; checker rejects plausible bad artifact.                       | Adds target proof; no unsupported server artifact capture invented.                                   |

Tier gate: planner accepts artifacts and documented concerns once; retains passing own-check receipts. Required repository checks and full suite are owned by the reviewed PR boundary, not repeated per row.

### Tier 3: Optional reusable evaluation and diagnosis

Entry: Tier 2 native/target evidence accepted or explicitly limited; do not claim success for unavailable proof.

| ID  | Status                                                                | Files / responsibility                                                                                                           | Change                                                                                                                                                 | Numeric bound                      | Depends | Own check / falsifier                                                                                                                            | Reuse justification                                                                                                            |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 3.1 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | evaluations/workflows/contracts.ts (new); evaluations/workflows/runner.ts (new); evaluations/tests/workflow-runner.test.ts (new) | Specialize existing archive/trial identities for frozen workflow scenarios, external adapters/checks and distinct incomplete/harness/product outcomes. | <=3 files, <=400 lines total       | —       | Expected refusal versus harness failure; deadline/cancel/partial/no-artifact controls; no circular self-grade.                                   | Existing calibration callback only grades semantic reports; workflow execution/target checking is a separate missing boundary. |
| 3.2 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | evaluations/workflows/report.ts (new); evaluations/tests/workflow-report.test.ts (new); evaluations/README.md                    | Replay retained workflow/native/target evidence and project separate source/client/quality/time/cost measures.                                         | <=3 files, <=280 changed lines     | 3.1     | Archive survives disposable runtime removal; missing/corrupt evidence refuses proof; incomplete billing stays unknown.                           | Reuse canonical archive; new pure workflow-specific report, no second archive.                                                 |
| 3.3 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | problem register; frozen source/native/harness receipts                                                                          | Delegate one read-only diagnosis grouping symptoms by proven cause/boundary and retaining explicit hypotheses.                                         | <=1 report, <=180 lines            | 3.2     | Every issue has evidence level, cause/hypothesis, owner/falsifier/regression scope; no unmeasured native claim.                                  | One end-of-evidence diagnostic handoff; no duplicate reviewer chain or benchmark reruns.                                       |
| 3.4 | ☐ (as of 2026-10-12; flips when stated own-check receipt is accepted) | MCP-authored testing prompt/chain; evaluations/README.md; hooks/README.md                                                        | Guide ordinary client use through the frozen workflow scenarios while independent checks decide success; document setup and evidence limits.           | <=3 artifacts, <=250 changed lines | 3.3     | Build and final third bounded native live drive through the authored prompt, joined target proof and replay; no default-server dependency added. | Prompt authored only via MCP; retain existing catalog/workflow authority.                                                      |

Tier gate: planner accepts artifacts and documented concerns once; retains passing own-check receipts. Required repository checks and full suite are owned by the reviewed PR boundary, not repeated per row.

### Execution dispatch

Planner alone rules open questions, accepts handoffs and owns HEAD/PR boundary. Production goes to strategic workers. Default worker cap 2, source-file overlap sequences; use repo bootstrap for worktree isolation. Dispatch model/effort follows actual Claude named profiles, not unverified advisory hints.

| Row | Tier   | Effort | Failure shape                                                        | branch_mode                                                                |
| --- | ------ | ------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 0.1 | opus   | high   | run abort denied, nondurable or retired cancel still accepted        | own-branch; shared-tree only by explicit planner ruling                    |
| 0.2 | opus   | high   | pause loses active step, bypasses review or hook forces continuation | own-branch; shared-tree only by explicit planner ruling                    |
| 0.3 | opus   | high   | gates-disabled surface hides or refuses required run controls        | own-branch; shared-tree only by explicit planner ruling                    |
| 1.1 | opus   | high   | wrong phase/authority or lost pending state                          | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 1.2 | opus   | high   | wrong phase/authority or lost pending state                          | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 1.3 | opus   | high   | wrong phase/authority or lost pending state                          | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 1.4 | opus   | high   | wrong phase/authority or lost pending state                          | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 1.5 | opus   | high   | wrong phase/authority or lost pending state                          | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 1.6 | opus   | high   | wrong phase/authority or lost pending state                          | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 1.7 | opus   | high   | wrong phase/authority or lost pending state                          | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 1.8 | opus   | high   | wrong phase/authority or lost pending state                          | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 2.1 | opus   | high   | unproven native execution or target outcome                          | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 2.2 | opus   | high   | unproven native execution or target outcome                          | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 2.3 | opus   | high   | unproven native execution or target outcome                          | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 2.4 | opus   | high   | unproven native execution or target outcome                          | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 3.1 | opus   | high   | circular grading or incomplete replay                                | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 3.2 | opus   | high   | circular grading or incomplete replay                                | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 3.3 | opus   | high   | conflated source/client evidence                                     | own-branch; shared-tree only if planner explicitly declares disjoint scope |
| 3.4 | sonnet | medium | circular grading or incomplete replay                                | own-branch; shared-tree only if planner explicitly declares disjoint scope |

Final tier verification includes a build plus the actual third native client/testing-prompt live drive, using the remaining scenario budget. No extra native runs are added merely to repeat accepted proof.

### New file justifications

- The new conformance YAML groups this workflow's claim cases under the existing driver; it does not create a test executor.
- evaluations/workflows/contracts.ts and runner.ts cover native workflow/target execution, which semantic calibration callbacks do not assess. Reuse existing trial identity/archive and caller-supplied client adapters; no provider SDK or second workflow state machine.
- evaluations/workflows/report.ts is a pure workflow-evidence projection; use the existing archive for immutable records and closure checks.
- The paired tests under evaluations/tests/ exercise distinct workflow execution/report boundaries and fit the existing core test glob. No new default installation/workspace dependency is assumed.
- A testing prompt is a server-owned MCP-authored resource. It guides client work while external frozen checks decide acceptance; expected labels and holdouts are excluded from actor context.

## Completion criteria

| Criterion                                                         | Required evidence                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run abort works and the retired cancel parameter is fully removed | Tier0 source receipts: durable scoped termination, restart/resume/idempotence controls, both transports, retired-parameter no-mutation refusal and complete consumer sweep; installed-client admission/tracking verified separately in Tier2 |
| Conversational pause preserves work and permits discussion        | Tier0 same-run state/cold-load and hook Stop/reminder controls; parent Tier2 actual discussion/Stop/resume event evidence; no gate bypass or other-verification exemption                                                                    |
| Valid failed reviews reach the authoritative server               | Source-hook control plus actual native tool delivery and persisted FAIL/retry transition                                                                                                                                                     |
| Client instructions match current review phase                    | State-aware reminder examples and complete enumerated projection tests                                                                                                                                                                       |
| Refusal does not masquerade as completion                         | Selected host error-event trace and immediate before/after pending-state snapshots                                                                                                                                                           |
| Workflow reaches real terminal completion                         | Final work artifact/checker result, terminal native trace and server completion state; a delivered last-step prompt is insufficient                                                                                                          |
| Target acceptance is independent                                  | Frozen external checks and at least one plausible failing artifact/control                                                                                                                                                                   |
| Evidence survives disposable runtime cleanup                      | Existing immutable archive closure and replay over the actual run records                                                                                                                                                                    |
| Scope and validation remain bounded                               | Row-own checks locally; mandatory push checks and full CI at reviewed PR boundary; no repeat of accepted unrelated proofs                                                                                                                    |

## Validation strategy

| Surface                                              | Test type and location                                                                                                  | Required observation                                                                                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared state, admission, tracker and reminder policy | Source/integration controls in the named hooks/tests files                                                              | Real source consumes seeded state/result input; mock host I/O only. Required actions admitted, incorrect phase actions handled, refusals retained and terminal clearing explicit                               |
| Abort and complete API removal                       | Abort/removal subplan source controls and scoped real-server transport probes                                           | Run-level abort admitted without exhausted review/node address; cold-load terminal persistence; no further progression; retired cancel rejected unchanged; no compatibility branches or maintained old callers |
| Conversation pause, resume and matching hooks        | Pause subplan owning integration/transport/seeded hook controls; joined native events within an existing Tier2 scenario | Same step/review/attempt retained; Stop permitted for scoped pause, no forced continue/reminder storm; explicit resume restores underlying obligations; independent verification unaffected                    |
| Server admission, captured binding and lifecycle     | Existing real-server claims-conformance driver and canonical server tests                                               | Actual transport requests and persisted transitions agree; wrong error/setup does not satisfy a negative claim                                                                                                 |
| Installed first native client                        | Isolated Codex candidate plus existing native collector adapter                                                         | Exact client/source/stage/install/resource/config identity, actual hook event, admitted call reaching server, before/after state, target result and true completion joined                                     |
| Target code/artifact correctness                     | External frozen checker over isolated fixture                                                                           | Positive reference and valid alternative accepted; plausible bad artifact/seeded defect rejected; verification output/revision retained                                                                        |
| Optional workflow execution/report archive           | evaluations/tests/workflow-runner.test.ts and workflow-report.test.ts                                                   | Expected refusal/harness error/timeout/cancel/missing evidence stay distinct; closure/replay reproduces outcome without model reruns                                                                           |
| Final authored testing prompt                        | Third bounded native scenario, after fresh build                                                                        | Prompt drives ordinary product use; independent checks determine completion, evidence is replayable and limitations are visible                                                                                |

Before push: source typecheck, lint ratchet, tests typecheck ratchet and validate:all according to project guidance. Full test:all runs once in PR CI, not inside workers or duplicated before push. Run the optional package's affected tests/types when its bytes change. Preserve accepted unrelated native/model/runtime evidence. Native scenario cap is three tasks and at most one reviewer per task, 600 seconds each, concurrency one, zero automatic reruns. This is bounded development/conformance evidence, not a comparative model-performance experiment.

## Risks, documentation and rollback

| Risk                                                             | Mitigation / proof                                                                                                                                                                | Rollback                                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Source and hook policy diverge again                             | One server-derived action contract, complete consumer inventory, source controls and joined native proof                                                                          | Revert reviewed coherent source slice; preserve evidence                                                          |
| Breaking upgrade invalidates client calls or transient run state | Reject retired calls truthfully, reconnect/verify matched server and hooks, preserve compatible state; supported schema transition keeps durable data and declares transient loss | Coherent backup and coordinated writer cutover; scoped session clear for selected failed runs; no whole-file wipe |
| Old/new plugin cache or runtime roots differ                     | Measure actual loaded/install source and child runtime/config, not enabled flags                                                                                                  | Restore isolated candidate; leave global install unchanged                                                        |
| Refusal becomes false completion or consumes a retry             | Immediate before/after snapshots plus actual response/error event                                                                                                                 | Preserve authoritative pending state; retain failed trial                                                         |
| Host policy confused with workflow acceptance                    | Separate capability/policy denial from server report admission/grade                                                                                                              | Retain original host policy; correct adapter normalization only                                                   |
| Private suite labels or credentials leak                         | Actor-visible public requirements only; measured isolation; never read/export auth files or reserved graders                                                                      | Abort trial, retain restricted incident receipt; do not publish raw trace                                         |
| Unsupported artifact capture or fake model identity              | External target proof; step-output scope explicit; requested versus observed configuration separate                                                                               | Mark unavailable/inconclusive, never invent pins/evidence                                                         |
| Incomplete configuration/usage confounds a benchmark             | Freeze actual run configuration and record missingness; monetary values unknown when incomplete                                                                                   | Reject comparison claim, preserve original dataset                                                                |
| Lost untracked execution documents                               | One governing plan location plus durable export snapshot and digest manifest                                                                                                      | Restore verified export before binding a new session                                                              |

Update hooks/README.md, docs/guides/gates.md, docs/concepts/chains-lifecycle.md, docs/reference/mcp-tools.md, docs/architecture/overview.md, docs/reference/client-capabilities.md and evaluations/README.md with the rows that change their behavior. Source verification, native verification and limitations must be stated separately. A consumer-visible/default policy ruling needs the repository's ADR procedure in its reviewed source slice. Candidate changelog: Fixed—client workflow admission/guidance follow server review phases; Added—opt-in workflow evidence retains native and independently checked target outcomes. Final wording depends on actual delivered behavior; no release/tag/npm publication follows from planning or green checks.

Shared Python policy stays upstream; host event/tool aliases stay in adapters. Recheck Gemini/Codex adapters and explicitly account for OpenCode's separate behavioral port before claiming downstream compatibility. Re-locking shipped packages is a separately authorized release operation. No all-client native matrix is implied by one client's successful run.

## Open decisions and pre-dispatch notation

| Decision                                                                                     | Current default                                                                                                                                                                                                                                                                       | Closes when                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 OPEN before 1.2 — projection                                                              | Existing FrozenReviewProjection semantics and server-owned review/run JSON; exact namespace/version/compatibility remain unselected                                                                                                                                                   | 1.1 names exact producers/readers/deciders/views; planner rules wire shape before source edits                                                                                   |
| Q2 OPEN before 2.2 — first native host                                                       | Codex CLI isolated candidate; T3-hosted execution remains distinct                                                                                                                                                                                                                    | Refresh actual version/install/source/trust/event behavior and runtime-root agreement; no parity inferred from old metadata                                                      |
| Q3 OPEN before 2.3 — trial execution                                                         | At most 3 task scenarios plus 1 reviewer each, 600s/invocation, concurrency 1, no automatic reruns, existing account only; cost unknown if collection incomplete                                                                                                                      | Record effective model/effort and safe account scope, approved launch and usage completeness; no new credential handling or paid comparison batch                                |
| Q4 RULED (2026-10-13, R-PUBLISH) — delivery                                                  | Existing owner choice Push and merge reviewed slices persists through this initiative; latest PR488/cancel adjacent-delivery instruction confirms GitHub source delivery. Reviewed slices in this repository may push and merge after required checks                                 | publish: push+merge; no npm/tag/release-PR, global promotion, external-repository edit or unrelated diff authorized; Q6 downstream scope and combined integration still required |
| Q10 RULED (2026-10-13, owner PR488 handoff) — string-verdict hooks                           | Structured parameter only; server retirement stays PR488, our hook migration is abort child1.5 before docs/closure; preserve nonparameter text channels; honest FAIL admitted                                                                                                         | D12 and notes; existing parent phase/capture projection rows reuse these receipts and handle remaining phase policy, no duplicated string parser or source/native claim          |
| Q5 OPEN before 3.1 — workflow specialization                                                 | Reuse archive/trial identities, existing conformance execution and native collectors behind a caller-owned adapter                                                                                                                                                                    | Freeze scenario/checker/adaptor/report API without another scheduler/catalog/state machine                                                                                       |
| Q7 RULED (2026-10-12, owner path1; receipt still OPEN at0.3) — gates-disabled controls       | Keep gate_action in core with the widest supported enum. Abort/resume/accept_alternative and later pause remain declared/admitted independently of gate enablement; retry/skip are named unavailable when gates are off. Existing phase/unknown/remainder constraints still apply     | R-PATH1 in notes; paired schema/router controls must prove feature-off admission without silently discarding values; no run_action or alias                                      |
| Q9 RULED (2026-10-12, owner approved relocation/cleanup) — cancellation history preservation | Record one actual cancelled run-terminal event after durable mutation through existing termination callback and ExecutionRecordStore; refused/idempotent calls add none; old flag/handlers removed after proof. No synthetic completed step/evaluated verdict, new ledger or DDL      | R-CANCEL-EVENT in notes; exact scope/metadata/manifest frozen before production, existing best-effort record policy retained                                                     |
| Q8 RULED (2026-10-12, owner Claude handoff) — inter-planner custody                          | Other planner owns semantic remediation only; our worktree/plan/rows/source edits remain ours. Integrate cf619a61 before further edits; hooks match current R11.2 required-report refusal and updated timing. 0D.7 status/disable behavior is our known availability work, not theirs | Explicit overlap manifest and row0.4 acceptance; no releasePR merge inferred                                                                                                     |
| Q6 OPEN before changed shared policy is published — downstream consumers                     | Upstream shared Python plus thin Gemini/Codex adapters; OpenCode separate port                                                                                                                                                                                                        | Enumerate current adapter repositories/ownership, measure changed event seams and bind necessary port work to explicit scope                                                     |

## Scope exclusions and rollback

This first slice excludes a full all-client matrix, model rankings, efficiency superiority claims, paid benchmark batches, new schedulers/provider clients, broad conversation ingestion, live shared-database migration and global rule promotion. Revisit each only with a named need and a separate bounded row.

Rollback uses the reviewed source/resource revisions and ordinary resource versioning. Preserve original fixtures, accepted evidence, private archives and installed configuration; evaluate candidates in isolated worktrees/runtime roots.

## Sources

- Completed [semantic-gate plan](reference/semantic-gate-evolution-2026-10-07.md) and its [notes](reference/semantic-gate-evolution-2026-10-07-implementation-notes.md).
- Existing [benchmark-authoring plan](backlog/benchmark-authoring-and-evaluation-2026-09-30.md) and [notes](backlog/benchmark-authoring-and-evaluation-2026-09-30-implementation-notes.md).
- [Evaluation package](../evaluations/README.md), [judge contract](../docs/guides/judge-mode.md), [gates](../docs/guides/gates.md), [hooks](../hooks/README.md) and real-server conformance scenarios.
- Public local demo evidence: /home/minipuft/.local/share/claude-prompts-mcp/demos/semantic-gate-showcase-20261008/{results.json,judge-receipt.json,manifest.json,verification.json,receipts/,snapshots/}. The demo location is an operator artifact, not a served calibration suite.
- Source-hook probe on 2026-10-09: actual demo FAIL denied; PASS/contradictory-PASS allowed; isolated probe state-file count zero. This is not native installed-plugin proof.
- Current source producer: server/src/modules/chains/manager.ts::collectActiveSessionRows publishes currentStepReview/runStatus; server/src/infra/database/sqlite-engine.ts::applyViews exposes current_step_review. The current Python readers collapse that review into gate IDs/attempt count.
- [Raw path verification](workflow-client-evaluation-2026-10-09-path-evidence.md): 36 existing paths checked for existence, line counts, symbols and headers; one Stop-test symbol corrected. Generated resolution vocabulary is data, not a compat shim.

## Planning completion and transfer

This document consolidates the five MCP planning steps. Planning checks establish path/table/reference consistency only. Parent20 rows include accepted0.3; other parent rows remain open; abort child0.1-0.4 accepted with8 production/proof rows open, pause child8 rows open; no implementation receipt is created by this revision. No code, native trial, model-quality result, install, global policy or public delivery is completed by this planning pass.

The incoming Claude planner first reads this plan, the sibling notes and the exported handoff. The authoritative execution copy is this plan in /home/minipuft/Applications/claude-prompts-mcp-workflow-evaluation; primary drafts/exports are historical snapshots. Inspect current git state and preserve other actors. Complete Tier0's abort/removal and conversation-pause subplans first, then row1.1's unresolved field/consumer choices before producer/consumer repairs. Keep the owner's unexpected-failure stop rule and expected-negative-control distinction.

## Planning step records

Historical planning outputs below retain the original evidence. The current Now block, D9/D10 and implementation tables override earlier cancellation spelling, stop/custody statements and row counts. They are not current client instructions.

These records retain the full discovery/design/path-verification outputs from this planning workflow. The normative implementation table and validation strategy above are the full Step4/Step5 plan; later workers should read their row and relevant contract sections, not repeat this audit.

### MCP Step 1 — Discovery result

## Context

Planning only. Source HEAD is 6889b0154e44eebd38cb1f622089c9650769aa1b; semantic PRs474-476 are delivered. Current primary planning drafts survive, but the previously referenced linked-worktree plan copies are absent. Durable partial inventory and native preflight remain under /home/minipuft/.local/share/claude-prompts-mcp/evaluations/workflow-client-20261010/preflight/. No source edits or native trials are authorized by this planning invocation.

## Analysis

search_type: dependency_trace.
queries_run: current git status/HEAD; plan heading/row inventory; rg projectFrozenReview, semanticReviewAction, GateVerdictProcessor and currentStepReview/current_step_review; owning hook-test filename enumeration; previous targeted hook/DB-reader/Stop source reads and retained partial inventory.
sibling_patterns: existing canonical frozen review projection and review lifecycle; generated resolution vocabulary; structured interrupt output; shared reminder/session projection; real-server claims-conformance driver; optional immutable evaluation archive.
domain_ownership: prompt_engine and server review/capture/verdict services own workflow state; resource_manager owns resources; shared Python hook policy projects state, downstream adapters normalize host events; evaluations owns optional trial evidence and replay.
intent: work_type bug_fix, secondary feature; scope existing hooks/state/result projections/owning tests/docs first, optional runner later; risk high due blocked valid calls and lost pending-state evidence; external_deps none selected.
Problem: hooks collapse state into generic pending_gate and can contradict legitimate server actions -> shared authoritative state/action projection consumed across hook surfaces.
Research: no new external library/API choice; WebSearch/context7 n/a for current contract inventory. Current native capability/version/trust must be measured later, not inferred from older references.

## Goals

Valid FAIL and semantic capture must reach the server; refusals preserve state; reminders/Stop/recovery match current phase; completion requires terminal evidence; trials keep independent target checks and evidence boundaries.

## Execution

Preserve existing accepted receipts. Reconcile governing plan location and complete bounded writer/reader/decision/view inventory before choosing wire fields or dispatching repairs. Track source-inspected, source-probed, server-executed, native-client-observed, harness-observed and unknown findings separately.

## Evaluation

Confidence high in current source conflicts, medium in minimal projection shape, unknown in installed-client event behavior. Native preflight was partial: historical CLI0.161.0 observed; tomllib failed before config access. Runtime failure on deliberately stale bindings is an expected control; absence of immediate after-state remains a limitation. Two reminders satisfied: structured content and framework phases. No claimed implementation/native PASS.

## Refinement

Prefer existing server projection plus thin hook/adapters. Reject server semantics weakened to match old hook denial; reject duplicated lifecycle or a global user_response resolution escape. One consolidated diagnosis at end of evidence pass. Unexpected validation discrepancy stops dependent implementation.

### MCP Step 2 — Design/pre-flight result

## Context

scope.objective: project authoritative server review actions to hooks and verify actual client/target outcomes.
success_signal: honestFAIL reaches ledger; capture/report actions admitted byphase; refusals preserve hold; explicitcompletion clears; native trace joins server and target proof.
Constraints/non-goals follow frozen invocation; planning only, sourceimplementation remains paused.

## Analysis

Identification: a derived lifecycle/action projection over existing canonical review and run state. Server computes its meaning; hooks retain/communicate it and enforce host policy. Pure projection and shared consumer logic, not a second manager/state machine.
pre_flight: domain pass(source owners traced); layer pass(reuse server decision + hook shared library); naming pass(no vague new coordinator selected); complexity/size n/a(no source edit; worker must measure before implementation); service pass(existing projectFrozenReview/semanticReviewAction); defined pass(existing FrozenReviewProjection + currentStepReview); contracts FAIL(known blocked honestFAIL/capture, dropped semantic state, conditional refusal clearing and conflicting reminders); pattern pass(proposed pure projection/thin event shims); reuse-scope pass(all reminder/admission/recovery consumers enumerated); persistence n/a(no writes; publisher/view inspected); lib-api/lib-version n/a(no newlibrary/API usage).
Known compound: authoritative review-state projection and client-admission mismatch -> freeze contract before repairing consumers. These are carried-forward known blockers; no new implementation validation failure is claimed.

## Goals

Contract semantics reuse submission legacy|capture-first|report|unavailable, review phases awaiting-verdict|awaiting-replacement|exhausted, exhausted flag, canonical run/node/attempt identity, captured-target availability and immutable bindings, with report admission distinct from semantic grade and run completion.
Actions: capture-first=user_response only; report=current structuredreport, nochangedbody; exhausted=validgate_action; unavailable=restoreauthority; ordinarylegacy=supportedlegacyreview; blockingunknown=its ownissued exits.
Refusal does not imply completion. Hooks nevermint attempts, derive a semantic grade or fabricate body identity. Hostpolicy denial is separately recorded.

## Execution

Minimum wire-field location/version and backward compatibility remain a bounded contract task, not a guessed addedfield. Writer: ChainManager.collectActiveSessionRows serializes currentStepReview and runStatus; view: SqliteEngine.applyViews projects current_step_review; canonical semantics: projectFrozenReview + semanticReviewAction; readers: both db_reader paths, session stateparser, enforcement and allreminder/Stop consumers. Use existing JSON/view plumbing; noDDL presumed.
read_before_implementing: server/src/modules/chains/manager.ts:collectActiveSessionRows; server/src/infra/database/sqlite-engine.ts:applyViews; semantic-review-context.ts:FrozenReviewProjection/projectFrozenReview; describe-review-for-render.ts:semanticReviewAction; hooks state/readers/admission/tracker/reminder/Stop; owningtests and extensionalignment rule.
Choose contract-led sourceprojection plus thinconsumers. Reject source semantics matching old hookdenials, globaluser_response escape, duplicated grader orworkflow authority.

## Evaluation

Planning preflight is documented with known failures, unrun codechecks markedn/a, source/native distinction preserved. Source hooks unchanged; installedhostbehavior unmeasured. Projection namespace and nativeerror event decisions must be resolved before dependent edits. No native run/compilation/test was performed.

## Refinement

Diagnosis card: layers server reviewprojection/store/view -> Python hookstate/policy -> hostadapter -> modeltools; risk high(falseadmission, suppressedfail, pendingstate loss). Order: complete contract/inventory, producer/sharedprojection, admission and tracking, reminders/Stop, targetedsourcecontrols, pinnednativeproof, optionalrunner, one consolidated diagnosis.

### MCP Step 3 — Raw path verification

## Context

Verify the existing producer, view, canonical review projection, hook consumers, owning tests, evaluation archive, native staging and collector paths before constructing the plan table. Source reference is 6889b015; these filesystem checks establish locations and symbols, not native runtime behavior. Exact wire additions remain gated by contract completion.

## Analysis

### File: server/src/modules/chains/manager.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/src/modules/chains/manager.ts
-rw-r--r-- 1 minipuft minipuft 135781 Oct  8 15:15 /home/minipuft/Applications/claude-prompts-mcp/server/src/modules/chains/manager.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/src/modules/chains/manager.ts
3370 /home/minipuft/Applications/claude-prompts-mcp/server/src/modules/chains/manager.ts
$ rg -n collectActiveSessionRows /home/minipuft/Applications/claude-prompts-mcp/server/src/modules/chains/manager.ts
763:    const activeRows = this.collectActiveSessionRows();
792:  private collectActiveSessionRows(): Array<{
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/src/modules/chains/manager.ts
// @lifecycle canonical - Manages chain session persistence and lifecycle promotion.
/**
 * Chain Session Store
 *
 * Manages chain execution sessions, providing the bridge between MCP session IDs
 * and the persisted chain state/step capture utilities. This enables stateful
 * chain execution across multiple MCP tool calls.
 *
 * CRITICAL: Uses SQLite-backed persistence to survive STDIO transport's ephemeral processes.
 * Sessions are saved to disk after every change and loaded on initialization.
```

### File: server/src/infra/database/sqlite-engine.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/src/infra/database/sqlite-engine.ts
-rw-r--r-- 1 minipuft minipuft 85534 Oct  5 04:38 /home/minipuft/Applications/claude-prompts-mcp/server/src/infra/database/sqlite-engine.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/src/infra/database/sqlite-engine.ts
1639 /home/minipuft/Applications/claude-prompts-mcp/server/src/infra/database/sqlite-engine.ts
$ rg -n current_step_review /home/minipuft/Applications/claude-prompts-mcp/server/src/infra/database/sqlite-engine.ts
61: * and its `v_execution_status` column `current_step_review` (P6.20, R193; the old names are in
1408:        json_extract(cs.state, '$.currentStepReview') AS current_step_review,
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/src/infra/database/sqlite-engine.ts
// @lifecycle canonical - Manages SQLite database lifecycle via node:sqlite (native)
/**
 * SQLite Engine
 *
 * Singleton that manages the native Node.js SQLite database lifecycle.
 * Uses node:sqlite (DatabaseSync) for file-backed storage with no WASM dependency.
 *
 * Key Features:
 * - File-backed natively (no manual persist() needed)
 * - WAL mode for concurrent reader access (Python hooks)
```

### File: server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts
-rw-r--r-- 1 minipuft minipuft 18075 Oct  8 15:15 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts
454 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts
$ rg -n FrozenReviewProjection /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts
190:export interface FrozenReviewProjection {
199:export function assertFrozenReviewAvailable(protocol: FrozenReviewProjection): void {
282:export function projectFrozenReview(review: PendingGateReview): FrozenReviewProjection {
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts
// @lifecycle canonical - Frozen public review definitions and capture-bound semantic authority.
import { resolveFrozenReviewDefinition } from './frozen-review-definitions.js';
import { resolveReviewTarget } from './review-target.js';
import { selectToolReviewGateIds } from './structural-review-composition.js';
import { SemanticCriterionSchema } from '../../../../gates/core/gate-schema.js';
import { resolveJudgeConfig } from '../../../../gates/judge/judge-prompt-builder.js';
import { resolveDetachedReport } from '../../../delegation/detached.js';
import {
  classifyHandoffBody,
  handoffNodeToken,
```

### File: server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts
-rw-r--r-- 1 minipuft minipuft 17575 Oct  8 15:15 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts
394 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts
$ rg -n semanticReviewAction /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts
186:export function semanticReviewAction(protocol: FrozenReviewProjection): string | undefined {
202:  const action = semanticReviewAction(protocol);
228:  const action = semanticReviewAction(protocol);
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts
// @lifecycle canonical - What a gate review's render reads off the review record.
/**
 * Review render facts (primitive rework row 3.5).
 *
 * A gate review re-renders the step it grades, and that render reads the review in two places:
 * which step it grades and which gates it names (before the body), and what the attempts so far
 * left behind — retry hints, the last recorded reasoning, the retry budget (after it). Both reads
 * are decided here, from the record `ChainSession.reviews[nodeId]` holds, so the executor that
 * renders the template owns no review semantics of its own.
 *
```

### File: server/src/engine/execution/formatting/response-assembler.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/formatting/response-assembler.ts
-rw-r--r-- 1 minipuft minipuft 75715 Oct  8 15:15 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/formatting/response-assembler.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/formatting/response-assembler.ts
1619 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/formatting/response-assembler.ts
$ rg -n buildChainFooter /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/formatting/response-assembler.ts
170:    const footer = this.buildChainFooter(context);
460:  buildChainFooter(context: ExecutionContext): string {
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/formatting/response-assembler.ts
// @lifecycle canonical - Assembles response content for pipeline formatting stage.
import { declaresFrameworkSections } from '../../frameworks/declared-sections.js';
import { JUDGE_OUTPUT_PLACEHOLDER } from '../../gates/core/review-utils.js';
import { liveNodeIds } from '../../gates/services/run-step-view.js';
import { SHELL_VERIFY_DEFAULT_MAX_ITERATIONS } from '../../gates/shell/types.js';
import { handoffNodeToken } from '../delegation/handoff-contract.js';
import { DelegationRenderer } from '../delegation/renderer.js';
import { getHandoffFooterInstruction } from '../delegation/strategy.js';
import { rerunCommandText } from '../parsers/command-parser.js';
import { formatShellVerifyToken } from '../parsers/symbolic-operator-parser.js';
```

### File: server/src/engine/gates/services/gate-verdict-processor.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/gates/services/gate-verdict-processor.ts
-rw-r--r-- 1 minipuft minipuft 56617 Oct  8 15:15 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/gates/services/gate-verdict-processor.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/gates/services/gate-verdict-processor.ts
1346 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/gates/services/gate-verdict-processor.ts
$ rg -n handleGateAction /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/gates/services/gate-verdict-processor.ts
378:   * Separate entry point from {@link handleGateAction}, not a fifth case inside it: that method
482:  async handleGateAction(
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/gates/services/gate-verdict-processor.ts
// @lifecycle canonical - Processes gate verdicts, actions, and hook events for chain sessions.
import {
  describeRefusal,
  describeMissingReview,
  describeGatelessStep,
  describeInBudgetAction,
  describeUnansweredStep,
} from './gate-review-refusal.js';
import {
  failedReviewGateIds,
```

### File: hooks/gate-enforce.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/gate-enforce.py
-rwxr-xr-x 1 minipuft minipuft 7396 Sep 25 01:08 /home/minipuft/Applications/claude-prompts-mcp/hooks/gate-enforce.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/gate-enforce.py
177 /home/minipuft/Applications/claude-prompts-mcp/hooks/gate-enforce.py
$ rg -n def main /home/minipuft/Applications/claude-prompts-mcp/hooks/gate-enforce.py
64:def main():
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/gate-enforce.py
#!/usr/bin/env python3
"""
PreToolUse hook: Enforce gate verdicts on prompt_engine calls.

Blocks:
1. GATE_REVIEW: FAIL without retry attempt
2. Chain resumes carrying NO pending-run resolution parameter while the run is HOLDING.
   Two holds reach this check: an ordinary gate review, and the reserved
   `__unknown_interrupt__` synthetic review a blocking unknown raises under
   `budget.pauseOnBlocking`. They are denied with different prose because they accept
```

### File: hooks/post-prompt-engine.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/post-prompt-engine.py
-rwxr-xr-x 1 minipuft minipuft 5905 Sep 25 01:08 /home/minipuft/Applications/claude-prompts-mcp/hooks/post-prompt-engine.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/post-prompt-engine.py
147 /home/minipuft/Applications/claude-prompts-mcp/hooks/post-prompt-engine.py
$ rg -n def main /home/minipuft/Applications/claude-prompts-mcp/hooks/post-prompt-engine.py
37:def main():
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/post-prompt-engine.py
#!/usr/bin/env python3
"""
PostToolUse hook: Track chain/gate state from prompt_engine responses.

Triggers after: mcp__claude-prompts__prompt_engine

Parses the response to:
1. Track current chain step
2. Detect pending gates
3. Inject reminders for gate reviews
```

### File: hooks/lib/session_state.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/session_state.py
-rw-r--r-- 1 minipuft minipuft 14795 Oct  5 04:38 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/session_state.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/session_state.py
350 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/session_state.py
$ rg -n format_chain_reminder /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/session_state.py
293:def format_chain_reminder(state: ChainState, mode: str = "full") -> str:
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/session_state.py
"""
Session state manager for Claude Code hooks.
Tracks chain/gate state per conversation session via SQLite (hooks-state.db).
"""

import json
import os
import re
from typing import Any, TypedDict, cast
```

### File: hooks/lib/db_reader.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/db_reader.py
-rw-r--r-- 1 minipuft minipuft 17752 Oct  5 06:05 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/db_reader.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/db_reader.py
495 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/db_reader.py
$ rg -n _view_row_to_hook_state /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/db_reader.py
329:        hook_state = _view_row_to_hook_state(row)
336:def _view_row_to_hook_state(row: sqlite3.Row) -> dict | None:
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/db_reader.py
"""
SQLite reader for Claude Code hooks.
Queries resource_index table from state.db as a read-only data source.

Replaces JSON cache file reads for prompts and gates.
Uses stdlib sqlite3 — no external dependencies.
"""

import json
import os
```

### File: hooks/prompt-suggest.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/prompt-suggest.py
-rwxr-xr-x 1 minipuft minipuft 32145 Sep 20 11:32 /home/minipuft/Applications/claude-prompts-mcp/hooks/prompt-suggest.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/prompt-suggest.py
835 /home/minipuft/Applications/claude-prompts-mcp/hooks/prompt-suggest.py
$ rg -n format_chain_reminder /home/minipuft/Applications/claude-prompts-mcp/hooks/prompt-suggest.py
40:from session_state import ChainState, format_chain_reminder
795:            system_msg = format_chain_reminder(session_state, mode="inline")
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/prompt-suggest.py
#!/usr/bin/env python3
"""
UserPromptSubmit hook: Directive injection for claude-prompts.

Detects >>syntax and operators, outputs:
- systemMessage: Compact user confirmation
- additionalContext: Structured directive for Claude

Architecture:
- Layer 1: MCP-native prompts (via registerPrompt) - standard protocol
```

### File: hooks/compact-recovery.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/compact-recovery.py
-rwxr-xr-x 1 minipuft minipuft 3251 Aug 21 04:58 /home/minipuft/Applications/claude-prompts-mcp/hooks/compact-recovery.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/compact-recovery.py
100 /home/minipuft/Applications/claude-prompts-mcp/hooks/compact-recovery.py
$ rg -n format_chain_reminder /home/minipuft/Applications/claude-prompts-mcp/hooks/compact-recovery.py
24:from session_state import ChainState, format_chain_reminder
62:    reminder = format_chain_reminder(state, mode="full")
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/compact-recovery.py
#!/usr/bin/env python3
"""
SessionStart("compact") hook: Re-inject active chain state after compaction.

Triggers after: Context compaction (manual /compact or auto-compaction).

Reads chain state from server's SQLite state.db (SSOT) and outputs a
continuation directive to stdout. Claude Code adds stdout to the
post-compaction context, bridging the gap between compaction and the
next UserPromptSubmit (where prompt-suggest.py would also catch it).
```

### File: hooks/ralph-stop.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/ralph-stop.py
-rwxr-xr-x 1 minipuft minipuft 24212 Sep 25 01:08 /home/minipuft/Applications/claude-prompts-mcp/hooks/ralph-stop.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/ralph-stop.py
636 /home/minipuft/Applications/claude-prompts-mcp/hooks/ralph-stop.py
$ rg -n chain_block_reason /home/minipuft/Applications/claude-prompts-mcp/hooks/ralph-stop.py
357:def chain_block_reason(chain_state: dict) -> str:
412:            print(json.dumps({"decision": "block", "reason": chain_block_reason(chain_state)}))
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/ralph-stop.py
#!/usr/bin/env python3
"""
Stop hook: Shell verification for Ralph Wiggum-style autonomous loops.

When Claude tries to stop, this hook:
1. Reads runtime-state/verify-state.db (written by MCP server via SQLite)
2. Runs the verification command
3. If PASS (exit 0): Allows Claude to stop
4. If FAIL (exit != 0): Blocks stop, feeds error back to Claude
```

### File: hooks/hooks.json

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/hooks.json
-rw-r--r-- 1 minipuft minipuft 2588 Aug 23 18:33 /home/minipuft/Applications/claude-prompts-mcp/hooks/hooks.json
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/hooks.json
91 /home/minipuft/Applications/claude-prompts-mcp/hooks/hooks.json
$ rg -n gate-enforce /home/minipuft/Applications/claude-prompts-mcp/hooks/hooks.json
10:            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.py\"",
11:            "name": "gate-enforce",
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/hooks.json
{
  "description": "Claude Prompts plugin hooks - syntax detection, chain tracking, gate reminders",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*prompt_engine",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.py\"",
```

### File: hooks/lib/_generated/resolution_verbs.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/_generated/resolution_verbs.py
-rw-r--r-- 1 minipuft minipuft 299 Sep  1 05:05 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/_generated/resolution_verbs.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/_generated/resolution_verbs.py
12 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/_generated/resolution_verbs.py
$ rg -n PENDING_RUN_RESOLUTION_PARAMS /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/_generated/resolution_verbs.py
6:PENDING_RUN_RESOLUTION_PARAMS: frozenset[str] = frozenset(
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/_generated/resolution_verbs.py
"""Pending-run resolution verbs. Generated from tooling/contracts/prompt-engine.json.

Regenerate with `npm run generate:contracts` (server/). Do not edit.
"""

PENDING_RUN_RESOLUTION_PARAMS: frozenset[str] = frozenset(
    {
        "cancel",
        "gate_action",
        "gate_verdict",
```

### File: hooks/tests/test_gate_enforce_verdict.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_gate_enforce_verdict.py
-rw-r--r-- 1 minipuft minipuft 6450 Sep  1 05:05 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_gate_enforce_verdict.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_gate_enforce_verdict.py
165 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_gate_enforce_verdict.py
$ rg -n gate_verdict /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_gate_enforce_verdict.py
4:gate_verdict reaches the hook in two schema shapes: the structured object
54:                "gate_verdict": {
71:                "gate_verdict": {"overall": "PASS", "rationale": "all met"},
81:    The hook's previous hardcoded model (chain_id without gate_verdict -> deny) blocked
114:        assert "gate_verdict" in reason
149:                "gate_verdict": "GATE_REVIEW: FAIL - not good enough",
161:                "gate_verdict": "GATE_REVIEW: PASS - solid",
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_gate_enforce_verdict.py
"""
Tests for hooks/gate-enforce.py verdict-shape handling.

gate_verdict reaches the hook in two schema shapes: the structured object
{overall, rationale, per_gate[]} (preferred) and the legacy
"GATE_REVIEW: FAIL - reason" string. The structured shape crashed the hook
with TypeError until 2026-08-03 (surfaced by the codex-prompts E2E port);
because hook failures are fail-open, that meant object verdicts were never
gate-enforced.
"""
```

### File: hooks/tests/test_post_prompt_engine_clearing.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_post_prompt_engine_clearing.py
-rw-r--r-- 1 minipuft minipuft 5405 Aug 21 06:05 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_post_prompt_engine_clearing.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_post_prompt_engine_clearing.py
139 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_post_prompt_engine_clearing.py
$ rg -n pending_gate /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_post_prompt_engine_clearing.py
5:a resolved gate ("Execution complete.", no markers) left its pending_gate row
81:        Previously the pending_gate row survived until the 24h sweep."""
127:        assert row.get("pending_gate")
129:    def test_completion_with_a_pending_gate_is_kept(self, workspace):
139:        assert row.get("pending_gate")
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_post_prompt_engine_clearing.py
"""
Tests for hooks/post-prompt-engine.py session-row lifecycle.

Rows were written on every parse and cleared by nothing but the 24h sweep, so
a resolved gate ("Execution complete.", no markers) left its pending_gate row
behind and recovery hooks re-injected long-resolved state after compaction.
These pin the clearing boundaries:

  - verdict/cancel submission + marker-less response  → row cleared
  - explicit completion marker + nothing pending      → row cleared
```

### File: hooks/tests/test_db_reader.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_db_reader.py
-rw-r--r-- 1 minipuft minipuft 52662 Oct  5 06:05 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_db_reader.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_db_reader.py
1205 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_db_reader.py
$ rg -n def test /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_db_reader.py
211:    def test_extracted_ddl_declares_every_object_db_reader_queries(self, state_db):
216:    def test_extracted_schema_version_matches_the_seeded_row(self, state_db):
221:    def test_run_status_is_not_null_because_the_reader_has_no_null_branch(self, state_db):
240:    def test_load_prompts_projects_metadata_json_into_chain_fields(self, state_db):
269:    def test_load_prompts_tolerates_malformed_metadata_json(self, state_db):
277:    def test_load_prompts_meta_carries_styles_and_frameworks(self, state_db):
287:    def test_frameworks_read_the_resource_type_the_indexer_writes(self, state_db):
298:    def test_get_prompt_by_id_is_case_insensitive(self, state_db):
305:    def test_load_gates_projects_type_and_triggers(self, state_db):
320:    def test_every_reader_fails_open_when_the_database_is_absent(self, no_state_db):
333:    def test_returns_state_for_a_live_owner(self, state_db):
343:    def test_rows_owned_by_a_dead_process_are_skipped(self, state_db):
349:    def test_a_claimed_run_serves_the_claimer_row_over_the_dead_first_owner(self, state_db, path):
374:    def test_two_scopes_runs_of_one_chain_id_in_one_process_serve_the_newest(self, state_db, path):
405:    def test_a_non_numeric_owner_is_skipped(self, state_db):
416:    def test_a_chain_standing_on_its_last_step_is_active(self, state_db):
429:    def test_a_final_step_awaiting_a_gate_verdict_is_still_active(self, state_db):
446:    def test_a_final_step_awaiting_shell_verification_is_still_active(self, state_db):
462:    def test_session_table_serves_when_the_view_is_unavailable(self, state_db):
478:    def test_no_state_when_the_view_and_session_table_both_yield_nothing(self, state_db):
520:    def test_a_held_run_past_its_last_node_is_kept_on_both_paths(self, state_db, pending):
532:    def test_an_in_progress_row_is_unchanged(self, state_db):
540:    def test_a_terminal_row_past_its_last_node_is_dropped(self):
555:    def test_the_view_projects_the_steps_its_writer_wrote(self, state_db):
562:    def test_the_primary_path_serves_without_falling_back(self, state_db):
574:    def test_terminal_runs_are_excluded_on_every_path(self, state_db, terminal):
657:    def test_the_view_path_names_only_its_eight_columns_and_the_sort_key(self, state_db, monkeypatch):
664:    def test_the_session_table_path_names_only_its_three_columns_and_the_sort_key(self, state_db, monkeypatch):
673:    def test_control_renaming_a_column_the_loader_reads_fails_the_pin(self, state_db, monkeypatch):
707:    def test_a_renamed_view_column_still_returns_the_state_from_the_session_row(self, state_db):
727:    def test_control_an_intact_view_serves_the_row_the_session_table_would_refuse(self, state_db):
738:    def test_view_and_session_table_both_unreadable_returns_none_without_raising(self, state_db):
775:    def test_a_renamed_view_column_still_returns_the_state_from_the_session_row(self, state_db):
796:    def test_control_an_intact_view_serves_the_row_the_session_table_would_refuse(self, state_db):
808:    def test_view_and_session_table_both_unreadable_returns_none_without_raising(self, state_db):
856:    def test_the_active_loader_returns_the_same_dict(self, state_db, read_path):
862:    def test_the_recoverable_loader_returns_the_same_dict(self, state_db, read_path):
889:    def test_the_unscoped_scan_is_dead(self, state_db):
896:    def test_a_foreign_chain_id_is_not_served(self, state_db):
901:    def test_a_session_with_no_recorded_chain_recovers_nothing(self, state_db):
910:    def test_the_sessions_own_chain_is_recovered_fresh(self, state_db):
922:    def test_a_terminal_chain_is_not_resurrected_from_the_snapshot(self, state_db):
935:    def test_a_live_run_with_no_projected_row_recovers_nothing(self, state_db):
950:    def test_control_the_same_chain_projected_is_recovered(self, state_db):
968:    def test_a_dead_owner_expires_the_chain(self, state_db):
976:    def test_without_a_server_db_the_session_snapshot_serves(self, no_state_db):
995:    def test_the_servers_actual_layout_is_preferred(self, tmp_path, monkeypatch):
1018:    def test_the_legacy_server_layout_still_serves(self, tmp_path, monkeypatch):
1038:    def test_mcp_runtime_root_outranks_the_workspace(self, tmp_path, monkeypatch):
1078:    def test_the_plugin_data_state_db_outranks_the_install_directory(self, tmp_path, monkeypatch):
1091:    def test_unset_or_blank_plugin_data_adds_no_candidate(self, tmp_path, monkeypatch, value):
1105:    def test_mcp_runtime_root_outranks_plugin_data(self, tmp_path, monkeypatch):
1151:    def test_plugin_shape_reads_the_data_directory_not_the_install(self, tmp_path, monkeypatch):
1161:    def test_mcp_runtime_root_is_where_the_server_wrote_it(self, tmp_path, monkeypatch):
1172:    def test_a_row_the_server_wrote_is_the_row_the_hook_loads(self, tmp_path, monkeypatch):
1195:    def test_without_a_server_state_db_the_hook_owned_directory_is_used(self, tmp_path, monkeypatch):
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_db_reader.py
"""
Tests for hooks/lib/db_reader.py — the Python half of a cross-language contract.

WHY THIS FILE EXISTS
--------------------
`db_reader.py` reads `state.db`, whose schema is declared in TypeScript
(`server/src/infra/database/sqlite-engine.ts`). Nothing in the TypeScript build can observe these
reads, so a column rename lands green on the server side and silently degrades the hooks: every
query in `db_reader.py` catches `sqlite3.OperationalError` and returns `None`, which fail-open
callers read as "database unavailable" rather than "schema drifted". That failure has already
```

### File: hooks/tests/test_session_tracker.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_session_tracker.py
-rw-r--r-- 1 minipuft minipuft 7761 Mar 12  2026 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_session_tracker.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_session_tracker.py
201 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_session_tracker.py
$ rg -n def test /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_session_tracker.py
21:    def test_creates_session_directory(self, patch_workspace):
28:    def test_initial_state(self, patch_workspace):
37:    def test_set_goal(self, patch_workspace):
50:    def test_record_iteration(self, patch_workspace):
65:    def test_record_multiple_iterations(self, patch_workspace):
75:    def test_record_file_change(self, patch_workspace):
87:    def test_generate_story_no_iterations(self, patch_workspace):
94:    def test_generate_story_with_iterations(self, patch_workspace):
108:    def test_generate_diff_summary_empty(self, patch_workspace):
115:    def test_generate_diff_summary_with_changes(self, patch_workspace):
127:    def test_get_iteration_count(self, patch_workspace):
137:    def test_clear_session(self, patch_workspace):
151:    def test_state_persistence_across_instances(self, patch_workspace):
164:    def test_generate_task_context(self, patch_workspace):
183:    def test_factory_function(self, patch_workspace):
192:    def test_clears_session(self, patch_workspace):
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_session_tracker.py
"""
Tests for hooks/lib/session_tracker.py

Covers:
- SessionTracker creation and state initialization
- Iteration recording
- File change tracking
- Story generation
- Diff summary
- Session clearing and persistence
```

### File: hooks/tests/test_ralph_stop.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_ralph_stop.py
-rw-r--r-- 1 minipuft minipuft 13891 Sep 25 01:08 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_ralph_stop.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_ralph_stop.py
375 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_ralph_stop.py
$ rg -n chain_block_reason /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_ralph_stop.py
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_ralph_stop.py
"""
Tests for hooks/ralph-stop.py core functions.

Covers:
- run_verification (pass/fail/timeout)
- format_error_feedback
- load_context_isolation_config (defaults/custom)
- ensure_ralph_session_id
- stop_hook_active guard
- Max iterations reached
```

### File: hooks/tests/test_unknown_interrupt_hold.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_unknown_interrupt_hold.py
-rw-r--r-- 1 minipuft minipuft 11068 Oct  5 04:38 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_unknown_interrupt_hold.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_unknown_interrupt_hold.py
254 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_unknown_interrupt_hold.py
$ rg -n def test /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_unknown_interrupt_hold.py
119:    def test_gate_action_verbs_are_allowed(self, monkeypatch, capsys, action):
124:    def test_accept_alternative_with_remainder_is_allowed(self, monkeypatch, capsys):
137:    def test_cancel_true_is_allowed(self, monkeypatch, capsys):
142:    def test_mutation_probe_a_hook_without_gate_action_denies_resume(self, monkeypatch, capsys):
156:    def test_bare_chain_id_resume_is_denied_and_names_the_verbs(self, monkeypatch, capsys):
172:    def test_denial_falls_back_to_contract_parameters_when_no_verbs_were_captured(self, monkeypatch, capsys):
187:    def test_an_ordinary_gate_review_still_gets_the_verdict_message(self, monkeypatch, capsys):
201:    def test_label_gate_ids_renders_the_synthetic_id_as_words(self):
207:    def test_db_reader_uses_the_same_label(self):
224:    def test_paused_response_sets_the_hold_and_captures_the_servers_verbs(self):
237:    def test_the_soft_variant_is_not_a_hold(self):
243:    def test_reminder_offers_the_interrupt_verbs_not_a_verdict(self):
251:    def test_interrupt_exits_prefer_the_servers_own_list(self):
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_unknown_interrupt_hold.py
"""
Hook awareness of the blocking-unknown interrupt (plan row 3.1,
plans/features/mid-chain-unknown-surfacing-2026-08-20.md).

A hard-paused run holds on the reserved synthetic review `__unknown_interrupt__` instead of on a
gate anyone authored. Three things follow, and each is asserted here rather than assumed:

1. ALLOW — every verb the server accepts for that hold (`gate_action: resume |
   accept_alternative | abort`, `cancel: true`) must pass `gate-enforce.py` Check 2. Tier 0
   renamed the artifact to `PENDING_RUN_RESOLUTION_PARAMS`, which plausibly makes this work for
```

### File: hooks/tests/test_codex_client_seams.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_codex_client_seams.py
-rw-r--r-- 1 minipuft minipuft 5519 Sep  1 02:05 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_codex_client_seams.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_codex_client_seams.py
139 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_codex_client_seams.py
$ rg -n def test /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_codex_client_seams.py
36:    def test_plugin_root_resolves_when_alone(self, tmp_path, monkeypatch):
41:    def test_claude_plugin_root_wins_over_plugin_root(self, tmp_path, monkeypatch):
51:    def test_plugin_root_wins_over_gemini_root(self, tmp_path, monkeypatch):
61:    def test_nonexistent_plugin_root_falls_through(self, tmp_path, monkeypatch):
72:    def test_claude_default_shape_unchanged(self):
78:    def test_codex_command_shape(self):
88:    def test_codex_working_directory_uses_cd(self, tmp_path):
94:    def test_claude_working_directory_uses_add_dir(self, tmp_path):
99:    def test_client_defaults_from_env(self, monkeypatch):
107:    def test_not_found_message_per_client(self):
124:    def test_high_capability_resolves_to_verified_slug(self):
128:    def test_standard_returns_none_for_client_default(self):
131:    def test_gate_heavy_step_escalates(self):
135:    def test_registry_has_codex(self):
138:    def test_claude_default_behavior_unchanged(self):
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_codex_client_seams.py
"""
Tests for the Codex client seams in hooks/lib.

Covers:
- workspace.get_workspace_root PLUGIN_ROOT resolution (order + fall-through)
- cli_spawner._build_command dispatch (claude vs codex command shape)
- cli_spawner._cli_not_found_message per-client error text
- model_strategies.CodexModelStrategy resolution + registry registration
"""
```

### File: server/tests/e2e/claims-conformance.test.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/tests/e2e/claims-conformance.test.ts
-rw-r--r-- 1 minipuft minipuft 29633 Oct  5 23:52 /home/minipuft/Applications/claude-prompts-mcp/server/tests/e2e/claims-conformance.test.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/tests/e2e/claims-conformance.test.ts
629 /home/minipuft/Applications/claude-prompts-mcp/server/tests/e2e/claims-conformance.test.ts
$ rg -n ScenarioSetupError /home/minipuft/Applications/claude-prompts-mcp/server/tests/e2e/claims-conformance.test.ts
53:class ScenarioSetupError extends Error {}
262:    throw new ScenarioSetupError(
301:      throw new ScenarioSetupError(
334:      throw new ScenarioSetupError(
444:    if (error instanceof ScenarioSetupError) throw error;
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/tests/e2e/claims-conformance.test.ts
/**
 * Claims-conformance suite
 *
 * Every scenario in `conformance/*.yaml` asserts something the PUBLISHED surface claims — the
 * README, docs/, or a contract registry — and this driver executes it against a real spawned
 * server over the real transport. A red scenario means the documentation and the server
 * disagree.
 *
 * WHY THIS EXISTS
 * Tier 3a of the acquisition plan found 9 overstated README claims by hand; `%guided` threw a
```

### File: scripts/codex-dev-plugin.mjs

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-dev-plugin.mjs
-rw-r--r-- 1 minipuft minipuft 19712 Sep 29 21:17 /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-dev-plugin.mjs
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-dev-plugin.mjs
658 /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-dev-plugin.mjs
$ rg -n stageDevPlugin /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-dev-plugin.mjs
535:export async function stageDevPlugin({
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-dev-plugin.mjs
/** Materialize the current engine and shared hooks behind unchanged Codex adapters. */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
```

### File: scripts/codex-server.mjs

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-server.mjs
-rwxr-xr-x 1 minipuft minipuft 24554 Sep 29 21:17 /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-server.mjs
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-server.mjs
754 /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-server.mjs
$ rg -n async function /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-server.mjs
160:async function optionalJson(path) {
169:async function cachedPlugins(configPath, marketplace) {
206:async function status(configPath, wrapperRoot) {
288:async function backupConfig(configPath, original) {
324:async function writeConfig(
376:async function ensureMarketplace(configPath, original) {
430:async function installedDevelopment(configPath) {
448:async function assertConfigState(configPath, expected) {
455:async function captureInstalled(configPath, previous) {
466:async function replayInstalled(configPath, stage, snapshot) {
485:async function restoreInstalledSettings(context, observed) {
513:async function rollbackDevelopment(context) {
559:async function installDevelopment(
667:async function switchMode(configPath, mode, wrapperRoot) {
716:async function main() {
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-server.mjs
#!/usr/bin/env node
// Local operator tool; never edits plugin caches or the running Codex session.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  rm,
```

### File: evaluations/core/contracts.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/contracts.ts
-rw-r--r-- 1 minipuft minipuft 11755 Oct  7 10:46 /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/contracts.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/contracts.ts
359 /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/contracts.ts
$ rg -n ArchiveRecord /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/contracts.ts
78:export type ArchiveRecord = RecordBody & { readonly record_id: Digest };
79:export type ArchiveRecordInput = IdentityBinding &
334:export function createArchiveRecord(input: ArchiveRecordInput): ArchiveRecord {
345:  }) as ArchiveRecord;
349:export function parseArchiveRecord(value: unknown): ArchiveRecord {
358:  return immutableCopy(record) as ArchiveRecord;
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/contracts.ts
// Optional archive contracts; no runtime workflow or resource catalog authority.
import {
  canonicalJson,
  hashCanonical,
} from "../../server/src/shared/utils/hash.ts";

type RecordKind =
  "task" | "suite" | "trial" | "grade" | "promotion" | "evidence";
type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | JsonObject;
```

### File: evaluations/core/archive.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/archive.ts
-rw-r--r-- 1 minipuft minipuft 9851 Oct  7 10:46 /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/archive.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/archive.ts
321 /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/archive.ts
$ rg -n class /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/archive.ts
163:export class EvaluationArchive {
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/archive.ts
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import {
  canonicalJson,
  hashBytes,
  hashCanonical,
} from "../../server/src/shared/utils/hash.ts";
import { parseArchiveRecord, parseContentRef } from "./contracts.ts";
```

### File: evaluations/README.md

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/evaluations/README.md
-rw-r--r-- 1 minipuft minipuft 17545 Oct  7 10:46 /home/minipuft/Applications/claude-prompts-mcp/evaluations/README.md
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/evaluations/README.md
278 /home/minipuft/Applications/claude-prompts-mcp/evaluations/README.md
$ rg -n Setup and checks /home/minipuft/Applications/claude-prompts-mcp/evaluations/README.md
12:## Setup and checks
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/evaluations/README.md
# Optional evaluation evidence archive

This private, repository-local Node24 TypeScript package provides immutable evaluation
records, content-addressed evidence blobs and private gate-suite contracts. Use it
explicitly from a checkout; it does not join the root workspace or default server startup.
Its generic [contracts](core/contracts.ts) and [archive](core/archive.ts) import the existing
[canonical hash source](../server/src/shared/utils/hash.ts) outside this directory, so
the package is not an independently published library. Gate specialization also uses
the server's locked dependencies and source loader; this package adds no dependency or
separate model-provider SDK.
```

### File: evaluations/package.json

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/evaluations/package.json
-rw-r--r-- 1 minipuft minipuft 549 Oct  7 10:46 /home/minipuft/Applications/claude-prompts-mcp/evaluations/package.json
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/evaluations/package.json
16 /home/minipuft/Applications/claude-prompts-mcp/evaluations/package.json
$ rg -n test /home/minipuft/Applications/claude-prompts-mcp/evaluations/package.json
11:    "test": "npm run test:core && npm run test:gates",
12:    "test:core": "node --test tests/*.test.ts",
13:    "test:gates": "node --import ../server/node_modules/tsx/dist/loader.mjs --test gates/*.test.ts",
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/evaluations/package.json
{
  "name": "@claude-prompts/evaluations",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Opt-in repository-local evaluation evidence contracts and archive.",
  "engines": {
    "node": ">=24.0.0"
  },
  "scripts": {
```

### File: hooks/README.md

````text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/README.md
-rw-r--r-- 1 minipuft minipuft 10738 Sep 19 22:43 /home/minipuft/Applications/claude-prompts-mcp/hooks/README.md
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/README.md
220 /home/minipuft/Applications/claude-prompts-mcp/hooks/README.md
$ rg -n gate-enforce.py /home/minipuft/Applications/claude-prompts-mcp/hooks/README.md
40:| Ignores FAIL verdict             | `gate-enforce.py`       | Blocks until criteria addressed        |
71:### `gate-enforce.py` (PreToolUse)
108:  | python3 hooks/gate-enforce.py | jq '.hookSpecificOutput.permissionDecision'
113:  | python3 hooks/gate-enforce.py
176:            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.py\""
204:├── gate-enforce.py         # PreToolUse - gate verdict enforcement
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/README.md
# Claude Prompts Hooks

Behavior guardrails for Claude when using the prompt engine. Catches missed `>>` syntax, forgotten chain continuations, and skipped gate reviews.

## Quick Start

```bash
# Add the marketplace (first time only)
/plugin marketplace add minipuft/minipuft-plugins
````

### File: docs/guides/gates.md

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/docs/guides/gates.md
-rw-r--r-- 1 minipuft minipuft 34114 Oct  8 15:15 /home/minipuft/Applications/claude-prompts-mcp/docs/guides/gates.md
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/docs/guides/gates.md
571 /home/minipuft/Applications/claude-prompts-mcp/docs/guides/gates.md
$ rg -n semantic_evaluation /home/minipuft/Applications/claude-prompts-mcp/docs/guides/gates.md
16:| `semantic_evaluation`  | Validates a structured report against frozen criteria, server-issued binding, captured target, and required evidence.                                                                                                                                                                                                   | Semantic report contract acceptance | Boolean, category, or anchored-score requirements; model correctness remains unknown.            |
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/docs/guides/gates.md
# Gates Guide

Gates provide review guidance or evaluate criteria. What they enforce depends on the execution
shape and the gate's declared enforcement mode.

## Enforcement Modes

Every gate in a `gate.yaml` declares one or more `pass_criteria` entries; the `type:` field selects the enforcement mode. Five modes exist, and they differ in **what the runtime actually does** when the gate fires — not all are equally enforced. A gate is a `check` when at least one criterion is `shell_verify` or `script_tool`; a semantic-only gate is an `evaluation`, and gates without either component are `reminder` gates. Mixed gates retain both requirements with the `check` tier (see [Gate Configuration Reference § Tiers](../reference/gate-configuration.md#tiers)).

| `type:`                | What runs at execution time                                                                                                                                                                                                                                                                                             | Enforcement strength                | Use for                                                                                          |
```

### File: docs/reference/client-capabilities.md

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/docs/reference/client-capabilities.md
-rw-r--r-- 1 minipuft minipuft 3780 Jul 31 22:21 /home/minipuft/Applications/claude-prompts-mcp/docs/reference/client-capabilities.md
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/docs/reference/client-capabilities.md
57 /home/minipuft/Applications/claude-prompts-mcp/docs/reference/client-capabilities.md
$ rg -n Codex /home/minipuft/Applications/claude-prompts-mcp/docs/reference/client-capabilities.md
21:| Codex          | `~/.codex/config.toml`                                                    | TOML (`[mcp_servers.*]`)       |
35:| Codex / Cursor / Windsurf / Zed | no dedicated hooks package in this repo | MCP tools only |
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/docs/reference/client-capabilities.md
# Client Capabilities Reference

Lookup table for client presets, handoff profiles, and integration limits.

## Client Presets

| `--client` value | Handoff profile      | Status               | Primary behavior                                       |
| ---------------- | -------------------- | -------------------- | ------------------------------------------------------ |
| `claude-code`    | `task_tool_v1`       | canonical            | Task tool style guidance                               |
| `codex`          | `spawn_agent_v1`     | canonical            | `spawn_agent`-oriented handoff guidance                |
```

### File: .claude/rules/extension-alignment.md

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/.claude/rules/extension-alignment.md
-rw-r--r-- 1 minipuft minipuft 2572 Aug 23 15:49 /home/minipuft/Applications/claude-prompts-mcp/.claude/rules/extension-alignment.md
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/.claude/rules/extension-alignment.md
52 /home/minipuft/Applications/claude-prompts-mcp/.claude/rules/extension-alignment.md
$ rg -n Distribution Boundaries /home/minipuft/Applications/claude-prompts-mcp/.claude/rules/extension-alignment.md
14:## Distribution Boundaries
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/.claude/rules/extension-alignment.md
---
paths:
  - "hooks/**"
  - ".claude-plugin/**"
  - "manifest.json"
  - "mcp.json"
  - "server/scripts/synchronize-downstream-lock.js"
---

# Multi-Platform Extension Alignment
```

### File: docs/architecture/overview.md

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/docs/architecture/overview.md
-rw-r--r-- 1 minipuft minipuft 59494 Oct  5 04:38 /home/minipuft/Applications/claude-prompts-mcp/docs/architecture/overview.md
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/docs/architecture/overview.md
959 /home/minipuft/Applications/claude-prompts-mcp/docs/architecture/overview.md
$ rg -n Architecture /home/minipuft/Applications/claude-prompts-mcp/docs/architecture/overview.md
1:# Architecture Guide
101:| **3-Tool Architecture**      | Token economy: fewer tools = less context overhead              |
167:### MCP Tool Architecture
236:### Component Architecture
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/docs/architecture/overview.md
# Architecture Guide

How a prompt goes from what you type to a structured, validated response — and where each piece plugs in.

**Read this when** you want to understand the system internals: how requests flow, where validation and reasoning guidance get injected, and which files to look at when debugging or extending.

**You'll learn**

- How a request flows: Client → Transport → Pipeline → Response
- Where validation rules (gates), reasoning guidance (frameworks), and formatting (styles) get applied
```

### File: /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py

```text
$ ls -la /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py
-rw-r--r-- 1 minipuft minipuft 36219 Oct  6 01:44 /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py
$ wc -l /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py
524 /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py
$ rg -n def  /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py
35:def parent_id(value):
46:def sum_usage(usages):
50:def collect(config: Path, root_session: str | None) -> dict:
100:def pricing(usage: dict) -> dict:
118:def quota_exhausted(stream: Path, errors: Path) -> bool:
128:    def __init__(self, process, raw, deadline):
134:    def send(self, method, params=None, request=True):
142:    def read(self):
160:    def call(self, method, params):
171:def compact(root: Path, arm: str, timeout: int) -> dict:
226:def task_stages(task, prompt):
233:def stage_transition(task: str, index: int, behavior_case: dict | None = None) -> str:
239:def behavior_boundary(usage: dict, observed: dict) -> dict:
248:def run_cell(base: Path, task: str, arm: str, ref: str | None, identity=None, *, task_timeout_seconds=None, behavior_case=None, observer_limits=None) -> dict:
357:def own_turn_evidence(rows, sid, native_completed=()):
365:def native_module_actions(rows, sid):
385:def audit_record(record):
421:def audit_export(root: Path) -> dict:
457:def build_parser():
469:def parse_args(argv=None):
478:def main():
$ head -10 /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py
#!/usr/bin/env python3
"""Execute authorized public tasks; retain native evidence privately outside Git."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
```

### File: /home/minipuft/.claude/evaluations/configurations/codex_configure.py

```text
$ ls -la /home/minipuft/.claude/evaluations/configurations/codex_configure.py
-rw-r--r-- 1 minipuft minipuft 24764 Oct  5 00:15 /home/minipuft/.claude/evaluations/configurations/codex_configure.py
$ wc -l /home/minipuft/.claude/evaluations/configurations/codex_configure.py
376 /home/minipuft/.claude/evaluations/configurations/codex_configure.py
$ rg -n def  /home/minipuft/.claude/evaluations/configurations/codex_configure.py
21:def environment(home: Path = shared.ORIGINAL_HOME, runtime: dict | None = None) -> dict:
27:def toolchain(binary: Path | None = None) -> dict:
40:def controls(benchmark: dict | None = None) -> str:
51:def run_private(root: Path, name: str, manifest: dict, command: list, timeout: int = 30) -> subprocess.CompletedProcess:
57:def projection(root: Path, name: str, manifest: dict) -> dict:
78:def prepare(root: Path, fixture: Path, *, benchmark: dict | None = None) -> dict:
138:def integrity(root: Path, manifest: dict) -> None:
155:def verify(root: Path) -> dict:
211:def records(lines: list[str]) -> tuple[list, int]:
224:def rollout_evidence(config: Path, session_id: str | None) -> dict:
249:def observation(lines: list[str], code: int, evidence: dict, expected: str | None) -> dict:
271:def launch(root: Path, arm_name: str, prompt: Path, stage: str, resume: bool, timeout: int, *, observer=None, transition=None, public_prompt_sha256=None, deadline=None) -> dict:
347:def main() -> None:
$ head -10 /home/minipuft/.claude/evaluations/configurations/codex_configure.py
#!/usr/bin/env python3
"""Prepare, verify offline, and explicitly launch isolated Codex downstream arms."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
```

### Stop-test correction

```text
$ rg -n 'def test|pending|chain' hooks/tests/test_ralph_stop.py
41:    def test_passing_command(self):
47:    def test_failing_command(self):
53:    def test_command_with_output(self):
58:    def test_command_with_stderr(self):
63:    def test_timeout(self):
69:    def test_truncates_long_output(self):
75:    def test_working_directory(self, tmp_path):
80:    def test_invalid_command(self):
86:    def test_basic_formatting(self):
103:    def test_timeout_feedback(self):
117:    def test_uses_stdout_when_no_stderr(self):
133:    def test_extracts_from_state(self):
138:    def test_extracts_from_top_level(self):
143:    def test_generates_new_when_missing(self):
149:    def test_sets_environment_variable(self):
156:    def test_defaults_when_no_config(self, patch_workspace):
165:    def test_reads_custom_config(self, patch_workspace):
185:    def test_disabled_mode(self, patch_workspace):
199:    def test_corrupt_config_returns_defaults(self, patch_workspace):
229:    def test_stop_hook_active_allows(self):
233:    def test_no_verify_state_allows(self):
237:    def test_max_iterations_reached_allows(self):
248:    def test_verification_pass_allows(self, patch_workspace):
271:    def test_verification_fail_in_context_blocks(self):
301:    # test_delegation_pending_blocks removed — delegation handling
306:    """Stop is blocked exactly while the loader returns a chain state (R30, hook side).
314:    def _stop(self, chain_state):
321:                with patch.object(hook_mod, "load_recoverable_chain_state", autospec=True, return_value=chain_state):
331:            "chain_id": "chain-demo#1",
334:            "pending_gate": None,
335:            "pending_shell_verify": None,
340:    def test_a_run_held_past_its_end_by_a_shell_check_blocks_and_names_it(self):
341:        code, output = self._stop(self._state(4, 3, pending_shell_verify="npm test"))
349:    def test_a_run_held_past_its_end_with_nothing_pending_blocks_as_held(self):
355:        assert 'chain_id="chain-demo#1"' in output["reason"]
357:    def test_control_a_mid_chain_run_blocks_with_steps_remaining(self):
364:    def test_no_chain_state_allows_stop(self):
370:    def test_control_a_pending_gate_keeps_the_gate_review_message(self):
371:        code, output = self._stop(self._state(3, 3, pending_gate="code-quality"))
374:        assert output["reason"].startswith("Chain chain-demo#1 has a pending gate review (step 3/3).")
```

The file exists, but does not contain chain_block_reason; contract-specific Stop controls must be added, rather than claiming they already exist.

## Goals

```json
{
  "verified_paths": [
    {
      "file": "server/src/modules/chains/manager.ts",
      "exists": "yes",
      "line_count": 3370,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "collectActiveSessionRows",
          "expected_line": "unspecified",
          "actual_line": "763, 792",
          "drift": "none"
        }
      ]
    },
    {
      "file": "server/src/infra/database/sqlite-engine.ts",
      "exists": "yes",
      "line_count": 1639,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "current_step_review",
          "expected_line": "unspecified",
          "actual_line": "61, 1408",
          "drift": "none"
        }
      ]
    },
    {
      "file": "server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts",
      "exists": "yes",
      "line_count": 454,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "FrozenReviewProjection",
          "expected_line": "unspecified",
          "actual_line": "190, 199, 282",
          "drift": "none"
        }
      ]
    },
    {
      "file": "server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts",
      "exists": "yes",
      "line_count": 394,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "semanticReviewAction",
          "expected_line": "unspecified",
          "actual_line": "186, 202, 228",
          "drift": "none"
        }
      ]
    },
    {
      "file": "server/src/engine/execution/formatting/response-assembler.ts",
      "exists": "yes",
      "line_count": 1619,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "buildChainFooter",
          "expected_line": "unspecified",
          "actual_line": "170, 460",
          "drift": "none"
        }
      ]
    },
    {
      "file": "server/src/engine/gates/services/gate-verdict-processor.ts",
      "exists": "yes",
      "line_count": 1346,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "handleGateAction",
          "expected_line": "unspecified",
          "actual_line": "378, 482",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/gate-enforce.py",
      "exists": "yes",
      "line_count": 177,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "def main",
          "expected_line": "unspecified",
          "actual_line": "64",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/post-prompt-engine.py",
      "exists": "yes",
      "line_count": 147,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "def main",
          "expected_line": "unspecified",
          "actual_line": "37",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/lib/session_state.py",
      "exists": "yes",
      "line_count": 350,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "format_chain_reminder",
          "expected_line": "unspecified",
          "actual_line": "293",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/lib/db_reader.py",
      "exists": "yes",
      "line_count": 495,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "_view_row_to_hook_state",
          "expected_line": "unspecified",
          "actual_line": "329, 336",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/prompt-suggest.py",
      "exists": "yes",
      "line_count": 835,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "format_chain_reminder",
          "expected_line": "unspecified",
          "actual_line": "40, 795",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/compact-recovery.py",
      "exists": "yes",
      "line_count": 100,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "format_chain_reminder",
          "expected_line": "unspecified",
          "actual_line": "24, 62",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/ralph-stop.py",
      "exists": "yes",
      "line_count": 636,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "chain_block_reason",
          "expected_line": "unspecified",
          "actual_line": "357, 412",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/hooks.json",
      "exists": "yes",
      "line_count": 91,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "gate-enforce",
          "expected_line": "unspecified",
          "actual_line": "10, 11",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/lib/_generated/resolution_verbs.py",
      "exists": "yes",
      "line_count": 12,
      "is_shim": "no: generated Python data vocabulary",
      "target_symbols": [
        {
          "symbol": "PENDING_RUN_RESOLUTION_PARAMS",
          "expected_line": "unspecified",
          "actual_line": "6",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/tests/test_gate_enforce_verdict.py",
      "exists": "yes",
      "line_count": 165,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "gate_verdict",
          "expected_line": "unspecified",
          "actual_line": "4, 54, 71, 81, 114, 149",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/tests/test_post_prompt_engine_clearing.py",
      "exists": "yes",
      "line_count": 139,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "pending_gate",
          "expected_line": "unspecified",
          "actual_line": "5, 81, 127, 129, 139",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/tests/test_db_reader.py",
      "exists": "yes",
      "line_count": 1205,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "def test",
          "expected_line": "unspecified",
          "actual_line": "211, 216, 221, 240, 269, 277",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/tests/test_session_tracker.py",
      "exists": "yes",
      "line_count": 201,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "def test",
          "expected_line": "unspecified",
          "actual_line": "21, 28, 37, 50, 65, 75",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/tests/test_ralph_stop.py",
      "exists": "yes",
      "line_count": 375,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "def test",
          "expected_line": "unspecified",
          "actual_line": "41, 47, 53, 58, 63, 69",
          "drift": "initial symbol absent; test-anchor corrected"
        }
      ]
    },
    {
      "file": "hooks/tests/test_unknown_interrupt_hold.py",
      "exists": "yes",
      "line_count": 254,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "def test",
          "expected_line": "unspecified",
          "actual_line": "119, 124, 137, 142, 156, 172",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/tests/test_codex_client_seams.py",
      "exists": "yes",
      "line_count": 139,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "def test",
          "expected_line": "unspecified",
          "actual_line": "36, 41, 51, 61, 72, 78",
          "drift": "none"
        }
      ]
    },
    {
      "file": "server/tests/e2e/claims-conformance.test.ts",
      "exists": "yes",
      "line_count": 629,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "ScenarioSetupError",
          "expected_line": "unspecified",
          "actual_line": "53, 262, 301, 334, 444",
          "drift": "none"
        }
      ]
    },
    {
      "file": "scripts/codex-dev-plugin.mjs",
      "exists": "yes",
      "line_count": 658,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "stageDevPlugin",
          "expected_line": "unspecified",
          "actual_line": "535",
          "drift": "none"
        }
      ]
    },
    {
      "file": "scripts/codex-server.mjs",
      "exists": "yes",
      "line_count": 754,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "async function",
          "expected_line": "unspecified",
          "actual_line": "160, 169, 206, 288, 324, 376",
          "drift": "none"
        }
      ]
    },
    {
      "file": "evaluations/core/contracts.ts",
      "exists": "yes",
      "line_count": 359,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "ArchiveRecord",
          "expected_line": "unspecified",
          "actual_line": "78, 79, 334, 345, 349, 358",
          "drift": "none"
        }
      ]
    },
    {
      "file": "evaluations/core/archive.ts",
      "exists": "yes",
      "line_count": 321,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "class",
          "expected_line": "unspecified",
          "actual_line": "163",
          "drift": "none"
        }
      ]
    },
    {
      "file": "evaluations/README.md",
      "exists": "yes",
      "line_count": 278,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "Setup and checks",
          "expected_line": "unspecified",
          "actual_line": "12",
          "drift": "none"
        }
      ]
    },
    {
      "file": "evaluations/package.json",
      "exists": "yes",
      "line_count": 16,
      "is_shim": "no: package metadata",
      "target_symbols": [
        {
          "symbol": "test",
          "expected_line": "unspecified",
          "actual_line": "11, 12, 13",
          "drift": "none"
        }
      ]
    },
    {
      "file": "hooks/README.md",
      "exists": "yes",
      "line_count": 220,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "gate-enforce.py",
          "expected_line": "unspecified",
          "actual_line": "40, 71, 108, 113, 176, 204",
          "drift": "none"
        }
      ]
    },
    {
      "file": "docs/guides/gates.md",
      "exists": "yes",
      "line_count": 571,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "semantic_evaluation",
          "expected_line": "unspecified",
          "actual_line": "16",
          "drift": "none"
        }
      ]
    },
    {
      "file": "docs/reference/client-capabilities.md",
      "exists": "yes",
      "line_count": 57,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "Codex",
          "expected_line": "unspecified",
          "actual_line": "21, 35",
          "drift": "none"
        }
      ]
    },
    {
      "file": ".claude/rules/extension-alignment.md",
      "exists": "yes",
      "line_count": 52,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "Distribution Boundaries",
          "expected_line": "unspecified",
          "actual_line": "14",
          "drift": "none"
        }
      ]
    },
    {
      "file": "docs/architecture/overview.md",
      "exists": "yes",
      "line_count": 959,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "Architecture",
          "expected_line": "unspecified",
          "actual_line": "1, 101, 167, 236",
          "drift": "none"
        }
      ]
    },
    {
      "file": "/home/minipuft/.claude/evaluations/configurations/codex_benchmark.py",
      "exists": "yes",
      "line_count": 524,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "def ",
          "expected_line": "unspecified",
          "actual_line": "35, 46, 50, 100, 118, 128",
          "drift": "none"
        }
      ]
    },
    {
      "file": "/home/minipuft/.claude/evaluations/configurations/codex_configure.py",
      "exists": "yes",
      "line_count": 376,
      "is_shim": "no: source/tests/docs/collector implementation",
      "target_symbols": [
        {
          "symbol": "def ",
          "expected_line": "unspecified",
          "actual_line": "21, 27, 40, 51, 57, 78",
          "drift": "none"
        }
      ]
    }
  ],
  "drift_summary": {
    "files_with_major_drift": 1,
    "shims_detected": [],
    "fields_to_add": "No new field selected; contract task must freeze minimal projection and trace its consumers."
  },
  "revision_required": true,
  "revised_paths_block": "hooks/tests/test_ralph_stop.py exists but its old expected chain_block_reason symbol is absent; use actual test anchors and add contract-specific Stop controls. Generated resolution_verbs.py is 12-line data, not a compat shim. All other selected paths exist with matched symbols. Existing execution-plan copies in the linked worktree are absent; primary plan paths are authoritative for this planning output."
}
```

## Execution

Executed batched read-only filesystem/stat/line-count/symbol/head probes against 36 existing files; corrected one test-symbol reference without changing source. Raw outputs are retained in plans/workflow-client-evaluation-2026-10-09-path-evidence.md. The implementation table may use these existing paths and the corrected Stop-test anchor; new workflow-specific runner paths will be explicitly marked creation with justification. No implementation test, model invocation, source edit or installation was performed.
