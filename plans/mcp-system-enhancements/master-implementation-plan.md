# MCP System Enhancements - Implementation Plan

## Overview

**Feature**: Enhance MCP with reliable workflows, gate strategies, prompt separation, and template responses.
**Total Phases**: 5
**Estimated Timeline**: 3-4 sprints (assuming 2-week cycles).

## Phase Breakdown

### Phase 1: Define Canonical Workflow Object

**Objective**: Create Workflow object with steps, tools, dependencies, retries; ensure deterministic ordering across runtimes.

**Impacted Paths & Modules**:

- `server/src/types/index.ts` - Extend ExecutionMode and add Workflow types.
- `server/src/prompts/index.ts` - Integrate workflow parsing.
- `server/src/orchestration/index.ts` - Update orchestrator for workflow init.

**Key Tasks**:

- [ ] Define Workflow interface in types with steps array, dependency graph (adjacency list), retry policies.
- [ ] Implement deterministic execution engine using topological sort for ordering.
- [ ] Add runtime-agnostic gating logic (desktop/CLI/server) via abstract executor class.
- [ ] Testing: Unit tests for workflow parsing and ordering.
- [ ] Documentation: Update docs/chain-execution-guide.md with workflow spec.

**Exit Criteria**:

- [ ] Workflow objects parse/execute deterministically in tests (≥90% coverage).
- [ ] No runtime-specific ordering discrepancies.
- [ ] Lighthouse perf ≥95; ESLint zero warnings.

**Dependencies**: tech-stack.mdc (TypeScript/Zod for validation).
**Risk Level**: Medium - Dependency graph complexity; mitigate with graph lib if needed.

### Phase 2: Catalog and Standardize Gates

**Objective**: Inventory gates, standardize hinting, embed metadata in prompts.

**Impacted Paths & Modules**:

- `server/src/types/index.ts` - Add Gate types and metadata interfaces.
- `server/src/prompts/index.ts` - Embed gate YAML/JSON in prompt front-matter.
- `server/src/server/index.ts` - Update executor for gate hinting/next-actions.

**Key Tasks**:

- [ ] Catalog existing gates (auth/role/quota/safety) in new GateRegistry class.
- [ ] Standardize hint format (e.g., JSON {hints: [], nextActions: []}).
- [ ] Modify prompt loader to parse/embed gate metadata as front-matter.
- [ ] Testing: Integration tests for gate evaluation and hint surfacing.
- [ ] Documentation: Add docs/gate-validation-guide.md section on hinting.

**Exit Criteria**:

- [ ] All gates cataloged; hints surface correctly in ≥95% test cases.
- [ ] Prompt metadata validates via Zod schemas.
- [ ] Security checks pass (no vuln intros).

**Dependencies**: Phase 1 (for workflow integration).
**Risk Level**: Low - Builds on existing gate system.

### Phase 3: Implement Prompt Envelope

**Objective**: Create explicit envelope structure; add adapters for section management.

**Impacted Paths & Modules**:

- `server/src/prompts/index.ts` - Add envelope parser/builder.
- `server/src/transport/index.ts` - Implement adapters for desktop/CLI injection.
- `server/src/types/index.ts` - Define Envelope interface {system, workflow, user}.

**Key Tasks**:

- [ ] Define envelope schema with distinct sections.
- [ ] Create adapters to inject/omit system section based on runtime.
- [ ] Update context builder to construct windows consistently.
- [ ] Testing: End-to-end tests for envelope across runtimes.
- [ ] Documentation: Update docs/prompt-format-guide.md with envelope spec.

**Exit Criteria**:

- [ ] Envelopes process correctly in all runtimes; no muddled starts.
- [ ] Unit tests ≥90% coverage; perf within budgets.
- [ ] Manual QA confirms section separation.

**Dependencies**: Phases 1-2.
**Risk Level**: Medium - Runtime adapter complexity; test thoroughly.

### Phase 4: Define Template Response Schema

**Objective**: Create schema; ensure server returns templates; publish hydration lib.

**Impacted Paths & Modules**:

- `server/src/types/index.ts` - Define TemplateResponse schema.
- `server/src/server/index.ts` - Modify response handler to return templates.
- New: `packages/template-runner/` - Create @mcp/template-runner lib.

**Key Tasks**:

- [ ] Define schema with placeholders, fields, types; version it.
- [ ] Update server to return template bodies only (no prose).
- [ ] Implement hydration lib for client-side rendering.
- [ ] Testing: Schema validation tests; lib integration tests.
- [ ] Documentation: Add docs/response-schema.md.

**Exit Criteria**:

- [ ] Server returns valid templates; lib hydrates correctly.
- [ ] Version mismatches flagged; tests ≥90% coverage.
- [ ] Bundle size impact <10% increase.

**Dependencies**: Phase 3.
**Risk Level**: Low - Schema-based; use Zod for validation.

### Phase 5: Integration and Observability

**Objective**: Add timeouts/cancellation/hooks; integrate all features; test holistically.

**Impacted Paths & Modules**:

- `server/src/orchestration/index.ts` - Add workflow-level hooks/timeouts.
- `server/src/server/index.ts` - Implement cancellation in executor.
- `server/src/logging/index.ts` - Enhance for observability.

**Key Tasks**:

- [ ] Add workflow timeouts, cancellation signals, observability events.
- [ ] Integrate all phases into core execution flow.
- [ ] Comprehensive testing: E2E scenarios for workflows/gates/envelopes/templates.
- [ ] Documentation: Update user-flow.mdc with new journeys.

**Exit Criteria**:

- [ ] Full integration passes E2E tests (≥95% success rate).
- [ ] Observability logs capture all events; timeouts work as expected.
- [ ] Final manual QA; security/privacy mandates met.

**Dependencies**: Phases 1-4.
**Risk Level**: High - System-wide integration; mitigate with staged rollout.

---

## Risks & Dependencies

### External Dependencies

- **APIs**: Claude AI integration for testing.
- **Design**: Schema approvals if needed.

### Internal Dependencies

- **Library Additions**: Zod for schemas (already approved).
- **Architectural Changes**: Extends existing executor/orchestrator.
- **Team Coordination**: Review for runtime adapters.

### Risk Mitigation

- **High Risk**: Integration testing harness for E2E validation.
- **Blockers**: Early Phase 1 prototyping to catch graph issues.
- **Rollback**: Modular changes allow per-phase reversion.

---

## Implementation Notes

### Reuse Opportunities

- **Existing Patterns**: Extend PromptExecutor for workflows; reuse Zod for validation.
- **Shared Utilities**: Use existing logging for observability.
- **Design System**: N/A (backend focus).

### New Patterns Introduced

- **Component Architecture**: Workflow graph execution engine.
- **Data Flow**: Envelope-based prompt construction.
- **Testing Approach**: Runtime-specific E2E suites.

### Performance Considerations

- **Bundle Impact**: Minimal; monitor with npm audits.
- **Runtime Performance**: Timeouts prevent hangs.
- **Caching Strategy**: Cache workflow graphs post-parsing.

**Plan Metadata**:

- **Confidence Level**: 0.85
- **Complexity Assessment**: Complex
- **Resource Requirements**: 15-20 developer-days
- **Critical Path**: Phases 1 and 5 (core execution changes)

<details>
<summary>Planning Methodology & Decisions</summary>

**Architecture Analysis**: Builds on existing types/orchestrator; respects file-based storage.
**Phase Strategy**: Aligned to query sections for logical progression.
**Dependency Management**: Sequential phases minimize blockers.
**Risk Assessment**: High-risk areas get extra testing; uses approved stack.
**Technology Choices**: Zod for schemas ensures type-safety.

</details>
