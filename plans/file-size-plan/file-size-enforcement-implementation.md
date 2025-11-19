# File Size Enforcement - Implementation Plan

**Status**: Phase 1-4 Complete (Validation Infrastructure), Phase 5 Pending (Migration)
**Created**: 2025-11-15
**Last Updated**: 2025-11-15
**Target Completion**: Q3 2025

## Executive Summary

This document outlines the implementation plan for enforcing the 500-line module boundary standard defined in REFACTORING.md. The implementation is divided into five phases:

1. **✅ Phase 1**: Validation Infrastructure (Complete)
2. **✅ Phase 2**: CI/CD Integration (Complete)
3. **✅ Phase 3**: NPM Scripts & Automation (Complete)
4. **✅ Phase 4**: Documentation & Baseline (Complete)
5. **⏳ Phase 5**: Progressive Migration (In Progress)

## Implementation Status

### Phase 1: Validation Infrastructure ✅ COMPLETE

**Goal**: Create automated file size validation script

**Status**: Complete - `server/scripts/validate-filesize.js` implemented

**Features Implemented**:
- ✅ Recursive TypeScript file scanning in `/server/src`
- ✅ Exclusion of test files (`*.test.ts`, `tests/**`)
- ✅ Exclusion of generated files (`dist/**`, `node_modules/**`)
- ✅ Line counting with accurate reporting
- ✅ `@lifecycle canonical` annotation detection
- ✅ Grandfathered file exemption system (32 files)
- ✅ Clear violation reporting with actionable feedback
- ✅ Exit code handling (0 = success, 1 = new violations)
- ✅ Emoji-based status indicators
- ✅ Detailed statistics and categorization

**Key Implementation Details**:

```javascript
// Configuration
const HARD_LIMIT = 500;      // Maximum lines per file
const SOFT_LIMIT = 300;      // Target for new code
const SRC_DIR = path.join(__dirname, '..', 'src');

// Grandfathered files (32 current violators)
const GRANDFATHERED_FILES = [
  'mcp-tools/system-control.ts',  // 2716 lines
  'mcp-tools/prompt-engine/core/engine.ts',  // 2342 lines
  // ... 30 more files
];
```

**Validation Logic**:
1. Scan all `.ts` files in `src/` (exclude tests and generated files)
2. Count lines per file
3. Check for violations (>500 lines)
4. Categorize violations:
   - **New Violations**: No exemption (BLOCKS)
   - **Grandfathered**: Temporary exemption (ALLOWED)
   - **Canonical**: Has `@lifecycle canonical` annotation (ALLOWED)
5. Report statistics and exit with appropriate code

### Phase 2: CI/CD Integration ✅ COMPLETE

**Goal**: Integrate file size validation into GitHub Actions workflows

**Status**: Complete - Integrated into `ci.yml` and `pr-validation.yml`

**Changes Made**:

**`.github/workflows/ci.yml`** (line 61-64):
```yaml
- name: File size enforcement
  working-directory: server
  run: npm run validate:filesize
  continue-on-error: true  # Warning only, doesn't block CI
```

**`.github/workflows/pr-validation.yml`** (line 55-58):
```yaml
- name: File size enforcement
  working-directory: server
  run: npm run validate:filesize
  continue-on-error: true  # Warning only, doesn't block PR
```

**Integration Points**:
- ✅ Added after "Build project" step
- ✅ Before "Security audit" step
- ✅ Uses `continue-on-error: true` for soft enforcement (warning-level)
- ✅ Runs on all pushes to main/develop branches
- ✅ Runs on all pull requests

**Future Enforcement Transition**:
- **Q1 2025**: Keep warning-level (current)
- **Q2 2025**: Switch to error-level for new violations only (remove `continue-on-error`)
- **Q3 2025**: Enforce globally (remove all grandfathered exemptions)

### Phase 3: NPM Scripts & Automation ✅ COMPLETE

**Goal**: Add npm scripts for local validation

**Status**: Complete - Scripts added to `package.json`

**Changes Made**:

```json
{
  "scripts": {
    "validate:filesize": "node scripts/validate-filesize.js",
    "validate:all": "npm run validate:dependencies && npm run validate:circular && npm run validate:filesize"
  }
}
```

**Usage**:

```bash
# Check file size compliance
npm run validate:filesize

# Run all validation checks
npm run validate:all

# Pre-commit validation
npm run lint && npm run typecheck && npm run validate:all
```

**Integration with Existing Workflows**:
- ✅ Added to `validate:all` command (alongside dependency and circular checks)
- ✅ Can be run independently via `validate:filesize`
- ✅ Integrated into development workflow recommendations

### Phase 4: Documentation & Baseline ✅ COMPLETE

**Goal**: Document standards, create baseline report, update contributing guidelines

**Status**: Complete - All documentation updated

**Deliverables**:

**4.1 Baseline Report** (`/plans/file-size-baseline.md`):
- ✅ Current violation statistics (32 files, 22.9% of codebase)
- ✅ Categorized violations by severity (Tier 1-5)
- ✅ Subsystem-level decomposition roadmap
- ✅ Quarterly migration goals (Q1-Q3 2025)
- ✅ Success metrics and validation process

**4.2 Contributing Guidelines** (`/docs/contributing.md`):
- ✅ File Size Standards section added
- ✅ Hard limit (500 lines), soft target (300 lines) documented
- ✅ Exemption process explained
- ✅ Canonical annotation example provided
- ✅ Decomposition strategies outlined
- ✅ Validation commands table updated

**4.3 Implementation Plan** (this document):
- ✅ Complete implementation roadmap
- ✅ Phase-by-phase tracking
- ✅ Subsystem decomposition guides
- ✅ File-by-file migration strategies
- ✅ Timeline and resource estimates

### Phase 5: Progressive Migration ⏳ IN PROGRESS

**Goal**: Decompose all 32 violating files to meet 500-line standard

**Status**: Planning - Migration begins Q1 2025

**Migration Strategy**: Follow [file-size-baseline.md](./file-size-baseline.md) roadmap

**Quarterly Goals**:

**Q1 2025** (3 files, Tier 1 violations):
- [ ] Decompose `mcp-tools/system-control.ts` (2,716 lines → <500 lines)
  - Strategy: Extract into separate service controllers (framework, analytics, health, config)
  - Estimated effort: 20-25 hours
  - Priority: P0 - Critical
- [ ] Decompose `mcp-tools/prompt-engine/core/engine.ts` (2,342 lines → <500 lines)
  - Strategy: Split into focused executors (template processor, gate validator, response formatter, error handler)
  - Estimated effort: 15-20 hours
  - Priority: P0 - Critical
- [ ] Decompose `mcp-tools/index.ts` (1,486 lines → <500 lines)
  - Strategy: Split into domain-specific tool registries
  - Estimated effort: 10-12 hours
  - Priority: P0 - Critical

**Q2 2025** (14 files, Tier 2-3 violations):
- [ ] Refactor Frameworks subsystem (11 files)
  - Extract common methodology guide utilities
  - Refactor template-enhancer.ts (service-oriented decomposition)
  - Simplify framework-semantic integration
  - Estimated effort: 35-50 hours
- [ ] Refactor Execution subsystem (4 files)
  - Extract parsing strategies from argument-parser
  - Refactor command parser with operator-specific parsers
  - Simplify context resolver
  - Estimated effort: 25-35 hours

**Q3 2025** (15 files, Tier 4-5 violations):
- [ ] Refactor remaining violators (runtime, metrics, chain session, semantic, prompts, utilities)
- [ ] Add `@lifecycle canonical` annotations where appropriate
- [ ] Remove all grandfathered exemptions
- [ ] Achieve 100% compliance (zero violations)

## Subsystem Decomposition Guides

### MCP Tools Subsystem

**Scope**: 6 files, 8,507 total lines, 3 critical violators

**Priority 1: system-control.ts** (2,716 lines)

**Current State**:
- Monolithic MCP tool handling framework management, analytics, health monitoring, configuration
- Contains multiple functional areas mixed together
- Difficult to test and maintain

**Decomposition Plan**:
1. **Extract Framework Control Service** (~600 lines)
   - Framework switching logic
   - State management
   - Validation and verification
   - File: `mcp-tools/services/framework-control-service.ts`

2. **Extract Analytics Service** (~550 lines)
   - Metrics collection
   - Usage tracking
   - Performance monitoring
   - File: `mcp-tools/services/analytics-service.ts`

3. **Extract Health Monitoring Service** (~400 lines)
   - System health checks
   - Diagnostics
   - Status reporting
   - File: `mcp-tools/services/health-monitoring-service.ts`

4. **Extract Configuration Service** (~350 lines)
   - Configuration management
   - Settings persistence
   - Validation
   - File: `mcp-tools/services/configuration-service.ts`

5. **Consolidated Orchestrator** (~400 lines)
   - Tool registration
   - Service coordination
   - Request routing
   - Error handling
   - File: `mcp-tools/system-control.ts` (reduced from 2,716 to ~400 lines)

**Migration Steps**:
1. Create service interface definitions
2. Extract framework control service (test independently)
3. Extract analytics service (test independently)
4. Extract health monitoring service (test independently)
5. Extract configuration service (test independently)
6. Refactor orchestrator to use extracted services
7. Update tests to cover new service boundaries
8. Remove from grandfathered list

**Estimated Effort**: 20-25 hours

---

**Priority 2: prompt-engine/core/engine.ts** (2,342 lines)

**Current State**:
- Large consolidated engine handling template processing, gate validation, response formatting, error handling
- Difficult to extend and test
- Multiple responsibilities mixed together

**Decomposition Plan**:
1. **Extract Template Processor** (~500 lines)
   - Nunjucks template rendering
   - Variable substitution
   - Template validation
   - File: `mcp-tools/prompt-engine/processors/template-processor.ts`

2. **Extract Gate Validator** (~450 lines)
   - Gate validation logic
   - Quality checks
   - Validation reporting
   - File: `mcp-tools/prompt-engine/validators/gate-validator.ts`

3. **Extract Response Formatter** (~400 lines)
   - Response formatting
   - Output transformation
   - Error formatting
   - File: `mcp-tools/prompt-engine/formatters/response-formatter.ts`

4. **Extract Error Handler** (~350 lines)
   - Error handling strategies
   - Error recovery
   - Logging and reporting
   - File: `mcp-tools/prompt-engine/handlers/error-handler.ts`

5. **Consolidated Engine** (~450 lines)
   - Execution orchestration
   - Strategy selection
   - Component coordination
   - File: `mcp-tools/prompt-engine/core/engine.ts` (reduced from 2,342 to ~450 lines)

**Migration Steps**:
1. Create processor/validator/formatter interfaces
2. Extract template processor (test independently)
3. Extract gate validator (test independently)
4. Extract response formatter (test independently)
5. Extract error handler (test independently)
6. Refactor engine to use extracted components
7. Update integration tests
8. Remove from grandfathered list

**Estimated Effort**: 15-20 hours

---

**Priority 3: mcp-tools/index.ts** (1,486 lines)

**Current State**:
- Single file handling all MCP tool registrations
- Mixed concerns (prompt management, engine, system control)
- Difficult to navigate and maintain

**Decomposition Plan**:
1. **Extract Prompt Management Registry** (~450 lines)
   - Prompt tool registration
   - Prompt-specific handlers
   - File: `mcp-tools/registries/prompt-registry.ts`

2. **Extract Engine Registry** (~350 lines)
   - Engine tool registration
   - Execution handlers
   - File: `mcp-tools/registries/engine-registry.ts`

3. **Extract System Control Registry** (~300 lines)
   - System tool registration
   - Control handlers
   - File: `mcp-tools/registries/system-registry.ts`

4. **Consolidated Tool Index** (~300 lines)
   - Registry orchestration
   - Tool initialization
   - MCP server integration
   - File: `mcp-tools/index.ts` (reduced from 1,486 to ~300 lines)

**Migration Steps**:
1. Create registry base interface
2. Extract prompt management registry
3. Extract engine registry
4. Extract system control registry
5. Refactor index to orchestrate registries
6. Update tests and integration points
7. Remove from grandfathered list

**Estimated Effort**: 10-12 hours

### Frameworks Subsystem

**Scope**: 11 files, 8,381 total lines

**See [file-size-baseline.md](./file-size-baseline.md) Section "Frameworks Subsystem" for detailed decomposition plans**

### Execution Subsystem

**Scope**: 4 files, 3,464 total lines

**See [file-size-baseline.md](./file-size-baseline.md) Section "Execution Subsystem" for detailed decomposition plans**

## Migration Process

### Standard Decomposition Workflow

For each file requiring decomposition:

1. **Analysis Phase** (2-4 hours):
   - Understand current functionality
   - Identify cohesive functional units
   - Map dependencies and integration points
   - Design decomposition strategy

2. **Planning Phase** (1-2 hours):
   - Create interface definitions
   - Plan module boundaries
   - Design service contracts
   - Update architecture documentation

3. **Implementation Phase** (8-15 hours):
   - Extract first service module
   - Write unit tests for extracted module
   - Extract remaining service modules
   - Refactor orchestrator to use services
   - Update integration tests

4. **Validation Phase** (2-3 hours):
   - Run full test suite
   - Verify backward compatibility
   - Check performance impact
   - Update documentation

5. **Cleanup Phase** (1-2 hours):
   - Remove from grandfathered list
   - Add `@lifecycle canonical` annotations
   - Update baseline report
   - Document lessons learned

### Quality Gates

Each decomposition must pass these quality gates:

- ✅ **Functionality Preserved**: All existing functionality works identically
- ✅ **Tests Pass**: 100% of existing tests pass
- ✅ **Test Coverage**: New modules have ≥80% test coverage
- ✅ **No Performance Regression**: Performance maintained or improved
- ✅ **Documentation Updated**: All relevant docs reflect new structure
- ✅ **File Size Compliance**: All resulting files <500 lines
- ✅ **Type Safety**: No TypeScript errors, strict mode maintained

### Success Metrics

Track progress using these metrics:

| Metric | Baseline | Q1 Target | Q2 Target | Q3 Target |
|--------|----------|-----------|-----------|-----------|
| Total Violations | 32 | 29 (-3) | 20 (-12) | 0 (-32) |
| Avg File Size | 197 lines | 185 lines | 170 lines | <150 lines |
| Largest File | 2,716 lines | <1,500 | <1,000 | <500 |
| Compliance Rate | 77.1% | 79.3% | 85.7% | 100% |
| Canonical Files | 20 | 50 | 80 | 100% |

## Timeline and Resources

### Q1 2025 (January - March)

**Focus**: Eliminate Tier 1 violations (3 files over 1,500 lines)

**Resources Required**:
- **Development**: 45-57 hours
- **Testing**: 12-15 hours
- **Documentation**: 8-10 hours
- **Total**: 65-82 hours (~2-3 weeks full-time)

**Milestones**:
- Week 4: system-control.ts decomposed
- Week 6: prompt-engine.ts decomposed
- Week 8: mcp-tools/index.ts decomposed
- Week 10: All Tier 1 violations eliminated

### Q2 2025 (April - June)

**Focus**: Refactor Frameworks and Execution subsystems (14 files)

**Resources Required**:
- **Development**: 60-85 hours
- **Testing**: 20-25 hours
- **Documentation**: 10-12 hours
- **Total**: 90-122 hours (~3-4 weeks full-time)

**Milestones**:
- Week 4: Frameworks subsystem refactored (11 files)
- Week 7: Execution subsystem refactored (4 files)
- Week 10: All Tier 2-3 violations eliminated

### Q3 2025 (July - September)

**Focus**: Complete remaining migrations (15 files)

**Resources Required**:
- **Development**: 40-50 hours
- **Testing**: 15-18 hours
- **Documentation**: 8-10 hours
- **Total**: 63-78 hours (~2-3 weeks full-time)

**Milestones**:
- Week 4: Runtime, metrics, chain session modules refactored
- Week 7: Semantic, prompts, utilities refactored
- Week 10: 100% compliance achieved
- Week 12: All documentation updated, baseline report archived

## Risk Management

### Identified Risks

**Risk 1: Breaking Changes During Decomposition**
- **Likelihood**: Medium
- **Impact**: High
- **Mitigation**: Comprehensive test coverage before decomposition, backward compatibility preservation
- **Contingency**: Rollback plan with git branches for each decomposition

**Risk 2: Performance Regression**
- **Likelihood**: Low
- **Impact**: Medium
- **Mitigation**: Performance benchmarking before/after each decomposition
- **Contingency**: Profile and optimize if degradation detected

**Risk 3: Timeline Slippage**
- **Likelihood**: Medium
- **Impact**: Medium
- **Mitigation**: Quarterly checkpoints, prioritized migration order
- **Contingency**: Adjust scope, focus on critical violations first

**Risk 4: Integration Issues**
- **Likelihood**: Low
- **Impact**: High
- **Mitigation**: Integration tests for each refactored module
- **Contingency**: Staged rollout, feature flags for new implementations

## Validation and Acceptance Criteria

### Implementation Complete When:

- ✅ All 32 files decomposed to <500 lines
- ✅ Zero new violations introduced
- ✅ All grandfathered exemptions removed
- ✅ `@lifecycle canonical` annotations on all large modules (if appropriate)
- ✅ 100% test suite passing
- ✅ No performance regressions
- ✅ Documentation fully updated
- ✅ Baseline report archived with final statistics

### Monthly Review Process

**Review Cadence**: Last Friday of each month

**Review Checklist**:
- [ ] Review progress against quarterly goals
- [ ] Update baseline report with current statistics
- [ ] Identify blockers or issues
- [ ] Adjust timeline if needed
- [ ] Document lessons learned
- [ ] Plan next month's work

## References

- [REFACTORING.md](~/.claude/REFACTORING.md) - Lifecycle management patterns
- [file-size-baseline.md](./file-size-baseline.md) - Current violations and roadmap
- [contributing.md](../docs/contributing.md) - File size standards
- [validate-filesize.js](../server/scripts/validate-filesize.js) - Validation script

---

**Status**: Infrastructure Complete, Migration Planning Phase
**Next Review**: 2025-12-15
**Target Completion**: 2025-09-30
