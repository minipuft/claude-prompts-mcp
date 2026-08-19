---
title: "Phase-Guard Declaration Contract — single-source the graded section headers"
date: 2026-08-15
status: reference
tags:
  - frameworks
  - gates
  - pipeline
---

# Phase-Guard Declaration Contract

**Area**: `server/src/engine/frameworks/phase-guards/`, `server/src/engine/execution/operators/chain-operator-executor.ts`, `resources/frameworks/*/phases.yaml`
**Work type**: feature (secondary: bug_fix)
**Confidence**: high — the defect reproduced on this plan's own authoring chain
**Origin**: supersession review of the abandoned branch `feat/output-contract-unified-surface` (tip `d11a0c27`, last commit 2026-05-13; deleted 2026-08-15 once its idea was captured here)

---

## The defect, stated once

The phase-guard system grades model output against `section_header` strings declared in
`resources/frameworks/*/phases.yaml`. `section-splitter` finds those headers in the response,
`phase-guard-evaluator` evaluates `guards` against each section, and
`19-phase-guard-verification-stage` blocks advancement when a required section is missing.

**Nothing derives the prompt-time declaration from that same source.** The only built-in shape
declaration, `chain-operator-executor.buildResponseFormatSection`, is hardcoded and emits a
different structure entirely.

The contract _is_ declared — by hand, in five prompt files. So the failure mode is not an absent
instruction but an **underived** one: five copies of strings whose source of truth is
`phases.yaml`, which go stale silently the moment a header changes, while the guard keeps
enforcing the new value.

### Reproduced during authoring

This plan's own `>>implementation_plan` chain was blocked twice — at Discovery and at Design —
with _"Ensure your response includes the required `## Context` / `## Analysis` / `## Goals`
section"_. Those two step prompts declare the headers zero times. The three that pass
(`verification`, `plan_table`, `completion`) each carry a hand-written copy. Same guard, same
framework, same chain; the only difference is whether the prompt happened to restate the contract.

---

## Measured state (re-measured at HEAD, 2026-08-17)

Every row below was re-run at HEAD on 2026-08-17; nothing in the implementation surface has moved
since authoring (only two docs-only commits, `4125d25a` and `06e88dac`, ever touched this plan).
Four rows are corrections to the 2026-08-15 measurement and are marked **↻**.

| Fact                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7 frameworks declare `guards:`                         | `5w1h`, `cageerf`, `focus`, `liquescent`, `radiant`, `react`, `scamper`                                                                                                                                                                                                                                                                                                          |
| **↻** 38 guarded phases, 38 distinct `section_header`s | YAML-parsed across all 7 `phases.yaml`; 35 carry `guards.required: true`, 3 do not (`cageerf` Evaluation + Refinement, `radiant` Navigate)                                                                                                                                                                                                                                       |
| **↻** 0 guarded phases lack a `section_header`         | 38/38 declare one — OQ-2's case is currently unreachable                                                                                                                                                                                                                                                                                                                         |
| CAGEERF's first four phases are required               | `cageerf/phases.yaml` lines 12/14, 24/26, 36/38, 48/50; Evaluation and Refinement are `required: false`                                                                                                                                                                                                                                                                          |
| Enforcement is on by default                           | `server/config.json` → `phaseGuards: { mode: "enforce", maxRetries: 2 }`                                                                                                                                                                                                                                                                                                         |
| Stage fallback is also enforce                         | `19-phase-guard-verification-stage.ts:67`                                                                                                                                                                                                                                                                                                                                        |
| Only `guards.required` can block                       | `phase-guard-evaluator.ts:85-105` — section absent and not required → remaining checks skipped, no failure                                                                                                                                                                                                                                                                       |
| Header literals absent from framework guidance         | `rg` for `## Context` outside `phases.yaml` → 0 files in framework guidance                                                                                                                                                                                                                                                                                                      |
| Prompt-time builder is hardcoded                       | `chain-operator-executor.ts:931`, sole call site `:493`                                                                                                                                                                                                                                                                                                                          |
| Shared lookup exists but is private                    | `19-phase-guard-verification-stage.ts:228` `getPhasesWithGuards`, sole caller `:88`                                                                                                                                                                                                                                                                                              |
| **↻** Contract hand-declared in 5 prompt files         | `implementation_plan/{system-message,verification,plan_table,completion}`, `examples/create_framework`. 9 files match `## Context`; the other 4 (`development/{tech_recommendation,library_overview,integration_assessment,technical_deep_dive}`) use it as an ordinary heading, not a declaration — the Tier 4 gate must distinguish the two shapes or it fires false positives |
| **↻** A hand-written copy has ALREADY drifted          | `verification/user-message.md:20` states `## Execution` min_length **80**; `cageerf/phases.yaml:51` declares **100**. Header strings still agree — this is a _value_ drift, which a header-only gate does not catch                                                                                                                                                              |
| Matching is tolerant, but whole-line                   | `section-splitter.ts:89-95` normalizes `#`, `*`, trailing punctuation, case                                                                                                                                                                                                                                                                                                      |

**Why the tolerant matcher did not fix this.** `section-splitter.ts:44-45` records that an earlier
exact-match implementation "missed every such variant, which (paired with a retry hint naming the
wrong header) produced an unsatisfiable loop." The repair widened what the validator accepts. The
declaration side was never touched, because it lives in prompt files rather than in one place.

---

## Design decision — what shape the fix takes

The abandoned branch proposed rendering a "Required Output Structure" skeleton into every chain
step. That part is rejected. A frontier model does not need a fill-in template to produce a
section; it needs the header **vocabulary** and the knowledge that the vocabulary is load-bearing.

The load-bearing invariant is narrower and mechanically checkable:

> A guard may only block on a header the prompt actually declared.

| Decision                   | Chosen                                                      | Rejected                                       | Why                                                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Injection shape            | Declared header vocabulary, one line per guarded phase      | Rendered skeleton with placeholder content     | Skeleton costs tokens on every step to restate structure the model already produces                                                                                                                       |
| Where it renders           | Derive the existing `buildResponseFormatSection`            | Add a second "Required Output Structure" block | `cleanup-standards`: no parallel systems; one block already owns "what shape to emit"                                                                                                                     |
| Which execution paths      | Both — chain assembly AND single-prompt assembly            | Chain only                                     | **Revised by the OQ-1 ruling.** A gated single prompt gets a session (`execution-planner.ts:427-450`) and is graded by stage 19, so chain-only would leave the identical defect standing in a second path |
| Undeclared headers         | Advisory, never blocking                                    | Keep enforcing                                 | A guard the model was never told about is unsatisfiable; blocking on it is the bug                                                                                                                        |
| Lookup ownership           | Extract the private stage method into the frameworks module | A second lookup for prompt assembly            | Two lookups recreate the same drift one layer down                                                                                                                                                        |
| Caching                    | None — read through `FrameworkManager` per call             | Cache at construction                          | Framework hot-reload must keep working                                                                                                                                                                    |
| Hand-written prompt copies | Keep, and gate for drift                                    | Generate them                                  | The tables carry per-header pedagogy generation would lose; prompt edits must flow through MCP `resource_manager`                                                                                         |
| MCP structured output      | Not used                                                    | Expose the contract via tool result schema     | That schema describes what the **tool returns**; the graded artifact is the model's free text in `user_response`. Viable only if `user_response` becomes structured — a separate, larger decision         |

### Interfaces

```ts
// server/src/engine/frameworks/declared-sections.ts (new, pure)
export interface DeclaredSection {
  header: string; // verbatim phases.yaml section_header, e.g. '## Context'
  required: boolean; // from guards.required
  phaseId: string; // for diagnostics and retry hints
}

export function resolveDeclaredSections(
  frameworkManager: FrameworkManager,
  frameworkId: string,
): DeclaredSection[];
```

Consumers: `chain-operator-executor.buildResponseFormatSection` (chain declaration),
`response-assembler.formatSinglePromptResponse` (single-prompt declaration, added by the OQ-1
ruling) and `19-phase-guard-verification-stage` (evaluation). One source, three sinks — and every
path that _grades_ now has a matching path that _declares_, which is the invariant.

---

## Pre-flight

| Check                               | Result                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| domain                              | pass — frameworks module owns `section_header`/`guards`                                                         |
| layer                               | pass — resolver in `engine/frameworks`; stage stays orchestration                                               |
| naming                              | pass — `resolveDeclaredSections` after rejecting the branch's vague `OutputContractResolver`                    |
| complexity                          | pass — pure lookup and join                                                                                     |
| size                                | pass                                                                                                            |
| service                             | **FAIL** — `getPhasesWithGuards` already performs the phase-fetch half                                          |
| defined                             | **FAIL** — defined privately inside an orchestration stage, invisible to `rg`, unreachable by a second consumer |
| contracts                           | pass — `ProcessingStep.section_header` (`framework-types.ts:196`), `guards` (`:198`)                            |
| pattern                             | pass — OOP shell, pure internals                                                                                |
| reuse-scope                         | pass — two consumers by construction                                                                            |
| persistence / lib-api / lib-version | n/a                                                                                                             |

**Failures: 2 → compound: Missed extension point / capability reimplemented.** Extract first,
repoint the stage, and only then add the second consumer.

---

## Tiers

### Tier 1 — Extract the shared lookup (behavior-neutral)

| #   | St  | File                                                      | Change                                                                                                    | ~Lines | Depends | Verify                                                                               | Justification                                                   |
| --- | --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -----: | ------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 1.1 | ✓   | `engine/frameworks/declared-sections.ts` **new**          | Add `resolveDeclaredSections()` returning `{header, required, phaseId}` per guarded phase; pure, no cache |     45 | —       | Unit: 4 guarded phases → 4 entries with verbatim headers; unguarded framework → `[]` | Two consumers need it; a private stage method cannot serve both |
| 1.2 | ✓   | `stages/19-phase-guard-verification-stage.ts:228`         | Delete private `getPhasesWithGuards`; call the resolver at `:88`                                          |     12 | 1.1     | Existing phase-guard tests pass unchanged; `rg "getPhasesWithGuards"` → 0            | Stage is thin orchestration                                     |
| 1.3 | ✓   | `tests/unit/frameworks/declared-sections.test.ts` **new** | Guarded/unguarded, missing `section_header`, `required` propagation                                       |     70 | 1.1     | `npm run test:ci` green                                                              | Existing suites test evaluation, not lookup                     |

**Tier 1 gate**: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci` (the project minimum — the two ratchets are NOT optional; see DEV-T1-3). Zero prompt-text diff expected — any prompt
change means the tier was not behavior-neutral and must be reverted before Tier 2.

### Tier 2 — Derive the prompt-time declaration

| #   | St  | File                                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ~Lines | Depends  | Verify                                                                                                          | Justification                                                                                                                                                                                                            |
| --- | --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | -------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1 | ✓   | `chain-operator-executor.ts:931`       | `buildResponseFormatSection` takes `DeclaredSection[]` and renders the header vocabulary, `required` marked; keep existing Summary / Gate Coverage lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |     35 | 1.1      | Rendered step prompt contains every header `phases.yaml` declares for the active framework                      | Consolidates rather than adding a parallel block                                                                                                                                                                         |
| 2.2 | ✓   | `chain-operator-executor.ts:493`       | Pass resolved sections at the call site                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |      6 | 2.1      | Typecheck; `rg` confirms 493 and 931 are the only sites                                                         | Explicit parameter over reaching into a service from a formatter                                                                                                                                                         |
| 2.3 | ✓   | chain operator unit suite              | Assert emitted prompt contains declared headers; mutating a fixture `section_header` changes the prompt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |     60 | 2.1      | Back-test: change fixture header → assertion fails on the old value                                             | A snapshot would freeze the bug — landed as `expect(() => expect(result.content).toContain('## Goals')).toThrow()` against a mutated CAGEERF fixture in `tests/unit/execution/operators/chain-operator-executor.test.ts` |
| 2.4 | ✓   | implementation notes                   | Record measured added tokens per step for a 4-guarded-phase framework                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |      0 | 2.1      | Measured, not estimated                                                                                         | Measured 53 tokens (55 incl. join separator) with `@anthropic-ai/tokenizer` for CAGEERF's 4 required headers — see DEV-T2-4                                                                                              |
| 2.5 | ✓   | `formatting/response-assembler.ts:118` | **OQ-1**: `formatSinglePromptResponse` pushes the same declared-header block when the framework has guards. Injected as `declaredSectionsProvider?: (frameworkId: string) => DeclaredSection[]` on the constructor (matching the shape DEV-T2-1 already landed for the chain path, not the plan's originally-stated zero-arg signature) — NOT a registry or config object: `:45-53` documents the narrow function-type seam as the established convention. Gates on session presence, resolves `.id`, never branches on `isChainExecution()` (F2). Wired at `pipeline-builder.ts`'s `ResponseAssembler` construction site |     30 | 1.1, 2.1 | Gated single prompt (`gates` parameter set) renders the declared headers; ungated single prompt renders nothing | A gated single prompt reaches stage 19 and is graded on headers it was never given — landed in `tests/unit/execution/formatting/response-assembler-declared-sections.test.ts`                                            |
| 2.6 | ✓   | response-assembler unit suite          | Gated single prompt declares; ungated does not; guardless framework does not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |     45 | 2.5      | Three branches asserted                                                                                         | The skip conditions are where an over-broad injection would cost tokens — 5 tests landed in `response-assembler-declared-sections.test.ts` (the three named branches plus no-framework and no-provider)                  |

**Tier 2 gate**: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci`; drive one CAGEERF chain step and confirm the
prompt carries `## Context`, `## Analysis`, `## Goals`, `## Execution`. Then drive one **gated single
prompt** under CAGEERF and confirm the same — that path is why OQ-1 was reopened.

### Tier 2b — Criterion registry (added 2026-08-17 by ruling; landed before Tier 3)

Ruled during execution: the declaration must be extensible, because which criteria exist and which
are worth declaring both change over time. Only `section_header` is structurally fixed — it is the
ADDRESSING key, not a criterion, and a section the splitter cannot find short-circuits every
criterion under it. Everything else belongs in a registry that owns evaluation and declarability
together. Landed before Tier 3 because it restructures the evaluator Tier 3.1 modifies.

| #    | St  | File                                                         | Change                                                                                                                                                                             | ~Lines | Depends | Verify                                                                        | Justification                                                                            |
| ---- | --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | ------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 2b.1 | ✓   | `phase-guards/criteria.ts` **new**                           | `GUARD_CRITERIA` registry: one entry per content criterion, owning both `evaluate` and (for positives) `declare`. `required` deliberately excluded — it is addressing, not content |    210 | 1.1     | Evaluation order preserved; `declareCriteria()` returns the declarable subset | Adding a criterion becomes one entry, not an evaluator edit plus a renderer edit         |
| 2b.2 | ✓   | `phase-guards/phase-guard-evaluator.ts`                      | Replace the six hardcoded criterion branches with a loop over `GUARD_CRITERIA`; the evaluator now knows no criterion by name. 266 → 172 lines                                      |    -94 | 2b.1    | 113 pre-existing phase-guard/chain-operator tests pass unchanged              | Behavior-neutral by construction; the registry carries the same checks in the same order |
| 2b.3 | ✓   | `frameworks/declared-sections.ts`                            | `DeclaredSection` gains `criteria: string[]`, populated by `declareCriteria(step.guards)`                                                                                          |     10 | 2b.1    | CAGEERF-shaped guards yield `[]`; radiant-shaped yield the keyword line       | One source still feeds both sinks                                                        |
| 2b.4 | ✓   | `operators/chain-operator-executor.ts`                       | Render criteria after the header: ``- `## Draw the Palette` (required; mentions one of "OKLCH", …)``                                                                               |      6 | 2b.3    | Rendered prompt carries the declarable criteria and nothing else              | The unguessable half of the contract reaches the model                                   |
| 2b.5 | ✓   | `tests/unit/frameworks/phase-guard-criteria.test.ts` **new** | Registry membership, per-criterion evaluation parity, and the declarability split — including that NO negative criterion ever declares                                             |    130 | 2b.1    | 12 tests green                                                                | The negative-criterion invariant is security-relevant and must be asserted, not assumed  |

**Tier 2b gate**: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci` — 197 suites / 2601 passed / 1 skipped on 2026-08-17.

**Declarability split as landed** — the rule is _declare what blocks and cannot be inferred_:

| criterion         | polarity | declared? | why                                                                            |
| ----------------- | -------- | --------- | ------------------------------------------------------------------------------ |
| `contains_any`    | positive | yes       | unguessable keyword list; discovering it costs one of only two retries         |
| `contains_all`    | positive | yes       | same                                                                           |
| `max_length`      | positive | yes       | an unstated ceiling is invisible until breached, and cannot be fixed in-turn   |
| `min_length`      | positive | no        | retry feedback names the exact threshold; "write substantively" is the default |
| `forbidden_terms` | negative | **never** | declaring what is rejected hands over the evasion target                       |
| `matches_pattern` | negative | **never** | same, and this is the natural home for a future sensitive-data check           |

Negative criteria carry `declare?: never` in the type, so a negative that tries to declare itself is
a compile error rather than a review comment.

### Tier 3 — A guard may not block on an undeclared header

| #   | St  | File                                                               | Change                                                                                                                                                                                                                                                                                                                                                             | ~Lines | Depends  | Verify                                                                                         | Justification                                                                                                                                                                      |
| --- | --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -----: | -------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | ✓   | `phase-guard-evaluator.ts:96`                                      | Third case beside required/optional: header absent from the declared set → advisory, never blocking                                                                                                                                                                                                                                                                |     30 | 1.1, 2.1 | Back-test: remove a fixture `section_header` → warns, no `PendingGateReview`                   | Blocking on an undeclared header is the defect (as of 2026-08-17 · flips when the Tier 3.1 observability ruling lands and a fixture with no declaration warns instead of blocking) |
| 3.2 | ✓   | phase-guard unit suite                                             | Declared → blocks on absence; undeclared → advisory                                                                                                                                                                                                                                                                                                                |     50 | 3.1      | Both directions asserted                                                                       | The dangerous regression is losing enforcement for declared headers (as of 2026-08-17 · flips when both directions are asserted, after 3.1)                                        |
| 3.3 | ✓   | `definitions/runtime-framework-loader.ts:281-322,528-542`          | **OQ-2**: call the existing phase-coherence validator (`validatePhasesSchema`, not `validatePhasesFile` — DEV-T3-4) on the inlined YAML; refuse the framework on `errors`, log `warnings`. No new check written — `framework-schema.ts:251-255` already errors on guards-without-`section_header` (F1)                                                             |     35 | —        | Seeded framework with `guards` and no `section_header` is refused at load, naming the phase id | The unsatisfiable-guard family, same as 3.1; the check existed and had never run — now wired and confirmed refusing (DEV-T3-4/DEV-T3-5)                                            |
| 3.4 | ✓   | `tests/unit/frameworks/definitions/yaml-framework-loading.test.ts` | Wiring 3.3 activates the other dormant checks too — measured before wiring that no bundled framework triggers duplicate `order` or `min_length > max_length` (no bundled framework sets `max_length` at all) or the header-without-guards warning; asserted after wiring that every discovered bundled framework (7 named + `verify`) still loads with zero errors |     40 | 3.3      | All 7 bundled frameworks still load clean                                                      | Waking a dead validator can reject resources that shipped green — confirmed it does not (DEV-T3-5)                                                                                 |

**Tier 3 gate**: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci`; confirm a declared-and-missing section still blocks, and that all
7 bundled frameworks load with zero errors once the validator is live.

### Tier 4 — Make the hand-written copies detectable

| #    | St  | File                                                                                                                                                                              | Change                                                                                                                                                                                                                                                                                                                                                                                                               | ~Lines | Depends | Verify                                                                                                                                              | Justification                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.0  | ✓   | `implementation_plan/verification/user-message.md`                                                                                                                                | **OQ-3**: delete the `Min length` and `Enforced by` columns, and the inline char-count claim, from the one declaration table that actually restated a guard value. This resolves F3 by deletion. Edited via MCP `resource_manager` — manual writes under `server/resources/prompts/**` are forbidden (CLAUDE.md Core Principle 1)                                                                                    |     10 | —       | `rg "Min length" <file>` → 0 and `rg "Enforced by" <file>` → 0 on the file above; the 80-vs-100 drift no longer exists to be wrong                  | A restated number is the part that rots; the prose is the part generation could not reproduce                                                                                                                                                                                                                                                                                                        |
| 4.0b | ⊘   | remaining 4 of the "5 declaration copies": `implementation_plan/{system-message,plan_table/user-message,completion/user-message}.md`, `examples/create_framework/user-message.md` | Investigated for the same restated-value pattern as 4.0 — none found. The first 3 restate only the header VOCABULARY (backtick-inline), never a numeric guard value; `create_framework` names `min_length` 5x, but every occurrence documents that tool's own Zod schema field for framework AUTHORS, not a value this prompt is graded against — stripping it would misdocument a real API key for no drift benefit |      0 | —       | `rg "Min length" <file>` → 0 and `rg "Enforced by" <file>` → 0 across all 4; `create_framework`'s `min_length` mentions left untouched deliberately | Task 4.0 named 5 files as one deliverable; only 1 needed an edit. Recording the other 4 as verified-not-touched is what lets a later reader tell which files changed and which were checked and correctly left alone (verified 2026-08-17 · grep run before editing found no Min length/Enforced by table or char-count value in any of the four — see DEV-T4-1 in the sibling implementation notes) |
| 4.1  | ✓   | `server/scripts/validate-phase-header-drift.js` **new**                                                                                                                           | Fail when a file under `resources/prompts/**` restates a `section_header` no `phases.yaml` declares; include `--self-test`. Must distinguish a _declaration_ (a header named inside a phase-guard table or contract paragraph) from an _ordinary heading_ — 4 development prompts use `## Context` as a plain heading and must not fire                                                                              |    110 | 4.0     | Self-test plus a seeded stale header exits 1; the 4 development prompts stay green                                                                  | The copies carry pedagogy worth keeping; drift is what a gate detects                                                                                                                                                                                                                                                                                                                                |
| 4.2  | ✓   | `server/package.json`                                                                                                                                                             | Register `validate:phase-header-drift` + self-test in `validate:all`                                                                                                                                                                                                                                                                                                                                                 |      4 | 4.1     | `validate:all` runs 39 steps and passes                                                                                                             | A gate CI does not run is not a gate                                                                                                                                                                                                                                                                                                                                                                 |

**Tier 4 gate**: `npm run validate:all` green; seeded stale header reproduces exit 1; the 4
ordinary-heading prompts produce no finding.

**Tier 4 execution record (2026-08-17)**: 4.0 edited only `implementation_plan/verification` via
`resource_manager` `patch` (version 6) — the other 4 files in the "5 declaration copies" list had
no `Min length`/`Enforced by`/char-count content to strip (verified by grep before editing; see
implementation-notes DEV-T4-1). 4.1 shipped with a corroboration rule beyond the plan's original
two-shape split (backtick/YAML vs. bare) — a bare fenced heading now also requires the same header
to appear unambiguously (backtick/YAML) elsewhere in the same file, because dozens of unrelated
prompts fence their own bare example headings with no framework behind them (see DEV-T4-2). 4.2
registered in `package.json` and `run-validation-suite.js` SUITE; `validate:suite-membership`
confirms wiring. `rg "Min length|min_length" server/resources/prompts/` still matches
`examples/create_gate/user-message.md` and `examples/create_framework/user-message.md` — legitimate
gate/framework-authoring schema documentation, not phase-guard declarations; see DEV-T4-1 for why
those were left alone rather than forced to zero.

### Tier 5 — Documentation and changelog

| #   | St  | File                                                  | Change                                                                                                                                                                                                                                                                                                                    | ~Lines | Depends | Verify                         | Justification                                         |
| --- | --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | ------- | ------------------------------ | ----------------------------------------------------- |
| 5.1 | ✓   | `docs/guides/gates.md`, `docs/guides/phase-guards.md` | **DEV-T5-1**: substantive mechanism (declared-sections.ts, criteria declarability table, advisory posture, per-node persistence) documented in `phase-guards.md` — the dedicated guide for this exact subsystem; `gates.md` carries a short pointer plus its own two stale "Stage 09b" references corrected to "Stage 19" |     25 | 3.1     | Doc describes shipped behavior | Docs/code lockstep — closed 2026-08-17                |
| 5.2 | ✓   | `CHANGELOG.md`                                        | **DEV-T5-2**: split across `Added` (new declared-header capability, criteria declarability split, load-time refusal, drift gate) and `Fixed` (undeclared headers can no longer block) rather than the single `Fixed` entry the plan's Release section proposed                                                            |      6 | 1–4     | Entry present                  | Changelog updates with the change — closed 2026-08-17 |

**Tier 5 gate**: `npm run validate:all` + `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci`, plus a live drive — run a real `>>implementation_plan`
chain end to end and confirm no step is blocked for a header it was never given.

---

## New file justifications

| New file                                          | Why not an existing file                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/frameworks/declared-sections.ts`          | Two consumers in different layers. Adding it to either recreates the private-method invisibility that caused this defect; it cannot live in the stage, which must stay thin |
| `scripts/validate-phase-header-drift.js`          | No existing validator reads prompt markdown against framework YAML. `validate:no-methodology-vocab` scans vocabulary, not cross-file agreement                              |
| `tests/unit/frameworks/declared-sections.test.ts` | Existing phase-guard suites test evaluation; the lookup is a separate unit                                                                                                  |

## Execution dispatch

| Work                                                                                 | Agent                         | Why                                                                      |
| ------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------ |
| Tier 1                                                                               | Bounded mechanical executor   | Behavior-neutral move with an existing suite as oracle                   |
| Tier 2                                                                               | Main thread                   | Changes what every chain step emits; token cost and wording are judgment |
| Tier 3                                                                               | Main thread                   | Alters enforcement against a shipped `enforce` mode                      |
| Tier 4                                                                               | Bounded executor              | Self-testing script with a clear contract                                |
| Tier 5                                                                               | Bounded executor              | Mechanical once behavior is settled                                      |
| Gate verdicts, tier acceptance, open-question rulings, final live drive, scope check | Main thread — never delegated | Acceptance is not mechanical                                             |

## Open questions — all RULED 2026-08-17

| id   | status | must precede | decision                                                                                             | ruling                                                                                                                                                                                                                                   |
| ---- | ------ | ------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | RULED  | Tier 2       | Does single-prompt (non-chain) execution reach stage 19?                                             | **Yes — the chain-only default was wrong. Add the second injection point** (2.5/2.6). `execution-planner.ts:427-450` sets `requiresSession` for explicit `gates`, a `gate` operator, or `chainSteps`, so a gated single prompt is graded |
| OQ-2 | RULED  | Tier 3       | Does any framework declare `guards` on a phase with no `section_header` (guarded but unaddressable)? | **Fail at framework load.** 0/38 today, and the check already exists as an ERROR at `framework-schema.ts:251-255` — it is simply never called (F1). Wire it in rather than writing it (3.3/3.4)                                          |
| OQ-3 | RULED  | Tier 4       | Replace the five hand-written prompt tables with derived text, or keep and gate?                     | **Strip the numbers, gate headers only.** Keep the prose pedagogy; delete the `Min length` / `Enforced by` columns that restate guard values, removing the class of drift F3 instead of detecting it (4.0)                               |

## Findings

| id  | finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | binds    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| F1  | **`validatePhasesSchema` has no production caller.** (Corrected 2026-08-17: this row originally named it `validatePhasesFile`, a symbol that exists nowhere in the repo, and said "zero callers" when it had test callers but no production one — see DEV-T3-4.) Exported from `framework-schema.ts:221`, absent from the barrel, and `rg` across `src/`, `tests/`, `tooling/`, `scripts/` finds no call site. `runtime-framework-loader.ts:446-462` inlines `phases.yaml` raw. Every coherence check it performs — including the guards-without-`section_header` error OQ-2 asked for — is dead code | Tier 3.3 |
| F2  | **`isChainExecution` is true for gated single prompts.** `13-session-stage.ts:112,150` sets it unconditionally, so `context.isChainExecution()` returns true and `prompt-execution-pipeline.ts:489` reports `cpm.execution.mode: chain` for a single prompt. The reliable discriminator is `executionPlan.strategy`. Out of scope to fix here; do NOT use `isChainExecution()` to branch in Tier 2                                                                                                                                                                                                    | Tier 2.5 |
| F3  | **A hand-written copy has already drifted.** `verification/user-message.md:20` says `## Execution` needs 80 chars; `cageerf/phases.yaml:51` declares 100. Header strings still agree, so the originally-planned header-only gate would not have caught it                                                                                                                                                                                                                                                                                                                                             | Tier 4.0 |

---

## Testing strategy

| What to test                                                   | Type                 | Location                                          | Why this type                                             |
| -------------------------------------------------------------- | -------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| Lookup returns declared headers per framework                  | Unit                 | `tests/unit/frameworks/declared-sections.test.ts` | Pure function, exhaustive branches cheaply                |
| Stage behavior unchanged after extraction                      | Regression           | existing phase-guard suites                       | Tier 1 must be behavior-neutral                           |
| Emitted prompt contains declared headers                       | Integration          | chain operator suite                              | Prompt assembly crosses framework + operator              |
| Mutating `section_header` changes both prompt and guard target | Back-test            | fixture mutation                                  | The single-file proof that one source feeds both sides    |
| Declared-and-missing still blocks                              | Unit                 | phase-guard suite                                 | Guards against losing enforcement                         |
| Undeclared header is advisory                                  | Unit                 | phase-guard suite                                 | The new behavior                                          |
| Gated single prompt declares its headers                       | Unit                 | response-assembler suite                          | The path OQ-1 uncovered; fixtures reach it, chains do not |
| Guards without `section_header` refused at load                | Unit                 | loader suite                                      | Wakes a validator that has never run                      |
| 7 bundled frameworks still load clean                          | Regression           | loader suite                                      | Waking a dead validator can reject shipped resources      |
| Stale prompt copy is detected                                  | Contract + self-test | `validate-phase-header-drift.js`                  | Cross-file agreement is not a type error                  |
| Ordinary `## Context` headings do not fire the gate            | Contract             | `validate-phase-header-drift.js`                  | 4 development prompts use it as a plain heading           |
| Real chain completes unblocked                                 | Live drive           | `>>implementation_plan` end to end                | Fixtures cannot prove the harness experience              |

## Done criteria

| Criterion                              | Validation                 | Pass condition                                                             |
| -------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| One source                             | Code review + back-test    | No `section_header` literal outside `phases.yaml` and the derived renderer |
| Instruction reaches the model          | Live prompt inspection     | A CAGEERF step prompt lists the four required headers                      |
| Every grading path declares            | Live prompt inspection     | A gated single prompt under CAGEERF lists them too                         |
| No unsatisfiable guard can be authored | Seeded framework           | `guards` with no `section_header` is refused at load, naming the phase     |
| Undeclared cannot block                | Fixture removal            | Guard warns, advancement continues                                         |
| Enforcement preserved                  | Fixture omission           | Declared-and-missing still blocks                                          |
| Drift detectable                       | Seeded stale header        | `validate:phase-header-drift` exits 1                                      |
| Suite green                            | `validate:all` + `test:ci` | 39 steps, 2480+ tests                                                      |
| Token cost justified                   | Measured delta in notes    | Recorded number, not an estimate                                           |

## Documentation

| Doc                                      | Update                                        |
| ---------------------------------------- | --------------------------------------------- |
| `docs/guides/gates.md`                   | Declared-header contract and advisory posture |
| `CHANGELOG.md`                           | Unreleased `Fixed` entry                      |
| This plan + sibling implementation notes | Tier status, rulings, deviations              |

## Risks

| Risk                                                      | Impact | Mitigation                                                                                                              | Rollback                                            |
| --------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Enforcement changes on a shipped `enforce` mode           | High   | The change can only make blocking rarer, never more frequent                                                            | Revert Tier 3; Tiers 1-2 stand alone                |
| Added prompt tokens on every step                         | Medium | Header vocabulary only; scoped to guarded frameworks; skipped when mode is `off`; measured in 2.4                       | Revert Tier 2                                       |
| Added tokens on gated single prompts (2.5)                | Medium | Three skip conditions asserted in 2.6: ungated single prompts, guardless frameworks, and `mode: off` all render nothing | Revert 2.5/2.6; Tier 2 chain half stands alone      |
| Waking `validatePhasesSchema` refuses a shipped framework | Medium | 3.4 asserts all 7 bundled frameworks load clean before the refusal path is enabled                                      | Downgrade 3.3 to log-only, keep the wiring          |
| Extraction changes stage behavior                         | Medium | Tier 1 gate requires zero prompt diff                                                                                   | Revert 1.2, keep the module unused                  |
| Drift gate produces false positives on pedagogy tables    | Low    | Gate compares header strings only, not surrounding prose                                                                | Narrow the matcher or exempt with a declared reason |
| Hot-reload breaks from caching                            | Medium | Resolver reads through `FrameworkManager` per call, no cache                                                            | n/a — no cache introduced                           |

## Release

- **Commit convention**: `fix(frameworks): declare phase-guard section headers from phases.yaml`
- **Scope**: `frameworks`
- **Changelog section**: Fixed

## Growth capture

- [ ] Capture the pattern: _a check and the instruction it grades must read one source; when they
      cannot, the check must not block on what the instruction omitted._
- [ ] Record that this defect reproduced on the authoring chain itself — the strongest available
      evidence, and a reusable technique for validating instruction/validator pairs.
- [ ] Consider whether other gate families (inline gates, framework compliance) declare criteria the
      model never receives.
