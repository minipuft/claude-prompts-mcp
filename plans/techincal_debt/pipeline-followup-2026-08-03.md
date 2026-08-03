---
title: "Pipeline Follow-up — Tiers 15-16"
date: 2026-08-03
status: backlog
tags: []
---

# Pipeline Follow-up — Tiers 15-16

**Date**: 2026-08-03
**Area**: `server/src/engine/execution/pipeline/decisions/gates/`, `server/src/engine/execution/types.ts`,
`server/src/engine/execution/pipeline/stages/12-framework-stage.ts`
**Work type**: Tier 15 = refactor (deletion), Tier 16 = refactor (extraction)
**Predecessor**: [`pipeline-followup-2026-08-02.md`](./pipeline-followup-2026-08-02.md) (Tiers 8-14, complete)
**Confidence**: high on Tier 15 (probed 2026-08-03, mechanically detected) · medium on Tier 16

---

## Why these are separate from Tiers 8-14

Both were **deliberately deferred**, not missed, and each is recorded in the predecessor with
the reason:

- **Tier 15** resolves the eight findings Tier 10's detector baselined. They were left in the
  baseline so the ratchet could ship enforcing rather than blocking; fixing them is its own
  work with its own blast radius.
- **Tier 16** resolves the three private predicates Tier 12 left in an orchestration class.
  Tier 12's deviation log (D28) records why moving them then would have repeated the mistake
  that tier had just diagnosed.

---

## Tier 15: Retire the eight baselined write-never fields

`scripts/state-field-writers-baseline.json` holds eight fields that are declared, read in
some cases, and assigned nowhere in `src/`. They split into two clusters with very different
shapes and risks. **Do them as separate subtier groups; do not batch.**

### 15A — The dead decision apparatus on `GateEnforcementAuthority`

**This is larger than the predecessor plan recorded, and the earlier scoping was wrong.**
Tier 10 reported the two `GateEnforcementInput` fields as "writers absent because `decide()`
has no callers", and stated that `getCachedDecision()` therefore "always returns null for its
two consumers". Re-probed 2026-08-03: **all three `getCachedDecision()` call sites are on
`frameworkAuthority`, not `gateEnforcement`** — `19-phase-guard-verification-stage.ts:219`,
`response-assembler.ts:777`, `gate-verdict-processor.ts:463`. The gate authority's caching
surface has no consumers at all.

Measured dead surface on `GateEnforcementAuthority`:

| Symbol                                            | Production callers                                            |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `decide()`                                        | 0                                                             |
| `hasDecided()`                                    | 0                                                             |
| `getCachedDecision()`                             | 0                                                             |
| `reset()`                                         | 0                                                             |
| `private enforcementDecision`                     | written only by `decide()`                                    |
| `private computeDecision()`                       | called only by `decide()`                                     |
| `GateEnforcementInput`, `GateEnforcementDecision` | re-exported from `decisions/index.ts`; no production consumer |

The whole caching apparatus is unreachable. The methods actually in use are `parseVerdict`,
`parseGateVerdicts`, `recordOutcome`, and the pending-review group.

**Why it survived**: `tests/unit/execution/pipeline/state/gate-enforcement-authority.test.ts`
exercises `decide`, `hasDecided`, and `reset` at lines 646-702. Tests keep it alive and make
it read as covered — the same reason the three original write-never fields survived, one level
up. `knip` will not flag a used-by-tests export either.

| #     | Status | Step                                                                              | Files                                                                              | Depends | Verification                                         |
| ----- | ------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------- | ---------------------------------------------------- |
| 15A.1 | ☐      | Re-measure the dead surface before deleting — the inventory above is two days old | —                                                                                  | —       | Probe output per symbol, not a re-read of this table |
| 15A.2 | ☐      | Decide per symbol: wire a caller, or delete                                       | —                                                                                  | 15A.1   | The user-facing behaviour decides, per Tier 9's rule |
| 15A.3 | ☐      | Delete the apparatus, its types, and its barrel re-exports                        | `gate-enforcement-authority.ts`, `gate-enforcement-types.ts`, `decisions/index.ts` | 15A.2   | `rg GateEnforcementInput` → 0 outside history        |
| 15A.4 | ☐      | Delete the tests that held it alive                                               | `gate-enforcement-authority.test.ts`                                               | 15A.3   | Suite passes with the block removed, not skipped     |
| 15A.5 | ☐      | Lower the detector baseline                                                       | `state-field-writers-baseline.json`                                                | 15A.3   | `validate:state-field-writers` green at 6 known      |

**Gate**: no symbol on `GateEnforcementAuthority` has zero callers, and the baseline drops by two.

**Risk**: low. Pure deletion of an unreachable region. The one trap is 15A.4 — deleting
production code while leaving its tests turns a green suite into a lie, and `typecheck` will
not catch it because `tsconfig.json` excludes `tests/`. Run `typecheck:tests:ratchet`.

### 15B — Six `ConvertedPrompt` fields the converter never populates

`ConvertedPrompt.gates`, `.tools`, `.delegation`, `.delegationAgent`, `.executionModifiers`,
`.requiresExecution`. `modules/prompts/converter.ts:129` is the only production construction
site and sets none of them, while consumers read them — `06-operator-validation-stage.ts:129`
reads `convertedPrompt?.delegation === true`.

**This is the readers-with-no-writer shape, and it is the dangerous half of the eight.** Unlike
15A, these have live readers taking the `undefined` branch on every request, so each one is a
feature that looks implemented. `delegation` in particular gates the `==>` delegation operator.

| #     | Status | Step                                                                                           | Files                                              | Depends | Verification                                                     |
| ----- | ------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| 15B.1 | ☐      | Per field, count real readers — `rg .gates` returns 211 hits, almost all unrelated             | —                                                  | —       | A per-field reader list with receivers resolved, not name counts |
| 15B.2 | ☐      | Establish whether the prompt YAML schema even carries these, and whether the loader drops them | `modules/prompts/prompt-schema.ts`, `converter.ts` | 15B.1   | Answered: missing producer, or field the schema never had        |
| 15B.3 | ☐      | Per field: wire the converter, or delete the field and its readers                             | `converter.ts` or the readers                      | 15B.2   | Decision recorded per field with its user-facing argument        |
| 15B.4 | ☐      | Integration test for any field that gains a producer                                           | `tests/integration/`                               | 15B.3   | Fails before the wiring, passes after                            |
| 15B.5 | ☐      | Lower the detector baseline                                                                    | `state-field-writers-baseline.json`                | 15B.3   | `validate:state-field-writers` green at 0 known                  |

**Gate**: every one of the six either has a producer with a test proving it reaches its reader,
or is gone along with its readers.

**Risk**: medium, and higher than 15A despite being smaller. `delegation` gates a documented
operator; if the schema does carry it and the converter simply drops it, this is a live
user-facing defect, not cleanup. **Answer 15B.2 before deciding anything** — that is the step
that distinguishes a missing producer from a redundant channel, and Tier 9 established that the
user-facing interface decides, not the code shape.

**Do not batch 15B.3 across fields.** Six independent decisions; `gates` and `tools` may well
be duplicates of `scriptTools` / gate accumulation that already work, while `delegation` may be
a real gap.

---

## Tier 16: Framework-requirement predicates out of the stage

`12-framework-stage.ts` holds `chainStepsRequireFramework`, `stepRequiresFramework`, and
`hasFrameworkGate` as private methods on an orchestration class, which `architecture.md`
forbids ("adding a `private someHelper()` to a stage → STOP, extract to the owning service").

**Tier 12 left them deliberately, and its reason is the constraint this tier has to solve.**
They close over `currentRequestFrameworkGates`, a request-scoped `Set<string>` the stage loads
asynchronously at the top of `execute` via `gateLoader.getFrameworkGateIds()`. Moving them
without moving that load would hide an async dependency behind a synchronous call — the same
trap that made Tier 12's prescribed fold unworkable, one level down.

**The shape that likely works**, by analogy with Tiers 11 and 13: make them pure functions that
take the gate-id set as a parameter rather than closing over instance state, and place them
where the layer model allows the stage to import them directly. The stage keeps the async load,
which is I/O and belongs to it. This mirrors Tier 13 exactly — the codec/decision interprets,
the caller fetches.

| #    | Status | Step                                                                              | Files                               | Depends | Verification                                            |
| ---- | ------ | --------------------------------------------------------------------------------- | ----------------------------------- | ------- | ------------------------------------------------------- |
| 16.1 | ☐      | Confirm the three predicates read nothing but their arguments and the gate-id set | `12-framework-stage.ts`             | —       | No `this.` other than `currentRequestFrameworkGates`    |
| 16.2 | ☐      | Choose the home under the layer rules before writing — `validate:arch` decides    | —                                   | 16.1    | Named target that the engine may import as a value      |
| 16.3 | ☐      | Extract as pure functions taking the gate-id set; delete the private methods      | new module, `12-framework-stage.ts` | 16.2    | `validate:arch` clean; stage keeps the async load       |
| 16.4 | ☐      | Unit-test the predicates directly                                                 | `tests/unit/`                       | 16.3    | Step-level requirement, inline gates, and the empty set |
| 16.5 | ☐      | Differential over the stage's existing suite                                      | `framework-stage.test.ts`           | 16.3    | Unchanged assertions pass before and after              |

**Gate**: the stage holds no private domain predicate, and the async gate-id load still happens
exactly once per request in the stage.

**Risk**: medium. The predicates sit on the path that decides whether a framework is resolved at
all, so a wrong answer silently drops framework guidance rather than erroring.

**Check `validate:arch` before choosing the home, not after.** Tier 14 lost a round to
`engine-no-modules-or-mcp-value` by placing a pure function where its domain said it belonged
rather than where the engine may import it.

---

## Rejected alternatives

- **Fold 15A and 15B into one tier because both come from one baseline** — they share a
  detector, not a shape. 15A is unreachable code with no readers; 15B has live readers on every
  request. Batching them would let 15A's triviality set the risk posture for 15B's operator gap.
- **Fix the eight before shipping Tier 10's ratchet** — would have blocked a working detector on
  unrelated debt. The ratchet exists precisely so enforcement and cleanup can proceed apart.
- **Do Tier 16 during Tier 12** — rejected there and still right: the async-dependency question
  needed its own answer, and bundling it would have obscured Tier 12's actual finding about the
  cache-priming caller.
- **Treat Tier 16 as complexity work** — `12-framework-stage.ts` is already under the cognitive
  limit after Tier 12. This is a layer-boundary fix with no complexity motive, and framing it as
  a score would reintroduce the refactoring-toward-a-number the predecessor rejected twice.
