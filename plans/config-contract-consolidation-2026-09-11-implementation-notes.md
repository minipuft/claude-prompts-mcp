---
title: "Config Contract Consolidation — One Owner For The Shape Of `config.json` — Implementation Notes"
plan: config-contract-consolidation-2026-09-11.md
date: 2026-09-11
status: active
tags: []
---

# Implementation Notes

Deviations, discovered constraints, unknowns, and re-measurements found while
executing the plan. Conservative option taken, logged, work continued.

## Rulings

| #   | Date       | Ruling                                                                                                                                                                                                           |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R7  | 2026-09-11 | OQ-2 RULED to its default: `server.version` is read from `package.json` and dropped from the config surface. Implemented in T2, not T0 — T0 declares it so the schema and the CLI stay consistent in the interim |
| R8  | 2026-09-11 | OQ-3 RULED to its default: both zero-reader CLI keys are deleted, in T2.3. Same interim reasoning as R7                                                                                                          |

## Deviations

| #        | Date       | What forced it                                                                                                                                                                                                                                                                                                          |
| -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T0-1 | 2026-09-11 | **Authored 26 subsections, measured 27.** The plan's count (S1 and row 0.3) was off by one. Conservative option: insert by textual match on `"type": "object",` and assert the count rather than trusting either number. Corrected in the plan in place                                                                 |
| DEV-T0-2 | 2026-09-11 | Row 0.2 said "declare the 3 CLI-writable keys". Declared them **with `DEPRECATED —` descriptions naming their plan OQ**, rather than as plain keys. A bare declaration reads as endorsement, and R7/R8 already rule all three out; the description is what carries the ruling to anyone reading the schema in an editor |
| DEV-T0-3 | 2026-09-11 | `validate:suite-membership` failed after 0.4: the suite entry declared `reads: ['file']` and the new fixture code re-derives `[file, walk]`. Corrected the declaration. Not a plan error — the gate did exactly its job, and it is why the entry is trustworthy                                                         |
| DEV-T0-4 | 2026-09-11 | 4 new lint errors from 0.4 (3 `no-unused-vars` on type-position parameter names, 1 `preserve-caught-error`). All attributable to this tier, all fixed inside it: `_`-prefixed the type-position names and attached `{ cause: error }` to the rethrow                                                                    |

## Unknowns / gaps found during execution

**GAP-1 — `scripts/` is not typechecked by anything.** `server/tsconfig.json` sets
`include: ["src/**/*"]`, so `npm run typecheck` cannot see `scripts/validate-config-schema.ts`,
which is where row 0.4's code lives. `tsconfig.test.json` adds `tests/**/*` and still not
`scripts/`. The tier's own verification was therefore vacuous as written: the project typecheck
runs green whether or not the new script compiles.

Substituted for this tier: a temporary tsconfig extending `tsconfig.json` with `rootDir: "."` and
`include: ["src/**/*", "scripts/validate-config-schema.ts"]`, run under the project's real compiler
options. Exit 0, no diagnostics. `tsx` transpiles without typechecking, so running the self-test
green does NOT substitute for this.

Blast radius is the whole `scripts/` directory — 58 validation scripts CI depends on, none of them
typechecked. Promoted to a plan row (T0.5) rather than left here, because prose in an execution
record reads as narrative and only a row reads as work.
