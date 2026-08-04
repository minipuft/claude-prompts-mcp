---
title: "StepState → StepLifecycle Data-Model Migration"
date: 2026-07-29
status: reference
tags: []
---

# StepState → StepLifecycle: deferred data-model migration

**Status**: ✓ **COMPLETE 2026-07-30.** Deferred out of the sweep, then executed the same day on
operator request. All 8 steps below landed; gate green (typecheck 0, 1696/1696, `validate:all` 0
across 17 members, `validate:arch` 0, `build` 0). Retained as the record of what changed and why.

**Outcome vs plan**: the two-tier collapse needed one design decision the plan had left open —
how a call site says "rendered" vs "responded" once both map to lifecycle `working`. Resolved by
introducing `StepMilestone` (`pending | rendered | responded | completed`), a 1:1 replacement for
the retired enum at every call site, with `lifecycleForMilestone()` deriving the sticky value and
`setStepState()` stamping the matching timestamp. No information was lost in the collapse.
**Origin**: step 3.1 of `shim-debt-sweep-2026-07-29.md`, where it was written as a textual rename.
**Why it moved**: it is not a rename. See "The defect in the original framing" below.
**Owner initiative**: SEP-1686 execution ledger (the ledger plan file itself is retired; this file
is now the sole durable record of the remaining work).

---

## The defect in the original framing

The sweep specified `StepState` → `StepLifecycle` verified by `rg -c "\bStepState\b" = 0`. A
textual substitution satisfying that check produces code that does not compile and, where it does,
silently loses state. The two types are different data models:

|                 | `StepState` (retiring)                                  | `StepLifecycle` (target)                                                   |
| --------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| Kind            | `enum`                                                  | string union                                                               |
| Values          | `PENDING`, `RENDERED`, `RESPONSE_CAPTURED`, `COMPLETED` | `pending`, `working`, `input_required`, `completed`, `failed`, `cancelled` |
| Terminal states | none sticky                                             | `completed`/`failed`/`cancelled` are sticky                                |

`RENDERED` and `RESPONSE_CAPTURED` have **no counterpart** in `StepLifecycle`. They are not states
in the target model — they are _substate flags_ within `working`. `StepLifecycle.RENDERED` does
not exist.

Measured 2026-07-30: **37** sites total, of which **7** use the two unmappable members
(4 × `RENDERED`, 3 × `RESPONSE_CAPTURED`); the other 14 member uses are `COMPLETED`, which maps
directly.

## What makes this more than a type change

`shared/types/chain-session.ts` and `modules/chains/manager.ts` are on the blob-encoded
`chain_run_registry` persistence path. `StepMetadata.state` is serialized into that blob, so
changing its type changes **persisted state shape**. `state.db` is ephemeral and
`SCHEMA_VERSION` (currently **15**, `infra/database/sqlite-engine.ts:33`) triggers
drop-and-recreate, so no migration code is needed — but the bump is mandatory, not optional.
Skipping it leaves live sessions decoding an enum value that no longer exists.

## The good news: the two-tier model is already half-built

`StepMetadata` **already carries the substate timestamps** next to the enum:

```ts
export interface StepMetadata {
  state: StepState; // <- the part that retires
  isPlaceholder: boolean;
  renderedAt?: number; // <- already the substate model
  respondedAt?: number;
  completedAt?: number;
}
```

and `manager.ts:576-594` already populates them on every `setStepState()` call. So the migration
is mostly _deleting the enum dimension_, not building a new one:

- `state === RENDERED` → `state: 'working'` + `renderedAt` already set
- `state === RESPONSE_CAPTURED` → `state: 'working'` + `respondedAt` already set
- `state === COMPLETED` → `state: 'completed'`
- `state === PENDING` → `state: 'pending'`

Note the asymmetry this creates and must resolve: `RENDERED` and `RESPONSE_CAPTURED` both collapse
to `'working'`, so any code that _distinguishes_ them must switch to reading the timestamps. Two
sites do exactly that today — `manager.ts:800` (`isPlaceholder ? RENDERED : RESPONSE_CAPTURED`)
and `step-capture-service.ts:66-71`.

## Blocking prerequisite: a third vocabulary split inside the target types

`StepSubstate` and `StepMetadata` — the two types meant to converge — disagree on field names:

| Concept          | `StepSubstate`    | `StepMetadata`      |
| ---------------- | ----------------- | ------------------- |
| render time      | `renderedAt`      | `renderedAt` ✓      |
| response time    | **`responseAt`**  | **`respondedAt`** ✗ |
| validation start | `validatingSince` | _(absent)_          |
| completion time  | _(absent)_        | `completedAt`       |

Resolve this **before** migrating consumers, or the migration hardcodes the disagreement into 37
call sites. Recommendation: `respondedAt` (verb-participle, consistent with `renderedAt` and
`completedAt`); reconcile `validatingSince`/`completedAt` membership at the same time.

## Full site inventory (measured 2026-07-30, clean tree)

| File                                                                | Sites | Nature                                                                                           |
| ------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------ |
| `src/modules/chains/manager.ts`                                     | 12    | **core** — `setStepState`/`transitionStepState`/stickiness guard + the substate population block |
| `src/shared/types/chain-session.ts`                                 | 5     | interface signatures + a re-export for ex-`modules/chains/types.ts` consumers                    |
| `src/shared/types/chain-execution.ts`                               | 4     | enum definition + `StepMetadata.state` + `@deprecated` prose                                     |
| `src/engine/execution/capture/step-capture-service.ts`              | 3     | placeholder/terminal discrimination                                                              |
| `src/mcp/tools/prompt-engine/core/types.ts`                         | 2     | re-export surface                                                                                |
| `src/shared/types/index.ts`                                         | 1     | re-export                                                                                        |
| `tests/unit/chain-session/chain-session-store.test.ts`              | 7     | asserts on enum members                                                                          |
| `tests/unit/execution/pipeline/step-response-capture-stage.test.ts` | 3     | asserts on enum members                                                                          |

No hits in `hooks/` or `docs/` — this is internal only, with **no MCP contract exposure**. The
`chain_sessions` table is read by `hooks/lib/db_reader.py`, so confirm whether it projects `state`
before changing the blob encoding.

## Execution order — all steps ✓ 2026-07-30

1. ✓ Reconcile `responseAt` / `respondedAt`. Trivial in the end: `responseAt` had **zero
   consumers** beyond its own declaration, so this was a 1-line rename, not a migration.
2. ✓ `StepMetadata.state` widened to `StepLifecycle`; `StepMilestone` added as the call-site
   vocabulary.
3. ✓ The 2 discriminating sites migrated (`step-capture-service.ts:67,71` now compare
   `=== 'completed'`; the placeholder branch in `manager.ts` picks `'rendered'` vs `'responded'`).
4. ✓ Remaining consumers + 10 test assertions migrated.
5. ✓ `enum StepState` deleted along with its re-exports and `@deprecated` tags. The surviving
   method names `setStepState` / `getStepState` / `transitionStepState` were **kept on purpose** —
   they name the operation, not the retired type.
6. ✓ `SCHEMA_VERSION` 15 → 16, with the reason recorded at the constant.
7. ✓ `scripts/validate-no-stepstate.js` added and registered (`validate:all` now **17** members).
   Negative-tested both directions. Note: it filters standalone matches in **JS**, because rg's
   Rust regex engine has no look-around — a `(?<![A-Za-z])` pattern fails to parse there.
8. ✓ `hooks/lib/db_reader.py` verified by reading it: `_session_to_hook_state()` consumes only
   `currentStep` / `totalSteps` and never touches `stepStates` or per-step `state`, so the blob
   change does not reach the Python side.

**Gate**: `npm run typecheck && npm run test:ci && npm run validate:all && npm run validate:arch`,
plus driving a chain through render → capture → complete and confirming the hook still reads it.

## Do not

- Do not `sed` this. The verification `rg -c "\bStepState\b" = 0` is satisfiable by a
  substitution that compiles in some files and loses the render/response distinction in others.
- Do not land it inside a vocabulary sweep commit. It changes persisted shape; it needs its own
  commit and its own `SCHEMA_VERSION` bump.
