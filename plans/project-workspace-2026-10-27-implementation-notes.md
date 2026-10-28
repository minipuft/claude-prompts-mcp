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

- DEV-T1-2 (2026-10-27, row 1.3): the brief named `server/src/infra/config/` as the loader; the worker found it in `runtime/paths.ts` and edited there; a refusal for an unreadable project config was added beyond the brief (same class as the workspace refusal, so accepted).

- DEV-T2-3 (2026-10-27, row 2.3): R7 said cloudySky receives the gate on a local branch of its own; cloudySky is on `feat/open-work-2026-09` with unrelated modified files owned by another session, so the planner did not move that HEAD. `.claude-prompts/` sits untracked there for the owner to commit.

- DEV-T1-1 (2026-10-27, row 1.1): the row's 5-file bound was widened to the precedence statement, the prompt loader and the tests pinning the old order, under R9; the worker added a public `getProjectWorkspace()` and a `projectLaunch` injection the brief did not name (needed by 1.2 and 1.3 and by the tests).

- DEV-T2-1 (2026-10-27, row 2.2): public docs were dispatched as a worker brief rather than through `>>documentation_change`; the rulings were the spec and the row was prose-exact. Recorded so the next docs row routes through the chain.
- DEV-T2-2 (2026-10-27, row 2.1): `cli/` resolves no prettier config of its own and a bare `prettier --write` rewrote `cli.ts` to double quotes; the worker restored the file and formatted the test with `--config server/.prettierrc.json`. `validate:format` does not cover `cli/**/*.ts`. A brief for a cli row names the config.

## Findings

- F7 (rows 1.4/1.2): `--transport=both` opens the HTTP listener as well, so it is treated as HTTP for discovery (ruled, R4 reading). The type getters cache their primary at first use, so a `.claude-prompts/` created at runtime hot-loads new ids but precedence over a same-id workspace copy and the write destination apply from the next start; ruled: document, do not invalidate caches in this cut (the loaders' fixed roots would disagree with a moved primary). `createPathResolver` has no production caller; `runtime/context.ts` builds the resolver itself and now determines the transport before the path refusal, so an unsupported transport refuses before a bad workspace path does (untested ordering).

- F6 (row 1.3): config-file selection lives in `runtime/paths.ts` (`resolveDefaultConfigPath`), not `infra/config/` as the row and brief said; the worker edited paths.ts with anchored changes while rows 1.4/1.2 edited the same file (planner splits by hunk). Three readers of config files do not see a project config: `cpm config` (`cli-shared/config-operations.ts`), the version-history scope (`cli-shared/version-history-scope.ts`) and the Python hooks resolve from the workspace only; `src/index.ts:593` probes the workspace files directly. Not in this slice; row 2.6 (backlog) added so the gap is a row, not prose.

- F5 (row 2.3): after the move, `rg creed-fidelity server/` still hits `resources/prompts/development/strategic_worker/prompt.yaml:55` (a `gateConfiguration.exclude` entry) and `resources/gates/math-fidelity/guidance.md:25` (prose). Ruled: both stay — in a project that ships the gate the exclude still keeps it off worker briefs, and bundled resources are edited through the MCP tools, not by hand. The row's artifact check is corrected to "no bundled gate FOLDER named creed-fidelity"; name-based readers were the pre-dispatch probe the row lacked.

- F4 (row 1.1, 2026-10-27): R2 as written could not hold. `resourceRootPrecedence` (`shared/utils/resource-root-lookup.ts`) ranks overlays above the primary and the prompt loader merges bundle → primary → overlays, so making the project the primary put the workspace above it; two precedence tests went red for exactly that. The plan assumed "primary reads first" from the `resolveResourceSubdir` docstring without probing the ordering function. Ruled R9; the planner's miss, not the worker's.

- F1 (row 2.4, 2026-10-27): the framework-removal coupling, re-measured. Behaviour sits at three places only: `SHIPPED_FRAMEWORK_IDS` in `server/src/engine/frameworks/definitions/shipped-frameworks.ts:34-35` (the registry fail-fast loads every shipped id, so the ids and the directories must go in one change), the `creed-fidelity` gate (`framework_context: [RADIANT]`, moving in 2.3), and the tests that load the bundle through `defaultFramework` (`tests/e2e/framework-selection-lifecycle.e2e.test.ts`, ~40 radiant-specific lines; `framework-guidance-filter.e2e.test.ts`; `tests/e2e/conformance/frameworks.yaml:26-33`; `tests/integration/tenant/workspace-continuity.test.ts:211,221`; `tests/unit/frameworks/framework-state-store.persistence.test.ts`; `tests/unit/frameworks/definitions/yaml-framework-loading.test.ts:29-30` guarded-id list). Everything else is prose: `docs/guides/frameworks.md:27-28,46,53`, `docs/architecture/overview.md:345`, the `config-file.ts:223` doc comment (regenerates `config.schema.json` and `config-template.ts`), and comments in `chain-operator-executor.ts:718`, `shipped-frameworks.ts:9,12`, `framework-lifecycle-processor.ts:818`, `validate-shipped-frameworks.ts:14`, `skills-sync/service.ts:799,802`, `strategic_worker/prompt.yaml:52`. Estimate: one atomic row (ids + directories + guarded list), then five independent rows (three test repoints, docs, schema comment + regenerate), six to eight rows in all. A user config with `defaultFramework: "RADIANT"` would break at load; what load does with an unknown default was not checked.
- F1a: R6's text overstated the skills-sync coupling (one comment and one hand-built fixture, no behaviour). Superseded here, R6 left as written in the plan with this pointer.
- F2 (row 2.4): stale prose found on the way: `docs/architecture/overview.md:345` lists six guides and omits RADIANT and VERIFY; `yaml-framework-loading.test.ts:23` says "The 7 frameworks" over a 7-entry list that excludes `verify`; `framework-lifecycle-processor.ts:818` has a doc comment whose `@returns` text is wrong.
- F3 (row 2.2): `docs/guides/cli.md` and `cli/README.md` document `cpm init ./my-workspace` but not `--project`; row 2.5 added.
