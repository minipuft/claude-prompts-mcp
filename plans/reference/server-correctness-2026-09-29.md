---
title: Claude Prompts MCP server correctness remediation
date: 2026-09-29
type: implementation-plan
status: reference
tags: []
initiative_branch: fix/server-review-delegation-schema
worker_cap: 3
planner_session: server-correctness-plan
tracking: none
tracking_reason: local-only
publish: push+merge
publish_date: 2026-09-30
publish_ruling: user explicitly authorized proceeding and merging
---

# Claude Prompts MCP server correctness remediation

Decision owner: [ADR0002](../docs/adr/0002-schema-downgrade-refusal.md). Evidence ledger: [implementation notes](./server-correctness-2026-09-29-implementation-notes.md).

## Now (2026-09-30)

Goal: remediate D1–D6 from the supplied diagnostic conversation.
Slice: all28 rows accepted against current main schema34; source checks green and all attributed E2E failures corrected.
Next decision: clean delivery ancestry, final checks, PR publication and squash merge. User authorized push+merge; shared-client activation remains separate.
Constraint: isolated linked worktrees; preserve concurrent main edits and original shared database.
Scope: server correctness; plugin activation/synchronization stays with the existing development-setup initiative.

## Decisions to review first

1. **Preserve advisory first-render single prompts.** A gate ID or declared blocking mode is not evidence of a durable review. Mandatory verdict instructions require an actual pending review. Enforced strategic work uses compiled workflows. A single prompt can acquire a genuine deferred review after a submitted FAIL; preserve that path.
2. **Distinguish classification, reminder attestation and execution evidence.** Real gate definitions determine reminder/check tiers. Only recorded runner results support claims that checks executed. Advisory guidance must say that single prompts do not run criteria, and must not demand a verdict.
3. **Preserve current request identity and authored worker instructions in the initial gated render.** Match the normal path's visibility and framework deduplication. Retry remains an intentionally abbreviated review, not another worker dispatch.
4. **Codex inherits the host model unless a supported mapping is supplied.** This plan introduces no mapping protocol or static host model catalog. Generic heavy/standard/fast values remain advisory prose, outside executable invocation parameters.
5. **Five worker headings describe the work product; HANDOFF RESULT is its required transport envelope.** Reconcile the actual MCP-managed worker text with the existing mandatory trailer. Verify the actual injected framework text; the evidence does not establish that the framework's template suggestion reached the brief or caused structural rejection.
6. **Refuse a newer schema before schema/view/repair mutation.** Replace the explicitly documented downgrade-and-recreate policy. Preserve fresh/current/older upgrade behavior and durable restoration. No schema bump. An unreadable or malformed version authority must not silently become version zero.
7. **Recovery is separate from prevention.** A patched engine cannot retrofit old schema-23 binaries or protect already-loaded processes from their DDL. Coordinate incompatible writers and a coherent backup before recovering the shared runtime. Never delete the live DB or apply a one-column repair.

## Scope and evidence

Repository: /home/minipuft/Applications/claude-prompts-mcp, main at 46a4b814631d346ed92e97dff2c5569194e0f48d during inspection. Existing concurrent hook, development script, documentation and prompt edits were preserved. This local draft adds only planning documentation to the checkout; the receiving initiative can bind it without changing concurrent source edits. No push, merge, Issue or plugin activation authorization is implied.

The supplied attachment is a complete historical diagnostic conversation, not an implementation spec by itself. Its last user instruction requests diagnosis and a handoff to the setup thread; its final server-issues-handoff names D1–D6. Current source audits confirm those mechanisms. A fresh in-memory formatter probe found:

- advisory/no pending review: Review Required=true, per_gate=true, reminders=false;
- terminal single: Execution complete=true, Continue=true.

Historical 7-suite/129-test/3-snapshot results and the actual three-worker total=5 control remain historical baseline evidence. No source test suite ran in this planning session. Fresh inspections are source/path checks, an in-memory formatter probe, MCP resource inspection and read-only SQLite/process inventory.

The shared checkout DB still reports schema23 (applied 2026-09-30 03:36:18 UTC), while source/dist expect33. It contains 36 version_history rows; skills_sync_manifests has zero rows; objects/version_entries are absent; chain_runs.handoff_token and later node columns are absent. Eleven processes held it during the read-only snapshot. Exact downgrade launcher and whether absent object tables previously held rows remain unknown. Do not claim proven historical data loss.

The installed connector used by this planning chain succeeds and reports a cached codex-prompts-dev/0.1.3 engine with resource_root pointing to checkout server/resources/prompts. Its success does not prove the checkout DB recovered.

Existing commitment overlap: plans/technical-debt/resource-surface-consolidation-2026-08-27.md row P4.141 already asks for honest single-prompt judge/review behavior. Receiving planner should bind Tier2 receipts to that row rather than run a competing slice. Delegation-handoff and cross-client-chain-handoff plans remain canonical prior decisions. This local backlog draft does not change their statuses or inherit their publish authorization.

Non-goals: new single-prompt criteria execution, globally blocking prompts, a new guidance coordinator, a parallel catalog/state machine, new model-capability protocol, plugin/hook activation, global rule portability, uncoordinated live DB migration, or release delivery.

## Ownership and consequences

| Contract                 | Writes                                                                                                                     | Reads/decides                                                                          | Projects                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Review state             | GateEnforcementAuthority.createReview; ChainSessionStore.setReview awaits persistence; deferred GateVerdictProcessor entry | Session stage, capture advanceUnlessHeld, verdict processor                            | ResponseAssembler required/exhausted actions and history              |
| Gate tier                | canonical deriveGateTier and authority deriveGateTiers; renderer reads actual definitions                                  | createReview for ordinary/deferred/detached paths; stage20 evidence enrichment         | reminders vs per_gate template; guidance sections                     |
| Guidance execution shape | GateEnhancementService single/chain context; operator review rendering                                                     | GateGuidanceRenderer; explicit CompositionalGateService reconstruction must forward it | advisory caveat or review instructions; operator fallback attestation |
| Completion               | stage18 writes chainComplete from lifecycle                                                                                | single and chain CTA builders                                                          | no Continue/review action at terminal state; Re-run remains           |
| Request identity         | identity resolver/stage03 state from trusted launch/request inputs                                                         | stages18/20 -> operator.extractClientProfile -> strategy                               | spawn_agent vs Task and host-specific invocation prose                |
| Worker content           | convertedPrompt system/user content plus framework guidance                                                                | normal and initial review assembly; visibility/dedup                                   | EXECUTION BRIEF; parent Summary/Gate Coverage stays outside           |
| Model hint               | authored prompt/step/workflow hint, brief fallback                                                                         | DelegationStrategy.resolveModel/formatToolCall and renderer                            | supported invocation fields plus separate advisory tier prose         |
| Handoff evidence         | canonical handoff-contract producer/parser; worker echoes rendered node token                                              | resume/capture and detached routing                                                    | five headings plus trailer; named node accepted or refused            |
| Schema authority         | SqliteEngine initializes once; legacy engines may recreate                                                                 | initialize/ensureSchema/getSchemaVersion; module initializer startup                   | startup refusal path+observed/supported version; both transports      |

No new database columns are required. Prefer the existing pendingReview.gateTiers extension point over introducing another persisted classifier. If advisory formatting needs execution-shape metadata, add a narrow optional GateContext field such as criteriaExecution: guidance-only | pipeline and explicitly forward every producer/reconstruction listed above. Default must not imply recorded results. The worker determines the smallest shape after sibling search and type probing.

## Read before implementation

All existing paths below were verified; literal filesystem/symbol receipts are reproduced in the appendix and retained in the linked diagnostic evidence. Key anchors:

- server/src/infra/database/sqlite-engine.ts: initialize599, ensureSchema760, getSchemaVersion1544; durable declarations in table-contracts.ts.
- server/src/runtime/module-initializer.ts: claimStateDatabase119; runtime/paths.ts reads MCP_RUNTIME_ROOT192.
- server/src/engine/gates/services/gate-enhancement-service.ts: enhanceSinglePrompt232; publish mode344.
- server/src/engine/execution/pipeline/stages/13-session-stage.ts: review creation; 18-execution-stage.ts: completion75 and identity262–263; 20-gate-review-stage.ts: evidence176 and review context369.
- server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts: createPendingReview274, createReview304, createReviewForStep336, deriveGateTiers437.
- server/src/engine/gates/services/gate-verdict-processor.ts: answerVerdict602; capture/step-capture-service.ts: advanceUnlessHeld.
- server/src/engine/gates/guidance/GateGuidanceRenderer.ts: GATE_ATTESTATION_LINE34; services/compositional-gate-service.ts: context reconstruction56.
- server/src/engine/execution/formatting/response-assembler.ts: resolveGateTiers1136, appendGateAction1339, appendSessionAction1441.
- server/src/engine/execution/operators/chain-operator-executor.ts: renderGateReviewStep93, worker content318, normal systemMessage500, fallback637, profile extraction891.
- server/src/engine/execution/delegation/{strategy.ts,renderer.ts,types.ts,handoff-contract.ts}; CodexStrategy171, model resolution174; shared/types/request-identity.ts: RequestClientProfile21.
- server/src/engine/frameworks/declared-sections.ts: framework_gates opt-out89; real strategic_worker resources and cageerf framework under server/resources.
- docs/guides/gates.md:17; docs/architecture/sqlite-persistence.md:459; existing test paths in the tables.

## Design critique and pre-flight

evaluation_type: critique. Diagnosis: rendering infers review and verified execution from gate intent, while persistence and request metadata follow different paths. Fix authoritative state/dataflow at existing owners.

Chosen: in-place owner changes plus real-pipeline regressions. Rejected: globally block singles, change strategy's fallback to hide missing identity, replace Codex aliases with another static list, remove handoff evidence, or reset the DB. These alternatives conceal a boundary defect or enlarge the feature.

Domain/defined/service/layer probes identify existing owners; no new production service is justified. Existing large assembler/operator/engine files warrant narrow responsibilities and cognitive-complexity checks on changed functions. Complexity and source/test typechecks are not claimed passed during planning; they must run against implementation. Persistence currently fails the intended downgrade safety contract. No new dependency/API choice is planned; any new node:sqlite API used for backup or compatibility needs version-pinned documentation verification then.

## Tier 1 — Prevent future guarded-engine downgrades

Each worker owns only the paths in its File cell. Approximate line ranges are scoping estimates, not acceptance targets; >10 files or a changed boundary requires a revised brief.

| #   | St                                                                              | File                                                                                                                                   | Change                                                                                                                                                                                                 | ~Lines  | Depends  | Verify                                                                                                                          | Justification                                                                          |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1.1 | ✓ 2026-09-30 · e9b3ae4d4/a08d43d04; 29 controls and guard mutation              | server/src/infra/database/sqlite-engine.ts                                                                                             | Extend version-read/initialize boundary: refuse newer schema before schema/view/repair writes; distinguish absent from malformed/unreadable authority; close failed handle; report path and versions.  | 40–100  | —        | Real-file newer and malformed authority fixtures remain readable unchanged after refusal; fresh/current/older control succeeds. | Existing schema owner; no version bump or ad-hoc column repair.                        |
| 1.2 | ✓ 2026-09-30 · b8bf70e61; 35 passing DB controls and byte-preservation mutation | server/tests/integration/database/sqlite-backend.test.ts; existing durable-round-trip.test.ts and schema-v29.test.ts in same directory | Add ≤6 real-file cases; seed known durable rows and unknown sentinel table, compare schema/data before and after refused initialization, prove connection cleanup; retain upgrade round-trip controls. | 120–220 | 1.1      | Target these integration suites; neutering refusal fails preservation assertion; fresh/current/older controls pass.             | Existing DB fixture infrastructure observes actual mutation, rather than mocking exec. |
| 1.3 | ✓ 2026-09-30 · bae2e05f0; docs policy/backup/links verified                     | docs/architecture/sqlite-persistence.md; docs/guides/troubleshooting.md                                                                | Replace accepted-downgrade policy; document legacy-binary limits, runtime-root isolation, coherent backup/inventory and declared ephemeral resets.                                                     | 50–100  | 1.1, 1.2 | Read policy against guard tests and table-contracts; no instruction deletes live DB or claims old binaries gained protection.   | The current downgrade behavior is documented, so the policy must move with code.       |

Tier1 gate: scoped database integration checks plus table-contract validation. Guard/test/doc merge is independently reviewable. Live recovery is deliberately Tier4; isolated fixes and fixtures can proceed while the shared runtime is coordinated.

## Tier 2 — Truthful guidance, actual reviews and terminal actions

| #   | St                                                                                   | File                                                                                                                                                                                                                                                                                                      | Change                                                                                                                                                                                                                             | ~Lines                        | Depends       | Verify                                                                                                                                                                                                         | Justification                                                                                                |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 2.1 | ✓ 2026-09-30 · 69a926cb2/d5c2b6a4d; typecheck/twins/hooks; legacy expectations2.4    | server/src/engine/gates/core/gate-definitions.ts; services/compositional-gate-service.ts; services/gate-enhancement-service.ts; guidance/GateGuidanceRenderer.ts (latter three under server/src/engine/gates); server/src/engine/execution/operators/chain-operator-executor.ts                           | Carry narrow guidance execution shape through single/chain and explicit context reconstruction; qualify unconditional attestation and operator fallback. Preserve gate definitions and reasoning guidance.                         | 60–140                        | —             | Real loaded reminder/check definitions through enhancer -> compositor -> renderer; advisory output says criteria not executed and offers no mandatory attestation. Restore unconditional line and probe fails. | Footer-only correction would leave contradictory earlier guidance.                                           |
| 2.2 | ✓ 2026-09-30 · d686c4305; five lifecycle probes; fixture updates2.4                  | server/src/engine/execution/formatting/response-assembler.ts                                                                                                                                                                                                                                              | Required/exhausted CTA from actual pending review IDs; advisory/no-review has no verdict demand; terminal single suppresses Continue and review actions, retains Re-run; preserve chain footer and deferred single review.         | 25–75                         | 2.1           | Formatter controls for advisory, genuine review, exhausted review, terminal single and chain; restored ID-based CTA/completion omission fails separate assertions.                                             | Reuse lifecycle authority rather than change advancement to interpret prose.                                 |
| 2.3 | ✓ 2026-09-30 · 6e9137e24; 47 controls and four real-resource probes                  | server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts                                                                                                                                                                                                                        | Populate existing review gateTiers through canonical deriveGateTiers at common creation boundary; preserve supplied tiers and actual check evidence; enumerate ordinary, post-advance, deferred and detached callers.              | 10–45                         | 2.2           | Loaded inline_guidance becomes reminder at real review creation; missing definition has honest fallback; stage20 enrichment agrees.                                                                            | Existing authority already derives detached tiers; no new classifier/state store.                            |
| 2.4 | ✓ 2026-09-30 · e0b2ae3cb; 112 focused controls; three distinct real-server mutations | server/tests/e2e/gate-enforcement-mode.e2e.test.ts; server/tests/e2e/gate-review-record-truth.e2e.test.ts; server/tests/unit/execution/formatting/response-assembler-cta.test.ts; response-assembler-chain-cta.test.ts in same directory; server/tests/unit/gates/guidance/gate-guidance-renderer.test.ts | Add 6–8 real-pipeline lifecycle scenarios and focused rendering regressions: advisory omitted verdict, explicit blocking chain omission/FAIL/PASS, genuine deferred single review, real reminder tiers, terminal response/history. | 180–350 incl. fixture updates | 2.1, 2.2, 2.3 | Assert persisted review/current node/terminal history plus actions; no manually seeded missing tier/flag as end-to-end proof; mutate CTA, tier forwarding and completion guard separately.                     | Existing lifecycle harness stubs enhancement; formatter seeds tiers. These gaps need runtime controls.       |
| 2.5 | ✓ 2026-09-30 · 53c329ac6; docs/examples schema validated                             | docs/guides/gates.md; docs/concepts/chains-lifecycle.md                                                                                                                                                                                                                                                   | Document advisory first render, deferred review, supported chain enforcement, reminder shape and classification vs criterion execution.                                                                                            | 35–70                         | 2.4           | Documentation examples match tested behavior, including reminders.satisfied/not_applicable and absent advisory verdict requirement.                                                                            | Completes existing P4.141 honesty alternative without expanding single criteria execution.                   |
| 2.6 | ✓ 2026-09-30 · 8b74bd8c; 384 equivalence combinations, 73 controls, no new warning   | server/src/engine/execution/formatting/response-assembler.ts                                                                                                                                                                                                                                              | Consolidate terminal/active action branching and duplicate return flow; preserve behavior and existing lint budget without line compression or suppression.                                                                        | 20–50                         | 2.4           | Focused lifecycle probes and renderer lint show no added rule count; source/type tests unchanged.                                                                                                              | Accepted lifecycle patch exposed max-lines advisory; address actual duplication rather than raising ceiling. |

Tier2 gate: scoped guidance/formatter and real gate E2E checks. Bind evidence to existing P4.141 when accepted; do not mark that parent row done merely because this draft exists.

## Tier 3 — Delegated rendering and worker contract

| #    | St                                                                                  | File                                                                                                                                                                                                                                                                                              | Change                                                                                                                                                                                                                                                                 | ~Lines                    | Depends       | Verify                                                                                                                                                                       | Justification                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | ✓ 2026-09-30 · fd9afc800; 79 controls, seven probes, three independent mutations    | server/src/engine/execution/pipeline/stages/20-gate-review-stage.ts; server/src/engine/execution/operators/chain-operator-executor.ts                                                                                                                                                             | Forward request-local identity/client profile like stage18; include nonempty authored systemMessage once in initial delegated review with matching dedup/visibility. Preserve abbreviated retry without redispatch.                                                    | 25–300 incl. moved code   | —             | Actual identity resolver -> session -> stages18/20 -> operator path retains distinctive system text and Codex spawn_agent; no renderer-only injected identity.               | Identity and content loss are independent defects.                                                                                |
| 3.2  | ✓ 2026-09-30 · 43737ae46; inherited Codex model; four hints and other-host controls | server/src/engine/execution/delegation/strategy.ts; server/src/engine/execution/delegation/renderer.ts                                                                                                                                                                                            | Omit unsupported executable Codex model override; emit declared heavy/standard/fast as advisory prose only; absent hint inherits host. Preserve other host strategy controls.                                                                                          | 20–65                     | 3.1           | Four hint states plus initial/normal renders; invocation omits generic alias model parameter, Claude/neutral controls remain intentional.                                    | No callable model map exists in RequestClientProfile.                                                                             |
| 3.3  | ✓ 2026-09-30 · db02c5653; isolated MCP version5/metadata equality/native exports    | MCP-owned server/resources/prompts/development/strategic_worker/prompt.yaml, system-message.md, user-message.md; generated export governed by server/skills-sync.yaml                                                                                                                             | Use resource_manager inspect -> preview -> update expected_version -> inspect receipt. Reconcile five work-product headings with demanded HANDOFF RESULT envelope, and authored format authority over framework reasoning. Regenerate skill via existing export owner. | 15–40 authored            | 3.1, 3.2      | Resource version/write receipt; rendered actual resource + CAGEERF keeps five-heading contract, trailer exception and framework_gates:false; exporter validates result.      | Direct prompt edits prohibited; deleting trailer would defeat working enforcement.                                                |
| 3.4  | ✓ 2026-09-30 · 10482cf10; 88 controls, three snapshots, four mutations              | server/tests/integration/pipeline/delegation-operator-flow.test.ts; server/tests/integration/chain/delegation-handoff-evidence.integration.test.ts; server/tests/unit/delegation/delegation-renderer.test.ts; server/tests/unit/execution/operators/chain-operator-executor-review-render.test.ts | Real pipeline identity/system-content controls, hint matrix, loaded authored worker/framework, retry policy, parent formatting outside brief, missing/wrong/valid rendered-token trailer controls.                                                                     | 180–300                   | 3.1, 3.2, 3.3 | Drop stage20 identity and system inclusion separately: distinct tests fail. Use fake-worker helper reading emitted token, never manufacture a valid token by seeding inputs. | Existing integration bypasses stage20; snapshot uses empty systemMessage.                                                         |
| 3.5  | ✓ 2026-09-30 · e0ecf7b67; both transport matrices and mutation verified             | NEW server/tests/e2e/delegated-review-client-parity.e2e.test.ts; existing delegated-brief-own-args.e2e.test.ts and helpers/delegation/fake-worker.ts are read-only patterns                                                                                                                       | Add one bounded cross-transport scenario matrix: first blocking delegated review -> omitted verdict hold -> FAIL retry -> accepted review -> subsequent normal delegate -> terminal completion, with real worker resource.                                             | 180–350 formatted lines   | 3.4           | STDIO + HTTP fresh per request; launcher/request identity inputs; resolved DB under unique MCP_RUNTIME_ROOT; node/history/review and exact delimited brief assertions.       | New file isolates shared cross-transport review behavior; own-args fixture tests another property. No new production abstraction. |
| 3.6  | ✓ 2026-09-30 · 8988789ff; model/envelope docs validated                             | docs/reference/chain-schema.md; docs/concepts/chains-lifecycle.md                                                                                                                                                                                                                                 | Explain advisory Codex tiers, actual model inheritance, initial/retry render contract and work-product/trailer boundary.                                                                                                                                               | 35–70                     | 3.5           | Examples reproduce tested invocation and actual resource output; no blanket claim generic alias invalid in every host.                                                       | Removes current documented Codex alias mapping mismatch.                                                                          |
| 3.7  | ✓ 2026-09-30 · b3c774ae0; release/ADR/comment-only checks                           | CHANGELOG.md; NEW docs/adr/0002-schema-downgrade-refusal.md; server/src/infra/database/sqlite-engine.ts (comment only)                                                                                                                                                                            | Add verified observable Fixed entries and Changed compatibility refusal entry; capture externally observable downgrade-policy decision in existing ADR template (git skill delivery contract).                                                                         | 8–15 changelog +50–80 ADR | 3.6           | Entries name observable behavior; compatibility change reviewed for required breaking-release signaling before delivery.                                                     | Downgrade policy is externally observable and must not be hidden as a cosmetic fix.                                               |
| 3.8  | ✓ 2026-09-30 · 1c6861804; lower lint ceilings and both ratchets pass                | server/.eslint-ratchet-baseline.json; server/.typecheck-tests-ratchet-baseline.json if existing diagnostics decrease                                                                                                                                                                              | Regenerate only measured lower ceilings after all source and regression changes via their owner scripts; no --allow-increase, no manual edits.                                                                                                                         | generated only            | 3.5           | lint:ratchet and typecheck:tests:ratchet pass; rule/file comparison shows no increased count.                                                                                | Measured changed-function complexity repair removes existing debt, so stale ceilings cannot remain.                               |
| 3.9  | ✓ 2026-09-30 · 179d5a46a +7d8a0bc8f; full unit/E2E pass                             | server/tests/unit/gates/services/gate-review-scoping.test.ts; server/tests/e2e/chain-prompt-sources.e2e.test.ts                                                                                                                                                                                   | Align stale reader fixtures and single-route snapshot with actual pending-review authority/advisory guidance; preserve writer/injection and chain expansion controls.                                                                                                  | ≤120 test diff lines      | 3.8           | Named scoping and formatter tests pass; source semantics unchanged, test-type debt nonincreasing.                                                                            | Full unit boundary found two implicit-review expectations outside prior focused suites.                                           |
| 3.10 | ✓ 2026-09-30 · a801558c5; exports446/check passes                                   | server/.knip-ratchet-baseline.json                                                                                                                                                                                                                                                                | Regenerate lower unused-export ceiling through owner script; no allow-increase or manual count edit.                                                                                                                                                                   | 1 file, ≤10 diff lines    | 3.9           | knip baseline generator and validate:knip-ratchet pass with all categories nonincreasing.                                                                                    | Full validation found one stale decreased ceiling.                                                                                |
| 3.11 | ✓ 2026-09-30 · 018c9c199; README and plan tracking pass                             | README.md; plans/interview-boundary-2026-09-27.md                                                                                                                                                                                                                                                 | Correct verified bundled prompt count51→52 and stamp four existing open rows without changing state, commitments or scope.                                                                                                                                             | 2 files, ≤20 diff lines   | 3.10          | validate:readme passes; validate:plan-row-tracking passes; literal changed lines and base attribution checked.                                                               | Necessary reversible metadata corrections for full repository validation, no runtime/source behavior change.                      |

Tier3 gate: scoped integration/delegation/E2E checks and fresh build. No shared-runtime launch. Parent accepts handoffs; source edits touching the same operator/assembler or fixture are serial despite independent conceptual concerns.

## Tier 4 — Coordinated runtime recovery and installed-client closure

Entry: receiving planner rules OQ1–OQ3 and receives coherent plugin-setup completion/provenance. Isolated acceptance does not depend on this gate; live closure does.

| #   | St                                                                                                         | File                                                                                                                 | Change                                                                                                                                                                                                                                                                                                                                | ~Lines        | Depends | Verify                                                                                                                                                                                                                    | Justification                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | ✓ 2026-09-30 · final guarded23→33 copy; durable hashes/shapes/integrity pass                               | External recovery evidence beside implementation-notes.md; no production source scope                                | Compare actual version/table shapes first; preserve coherent backup and every available durable byte, rehearse guarded initialization on a copy. Source was33 at first snapshot but final read-only check shows23 again, so rehearse23→33 on a new copy. No shared migration/restart performed; writer generations remain unverified. | 60–120 report | —       | All 36 history row contents/scopes and manifest seeds compared before/after; full expected columns and tables; missing prior object bytes recovered only from trustworthy backup; fresh request and durable read succeed. | Preventive source guard cannot repair or protect against unpatched old binaries. No plain DB copy while WAL active, deletion or guessed ALTER. |
| 4.2 | ✓ 2026-09-30 · isolated installed native-worker drive; full tests pass; repository gate separately blocked | External validation receipts and implementation-notes.md; installed plugin activation/sync owned by other initiative | Run rebuilt installed-client advisory negative control and three-node delegated positive control using delivered setup; record engine/hook/adapter/resource/runtime provenance. Verify missing trailer, missing verdict hold, reminder shape, initial/resumed Codex content, total=5, terminal no Continue and recorded reviews.      | 60–140 report | 4.1     | Actual installed client flow plus fresh-built STDIO/HTTP controls; separate hook delivery, reminder attestation, lifecycle enforcement and machine runner evidence.                                                       | Integration acceptance is consumer-observable, not healthy status or successful installation alone.                                            |

Final gate, once on the integrated green snapshot, inside server:

```sh
npm run typecheck
npm run lint:ratchet
npm run typecheck:tests:ratchet
npm run test:all
npm run validate:all
npm run build
npm run verify:mcp
```

Build and verify:mcp use a distinct MCP_RUNTIME_ROOT and assert resolved DB path before start. Keep canonical resources available. Do not run npm ci through linked worktree node_modules symlinks. Final live drive is row4.2; full suite and live consumer flow are separate evidence. PR creation is outside this planning request; future delivery must also run root pr:body/pr:check and use explicitly authorized publish scope.

## Tier 5 — Authorized delivery against current main

Current origin/main f6ffe92d4 is21 commits ahead of the original verified base and now supports schema34. Shared-tree integration owners do not stage, commit or move refs; parent owns the in-progress merge. Source validation must rerun on the combined snapshot; earlier33 migration receipts remain historical.

| #   | St                                                                    | File                                                                                                                                                                       | Change                                                                                                                                                     | Bounds                               | Depends | Verify                                                                                            | Dispatch                                              |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 5.1 | ✓ 2026-09-30 · shared-tree; sourceType0/198focusedtests               | server/src/engine/execution/formatting/response-assembler.ts; server/src/engine/execution/operators/chain-operator-executor.ts                                             | Preserve current-main grade-before-advance, node-step ownership, exhausted review/retry behavior and all D1–D6 content/identity/CTA fixes.                 | 2 files; ≤200 nonconflict diff lines | —       | Named formatter/operator controls plus integrated typecheck                                       | worker-high/high; wrong approach; shared-tree         |
| 5.2 | ✓ 2026-09-30 · shared-tree; allDB32controls/formatpass                | CHANGELOG.md; server/tests/integration/database/sqlite-backend.test.ts; server/tests/integration/database/durable-round-trip.test.ts                                       | Merge both changelog additions; adapt newer-schema controls to supported34 without hiding regressions.                                                     | 3 files; ≤80 nonconflict diff lines  | —       | Real-file refusal/upgrade fixtures and formatting                                                 | worker-high/high; wrong output; shared-tree           |
| 5.3 | ✓ 2026-09-30 · generated lint2485/719; knip437; types341              | server/.eslint-ratchet-baseline.json; server/.knip-ratchet-baseline.json; server/.typecheck-tests-ratchet-baseline.json if measured change                                 | Resolve baseline conflicts from current main then regenerate measured decreases after5.1/5.2; no unmeasured manual counts/increase override.               | ≤3 generated files                   | 5.1,5.2 | Baseline generators, ratchets, exact deltas                                                       | worker-high/high; wrong output; shared-tree           |
| 5.4 | ✓ 2026-09-30 · guarded23→34copy; durable/shapes/integritypass         | External current-main-runtime-rehearsal receipts                                                                                                                           | Rehearse current schema34 upgrade on freshcopy of preserved23backup, compare durable inherited data/scopes and expected shapes; report transient resets.   | 1 disposable copy; ≤8 receipts       | 5.1,5.2 | Actual engine initialization/shutdown; integrity/FK/shape/durable hashes and untouchedbackup hash | worker-high/high; wrong output; isolated externalcopy |
| 5.5 | ✓ 2026-09-30 · isolatedMCPdelete; netforeignscope0/originalhashessame | README.md; foreign interview plan; MCP-owned interview prompt3files                                                                                                        | Exclude inherited foreign local commits from delivery scope, restore upstream51catalog count, retain originalmain files/hashes. Resource removal MCP-only. | 5 named paths, zero netdiff vsorigin | —       | Root/version/delete receipts, actualcatalog51, originalhashes, README/prompts                     | worker-high/high; wrong approach; shared-tree         |
| 5.6 | ✓ 2026-09-30 · 3E2Esuites188pass; type341/format/treeguardpass        | server/tests/e2e/framework-selection-lifecycle.e2e.test.ts; server/tests/e2e/chain-prompt-sources.e2e.test.ts; server/tests/e2e/delegated-review-client-parity.e2e.test.ts | Correct stale mandatory single-review/raw-gate-id and ungated parent coverage expectations while preserving all semantic and durable controls.             | 3 tests; ≤40diff lines               | 5.5     | Three named E2E suites, testtype ceiling, exact unchanged control assertions                      | worker-high/high; wrong output; shared-tree           |

## Execution dispatch

These are provider-neutral failure tiers from the canonical planning vocabulary, not literal Codex model parameters. The executor binds supported native provider profiles; absent supported model mapping inherits host model. No worker moves refs in another actor's checkout. A future planner creates the linked initiative worktree with the repository bootstrap; each own-branch worker receives an already-created isolated branch/worktree. worker_cap3 includes a single runtime mutator; overlapping file owners serialize.

| Row  | Tier   | Effort | Failure shape                                                                               | branch_mode |
| ---- | ------ | ------ | ------------------------------------------------------------------------------------------- | ----------- |
| 1.1  | opus   | high   | wrong approach: compatibility refusal can mutate durable data before rejecting              | own-branch  |
| 1.2  | sonnet | high   | wrong output: fixture must observe all preserved bytes and negative control                 | own-branch  |
| 1.3  | sonnet | high   | wrong output: explicit policy/operational limits against pinned behavior                    | own-branch  |
| 2.1  | opus   | high   | wrong approach: context reconstruction or fallback leaves contradictory guidance            | own-branch  |
| 2.2  | sonnet | high   | wrong output: actual-review and terminal branching is explicitly scoped                     | own-branch  |
| 2.3  | sonnet | high   | wrong output: common review boundary must preserve supplied tiers                           | own-branch  |
| 2.4  | opus   | high   | wrong approach: mocked lifecycle would hide missing runtime propagation                     | own-branch  |
| 2.5  | sonnet | high   | wrong output: documented singles/deferred/chains semantics are pinned                       | own-branch  |
| 2.6  | sonnet | high   | wrong output: consolidate exact lifecycle behavior without added debt                       | own-branch  |
| 3.1  | opus   | high   | wrong approach: identity correction alone cannot restore authored content                   | own-branch  |
| 3.2  | sonnet | high   | wrong output: advisory hint must stay outside executable parameters                         | own-branch  |
| 3.3  | opus   | high   | wrong approach: authored contract must fit framework and trailer without weakening evidence | own-branch  |
| 3.4  | opus   | high   | wrong approach: renderer-seeded identity could conceal stage20 defect                       | own-branch  |
| 3.5  | opus   | high   | wrong approach: HTTP request lifetime or runtime-root leakage invalidates control           | own-branch  |
| 3.6  | sonnet | high   | wrong output: model and handoff examples against measured contract                          | own-branch  |
| 3.7  | sonnet | medium | wrong output: observable release entries and compatibility policy                           | own-branch  |
| 3.8  | sonnet | medium | wrong output: regenerate measured ceilings without hiding regressions                       | own-branch  |
| 3.9  | sonnet | high   | wrong output: explicit review fixtures against measured contract                            | own-branch  |
| 3.10 | sonnet | high   | wrong output: generated decrease must not conceal increase                                  | own-branch  |
| 3.11 | sonnet | high   | wrong output: metadata correction must preserve existing commitments                        | own-branch  |
| 4.1  | opus   | high   | wrong approach: incompatible live writer or incoherent backup destroys recovery evidence    | shared-tree |
| 4.2  | opus   | high   | wrong approach: installed provenance or false-positive flow obscures actual closure         | shared-tree |

Tier1/Tier2/Tier3 fit bounded planner slices; run distinct slices rather than fan out the full initiative. Same-tier Depends are compiled row edges. Cross-tier entry gates supply sequencing and do not place foreign row IDs into a tier's Depends. No gate IDs are invented here; artifact checks are explicit and the existing workflow checks can be attached at dispatch.

## Acceptance and falsification

| ID  | Consumer criterion                                                            | Baseline -> required result                                                                                                                                     | Probe / mutation                                                                      |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A1  | Advisory single guidance is honest                                            | Review Required with no review -> advisory, no verdict demand or executed-check claim                                                                           | 2.4 real loaded gates; restore unconditional attestation/ID-based CTA fails           |
| A2  | Genuine review preserves hold and tier shape                                  | published blocking mode alone / missing ordinary tiers -> persisted review holds omission/FAIL; accepted reminders uses reminders object                        | 2.4 ordinary/chain/deferred controls; drop common tier derivation fails               |
| A3  | Terminal actions match history                                                | completed single still Continue -> terminal single and chain no Continue/review, active review retains actions                                                  | 2.4 response + DB/history; remove latch check fails                                   |
| A4  | First Codex brief preserves identity/content                                  | initial Task + lost system vs resumed spawn_agent -> same trusted profile/system content on initial and normal                                                  | 3.4/3.5 real resolver/stages; remove each propagation separately fails                |
| A5  | Codex model instructions are executable                                       | codex-standard/high/fast params -> host inheritance and advisory tier prose                                                                                     | hint matrix 3.4; restore alias parameter fails                                        |
| A6  | Worker work-product and envelope agree                                        | five-heading nothing-else conflicts with mandatory trailer -> explicit envelope exception, actual framework text compatible, required token validation retained | real resource/framework 3.4; missing/wrong trailer refused, correct accepted          |
| A7  | Guarded engine refuses newer/malformed DB without destructive schema mutation | any mismatch recreate -> refusal + intact schema/durable/sentinel rows, cleanup; fresh/current/older supported                                                  | 1.2 real files; disable refusal fails preservation                                    |
| A8  | Live recovery and installed flow are separately evidenced                     | incompatible shared DB / healthy status -> coordinated compatible schema + preserved history + installed negative/positive controls                             | 4.1 backup/inventory and 4.2 actual client; mismatched provenance invalidates closure |

No criterion claims the server independently understands unfinished prose, hooks execute the implementation, reminder attestation is machine grading, or missing durable tables prove data previously existed.

## Open questions and ruled defaults

| ID  | Status                                              | Must precede                    | Default / alternative                                                                                                                                                     | Evidence needed                                                                                                         |
| --- | --------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| OQ1 | RULED · R-OQ1 in notes                              | 4.1 operational dispatch        | Existing process owners coordinate replacement/isolation; alternative use a distinct new runtime root and preserve original for recovery                                  | PID -> executable generation -> client owner -> resolved DB map, plus compatible-writer agreement                       |
| OQ2 | RULED · R-OQ2 in notes                              | 4.1 recovery mutation           | Backup and restore every available durable byte; disclose accepted ephemeral resets; alternative stop recovery if prior backup is needed to recover missing durable bytes | Coherent SQLite backup, inventory of prior snapshots, before/after history/scopes/manifests and owner loss/reset policy |
| OQ3 | RULED · isolated installed artifact, R-OQ3 in notes | 4.2 installed-client acceptance | Receiving setup initiative supplies coherent build/hook/adapter/resource/runtime provenance; alternative leave live closure open while isolated tests pass                | Actual installed path/hash and active client reconnect receipt                                                          |
| R1  | RULED in this plan                                  | Tier2                           | Preserve advisory initial singles and genuine deferred single review; reject adding single criteria runner                                                                | Current gates.md and deferred-review E2E control                                                                        |
| R2  | RULED in this plan                                  | Tier3                           | Preserve abbreviated retry, five-heading work product plus mandatory transport envelope, model inheritance                                                                | Current render/retry/handoff and host capability contracts                                                              |

Known running-engine version fences after external schema changes are not silently introduced. Current patch covers startup refusal only. Incompatible legacy writers must be isolated/retired by OQ1. A broader per-operation fence is killed for this slice (2026-09-29: not needed for agreed guarded-startup contract; revives if compatibility must be maintained with uncoordinated legacy writers), requiring its own existing-transaction probe and ruling.

## New-file justification and review medium

Only one new code file is proposed: delegated-review-client-parity.e2e.test.ts. Existing own-args E2E checks a different property; a dedicated shared STDIO/HTTP review fixture makes first-render propagation and lifecycle evidence explicit. Reuse hermetic roots and transport helpers; no production helper or state machine is authorized.

The canonical working copy is plans/server-correctness-2026-09-29.md with sibling server-correctness-2026-09-29-implementation-notes.md; the raw diagnostic artifact is linked below. The canonical Artifact publisher and artifact-design skill are not exposed in this session; the linked Markdown is the available review surface. GitHub publication is not requested; tracking remains local-only. Receiving initiative may integrate the plan into its existing working copy and publish boundary after reviewing scope.

## Sources and growth

- Supplied attachment: /home/minipuft/.t3/dev/attachments/3e4ee79b-4777-4cac-a54e-9f8b5ba2e24d-51c5ac6e-0d8a-47ba-9481-056be0ec28f5-txt.txt; final user instructions and diagnostic handoff.
- /home/minipuft/diagnostics/claude-prompts-mcp/server-issues-handoff.md and sibling review-contract-evidence.md, delegation-render-evidence.md, runtime-schema-evidence.md.
- Current read-only persistence, review and delegation audit handoffs; MCP strategic_worker inspection reports resource source_root at checkout.
- Existing source, table contracts, gates/persistence/lifecycle/chain-schema docs and verified test patterns.
- Canonical search/debugging/refactoring/unknowns/plan/testing/evaluation and knowledge-capture guidance.

Growth captured in implementation-notes: rendered obligations must follow persisted lifecycle; context reconstruction is a metadata loss boundary; schema guard and live operational recovery are different claims. No global skill/rule/memory changes are made from this single initiative.

## Discovery result

```text
search_type: dependency_trace
queries_run:
  - attachment User sections and final diagnostic handoff -> diagnosis-only scope, D1-D6 and positive controls
  - git status/rev-parse/branch -> dirty main at 46a4b814631d346ed92e97dff2c5569194e0f48d
  - rg plans single-prompt/judge/delegation/schema -> existing P4.141, handoff and cross-client decisions
  - rg source definitions/render context/CTA/tier/ensureSchema -> canonical owners in tables
  - ls/wc/rg/head batches -> all planned existing paths verified; incorrect guesses corrected in notes
  - resource_manager inspect strategic_worker -> version0, canonical checkout resource root, five-heading text
  - in-memory formatter -> mandatory advisory CTA and terminal Continue reproduced
  - read-only SQLite/process inventory -> current shared schema23, source33, known durable rows and holders
sibling_patterns: chain terminal footer; normal vs review renderer; detached tier derivation; durable round trips
domain_ownership: SqliteEngine, gate services/authority, ResponseAssembler, ChainOperatorExecutor and delegation
intent:
  work_type: bug_fix
  secondary: bounded refactor only if shared-render wiring requires it
  risk: high for durable compatibility; medium for rendering/dataflow
  external_deps: none added
  next_phase: future implementation on isolated initiative worktree
confidence: high for source/formatter mechanisms; operational recovery evidence remains incomplete
```

## Test strategy

| Property                                                         | Type                                   | Location                                                                                      | Why                                                                         |
| ---------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Newer/malformed schema refusal and durable/sentinel preservation | Real-file integration                  | sqlite-backend.test.ts; durable-round-trip.test.ts; schema-v29.test.ts                        | SQL mutation and handle lifetime must be observed using actual files        |
| Advisory/deferred/chain review and terminal history              | E2E plus formatter unit                | gate-enforcement-mode.e2e.test.ts; gate-review-record-truth.e2e.test.ts; assembler CTA suites | Response-only mocks miss persisted hold and metadata propagation            |
| Guidance context forwarding                                      | Loaded-definition integration/unit     | gate-guidance-renderer.test.ts and full E2E flow                                              | Explicit compositor reconstruction can discard new context fields           |
| Identity and system-content parity                               | Pipeline integration + E2E             | delegation-operator-flow.test.ts; proposed cross-transport fixture                            | Must traverse real resolver, session and stages18/20                        |
| Model hint honesty                                               | Renderer unit plus full delegated flow | delegation-renderer.test.ts; cross-transport fixture                                          | Invocation parameters and prose are separate outputs                        |
| Authored five headings and machine trailer                       | Real-resource integration              | delegation-handoff-evidence.integration.test.ts                                               | Authored prompt/framework and canonical token parser are real collaborators |
| Live DB restoration and installed client flow                    | Coordinated operational/manual         | Tier4 evidence                                                                                | Fixture success cannot establish shared-runtime or host provenance          |

No new tests are written for these planning documents. Implementation tests must fail on a corresponding mutation before their PASS is treated as behavioral closure.

## Documentation and release

| Doc                                     | Update                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| docs/architecture/sqlite-persistence.md | Newer-version refusal replaces accepted-downgrade recreation                                     |
| docs/guides/troubleshooting.md          | Coherent backup, writer isolation, root provenance and recovery boundaries                       |
| docs/guides/gates.md                    | Initial advisory singles, genuine deferred review, actual criterion evidence and reminder schema |
| docs/concepts/chains-lifecycle.md       | Enforced chain boundary, initial/retry delegation, handoff envelope                              |
| docs/reference/chain-schema.md          | Codex model inheritance and advisory tier hints                                                  |
| CHANGELOG.md                            | Observable Fixed entries; downgrade-policy Changed compatibility entry                           |

Commit conventions: fix(gates), fix(execution), fix(runtime), docs(docs), test(tests), using only enforced scopes. Review whether the deliberate supported-downgrade behavior change requires a breaking commit/release marker before publication. This plan does not authorize a release, push, merge or Issue.

Suggested user-facing entries, contingent on verified implementation:

- Fixed: advisory prompts no longer demand unestablished review; completed prompts no longer offer Continue.
- Fixed: initial gated Codex worker briefs retain client identity and authored instructions; model tiers do not become unsupported model IDs.
- Changed: startup refuses databases written by a newer schema generation; use a compatible engine or an isolated runtime root.

## Risks and rollback

| Risk                                                  | Impact                                           | Mitigation                                                          | Rollback                                                                    |
| ----------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Unpatched legacy writer ignores new guard             | Shared schema can still be recreated             | OQ1 writer ownership/isolation before recovery                      | Re-isolate writer; recover from coherent backup under compatible generation |
| Malformed version treated as fresh                    | Destructive startup behavior hidden behind zero  | Distinguish absence from read/corruption failures before DDL        | Keep DB untouched and refuse; restore compatible reader only after evidence |
| Fix eliminates genuine deferred single review         | Accepted lifecycle regresses                     | Deferred FAIL review E2E alongside advisory control                 | Revert scoped CTA change in isolated branch, preserve state evidence        |
| Guidance footer fixed but earlier attestation remains | Client still receives contradictory obligations  | Owner and fallback delivery rows plus full-output assertion         | Restore isolated source snapshot, revise forwarding contract                |
| Overbroad framework suppression weakens reasoning     | Authored work/format drift                       | Actual real-resource render probe; keep guidance when compatible    | Restore only injection change; retain handoff parser enforcement            |
| HTTP request-local profile lost                       | First gated render chooses wrong host            | Fresh-request HTTP + STDIO fixtures using trusted inputs            | Revert scoped propagation patch in isolated branch                          |
| Shared dependency symlink mutated by install          | Concurrent trees lose reproducibility            | No npm ci through linked symlinks; inventory lock/tree before build | Restore dependencies only with owning initiative coordination               |
| Historical durable bytes unavailable                  | Recovery cannot recreate missing object contents | Prior-backup provenance and explicit loss/reset decision            | Preserve original/backup; keep operational row open rather than invent data |

## Planning completion and future delivery completion

Planning is complete when the five-step MCP chain completes, all referenced existing paths are checked, the 17 task IDs/dispatch rows match, within-tier dependencies are valid, every task has a stamp/verification/owner, A1-A8 map to tests, and OQ1-OQ3 remain explicit operational dependencies. This is separate from implementation completion.

Delivery is complete only when A1-A8 and all open rows are satisfied with receipts, required full validation and build/live drive pass, documentation and compatibility signaling match behavior, and the receiving planner accepts integration. A blocked operational row remains open; isolated green tests do not retire the plan.

Growth capture is done in the sibling notes. No memory updates or global skill corrections are necessary or authorized in this planning request; no global files were changed.

## Verify-Paths appendix

These are literal read-only tool-output excerpts from the verification step. They confirm existence, counts and current symbol anchors; they do not claim a source test suite passed. Failed guessed paths are retained as evidence; the task tables use corrected owners only.

<details>
<summary>Filesystem and symbol receipts</summary>

```text
-rw-r--r-- 1 minipuft minipuft 80759 Sep 29 12:57 server/src/infra/database/sqlite-engine.ts
1554 server/src/infra/database/sqlite-engine.ts
550:  private initialized: boolean = false;
590:   * Check if database is initialized
593:    return this.initialized && this.db !== null;
-rw-r--r-- 1 minipuft minipuft 32848 Sep 29 12:57 server/src/infra/database/table-contracts.ts
538 server/src/infra/database/table-contracts.ts
25: *   - `sqlite-engine.ts` — derives the durable set for schema recreate, and asserts at startup
37: * - `durable`   — exists nowhere else. Carried across a schema recreate; losing it is data loss.
39:export type Posture = 'derived' | 'ephemeral' | 'durable';
-rw-r--r-- 1 minipuft minipuft 29517 Sep 29 12:57 server/src/runtime/module-initializer.ts
630 server/src/runtime/module-initializer.ts
119:async function claimStateDatabase(runtimeDbPath: string, logger: Logger): Promise<void> {
136: * Extracted rather than inlined for the reason `claimStateDatabase` records: `initializeModules`
175: * persist. Takes the same `runtimeDbPath` that `claimStateDatabase` claimed the singleton with, so
-rw-r--r-- 1 minipuft minipuft 27853 Sep 20 19:51 server/src/runtime/paths.ts
736 server/src/runtime/paths.ts
14: * - MCP_RUNTIME_ROOT: Writable directory for state and logs
192:    const configured = process.env['MCP_RUNTIME_ROOT'];
199:      hasConfiguredRoot ? 'MCP_RUNTIME_ROOT env var' : 'effective workspace'
-rw-r--r-- 1 minipuft minipuft 59394 Sep 29 12:57 server/src/engine/gates/services/gate-enhancement-service.ts
1399 server/src/engine/gates/services/gate-enhancement-service.ts
232:  async enhanceSinglePrompt(
344:      await this.publishEnforcementMode(context, gateIds, isSinglePrompt ? 'advisory' : 'blocking');
401:    await this.publishEnforcementMode(
-rw-r--r-- 1 minipuft minipuft 18136 Sep 27 07:10 server/src/engine/execution/pipeline/stages/13-session-stage.ts
452 server/src/engine/execution/pipeline/stages/13-session-stage.ts
123:        const pendingReview =
127:        if (pendingReview) {
128:          sessionContext.pendingReview = pendingReview;
-rw-r--r-- 1 minipuft minipuft 22642 Sep 29 12:57 server/src/engine/execution/pipeline/stages/18-execution-stage.ts
531 server/src/engine/execution/pipeline/stages/18-execution-stage.ts
75:      context.state.session.chainComplete = true;
262:        requestIdentityContext: context.state.identity.context,
263:        clientProfile: context.state.identity.context?.clientProfile,
-rw-r--r-- 1 minipuft minipuft 22018 Sep 29 12:57 server/src/engine/execution/pipeline/stages/20-gate-review-stage.ts
479 server/src/engine/execution/pipeline/stages/20-gate-review-stage.ts
162:   * - `gateTiers` — each gate's tier by `deriveGateTier`. The formatting layer needs it and has
176:    const gateTiers = await this.deriveGateTiers(review.gateIds);
178:    if (checkResults.length === 0 && Object.keys(gateTiers).length === 0) {
-rw-r--r-- 1 minipuft minipuft 30230 Sep 27 15:18 server/src/engine/execution/capture/step-capture-service.ts
723 server/src/engine/execution/capture/step-capture-service.ts
47:  /** Whether a PASS verdict already advanced the step this call */
78:   * Capture a step result and optionally advance the chain.
81:   * returns the advance past it unless a pending gate review holds it. The caller applies that
-rw-r--r-- 1 minipuft minipuft 78433 Sep 29 12:57 server/src/engine/execution/formatting/response-assembler.ts
1735 server/src/engine/execution/formatting/response-assembler.ts
369:      this.resolveGateTiers(context),
879:      this.resolveGateTiers(context),
1136:  private resolveGateTiers(context: ExecutionContext): ReadonlyMap<string, GateTier> {
ls: cannot access 'server/src/engine/execution/pipeline/state/gates-state.ts': No such file or directory
wc: server/src/engine/execution/pipeline/state/gates-state.ts: No such file or directory
rg: server/src/engine/execution/pipeline/state/gates-state.ts: IO error for operation on server/src/engine/execution/pipeline/state/gates-state.ts: No such file or directory (os error 2)
-rw-r--r-- 1 minipuft minipuft 58228 Sep 29 12:57 server/src/engine/execution/operators/chain-operator-executor.ts
1344 server/src/engine/execution/operators/chain-operator-executor.ts
77:      return this.renderGateReviewStep(
93:  private async renderGateReviewStep(
310:            clientProfile: this.extractClientProfile(chainContext),
-rw-r--r-- 1 minipuft minipuft 11862 Sep 22 16:27 server/src/engine/execution/delegation/strategy.ts
341 server/src/engine/execution/delegation/strategy.ts
11:  resolveModel(payload: DelegationPayload): string | undefined;
129:  resolveModel(payload: DelegationPayload): string | undefined {
171:export class CodexStrategy implements DelegationStrategy {
-rw-r--r-- 1 minipuft minipuft 1740 Sep 22 16:27 server/src/engine/execution/delegation/types.ts
43 server/src/engine/execution/delegation/types.ts
19:export interface DelegationPayload {
40:export interface RenderingHints {
-rw-r--r-- 1 minipuft minipuft 11158 Sep 21 17:36 server/src/engine/execution/delegation/handoff-contract.ts
258 server/src/engine/execution/delegation/handoff-contract.ts
1:// @lifecycle canonical - Delegation handoff contract: node token, HANDOFF RESULT trailer parser, evidence decision.
4: * parser of the `HANDOFF RESULT` trailer a worker echoes it back in, and the pure decision of
22:export const HANDOFF_RESULT_HEADING = 'HANDOFF RESULT';
-rw-r--r-- 1 minipuft minipuft 2306 Jul 31 22:21 server/src/shared/types/request-identity.ts
75 server/src/shared/types/request-identity.ts
15:export type RequestClientProfileSource =
21:export interface RequestClientProfile {
38:  clientProfileSource: RequestClientProfileSource;
-rw-r--r-- 1 minipuft minipuft 4981 Sep 24 19:58 server/src/engine/frameworks/declared-sections.ts
109 server/src/engine/frameworks/declared-sections.ts
80: * A prompt that turns framework gates off (`gateConfiguration.framework_gates: false`) declares
87:  gateConfiguration?: { framework_gates?: boolean };
89:  return prompt?.gateConfiguration?.framework_gates !== false;
-rw-r--r-- 1 minipuft minipuft 2332 Sep 20 11:32 server/resources/prompts/development/strategic_worker/prompt.yaml
53 server/resources/prompts/development/strategic_worker/prompt.yaml
1:id: strategic_worker
50:  framework_gates: false
-rw-r--r-- 1 minipuft minipuft 5379 Sep 15 13:22 server/resources/prompts/development/strategic_worker/system-message.md
47 server/resources/prompts/development/strategic_worker/system-message.md
3:The row you were given is the contract. The brief is re-issuable verbatim, so it is also the whole of what you get: the planner cannot read your transcript, and the five headings below are the only channel back.
31:5. **Commit, or do not, by the row's branch mode.** `own-branch` (default): commit only the row's files to `<initiative>/<row>` — the branch you were launched on — with a conventional-commit subject in the reader's register; the planner merges it. `shared-tree`: commit nothing, leave the edits in the tree, and say so under `done`; the planner commits per concern.
-rw-r--r-- 1 minipuft minipuft 586 Sep 14 01:52 server/resources/prompts/development/strategic_worker/user-message.md
6 server/resources/prompts/development/strategic_worker/user-message.md
6:Worker mode is now active. Sibling search, probed trio, implement, run the row's artifact check, commit by the branch mode, then return the five headings — `done · concerns · deviations · findings · feedback` — and nothing else.
-rw-r--r-- 1 minipuft minipuft 5752 Sep 16 23:02 server/resources/frameworks/cageerf/framework.yaml
158 server/resources/frameworks/cageerf/framework.yaml
11:systemPromptGuidance: |
15:  **Analysis**: Apply structured, systematic examination of the problem or opportunity
87:    type: structure
-rw-r--r-- 1 minipuft minipuft 16853 Sep 29 12:57 server/tests/integration/database/sqlite-backend.test.ts
471 server/tests/integration/database/sqlite-backend.test.ts
14:import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
27:describe('SQLite State Backend', () => {
44:  describe('SqliteEngine', () => {
-rw-r--r-- 1 minipuft minipuft 13544 Sep 21 04:11 server/tests/integration/database/durable-round-trip.test.ts
289 server/tests/integration/database/durable-round-trip.test.ts
38:import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
174:describe('every durable table survives a schema recreate', () => {
244:  describe('the restore order foreign keys require', () => {
-rw-r--r-- 1 minipuft minipuft 12337 Sep 29 12:57 server/tests/integration/database/schema-v29.test.ts
290 server/tests/integration/database/schema-v29.test.ts
37:import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
113:describe('schema v29 — the content-addressed store', () => {
128:  describe('a hand-seeded v28 database', () => {
-rw-r--r-- 1 minipuft minipuft 26959 Sep 26 23:15 server/tests/integration/pipeline/delegation-operator-flow.test.ts
653 server/tests/integration/pipeline/delegation-operator-flow.test.ts
22:import { describe, expect, test, jest, beforeEach } from '@jest/globals';
77:describe('Delegation Operator (==>) Flow', () => {
87:  describe('parser → chain operator → CTA flow', () => {
-rw-r--r-- 1 minipuft minipuft 85795 Sep 27 12:09 server/tests/integration/chain/step-lifecycle.integration.test.ts
2019 server/tests/integration/chain/step-lifecycle.integration.test.ts
29:  describe,
395:describe('chain run lifecycle, driven the way a client drives it', () => {
704:  describe('execution_history steps reads each step at its latest record', () => {
-rw-r--r-- 1 minipuft minipuft 18693 Sep 25 05:26 server/tests/e2e/gate-enforcement-mode.e2e.test.ts
436 server/tests/e2e/gate-enforcement-mode.e2e.test.ts
30:import { afterEach, describe, expect, test } from '@jest/globals';
92:describe('Streamable HTTP: a FAIL follows the gate declared enforcement_mode', () => {
-rw-r--r-- 1 minipuft minipuft 7974 Sep 25 05:26 server/tests/e2e/gate-review-record-truth.e2e.test.ts
185 server/tests/e2e/gate-review-record-truth.e2e.test.ts
23:import { afterEach, describe, expect, test } from '@jest/globals';
64:describe('Streamable HTTP: a gate review states one state', () => {
-rw-r--r-- 1 minipuft minipuft 27988 Sep 25 03:59 server/tests/unit/execution/formatting/response-assembler-cta.test.ts
815 server/tests/unit/execution/formatting/response-assembler-cta.test.ts
1:import { describe, expect, test } from '@jest/globals';
154:describe('ResponseAssembler – operator-aware CTA system', () => {
155:  describe('gate verdict CTA (primary action)', () => {
-rw-r--r-- 1 minipuft minipuft 23266 Sep 29 12:57 server/tests/unit/execution/formatting/response-assembler-chain-cta.test.ts
657 server/tests/unit/execution/formatting/response-assembler-chain-cta.test.ts
1:import { describe, expect, test } from '@jest/globals';
129:describe('ResponseAssembler – chain-path CTA methods', () => {
130:  describe('buildGateReviewCTA', () => {
-rw-r--r-- 1 minipuft minipuft 6908 Sep 29 12:57 server/tests/unit/execution/operators/chain-operator-executor-review-render.test.ts
221 server/tests/unit/execution/operators/chain-operator-executor-review-render.test.ts
3: * (`describeReviewForRender`), and for a CURRENT-STEP review that must change nothing a client
13:import { describe, test, expect, jest } from '@jest/globals';
98:describe('gate-review render of a current-step review is byte-identical (row 3.5)', () => {
-rw-r--r-- 1 minipuft minipuft 14492 Sep 23 15:07 server/tests/unit/execution/operators/chain-operator-executor-delegation.test.ts
394 server/tests/unit/execution/operators/chain-operator-executor-delegation.test.ts
1:import { describe, test, expect, jest } from '@jest/globals';
46:describe('ChainOperatorExecutor delegation rendering (R-1)', () => {
-rw-r--r-- 1 minipuft minipuft 15797 Sep 22 16:27 server/tests/unit/delegation/delegation-renderer.test.ts
425 server/tests/unit/delegation/delegation-renderer.test.ts
1:import { describe, expect, test } from '@jest/globals';
27:describe('DelegationRenderer', () => {
159:describe('ClaudeCodeStrategy', () => {
-rw-r--r-- 1 minipuft minipuft 52703 Sep 29 12:57 docs/architecture/sqlite-persistence.md
681 docs/architecture/sqlite-persistence.md
459:**Downgrade is defined, and it costs fidelity rather than history.** A v28-era server opening a
-rw-r--r-- 1 minipuft minipuft 31272 Sep 19 22:43 docs/guides/gates.md
532 docs/guides/gates.md
17:> **Single prompts do not run criteria.** Stage 20 renders synthetic gate-review steps and
18:> requires chain steps to do it, so a gated single prompt runs no `pass_criteria` at all — not
48:is now the single source both the render path (chain steps, and gated single prompts carrying
-rw-r--r-- 1 minipuft minipuft 11063 Sep 20 22:57 docs/guides/troubleshooting.md
313 docs/guides/troubleshooting.md
1:# Troubleshooting
7:## Server Won't Start
9:### "Unable to determine server root"
-rw-r--r-- 1 minipuft minipuft 40795 Sep 29 12:57 docs/concepts/chains-lifecycle.md
660 docs/concepts/chains-lifecycle.md
168:  is answered by a verdict whose `user_response` is the report's `HANDOFF RESULT` trailer (see
411:True isolation is the `==>` delegation operator below, which builds the sub-agent a fresh
420:Steps can be handed off to sub-agents using the `==>` operator. A delegated step renders a
-rw-r--r-- 1 minipuft minipuft 62697 Sep 29 12:57 docs/architecture/overview.md
1002 docs/architecture/overview.md
530:### Execution Domain (`engine/execution/`)
-rw-r--r-- 1 minipuft minipuft 1465949 Sep 22 22:43 plans/technical-debt/resource-surface-consolidation-2026-08-27.md
1728 plans/technical-debt/resource-surface-consolidation-2026-08-27.md

-rw-r--r-- 1 minipuft minipuft 17685 Sep 29 12:57 server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts
481 server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts
40: * - Review creation, keyed by the node the review grades (`createReview`)
274:  async createPendingReview(options: CreateReviewOptions): Promise<PendingGateReview> {
300:   * ({@link createReviewForStep}), a detached node's on its late report ({@link openDetachedReview}),
-rw-r--r-- 1 minipuft minipuft 15198 Sep 20 11:32 server/src/engine/gates/guidance/GateGuidanceRenderer.ts
388 server/src/engine/gates/guidance/GateGuidanceRenderer.ts
21: * The slice of `gates` config this renderer reads. Narrower than `GateSystemSettings` on purpose:
30: * Closing attestation line shared by every gate-guidance render path — the canonical renderer
34:export const GATE_ATTESTATION_LINE =
-rw-r--r-- 1 minipuft minipuft 6762 Sep 22 16:27 server/src/engine/execution/delegation/renderer.ts
143 server/src/engine/execution/delegation/renderer.ts
15: * - ChainOperatorExecutor (current-step handoff via renderDelegatedStepHandoff; advisory)
31:   * Handoff instructions for a CURRENT delegated step whose content is rendered as an
38:   * when none was declared — the strategy then renders its host's default agent.
-rw-r--r-- 1 minipuft minipuft 54437 Sep 26 23:15 server/tests/integration/chain/delegation-handoff-evidence.integration.test.ts
1252 server/tests/integration/chain/delegation-handoff-evidence.integration.test.ts
24:import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
391:describe('delegation handoff evidence at resume (Tier 2 row 2.7)', () => {
480:  describe('the shipped default (no config key set → `required`)', () => {
-rw-r--r-- 1 minipuft minipuft 5624 Sep 25 03:59 server/tests/e2e/delegated-brief-own-args.e2e.test.ts
131 server/tests/e2e/delegated-brief-own-args.e2e.test.ts
15:import { afterEach, describe, expect, test } from '@jest/globals';
56:describe('Streamable HTTP: a delegated brief states its own node args (P6.41)', () => {
-rw-r--r-- 1 minipuft minipuft 17650 Sep 22 16:27 docs/reference/chain-schema.md
280 docs/reference/chain-schema.md
35:| `subagentModel`      | `enum`    | No       | Model tier for delegation: `heavy`, `standard`, `fast`. Overrides prompt-level hint.                                                                                                                                                                                                          |
39:| `delegated`          | `boolean` | No       | Declared context isolation: this step runs in a sub-agent. What the `==>` operator sets on a symbolic chain, and the only way to ask for isolation in YAML without also naming a model tier.                                                                                                  |
121:Controls which model tier a delegated step uses. The hint is client-agnostic — each delegation strategy maps it to the appropriate model:
-rw-r--r-- 1 minipuft minipuft 2839 Sep 20 15:11 server/skills-sync.yaml
57 server/skills-sync.yaml
26:      - prompt:development/strategic_worker
-rw-r--r-- 1 minipuft minipuft 26536 Sep 29 12:57 server/src/modules/chains/run-registry.ts
623 server/src/modules/chains/run-registry.ts
94:  handoff_token: string | null;
153:              created_at, last_activity, run_completed_at, handoff_token
222:           handoff_token
-rw-r--r-- 1 minipuft minipuft 3162 Sep 21 17:36 server/tests/helpers/delegation/fake-worker.ts
68 server/tests/helpers/delegation/fake-worker.ts
6: * the RENDERED brief, takes the token the server printed there, and echoes it back in the block
9: * Reading the brief rather than accepting a token argument is the point. A test that passes the
10: * token in can pass the WRONG token in and still go green; this one can only produce a reply the
**Row**: {% if row_id %}{{ row_id }} — {% endif %}{{ task }}
{% if files %}**Files you may edit**: {{ files }} — anything else is a finding, not an edit.{% endif %}
{% if plan_path %}**Governing plan**: {{ plan_path }} — context only; the planner writes rows back.{% endif %}
{% if branch_mode %}**Branch mode**: {{ branch_mode }}{% endif %}

Worker mode is now active. Sibling search, probed trio, implement, run the row's artifact check, commit by the branch mode, then return the five headings — `done · concerns · deviations · findings · feedback` — and nothing else.
599:  async initialize(): Promise<void> {
760:  private ensureSchema(): 'current' | 'created' | 'recreated' {
1136:  private resolveGateTiers(context: ExecutionContext): ReadonlyMap<string, GateTier> {
1339:  private appendGateAction(lines: string[], context: ExecutionContext): boolean {
1441:  private appendSessionAction(lines: string[], context: ExecutionContext): void {
11:  resolveModel(payload: DelegationPayload): string | undefined;
129:  resolveModel(payload: DelegationPayload): string | undefined {
171:export class CodexStrategy implements DelegationStrategy {
174:  resolveModel(payload: DelegationPayload): string | undefined {
205:  resolveModel(_payload: DelegationPayload): string | undefined {
235:  resolveModel(_payload: DelegationPayload): string | undefined {
265:  resolveModel(_payload: DelegationPayload): string | undefined {
296:  resolveModel(_payload: DelegationPayload): string | undefined {

-rw-r--r-- 1 minipuft minipuft 1876 Sep 15 13:22 server/src/engine/gates/core/gate-definitions.ts
68 server/src/engine/gates/core/gate-definitions.ts
1:// @lifecycle canonical - Shared interfaces and types for gate definitions.
6: * This enables clean dependencies and consistent interfaces.
-rw-r--r-- 1 minipuft minipuft 3886 Sep 15 13:22 server/src/engine/gates/services/compositional-gate-service.ts
125 server/src/engine/gates/services/compositional-gate-service.ts
17: * Compositional Gate Service - Template rendering only (no server-side validation)
40:    context: GateContext
-rw-r--r-- 1 minipuft minipuft 5317 Sep 15 16:18 server/src/engine/gates/core/gate-tier.ts
110 server/src/engine/gates/core/gate-tier.ts
58:export function deriveGateTier(definition: GateTierSource): GateTier {
-rw-r--r-- 1 minipuft minipuft 51215 Sep 29 12:57 server/src/engine/gates/services/gate-verdict-processor.ts
1186 server/src/engine/gates/services/gate-verdict-processor.ts
543:    const answer = await this.answerVerdict(
602:  private async answerVerdict(
-rw-r--r-- 1 minipuft minipuft 17329 Sep 29 12:57 server/src/engine/execution/context/internal-state.ts
385 server/src/engine/execution/context/internal-state.ts
10:import type { PendingShellVerification, ShellVerifyResult } from '../../gates/shell/index.js';
11:import type { GateEnforcementMode } from '../../gates/types.js';
-rw-r--r-- 1 minipuft minipuft 4804 Sep 27 04:19 server/src/engine/execution/context/context-types.ts
113 server/src/engine/execution/context/context-types.ts
86:export interface SessionContext {
ls: cannot access 'server/src/engine/execution/pipeline/stages/14-step-preparation-stage.ts': No such file or directory
wc: server/src/engine/execution/pipeline/stages/14-step-preparation-stage.ts: No such file or directory
rg: server/src/engine/execution/pipeline/stages/14-step-preparation-stage.ts: IO error for operation on server/src/engine/execution/pipeline/stages/14-step-preparation-stage.ts: No such file or directory (os error 2)
ls: cannot access 'server/src/engine/gates/services/gate-guidance-service.ts': No such file or directory
wc: server/src/engine/gates/services/gate-guidance-service.ts: No such file or directory
rg: server/src/engine/gates/services/gate-guidance-service.ts: IO error for operation on server/src/engine/gates/services/gate-guidance-service.ts: No such file or directory (os error 2)

5:**Constraints** — these hold whatever the row says, and a row that needs one broken comes back under `concerns` instead:
31:5. **Commit, or do not, by the row's branch mode.** `own-branch` (default): commit only the row's files to `<initiative>/<row>` — the branch you were launched on — with a conventional-commit subject in the reader's register; the planner merges it. `shared-tree`: commit nothing, leave the edits in the tree, and say so under `done`; the planner commits per concern.
573:P4.141
-rw-r--r-- 1 minipuft minipuft 10898 Sep 29 12:57 server/src/engine/execution/pipeline/stages/14-injection-control-stage.ts
314 server/src/engine/execution/pipeline/stages/14-injection-control-stage.ts
25: * Controls when system prompts, gate guidance, and style guidance are injected
33: * - Conditional injection based on gate status, step type, etc.
server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts:40: * - Review creation, keyed by the node the review grades (`createReview`)
server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts:300:   * ({@link createReviewForStep}), a detached node's on its late report ({@link openDetachedReview}),
server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts:304:  async createReview(
server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts:336:  async createReviewForStep(
server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts:364:    const pendingReview = await this.createReview(sessionContext.sessionId, 'gate', nodeId, {
server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts:384:   * {@link createReviewForStep} opens a step's (same prompts, same `maxAttempts` precedence, step
server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts:405:    return this.createReview(sessionId, 'detached', node.nodeId, {
server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts:411:      gateTiers: await this.deriveGateTiers(gateIds),
server/src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts:437:  private async deriveGateTiers(gateIds: string[]): Promise<Record<string, 'check' | 'reminder'>> {
server/src/infra/database/sqlite-engine.ts:761:    const currentVersion = this.getSchemaVersion();
server/src/infra/database/sqlite-engine.ts:1544:  getSchemaVersion(): number {

```

</details>
