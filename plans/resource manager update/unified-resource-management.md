# Unified Resource Management — Implementation Plan

## Goal

Unify the creation, registration, modification, and hot-reload patterns for **prompts**, **gates**, and **methodologies** into a cohesive resource management system.

## Current Architecture Gap

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CURRENT STATE                                │
├─────────────────┬─────────────────┬─────────────────────────────────┤
│ PROMPTS         │ GATES           │ METHODOLOGIES                   │
├─────────────────┼─────────────────┼─────────────────────────────────┤
│ JSON + Markdown │ YAML + Markdown │ YAML + refs                     │
│ No caching      │ Cached          │ Cached                          │
│ Inline valid.   │ Zod schema      │ Zod schema                      │
│ prompt_manager  │ (no MCP tool)   │ (no MCP tool)                   │
│ List-level HR   │ Item-level HR   │ Item-level HR                   │
└─────────────────┴─────────────────┴─────────────────────────────────┘
```

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TARGET STATE                                 │
├─────────────────────────────────────────────────────────────────────┤
│                    ResourceManager (MCP Tool)                       │
│         create | update | delete | list | inspect | reload          │
├─────────────────────────────────────────────────────────────────────┤
│                    RuntimeDefinitionLoader<T>                       │
│    Abstract base: discover → load → inline → validate → cache       │
├─────────────────┬─────────────────┬─────────────────────────────────┤
│ PromptLoader    │ GateLoader      │ MethodologyLoader               │
│ (YAML + MD)     │ (YAML + MD)     │ (YAML + refs)                   │
├─────────────────┴─────────────────┴─────────────────────────────────┤
│                    BaseRegistry<T>                                  │
│      register | get | getAll | reload | setEnabled | remove         │
├─────────────────┬─────────────────┬─────────────────────────────────┤
│ PromptRegistry  │ GateRegistry    │ MethodologyRegistry             │
├─────────────────┴─────────────────┴─────────────────────────────────┤
│                    HotReloadCoordinator                             │
│          Unified file watching + cache invalidation                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Foundation (No Breaking Changes) ✅ COMPLETED

**Goal**: Improve prompts system to match gates/methodologies rigor without format changes.

**Completed**: December 2025

### 1.1 Add Zod Schema for Prompts ✅

- [x] Created `server/src/prompts/prompt-schema.ts`
- [x] Defined `PromptDataSchema`, `PromptArgumentSchema`, `ChainStepSchema`, `CategorySchema`
- [x] Added `validatePromptSchema()`, `validatePromptsFile()`, `validatePromptsConfig()` functions
- [x] Type guards: `isValidPromptData()`, `isValidCategory()`
- [x] Exported from `server/src/prompts/index.ts`

### 1.2 Add Caching to PromptLoader ✅

- [x] Added `PromptLoaderConfig` with `enableCache`, `debug` options
- [x] Implemented `promptFileCache: Map<string, LoadedPromptFile>`
- [x] Added `clearCache(filePath?: string)` method
- [x] Added `getStats()` returning `PromptLoaderStats`
- [x] Added `isCacheEnabled()`, `setCacheEnabled()` runtime controls
- [x] Cache integrates with hot reload (call `clearCache()` on file changes)

### 1.3 Create Shared Resource Loader Types ✅

- [x] Created `server/src/utils/resource-loader-types.ts`
- [x] Defined shared interfaces: `BaseLoaderConfig`, `YamlLoaderConfig`, `BaseLoaderStats`
- [x] Defined `ResourceLoaderInterface<T>` for consistency across loaders
- [x] Added `ResourceCache<T>` utility class for reusable caching
- [x] Added validation types: `ResourceValidationResult`, `ResourceValidationResultWithData<T>`
- [x] Exported from `server/src/utils/index.ts`

### 1.4 Unify Registry Interface ✅

- [x] Created `IBaseRegistry<T>` interface in `resource-loader-types.ts`
- [x] Methods: `initialize()`, `register()`, `unregister()`, `get()`, `getAll()`, `getAllIds()`, `has()`, `setEnabled()`, `isEnabled()`, `getStats()`, `clear()`, `reload?()`, `reloadAll?()`
- [x] Defined `BaseRegistryStats`, `RegistryEntry<T>` types
- [x] Created `SimpleRegistry<T>` reference implementation
- [x] Pattern documented for existing registries to adopt incrementally

**Deliverables**:

- ✅ Prompts have Zod validation (parity with gates/methodologies)
- ✅ Prompts have caching (parity with gates/methodologies)
- ✅ Shared types and interfaces ready for Phase 2

---

## Phase 2: Format Unification ✅ COMPLETE

**Goal**: Migrate prompts from JSON+MD to YAML+MD format.
**Completed**: December 2025

### 2.1 Design Prompt YAML Schema ✅

- [x] Define `prompt.yaml` structure (implemented in `prompt-schema.ts`)
- [x] Create Zod schema for YAML validation (`PromptYamlSchema`)
- [x] Support both inline content and file references
- [x] `validatePromptYaml()` function with ID matching and warnings
- [x] `isValidPromptYaml()` type guard

### 2.2 Create Migration Script ✅

- [x] `scripts/migrate-prompts-to-yaml.js` (ESM JavaScript)
- [x] Read existing `prompts.json` + `.md` files
- [x] Generate `prompt.yaml` + referenced `.md` files
- [x] Preserve all metadata and content (including gateConfiguration)
- [x] Validate output against new schema
- [x] Supports `--dry-run`, `--category=<cat>`, `--verbose`, `--force` flags

### 2.3 Update PromptLoader for YAML ✅

- [x] Add YAML loading capability to `PromptLoader`
- [x] `discoverYamlPrompts()` - find prompt directories AND single files
- [x] `loadYamlPrompt()` - load YAML prompt (directory or single-file format)
- [x] `loadAllYamlPrompts()` - load all YAML prompts from category
- [x] `hasYamlPrompts()` - check for YAML format presence
- [x] Caching support for YAML prompts
- [x] **Hybrid pattern support** (added Dec 2025):
  - Single-file format: `{category}/{id}.yaml` (inline content)
  - Directory format: `{category}/{id}/prompt.yaml` (external refs)
  - Directory takes precedence if both exist

### 2.4 Update prompt_manager Tool ⏳ (Deferred)

- [ ] `create` action generates YAML format
- [ ] `update` action modifies YAML files
- [ ] `delete` action removes YAML directory
- [ ] Maintain backward compatibility during transition
- **Note**: Deferred to follow-up work. Current JSON format remains functional.

### 2.5 Migration Execution ✅ COMPLETE

- [x] Migration script tested on `analysis` category (9 prompts migrated)
- [x] Generated YAML structure verified correct
- [x] File references (`systemMessageFile`, `userMessageTemplateFile`) working
- [x] Gate configuration preserved in migration
- [x] Full migration of all categories (36 prompts total: 27 newly migrated + 9 existing)
- [x] Loader integrated with YAML discovery in `loadCategoryPrompts()`
- [x] JSON prompt entries cleared - YAML is now primary format
- [x] All 35 prompts loading successfully from YAML format

**Deliverables**:

- ✅ `PromptYamlSchema` in `prompt-schema.ts`
- ✅ `validatePromptYaml()` function
- ✅ Migration script `scripts/migrate-prompts-to-yaml.js`
- ✅ YAML loading methods in `PromptLoader`
- ✅ Full migration complete (all categories)
- ✅ `loadCategoryPrompts()` integrated with YAML discovery
- ⏳ `prompt_manager` YAML output (deferred to Phase 3)

---

## Phase 3: MCP Tool Unification ✅ COMPLETE

**Goal**: Expose gates and methodologies via MCP tools matching `prompt_manager` pattern.
**Completed**: December 2025

### 3.0 Complete YAML Migration Cleanup (Priority)

- [ ] **Fix prompt_manager delete bug**: Check for YAML prompts before removing category
- [ ] **Update prompt_manager CRUD for YAML**:
  - [ ] `create`: Generate YAML directory structure instead of JSON+MD
  - [ ] `update`: Modify YAML files directly
  - [ ] `delete`: Remove YAML directory, only remove category if truly empty
- [x] **Remove legacy JSON prompt files** (Completed Dec 2025):
  - [x] Deleted 36 migrated `*.md` prompt files (content now in YAML directories)
  - [x] Deleted 10 orphaned `*.md` files (unused/deprecated)
  - [x] `prompts.json` files kept empty (for backward compatibility)
  - [ ] Document migration complete in CHANGELOG

### 3.1 Create gate_manager MCP Tool ✅

- [x] Actions: `create`, `update`, `delete`, `list`, `inspect`, `reload`
- [x] `create`: Generate `gates/{id}/gate.yaml` + `guidance.md`
- [x] `update`: Modify existing gate files
- [x] `delete`: Remove gate directory
- [x] `list`: List all registered gates
- [x] `inspect`: Show gate details
- [x] `reload`: Hot reload specific gate
- [x] Created contract: `server/tooling/contracts/gate-manager.json`
- [x] Implemented: `server/src/mcp-tools/gate-manager/` (core/manager.ts, core/types.ts)
- [x] Registered in `ConsolidatedMcpToolsManager`

### 3.2 Create framework_manager MCP Tool ✅

- [x] Actions: `create`, `update`, `delete`, `list`, `inspect`, `reload`, `switch`
- [x] `create`: Generate methodology directory with YAML + refs
- [x] `switch`: Change active framework (existing functionality)
- [x] Other actions mirror gate_manager
- [x] Created contract: `server/tooling/contracts/framework-manager.json`
- [x] Implemented: `server/src/mcp-tools/framework-manager/` (core/manager.ts, core/types.ts)
- [x] Registered in `ConsolidatedMcpToolsManager`

### 3.3 Consider Unified resource_manager ⏳ (Deferred)

- [ ] Alternative: Single tool with `resource_type` parameter
- [ ] `resource_manager(action:"create", type:"gate", ...)`
- [ ] Reduces tool count, increases consistency
- [ ] Trade-off: More complex parameter validation
- **Note**: Deferred. Separate tools (gate_manager, framework_manager) provide clearer separation.

### 3.4 Update Tool Descriptions ✅

- [x] Run `npm run generate:contracts` for new tools
- [x] Tool descriptions generated in `_generated/tool-descriptions.json`
- [ ] Add to methodology guides' `getToolDescriptions()` (follow-up)
- [ ] Update `docs/reference/mcp-tools.md` (follow-up)

**Deliverables**:

- ✅ `gate_manager` MCP tool (CRUD for gates)
- ✅ `framework_manager` MCP tool (CRUD for methodologies)
- ✅ Full parity: Claude can create/modify/delete any resource type

---

## Phase 4: Advanced Features

**Goal**: Leverage unified architecture for advanced capabilities.

### 4.1 Resource Composition

- [ ] Methodologies can include gate sets
- [ ] Prompts can embed methodology requirements

### 4.2 Cross-Resource Validation

- [ ] Validate prompt's `gateConfiguration.include` references valid gates
- [ ] Validate methodology's phase gates exist
- [ ] Surface errors at load time, not runtime

### 4.3 Resource Templates

- [ ] Built-in templates for common patterns
- [ ] `create` actions can use `--template=security-gate`
- [ ] Accelerates resource authoring

### 4.4 Export/Import

- [ ] Export resource to shareable format
- [ ] Import from GitHub URLs or npm packages
- [ ] Enable community sharing

---

## Implementation Priority

| Phase                  | Effort | Risk   | Value     | Recommendation       |
| ---------------------- | ------ | ------ | --------- | -------------------- |
| 1.1 Zod schemas        | Low    | Low    | Medium    | Do first             |
| 1.2 Caching            | Low    | Low    | Medium    | Do first             |
| 1.3 Abstract loader    | Medium | Low    | High      | Do first             |
| 1.4 Registry interface | Medium | Low    | High      | Do first             |
| 2.x YAML migration     | High   | Medium | High      | After Phase 1 stable |
| 3.x MCP tools          | Medium | Low    | Very High | After Phase 2        |
| 4.x Advanced           | High   | Medium | Medium    | Future               |

---

## Open Questions

1. **Backward compatibility**: How long to support old JSON prompt format?
2. **MCP tool naming**: Separate tools (`gate_manager`) or unified (`resource_manager`)?
3. **Template location**: Where should resource templates live? (`server/templates/`?)
4. **Validation strictness**: Fail on unknown fields or warn?

---

## Success Criteria

- [x] All three resource types use YAML + referenced files
- [x] All three have Zod schema validation
- [x] All three have caching with cache invalidation
- [x] All three have hot reload at individual resource level
- [x] All three have MCP CRUD tools
- [x] Claude can create a new gate with `gate_manager(action:"create", ...)`
- [x] Claude can create a new methodology with `framework_manager(action:"create", ...)`
- [ ] Documentation updated for new authoring patterns (follow-up)

---

## Files to Create/Modify

### Phase 1 - Completed ✅

- ✅ `server/src/prompts/prompt-schema.ts` - Zod schemas for prompt validation
- ✅ `server/src/prompts/loader.ts` - Added caching infrastructure
- ✅ `server/src/utils/resource-loader-types.ts` - Shared types, interfaces, utilities
- ✅ `server/src/prompts/index.ts` - Export prompt-schema
- ✅ `server/src/utils/index.ts` - Export resource-loader-types

### Phase 2 - Completed ✅

- ✅ `server/scripts/migrate-prompts-to-yaml.js` - Migration script (ESM JavaScript)
- ✅ `server/src/prompts/loader.ts` - YAML loading integration in `loadCategoryPrompts()`
- ✅ `server/src/prompts/prompt-schema.ts` - Added `PromptYamlSchema`, `validatePromptYaml()`
- ✅ `server/prompts/*/prompt.yaml` - All 36 prompts migrated to YAML format

### Phase 3 - Completed ✅

- ✅ `server/src/mcp-tools/gate-manager/` - Gate manager MCP tool module
  - `index.ts` - Module exports
  - `core/manager.ts` - ConsolidatedGateManager implementation
  - `core/types.ts` - Type definitions
  - `core/index.ts` - Core exports
- ✅ `server/src/mcp-tools/framework-manager/` - Framework manager MCP tool module
  - `index.ts` - Module exports
  - `core/manager.ts` - ConsolidatedFrameworkManager implementation
  - `core/types.ts` - Type definitions
  - `core/index.ts` - Core exports
- ✅ `server/tooling/contracts/gate-manager.json` - Gate manager contract
- ✅ `server/tooling/contracts/framework-manager.json` - Framework manager contract
- ✅ `server/src/mcp-tools/index.ts` - Updated to register new tools
- ✅ `server/src/metrics/analytics-service.ts` - Added adapter methods for ResponseFormatter

### Phase 4 - Future

- Resource templates directory
- Export/import utilities

---

_Plan Version: 1.4_
_Created: December 2025_
_Last Updated: December 2025_
_Status: Phase 1 Complete, Phase 2 Complete, Phase 3 Complete (gate_manager + framework_manager MCP tools), Phase 4 Pending_
