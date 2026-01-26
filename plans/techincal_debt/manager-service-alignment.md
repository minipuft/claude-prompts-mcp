# Manager/Service Alignment Roadmap

**Status**: Proposed
**Created**: 2026-01-26
**Owner**: MCP Tooling
**Scope**: Align manager/tool surfaces with the PromptResourceService service-first pattern.

## Current State
- Tool layer:
  - `ConsolidatedGateManager` (fat facade; CRUD + validation + file ops mixed)
  - `ConsolidatedFrameworkManager` (fat facade; validation + filesystem + orchestration mixed)
- Orchestrators:
  - `mcp-tools/system-control.ts` monolith (size violation)
  - `prompt-engine/core/prompt-execution-service.ts` oversized orchestrator
- Domain managers:
  - `GateManager`, `FrameworkManager`, `StyleManager` extend `BaseResourceManager`
  - Consistent registry pattern but not service-decomposed

## Issues
- Orchestration layers exceed size limits and mix responsibilities.
- Tool-layer managers duplicate logic (versioning, diff, file ops).
- Service pattern inconsistent vs `PromptResourceService`.

## Target Pattern (Canonical)
- Thin orchestrators (<=150 lines) + modular services.
- Constructor DI + shared context objects.
- CRUD logic extracted to lifecycle services.
- File ops isolated in operations modules.
- Tool responses formatted in dedicated response builders.

## Refactor Targets
1) Tool layer (priority)
   - Gate: split into GateLifecycleService, GateDiscoveryService, GateVersioningService, GateFileOperations.
   - Framework: split into FrameworkLifecycleService, MethodologyValidationService, FrameworkVersioningService, FrameworkFileOperations.
2) Orchestrators (follow-up)
   - Decompose `system-control.ts` handlers into separate modules.
   - Extract pipeline assembly from `PromptExecutionService` into a factory/builder.
3) Domain managers (optional)
   - Evaluate splitting Gate/Framework/Style managers only if registry size keeps growing.

## Dependencies / Prereqs
- Test modernization roadmap: integration coverage for new services.
- Type safety cleanup in prompt-engine + chain-session.

## Validation Gates
- `npm run typecheck`
- `npm run lint:ratchet`
- `npm run test:ci`
- Optional: `npm run validate:filesize`

## Milestones
- M1: Tool-layer extraction (Gate + Framework)
- M2: system_control handler decomposition
- M3: prompt-engine pipeline builder extraction
