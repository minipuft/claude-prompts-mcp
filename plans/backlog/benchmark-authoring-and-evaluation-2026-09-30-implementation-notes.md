---
title: Benchmark authoring and evaluation implementation notes
date: 2026-09-30
status: backlog
tags: []
---

# Benchmark authoring and evaluation — implementation notes

## 2026-09-30 — future plan saved

- Requested artifact: [backlog implementation plan](benchmark-authoring-and-evaluation-2026-09-30.md). No implementation rows executed, resources authored, model trials launched, or git refs/index changed.
- Rechecked current resource types and ephemeral `execution_records` ownership in source. Re-read compact-profile implementation receipt and draft experiment template. Historical trial counts remain inherited recorded evidence, not rerun measurements.
- Checked all nine Markdown links and all explicitly named repository source paths; local references resolve. Checked backlog metadata and E1–E10/B1–B6 row presence. The repository-wide plan-row validator does not grade untracked/backlog plans; these direct checks cover the new document's structure and references only.
- `node server/scripts/validate-plan-row-tracking.js` exits 1 on four pre-existing missing open-row stamps in `plans/interview-boundary-2026-09-27.md`, lines 55, 56, 57 and 59. Left unrelated work unchanged. This is not a clean repository-wide validation receipt.
- Host probe: `stat /mnt/c` still returns `Input/output error`. No restart, mount repair, policy bypass or configuration change attempted.
- Future execution should update the plan's `Now` block and append findings here. Resolve experiment refs, pricing/checkpoint and host readiness before the paid comparison; do not make the future MCP package a prerequisite for the local benchmark.

## 2026-10-01 — proposal, evidence and evaluation loop

Owner requested a repeatable evaluation/benchmark loop around proposed changes and PR-based proposals rather than direct behavior changes. Extended the existing backlog with the lifecycle, an evaluation disposition for every change (reuse/add/not-applicable with rationale), exact evaluated-PR-head binding, review/promotion/rollback receipts and production feedback. Offline checks and existing cases remain the first choice; no paid batch is mandated for every edit.

Read-only discovery found usable native collectors and provenance/replay contracts in the local framework, a closed observation ledger schema and agent-workbench-owned conversation associations. In MCP, ResourceIndexer indexes resource types only; ConversationStore is a small in-memory buffer; PromptMatcher is substring/fuzzy search. None is a general conversation/issue evidence index. Table contracts remain authoritative for ephemeral execution_records despite stale comments elsewhere.

Placement recommendation: optional top-level evaluations/ package in this repository, explicit CLI/library installation first, with ingestion/index/core/adapters responsibilities. Framework repository supplies cases and source selection; source parsers are reused behind adapters rather than forked. Raw data/indexes stay outside Git. Reviewed EvidenceBundle and ChangeProposalRecord extend the proposed contracts; E3.1/E3.2/E9.1 add ingestion, retrieval and PR projection rows. Exact parser language/package build choices remain E1 decisions.

Historical text is untrusted evidence, not current instructions/authorization. Role separation, exact spans/digests, repository-qualified issue links, counterevidence and redaction are explicit. Candidate fixtures exclude solution-bearing history and protected holdouts. Retrieval relevance, parser lineage, source revisions and issue-link precision require their own controls; search similarity is not proof of causal linkage or redundant guidance.

Only local planning documents were changed. No runtime, active rule/skill/hook, public resource, issue/PR or paid benchmark was created or changed. Git fetches only refreshed remote-tracking references for scope inspection; no local branch switches, index changes or source edits were performed.

Validation: both updated plans have resolving local Markdown links, unique MCP task row IDs and resolving E-row references, balanced fences and no trailing whitespace. A bounded independent architecture review found no ownership/privacy/causality conflict in the reviewed sections; E9.1/E10 dependencies were checked by the parent. No runtime tests or paid evaluations were needed for this planning-only change.

## 2026-10-01 — distinct MCP rollout phase

The global framework next-iteration plan now names this backlog as Phase4. First local B1 scope-sensitive behavior cases and strategy comparisons use existing local runners after explicit measurement fixes, without waiting for an MCP package. Shared extraction follows reviewed case/stage/evidence contracts; no preferred-model victory is required. Existing E-rows remain canonical here, grouped into contract/archive extraction, selected evidence authoring, then optional MCP/PR integration. Local plan and links validated; no runtime or package implementation occurred.

## 2026-10-04 — production planner trace as a Time/Cost/Behavior evidence source

A transcript profiler was run over this repository's planner thread (T3 `25541be4`, Claude session `1604a8df`, 2026-09-19 to 2026-10-04, 185 worker transcripts). Findings, method limits and candidate changes are in `plans/planner-trace-evidence-2026-10-04.md` on branch `feat/framework-behavior-evaluation` of the global config repository (draft PR16); scripts, report and chart are beside it in `evaluations/evidence/planner-trace-2026-10-04/`. No plan row, runner or CI file was changed.

Relevant here: (1) it is a second native-transcript parser beside `claude_benchmark.py::transcript_capture`, with per-call cache state and parent/child cost split, and should fold into that adapter rather than stay separate; (2) it measures the Time dimension on real work: of 135h machine-side time, 12% was the local boundary suite and 11% was CI with nothing else in flight, and workers spent 46.6h running suites against 39.6h of inference; (3) CI was green on 32 of 33 runs for non-bot PR branches since 2026-09-25, while 148 of the PR CI runs were Renovate rebases; (4) CI's 17-minute median is a serial lint, build, test chain with the Node 22.13.0 leg on the critical path, not queueing. These are observational, single-thread measurements and do not grade quality.
