---
title: "CONTRIBUTING agreement with the repo — kill the drift, then gate it"
date: 2026-08-16
status: reference
tags:
  - docs
  - scripts
  - ci
---

# CONTRIBUTING Agreement

**Area**: `CONTRIBUTING.md`, `server/scripts/`, `server/package.json`, `scripts/run-validation-suite.js`
**Work type**: bug_fix (secondary: feature)
**Origin**: PR #204 review and the v4.0.1 release, 2026-08-16

## Findings Ledger

Severity is set by observed contributor failure rather than by how wrong the text reads. Three of
six map to a specific thing that went wrong in one external contribution, which is the argument for
the wider scope over the three-item patch.

| ID  | Finding                                            | Location              | Observed failure                                                      | Status                                                                |
| --- | -------------------------------------------------- | --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| F1  | `start:sse` does not exist                         | `CONTRIBUTING.md:227` | #204 verified STDIO only; the bug was on both transports              | ✓ 2026-08-16 · both sites now name start:stdio + start:development    |
| F2  | `npm run format` does not exist                    | commands table        | none observed                                                         | ✓ 2026-08-16 · now validate:format (format:fix was dead too, see F7b) |
| F3  | `npm run test:jest` does not exist                 | `CONTRIBUTING.md:73`  | none observed                                                         | ✓ 2026-08-16 · alias dropped; npm test declared unit-only             |
| F4  | Minimum Validation omits `typecheck:tests:ratchet` | `CONTRIBUTING.md:245` | 9 type errors passed both `typecheck` and Jest, 2026-08-16            | ✓ 2026-08-16 · Minimum Validation names four scripts                  |
| F5  | No route to where tests live or the ESM flag       | `CONTRIBUTING.md:271` | #204 author had to ask where a test should go                         | ✓ 2026-08-16 · names tests/unit/<domain>/ and the ESM flag            |
| F6  | Decision Matrix omits `lint:ratchet`               | `CONTRIBUTING.md:222` | #204 introduced 2 ratchet violations; the author ran exactly this row | ✓ 2026-08-16 · row defers to Minimum Validation                       |

| F7a | Documented pre-push sequence matched no step in `.husky/pre-push` | `:296-303` | discovered during T1.6 | ✓ 2026-08-16 · replaced with the real 8-step route |
| F7b | `format:fix` does not exist either | commands table | missed by the audit's own regex | ✓ 2026-08-16 · removed |

**Root cause, common to all six.** CONTRIBUTING is unverified prose about an executable system.
Every comparable contract here has a gate: `validate:suite-membership` for script membership,
`validate:standards-pins` for version agreement, `validate:readme` for README structure,
`validate:documented-options` for option coverage. Nothing reads CONTRIBUTING. The three dead
commands rotted at three different times and none was caught.

## Constraints

- A hook step that CI does not run breaks the validation contract. A new check enters `validate:all`
  first, which CI runs whole (project CLAUDE.md, Validation Gates).
- `scripts/classify-validation-scope.js` is the changed-path SSOT. No competing path list.
- Every validator carries a `--self-test`, and `validate:suite-membership` asserts that membership.
- A CONTRIBUTING-only change classifies as `docs`, which routes to hygiene-only CI. See OQ-2.

## Open Questions

| ID   | Question                                                     | Recommendation                                                                                                                                                                                                                             | Status                                                  |
| ---- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| OQ-1 | Does `typecheck:tests:ratchet` join `.husky/pre-push`?       | No. It is already in `validate:all` (`run-validation-suite.js:78`), pre-push already runs 8 steps including `typecheck:committed`, and the marginal catch is late rather than missed. Document it in the minimum and leave the hook alone. | RULED 2026-08-16 · no                                   |
| OQ-2 | Is `validate:contributing` reachable on the `docs` CI route? | Must be. The gate would otherwise be absent exactly when CONTRIBUTING changes, which is the only time it matters. Highest-risk item in the plan.                                                                                           | RULED 2026-08-16 · no, hence the ci.yml docs-route step |

## Tier 1 — Correct the document

Mechanical. Every change is determined before editing, so it skips design gates.

| Task | File                  | Change                                                                                            | Status |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| T1.1 | `CONTRIBUTING.md:227` | `start:sse` becomes `start:development` (streamable-http)                                         | ✓      |
| T1.2 | commands table        | `format` becomes `validate:format`                                                                | ✓      |
| T1.3 | `CONTRIBUTING.md:73`  | Drop `test:jest`; state `npm test` is unit-only and `test:integration` is separate                | ✓      |
| T1.4 | `CONTRIBUTING.md:245` | Add `typecheck:tests:ratchet` to Minimum Validation                                               | ✓      |
| T1.5 | `CONTRIBUTING.md:222` | Add `lint:ratchet` to the Server source code row                                                  | ✓      |
| T1.6 | `CONTRIBUTING.md:271` | Name `tests/unit/<domain>/`, `tests/integration/`, and `NODE_OPTIONS="--experimental-vm-modules"` | ✓      |

## Tier 2 — `validate:contributing`

New `server/scripts/validate-contributing.js`, modelled on the existing validators.

| Task | Change                                                                                                                                                                                           | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| T2.1 | Extract command refs in BOTH forms: `npm run X` and bare backticked `namespace:script`. The `start:sse` reference used the bare form, so a `npm run` regex alone misses the motivating instance. | ✓      |
| T2.2 | Assert each exists in `server/package.json` scripts; report unknowns with line numbers                                                                                                           | ✓      |
| T2.3 | `--self-test`: reject a CONTRIBUTING containing an invented command, accept the real one                                                                                                         | ✓      |

**Declared blind spot for v1**: asserting that documented gate _sequences_ match
`run-validation-suite.js`. That needs a parse of prose intent and would produce false positives.
Record it in the file header, per the convention in `validate-table-contracts.js`.

## Tier 3 — Wire it in

| Task | Change                                                                     | Status |
| ---- | -------------------------------------------------------------------------- | ------ |
| T3.1 | Register `validate:contributing` and `:self-test` in `server/package.json` | ✓      |
| T3.2 | Add to `scripts/run-validation-suite.js`; rule OQ-2 first                  | ✓      |
| T3.3 | Confirm `validate:suite-membership` passes with the new entry              | ✓      |
| T3.4 | Record the OQ-1 ruling in the implementation notes                         | ✓      |

## Tier 4 — Verify against the motivating instance

| Task | Change                                                                                                  | Status |
| ---- | ------------------------------------------------------------------------------------------------------- | ------ |
| T4.1 | Run `validate:contributing` against `CONTRIBUTING.md` as of `f4452ced`; it must fail naming `start:sse` | ✓      |

A gate that does not catch the drift that motivated it is not evidence of anything.

## Acceptance

| Signal                               | Pass condition                                         |
| ------------------------------------ | ------------------------------------------------------ |
| Dead commands                        | 0, by diffing extracted refs against `package.json`    |
| Gate catches its motivating instance | Fails on pre-fix CONTRIBUTING naming `start:sse`       |
| Self-test                            | Rejects an invented command, accepts the real document |
| Suite membership                     | `validate:suite-membership` green                      |
| Full suite                           | `validate:all` green, step count 39 to 40              |
| No routing regression                | A CONTRIBUTING-only change still classifies as `docs`  |

**Failure protocol**: a false positive on legitimate prose narrows the extraction. It does not earn
an exception list. An exception with no exit is a permanent bypass wearing a temporary label.

## Sequencing

Tier 1 alone delivers user-visible value and ships first regardless, because Tier 2 without Tier 1
leaves a red gate.

## Follow-ups this surfaces but does not fix

1. `README.md` and `docs/**` carry the same exposure with no equivalent check. `validate:readme`
   asserts structure rather than command existence. If `validate:contributing` proves itself,
   generalize the extractor into `validate:doc-commands` covering both instead of copying the script.
2. Related open issues from the same review: #228 (`framework-compliance` ignores `exclude`) and
   #229 (STDIO hot reload does not fire).
