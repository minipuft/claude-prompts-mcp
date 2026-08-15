---
title: "Phase-Guard Declaration Contract — single-source the graded section headers"
date: 2026-08-15
status: backlog
tags:
  - frameworks
  - gates
  - pipeline
---

# Phase-Guard Declaration Contract

**Area**: `server/src/engine/frameworks/phase-guards/`, `server/src/engine/execution/operators/chain-operator-executor.ts`, `resources/frameworks/*/phases.yaml`
**Work type**: feature (secondary: bug_fix)
**Confidence**: high — the defect reproduced on this plan's own authoring chain
**Origin**: supersession review of the abandoned branch `feat/output-contract-unified-surface` (tip `f6da0841`… no — branch tip was 2026-05-13; deleted 2026-08-15 after its idea was captured here)

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

## Measured state (origin/main, 2026-08-15)

| Fact                                           | Evidence                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 7 frameworks declare `guards:`                 | `5w1h`, `cageerf`, `focus`, `liquescent`, `radiant`, `react`, `scamper`                                |
| 12+ `section_header` values declared           | `## Context`, `## Analysis`, `## Action`, `## Crystallize`, `## Dissolve`, …                           |
| CAGEERF's first four phases are required       | `cageerf/phases.yaml` lines 12/14, 24/26, 36/38, 48/50                                                 |
| Enforcement is on by default                   | `server/config.json` → `phaseGuards: { mode: "enforce", maxRetries: 2 }`                               |
| Stage fallback is also enforce                 | `19-phase-guard-verification-stage.ts:67`                                                              |
| Header literals absent from framework guidance | `rg` for `## Context` outside `phases.yaml` → 0 files                                                  |
| Prompt-time builder is hardcoded               | `chain-operator-executor.ts:931`                                                                       |
| Shared lookup exists but is private            | `19-phase-guard-verification-stage.ts:228` `getPhasesWithGuards`                                       |
| Contract hand-declared in 5 prompt files       | `implementation_plan/{system-message,verification,plan_table,completion}`, `examples/create_framework` |
| Matching is tolerant, but whole-line           | `section-splitter.ts:89-95` normalizes `#`, `*`, trailing punctuation, case                            |

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

| Decision                   | Chosen                                                      | Rejected                                       | Why                                                                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Injection shape            | Declared header vocabulary, one line per guarded phase      | Rendered skeleton with placeholder content     | Skeleton costs tokens on every step to restate structure the model already produces                                                                                                               |
| Where it renders           | Derive the existing `buildResponseFormatSection`            | Add a second "Required Output Structure" block | `cleanup-standards`: no parallel systems; one block already owns "what shape to emit"                                                                                                             |
| Undeclared headers         | Advisory, never blocking                                    | Keep enforcing                                 | A guard the model was never told about is unsatisfiable; blocking on it is the bug                                                                                                                |
| Lookup ownership           | Extract the private stage method into the frameworks module | A second lookup for prompt assembly            | Two lookups recreate the same drift one layer down                                                                                                                                                |
| Caching                    | None — read through `FrameworkManager` per call             | Cache at construction                          | Framework hot-reload must keep working                                                                                                                                                            |
| Hand-written prompt copies | Keep, and gate for drift                                    | Generate them                                  | The tables carry per-header pedagogy generation would lose; prompt edits must flow through MCP `resource_manager`                                                                                 |
| MCP structured output      | Not used                                                    | Expose the contract via tool result schema     | That schema describes what the **tool returns**; the graded artifact is the model's free text in `user_response`. Viable only if `user_response` becomes structured — a separate, larger decision |

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

Consumers: `chain-operator-executor.buildResponseFormatSection` (declaration) and
`19-phase-guard-verification-stage` (evaluation). One source, two sinks, and the sinks become
comparable.

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
| 1.1 | ☐   | `engine/frameworks/declared-sections.ts` **new**          | Add `resolveDeclaredSections()` returning `{header, required, phaseId}` per guarded phase; pure, no cache |     45 | —       | Unit: 4 guarded phases → 4 entries with verbatim headers; unguarded framework → `[]` | Two consumers need it; a private stage method cannot serve both |
| 1.2 | ☐   | `stages/19-phase-guard-verification-stage.ts:228`         | Delete private `getPhasesWithGuards`; call the resolver at `:88`                                          |     12 | 1.1     | Existing phase-guard tests pass unchanged; `rg "getPhasesWithGuards"` → 0            | Stage is thin orchestration                                     |
| 1.3 | ☐   | `tests/unit/frameworks/declared-sections.test.ts` **new** | Guarded/unguarded, missing `section_header`, `required` propagation                                       |     70 | 1.1     | `npm run test:ci` green                                                              | Existing suites test evaluation, not lookup                     |

**Tier 1 gate**: `npm run typecheck && npm run test:ci`. Zero prompt-text diff expected — any prompt
change means the tier was not behavior-neutral and must be reverted before Tier 2.

### Tier 2 — Derive the prompt-time declaration

| #   | St  | File                             | Change                                                                                                                                                   | ~Lines | Depends | Verify                                                                                     | Justification                                                    |
| --- | --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | ------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 2.1 | ☐   | `chain-operator-executor.ts:931` | `buildResponseFormatSection` takes `DeclaredSection[]` and renders the header vocabulary, `required` marked; keep existing Summary / Gate Coverage lines |     35 | 1.1     | Rendered step prompt contains every header `phases.yaml` declares for the active framework | Consolidates rather than adding a parallel block                 |
| 2.2 | ☐   | `chain-operator-executor.ts:493` | Pass resolved sections at the call site                                                                                                                  |      6 | 2.1     | Typecheck; `rg` confirms 493 and 931 are the only sites                                    | Explicit parameter over reaching into a service from a formatter |
| 2.3 | ☐   | chain operator unit suite        | Assert emitted prompt contains declared headers; mutating a fixture `section_header` changes the prompt                                                  |     60 | 2.1     | Back-test: change fixture header → assertion fails on the old value                        | A snapshot would freeze the bug                                  |
| 2.4 | ☐   | implementation notes             | Record measured added tokens per step for a 4-guarded-phase framework                                                                                    |      0 | 2.1     | Measured, not estimated                                                                    | Added tokens must be justified against drift prevented           |

**Tier 2 gate**: `npm run typecheck && npm run test:ci`; drive one CAGEERF chain step and confirm the
prompt carries `## Context`, `## Analysis`, `## Goals`, `## Execution`.

### Tier 3 — A guard may not block on an undeclared header

| #   | St  | File                          | Change                                                                                              | ~Lines | Depends  | Verify                                                                       | Justification                                                       |
| --- | --- | ----------------------------- | --------------------------------------------------------------------------------------------------- | -----: | -------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 3.1 | ☐   | `phase-guard-evaluator.ts:96` | Third case beside required/optional: header absent from the declared set → advisory, never blocking |     30 | 1.1, 2.1 | Back-test: remove a fixture `section_header` → warns, no `PendingGateReview` | Blocking on an undeclared header is the defect                      |
| 3.2 | ☐   | phase-guard unit suite        | Declared → blocks on absence; undeclared → advisory                                                 |     50 | 3.1      | Both directions asserted                                                     | The dangerous regression is losing enforcement for declared headers |

**Tier 3 gate**: `npm run test:ci`; confirm a declared-and-missing section still blocks.

### Tier 4 — Make the hand-written copies detectable

| #   | St  | File                                                    | Change                                                                                                                     | ~Lines | Depends | Verify                                       | Justification                                                         |
| --- | --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -----: | ------- | -------------------------------------------- | --------------------------------------------------------------------- |
| 4.1 | ☐   | `server/scripts/validate-phase-header-drift.js` **new** | Fail when a file under `resources/prompts/**` restates a `section_header` no `phases.yaml` declares; include `--self-test` |     90 | —       | Self-test plus a seeded stale header exits 1 | The copies carry pedagogy worth keeping; drift is what a gate detects |
| 4.2 | ☐   | `server/package.json`                                   | Register `validate:phase-header-drift` + self-test in `validate:all`                                                       |      4 | 4.1     | `validate:all` runs 39 steps and passes      | A gate CI does not run is not a gate                                  |

**Tier 4 gate**: `npm run validate:all` green; seeded stale header reproduces exit 1.

### Tier 5 — Documentation and changelog

| #   | St  | File                   | Change                                                                                  | ~Lines | Depends | Verify                         | Justification                     |
| --- | --- | ---------------------- | --------------------------------------------------------------------------------------- | -----: | ------- | ------------------------------ | --------------------------------- |
| 5.1 | ☐   | `docs/guides/gates.md` | Document that guarded phases declare their headers, and undeclared headers are advisory |     25 | 3.1     | Doc describes shipped behavior | Docs/code lockstep                |
| 5.2 | ☐   | `CHANGELOG.md`         | Unreleased `Fixed` entry                                                                |      6 | 1–4     | Entry present                  | Changelog updates with the change |

**Tier 5 gate**: `validate:all` + `test:ci`, plus a live drive — run a real `>>implementation_plan`
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

## Open questions

| id   | status | must precede | decision                                                                                             | chosen default                                         | alternative                                              |
| ---- | ------ | ------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| OQ-1 | OPEN   | Tier 2       | Does single-prompt (non-chain) execution reach stage 19?                                             | Assume chain-only; scope Tier 2 to chain step assembly | Add a second injection point in the single-prompt path   |
| OQ-2 | OPEN   | Tier 3       | Does any framework declare `guards` on a phase with no `section_header` (guarded but unaddressable)? | Treat as advisory, same as undeclared                  | Fail at framework load as a malformed declaration        |
| OQ-3 | OPEN   | Tier 4       | Replace the five hand-written prompt tables with derived text, or keep and gate?                     | Keep and gate                                          | Generate them, accepting loss of the explanatory columns |

---

## Testing strategy

| What to test                                                   | Type                 | Location                                          | Why this type                                          |
| -------------------------------------------------------------- | -------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| Lookup returns declared headers per framework                  | Unit                 | `tests/unit/frameworks/declared-sections.test.ts` | Pure function, exhaustive branches cheaply             |
| Stage behavior unchanged after extraction                      | Regression           | existing phase-guard suites                       | Tier 1 must be behavior-neutral                        |
| Emitted prompt contains declared headers                       | Integration          | chain operator suite                              | Prompt assembly crosses framework + operator           |
| Mutating `section_header` changes both prompt and guard target | Back-test            | fixture mutation                                  | The single-file proof that one source feeds both sides |
| Declared-and-missing still blocks                              | Unit                 | phase-guard suite                                 | Guards against losing enforcement                      |
| Undeclared header is advisory                                  | Unit                 | phase-guard suite                                 | The new behavior                                       |
| Stale prompt copy is detected                                  | Contract + self-test | `validate-phase-header-drift.js`                  | Cross-file agreement is not a type error               |
| Real chain completes unblocked                                 | Live drive           | `>>implementation_plan` end to end                | Fixtures cannot prove the harness experience           |

## Done criteria

| Criterion                     | Validation                 | Pass condition                                                             |
| ----------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| One source                    | Code review + back-test    | No `section_header` literal outside `phases.yaml` and the derived renderer |
| Instruction reaches the model | Live prompt inspection     | A CAGEERF step prompt lists the four required headers                      |
| Undeclared cannot block       | Fixture removal            | Guard warns, advancement continues                                         |
| Enforcement preserved         | Fixture omission           | Declared-and-missing still blocks                                          |
| Drift detectable              | Seeded stale header        | `validate:phase-header-drift` exits 1                                      |
| Suite green                   | `validate:all` + `test:ci` | 39 steps, 2480+ tests                                                      |
| Token cost justified          | Measured delta in notes    | Recorded number, not an estimate                                           |

## Documentation

| Doc                                      | Update                                        |
| ---------------------------------------- | --------------------------------------------- |
| `docs/guides/gates.md`                   | Declared-header contract and advisory posture |
| `CHANGELOG.md`                           | Unreleased `Fixed` entry                      |
| This plan + sibling implementation notes | Tier status, rulings, deviations              |

## Risks

| Risk                                                   | Impact | Mitigation                                                                                        | Rollback                                            |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Enforcement changes on a shipped `enforce` mode        | High   | The change can only make blocking rarer, never more frequent                                      | Revert Tier 3; Tiers 1-2 stand alone                |
| Added prompt tokens on every step                      | Medium | Header vocabulary only; scoped to guarded frameworks; skipped when mode is `off`; measured in 2.4 | Revert Tier 2                                       |
| Extraction changes stage behavior                      | Medium | Tier 1 gate requires zero prompt diff                                                             | Revert 1.2, keep the module unused                  |
| Drift gate produces false positives on pedagogy tables | Low    | Gate compares header strings only, not surrounding prose                                          | Narrow the matcher or exempt with a declared reason |
| Hot-reload breaks from caching                         | Medium | Resolver reads through `FrameworkManager` per call, no cache                                      | n/a — no cache introduced                           |

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
