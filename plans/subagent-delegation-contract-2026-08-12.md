---
title: "Sub-agent Delegation Contract — Envelope, Gates, and Agent Export"
date: 2026-08-12
status: active
tags: []
---

# Sub-agent Delegation Contract — Envelope, Gates, and Agent Export

**Work type**: bug_fix (S1–S4) + feature (S5, migrated from the adaptive-chain master plan as P8)
**Origin**: owner report 2026-08-12 — "sub-agents aren't receiving the context, or gates, from the
prompt that leads to the agent firing… they're part of the same step."
**Parent**: [`adaptive-chain-runtime-2026-08-09.md`](reference/adaptive-chain-runtime-2026-08-09.md) — P8
migrated here in full; delegation findings P5-F1/F5 bind.
**Companion**: `subagent-delegation-contract-2026-08-12-implementation-notes.md`

## The owner's model is correct; the parse already implements it

Verified against the parser, not assumed: `-->` is the ONLY step delimiter
(`splitByChainDelimiter`, `findChainDelimiterOutsideQuotes` in `symbolic-operator-parser.ts` scan
for `-->` alone, quote-aware). `::` gate, `^` framework, `#` style, `==>` delegation are all
within-segment operators that stack onto the current step. **A gate declared beside a prompt is on
that prompt's step.** The defect is entirely downstream of the parse, in what the handoff carries.

## Measured 2026-08-12 (live server, not inferred)

Probe: `>>reference_demo :: code-quality ==> >>reference_demo`, then the same command without
`:: code-quality`, via `prompt_engine` against the running plugin.

**The two handoffs were byte-identical.** Declaring a gate on the step changed nothing. The
emitted handoff was:

```
⚡ HANDOFF: Execute Step 2 ("Reference Syntax Demo") via sub-agent for context isolation.
═════════════════════════════════════════
HANDOFF INSTRUCTIONS
═════════════════════════════════════════
→ Tool: Task
→ Parameters: subagent_type "claude-prompts:chain-executor", model "sonnet"
→ Prompt: Pass ALL content above as the agent's prompt
→ Result: Include sub-agent's result in user_response to complete the chain
```

There is **no `EXECUTION CONTEXT` block at all** — the renderer emits one only when
`hasContent(envelope)` is true, and it was not. No gate text, no chain history, no framework
guidance. The `Result:` line also carries no gate hint, which the renderer omits only when
`gateGuidanceEnabled !== true`.

**Then the sharpest part.** Resuming the chain without spawning any sub-agent, step 2 rendered
**inline in the main context** — and it received the full CAGEERF framework overlay and a
`Gate Coverage` / `GATE_REVIEW` scaffold. So the content exists and is produced; it goes to the
parent. A sub-agent that obeyed the handoff would have received a prompt with none of it, while
the parent kept all of it.

**Caveat, stated rather than buried**: the probe's template failed to render
(`[ERROR] Template rendering failed for reference_demo`), and the running `dist` is from
2026-08-12 08:03 with **20 `src/*.ts` files newer than it**. Neither weakens the envelope finding
— the framework overlay and gate scaffold rendered fine in the same response, so envelope
emptiness is not a consequence of the template error, and S1/S2 below are grep-confirmed at HEAD
independent of the running build. It does mean **S6/S7 must be re-measured against a fresh build**
before anyone acts on them.

## Findings

| Id   | Finding                                                                                                                                                                                                                                                                       | Evidence                                                                                       | Status                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| S-F1 | `ExecutionEnvelope.chainHistory` is a reader-without-producer: declared (`delegation/types.ts:26`), read (`renderer.ts:60,110`), filtered (`envelope-visibility.ts:50`), **assigned nowhere**. Chain history structurally cannot reach a sub-agent envelope                   | `git grep chainHistory HEAD -- server/src/engine/**` → zero assignments                        | CONFIRMED at HEAD. Duplicate of P5-F1 (same field, independently re-found) |
| S-F2 | The gate-enforcement hook looks for a heading nothing emits. `ralph_subagent_contract.py:14` requires `### Quality Gates`; the renderer pushes raw `gateInstructions` with no heading. The only producer is `judge-menu-formatter.ts` with **four** hashes, in the judge menu | grep both sides                                                                                | CONFIRMED                                                                  |
| S-F3 | `subagent-gate-enforce.py` is not registered on any event — the declared exception in `validate-hook-registration.js`. Even a correct heading would be read by nothing                                                                                                        | wiring gate output: `7/8 registered, 1 declared exception`                                     | CONFIRMED                                                                  |
| S-F4 | Two CTA producers; one is empty by construction. `chain-operator-executor.ts:707` passes `envelope = null` and `gateCount: 0`; its own comment says this CTA "has never carried chain history or gate text"                                                                   | read at :694–710                                                                               | CONFIRMED                                                                  |
| S-F5 | No per-step gate text exists to hand across. `buildHandoffEnvelope` reads `context.gateInstructions` — a single context-level field written by `GateEnhancementService` for the step that just ran — while the handoff targets `stepNumber + 1`                               | read; **not** separately reproduced (the live probe's envelope was empty for the prior reason) | REASONED — needs its own probe once S6 is fixed                            |
| S-F6 | `gateGuidanceEnabled` was false during the probe (`state.injection.gateGuidance.inject === false`), so even a populated envelope would have rendered no gate hint. Default is true when injection state is absent, so something set it                                        | renderer branch elimination + `isGateGuidanceInjectionEnabled` at :677                         | OPEN — re-measure on a fresh build                                         |
| S-F7 | The live banner rendered `## 🎯 Framework Framework Active` — the P0(b) doubling the master plan records as fixed 2026-08-09. `src` carries the guard (`chain-operator-executor.ts:618–624`); the running dist predates 20 src files                                          | live probe output vs src                                                                       | OPEN — likely stale dist, confirm after rebuild                            |
| S-F8 | Delegation is advisory end-to-end. Resuming with `user_response` and no Task call completed the chain with step 2 inline; nothing detected the skipped handoff                                                                                                                | live probe                                                                                     | BY DESIGN (D6) — but see S4                                                |

## Tiers

### S1 — Give the envelope a producer for chain history ✓ (2026-08-18 · FLIPPED by live probe: the delegated step-3 brief contained `#### Step 1` + the actual `STEP-ONE-DISTINCT-OUTPUT-MARKER` from the run — scratchpad probe-3step.txt)

`chainHistory` is filtered and rendered but never set. Either wire the producer or delete the
field — **the decision is the tier**, and it is not obvious: P5 built a withholding policy naming
`chain_history` as one of three items, so deleting the field silently guts a shipped feature,
while wiring it changes what every delegated step receives.

Coordinate with the P5 owner before touching `delegation/` — that module is their active edit set.

**RULED 2026-08-18 (R-1, implementation notes): wire, don't delete** — and the producer feeds the
**resume-time brief**, not the early CTA. Source: captured `step_results` via
`getStoredStepResult`, filtered by the P5 visibility policy. The delegation/ constraint has
expired (directory clean at HEAD 2026-08-18); see updated Constraints table.

### S2 — Emit the heading the enforcement contract requires ✓ (2026-08-18 · FLIPPED: `extract_quality_gates()` returned the gate text against a brief captured from the production builder; heading exactness mutation-verified — `####` variant fails the named test)

The Python side is the published contract (`hooks/lib/*` module API is in the Public API table).
The TS side is not. So the TS renderer moves to `### Quality Gates`, not the hook. One-line change
plus a fixture built from a **captured** envelope, never a hand-written one.

### S3 — Decide `subagent-gate-enforce.py`: register or delete ✓ (2026-08-18 · RULED delete, EXECUTED: hook + its 36-test suite deleted; 7 hook-behavior tests removed from the integration file with zero lib-coverage shrinkage (all lib parsers have direct coverage in test_ralph_subagent_contract.py, untouched); validator exception retired (0 declared exceptions, 7/7 registered); pytest 233→190 accounted exactly; sweep returns plans/ only. Ruling legs: owner's Advisory+telemetry ruling forbids a blocking hook; worker-proposes/parent-ratifies makes a FAIL proposal legitimate output blocking would suppress; the hook parses legacy GATE_REVIEW while the shipped brief asks for Proposed Gate Review; Codex-unrecoverable regardless. NOTE the flip condition's '4 test files' was untrusted inventory — measured: 1 suite deleted, 3 test files + conftest edited in place)

It has four test files and no registration. Its `closedBy` already says: register after confirming
the transcript shape, or delete. S2 is its prerequisite — registering it against a heading nothing
emits produces a hook that always passes, which is worse than one that does not run.

The codex port measured that the delegated prompt is **unrecoverable** on Codex (encrypted in the
spawn payload, absent from the transcript) — so a Codex registration cannot work regardless. That
argues for Claude-Code-only registration or deletion.

### S4 — Per-step gate text in the envelope ✓ (2026-08-18 · brief reads the per-step stage-11 field; mutation M2 (drop the read) fails 3 named tests incl. own-vs-other discrimination. CAVEAT: live end-to-end gate flow through `::` syntax is gated on S9 — the probe's gate never ATTACHED, which is upstream of this row)

Depends on S1/S2 landing and on S-F5 being reproduced. The shape is per-step gate resolution at
handoff time rather than reuse of a run-scoped field — P5 already built per-step `reviewGateIds`
(P4-F3 closure), which is the natural source.

**SHRUNK 2026-08-18 (R-1)**: per-step gate TEXT already exists — stage 11 writes
`step.metadata['gateInstructions']` for every chain step (`gate-enhancement-service.ts:388-392`);
the envelope reads run-scoped `context.gateInstructions`, which is assigned only on the
single-prompt branch (`:253`) and is never set for chains. The fix is reading the per-step field
in the brief renderer, not building new resolution. Closure probe must first verify the gate
actually ATTACHED (DEV-S-8: the probe's `:: code-quality` token may have been consumed as a
positional argument — check the run's node `inlineGateIds` before trusting handoff diffs).

### S5 — Agent export ✗ KILLED (2026-08-18 · R-1 removed its blocking value — under the self-contained brief, general-purpose runs any delegated node, so shipping `agents/chain-executor.md` buys only a restricted-tool safety posture · revives if a delegated node ever needs tool-restriction guarantees the brief cannot express — reopen as its own plan then, not a row here. First application of the do-or-kill rule, cleanup-standards §Do or Kill, replacing this row's earlier 'demoted' limbo)

**Goal**: extend the server's export surface (skills-sync precedent) to AGENT definitions, so
subagents ship alongside prompts/skills to downstream consumers (codex/gemini/opencode ports; the
plugin already ships `chain-executor`).

**Promotion condition MET 2026-08-12** — first candidate is a commit-orchestration agent
(attribution manifest → hunk-split staging → verify → commit), used as a briefed general-purpose
worker for the P3+P4 consolidated commit (sighting one) and again for the P5 landing
(`c07a80c1`+3: 4 commits, 2 manifest corrections on diff evidence, a commitlint scope rejection
handled without bypass, compile-closure verified in an isolated worktree — sighting two). The two
briefs are the specification corpus.

**Research questions (when opened)**: agent definitions as a resource type vs a sync target;
whether export rides `skills-sync.yaml` or gets its own manifest; how per-client agent-format
divergence (claude `.claude/agents` vs codex/gemini shapes) maps onto the existing ports'
divergence handling.

**Why it lives here now**: P8 was queued in a plan about _chain runtime adaptivity_; agent export
is about _what a sub-agent is and how it ships_. Same subject as S1–S4 — the sub-agent contract —
and its first candidate is an agent, not a chain behavior.

**DEMOTED 2026-08-18 (R-1)**: under the self-contained-brief architecture, general-purpose can run
any delegated node, so shipping `agents/chain-executor.md` buys a restricted-tool safety posture,
not functionality. Still worth doing; no longer blocks anything.

### S8 — `delegation_skipped` telemetry on execution_records ☐ (as of 2026-08-18 · flips when a resume-without-spawn of a delegated step produces a row with the mark, and a spawned one does not; BLOCKED until the phase-guard session's v24 schema bump lands — two sessions bumping SCHEMA_VERSION collide by construction)

R-4 (owner-ruled): enforcement stays advisory (D6), but the server records what it cannot
prevent. Read-back consumer: `system_control execution_history`. Partial population by row type,
same reading as the v21 terminal columns.

### S7 — Retire the phase-shifted early CTA; one handoff producer ✓ (2026-08-18 · FLIPPED by live probe: BRIEF + HANDOFF INSTRUCTIONS in the delegated step's own response, pointing at the brief; prior step carries a one-line advisory; `rg "Pass ALL content above" src/` returns ZERO — render()/buildInstructions/buildEnvelope/ExecutionEnvelope/envelope-visibility.ts deleted same-PR)

NEW row from R-1's third evidence leg: the HANDOFF for step N+1 is embedded in step N's response
and `Pass ALL content above` points at step N's content — an obedient parent hands the subagent
the wrong step's prompt, while N+1's real content renders inline to the parent one resume later
with no handoff at all. Fix: the brief + handoff render together at resume time; the early CTA
demotes to a one-line advisory; the two producers (`buildDelegationCTA`,
`chain-operator-executor.ts:760-802`; `buildHandoffSection`, `response-assembler.ts:344-377`)
consolidate to one. Transport parity applies (STDIO + streamable HTTP).

### S9 — Inline gate token consumed as a positional argument ✓ (2026-08-18 · fix `e6931647`: per-segment `::` attribution in parseChainOperator; falsified both ways (M-a strip-mutation → 4 named tests fail incl. the args assertion; M-b attribution-mutation → exactly tests 1/2/3/7); LIVE receipt via committed-HEAD build probe: gated `>>minimal_prompt :: code-quality ==> >>minimal_prompt` step-1 review list leads with Code Quality Standards while the control chain lacks it (probe-s9-chain.txt), and the single-prompt pair discriminates gates-enabled. The flip condition's reference_demo echo half is unmeasurable as written — reference_demo's inline word_count script fails on chain-mode arg resolution in every generation of probes, gated AND control (pre-existing, filed in notes) — args cleanliness is receipted by unit test 1 + M-a instead)

Promoted from DEV-S-8: both the 2026-08-12 and 2026-08-18 probes show the gated run's step-2 echo
rendering `**text**: :: code-quality` — the gate token parsed as the prompt's positional argument,
so the gate likely never attached. This confounded every gated-vs-ungated handoff diff in both
probe generations, and it blocks S4's live end-to-end closure. Parser scope
(`symbolic-operator-parser.ts` / argument capture), not envelope scope.

**DIAGNOSED 2026-08-18** (implementation-notes §S9 diagnosis): three linked defects — deliberate
non-strip at `parseChainOperator` (:439 comment), `ExecutionStep.inlineGateCriteria` has zero
writers (downstream per-step machinery fully built and dead), and chains' gate context reads only
`step.inlineGateIds` while the `::` gate registers at execution scope. Fix ruled: per-segment
attribution + strip in the parser; implementation in flight with mandatory falsification.

### S10 — Gate-review render's delegation advisory names the synthetic review step ✓ (2026-08-18 · fixed in the ASSEMBLER, not the operator — root cause differed from the filed mechanism: the operator's callToAction is write-only metadata nothing reads; the client-visible advisory is ResponseAssembler.buildHandoffSection reading synthetic stepNumber+1/promptName from gate-review metadata. Now resolves identity from the real parsed delegated step (convertedPrompt name, real stepNumber/totalSteps), metadata read kept only as a pinned fallback; falsified byte-exact (mutation reproduced `Step 4 ("Quality Gate Validation")`, named failing test); 3 tests incl. producer-boundary pin on the operator; 123/123 across operators+delegation+formatting)

Observed in both the old envelope ("HANDOFF: Execute Step 4 (\"Quality Gate Validation\")", 2026-08-18 morning) and the new advisory ("⚡ Note: Step 4 (\"Quality Gate Validation\") is delegated", probe-s9-chain.txt line 227/447, gated AND control) — a 2-step chain claiming step 4. `chain-operator-executor.ts:358-364` returns a synthetic render result (`promptId: '__gate_review__'`, `promptName: 'Quality Gate Validation'`, synthetic stepNumber), and the delegation advisory emitted alongside a gate-review response takes its stepNumber/promptName from THAT render result instead of the delegated real step. Gate-independent, pre-existing, cosmetic-to-confusing (misleads the parent about what is delegated). Unit coverage gap: advisory-targeting tests cover normal renders only, not the review branch.

### S6 — Re-measure against a fresh build ✓ (2026-08-18 · build + verify:mcp 17/17 + both probes re-run via streamable-http against the fresh dist)

The running dist is 20 src files behind. S-F6 and S-F7 are measured against it and may already be
fixed in `src`. **Do this first** — it is cheap and it may retire two findings before anyone plans
a fix for them.

**Result 2026-08-18**: "may already be fixed" was half true. S-F7's guard IS in the fresh dist
(`chain-operator-executor.ts:678-685`) — fixed-by-code, not visually exercised because
`reference_demo`'s template still fails to render, the same evidentiary gap the original probe
carried. **S-F6 still reproduces live**: the `Result:` line carries no gate hint on the fresh
build; `renderer.ts:79-83` emits `gateHint` only when `hints?.gateGuidanceEnabled === true` and it
was false at render time. S-F1/S-F5 re-confirmed: no `EXECUTION CONTEXT` block in either handoff;
gated and ungated step-1 handoffs **byte-identical except the chain id**. New observation for S4:
the gated run's step-2 echo shows `**text**: :: code-quality` — the inline gate token may have been
consumed as a positional argument, which would confound "gate declared but not carried" with "gate
never attached"; verify gate attachment (run's node `inlineGateIds` / `gates_fired`) before closing
S4. Probe artifacts: scratchpad `probe-s6.mjs`, `handoff-gated.txt`, `handoff-control.txt`.

## Constraints

| Constraint                                                                                          | Consequence                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~`delegation/` is another session's active edit set~~ EXPIRED 2026-08-18 — directory clean at HEAD | Constraint MOVED: `chain-operator-executor.ts`, `response-assembler.ts`, `operators/types.ts` carry ~213 uncommitted lines from the phase-guard-declaration session (declared sections — no delegation overlap). Edit additively; never revert a foreign hunk |
| MCP inversion of control (D6)                                                                       | The handoff is a CTA the parent may ignore — proven live. No fix can make delivery mandatory                                                                                                                                                                  |
| Python hook module API is in-contract                                                               | The `### Quality Gates` heading moves on the TS side, never the Python side                                                                                                                                                                                   |
| Docs lockstep                                                                                       | `docs/concepts/chains-lifecycle.md` describes delegation; update with any envelope change                                                                                                                                                                     |

## Sources

| Field            | Reference                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Owner report     | 2026-08-12 session — step-scoped gates, `-->` as the only delimiter                                                |
| Live measurement | `prompt_engine` probes on `chain-reference_demo#1`/`#2`, this session                                              |
| Prior finding    | P5-F1 (same `chainHistory` field, found independently at P5 T3) · P5-F5 (delegation+visibility client-unreachable) |
| Codex divergence | [`codex-prompts-port-2026-08-03.md`](reference/codex-prompts-port-2026-08-03.md) §Spike Results S1                 |
