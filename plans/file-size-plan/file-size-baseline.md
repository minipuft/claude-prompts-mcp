# File Size Enforcement - Baseline Report

**Generated**: 2025-11-15
**Standard**: 500-line hard limit per module (REFACTORING.md)
**Status**: 32 files currently exceed limit (22.9% of codebase)
**Enforcement**: Warning-level CI validation (soft enforcement)

## Executive Summary

This baseline report documents the current state of file size violations in the codebase. All 32 violating files are temporarily grandfathered while decomposition plans are developed and executed. The goal is to achieve zero violations by Q3 2025 through systematic refactoring.

## Current Violation Statistics

| Metric | Value |
|--------|-------|
| Total TypeScript Files | 140 |
| Files Over 500 Lines | 32 (22.9%) |
| Files 500-700 Lines | 12 (8.6%) |
| Files 700-900 Lines | 10 (7.1%) |
| Files 900-1500 Lines | 7 (5.0%) |
| Files Over 1500 Lines | 3 (2.1%) |
| Largest File | system-control.ts (2,716 lines) |
| Total Lines in Violations | 27,494 lines |
| Average Violation Size | 859 lines |

## Critical Violators (Over 1000 Lines)

### Tier 1: Extreme Violations (1500+ lines) - Requires Immediate Decomposition

| Lines | File | Priority | Target Deadline |
|-------|------|----------|-----------------|
| 2716 | mcp-tools/system-control.ts | P0 - Critical | 2025-Q1 |
| 2342 | mcp-tools/prompt-engine/core/engine.ts | P0 - Critical | 2025-Q1 |
| 1486 | mcp-tools/index.ts | P0 - Critical | 2025-Q2 |

**Decomposition Strategy**: These files contain multiple functional areas that can be separated into focused service modules. Follow service-oriented decomposition pattern from REFACTORING.md.

### Tier 2: High Violations (1000-1500 lines) - Requires Structured Decomposition

| Lines | File | Priority | Target Deadline |
|-------|------|----------|-----------------|
| 1302 | runtime/application.ts | P1 - High | 2025-Q2 |
| 1166 | frameworks/prompt-guidance/template-enhancer.ts | P1 - High | 2025-Q2 |
| 1011 | execution/parsers/argument-parser.ts | P1 - High | 2025-Q2 |
| 1003 | metrics/analytics-service.ts | P1 - High | 2025-Q2 |

**Decomposition Strategy**: Extract cohesive subsystems into separate modules, maintain clear interfaces, use dependency injection for testability.

## High-Priority Violators (700-999 Lines)

### Tier 3: Moderate Violations - Gradual Refactoring

| Lines | File | Subsystem | Target Deadline |
|-------|------|-----------|-----------------|
| 981 | chain-session/manager.ts | Chain Execution | 2025-Q2 |
| 888 | frameworks/integration/framework-semantic-integration.ts | Framework Integration | 2025-Q2 |
| 798 | mcp-tools/prompt-manager/core/manager.ts | Prompt Management | 2025-Q3 |
| 791 | semantic/configurable-semantic-analyzer.ts | Semantic Analysis | 2025-Q3 |
| 763 | frameworks/methodology/guides/cageerf-guide.ts | Methodology | 2025-Q3 |
| 749 | execution/parsers/command-parser.ts | Command Parsing | 2025-Q3 |
| 748 | utils/file-observer.ts | Utilities | 2025-Q3 |
| 743 | frameworks/framework-state-manager.ts | Framework State | 2025-Q3 |
| 742 | hot-reload/hot-reload-manager.ts | Hot Reload | 2025-Q3 |
| 732 | types/shared-types.ts | Type Definitions | 2025-Q3 |

**Decomposition Strategy**: Extract helper functions into utility modules, separate concerns (state management vs. business logic), split large type definition files by domain.

## Medium-Priority Violators (700-900 Lines)

### Tier 4: Methodology Guides

| Lines | File | Guide Type | Target Deadline |
|-------|------|------------|-----------------|
| 721 | frameworks/methodology/guides/scamper-guide.ts | Methodology | 2025-Q3 |
| 719 | frameworks/prompt-guidance/system-prompt-injector.ts | Framework Support | 2025-Q3 |
| 717 | frameworks/methodology/guides/5w1h-guide.ts | Methodology | 2025-Q3 |
| 714 | execution/context/context-resolver.ts | Execution Context | 2025-Q3 |
| 714 | frameworks/methodology/guides/react-guide.ts | Methodology | 2025-Q3 |

**Pattern**: Methodology guides follow similar structures. Create shared guide utilities and extract common patterns.

## Lower-Priority Violators (500-700 Lines)

### Tier 5: Framework & Prompt Services

| Lines | File | Subsystem | Target Deadline |
|-------|------|-----------|-----------------|
| 686 | frameworks/prompt-guidance/methodology-tracker.ts | Framework Guidance | 2025-Q3 |
| 663 | frameworks/prompt-guidance/service.ts | Framework Guidance | 2025-Q3 |
| 631 | prompts/loader.ts | Prompt Loading | 2025-Q3 |
| 615 | mcp-tools/tool-description-manager.ts | MCP Tools | 2025-Q3 |
| 590 | execution/pipeline/gate-enhancement-stage.ts | Execution Pipeline | 2025-Q3 |
| 589 | prompts/promptUtils.ts | Prompt Utilities | 2025-Q3 |
| 566 | prompts/category-extractor.ts | Prompt Management | 2025-Q3 |
| 549 | mcp-tools/prompt-manager/operations/file-operations.ts | File Operations | 2025-Q3 |
| 503 | mcp-tools/prompt-engine/utils/validation.ts | Validation | 2025-Q3 |

**Strategy**: These files are closer to the limit. Apply focused refactoring to bring under 500 lines without major architectural changes.

## Decomposition Roadmap by Subsystem

### MCP Tools Subsystem (6 files, 8,507 lines)

**Top Violators**:
- system-control.ts (2,716 lines)
- prompt-engine/core/engine.ts (2,342 lines)
- index.ts (1,486 lines)

**Decomposition Plan**:
1. **Phase 1**: Extract system-control.ts into separate service controllers
   - Framework control service
   - Analytics service
   - Health monitoring service
   - Configuration service
2. **Phase 2**: Decompose prompt-engine into focused executors
   - Template processor
   - Gate validator
   - Response formatter
   - Error handler
3. **Phase 3**: Split index.ts into domain-specific tool registries

**Estimated Effort**: 40-60 hours
**Target**: 2025-Q1 completion

### Frameworks Subsystem (11 files, 8,381 lines)

**Top Violators**:
- template-enhancer.ts (1,166 lines)
- framework-semantic-integration.ts (888 lines)
- Four methodology guides (763-714 lines each)

**Decomposition Plan**:
1. **Phase 1**: Extract common methodology guide utilities
   - Shared guide base class
   - Common validation patterns
   - Template enhancement utilities
2. **Phase 2**: Refactor template-enhancer.ts
   - Strategy pattern for enhancement types
   - Separate template processors
3. **Phase 3**: Simplify framework-semantic integration
   - Extract semantic analyzers
   - Separate framework adapters

**Estimated Effort**: 35-50 hours
**Target**: 2025-Q2 completion

### Execution Subsystem (4 files, 3,464 lines)

**Top Violators**:
- argument-parser.ts (1,011 lines)
- command-parser.ts (749 lines)
- context-resolver.ts (714 lines)

**Decomposition Plan**:
1. **Phase 1**: Extract parsing strategies from argument-parser
   - JSON parser
   - Key-value parser
   - Template variable resolver
2. **Phase 2**: Refactor command parser
   - Operator-specific parsers
   - Validation extractors
3. **Phase 3**: Simplify context resolver
   - Environment context builder
   - Session context builder
   - Framework context builder

**Estimated Effort**: 25-35 hours
**Target**: 2025-Q2 completion

### Remaining Subsystems (11 files, 7,142 lines)

**Subsystems**:
- Runtime: application.ts (1,302 lines)
- Metrics: analytics-service.ts (1,003 lines)
- Chain Session: manager.ts (981 lines)
- Semantic: configurable-semantic-analyzer.ts (791 lines)
- Others: 7 files under 750 lines

**Decomposition Plan**: Apply focused refactoring to each subsystem, following subsystem-specific patterns.

**Estimated Effort**: 30-40 hours
**Target**: 2025-Q3 completion

## Migration Tracking

### Q1 2025 Goals
- [ ] Decompose system-control.ts (2,716 → <500 lines)
- [ ] Decompose prompt-engine.ts (2,342 → <500 lines)
- [ ] Decompose mcp-tools/index.ts (1,486 → <500 lines)
- [ ] **Target**: Eliminate all Tier 1 violations (3 files)

### Q2 2025 Goals
- [ ] Decompose runtime/application.ts (1,302 → <500 lines)
- [ ] Decompose template-enhancer.ts (1,166 → <500 lines)
- [ ] Decompose argument-parser.ts (1,011 → <500 lines)
- [ ] Decompose analytics-service.ts (1,003 → <500 lines)
- [ ] Refactor Frameworks subsystem (4 files)
- [ ] Refactor Execution subsystem (remaining files)
- [ ] **Target**: Eliminate all Tier 2 violations (4 files)

### Q3 2025 Goals
- [ ] Refactor all remaining violators (25 files)
- [ ] Add @lifecycle canonical annotations where appropriate
- [ ] Remove all grandfathered exemptions
- [ ] **Target**: Zero violations across entire codebase

## Success Metrics

| Metric | Baseline | Q1 Target | Q2 Target | Q3 Target |
|--------|----------|-----------|-----------|-----------|
| Files Over 500 Lines | 32 | 29 (-3) | 20 (-12) | 0 (-32) |
| Average File Size | 197 lines | 185 lines | 170 lines | <150 lines |
| Largest File Size | 2,716 lines | <1,500 lines | <1,000 lines | <500 lines |
| Compliance Rate | 77.1% | 79.3% | 85.7% | 100% |

## Validation Process

### Current Enforcement
- **Script**: `npm run validate:filesize`
- **CI Integration**: Warning-level (does not block)
- **Grandfathering**: All 32 current violators exempted
- **New Files**: Must stay under 500 lines

### Future Enforcement (Post-Migration)
- **Phase 1** (Q1 2025): Remove Tier 1 exemptions (3 files)
- **Phase 2** (Q2 2025): Remove Tier 2-3 exemptions (14 files)
- **Phase 3** (Q3 2025): Remove all exemptions, enforce globally
- **Final State**: Error-level CI validation (blocks on violations)

## Exemption Removal Process

For each file migrated:

1. **Decompose**: Refactor file to stay under 500 lines
2. **Validate**: Ensure all functionality preserved
3. **Test**: Run full test suite to verify
4. **Tag**: Add `@lifecycle canonical` if appropriate
5. **Update**: Remove from grandfathered list in validate-filesize.js
6. **Document**: Update this baseline report

## Notes

- **Soft Limit**: 300 lines recommended for new code
- **Hard Limit**: 500 lines enforced by CI
- **Critical Threshold**: 1000+ lines requires immediate decomposition
- **Lifecycle Annotation**: Files with `@lifecycle canonical` are exempted but tracked
- **Grandfathered Status**: Temporary exemption during migration period

## References

- [REFACTORING.md](~/.claude/REFACTORING.md) - Domain rules for lifecycle management
- [validate-filesize.js](../server/scripts/validate-filesize.js) - Validation script
- [contributing.md](../docs/contributing.md) - File size standards

---

**Last Updated**: 2025-11-15
**Next Review**: 2025-12-15 (monthly updates during migration)
