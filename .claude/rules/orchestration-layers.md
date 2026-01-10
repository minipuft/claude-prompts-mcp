---
paths:
  - server/src/execution/pipeline/stages/**/*.ts
  - server/src/mcp-tools/**/core/*.ts
  - server/src/mcp-tools/**/*handler*.ts
---

# Orchestration Layer Standards

Stages, handlers, and controllers are THIN orchestration layers. They coordinate flow, not contain logic.

## Size Limits (ENFORCED)

| Layer | Target | Warning | BLOCKED |
|-------|--------|---------|---------|
| Pipeline stages | 50-125 | >100 | >150 lines |
| MCP tool handlers | 50-125 | >100 | >150 lines |
| Service methods | 200-400 | >400 | >600 lines |

**If a stage exceeds 150 lines → STOP and extract to a service.**

## NO Helper Methods in Orchestration

```typescript
// ❌ WRONG: Helper in stage
class MyStage {
  execute(ctx) { this.helper(data); }
  private helper(data) { /* logic */ }  // STOP - this is wrong
}

// ✅ RIGHT: Logic in service
class MyService {
  process(data) { /* logic */ }
}
class MyStage {
  execute(ctx) { this.myService.process(data); }
}
```

## What Stages/Handlers MAY Do

- Call services
- Update context/state
- Log diagnostics
- Transform service results to responses

## What Stages/Handlers MAY NOT Do

- Contain domain logic
- Define helper methods
- Perform complex transformations
- Validate business rules (delegate to services)

## Domain Ownership Matrix

**Before adding logic to a stage**, identify the owner service:

| If you need... | Owner Service | Location | Stage May Only |
|----------------|---------------|----------|----------------|
| Gate normalization | GateService | `gates/services/` | Call `gateService.normalize()` |
| Gate selection | GateManager | `gates/gate-manager.ts` | Call `gateManager.selectGates()` |
| Gate enforcement resolution | GateEnforcementAuthority | `execution/pipeline/decisions/gates/` | Call `authority.resolveEnforcementMode()` |
| Gate guide lookup by ID | GateManager | `gates/gate-manager.ts` | Call `gateManager.getGate()` |
| Gate verdict parsing | GateEnforcementAuthority | `execution/pipeline/decisions/gates/` | Call `authority.parseVerdict()` |
| Prompt resolution | PromptRegistry | `prompts/registry.ts` | Call `registry.get()` |
| Command parsing | CommandParser | `execution/parsers/` | Call `parser.parse()` |
| Framework selection | FrameworkManager | `frameworks/` | Call `frameworkManager.select()` |
| Framework validity | FrameworkManager | `frameworks/framework-manager.ts` | Call `frameworkManager.getFramework(id)` |
| Active framework | FrameworkStateManager | `frameworks/framework-state-manager.ts` | Call `stateManager.getActiveFramework()` |
| Metrics recording | MetricsCollector | `metrics/` | Call `collector.record()` |
| Injection decisions | InjectionDecisionService | `execution/pipeline/decisions/injection/` | Call `service.decide()` |
| Style resolution | StyleManager | `styles/style-manager.ts` | Call `styleManager.getStyle()` |

**Anti-Pattern Recognition**: When writing a stage and about to add `private someHelper()` → STOP. Extract to the appropriate service above.

## Pre-Commit Checks

```bash
# Check stage sizes
find src/execution/pipeline/stages -name "*.ts" -exec wc -l {} + | awk '$1 > 150 {print "BLOCKED:", $2}'

# Check for helper methods in stages
grep -rn "private.*(" src/execution/pipeline/stages/ | grep -v "constructor\|logEntry\|logExit"
```
