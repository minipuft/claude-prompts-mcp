# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`session:cancel` action on `system_control`** (Tier 3): MCP clients can now cancel an active chain session via `system_control(action:"session", operation:"cancel", session_id:"chain-X#1")`. Transitions `runStatus` to `cancelled`; idempotent on already-cancelled sessions; refuses sessions in terminal `completed`/`failed` state. Use `operation:"cancel"` for soft-stop (preserves session for audit), `operation:"clear"` for hard removal (deletes session and chain history).
- **`ExecutionRecord` persistence** (Tier 5): Pipeline stages 9 and 10 now emit append-only ledger rows to the `execution_records` table on every chain-step transition. Stage 9 emits a `working` record per render (with `substate.renderedAt`); stage 10 emits a `completed` record on chain terminal. Records carry SEP-1686-aligned `StepLifecycle` + `StepSubstate` + `GateVerdictSummary` shape. ULIDs (monotonic) preserve insertion order across rapid emissions. Emission is best-effort — failures log a warning and never break pipeline execution.

### Changed

- **`db_reader.py` migrated to `v_execution_status` SSOT view** (Tier 4): Python hook now reads chain state from the cross-language SSOT view introduced in Tier 1, using the canonical `run_status` column (Tier 2) for boundary detection. Falls back to `chain_sessions` per-row table, then `chain_run_registry` blob, for backward compatibility during rollout (Tier 10 will retire the blob fallback). Hook output shape unchanged — existing chain-stop integration is preserved.
- **Consolidated four KV-blob tables into shared `kv_state`** (`SCHEMA_VERSION` 15 → 16): `framework_state`, `gate_system_state`, `argument_history`, and `resource_hash_cache` are now rows in a single `kv_state` table keyed on `(tenant_id, key)`. `SqliteStateStoreConfig` gains an optional discriminator `key` for shared tables. `state.db` is ephemeral, so the schema bump auto-recreates on next server start with no migration burden. Drops 4 tables and 5 indexes.
- **Atomic dual-write to chain registry + hook view**: `persistSessions()` now wraps the `chain_run_registry` blob write and the derived `chain_sessions` projection inside a single transaction so the two can never diverge. Renamed `syncToSessionTable` → `projectToHookView` to reflect that `chain_sessions` is a read-only projection of the registry blob.
- **`SqliteChainRunRegistry` class removed**: dead code with zero consumers. Single `DirectChainRunRegistry` implementation remains.

- **Command tokenizer refactor**: Replaced duplicated operator detection across 3 parsing strategies with a single-pass, quote-aware `tokenizeCommand()` function
  - `command-parser.ts`: 771→710 lines; symbolic `canHandle` reduced from 20 lines to 1; gate/framework/style stripping regex (~25 lines) replaced by `tokens.promptId`/`tokens.rawArgs`
  - `parser-utils.ts`: 198→156 lines; removed `hasOperatorOutsideQuotes` and `stripFrameworkOperatorOutsideQuotes` (zero consumers — tokenizer subsumes)
  - Strategies now consume `TokenizedCommand` instead of re-detecting operators: `canHandle(command, tokens)` reads `tokens.format` and `tokens.hasSymbolicOperators`
  - Eliminates the class of bugs where special characters inside quoted arguments (e.g., `"R3F + Visx"`, `"modes: (1)"`) triggered false operator detection

### Added

- **`command-tokenizer.ts`**: Pure function `tokenizeCommand()` with quote-aware detection for all 8 operator types (chain, delegation, gate, parallel, repetition, conditional, framework, style). Includes delimiter overlap filtering to prevent `==>` from false-matching as gate operator
- **`command-tokenizer.test.ts`**: 56 tests covering all operator types, quoted argument regression suite, mixed operators, prompt ID extraction, cleaned command generation, and edge cases

## [2.1.0](https://github.com/minipuft/claude-prompts/compare/v2.0.0...v2.1.0) (2026-03-19)

### Added

- **Multi-source resource overlay**: Custom workspace resources now load alongside bundled ones for all resource types (prompts, gates, methodologies, styles). Set `MCP_WORKSPACE` to a directory with `resources/` subdirs — custom resources with the same ID as bundled ones take priority
  - Methodologies: `additionalMethodologiesDirs` in `RuntimeMethodologyLoader` (mirrors gates pattern)
  - Styles: `additionalStylesDirs` in `StyleDefinitionLoader` (mirrors gates pattern)
  - Prompts: Overlay merge in `data-loader.ts` — loads primary then overlays per workspace dir
  - Gates: Already supported (unchanged)
- **Wide-event root span enrichment**: Pipeline root span (`prompt_engine.request`) now contains 22 business-context attributes at completion, following the [wide-event pattern](https://loggingsucks.com/)
  - Performance: `stages.slowest`, `slowest_ms`, `executed_count`, `duration.total_ms`, `had_early_exit`
  - Gates: `gates.names`, `passed_count`, `failed_count`, `blocked`, `retry_exhausted`, `enforcement_mode`
  - Chain: `chain.is_chain`, `chain.step_index`, `chain.id`
  - Framework/scope: `framework.id`, `framework.enabled`, `scope.source`
  - Error: `error.type` for groupable incident triage
  - Enables incident queries like "show blocked requests by gate name" or "which stage is the bottleneck"
- **Response Format Overlays**: Methodologies and styles can define `responseFormat` in YAML to guide LLM response structure at the tool description level
  - Methodology `responseFormat` woven into tool descriptions at synchronization time (global)
  - Style `responseFormat` available for per-execution system prompt injection

* **ci:** auto-merge manual changelog entries into Release Please releases ([d2f2f52](https://github.com/minipuft/claude-prompts/commit/d2f2f52f330f3063f394a80988c011de692f7717))
* **runtime:** multi-source resource overlay and path consolidation ([2f5d751](https://github.com/minipuft/claude-prompts/commit/2f5d75106605d254679a54871deb5d0e7ee46649))
* **server:** add OpenTelemetry instrumentation and observability infrastructure ([48e720f](https://github.com/minipuft/claude-prompts/commit/48e720f684f8fc5822c66c7242aa414bc2e4740f))

### Changed

- **BREAKING**: Path resolution consolidated to `MCP_WORKSPACE` as single source of truth. Individual per-resource env vars (`MCP_PROMPTS_PATH`, `MCP_METHODOLOGIES_PATH`, `MCP_GATES_PATH`, `MCP_STYLES_PATH`, `MCP_SCRIPTS_PATH`) and CLI flags (`--prompts`, `--methodologies`, `--gates`, `--scripts`, `--styles`) removed
  - Migration: Use `MCP_WORKSPACE` with standard `resources/` subdirectory structure, or `MCP_RESOURCES_PATH` for custom resources base
  - PathResolver `get*Path()` methods unified via shared `resolveResourceSubdir()` helper
  - Per-loader `resolve*Dir()` methods simplified to package.json + \_\_dirname fallback only (env var handling removed)
  - `module-initializer.ts` unconditionally initializes singletons with PathResolver-resolved dirs
- **Prompt management consolidation**: Migrated all prompt lifecycle operations from standalone `prompt_manager` tool to unified `resource_manager` with `resource_type:"prompt"`. This completes the tool consolidation started in v1.2.0.
  - All 12 prompt actions preserved: `create`, `update`, `delete`, `list`, `inspect`, `reload`, `analyze_type`, `analyze_gates`, `guide`, `history`, `rollback`, `compare`
  - Internal architecture improved with service decomposition: `PromptLifecycleService`, `PromptDiscoveryService`, `PromptVersioningService`
  - No API changes required—use `resource_manager(resource_type:"prompt", action:"...")` as before
- **Client launch preset expansion**: Extended `--client` startup presets to include `gemini`, `opencode`, and `cursor` (in addition to `claude-code`, `codex`, `unknown`) and wired delegation strategy routing for each profile.
- **Delegation strategy hardening**: Centralized delegation profile metadata for CTA/footer rendering, added Codex fallback guidance when `spawn_agent` is unavailable, and marked Cursor delegation messaging as experimental/testing.
- **Tier 5 File Size Decomposition**: Three oversized files decomposed to meet 500-line service advisory
  - `loader.ts` (896→544): Extracted markdown parsing to `markdown-prompt-parser.ts`; consolidated ~30 verbose info-level logs
  - `tool-description-loader.ts` (741→489): Extracted methodology/style overlay resolution to `tool-description-overlays.ts`
  - `file-operations.ts` (517→345): Removed 3 dead diagnostic methods with zero consumers
- **MCP Tool Schemas**: Hand-written Zod schema factories replace codegen `mcp-schemas.ts`, enabling methodology-aware description overlays without generated code
- **Operator Patterns**: Loaded from JSON registry at import time via esbuild inlining, eliminating the `generate-operators` codegen step and Python hook codegen
- **Style Guidance**: Served exclusively from YAML definitions via StyleManager, removing hardcoded legacy fallback

* **hooks:** improve Python hook type safety and reduce pyrefly baseline ([69cc281](https://github.com/minipuft/claude-prompts/commit/69cc281d4b6ab3d137b0713b4730be55ffac4288))
* **runtime:** replace ServerRootDetector with resolvePackageRoot() ([3c2bd7f](https://github.com/minipuft/claude-prompts/commit/3c2bd7ffb1c04c4949397119cb1680126481f3e2))
* **server:** decompose Tier 5 oversized files to meet size advisories ([adbc670](https://github.com/minipuft/claude-prompts/commit/adbc6706e94b5047f494aaa2f00ee8f9d364e2f7))
* **server:** enforce architecture boundaries via DatabasePort injection ([5b39be0](https://github.com/minipuft/claude-prompts/commit/5b39be009cad1221ad3d2471c243282897d11723))
* **server:** replace codegen with hand-written schemas and resource-driven overlays ([84b74cf](https://github.com/minipuft/claude-prompts/commit/84b74cfa8863497028d4fa9b2b0cb67fcc92619b))

### Removed

- **Legacy `prompt_manager` MCP tool**: Prompt lifecycle now exclusively via `resource_manager`. The standalone `prompt_manager` tool registration has been removed.

### Fixed

- **Prompt update field clearing**: Sending empty strings (e.g., `system_message:""`) now correctly clears the field instead of silently preserving the old value. Update handler migrated from `||` fallback to `!== undefined` pattern matching the methodology handler

* **ci:** add checkout step before changelog merge in Release Please workflow ([d68d0f1](https://github.com/minipuft/claude-prompts/commit/d68d0f19781079c114c46d29543d1f780a1edda9))
* **ci:** centralize downstream version sync in extension-publish ([e8c25e0](https://github.com/minipuft/claude-prompts/commit/e8c25e0d7bb925ce517c2aa72e226d4c4ebf0be0))
* **ci:** fix changelog merge target and set release-as 2.1.0 ([cc2ed76](https://github.com/minipuft/claude-prompts/commit/cc2ed76cb5bf9e760743aad6201049e983227396))
* **deps:** update dependency chokidar to v5 ([b10476f](https://github.com/minipuft/claude-prompts/commit/b10476f3547051ea5c7296e275c69f2d0561eb5b))
* **hooks:** register delegation-enforce.py in PreToolUse hooks ([0c7c3a4](https://github.com/minipuft/claude-prompts/commit/0c7c3a4f3ebd78527bacbe821991c248214ad8c5))
* **hooks:** resolve generated operators Ruff typing issue ([a956fb2](https://github.com/minipuft/claude-prompts/commit/a956fb2a7df0f0439d5bd39f7343c3dfb071a452))
* **hooks:** use SSOT registry for operator detection in prompt-suggest hook ([2fe7a4f](https://github.com/minipuft/claude-prompts/commit/2fe7a4f58ef93632e70cd2087af9746e00be9108))
* **hot-reload:** support chokidar 5 upgrade ([1db39c8](https://github.com/minipuft/claude-prompts/commit/1db39c8982706e36d70b2eec1580631594d99fa3))
* **mcp-tools:** fix prompt update field clearing and simplify update workflow ([5a2800e](https://github.com/minipuft/claude-prompts/commit/5a2800e6f925796c6d8c679d6aeaff3672f8aa33))
* **mcp-tools:** remove section/section_content from router pass-through ([61072df](https://github.com/minipuft/claude-prompts/commit/61072df2c71ae61ed7002dd21802b8f06c9dd8c2))
* **parsers:** strip leading delegation operators before argument extraction ([07ed2ee](https://github.com/minipuft/claude-prompts/commit/07ed2ee7498956b5690fa555c94bf63db95acbe0))
* **scripts:** check dependency range instead of package version for opencode ([3f3fa9e](https://github.com/minipuft/claude-prompts/commit/3f3fa9e6fd4089c0202e3bee74ce4f8cd379790c))
* **scripts:** generate Ruff-compatible Python operator types ([aa201d7](https://github.com/minipuft/claude-prompts/commit/aa201d7166d35dd7b91cc6fa0eded6ea848e10c9))
* **scripts:** update extension deps list and lint ratchet baseline ([bffac0d](https://github.com/minipuft/claude-prompts/commit/bffac0d0ca73ecca35eb8373ae349182ebba5d6f))

### Improved

- **Prompt update workflow for LLMs**: Update fields directly — `update(id, description:"new")` — only provided fields change, omitted fields are preserved. Tool description now includes a compact UPDATE hint for discoverability
- **Update handler maintainability**: Replaced 8 individual if-checks with `UPDATE_FIELDS` map loop for field-level overrides. Adding new updatable fields is now a single map entry

### Documentation

- **README install sections**: OpenCode and Gemini CLI sections restructured with Option A/B (plugin vs manual config), correct config formats (OpenCode uses `mcp` key with `command` array), and Gemini hooks prerequisite added. Fixed `> [!NOTE]` callouts not rendering inside `<details>` blocks
- **Custom Resources section**: Documented `MCP_WORKSPACE` overlay behavior, removed false `~/.local/share/claude-prompts/` persistence claim, added per-client config examples with `MCP_RESOURCES_PATH`, added `--init` workspace creation workflow
- **Telemetry observability guide**: Restructured attribute reference into Initial/Wide-Event/Other sections with incident query examples per attribute. Fixed chain events incorrectly documented as active (now marked Planned). Updated architecture diagram to show wide-event enrichment flow.
- **CONTRIBUTING.md modernization**: Restructured contributor guide with quick-start path, contribution type routing (code/prompts/gates/methodologies/docs), commit scope reference, testing decision matrix, and progressive disclosure via collapsible sections
- **GitHub issue and PR templates**: Added YAML-based issue forms (bug report, feature request) with project-specific dropdowns (transport, MCP tool, area), preflight checkboxes, and structured fields following Next.js/Vite/Claude Code conventions. Minimal PR template complements existing CI `pr-summary` bot

* **cleanup:** record chokidar post-upgrade rationale ([b6740e2](https://github.com/minipuft/claude-prompts/commit/b6740e21d11bf20a324c3e511a97ad67c28924c9))
* modernize CONTRIBUTING.md, add GitHub templates, align project config ([3afbe39](https://github.com/minipuft/claude-prompts/commit/3afbe39c475ddc5dc4054b5ffd30f5bc90a29cd6))
* record open PR validation wave ([81d383a](https://github.com/minipuft/claude-prompts/commit/81d383a51191570cf4314caeec29e7d9dcbb540c))
* record package wave results ([0e7de90](https://github.com/minipuft/claude-prompts/commit/0e7de90a611b5151f6e4a095ed4e49bfa49ba9ff))
* record remaining package wave ([d398fe5](https://github.com/minipuft/claude-prompts/commit/d398fe54b37d279dc23616453033350a5d1784d8))
* remove orphaned [Unreleased] section from pre-v2.0.0 changelog ([73ad697](https://github.com/minipuft/claude-prompts/commit/73ad69785c60ddccdd6decf52b6f86f57701ac74))
* standardize inline doc links with TIP callouts across README ([ebd6241](https://github.com/minipuft/claude-prompts/commit/ebd62412b08b03a0f335b12850750f8d0546144e))
* update changelog for unreleased changes ([25c659e](https://github.com/minipuft/claude-prompts/commit/25c659e21230b1adca71789541dadd1ac1416996))
* update demo video plan to WebP format and re-recording schedule ([b87aef7](https://github.com/minipuft/claude-prompts/commit/b87aef7f106f7502ee1e2e253deb05606b4b5d4c))

### ⚠ BREAKING CHANGES

- **runtime:** Individual per-resource env vars and CLI flags removed. Use MCP_WORKSPACE with resources/ subdirectory structure instead.

## [Unreleased]

## [2.0.0](https://github.com/minipuft/claude-prompts/compare/v1.7.0...v2.0.0) (2026-03-11)

### ⚠ BREAKING CHANGES

- **server:** License changed from MIT to AGPL-3.0-only. Network use of modified versions now requires source disclosure under Section 13 of the GNU Affero General Public License v3.
- **server:** All runtime-state paths require explicit PathResolver configuration. Users running via npx must provide --workspace or set MCP_WORKSPACE. Storage backend migrated from JSON files to SQLite — downstream readers of state files must use SQLite.
- **paths:** All path-dependent modules now require explicit path configuration. Callers must provide paths via PathResolver or CLI flags.

### Added

- **ci:** add commitlint, changelog-sections, and downstream sync workflow ([802575d](https://github.com/minipuft/claude-prompts/commit/802575df5bb95a1f6cecf1dcd9a9d3f3cfc8fd8e))
- **eslint:** add claude-plugin custom ESLint rule ([876b431](https://github.com/minipuft/claude-prompts/commit/876b431f428b8a8df644ae4d89c31d483c45e9d2))
- **gates:** add response blocking and gate event emission in pipeline ([914a074](https://github.com/minipuft/claude-prompts/commit/914a0740db3d793d259d502ae9a354077b85c3d3))
- **hooks:** add server-side hook registry and MCP notification system ([86ba115](https://github.com/minipuft/claude-prompts/commit/86ba11564d6363e9353b34cfcef0a7e662d50b96))
- **parsers:** add framework-aware quote parsing for @ operator ([9555122](https://github.com/minipuft/claude-prompts/commit/95551220836997760e735ab6b7121548f05dc504))
- **scripts:** add skills-sync CLI for cross-client skill distribution ([351291c](https://github.com/minipuft/claude-prompts/commit/351291c5827e17cd36b34588d6ee2646b561eebc))
- **server:** add identity resolution, delegation operator, and methodology assertions ([#76](https://github.com/minipuft/claude-prompts/issues/76)) ([913c2d9](https://github.com/minipuft/claude-prompts/commit/913c2d9d3dc8d65a64e47c29f310feeca0f0c937))

### Fixed

- **ci:** align extension-publish tags with Release Please config ([19a0024](https://github.com/minipuft/claude-prompts/commit/19a002439ade437c7856c03164b52c4196d821a1))
- **hooks:** allow generated file deletions for feature removal ([a8fcb24](https://github.com/minipuft/claude-prompts/commit/a8fcb24f310096fe617ac50fb1840acdeb5778f8))
- **hooks:** update Python hooks for new gate server format ([1b0ddf5](https://github.com/minipuft/claude-prompts/commit/1b0ddf50367e8de7fb447b2e95b6d80ecec2d207))
- **parsers:** simplify argument assignment for unstructured text ([061cd0f](https://github.com/minipuft/claude-prompts/commit/061cd0f1e8483e258ffff13e5576b61eddac15d2))
- **pipeline:** use provider function for prompt cache synchronization ([f092837](https://github.com/minipuft/claude-prompts/commit/f09283778ff2474b1a30d8a40c6a8f0827069c97))
- **runtime:** bridge PathResolver to jsonUtils via PROMPTS_PATH env var ([3d4505b](https://github.com/minipuft/claude-prompts/commit/3d4505b3c982f2952fc56f574ba5228b801d290e))
- **tests:** set PROMPTS_PATH in test setup for template rendering ([34769d7](https://github.com/minipuft/claude-prompts/commit/34769d762fc9ffdb2f7c00064dc4a04bdd2a0a9e))

### Changed

- **gates:** consolidate gate verdict validation to single source of truth ([0ae1ae9](https://github.com/minipuft/claude-prompts/commit/0ae1ae9ed20070515129ce239f7b0aec5f31daff))
- **gates:** extract gate-activation utility and cleanup dead code ([85bd265](https://github.com/minipuft/claude-prompts/commit/85bd265ae91599718b257055ac45955249bf3f0a))
- **mcp-tools:** consolidate prompt_manager into resource_manager ([6a41a52](https://github.com/minipuft/claude-prompts/commit/6a41a5293524b0097132d22ccd6107e43cd863f6))
- **parsers:** simplify argument matching and remove dead code ([3befb9f](https://github.com/minipuft/claude-prompts/commit/3befb9f086567d880b4152a49437b551b7b51a5b))
- **paths:** enforce explicit path resolution, remove process.cwd() fallbacks ([b93ca78](https://github.com/minipuft/claude-prompts/commit/b93ca789abf5e2bcf318fce73dd27cd634563efa))
- **prompt-guidance:** remove unused resource selection code ([a2da026](https://github.com/minipuft/claude-prompts/commit/a2da0267d90a206a0864a62d741ccbab1819f8ca))
- **remotion:** replace demo compositions with Liquescent design system ([b06706b](https://github.com/minipuft/claude-prompts/commit/b06706b135ff51aada2191b283e905e66eff4b40))
- **runtime:** migrate CLI argument parsing to node:util parseArgs ([71dbe00](https://github.com/minipuft/claude-prompts/commit/71dbe00e27199850ad093cf077638ca3d4038eee))
- **server:** complete modular monolith migration to 5-layer architecture ([31d3884](https://github.com/minipuft/claude-prompts/commit/31d3884726f29611a5e4ca1e3bd9673729b53d90))
- **server:** relocate tooling/ submodules and consolidate pipeline imports ([5204a7a](https://github.com/minipuft/claude-prompts/commit/5204a7a01e66cefffb2a607c0432e0a880df1cb3))
- **types:** consolidate context types and add gate response contract ([aa51202](https://github.com/minipuft/claude-prompts/commit/aa512028795538127fb86eb3ef3d210b85ad6e9e))

### Documentation

- add LIQUESCENT methodology and update changelog ([26a639b](https://github.com/minipuft/claude-prompts/commit/26a639b59c89f7f0f223dc65fb5a8201a7740d06))
- **changelog:** document breaking path resolution changes ([5918e16](https://github.com/minipuft/claude-prompts/commit/5918e1653f9cf4810998466567ce72f40b0808ee))
- **ci:** update downstream sync comment to reflect Dependabot approach ([82e15cd](https://github.com/minipuft/claude-prompts/commit/82e15cd32251579da6ab6ab862b244b493de5c78))
- consolidate documentation and remove completed plans ([1e52295](https://github.com/minipuft/claude-prompts/commit/1e52295ce182e20753d7444293086eab81652206))
- update path configuration and release process documentation ([abf3457](https://github.com/minipuft/claude-prompts/commit/abf345766f8fd611c5b0ad1e502866f6d81cc88b))

### Maintenance

- **ci:** downgrade to minor bump — path resolution change is internal only ([c550b74](https://github.com/minipuft/claude-prompts/commit/c550b74d4a220ba44ecb09654c0542e380bd56bd))
- **ci:** release as 2.0.0 — AGPL license change is breaking ([7e5d024](https://github.com/minipuft/claude-prompts/commit/7e5d024645831005c55f86281364efa90312ef82))
- **server:** migrate license from MIT to AGPL-3.0-only ([36961fa](https://github.com/minipuft/claude-prompts/commit/36961fad8bac2cb4b4f9b232ece905be91fe16f8))

## [1.7.0](https://github.com/minipuft/claude-prompts/compare/v1.6.0...v1.7.0) (2026-01-23)

### Features

- **ci:** migrate to OIDC trusted publishing for npm ([e71d272](https://github.com/minipuft/claude-prompts/commit/e71d272f833d1e983f717eb11d31b6a492c24a59))
- **config:** add registerWithMcp toggle for MCP resources ([471ed14](https://github.com/minipuft/claude-prompts/commit/471ed14e8a2a4bd63dd44aabbec8f97a5869e513))
- **config:** expand resources config with granular per-type controls ([ddcdba2](https://github.com/minipuft/claude-prompts/commit/ddcdba2f62a700bfaf013f17ee16f21927cba110))
- **docs:** add Remotion animation system for documentation videos ([0a40c4d](https://github.com/minipuft/claude-prompts/commit/0a40c4de20807ae4600294bee983ce852992311f))
- extension dep sync, repetition operator, hook fuzzy matching ([efbdc30](https://github.com/minipuft/claude-prompts/commit/efbdc3018b44b50bb7383d30f23b3239cc0b7905))
- **hooks:** add chain step visibility with IDs for workflow preview ([ff25d5e](https://github.com/minipuft/claude-prompts/commit/ff25d5ec0f26c1556f55353fb41e97e897ff6792))
- **hooks:** improve prompt_engine directive clarity and token efficiency ([b62f8d3](https://github.com/minipuft/claude-prompts/commit/b62f8d3dd3e7aa4794e9b29bccb0ccc081bd49b1))
- **hooks:** validate operator values against registered server resources ([30cba3a](https://github.com/minipuft/claude-prompts/commit/30cba3ac12c88e74b0b7e70bbcd8bfe079a9505b))
- **resources:** add MCP logs resources for runtime observability ([5f0025f](https://github.com/minipuft/claude-prompts/commit/5f0025fcece76e3ed593246d30da54554e7be58f))
- **resources:** implement MCP Resources protocol for token-efficient access ([80d56d2](https://github.com/minipuft/claude-prompts/commit/80d56d22a4b25b93270e9d8718c3b0ad95641f68))

### Bug Fixes

- **parsers:** preserve arguments after \* N repetition operator ([649bae3](https://github.com/minipuft/claude-prompts/commit/649bae3d3dcaf7c6ec53fda1da18a90aaed6d705))

## [1.6.0](https://github.com/minipuft/claude-prompts/compare/v1.5.0...v1.6.0) (2026-01-22)

### Features

- **ci:** modernize Release Please and npm-publish workflows ([7bb1303](https://github.com/minipuft/claude-prompts/commit/7bb1303a53f998ca10bab6f621eecf548864881a))

### Bug Fixes

- **ci:** handle Release Please PR output as JSON ([8559c74](https://github.com/minipuft/claude-prompts/commit/8559c74e2c819961c644b769bc34f5a06e4f0c82))
- **tests:** update E2E plugin validation for current structure ([053b0be](https://github.com/minipuft/claude-prompts/commit/053b0be8bdd3f3443c5e68b9415e9e0e716d8739))

## [1.5.0] - 2026-01-21

### Added

- **Hook-level fuzzy matching**: Unknown prompt interception before tool call for token efficiency
  - `>>unknwon_prompt` → Hook returns suggestions immediately (no server round-trip)
  - Same multi-factor scoring algorithm as server-side (prefix: +100, word overlap: +30/word, Levenshtein: +50-distance\*10)
  - Saves ~50-100 tokens per failed prompt attempt
- **Resource change tracking**: Audit log for prompts and gates with source attribution
  - Tracks filesystem hot-reloads, MCP tool operations, and external changes
  - Content hashing detects actual modifications (skips no-op saves)
  - Baseline comparison at startup surfaces changes made while server was down
- **`system_control(action:"changes")`**: Query the audit log with filters (`source`, `resourceType`, `since`, `limit`)

### Changed

- **Error messages**: Condensed parsing errors for token efficiency
  - Before: Multi-line verbose messages with format examples and hints
  - After: Single-line messages with fuzzy suggestions only when relevant
- **File watching**: Migrate from `fs.watch` to Chokidar with automatic polling for WSL2/network filesystems
  - Auto-detects WSL2 environments and enables polling mode
  - Configurable via `usePolling` ('auto' | true | false) and `pollingInterval` (default: 300ms)
  - Fixes hot-reload not working in WSL2 due to virtualized filesystem limitations

### Fixed

- **Resource ID extraction**: Baseline comparison now correctly extracts prompt/gate IDs from directory names (was incorrectly extracting "prompt" from nested file paths)
- **Command parsing**: Comprehensive improvements to command parsing robustness:
  - **Bare prompt names**: Accept `strategicImplement` without requiring `>>` prefix
  - **Double-encoded JSON**: Handle nested JSON strings from MCP clients that double-escape payloads
  - **JSON-wrapped chains**: JSON strategy now properly delegates to symbolic parser for chain commands (e.g., `{"command": ">>analyze --> summarize"}`)
  - **Argument syntax**: Gate operators (`::` and `=`) no longer conflict with argument assignment (`input="value"`)
- **Fuzzy prompt suggestions**: Multi-factor scoring replaces simple Levenshtein-only matching:
  - **Prefix matching** (score +100): `ana` → suggests `analyze_code`, `analyze_data`
  - **Word overlap** (score +30/word): `code` → suggests `code_review`, `analyze_code`
  - **Typo correction**: Dynamic threshold based on query length (longer queries allow more edits)
  - **Limited to 3 suggestions**: Reduces noise while maintaining relevance
  - **No arbitrary examples**: Completely unrelated queries show no suggestions instead of random prompts

## [1.4.5] - 2026-01-20

### Added

- **Chain workflow preview**: Hooks show all chain steps before execution begins (e.g., "1/4 Initial Scan → 2/4 Deep Dive → ...")
- **scaffold_project chain**: Interactive project scaffolding for TypeScript, Python, or hybrid projects with modern tooling
- **Nested chain discovery**: Chain steps can reference prompts in subdirectories (e.g., `scaffold_analyze` under `scaffold_project/`)
- **System-only prompts**: Prompts with only system message (no user template required)
- Operator patterns generated from single source (TypeScript + Python via generate-operators.ts)

### Changed

- Symbolic parser with unified pattern matching across all operators
- Hook configuration now loaded from `config.json` via config_loader.py
- Move detect-skills.py to global ~/.claude/hooks (not plugin-bundled)

## [1.4.4] - 2026-01-19

### Added

- Include hooks directory in npm package distribution

## [1.4.2] - 2026-01-18

### Changed

- Migrate Gemini-specific hooks to gemini-prompts repository

## [1.4.1] - 2026-01-17

### Fixed

- Remove submodule path checks from distribution validation

## [1.4.0] - 2026-01-16

### Added

- Global version integrity check across ecosystem (npm, marketplace, extensions)

### Changed

- Migrate documentation guides to Diátaxis framework

## [1.3.2](https://github.com/minipuft/claude-prompts/compare/v1.3.1...v1.3.2) (2026-01-14)

### Bug Fixes

- **release:** version sync ([#54](https://github.com/minipuft/claude-prompts/issues/54)) ([33f9e85](https://github.com/minipuft/claude-prompts/commit/33f9e85349e38445905d6471742c54910dc9178e))

## [1.3.1](https://github.com/minipuft/claude-prompts/compare/v1.3.0...v1.3.1) (2026-01-14)

### Bug Fixes

- **release:** version sync ([#51](https://github.com/minipuft/claude-prompts/issues/51)) ([6bd6039](https://github.com/minipuft/claude-prompts/commit/6bd6039765edae189fe83ca13f60a8a27a178d73))

## [1.3.0](https://github.com/minipuft/claude-prompts/compare/v1.2.0...v1.3.0) (2026-01-14)

### ⚠ BREAKING CHANGES

- Complete MCP server restructure with new consolidated API

### Features

- add Claude Code plugin for /install-plugin support ([c3b5654](https://github.com/minipuft/claude-prompts/commit/c3b5654aaeea5fec12402a859eb687d1e666caa4))
- add dev:claude script for --plugin-dir workflow ([2a7d6f8](https://github.com/minipuft/claude-prompts/commit/2a7d6f8abeedfb6c6ed6f36becae644ebad6f7d7))
- add marketplace.json for plugin distribution ([bf79fcb](https://github.com/minipuft/claude-prompts/commit/bf79fcb56a38d2829f88e5365a5042494d2eba23))
- add streamable http transport and release automation ([0717f31](https://github.com/minipuft/claude-prompts/commit/0717f31ae503c19824fdd14fb05394197b8b11a9))
- Add symbolic command language and operator executors ([639f86a](https://github.com/minipuft/claude-prompts/commit/639f86a4aeeae925c0b916cffc297d4253c8ed6f))
- **dist:** separate public and private prompts for distribution ([fee7c12](https://github.com/minipuft/claude-prompts/commit/fee7c12e21c5b525501764f74fbff80ace08805a))
- enhance README with interactive prompt management features ([13afaa9](https://github.com/minipuft/claude-prompts/commit/13afaa968bc2330f80a183a71f7eb367dc40c3f6))
- enhance server startup options and help documentation ([f315f33](https://github.com/minipuft/claude-prompts/commit/f315f331cbf1112a5d5163018cfbd0bfc23cd413))
- **gates:** implement intelligent gate selection with 5-level precedence system ([b8e1c11](https://github.com/minipuft/claude-prompts/commit/b8e1c11a3bf8a411f65448812112e7c2555a9c8e))
- **gemini:** add Gemini CLI extension support ([50587c6](https://github.com/minipuft/claude-prompts/commit/50587c61fa922eee5400614bde24ec3bf9103cbe))
- **gemini:** align hooks with Claude plugin infrastructure ([c35e4f0](https://github.com/minipuft/claude-prompts/commit/c35e4f0d678d1bd3c36725f9ede1b7a191bab785))
- **hooks:** auto-regenerate contracts on source change ([9b21afa](https://github.com/minipuft/claude-prompts/commit/9b21afa192cddf42bd43d46a02a9557ee00c4d2b))
- implement enterprise-grade CI/CD pipeline with comprehensive testing framework ([#10](https://github.com/minipuft/claude-prompts/issues/10)) ([25e7f59](https://github.com/minipuft/claude-prompts/commit/25e7f59d41801bc4cc4cb6d01158c262d2064b9a))
- implement Phase 1 - Enhanced Category Parsing System ([1506755](https://github.com/minipuft/claude-prompts/commit/150675589e650d5a06d018e7884658a31965dcf2))
- multi-platform extension support with enhanced hooks and gate system ([27b94ec](https://github.com/minipuft/claude-prompts/commit/27b94ecb3946a3a5a227fe5c0dbbbe8792b7cc71))
- **parser:** enhance case-insensitive prompt matching and add strategic implementation ([628b09c](https://github.com/minipuft/claude-prompts/commit/628b09c3e7b6017317eaa966de9b6fd756f77e15))
- **plugin:** add server/resources directory for plugin deployment ([2d21a86](https://github.com/minipuft/claude-prompts/commit/2d21a864a278a3c7a3abbcb4e53843ae65b39ea5))
- **plugin:** add SessionStart hook for dependency installation ([3896fb9](https://github.com/minipuft/claude-prompts/commit/3896fb9b967fe8761ef8f1ee0f4d2d84bf1ec139))
- **plugin:** persist user data outside cache directory ([e59c64b](https://github.com/minipuft/claude-prompts/commit/e59c64b5fc37e989783db8070cceaab320e7be4f))
- **plugin:** unify plugin with YAML resources, version history, and script tools ([0963d4a](https://github.com/minipuft/claude-prompts/commit/0963d4ac56da09dc35d08fc3070c4b846b191fb1))
- **ralph:** context isolation for long-running verification loops ([f1c1014](https://github.com/minipuft/claude-prompts/commit/f1c1014f75dc719d919013dd3dbd9219d2900fe6))
- re-introduce hot-reloading for prompots ([720f96b](https://github.com/minipuft/claude-prompts/commit/720f96b9810a2e3675eb305b3e69683a64bb3982))
- release 1.2.0 with CI validation and gate refactoring ([75ec3e8](https://github.com/minipuft/claude-prompts/commit/75ec3e83e06e6c7753045778d770fc80773e77e0))
- shell verification presets and checkpoint resource type ([ca24027](https://github.com/minipuft/claude-prompts/commit/ca240274e3df495f87879b28e5492c4289cfb489))
- **styles:** add style operator (#) for response formatting ([d2c3173](https://github.com/minipuft/claude-prompts/commit/d2c3173ad4d7edb758207460d56167dd7bc4336b))
- update documentation for version 1.1.0 - "Intelligent Execution" ([7e1fb3f](https://github.com/minipuft/claude-prompts/commit/7e1fb3f02a226b232464a5ae98132d25344813dd))

### Bug Fixes

- add missing nunjucks dependency for template processing ([4f78114](https://github.com/minipuft/claude-prompts/commit/4f781144de43b72d0b29603337ba44d4ba61bb2a))
- add required metadata for plugin menu navigation ([72cd845](https://github.com/minipuft/claude-prompts/commit/72cd845e96cd04c37ec32eb1584f17f8c57e03b2))
- **ci:** consolidate workflows and fix Docker paths ([42efb12](https://github.com/minipuft/claude-prompts/commit/42efb126455c16ac46ba349091977351eb337f82))
- **ci:** skip action inventory verification for bundled builds ([dd299e5](https://github.com/minipuft/claude-prompts/commit/dd299e5f65fe3ffe2184debf659b7a764b176fb0))
- **ci:** update extension-publish workflow for bundled distribution ([8d977e9](https://github.com/minipuft/claude-prompts/commit/8d977e9c4daa8b8b7a6796bd66e6164ece662f86))
- clear lint regressions ([77db53a](https://github.com/minipuft/claude-prompts/commit/77db53a850a93f5fd1b41fe53dc21cd2a258454f))
- **contracts:** add prettier formatting to contract generator ([6096c67](https://github.com/minipuft/claude-prompts/commit/6096c67aa1151f402670081c8871237a2c9888ef))
- **contracts:** format all generated TypeScript files ([0e4c9af](https://github.com/minipuft/claude-prompts/commit/0e4c9aff57867ac46e905fc1e3be4e58b271a946))
- correct marketplace.json schema (source not path) ([6d08e63](https://github.com/minipuft/claude-prompts/commit/6d08e63f06bb6cb6c20a438d23823174e4c24bfb))
- correct source path (relative to marketplace.json) ([e281b48](https://github.com/minipuft/claude-prompts/commit/e281b48728fe3c390058fdaf1126c4811e04ea7c))
- **deps:** add missing 'diff' dependency for text-diff-service ([12b70db](https://github.com/minipuft/claude-prompts/commit/12b70dbfb0f5a53be24c084cd6505133f4458fd5))
- **docker:** update Dockerfile for renamed docs and styles directory ([35144c8](https://github.com/minipuft/claude-prompts/commit/35144c8905c00c5d2a2901a20796ecab4904d1aa))
- **docs:** remove invalid color property from mermaid linkStyle ([d086ca1](https://github.com/minipuft/claude-prompts/commit/d086ca1ee22818c93d427b93d830463c9bb49d37))
- **gemini:** align extension with Claude plugin v1.1.1 ([fb3413c](https://github.com/minipuft/claude-prompts/commit/fb3413c399956ab510f140db8c8802d8938714cb))
- **gemini:** resolve symlinks before path calculation ([77da3bc](https://github.com/minipuft/claude-prompts/commit/77da3bc655a8fdee67b301ec47f993763ce42bcb))
- **hooks:** add quick-check mode to prevent SessionStart blocking ([c4b3f94](https://github.com/minipuft/claude-prompts/commit/c4b3f94d5d1be5b579a25f825f6633e7937cf129))
- **hooks:** make dev-sync portable across environments ([4aa1190](https://github.com/minipuft/claude-prompts/commit/4aa119040f21669c2f5e52e7810ed32198f547dc))
- **npm:** Include methodologies folder in published package ([9bad683](https://github.com/minipuft/claude-prompts/commit/9bad68308e017bc0c362e28f7829d3220bcd7116))
- **plugin:** correct .mcp.json schema and improve dev workflow ([9927529](https://github.com/minipuft/claude-prompts/commit/99275299847de16f1bd42d13525e8cd4c662e624))
- **plugin:** include server/dist for plugin installation ([5f1edd3](https://github.com/minipuft/claude-prompts/commit/5f1edd3ed144e27a3380ea2d8e52890b78a836c5))
- **plugin:** remove duplicate hooks reference causing load failure ([c6c3ca6](https://github.com/minipuft/claude-prompts/commit/c6c3ca648110e216b630829abab947d88cd036ac))
- prune useless prompts ([daec104](https://github.com/minipuft/claude-prompts/commit/daec104cecf6719a080af777899849e2d8493156))
- regenerate contract artifacts and update lint baseline ([0a0e67d](https://github.com/minipuft/claude-prompts/commit/0a0e67d9d62c74e552bb69bcad00299e5e1b23b3))
- **release:** correct release-please config paths ([20662ec](https://github.com/minipuft/claude-prompts/commit/20662ecb89f5ff84c8baea6321774141b049eca7))
- Remove accidentally committed node_modules, update .gitignore ([ed452ac](https://github.com/minipuft/claude-prompts/commit/ed452acd60df2c76d94c43eceb09a66a42edf386))
- return simple text responses for MCP tool visibility in Claude Code ([7980567](https://github.com/minipuft/claude-prompts/commit/7980567d540c04390eb90c44d7c3ed1345394291))
- source must start with ./ ([b2482f1](https://github.com/minipuft/claude-prompts/commit/b2482f1dc79ec65b3e60d7d0192624e18a8a71ee))
- source path relative to repo root ([f2e3020](https://github.com/minipuft/claude-prompts/commit/f2e302058137a49bd2bc195cccc87b71973a38b9))

### Miscellaneous Chores

- prepare 1.3.0 release ([225ebe6](https://github.com/minipuft/claude-prompts/commit/225ebe6da4bb8f5c13ab6d750690249e0ed9502b))

## [1.2.0] - 2025-01-12

### Added

- CI validation and gate refactoring improvements
- Release automation in CONTRIBUTING.md

## [1.1.0] - 2025-01-10

### Added

- Initial public release with MCP server, prompts, gates, and frameworks

[Unreleased]: https://github.com/minipuft/claude-prompts/compare/v1.7.0...HEAD
[1.5.0]: https://github.com/minipuft/claude-prompts/compare/v1.4.5...v1.5.0
[1.4.5]: https://github.com/minipuft/claude-prompts/compare/v1.4.4...v1.4.5
[1.4.4]: https://github.com/minipuft/claude-prompts/compare/v1.4.2...v1.4.4
[1.4.2]: https://github.com/minipuft/claude-prompts/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/minipuft/claude-prompts/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/minipuft/claude-prompts/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/minipuft/claude-prompts/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/minipuft/claude-prompts/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/minipuft/claude-prompts/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/minipuft/claude-prompts/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/minipuft/claude-prompts/releases/tag/v1.1.0
