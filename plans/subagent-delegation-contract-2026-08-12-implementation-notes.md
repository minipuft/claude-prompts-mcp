---
title: "Sub-agent Delegation Contract — Implementation Notes"
plan: subagent-delegation-contract-2026-08-12.md
date: 2026-08-12
status: active
tags: []
---

# Implementation Notes

Deviations, discovered constraints, and re-measurements found while executing the plan.
Conservative option taken, logged, work continued.

## Deviations — diagnosis pass, 2026-08-12

- **DEV-S-1** — the first diagnosis was static-only and would have shipped a wrong emphasis. Code
  reading said "gates reach the envelope via `context.gateInstructions`"; the live probe showed
  **no envelope at all**. The static read was of the path that carries gates; the path that ran
  was the one that carries nothing. Reading a producer does not tell you it executed.
- **DEV-S-2** — the differential is what made the measurement conclusive, not the single probe.
  Running the command with and without `:: code-quality` and getting **byte-identical** output
  proves the gate declaration has no effect on the handoff, without needing to know why. One probe
  would have shown an empty envelope and left "maybe the gate id was wrong" open.
- **DEV-S-3** — `delegation-enforce.py` **blocked this diagnosis mid-flight**. After the probe left
  a delegation pending, a Bash call was denied with "Delegation pending: use Task tool… before
  making direct edits." That is the hook working, observed live and unplanned — and it is the
  strongest evidence in the session that the plugin's hooks fire in a normal session, which the
  headless harness could not settle.
- **DEV-S-4** — resuming with `user_response` and no Task call **completed the chain anyway**, with
  step 2 rendered inline. Delegation is advisory (D6) and nothing records that a handoff was
  skipped. Logged as S-F8 rather than a defect: it is the documented posture, but it means the
  envelope's contents are unobservable to the server, so no server-side gate can verify delivery.
- **DEV-S-5** — the probe ran against a **stale dist** (2026-08-12 08:03, 20 `src/*.ts` newer). Two
  findings (S-F6 gate-guidance-disabled, S-F7 banner doubling) may already be fixed in `src`. Tier
  S6 exists to re-measure before either is planned against. Recorded rather than silently dropped:
  a finding measured against a stale binary is not wrong, it is unattributed.
- **DEV-S-6** — S-F1 duplicates **P5-F1**, found independently at P5 T3 and already in the master
  plan's ledger. Kept in this plan's table with the duplication named, rather than deleted: the two
  routes to it are different (P5 reached it building the visibility filter; this reached it from
  the owner's symptom), and a finding with two independent sightings is stronger evidence that the
  field should be wired than either sighting alone.

## Rulings — 2026-08-18 blind-spot pass (pre-S1, owner-flagged premise)

**R-1 — The envelope model is superseded by the self-contained rendered brief; executor identity
demotes to advisory. ADOPTED.** The owner flagged both halves of the premise ("we can't send the
prompt to the subagent properly"; "relying on chain-executor or a specific sub-agent feels like the
wrong approach") and three parallel evidence traces confirmed both:

1. **Identity is already advisory everywhere that enforces anything** (agent B, spot-checked).
   `agents/chain-executor.md` declares NO `mcp__` tools — a spawned worker cannot call
   `prompt_engine`, so the Task prompt is the only delivery channel. `strategy.ts:103-116`
   `resolveAgentType` is pure string formatting; no registry lookup exists in server src; the IR
   passes `agentType` as free text at every layer. `delegation-enforce.py` gates on TOOL NAME;
   `subagent-gate-enforce.py`/`ralph_subagent_contract.py` key on TRANSCRIPT CONTENT
   (`### Quality Gates`, `GATE_REVIEW:`) — zero agent-type comparisons. The only identity consumer
   is Claude Code's own spawn-time registry, external to this codebase.
2. **Every brief ingredient except prior-step output is available at handoff-build time, and the
   envelope reads the wrong fields** (agent A). Per-step gate text EXISTS
   (`step.metadata['gateInstructions']`, stage 11, `gate-enhancement-service.ts:388-392`) and
   per-step framework context EXISTS (`step.frameworkContext`, stage 12, `12-framework-stage.ts:298-330`),
   but `buildHandoffEnvelope` (`response-assembler.ts:392-419`) reads run-scoped
   `context.gateInstructions` (assigned ONLY on the single-prompt branch,
   `gate-enhancement-service.ts:253` — never for chains) and `context.frameworkContext`
   (first-step-with-context, not N+1). The producers exist; the consumers read the wrong scope.
3. **The handoff is phase-shifted** (probe layout, verified against captured artifacts
   2026-08-18). The HANDOFF block for step N+1 is embedded in step N's response, and
   `→ Prompt: Pass ALL content above as the agent's prompt` points at STEP N's content. An
   obedient parent sends the subagent the WRONG STEP's prompt. On resume, step N+1 renders fully
   inline (framework + gate scaffold) with NO handoff block at all — the content and the handoff
   instructions live in different responses, one step out of phase. Prior-step output is
   structurally unavailable at the early-CTA moment (step N not yet executed) but IS available at
   resume (user_response just captured, `16-response-capture-stage.ts:211`).

**The winning architecture**: the delegated step's brief renders at RESUME time — the same moment
an inline step renders, where template, args, per-step gate text, per-step framework context,
prior-step output, and chain history are ALL available — as one self-contained block carrying the
`### Quality Gates` heading, with handoff instructions pointing at THAT block and agent_type as an
advisory hint. Delegation becomes purely a context-isolation choice: the same content exists
either way; only the executor changes. The early next-step CTA demotes to a one-line advisory.

**Consequences for the S-rows** (plan updated in the same commit as this ruling):

- S1 keeps its decision (wire, don't delete) but the producer feeds the resume-time brief via the
  P5 visibility filter, not the early CTA.
- S2 unchanged in content; lands in the brief renderer.
- S3 unchanged; still gated on S2; Claude-Code-only registration per the codex measurement.
- S4 shrinks: per-step gate resolution ALREADY EXISTS (stage 11 writes it per step); the fix is
  reading `step.metadata.gateInstructions` instead of `context.gateInstructions`.
- S5 demotes from dependency to enhancement: general-purpose can run a self-contained brief;
  shipping the agent definition buys a restricted-tool safety posture, not functionality.
- NEW S7: retire the phase-shifted early CTA and consolidate the two handoff producers
  (`buildDelegationCTA` operator-side, `buildHandoffSection` assembler-side) into one.
- **OQ2 of plans/prompt-surface-ir-consolidation-2026-08-18.md settles as a corollary**: an IR
  node carries the actual step's promptId; the brief renderer is server infrastructure, not a
  special row-executor prompt; executor identity is not part of the contract.

**R-2 — Gate verdict protocol: worker proposes, parent ratifies (owner-ruled 2026-08-18,
interview).** The brief's `### Quality Gates` section instructs the worker to return, WITH its
work product, a `Proposed Gate Review` block — per-gate pass/fail + one-line rationale, the same
shape as `gate_verdict.per_gate`. The parent reviews the work against the same criteria, may
override any proposed entry, and is the only party that submits `gate_verdict`. Carry-over
mechanics (the owner's embedded question — "how do tools/chain carry over, if possible at all"):
they carry as TEXT, which is the only channel that exists and it is sufficient — the worker has
no `mcp__` tools by design, so the chain resume token NEVER leaves the parent; the worker cannot
resume, cancel, or submit anything. Chain state flows brief → worker (per visibility) and
worker-result → parent → `user_response` (parent submits). The worker's TOOLSET is whatever its
Tier-17-selected `agentType` defines (`step ?? prompt ?? 'chain-executor'`) — orthogonal to the
verdict channel. Ratification is not optional ceremony: a parent that pastes the proposal
unratified is the rubber-stamp failure mode; the brief's result contract says "proposed", and the
parent-side text labels it as requiring review.

**R-3 — Brief default: FULL exposure (owner-ruled 2026-08-18).** Prior-step output, chain
history, and gate text are all in the brief unless the author withholds via the P5 visibility
policy. Inline and delegated steps see the same content by default; delegation is a
context-isolation choice, not a content reduction.

**R-4 — Enforcement: advisory + telemetry (owner-ruled 2026-08-18).** D6 stands — the server
cannot verify a spawn. New obligation: a run whose delegated step is resumed without any
delegation acknowledgment gets a `delegation_skipped` mark recorded on `execution_records`.
**Sequencing constraint**: that column rides the same table the offline phase-guard session's
uncommitted schema bump (v24, `declared_sections_json`) touches — the telemetry row lands AFTER
their bump commits, never concurrently (two sessions bumping SCHEMA_VERSION collide by
construction).

**Tier 17 import (owner-ruled 2026-08-18: retire + cross-ref).**
`plans/features/subagent-selection-2026-08-03.md` is fully shipped and moves to reference. Its
binding decisions import here rather than duplicate: `agentType` resolution is
`step ?? prompt ?? 'chain-executor'` (chain-operator-executor.ts:771), the value is a free string
the HOST validates, and under R-1 `'chain-executor'` is only the default HINT — the selection
surface is the author's knob for which executor receives the brief.

## Deviations — Wave 3 evidence pass, 2026-08-18

- **DEV-S-7** — the S6 probe agent found `@modelcontextprotocol/sdk` is NOT installed in
  server/node_modules (only this repo's own `@modelcontextprotocol/{core,node,server}`), so the
  probe used verify-mcp-surface.mjs's hand-rolled streamable-http client instead of a stdio+SDK
  client. Declared by the agent, accepted: same handshake pattern, same tool-call surface.
- **DEV-S-8** — the gated probe's step-2 echo rendered `**text**: :: code-quality`, i.e. the
  inline gate token may have been consumed as a positional argument. If so, the byte-identical
  gated/ungated handoffs partially measure "gate never attached" rather than "gate not carried" —
  and the SAME confound applies to the original 2026-08-12 probe, which used the same command
  shape. Does not weaken S-F1 (envelope empty regardless); DOES require S4's closure probe to
  verify gate attachment (node `inlineGateIds` / `gates_fired`) before trusting its result.

Not plan-tracked: `server/src/cli-shared/version-history.ts` comment reword (2026-08-18) — CI
repair for `validate:no-legacy-sidecars` after the origin/main merge, committed `d156038e`;
belongs to the repo-reconciliation work, not this plan.

Not plan-tracked: `server/tests/integration/mcp-tools/prompt-patch-update.test.ts` mock bridge
(2026-08-18, committed `bfabe156`) — same repo-reconciliation thread: the versioning session's
two-phase rollback contract vs a stale single-call test double, caught only by CI (test:ci runs
unit only).

## Discovered constraints

### Three-way session constraint set (as of 2026-08-18 · re-verify with `git status` + ListAgents before relying on it)

Written here because it must survive compaction; the peer sessions keep theirs in their plan
files (framework-lifecycle plan `7500eb8e` carries the mirror of this).

- **THIS session's live edit set** (S1/S2/S4/S7 brief renderer): `engine/execution/delegation/**`,
  `chain-operator-executor.ts`, `response-assembler.ts`, `gate-enhancement-service.ts`
  (read-side), `hooks/lib/ralph_subagent_contract.py` fixtures, delegation tests,
  `docs/concepts/chains-lifecycle.md`.
- **claude-prompts-mcp-98 (versioning → framework-lifecycle)**: `mcp/tools/framework-manager/**`,
  `gate-framework-versioning.integration.test.ts`, one additive change in
  `resource-mutation-transaction.ts` (cleared by me). Schema-free by construction, with a
  written tripwire: any schema appetite = stop and re-rule, so **v24 is uncontested from their
  side**.
- **Offline phase-guard session's orphaned uncommitted hunks** (owner unreachable): stages 18/19,
  `phase-guard-evaluator.ts`, `runtime-framework-loader.ts`, `sqlite-engine.ts` +
  `table-contracts.ts` (**the v24 bump — they own SCHEMA_VERSION 24**), `pipeline-builder.ts`,
  `chains/manager.ts`, `run-registry.ts`, shared types, validate scripts, knip-ratchet. Edit
  additively around them; never revert; S8 telemetry is BLOCKED behind their bump landing.

- `delegation/renderer.ts`, `types.ts`, `envelope-visibility.ts` are in the P5 session's uncommitted
  edit set. Nothing in this plan may edit them without coordinating; S1 and S2 both land there.
- The `hooks/lib/*` module API is in the Public API contract; the TS renderer is not. Any heading
  reconciliation moves the TS side.

## Implementation progress — S1/S2/S4/S7 brief renderer (2026-08-18, IN FLIGHT)

Pre-flight RESULT emitted in-session (0 failures, compound none) before the first edit.

Main-thread edits landed so far:

- `delegation/brief.ts` (NEW) — pure section builders: `QUALITY_GATES_HEADING` (S2, heading is
  load-bearing for `ralph_subagent_contract.py`), `buildQualityGatesSection` (S4 — consumes the
  per-step stage-11 field), `buildChainHistorySection` (S1), `buildResultContractSection` (R-2
  Proposed Gate Review), `buildWithheldManifestLine`, `BRIEF_START`/`BRIEF_END` delimiters.
- `delegation/renderer.ts` — `renderCurrentStepHandoff` (points at the brief, not "ALL content
  above") + `renderNextStepAdvisory` (S7 one-liner).
- `operators/types.ts` — `ChainStepRenderResult.currentStepDelegated?`.
- `chain-operator-executor.ts` — delegated-current wrap in `renderNormalStep` (worker lines →
  brief; gate text redirected into the brief; callToAction spawn-then-ratify), PARTIAL: two
  private builders + `buildDelegationCTA` advisory rewrite delegated to the source agent, so the
  file does not compile at this instant (dangling `applyVisibilityToEnvelope` import) — expected
  transient, owned by the in-flight agent.

Dispatch (owner-directed, subagents for implementation): source agent owns
chain-operator-executor/18-execution-stage/response-assembler (serialized, additive around the
offline session's foreign hunks); test agent owns new falsification test files per S-row + the
delegation-operator-flow retarget; docs agent owns chains-lifecycle.md. Falsification verdicts,
plan writeback, validation suite, and the commit stay main-thread.

Agent progress (2026-08-18, still in flight): docs agent DONE — chains-lifecycle.md rewritten to
the brief model (45+/20−), stale-term sweep clean (`Pass ALL content above` / `EXECUTION CONTEXT`
zero hits), gate-verdict flow + no-mcp-tools constraint documented for the first time; S8/S3
correctly excluded as unshipped/undecided. Source agent mid-edit (chain-operator-executor.ts,
18-execution-stage.ts landing in tree); test agent mid-edit (brief.test.ts landed). Verdicts and
suite run pending both.

### Falsification record — S1/S2/S4/S7 (2026-08-18, all mutations reverted after measurement)

| Mut | Target (what was broken)                                                | Named failing test(s)                                   | Result |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------- | ------ |
| M1  | `QUALITY_GATES_HEADING` → `####` (S2)                                   | brief.test.ts heading-exactness                         | 1 fail |
| M2  | delegated branch drops per-step gate text (S4)                          | S2/S4 own-gate-text, R-2 contract, P5-port coexistence  | 3 fail |
| M3  | `buildChainHistorySection` returns null (S1)                            | S1 history test, P5-port expose-restores-history        | 2 fail |
| M4  | advisory regrows `HANDOFF INSTRUCTIONS` + `Pass ALL content above` (S7) | S7 advisory, assembler advisory ×2, single-producer pin | 4 fail |
| M5  | result contract ignores `hasGates` (R-2)                                | brief.test PROPOSED framing, R-2 operator test          | 2 fail |

**DEV-W4-2** — M2 and M4 initially SURVIVED (0 fails) because the mutations never applied: M2's
sed produced `undefined ?? X` (a semantic no-op — nullish coalescing), and M4's sed pattern used a
literal `⚡` while the on-disk file carries `⚡` escapes (a formatter normalizes unicode on
write). Both re-applied with verified on-disk presence before re-running — the
mutation-never-reached rule, self-inflicted edition.

**Live-probe receipts** (scratchpad `probe-r1.txt`, `probe-3step.txt`): step N advisory one-liner;
delegated step's own response = BRIEF → Result Contract → END BRIEF → HANDOFF pointing at the
brief; 3-step run's brief carried `#### Step 1` + the literal `STEP-ONE-DISTINCT-OUTPUT-MARKER`.
S2 Python receipt: `extract_quality_gates()` returned the gate text against a brief captured from
the production `assembleBriefBody` (scratchpad `captured-brief.txt`).

**DEV-W4-3** — max-lines ratchet regression: the brief additions pushed
`chain-operator-executor.ts` to 1032 counted lines (limit 1000, second violation after
manager.ts). Fixed by completing the extraction the pre-flight anticipated: `assembleBriefBody`
moved to `delegation/brief.ts`, `renderDelegatedStepHandoff` to `delegation/renderer.ts`; the
operator keeps only `collectBriefHistory` (needs its accessors). Ratchet green after.

**DEV-W4-4** — same-PR envelope-path deletion (cleanup-standards): with both handoff producers
retargeted, `DelegationRenderer.render()`, `buildInstructions`, `buildEnvelope`, `hasContent`,
`ExecutionEnvelope`, and `envelope-visibility.ts` had ZERO production callers. Deleted, with
`envelope-visibility.test.ts` removed and `delegation-renderer.test.ts`'s first describe rewritten
against the two surviving render modes; the P5 manifest wiring proof ported to the operator test
file (where the behavior now lives). `rg "Pass ALL content above" src/` → zero.

**DEV-W4-1 resolution** — `response-assembler-delegation.test.ts` (8 tests) and
`response-assembler-visibility.test.ts` rewritten main-thread: strategy tests retarget to the
per-profile FOOTER (the one client-profile surface the assembler kept); footer priority test now
pins the S7 flip (next-delegated no longer wins the footer; current-delegated does); a new
single-producer pin fails if the assembler's envelope ever grows back.

Final state: typecheck clean · lint:ratchet OK · typecheck:tests:ratchet OK · delegation+execution
tree 1024/1024 · full unit suite 2659 passing.

Test agent DONE (2026-08-18): 30/30 green — brief.test.ts (13, pure builders),
chain-operator-executor-delegation.test.ts (5, one per S-row), delegation-operator-flow.test.ts
retargeted (8 assertion blocks, each with an `(S7)` why-comment; one behavioral correction: the
spawn CTA now keys on the CURRENT step's delegation, not the next's). **DEV-W4-1 — partition
gap**: pre-existing `tests/unit/execution/formatting/response-assembler-delegation.test.ts` was
in nobody's assignment; 7 tests fail asserting the assembler's OLD full-handoff output.
Main-thread owns retargeting it to the advisory shape — it doubles as S7's falsifier for the
second producer.

## Validation runs
