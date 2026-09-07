---
title: "Contract layer — implementation notes"
plan: contract-layer-2026-09-06.md
date: 2026-09-07
status: active
tags: [contracts, implementation-notes]
---

# Contract Layer — Implementation Notes

Deviation log for `contract-layer-2026-09-06.md`. Rulings live in that file's `Rulings` table
(D1–D22); this file records where execution diverged from them.

## Deviations

| #   | Date       | Row | Deviation                                                                                                                                                                 | Why                                                                                                                                                                                                  |
| --- | ---------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | 2026-09-07 | D21 | `run-validation-suite.js` entry for `validate:domain-ownership` declares `reads: ['declared']`, although the lib walks `server/src`.                                      | `auditSubstrate` derives `reads` by following `.js` imports only; the `.ts` lib is invisible to it and any truer value fails `validate:suite-membership`. Same value as the sibling descriptor step. |
| V2  | 2026-09-07 | D21 | Eight lib helpers and the `MatrixRow` type made module-private after wiring.                                                                                              | `knip-ratchet` counted them as unused exports. Public surface: `auditOwnership`, `collectOwnershipRecords`, `resolveOwnershipDefinitions`, `formatOwnershipProblems` and their types.                |
| V3  | 2026-09-07 | D21 | A literal NUL byte in a map-key template literal in `semantic-module-descriptors.ts` was replaced with the backslash-u-0000 escape sequence.                              | Git classified the file as binary.                                                                                                                                                                   |
| V4  | 2026-09-07 | D21 | The new Command Reference row in `CLAUDE.md` is wider than the table's padding.                                                                                           | Prettier accepts it; re-padding would rewrite ~20 unrelated rows.                                                                                                                                    |
| V5  | 2026-09-07 | D22 | PR title `ci(scripts)` while the commit is `feat(scripts)`.                                                                                                               | Nothing consumer-visible changed; a `feat` title would put a contributor tool in the consumer changelog. Squash uses the PR title.                                                                   |
| V6  | 2026-09-07 | D22 | An unplanned fix PR (#267) preceded the merge: `plans/adoption-conversion-2026-09-07-implementation-notes.md` lacked frontmatter and failed `plans:retire:check` on main. | Housekeeping class (ownerless). Main CI had been red on its own commit; #266 inherited it after rebase. Fixed on its own branch rather than folded into #266.                                        |
| V7  | 2026-09-07 | O4  | The three prototype sample files were auto-stamped `status: active` by the plan-frontmatter hook on write. Re-stamped `reference` with tag `prototype`.                   | They are throwaway reaction artifacts, not plans; `active` would queue them for retirement and bind sessions to them.                                                                                |

## Findings (not deviations)

- All three prototype agents independently excluded `resolveEnforcementMode` from `engine-gates.owns`: the matrix groups by capability, descriptors by module (D17a).
- Two of fourteen matrix rows had drifted before any validator existed (D17a). The validator found both unprompted on its first real run.
