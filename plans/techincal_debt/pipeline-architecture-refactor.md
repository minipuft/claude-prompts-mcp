# Pipeline Architecture Refactor Plan

## Problem Summary

Pipeline stages grew beyond orchestration into domain logic containers. The architecture has stages AND services, but new functionality drifted into stages instead of services.

**Evidence**: `05-gate-enhancement-stage.ts` is 1300+ lines. `GateManager` is 350 lines. The stage contains logic that should live in the service.

## Current State

```
Stage (1300 lines) ──calls──▶ Service (350 lines)
                   ──contains──▶ domain logic (wrong)
```

**What stages are doing**:
- ✅ Calling services (correct)
- ❌ Gate normalization logic
- ❌ Temporary gate registration
- ❌ Gate filtering by step
- ❌ Metrics formatting
- ❌ Helper methods

## Target State

```
Stage (80-150 lines) ──calls──▶ Service (500+ lines)
```

**Stages should only**:
- Call services
- Update ExecutionContext
- Pass data between stages

## Refactor Tasks

### Phase 1: Audit (1-2 days)

- [ ] Run size check on all stages: `wc -l src/execution/pipeline/stages/*.ts`
- [ ] Identify stages > 150 lines
- [ ] For each oversized stage, list helper methods and domain logic

**Known violations**:
| Stage | Lines | Contains |
|-------|-------|----------|
| 05-gate-enhancement | 1300+ | normalization, registration, filtering, metrics |
| (audit others) | ? | ? |

### Phase 2: Service Extraction (1-2 weeks)

**From 05-gate-enhancement-stage.ts**:

| Logic | Target Service | New/Extend |
|-------|----------------|------------|
| `normalizeGateInput()` | `GateNormalizer` | New |
| `registerTemporaryGates()` | `TemporaryGateRegistry` | Extend |
| `filterGatesByStepNumber()` | `GateService` | Extend |
| `buildDecisionInput()` | `GateService` | Extend |
| `recordGateUsageMetrics()` | `MetricsCollector` | Extend |

**Pattern for each extraction**:
1. Create/identify target service
2. Move method with tests
3. Update stage to call service
4. Verify stage size reduced
5. Run full test suite

### Phase 3: Validation Script (1 day)

Add to `npm run validate:all`:

```bash
# validate:stage-size
find src/execution/pipeline/stages -name "*.ts" \
  -exec wc -l {} + \
  | awk '$1 > 150 {print "VIOLATION:", $2, "(", $1, "lines)"; exit 1}'
```

### Phase 4: Documentation (1 day)

- [ ] Update `docs/architecture/overview.md` with stage/service boundary rules
- [ ] Add examples of correct stage structure
- [ ] Document the Domain Ownership Matrix

## Domain Ownership Matrix (Reference)

| Domain | Owner | Location |
|--------|-------|----------|
| Gate normalization | GateNormalizer | `gates/services/gate-normalizer.ts` |
| Gate selection | GateManager | `gates/gate-manager.ts` |
| Gate enhancement | GateService | `gates/services/` |
| Temporary gates | TemporaryGateRegistry | `gates/core/` |
| Prompt resolution | PromptRegistry | `prompts/registry.ts` |
| Command parsing | CommandParser | `execution/parsers/` |
| Framework selection | FrameworkManager | `frameworks/` |
| Metrics | MetricsCollector | `metrics/` |

## Success Criteria

- [ ] No stage > 150 lines
- [ ] No helper methods in stages
- [ ] All domain logic in services
- [ ] `npm run validate:stage-size` passes
- [ ] Full test suite passes
- [ ] No regression in functionality

## Lessons Learned

1. **Architecture was correct, discipline drifted** - Services exist but new logic went to stages
2. **Convenience over correctness** - Easier to add code where you are than refactor
3. **Missing enforcement** - No automated check for stage size
4. **CLAUDE.md updated** - Added Pipeline Stage Boundaries rules to prevent recurrence

## Priority

**Medium** - Not blocking functionality, but increases maintenance burden and signals architectural drift to reviewers.

## References

- CLAUDE.md: "Pipeline Stage Boundaries (ENFORCED)" section
- Global rules: "Orchestration vs Service Separation"
- Applications rules: "File Size & Layer Guidelines"
