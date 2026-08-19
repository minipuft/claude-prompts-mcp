---
title: "Subagent Selection — Tier 17"
date: 2026-08-03
status: reference
tags: []
---

# Subagent Selection — Tier 17

> **RETIRED to reference 2026-08-18** — all 8 subtiers ✓ and the gate passed 2026-08-03; nothing
> open remains. Retired during the delegation-contract R-1 work, which imports (not duplicates)
> this plan's binding decisions: see `plans/subagent-delegation-contract-2026-08-12-implementation-notes.md`
> §Rulings "Tier 17 import". Under R-1, `agentType` selection is the author's knob for which
> executor receives the self-contained brief; `chain-executor` remains only the default hint.

**Date**: 2026-08-03
**Area**: `server/src/modules/prompts/`, `server/src/engine/execution/parsers/`,
`server/src/engine/execution/operators/`, `server/src/engine/execution/pipeline/stages/`
**Work type**: feature (new user-facing surface)
**Origin**: [`pipeline-followup-2026-08-03.md`](../techincal_debt/pipeline-followup-2026-08-03.md) Tier 15B
**Confidence**: high — the wiring path is fully mapped and an identical, working sibling exists

---

## The gap

**No prompt author can choose which subagent a delegated step spawns. Every delegated step in
the system spawns `chain-executor`.**

`ChainStepPrompt.agentType` is declared in `operators/types.ts:31` with the comment "Override
agent type for delegation (default: 'chain-executor')" and read once, at
`chain-operator-executor.ts:615`. It has **no YAML key and no writer in `src/`**, so the read has
always resolved to its default. Tier 15B deleted its prompt-level sibling
(`ConvertedPrompt.delegationAgent`) for exactly this reason; `agentType` survived only because
the Tier 10 detector watches `ConvertedPrompt` and not `ChainStepPrompt`.

This is not a regression from Tier 15B. Both halves were unreachable before it and after it.

## Why this is worth building rather than deleting

Tier 15B's rule was that the user-facing interface decides. For `delegation: true` there was no
interface and no demand, so it went. Here the operator has stated the demand: selecting the exact
subagent is the useful half of per-prompt delegation. That converts it from a dead channel into a
missing producer — the other branch of the same diagnostic.

**`subagentModel` is the working sibling and the template.** It expresses precisely the shape
wanted here — a prompt-level default with a per-step override — and it is wired end to end:

| Layer                         | `subagentModel` (works)           | `agentType` (this tier)   |
| ----------------------------- | --------------------------------- | ------------------------- |
| Chain-step YAML schema        | `prompt-schema.ts:87`             | absent                    |
| Prompt-level YAML schema      | `prompt-schema.ts:254`, `:362`    | absent                    |
| Loader normalization          | `yaml-prompt-loader.ts:376`       | absent                    |
| Converter → `ConvertedPrompt` | `converter.ts:165`                | absent                    |
| Prompt default → step         | `symbolic-command-builder.ts:232` | absent                    |
| Step ?? prompt merge          | `04-parsing-stage.ts:159`         | absent                    |
| Final resolution              | `chain-operator-executor.ts:616`  | read only, always default |

Copying a working path is lower risk than designing one, and it keeps the two delegation knobs
behaving identically rather than each having its own precedence rules to remember.

## Decisions

**Resolution order**: `step.agentType ?? prompt.agentType ?? 'chain-executor'`. Same precedence
as `subagentModel`, so one rule covers both.

**YAML key is `agentType`, not `agent`.** It matches the existing field on `ChainStep`, the
delegation payload (`delegation/types.ts:16`), and every `formatToolCall` strategy. A friendlier
`agent:` key would need a rename at the loader boundary — the hidden-transformation anti-pattern
`.claude/rules/mcp-contracts.md` names explicitly, where the name a user writes is not the name
the code carries.

**Type is `string`, not an enum.** Agent names are host-defined (`Explore`, `general-purpose`,
plugin-namespaced types). `strategy.ts:103` already namespaces bare names at render time. An enum
would need editing whenever a host adds an agent.

**No validation that the agent exists.** The server cannot see the host's agent registry. An
unknown name renders into the call-to-action and the host reports it — the same failure mode as
today's hardcoded `chain-executor` if a host lacked it.

**`delegation: true` stays deleted.** Blanket prompt-wide delegation was the half without demand;
`==>` expresses per-step delegation explicitly at the call site.

## Subtiers

| #    | Status | Step                                                                           | Files                                                         | Depends | Verification                                                     |
| ---- | ------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| 17.1 | ✓      | Add `agentType` to chain-step and prompt-level YAML schemas                    | `prompt-schema.ts`                                            | —       | Schema parses a prompt declaring it at both levels               |
| 17.2 | ✓      | Carry it through loader normalization and the cross-layer contract types       | `yaml-prompt-loader.ts`, `shared/types/index.ts`              | 17.1    | `typecheck` clean; `ChainStep`/`PromptData` both carry the field |
| 17.3 | ✓      | Write the prompt-level value onto `ConvertedPrompt`                            | `converter.ts`, `engine/execution/types.ts`                   | 17.2    | Field re-added **with** a producer, unlike Tier 15B              |
| 17.4 | ✓      | Merge step over prompt in both step-building paths                             | `symbolic-command-builder.ts`, `04-parsing-stage.ts`          | 17.3    | Both chain entry points resolve identically                      |
| 17.5 | ✓      | Consume the resolved value at the delegation boundary                          | `chain-operator-executor.ts`                                  | 17.4    | `step ?? prompt ?? 'chain-executor'`                             |
| 17.6 | ✓      | Watch `ChainStepPrompt` in the write-never detector so this class cannot recur | `validate-state-field-writers.js`                             | —       | Detector reports the new interface; baseline stays empty         |
| 17.7 | ✓      | Integration test: YAML declaration reaches the rendered call-to-action         | `tests/integration/pipeline/delegation-operator-flow.test.ts` | 17.5    | Fails before 17.1-17.5, passes after                             |
| 17.8 | ✓      | Document the key at both levels with the precedence rule                       | `docs/concepts/chains-lifecycle.md`                           | 17.5    | Docs/code lockstep (CLAUDE.md Core Principle 4)                  |

**Gate**: a prompt declaring `agentType` at prompt level, with one step overriding it, renders
three distinct agent types across three steps — the declared one, the override, and
`chain-executor` where neither applies — proven by an integration test that fails without the
wiring.

## Risks

**Medium-low.** The path is additive and every touched site already handles an optional sibling
field the same way.

The one real trap is **17.4: two step-building paths exist.**
`symbolic-command-builder.ts` builds steps for symbolic (`-->`/`==>`) chains and
`04-parsing-stage.ts` builds them for declared `chainSteps`. Wiring one and not the other yields
a field that works through one entry point and silently defaults through the other — a partial
producer, which reads as a working feature until someone uses the other syntax. Both, or neither.

**17.6 is not optional bookkeeping.** `agentType` survived Tier 15B's sweep purely because the
detector's watched set stopped at `ConvertedPrompt`. Adding `ChainStepPrompt` is what stops the
next declared-but-unwired field on that interface from lasting another release.

## Rejected alternatives

- **Restore `delegationAgent` under its old name** — it was a prompt-level-only field whose read
  site is gone. Reusing the name would suggest a revert, when this is a differently-scoped
  surface (both levels, one precedence rule shared with `subagentModel`).
- **Enum of known agent types** — agent names come from the host, not this server. An enum turns
  every new host agent into a server release.
- **Validate the agent name against a registry** — no such registry is visible from here. Failing
  a valid name because the server has not heard of it is worse than passing an invalid one
  through to a host that can report it precisely.
- **Do it after Tier 16** — Tier 16 is an internal layer-boundary move with no user-facing value
  and blocks nothing. This closes a capability gap, and the delegation call paths are loaded now.

---

## Execution notes (2026-08-03)

### A correction to Tier 15B's stated reasoning

Tier 15B argued that five of the six deleted fields "carry no schema key at all, so no prompt
author could ever have set them". **The conclusion holds; that specific argument was too strong.**
All three prompt schemas are `.passthrough()` (`prompt-schema.ts:126, 260, 370`), so an
undeclared `delegation:` or `delegationAgent:` in a YAML file _did_ survive parsing into
`PromptDataYaml`. What was missing was the converter line reading it — `tests/unit/prompts/
delegation-schema.test.ts` had pinned exactly this, asserting those keys arrive and are then
dropped.

So the missing producer sat one layer lower than stated: at the converter, not the schema. The
fields were still unreachable end to end and still undocumented, so deleting them was right —
but "no schema key" was the wrong reason, and this tier's `agentType` is _declared_ rather than
merely tolerated by passthrough, which is a real difference: it gets validation
(`z.string().min(1)`), a type, and a doc row.

### The back-test moved the watch entry

17.6 was first written against `ChainStep` in `shared/types/index.ts`. Back-testing it at HEAD
returned **zero findings** — the watch was on the wrong interface, because the defective
`agentType` lives on `ChainStepPrompt` in `engine/execution/operators/types.ts`. Retargeted, the
back-test flags `agentType` at HEAD exactly as intended.

This is Tier 10's lesson recurring: the self-test proved the detector ran, and only the back-test
proved it measured the intended thing. A watch entry that names a plausible-but-wrong interface
passes every check while enforcing nothing.

### A second finding, baselined not fixed

The corrected watch surfaced **`ChainStepPrompt.inlineGateIds`** — declared at
`operators/types.ts:17`, read once at `chain-operator-executor.ts:937`
(`reviewStep?.inlineGateIds?.forEach(...)`), and written nowhere. A same-named field on
`parsedCommand` (`context-types.ts:41`) _is_ written, by `05-inline-gate-stage`, and a third path
reads it from step metadata at `chain-operator-executor.ts:960`.

That is the Tier 15B shape again — several channels, one producer — and deciding it needs the same
per-reader investigation, which is out of scope for a feature tier. Baselined at 1 known finding
so the ratchet ships enforcing rather than blocking, exactly as Tier 10 did with its eight.
**Filed as the next candidate tier.**

### Scope note

`delegation: true` was **not** reinstated. Blanket prompt-wide delegation was the half without
demand; `==>` expresses per-step delegation explicitly at the call site.

---

## Follow-on: the baselined finding was not a finding (2026-08-03)

Tier 17 filed `ChainStepPrompt.inlineGateIds` as a genuine second finding and baselined it at 1.
**That was wrong, and the correction matters more than the entry.**

The field has a live producer. `InlineGateProcessor.applyGateResult` writes `target.inlineGateIds`
and is called with a real `ChainStepPrompt` (`inline-gate-processor.ts:157`), so every chain step
carrying `:: "criteria"` syntax has been getting its ids populated all along. Three consumers read
them: `chain-operator-executor.ts:936`, `gate-enhancement-service.ts:308`, and
`framework-requirement.ts:44`.

The detector missed it because `applyGateResult`'s parameter was typed by a **structural alias**:

```ts
type InlineGateTarget = { inlineGateIds?: string[] }; // a second declaration
```

Symbol resolution — the fix Tier 10 adopted to kill _false positives_ — resolves
`target.inlineGateIds` to that alias's own declaration, never to `ChainStepPrompt`'s. Tier 10
traded one blind spot for another, and this is the first time the new one surfaced.

**The remedy is at the call site, not in the detector.** `InlineGateTarget` is now
`ChainStepPrompt | ParsedCommand` — the two types its two call sites actually pass. Both spellings
typecheck; only the concrete one keeps the write traceable from the declaration. Widening the
detector to chase structurally-assignable types would reintroduce the exact false positives symbol
resolution exists to prevent, and an allowlist entry would have silenced one instance while leaving
the class live. The blind spot is now documented in the detector's header with the failing code
shape, so the next occurrence is diagnosed rather than rediscovered.

Baseline is `{"known": []}`.

**How I got it wrong**: I read `rg` output showing no `step.inlineGateIds =` assignment and
concluded "no writer" without resolving what `applyGateResult`'s parameter receives — grep-shape
over resolved-receiver, the same shortcut that Tier 15B's `.passthrough()` correction and the
`semantic-capability-framing` lesson both name. A back-test would not have caught this one either:
the field genuinely was unwritten _as far as the detector could see_, at HEAD and after. What
caught it was probing the writer's call sites instead of trusting the absence of a name match.
