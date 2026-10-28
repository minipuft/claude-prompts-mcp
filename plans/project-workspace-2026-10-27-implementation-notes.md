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

(none yet)

## Findings

(none yet)
