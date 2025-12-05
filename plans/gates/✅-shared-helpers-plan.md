# Gates / Frameworks / Prompts Shared Helpers Plan

## Objective
- Unify common behaviors (loading, validation, state toggles, guidance injection, metrics) across gates, frameworks, and prompts.
- Eliminate duplicated loaders/registries, align enable/disable semantics, and make methodology-driven gates enforceable through the canonical gate system.
- Preserve hot-reload and MCP transport parity while keeping changes reversible and incremental.

## Scope
- In scope: shared loader/validator utilities, state persistence/toggles, guidance rendering, methodology↔gate bridging, metrics/health reporting, and temporary/ephemeral registries.
- Out of scope (for this plan): changing LLM integrations, adding new methodologies, or modifying MCP tool contracts beyond needed typings.

## Pain Points (baseline)
- Parallel loaders (gates JSON-only vs methodology YAML) with no shared cache/validation path.
- Divergent state toggles: gates default enabled, frameworks default disabled, tracker separate → possible drift.
- Methodology quality indicators are not fed into gate validation (compliance falls back to keyword checks).
- Guidance injection is duplicated (gate enhancement vs framework prompt guidance) with no precedence unification.
- Temporary gates exist, but methodology/prompt overlays are not represented as enforceable gates.

## Deliverables
- Shared resource loader (JSON/YAML) with hot-reload and cache invalidation usable by gates/methodologies/prompts.
- Central schema validator helper to fail-fast on load (gate definitions, methodology YAML, prompt manifests).
- Reusable state store (fs-backed, EventEmitter) for enable/disable + health, reused by gate/framework/prompt systems.
- Generalized scoped ephemeral registry for temporary items (gates/methodology overrides/prompt overlays).
- Guidance renderer/filter that understands framework-specific sections and ordering to avoid duplicate injection.
- Methodology→gate bridge to convert methodologyGates/quality indicators into enforceable gate definitions (or temporary gates) with no dual paths.
- Metrics/health reporter helper to standardize validation/switch timing and success/error tracking.

## Workstreams & Steps
1) Discovery & alignment (baseline)
   - Map current loaders, state managers, and guidance injectors in gates/frameworks/prompts; confirm ownership and lifecycle labels.
   - Identify existing schemas (gate definitions, methodology definition types, prompt configs) and gaps.
   - Decide source of truth for methodology gates and quality indicators.

2) Shared loader + validator
   - Implement `shared/resource-loader` (JSON+YAML, cache, mtime, directory discovery).
   - Implement `shared/schema-validator` with typed schemas for gate definitions, methodology definitions, and prompt manifests.
   - Refactor gate loader to use shared loader/validator; add YAML support if required by methodology bridge.
   - Refactor runtime methodology loader to use shared loader/validator; ensure hot-reload preserves cache semantics.

3) State persistence & toggles
   - Create `shared/state-store` (enable/disable, health, fs persistence, events).
   - Wire gate-state-manager and framework-state-manager to shared store; align defaults and toggle APIs.
   - Expose consistent enablement checks to pipeline stages (gate enhancement, framework/prompt guidance).

4) Guidance rendering & precedence
   - Extract guidance rendering/filtering into a shared helper; define precedence (framework → gate → prompt) and dedupe rules.
   - Update gate enhancement stage and prompt guidance service to consume shared renderer.
   - Add explicit guardrails for methodology-specific guidance sections.

5) Methodology↔gate bridge
   - Convert methodology YAML `methodologyGates` and quality indicators into gate definitions (prefer canonical files) or temporary gates at runtime.
   - Feed quality indicators into gate validation metadata so `methodology_compliance` uses data-driven checks.
   - Remove any parallel/legacy methodology gate paths once bridge is live (no dual implementations).

6) Metrics & health standardization
   - Implement shared metrics helper for validation counts, averages, switch timing, and error tracking.
   - Replace bespoke metrics in gate validator, gate-state-manager, framework-state-manager, and methodology tracker.

7) Rollout & cleanup (mandatory exit criteria)
   - Remove duplicated loader logic after shared loader adoption.
   - Delete redundant state management code once shared store is wired.
   - Drop unused guidance rendering fragments after consolidation.
   - Ensure methodology gate data is enforced through the canonical gate system; remove any “temporary” bridging shims.
   - Update docs (`docs/enhanced-gate-system.md`, framework/prompt guidance docs) and add lint/validation hooks if needed.

## Phase Status: Discovery & alignment (baseline)

### Current map (initial)
- Gate loading/guidance: `server/src/gates/core/gate-loader.ts` now supports YAML/JSON with cached reloads; canonical rendering/injection lives in `server/src/gates/guidance/GateGuidanceRenderer.ts` and `server/src/gates/guidance/gate-instruction-injector.ts`, but prompt guidance still injects independently.
- Methodology loading: Runtime YAML loader is canonical (`server/src/frameworks/methodology/runtime-methodology-loader.ts`) backed by shared YAML utilities (`server/src/utils/yaml/*.ts`); methodology definitions now live under `server/methodologies/`.
- Prompt loading: Prompt hot-reload stack remains in `server/src/prompts/loader.ts` and `server/src/prompts/hot-reload-manager.ts` using JSON configs; not yet using shared YAML utilities or a shared schema validator.
- State toggles: Gate/framework state managers persist to per-system files (`server/src/gates/gate-state-manager.ts`, `server/src/frameworks/framework-state-manager.ts`) without a shared fs-backed store or event channel; defaults still diverge (gates enabled vs frameworks disabled).
- Temporary/ephemeral: Temporary gate registry remains gate-specific (`server/src/gates/core/temporary-gate-registry.ts`); no scoped registry yet for methodology/prompt overlays.
- Metrics: Gate performance and analytics helpers exist (`server/src/gates/intelligence/*`, `server/src/metrics/analytics-service.ts`) but there is no shared validation/health metrics helper across gates/frameworks/prompts.

### Alignment decisions
- Treat YAML utilities, runtime methodology loader, and gate guidance renderer/injector as canonical; avoid introducing new loaders or guidance paths outside these modules.
- Plan to retire legacy methodology JSON/build-time paths once schema validation + gate bridge cover YAML definitions; do not add new legacy dependencies.
- Shared loader/validator should back both gate and prompt paths; avoid new direct fs reads or ad-hoc JSON parsing outside the shared helper.

### Next actions (feeds phases 2-3)
- Add shared schema validator and wire gate/prompt loaders to the shared YAML/JSON loader for consistent validation and cache semantics.
- Define shared state store (fs-backed + events) and align gate/framework defaults before exposing prompt-level toggles.
- Wire prompt guidance service to consume `GateGuidanceRenderer`/`gate-instruction-injector` with framework → gate → prompt precedence and dedupe.
- Extract a generalized ephemeral registry interface (gates/methodology/prompt overlays) based on the temporary gate registry.
- Standardize validation/health metrics via a shared helper and feed it into existing analytics surfaces before rollout.

### Implementation progress (phase 2 kickoff)
- Added shared resource loader with JSON/YAML support and mtime-aware caching (`server/src/utils/resource-loader.ts`); gate loader now consumes it to keep cache semantics while enabling YAML definitions.
- Introduced shared schema validation helper (`server/src/utils/schema-validator.ts`) and lightweight gate schema (`server/src/gates/utils/gate-definition-schema.ts`) to fail-fast on invalid gate definitions without narrowing legacy fields.
- Updated gate loader to reuse the shared loader/validator; temporary gate registry behavior and gate caching are preserved to avoid functional regressions.

## Validation Plan
- `npm run typecheck`
- `npm test -- src/gates/** src/frameworks/** src/prompts/**` (targeted once refactors land)
- `npm run validate:all` (after wiring shared loaders/validators)
- Manual smoke: prompt hot-reload, gate enable/disable toggle, methodology switch + gate compliance run.

## Risks & Mitigations
- YAML/JSON parsing regressions → keep shared loader behind feature flag, add unit tests, and fall back to current loaders until parity proven.
- Enablement drift between gate/framework systems → unify default states and add a health check asserting synchronized toggles before rollout.
- Hot-reload performance regressions → benchmark cache/mtime handling and gate reload paths before enabling by default.
- Dual-path risk if bridge is partial → require deletion of legacy guidance/loader paths in rollout phase; block merge without exit criteria met.
- Schema drift → enforce schema validation in CI for gate definitions, methodology YAML, and prompt manifests.
