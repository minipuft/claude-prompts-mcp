# Enhanced Gate System (Canonical)

**Use this guide when** you want to understand how gate definitions, inline gates, frameworks, and runtime toggles interact. Editing prompts or chains? Pair this doc with the [Prompt & Template Authoring Guide](prompt-authoring-guide.md) and [Chain Workflows Guide](chain-workflows.md) so your gate configuration travels with your Markdown.

Quality gates enforce consistent outputs across prompts, templates, and chains. This document tracks the implementation that ships in `server/dist/gates/**` and the way it integrates with the consolidated prompt engine.

**What you’ll learn**
- How the five-level precedence ladder is constructed
- Where gate definitions live and how to add or hot-reload them
- How `api_validation` requests pass through the PromptExecutionPipeline
- How to toggle framework-derived gates via `server/config.json`

## Responsibilities

- Provide five-level precedence (Temporary → Template → Category → Framework → Fallback).
- Load JSON definitions from `server/src/gates/definitions/*.json` (copied next to `dist` on build) with hot-reload support.
- Inject framework-aware guidance while prompting the client to fix issues.
- Record gate status per prompt so repeated warnings are suppressed unless content changes.

## Architecture Map

| Component | Dist Location | Purpose |
| --- | --- | --- |
| `GateLoader` | `gates/core/gate-loader.js` | Loads JSON gate definitions, merges temporary gates, and caches them with hot reload. Every consumer (pipeline, renderer, CLI tooling) reuses this instance so there is a single source of truth. |
| `CategoryExtractor` | `gates/core/category-extractor.js` | Determines which gates apply using the precedence ladder. |
| `GateStateManager` | `gates/gate-state-manager.js` | Persists gate results to avoid spamming the same warning for unchanged content. |
| `GateGuidanceRenderer` | `gates/guidance/GateGuidanceRenderer.js` | Formats guidance text for return payloads and inline chain instructions. The renderer now **requires** a `GateLoader` (it no longer touches the filesystem directly) so guidance always reflects the same cache + activation rules used by the pipeline. |
| `TemporaryGateRegistry` | `gates/coordination/temporary-gate-registry.js` | Registers per-execution temporary gates (e.g., experiments) at runtime and exposes helpers for converting them into lightweight definitions. |
| Gate services | `gates/services/*.js` | Execute `content_check`, `pattern_check`, and `llm_self_check` validations. |
| Pipeline integration | `mcp-tools/prompt-engine/core/prompt-execution-service.ts` + `execution/pipeline/stages/05-gate-enhancement-stage.ts` | Applies gates when `api_validation:true` is supplied or when chains include inline gates. The staged `PromptExecutionPipeline` is the only execution path. |

## Precedence Ladder

1. **Temporary gates** — Highest priority. Registered in-memory for special runs (e.g., `temporary-gate-registry`).
2. **Template gates** — Declared in prompt metadata. Apply to specific prompts only.
3. **Category gates** — Derived from the prompt’s category.
4. **Framework gates** — Based on active methodology (CAGEERF, ReACT, 5W1H, SCAMPER).
5. **Fallback gates** — Default `content-structure` checks applied when nothing else matches.

The `CategoryExtractor` composes the final list in that order before passing control to the services layer.

### Runtime Toggles

Set these flags in `server/config.json` to control how frameworks influence gates:

- `"frameworks.enableMethodologyGates": true` — When `false`, framework-derived gates drop out of the ladder; template/category/temporary gates still run.
- `"frameworks.enableSystemPromptInjection": true` — When `false`, gates still execute, but framework-specific context is no longer injected into prompts.
- `"frameworks.enableDynamicToolDescriptions": true` — When `false`, MCP tool descriptions won’t mention gate requirements or frameworks; useful when clients provide their own copy.

Flip these switches when you want a leaner validation loop (e.g., during prototyping) without removing gate metadata from prompts.

## Gate Definitions

Definitions live under `server/src/gates/definitions/*.json` and are copied to the `dist` bundle. Add or edit definitions there, then run `npm run build` so the loader can read them.

| Gate ID | Scope | Typical Activation |
| --- | --- | --- |
| `code-quality` | Technical prompts | Development/engineering categories, framework = ReACT or SCAMPER. |
| `content-structure` | Universal fallback | All prompts and templates when no other gate matches. |
| `educational-clarity` | Learning content | Education category, frameworks emphasizing reasoning (ReACT/5W1H). |
| `framework-compliance` | Methodology alignment | Automatically applies whenever a framework is active. |
| `research-quality` | Research & analysis | Analysis/research categories, heavy CAGEERF usage. |
| `security-awareness` | Security-sensitive prompts | Development + security tags. |
| `technical-accuracy` | Precise technical docs | Templates referencing deep technical material. |

Each JSON file includes:
- `activation` rules (categories, frameworks, prompt tags, transport overrides).
- `checks` array mixing `content_check`, `pattern_check`, and `llm_self_check` entries.
- `guidance` text returned to the LLM/client when validation fails.

## Validation Check Types

| Check | Description |
| --- | --- |
| `content_check` | Length limits, required/forbidden strings, section counts. Implemented in `gates/services/compositional-gate-service.js`. |
| `pattern_check` | Regex + keyword counts for structural validation. |
| `llm_self_check` | Heuristic scoring using lightweight analysis routines (no network calls). |

The gate service factory (`gates/services/gate-service-factory.js`) instantiates the appropriate service based on the check type. Results roll up into a gate pass/fail status.

## Execution Integration

- **Prompts/Templates**: Pass `api_validation:true` to `prompt_engine` when you plan to return `gate_verdict`. `PromptExecutionService` feeds the request into the staged pipeline, which builds the `ExecutionPlan`, injects frameworks, and invokes `GateLoader`/`GateGuidanceRenderer` inside Stage 5 (Gate Enhancement).
- **Chains**: Steps can declare `inlineGateIds`. Stage 2 extracts inline gates, Stage 4 plans per-step gates, and Stage 5 applies them before `ChainOperatorExecutor` renders each step.
- **System telemetry**: `system_control(action:"analytics")` reports gate pass/fail counts pulled from `metrics/analytics-service.js` and formats responses via the shared `ResponseFormatter` + `GateGuidanceRenderer` hookup.

Example prompt execution:

```bash
prompt_engine(command:">>analysis_prompt content:'...'", api_validation=true)
```

Example chain enforcement:

```bash
prompt_engine(command:"chain://research_pipeline?force_restart=true", api_validation=true)
```

## Guidance & Developer Feedback

- Guidance renderer emits Markdown bullets for failed gates so LLM operators know exactly what to fix.
- When a gate fails repeatedly with identical inputs, `GateStateManager` suppresses duplicate guidance until the prompt changes.
- Temporary gates are useful for high-stakes reviews: register via `system_control` or a dedicated MCP tool (pending); for now, update definitions and reload.

## Maintenance Checklist

1. Update JSON definitions under `server/src/gates/definitions/`.
2. Run `npm run build` inside `server/` so the dist bundle includes the new definitions.
3. Execute `npm run validate:all` (or `npm test` if you touched gate logic) to ensure schema compatibility.
4. If new gates enforce file-size or style policies, update lint/validation scripts accordingly.
5. Document any new gates or precedence tweaks in this file and reference them from the prompt authoring or chain guides if relevant.

For prompt-specific guidance (how to mention gates inside templates), see `docs/prompt-authoring-guide.md`. For chain gate configuration, see `docs/chain-workflows.md`.
