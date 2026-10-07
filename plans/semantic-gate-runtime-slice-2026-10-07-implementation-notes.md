# Semantic gate runtime slice implementation notes

## Now (2026-10-07)

Parent released baseline hold on 2026-10-07 after fresh native C8 coding trial and source/toolchain/namespace receipts. One active source worker is permitted. Child worktree `feat/semantic-gate-flow` began clean at merged PR #474 / 2b8805aa3; planner remains source-read-only and delegates production.

## Classify RESULT

- work_type: feature with bounded contract refactor
- strategy: typed custody -> frozen server authority -> adjudication -> public projections -> resource activation -> registered transport controls
- scope: parent T2-T5 runtime rows; archive/evaluations/global framework/publication excluded
- skip_gates: no skips for source; hold makes implementation/test phases inapplicable until parent release
- primary_skill: strategic_implement; mcp-patterns and architecture/refactoring/TypeScript/testing project contracts loaded
- dispatch: native Codex spawn_agent worker-high, inherited model, high effort; one worker while parent baseline runner is active

## Measured findings

F1: `gate-verdict-renderer.ts` currently owns shared input interfaces and explicitly describes render-then-parse string custody. `ParsedGateVerdict` has only verdict/rationale/raw/source/pattern. `GateEnforcementAuthority.parsePerGateVerdicts` resolves indexes from a raw block. `GateVerdictProcessor.answerReview` sends only event.verdict.raw into per-gate recording. Extending schema alone cannot retain a rich report.

F2: Request vocabulary (`shared/types/execution.ts`), registration conversion (`mcp/tools/index.ts`), executor blank detection, context `.trim`, validator and raw-reader joins all require union custody. Existing registered tests must observe the actual handler; local-helper normalization cannot prove entry preservation.

F3: `resolveGroundTruthCoverage` treats passed results by gate ID. A mixed gate therefore needs explicit remaining semantic requirements before a passed tool can auto-clear it. Existing failing-check guard protects recorded failed checks, not absent required semantic reports.

F4: `createReview` opens reviews before an output may exist; authority `reviewedOutput` is optional. Initial semantic target binding needs an explicit capture/report ordering rule. Expected target pins cannot be accepted from the submitted report. Retry/replacement must mint a new attempt binding and avoid retaining stale target/check observations.

F5: `gate-lifecycle-processor.ts` directly destructures and carries fields on create/update/validate; parent T2 writer inventory omitted this consumer. YAML key registries/snapshot field projections already compose existing contract key sets; do not introduce an independent key list or arbitrary suite-file enumeration.

F6: Processor has no existing refined Zod schema for rich verdicts; the findings-plan premise is false on this branch. Keep public Zod boundary ownership and pure domain kernel ownership distinct. Generic finding IDs and semantic criterion IDs remain different concepts.

F7: Operational review/summary persistence is whole-object JSON. `ExecutionRecordStore` already stores gate_verdicts_json; no need for a schema change was measured. Cold-load and history projection remain required controls before claiming persistence.

## Rulings pending parent

OQ1 OPEN as of 2026-10-07: proposed `calibration_suite_id` opaque field. Flips on parent's spelling acceptance before public-field dispatch.

OQ2 OPEN as of 2026-10-07: initial output capture -> report envelope -> verdict preferred; report on a same-call first answer cannot know server-created actual target digest. Flips on parent ruling and capture-path probe. Ordinary same-call legacy behavior remains required.

OQ3 OPEN as of 2026-10-07: baseline hold. Flips only on explicit parent release, not elapsed time or completion inference.

## Deviations

DEV-P0-1: Initial child draft grouped the engine-execution authority parsing row with shared/mcp/gates custody, crossing four owning modules. Before dispatch, recut into A vocabulary/schema, B-entry request custody, B-domain authority/raw-reader controls. No source work occurred under the oversized grouping.

## Verification receipts

Read-only probes inspected canonical project contracts and current code paths; no functional verification claims. Plan source allowlists are explicit; broader source needed by a worker returns as a new bounded row. Parent owns strict source/tests ratchets, full local PR boundary and CI.

## Parent rulings and release (2026-10-07)

R1: `calibration_suite_id` accepted as opaque identifier. It owns no suite content/version authority.

R2: Authority pins gate/node/attempt/definition before output. Default first flow captures output, receives server-issued full binding/report envelope, submits report verdict. Same-call semantic report is permissible only with expected target_digest computed from ACTUAL user_response/captured bytes and other four pins server-issued; report does not supply expected context. A client can hash its own final output. Complexity may favor two-call first, preserving ordinary same-call; supported same-call limits must be explicit and tested. Targetless report cannot pass.

R3: Baseline hold explicitly released by parent; descriptive coding-quality floor accepted, MCP benefit/cost/model-quality/human-calibration claims remain unknown. Cap one source worker. Parent publication authority is recorded rather than fake child publish:none; no child GitHub push.

R4: Parent accepted report.reviewer {provenance: client_reported|unknown, provider/model/revision optional nonempty, context optional self|separate_pass|isolated_judge|unknown}. Absent is unknown, submitted host_verified refused. Requested gate mode/model stays separate. Shared report type, public MCP schema and strict kernel parser co-change in row 1.2; metadata/docs separate row 1.3 to preserve three-module submission bounds. No unused new exported reviewer type.

F8: Ground-truth coverage has exactly one live call site, Stage 20. Row 5.2 ownership now names it, so the exclusion cannot remain an uncalled helper option. Metadata row 1.3 is a separate one-row bounded submission after Tier A schema controls.

F9: Opaque suite ID needs typed loaded/lightweight definition and exhaustive toGateDefinition conversion, beyond writer key preservation. Added row8.0 for those actual consumer files and loader controls. No early semantic union activation. Inspector currently renders guidance/routing fields but no pass_criteria; added row8.3 with actual GateDiscoveryProcessor and existing inspect readback tests, closing C6's inspection reader rather than treating file writes as inspect evidence.

DEV-H1.1: First local commit attempt refused child-plan formatting; formatted only planner-owned files. Next attempt reached full pre-commit source typecheck and refused index.ts989 false guard branch (schema lacks new optional evaluation while shared type admits it). No bypass/commit. Row1.1 owned-file diagnostics did not observe registration consumer. Row1.2 aligns schema/shared types and must inspect full source typecheck; registration repair if needed belongs its named row. Future commits occur with worker idle to avoid lint-staged sharing a live mutation.

## H1.1: canonical vocabulary accepted (2026-10-07)

Worker artifacts inspected: shared gate-evaluation types, renderer, renderer unit test, schema type-only import and per-gate-reply integration type-only import. All four input interfaces now have one shared definition; no renderer type reexports. Optional entry.evaluation remains typed and is explicitly not serialized by display renderer. Focused renderer tests baseline22 ->23passing; report-to-text mutation1failed then exact bytes restored; owned-file compiler probe0diagnostics before/after; Prettier and diff checks passed. Registered transport custody remains later-row work.

MCP workflow chain-strategic_worker#6 accepted node t1-1. Parent's later reviewer contract ruling expanded schema row1.2 and split metadata1.3, superseding the already compiled t1-2 file list before dispatch. Cancel the stale remainder and submit the corrected row; no worker executes stale bounds. This is a planning recut, not feature acceptance.

## H1.2: strict report/reviewer contract accepted (2026-10-07)

Spot-read shared report type, boundary schema and kernel parser: optional reviewer matches parent R9 exactly, host_verified excluded, client identity unused by acceptance math. Existing ordinary schema fields retained. Focused semantic-evaluation/undeclared-parameter tests100baseline ->168passing; host_verified acceptance mutation2failures, exact parser bytes restored and final suites green. Owned-file compiler0diagnostics; full npm run typecheck exit0 resolves registration narrowing error without index source edit; formatter/diff checks green. Registered report custody/live criterion activation remain pending. Worker idle before staging/commit.

DEV-P0-2: Parent corrected plan-row hygiene. Replaced letter task IDs with 25 numeric-dotted rows, added explicit St stamps, removed previous-tier entries from Depends, and recorded previous-tier gate entry requirements. tracking_reason corrected to operator-opt-out. Actual canonical auditPlanText/auditOpenRows/auditClosedRows/auditTableContiguity functions run against child plan: no violations; 25 stamped open rows; no done paths yet. The untracked plan was passed directly to audit functions because the ordinary command scans tracked files only.
