# Release Notes

Use this guide when you need a high-level history of shipped features, architectural changes, and documentation cleanups for Claude Prompts MCP. Link it in changelogs, upgrade plans, or when auditing which migrations have landed.

## Version Timeline

| Version | Date | Highlights |
| --- | --- | --- |
| Unreleased | — | Gate precedence cleanup, inline guidance prioritization. |
| 1.3.0 “Expressive Workflows” | Nov 2025 | Symbolic command language, operator executors, richer session handling. |
| 1.2.0 “Performance & Precision” | Jan 2025 | Four-tier execution modes, structural analysis accuracy, doc cleanup. |
| 1.1.0 “Framework Foundation” | Dec 2024 | Framework system overhaul, gate integration, startup orchestration. |

## Unreleased — Gate System Cleanup

- `GateSelectionEngine` fully retired; the prompt engine now relies on the category extractor for all gate precedence decisions.
- Fallback gate selection piggybacks on the same pipeline, ensuring logging and guidance stay consistent even if methodology gates are disabled.
- Guidance renderer prioritizes inline gate fixes first, then framework-level advice. `ChainOperatorExecutor` surfaces inline issues directly inside chain instructions.
- Update reference: `server/dist/gates/core/category-extractor.js`, `server/dist/mcp-tools/prompt-engine/utils/category-extractor.js`.

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
