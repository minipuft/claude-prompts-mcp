# Test Modernization Roadmap

> Status: Active | Created: 2025-12-13

Align test suite with modern professional standards (Stripe, React, AWS patterns).

---

## Current State

| Metric | Current | Target |
|--------|---------|--------|
| Test files | 67 | ~100 |
| Test cases | ~821 | ~1200 |
| Coverage type | Unit only | Unit + Integration + E2E |
| Coverage enforcement | None | 80% threshold |
| Subsystem coverage | 10/18 | 18/18 |

### Test Pyramid Status

```
Modern Standard:              Current State:
┌───────────────────┐         ┌───────────────────┐
│ E2E (~10%)        │         │                   │
├───────────────────┤         │                   │
│ Integration (~20%)│         │                   │
├───────────────────┤         ├───────────────────┤
│ Unit (~70%)       │         │ Unit (100%)       │
└───────────────────┘         └───────────────────┘
```

---

## Phase 1: Coverage Infrastructure

Enforce quality gates before expanding coverage.

### Tasks

- [ ] 1.1 Add coverage thresholds to `jest.config.cjs`
  ```javascript
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
  ```

- [ ] 1.2 Add coverage check to CI workflow
  - Location: `.github/workflows/ci.yml`
  - Run `npm run test:coverage` with threshold enforcement

- [ ] 1.3 Create test helper utilities
  - Location: `tests/helpers/`
  - Mock factories for common dependencies (Logger, GateManager, FrameworkManager)
  - Test fixture generators for prompts, chains, gates

- [ ] 1.4 Add integration/e2e test directories
  ```
  tests/
  ├── unit/           # Existing
  ├── integration/    # NEW
  └── e2e/            # NEW
  ```

- [ ] 1.5 Add npm scripts for test types
  ```json
  "test:integration": "jest tests/integration",
  "test:e2e": "jest tests/e2e",
  "test:all": "jest"
  ```

### Validation
```bash
npm run test:coverage
# Should enforce 80% thresholds
```

---

## Phase 2: Test Classification Audit & Migration

Analyze existing unit tests and migrate misclassified tests to proper locations.

### Classification Criteria

```
┌─────────────────────────────────────────────────────────────────────────┐
│ UNIT TEST                    │ INTEGRATION TEST    │ E2E TEST          │
├──────────────────────────────┼─────────────────────┼───────────────────┤
│ Single class/function        │ Multiple modules    │ Full system       │
│ All dependencies mocked      │ Real collaborators  │ Real transports   │
│ Tests behavior in isolation  │ Tests interactions  │ Tests from outside│
│ Fast, deterministic          │ May touch I/O       │ Full startup      │
└──────────────────────────────┴─────────────────────┴───────────────────┘
```

### Sub-Phase 2.1: Execution Tests Audit

Analyze `tests/unit/execution/` directory.

- [ ] 2.1.1 Audit `execution/parsing-system.test.ts`
  - **Current**: Tests `createParsingSystem()` factory with real parsers working together
  - **Classification**: ❌ Integration (tests CommandParser + ArgumentParser + ContextResolver)
  - **Action**: Move to `tests/integration/parsing/parsing-system.test.ts`

- [ ] 2.1.2 Audit `execution/pipeline/*.test.ts` (26 files)
  - Review each stage test for proper isolation
  - Identify tests that use real pipeline orchestration
  - **Known issues**:
    - `session-stage.test.ts` - May test session lifecycle (integration)
  - **Action**: Document findings, migrate as needed

- [ ] 2.1.3 Audit `execution/injection/*.test.ts` (4 files)
  - `condition-evaluator.test.ts` - Verify isolation
  - `injection-decision-service.test.ts` - Verify isolation
  - `hierarchy-resolver.test.ts` - Verify isolation
  - `session-overrides.test.ts` - Verify isolation

- [ ] 2.1.4 Audit `execution/parsers/*.test.ts` (5 files)
  - Verify each parser tested in isolation
  - Check for cross-parser dependencies

- [ ] 2.1.5 Audit `execution/operators/*.test.ts`
  - `chain-operator-executor.test.ts` - Check if tests full chain flow

### Sub-Phase 2.2: MCP Tools Tests Audit

Analyze `tests/unit/mcp-tools/` directory.

- [ ] 2.2.1 Audit `mcp-tools/consolidated-tools.test.ts`
  - **Current**: Tests PromptExecutionService + PromptManager + SystemControl factories
  - **Classification**: ❌ Integration (tests multiple MCP tool factories together)
  - **Action**: Move to `tests/integration/mcp-tools/tool-factories.test.ts`

- [ ] 2.2.2 Audit `mcp-tools/prompt-engine/*.test.ts` (5 files)
  - `request-validator.test.ts` - Verify isolation
  - `prompt-engine-guide.test.ts` - Verify isolation
  - `prompt-engine-validation.test.ts` - Verify isolation
  - `engine-validator.test.ts` - Verify isolation
  - `response-formatter.test.ts` - Verify isolation

- [ ] 2.2.3 Audit `mcp-tools/prompt-manager/*.test.ts`
  - `guide-action.test.ts` - Verify isolation

- [ ] 2.2.4 Audit `mcp-tools/system-control/*.test.ts`
  - `guide-action.test.ts` - Verify isolation

- [ ] 2.2.5 Audit `mcp-tools/tool-routing.test.ts`
  - Check if tests routing in isolation or full request flow

### Sub-Phase 2.3: Runtime Tests Audit

Analyze `tests/unit/runtime/` directory.

- [ ] 2.3.1 Audit `runtime/application-startup.test.ts`
  - **Current**: Tests Application + PromptAssetManager load flow
  - **Classification**: ❌ Integration (tests multi-phase startup)
  - **Action**: Move to `tests/integration/runtime/application-startup.test.ts`

- [ ] 2.3.2 Audit `runtime/application-health.test.ts`
  - **Current**: Tests Application diagnostic/health flow
  - **Classification**: ❌ Integration (tests cross-module health checks)
  - **Action**: Move to `tests/integration/runtime/application-health.test.ts`

### Sub-Phase 2.4: Chain Session Tests Audit

Analyze `tests/unit/chain-session/` directory.

- [ ] 2.4.1 Audit `chain-session/chain-session-manager.test.ts`
  - **Current**: Tests ChainSessionManager with mocked I/O
  - **Classification**: ⚠️ Borderline (mostly unit, some lifecycle tests)
  - **Action**: Split - keep unit tests, move lifecycle tests to integration

### Sub-Phase 2.5: Gates Tests Audit

Analyze `tests/unit/gates/` directory.

- [ ] 2.5.1 Audit `gates/core/*.test.ts` (2 files)
  - `gate-loader.test.ts` - Verify isolation
  - `review-utils.test.ts` - Check for `.metadata.` implementation detail tests

- [ ] 2.5.2 Audit `gates/services/*.test.ts`
  - `gate-services.test.ts` - Verify service isolation

- [ ] 2.5.3 Audit `gates/guidance/*.test.ts` (2 files)
  - `gate-guidance-renderer.test.ts` - Verify isolation
  - `framework-guidance-filter.test.ts` - Verify isolation

- [ ] 2.5.4 Audit `gates/gate-review-session-continuity.test.ts`
  - Check if tests session continuity (integration behavior)

### Sub-Phase 2.6: Frameworks Tests Audit

Analyze `tests/unit/frameworks/` directory.

- [ ] 2.6.1 Audit `frameworks/methodology/*.test.ts`
  - `yaml-methodology-loading.test.ts` - Check for file I/O integration

- [ ] 2.6.2 Audit `frameworks/framework-validator.test.ts`
  - Verify tests validator in isolation

- [ ] 2.6.3 Audit `frameworks/stages/*.test.ts`
  - Check stage tests for proper isolation

### Sub-Phase 2.7: Other Directories Audit

- [ ] 2.7.1 Audit `prompts/hot-reload-auxiliary.test.ts`
  - Check if tests hot-reload behavior (integration)

- [ ] 2.7.2 Audit `semantic/semantic-analyzer.test.ts`
  - Verify analyzer tested in isolation

- [ ] 2.7.3 Audit `text-references/*.test.ts` (2 files)
  - `text-reference-manager.test.ts` - Verify isolation
  - `argument-history-tracker.test.ts` - Verify isolation

- [ ] 2.7.4 Audit `utils/argument-validation-error.test.ts`
  - Should be pure unit test

### Sub-Phase 2.8: Execute Migration

After audit completion, migrate identified files.

- [ ] 2.8.1 Create integration test directories
  ```
  tests/integration/
  ├── parsing/
  ├── mcp-tools/
  ├── runtime/
  ├── chains/
  └── pipeline/
  ```

- [ ] 2.8.2 Move misclassified tests (confirmed list)
  | From | To |
  |------|-----|
  | `unit/execution/parsing-system.test.ts` | `integration/parsing/parsing-system.test.ts` |
  | `unit/mcp-tools/consolidated-tools.test.ts` | `integration/mcp-tools/tool-factories.test.ts` |
  | `unit/runtime/application-startup.test.ts` | `integration/runtime/application-startup.test.ts` |
  | `unit/runtime/application-health.test.ts` | `integration/runtime/application-health.test.ts` |

- [ ] 2.8.3 Update imports in migrated files
  - Fix relative paths after move
  - Verify tests still pass

- [ ] 2.8.4 Document migration decisions
  - Update `tests/README.md` with classification guidelines
  - Record borderline decisions and rationale

### Validation
```bash
npm run test:unit        # Only true unit tests
npm run test:integration # Migrated integration tests
npm run test:all         # All tests pass
```

---

## Phase 3: Missing Unit Test Coverage

Fill gaps in subsystem unit test coverage.

### Priority 1 - Critical Systems (No Tests)

- [ ] 3.1 `tests/unit/server/` - Transport layer
  - `transport-manager.test.ts` - STDIO/SSE initialization
  - `stdio-transport.test.ts` - STDIO message handling
  - `sse-transport.test.ts` - SSE connection handling

- [ ] 3.2 `tests/unit/api/` - Express routes
  - `routes.test.ts` - Health endpoints, SSE endpoints
  - `middleware.test.ts` - Error handling, request parsing

- [ ] 3.3 `tests/unit/styles/` - Style system
  - `style-manager.test.ts` - Style loading, selection
  - `style-definition-loader.test.ts` - YAML parsing
  - `style-hot-reload.test.ts` - Hot reload behavior

### Priority 2 - Supporting Systems

- [ ] 3.4 `tests/unit/core/` - Resource manager
  - `resource-manager.test.ts` - Unified CRUD operations

- [ ] 3.5 `tests/unit/metrics/` - Analytics
  - `analytics-service.test.ts` - Metric collection

- [ ] 3.6 `tests/unit/performance/` - Performance monitoring
  - `monitor.test.ts` - Performance tracking

- [ ] 3.7 `tests/unit/logging/` - Logging subsystem
  - `logger.test.ts` - Log level handling, formatting

- [ ] 3.8 `tests/unit/tooling/` - Contract generation
  - `generate-contracts.test.ts` - Schema generation validation

### Validation
```bash
npm run test:coverage
# Verify new subsystems included in coverage report
```

---

## Phase 4: Integration Tests

Test cross-module interactions (in addition to migrated tests from Phase 2).

### Tasks

- [ ] 4.1 MCP Protocol Integration
  - Location: `tests/integration/mcp-protocol/`
  - `tool-call-flow.test.ts` - Request → Handler → Response
  - `prompt-engine-flow.test.ts` - Command → Pipeline → Output
  - `framework-switch-flow.test.ts` - Switch → State persist → Tool update

- [ ] 4.2 Chain Execution Integration
  - Location: `tests/integration/chains/`
  - `chain-session-lifecycle.test.ts` - Create → Execute → Resume → Complete
  - `chain-gate-integration.test.ts` - Chain steps with gate validation
  - `chain-framework-integration.test.ts` - Chain with framework context

- [ ] 4.3 Hot Reload Integration
  - Location: `tests/integration/hot-reload/`
  - `prompt-hot-reload.test.ts` - File change → Registry update
  - `gate-hot-reload.test.ts` - Gate YAML change → Manager update
  - `methodology-hot-reload.test.ts` - Methodology change → Framework update

- [ ] 4.4 Pipeline Integration
  - Location: `tests/integration/pipeline/`
  - `full-pipeline-execution.test.ts` - Stage 00 → Stage 11 flow
  - `gate-enforcement-flow.test.ts` - Gate selection → Validation → Verdict

### Validation
```bash
npm run test:integration
# All integration tests pass
```

---

## Phase 5: E2E Tests

Test full MCP server behavior.

### Tasks

- [ ] 5.1 STDIO Transport E2E
  - Location: `tests/e2e/stdio/`
  - `server-startup.test.ts` - Server initializes correctly
  - `tool-list.test.ts` - MCP tools/list response correct
  - `prompt-execution.test.ts` - Full prompt execution cycle

- [ ] 5.2 SSE Transport E2E
  - Location: `tests/e2e/sse/`
  - `connection-lifecycle.test.ts` - Connect → Messages → Disconnect
  - `concurrent-requests.test.ts` - Multiple simultaneous requests

- [ ] 5.3 MCP Compliance E2E
  - Location: `tests/e2e/compliance/`
  - `protocol-version.test.ts` - Correct MCP version negotiation
  - `error-responses.test.ts` - Proper error format per MCP spec
  - `tool-schema-validation.test.ts` - Tool schemas match declared

### Validation
```bash
npm run test:e2e
# All E2E tests pass
```

---

## Phase 6: Test Quality Improvements

Align with professional quality patterns from CLAUDE.md.

### Tasks

- [ ] 6.1 Remove implementation detail tests
  - Audit tests checking `.metadata.` internal fields
  - Replace with behavior-focused assertions

- [ ] 6.2 Consolidate fragmented tests
  - Identify test files with < 3 test cases
  - Merge into comprehensive integration tests where appropriate

- [ ] 6.3 Add migration path tests
  - Test deprecated parameter warnings
  - Test backward compatibility (e.g., `methodology` → `type`)

- [ ] 6.4 Add performance regression tests
  - Pipeline execution time bounds
  - Hot reload latency bounds

- [ ] 6.5 Document test patterns
  - Location: `tests/README.md`
  - Mock factory usage
  - Integration test setup patterns
  - E2E test configuration

### Validation
```bash
npm run test:all
npm run test:coverage
# 80% threshold met, all quality patterns followed
```

---

## Files to Create (Summary)

### New Directories
```
tests/
├── integration/
│   ├── mcp-protocol/
│   ├── chains/
│   ├── hot-reload/
│   └── pipeline/
├── e2e/
│   ├── stdio/
│   ├── sse/
│   └── compliance/
└── helpers/
    └── factories/
```

### New Unit Test Files (~15)
- `tests/unit/server/transport-manager.test.ts`
- `tests/unit/server/stdio-transport.test.ts`
- `tests/unit/server/sse-transport.test.ts`
- `tests/unit/api/routes.test.ts`
- `tests/unit/api/middleware.test.ts`
- `tests/unit/styles/style-manager.test.ts`
- `tests/unit/styles/style-definition-loader.test.ts`
- `tests/unit/styles/style-hot-reload.test.ts`
- `tests/unit/core/resource-manager.test.ts`
- `tests/unit/metrics/analytics-service.test.ts`
- `tests/unit/performance/monitor.test.ts`
- `tests/unit/logging/logger.test.ts`
- `tests/unit/tooling/generate-contracts.test.ts`

### New Integration Test Files (~10)
- `tests/integration/mcp-protocol/tool-call-flow.test.ts`
- `tests/integration/mcp-protocol/prompt-engine-flow.test.ts`
- `tests/integration/mcp-protocol/framework-switch-flow.test.ts`
- `tests/integration/chains/chain-session-lifecycle.test.ts`
- `tests/integration/chains/chain-gate-integration.test.ts`
- `tests/integration/hot-reload/prompt-hot-reload.test.ts`
- `tests/integration/hot-reload/gate-hot-reload.test.ts`
- `tests/integration/pipeline/full-pipeline-execution.test.ts`
- `tests/integration/pipeline/gate-enforcement-flow.test.ts`

### New E2E Test Files (~6)
- `tests/e2e/stdio/server-startup.test.ts`
- `tests/e2e/stdio/tool-list.test.ts`
- `tests/e2e/stdio/prompt-execution.test.ts`
- `tests/e2e/sse/connection-lifecycle.test.ts`
- `tests/e2e/compliance/protocol-version.test.ts`
- `tests/e2e/compliance/error-responses.test.ts`

---

## Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Infrastructure | ⏳ Pending | Coverage thresholds, CI integration |
| Phase 2: Audit & Migration | ⏳ Pending | 8 sub-phases, ~67 tests to audit |
| Phase 3: Unit Coverage | ⏳ Pending | ~15 new test files |
| Phase 4: Integration | ⏳ Pending | ~10 new test files (+ migrated) |
| Phase 5: E2E | ⏳ Pending | ~6 new test files |
| Phase 6: Quality | ⏳ Pending | Refactoring, documentation |

---

## Success Criteria

- [ ] Coverage thresholds enforced in CI (80%)
- [ ] All existing tests audited and properly classified
- [ ] Misclassified tests migrated to correct directories
- [ ] All 18 source subsystems have test coverage
- [ ] Integration tests cover MCP protocol, chains, hot-reload, pipeline
- [ ] E2E tests validate STDIO/SSE transports
- [ ] Test patterns documented in `tests/README.md`
- [ ] ~1200 test cases total (up from ~821)

---

*Created: 2025-12-13*
