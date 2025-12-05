# Release Notes

Use this guide when you need a high-level history of shipped features, architectural changes, and documentation cleanups for Claude Prompts MCP. Link it in changelogs, upgrade plans, or when auditing which migrations have landed.

## Version Timeline

| Version | Date | Highlights |
| --- | --- | --- |
| 3.0.0 "Gate Parameter Cleanup" | Nov 2025 | **BREAKING**: Removed deprecated gate parameters (quality_gates, custom_checks, temporary_gates). Unified gates parameter is now canonical. |
| 2.0.0 "Gate Parameter Consolidation" | Nov 2025 | Unified `gates` parameter, deprecated separate gate parameters, backward compatible migration. |
| 1.3.0 "Expressive Workflows" | Nov 2025 | Symbolic command language, operator executors, richer session handling. |
| 1.2.0 "Performance & Precision" | Jan 2025 | Four-tier execution modes, structural analysis accuracy, doc cleanup. |
| 1.1.0 "Framework Foundation" | Dec 2024 | Framework system overhaul, gate integration, startup orchestration. |

## v3.0.0 — Gate Parameter Cleanup (BREAKING CHANGES)

**Released**: November 2025
**Focus**: Remove deprecated gate parameters, establish unified gates as canonical

### Breaking Changes

**⚠️ REMOVED: Separate gate parameters**
- The `quality_gates`, `custom_checks`, and `temporary_gates` parameters have been **completely removed** from `prompt_engine`.
- **Migration**: Use unified `gates` parameter (introduced in v2.0.0).
  ```bash
  # OLD (v2.x - NO LONGER WORKS in v3.0.0)
  prompt_engine(
    command:">>prompt",
    quality_gates:["technical-accuracy"],
    custom_checks:[{"name": "Sources", "description": "Cite sources"}],
    temporary_gates:[{"id": "temp", "criteria": ["Check refs"]}]
  )

  # NEW (Required in v3.0.0+)
  prompt_engine(
    command:">>prompt",
    gates:[
      "technical-accuracy",  // String gate IDs
      {"name": "Sources", "description": "Cite sources"},  // Custom checks
      {"id": "temp", "criteria": ["Check refs"]}  // Full gate definitions
    ]
  )
  ```
- **Impact**: Requests using old parameters will be rejected with validation errors
- **Rationale**: Reduces API surface area, simplifies gate specification, enables mixed gate types in single parameter
- See `docs/enhanced-gate-system.md` and `docs/mcp-tooling-guide.md` for migration details

**🔬 EXPERIMENTAL: `llm_validation` parameter**
- The `llm_validation` parameter is now marked as **experimental** (not yet implemented)
- **Current status**: Parameter is blocked by validator pending architectural design
- **Migration**: Use `gates` parameter with `gate_verdict` for current gate-based validation
  ```bash
  # Old (v2.x - no longer works)
  prompt_engine(command:">>prompt", llm_validation=true)

  # New (v3.0.0+)
  prompt_engine(command:">>prompt", gates:["technical-accuracy"])
  ```
- **Rationale**: The parameter provided no functional value (only added footer text). Gate enforcement is planned for future semantic layer integration.
- **Preserved infrastructure**: Severity levels, gate types, and `PendingGateReview` APIs remain available for future semantic layer work.
- See `docs/enhanced-gate-system.md` for current gate system usage.

### Gate System Improvements

- `GateSelectionEngine` fully retired; the prompt engine now relies on the category extractor for all gate precedence decisions.
- Fallback gate selection piggybacks on the same pipeline, ensuring logging and guidance stay consistent even if methodology gates are disabled.
- Guidance renderer prioritizes inline gate fixes first, then framework-level advice. `ChainOperatorExecutor` surfaces inline issues directly inside chain instructions.
- Update reference: `server/dist/gates/core/category-extractor.js`, `server/dist/mcp-tools/prompt-engine/utils/category-extractor.js`.
- `execution_mode` overrides are deprecated; rely on command shape and `%clean/%guided/%lean/%framework` modifiers instead. Compatibility remains for `auto|single|chain` only.

## 2.0.0 — Gate Parameter Consolidation (Nov 2025)

### New Features

**✨ Unified `gates` Parameter**
- Introduced `gates` parameter that accepts mixed array of gate specifications:
  - Gate IDs (strings): `["technical-accuracy", "research-quality"]`
  - Custom checks (objects): `[{"name": "Test Coverage", "description": "Ensure unit tests"}]`
  - Full gate definitions: `[{"id": "gdpr", "criteria": ["No PII"], "severity": "high"}]`
- Replaces three separate parameters (`quality_gates`, `custom_checks`, `temporary_gates`) with single, flexible interface
- Enables mixing different gate types in one parameter for maximum flexibility
- See `docs/mcp-tooling-guide.md` for comprehensive usage examples

**🔄 Normalization Layer (Stage 0.1)**
- Automatic conversion of deprecated parameters to unified format
- Stores normalized gates in `context.metadata['requestedGateOverrides']`
- Ensures consistent gate processing across all pipeline stages
- Maintains 100% backward compatibility during v2.x transition period
- Implementation: `server/src/execution/pipeline/stages/00-request-normalization-stage.ts`

**📝 Step-Targeted Gates**
- Gate definitions now support `target_step_number` and `apply_to_steps` fields
- Apply gates to specific chain steps without affecting others
- Example: `{target_step_number: 2, criteria: ["Verify step 2"]}` applies only to step 2
- Enhanced chain validation and per-step quality control

### Deprecations

**⚠️ Deprecated Parameters (Removal in v3.0.0)**
- `quality_gates` → Use `gates` instead
- `custom_checks` → Use `gates` instead
- `temporary_gates` → Use `gates` instead
- All deprecated parameters show clear migration guidance in response metadata
- Deprecation warnings include specific migration examples

### Migration Support

**Backward Compatibility**
- All deprecated parameters continue to work in v2.x with warnings
- Normalization stage handles conversion transparently
- No breaking changes - 100% API compatibility maintained
- Migration period allows gradual adoption

**Migration Tools**
- Updated contract definitions with deprecation metadata
- Enhanced tool descriptions show preferred patterns
- Comprehensive migration examples in all documentation
- Action metadata includes migration paths for each deprecated parameter

### Technical Changes

**Pipeline Architecture**
- Added `RequestNormalizationStage` (Stage 0.1) before command parsing
- Updated `GateEnhancementStage` (Stage 5) to process normalized metadata
- Modified `ResponseFormattingStage` (Stage 10) to emit deprecation warnings
- Enhanced `InlineGateExtractionStage` (Stage 2) to handle mixed gate types

**Type System**
- New `GateSpecification` union type: `string | CustomCheck | TemporaryGateInput`
- Updated Zod schemas for unified parameter validation
- Enhanced TypeScript contracts with proper union type support
- Fixed lifecycle status enums (`hidden`, `experimental` now supported)

**Testing & Validation**
- 286 tests passing (100% test coverage maintained)
- Updated 10 test files to match new two-stage gate processing
- Added 8 new tests for unified `gates` parameter validation
- All validation suites (typecheck, lint, test, build) passing

### Documentation Updates

- **mcp-tooling-guide.md**: Added unified `gates` parameter section with migration examples
- **enhanced-gate-system.md**: Documented GateSpecification types and backward compatibility
- **prompt-authoring-guide.md**: Updated gate configuration examples
- **architecture.md**: Documented normalization layer in pipeline stages
- **release-notes.md**: This section!

### Performance

- No performance impact - normalization happens once at request entry
- Maintains same execution speed as previous gate parameter handling
- Pipeline remains under 500ms for most operations

## 1.3.0 — Symbolic Command Language (Expressive Workflows)

- Added symbolic operators (`-->`, `@Framework`, `::Gate`) parsed by `SymbolicCommandParser` and executed by dedicated operator executors in `server/dist/execution/operators/`.
- Chain session manager gained blueprint-aware persistence and resume logic; sessions survive STDIO restarts for 24 hours by default.
- Framework overrides now include automatic restoration with guard rails, ensuring `FrameworkStateManager` stays consistent.
- Inline gates can be declared directly inside symbolic expressions; the prompt engine converts them into temporary gate definitions and reuses the existing guidance renderer.
- Compatibility: No schema changes; MCP clients simply send symbolic commands through `prompt_engine`.

## 1.2.0 — Execution Mode & Architecture Consolidation (Performance & Precision)

- Introduced explicit `prompt` execution tier so basic substitutions bypass framework overhead; the prompt engine auto-detects between `prompt`, `template`, and `chain` modes.
- Added `execution_mode` overrides to the MCP schema for precise control, documented in `docs/mcp-tooling-guide.md`.
- Consolidated multiple legacy execution systems into the modern `PromptExecutionService`, removing `UnifiedPromptProcessor` and other ghosts.
- Documentation scrub: removed references to nonexistent HTTP APIs and ensured every workflow uses MCP tools only.

## 1.1.0 — Framework System & Gate Integration (Framework Foundation)

- Introduced the methodology framework stack (CAGEERF, ReACT, 5W1H, SCAMPER) with runtime switching (`server/dist/frameworks/*`).
- Layered gate system now hooks into framework information so quality guidance references the active methodology.
- Startup now runs through the four-phase `Application` pipeline with deterministic logs/checkpoints.
- Semantic analyzer stubs prepared the system for future LLM-driven detection without over-promising features.

## Upgrade Tips

1. Pull latest, run `npm install`, then `npm run build` inside `/server`.
2. Run `npm run validate:all` to ensure gate definitions, execution schemas, and prompt metadata still pass.
3. For supervisor-based STDIO deployments, restart via `server/dist/supervisor/index.js` to avoid dropping clients.
4. Consult `docs/operations-guide.md` and `docs/mcp-tooling-guide.md` for updated workflows introduced in each release.

Older releases and detailed internal milestones live in Git history. This file summarizes the canonical, user-facing highlights.
