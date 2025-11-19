# Lifecycle Annotation Expansion Plan

**Created:** 2025-XX-XX  
**Owner:** Runtime integrity & guardrails working group  
**Status:** Draft – walkthrough for rolling the lifecycle ESLint enforcement to the remaining subsystems (frameworks, execution, runtime, MCP tools, semantic stack).

## Background & Goals

We recently introduced a local ESLint plugin (`lifecycle/no-legacy-imports`, `lifecycle/require-file-lifecycle`) and annotated every gate module with `@lifecycle canonical|migrating`. This plan expands the same enforcement to the rest of the codebase so we have consistent guardrails for future migrations.

Primary objectives:

1. Require explicit lifecycle annotations for every canonical subsystem so reviewers can see whether a file is safe to depend on without digging through docs.
2. Block imports from paths that are marked `legacy` or explicitly listed as deprecated.
3. Keep the Baselining & Guardrails record accurate by updating component tables and validation notes with every phase.
4. Ensure each phase ends with removal/cleanup tasks when a subsystem finishes its migration (`legacy` → `removed`, `migrating` → `canonical`).

## Scope

Lifecycle annotations + ESLint enforcement will cover the following directories:

| Subsystem | Path(s) | Expected Lifecycle Mix |
| --- | --- | --- |
| Framework orchestration | `server/src/frameworks/**` (manager, state manager, methodology guides, integrations, prompt guidance, types) | Mostly canonical; some integration shims may remain `migrating` until semantic wiring lands. |
| Execution pipeline | `server/src/execution/**` (context, parsers, operators, pipeline stages) | Canonical except for any legacy parser shims that are pending removal. |
| Chain session lifecycle | `server/src/chain-session/**` (session manager, persistence, lifecycle promotion flows) | Canonical; ensure lifecycle rules block new consumers from relying on untracked session storage helpers. |
| Runtime + transports | `server/src/runtime/**`, `server/src/server/**`, `server/src/logging/**`, `server/src/api/**` | Canonical; annotate long-tail bootstrap utilities. |
| MCP tools | `server/src/mcp-tools/**` (prompt engine, manager, system control, prompt engine processors) | Mix of canonical and migrating (e.g., semantic gate service). |
| Semantic + analysis services | `server/src/semantic/**`, `server/src/performance/**`, `server/src/metrics/**`, `server/src/text-references/**` | Canonical with some `migrating` modules for LLM integrations. |
| Registry/prompts support | `server/src/prompts/**`, `server/src/config/**`, `server/src/types.ts`, `server/src/types/**` | Canonical across hot-reload + config utilities; shared type exports must stay annotated so downstream packages know their lifecycle. |

Out of scope for now: `tests/**/*` (annotations optional) and generated artifacts in `dist/`.

## Implementation Phases

### Phase 1 – Frameworks & Prompt Guidance

1. Catalog every TypeScript file under `server/src/frameworks/**` and assign lifecycle status (canonical, migrating). Document any true legacy files and plan for deletion.
2. Update `server/eslint.config.js` to apply `lifecycle/require-file-lifecycle` to the framework directories in addition to `src/gates/**`.
3. Add `// @lifecycle <status> - <short context>` comments to each framework file.
4. Update `plans/baselining-and-guardrails.md` with the new lifecycle snapshot and any migrating items that still block canonicalization.
5. Validation: `npm run lint`, `npm run validate:lint`, targeted smoke tests for framework switching (`npm run start:stdio -- --framework <x>`).

**Exit criteria:** No framework file missing an annotation; ESLint rule covers the directory; migrating list documented with removal plans.

### Phase 2 – Execution Pipeline & Runtime Core

1. Enumerate files under `server/src/execution/**`, `server/src/runtime/**`, `server/src/server/**`, and `server/src/chain-session/**` to assign lifecycle tags.
2. Expand the ESLint config block to include these globs.
3. Annotate the files (context builders, parsers, operators, pipeline stages, `runtime/application.ts`, transport adapters, logging entrypoints).
4. Remove any stale `legacy` files surfaced during the sweep or add TODOs + follow-up plan entries if deletion requires wider coordination.
5. Validation: `npm run lint`, `npm run typecheck`, run `npm run start:stdio` + `npm run start:sse` smoke tests to catch startup regressions.

**Exit criteria:** Every execution/runtime file has a lifecycle comment, `lifecycle/no-legacy-imports` continues to pass, and any discovered legacy modules are either deleted or tracked with removal blockers.

### Phase 3 – MCP Tools & Semantic/Analysis Services

1. Apply the ESLint annotation rule to `server/src/mcp-tools/**`, `server/src/semantic/**`, `server/src/performance/**`, `server/src/metrics/**`, and `server/src/text-references/**`.
2. Annotate the files with canonical/migrating statuses; for modules that are still experimental (e.g., semantic gate service wiring), document the guard condition required for canonicalization.
3. Ensure `server/scripts/validate-dependencies.js` is updated to reflect any renamed or fully removed files uncovered during the sweep so dependency validation stays accurate.
4. Validation: `npm run lint`, `npm run validate:dependencies`, targeted Jest suites touching MCP tools if available.

**Exit criteria:** All MCP/semantic modules carry lifecycle metadata, dependency validation knows about any new canonical files, and follow-up tasks exist for the few remaining migrating paths.

### Phase 4 – Prompts, Config, and Supporting Utilities

1. Decide whether `prompts/**`, `config/**`, `utils/**`, and any remaining shared helper directories outside the earlier phases require lifecycle annotations or if documentation is sufficient. If yes, add them to the ESLint glob (text references are already handled in Phase 3).
2. Annotate the selected directories and update README/docs with a short note explaining how lifecycle data applies to prompt infrastructure.
3. Validation: `npm run lint`, `npm run format`, prompt hot-reload smoke test (`npm run dev` + modify a prompt) to confirm annotations did not break watchers.

**Exit criteria:** Either fully annotated or explicitly documented as out-of-scope with justification. No untracked directories remain.

## Validation Checklist (Per Phase)

- `npm run lint` (ensures lifecycle plugin + strict rules pass)
- `npm run validate:lint` (format + lint bundle)
- `npm run validate:all` (dependency + circular guardrails)
- `npm run typecheck`
- Targeted runtime smoke tests (`npm run start:stdio`, `npm run start:sse`) when touching execution/runtime/transport.
- Update `plans/baselining-and-guardrails.md` with lifecycle deltas before marking the phase complete.

## Migration Closeout Tasks

- Remove any `legacy`/deprecated files immediately once their canonical replacements are annotated and validated.
- When a `migrating` component becomes stable, update its annotation + Baselining plan entry and delete intermediate shims or flags.
- Add ESLint tests (if needed) to fail CI when directories exceed the agreed-upon 500-line limit once that validator ships.
- Ensure the lifecycle plugin’s glob list stays in sync with the directory structure; add regression tests or CI checks as part of Phase 3 if feasible.

## Open Questions / Follow-Ups

1. Do we need a machine-readable manifest (JSON/YAML) for lifecycle statuses to feed tooling beyond ESLint? (Future work)
2. Should tests be annotated as well, or is documentation sufficient? (Decide after Phase 2.)
3. When the semantic gate service ships, update this plan to include the guard condition removal checklist.
