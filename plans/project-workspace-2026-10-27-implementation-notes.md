---
title: Project workspace notes
date: 2026-10-27
status: active
plan: project-workspace-2026-10-27.md
tags: [resources, workspace, cli, docs]
---

# Project workspace — implementation notes

## 2026-10-27 — opened

- Source: owner request in chat 2026-10-27 (planner session), after the chain-step gate pass exposed that a CloudySky gate had no home outside the bundle.
- Classify: feature · discovery → pre-flight → implement → validate · scope: `server/src/runtime/paths.ts`, `resource-roots.ts`, `shared/utils/project-scope.ts`, `infra/config/`, `cli/src/commands/init.ts`, three docs, two resource trees · skip_gates: none · primary skill: /search → /refactoring.
- Measured before cutting: overlay roots are decided in `resource-roots.ts` (`resolveResourceRoots`) and ordered by `resourceRootPrecedence` in `shared/`, primary > overlays > bundled; the write root is `resolveResourceSubdir` in `paths.ts`; the project scope id derives in `shared/utils/project-scope.ts` from `CLAUDE_PROJECT_DIR` then cwd; `cpm init` is `cli/src/commands/init.ts` over `initWorkspace`/`initConfig`; overlay tests live in `tests/unit/runtime/paths.runtime.test.ts`, `tests/unit/infra/config/resource-write-destination.test.ts`, `tests/integration/runtime/hot-reload-late-root.integration.test.ts`.
- Authored vs measured: the owner's default 3 assumed the two frameworks could leave the bundle with the gate; measured 2026-10-27, `radiant`/`liquescent` are named at 14 sites outside `server/resources/frameworks/` (schema, a validation script, e2e and conformance fixtures, two source comments, skills-sync and its tests, the frameworks guide). Ruling R6 holds that half and adds row 2.4.

## Deviations

- DEV-T2-1 (2026-10-27, row 2.2): public docs were dispatched as a worker brief rather than through `>>documentation_change`; the rulings were the spec and the row was prose-exact. Recorded so the next docs row routes through the chain.
- DEV-T2-2 (2026-10-27, row 2.1): `cli/` resolves no prettier config of its own and a bare `prettier --write` rewrote `cli.ts` to double quotes; the worker restored the file and formatted the test with `--config server/.prettierrc.json`. `validate:format` does not cover `cli/**/*.ts`. A brief for a cli row names the config.

## Findings

- F1 (row 2.4, 2026-10-27): the framework-removal coupling, re-measured. Behaviour sits at three places only: `SHIPPED_FRAMEWORK_IDS` in `server/src/engine/frameworks/definitions/shipped-frameworks.ts:34-35` (the registry fail-fast loads every shipped id, so the ids and the directories must go in one change), the `creed-fidelity` gate (`framework_context: [RADIANT]`, moving in 2.3), and the tests that load the bundle through `defaultFramework` (`tests/e2e/framework-selection-lifecycle.e2e.test.ts`, ~40 radiant-specific lines; `framework-guidance-filter.e2e.test.ts`; `tests/e2e/conformance/frameworks.yaml:26-33`; `tests/integration/tenant/workspace-continuity.test.ts:211,221`; `tests/unit/frameworks/framework-state-store.persistence.test.ts`; `tests/unit/frameworks/definitions/yaml-framework-loading.test.ts:29-30` guarded-id list). Everything else is prose: `docs/guides/frameworks.md:27-28,46,53`, `docs/architecture/overview.md:345`, the `config-file.ts:223` doc comment (regenerates `config.schema.json` and `config-template.ts`), and comments in `chain-operator-executor.ts:718`, `shipped-frameworks.ts:9,12`, `framework-lifecycle-processor.ts:818`, `validate-shipped-frameworks.ts:14`, `skills-sync/service.ts:799,802`, `strategic_worker/prompt.yaml:52`. Estimate: one atomic row (ids + directories + guarded list), then five independent rows (three test repoints, docs, schema comment + regenerate), six to eight rows in all. A user config with `defaultFramework: "RADIANT"` would break at load; what load does with an unknown default was not checked.
- F1a: R6's text overstated the skills-sync coupling (one comment and one hand-built fixture, no behaviour). Superseded here, R6 left as written in the plan with this pointer.
- F2 (row 2.4): stale prose found on the way: `docs/architecture/overview.md:345` lists six guides and omits RADIANT and VERIFY; `yaml-framework-loading.test.ts:23` says "The 7 frameworks" over a 7-entry list that excludes `verify`; `framework-lifecycle-processor.ts:818` has a doc comment whose `@returns` text is wrong.
- F3 (row 2.2): `docs/guides/cli.md` and `cli/README.md` document `cpm init ./my-workspace` but not `--project`; row 2.5 added.
