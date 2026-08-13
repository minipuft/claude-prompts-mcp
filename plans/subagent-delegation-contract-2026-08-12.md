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

### S1 — Give the envelope a producer for chain history ☐ (as of 2026-08-12 · flips when a delegated step's envelope contains prior-step output in a live probe)

`chainHistory` is filtered and rendered but never set. Either wire the producer or delete the
field — **the decision is the tier**, and it is not obvious: P5 built a withholding policy naming
`chain_history` as one of three items, so deleting the field silently guts a shipped feature,
while wiring it changes what every delegated step receives.

Coordinate with the P5 owner before touching `delegation/` — that module is their active edit set.

### S2 — Emit the heading the enforcement contract requires ☐ (as of 2026-08-12 · flips when `extract_quality_gates()` returns non-None against a real captured envelope)

The Python side is the published contract (`hooks/lib/*` module API is in the Public API table).
The TS side is not. So the TS renderer moves to `### Quality Gates`, not the hook. One-line change
plus a fixture built from a **captured** envelope, never a hand-written one.

### S3 — Decide `subagent-gate-enforce.py`: register or delete ☐ (as of 2026-08-12 · flips when the hook appears in hooks.json, or its file and its 4 test files are gone)

It has four test files and no registration. Its `closedBy` already says: register after confirming
the transcript shape, or delete. S2 is its prerequisite — registering it against a heading nothing
emits produces a hook that always passes, which is worse than one that does not run.

The codex port measured that the delegated prompt is **unrecoverable** on Codex (encrypted in the
spawn payload, absent from the transcript) — so a Codex registration cannot work regardless. That
argues for Claude-Code-only registration or deletion.

### S4 — Per-step gate text in the envelope ☐ (as of 2026-08-12 · flips when a probe shows step N+1's own gate ids in the handoff while step N's are absent)

Depends on S1/S2 landing and on S-F5 being reproduced. The shape is per-step gate resolution at
handoff time rather than reuse of a run-scoped field — P5 already built per-step `reviewGateIds`
(P4-F3 closure), which is the natural source.

### S5 — Agent export (migrated from the master plan's P8, verbatim scope) ☐ (as of 2026-08-12 · flips when an agent definition exports to a client directory via the sync surface)

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

### S6 — Re-measure against a fresh build ☐ (as of 2026-08-12 · flips when `npm run build && npm run verify:mcp` precedes a re-run of the S-F6/S-F7 probes)

The running dist is 20 src files behind. S-F6 and S-F7 are measured against it and may already be
fixed in `src`. **Do this first** — it is cheap and it may retire two findings before anyone plans
a fix for them.

## Constraints

| Constraint                                         | Consequence                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `delegation/` is another session's active edit set | `renderer.ts`, `types.ts`, `envelope-visibility.ts` are P5's; coordinate before editing      |
| MCP inversion of control (D6)                      | The handoff is a CTA the parent may ignore — proven live. No fix can make delivery mandatory |
| Python hook module API is in-contract              | The `### Quality Gates` heading moves on the TS side, never the Python side                  |
| Docs lockstep                                      | `docs/concepts/chains-lifecycle.md` describes delegation; update with any envelope change    |

## Sources

| Field            | Reference                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Owner report     | 2026-08-12 session — step-scoped gates, `-->` as the only delimiter                                                |
| Live measurement | `prompt_engine` probes on `chain-reference_demo#1`/`#2`, this session                                              |
| Prior finding    | P5-F1 (same `chainHistory` field, found independently at P5 T3) · P5-F5 (delegation+visibility client-unreachable) |
| Codex divergence | [`codex-prompts-port-2026-08-03.md`](reference/codex-prompts-port-2026-08-03.md) §Spike Results S1                 |
