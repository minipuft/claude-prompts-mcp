# Methodology Loader Cleanup Plan

## Overview

**Goal**: Remove legacy JSON operations from `methodology-loader.ts` and simplify to a thin wrapper around `RuntimeMethodologyLoader`, eliminating code duplication and dead paths.

**Priority**: Medium (technical debt cleanup)
**Estimated Effort**: 1-2 hours

---

## Current State Analysis

### Problem Statement

After implementing runtime YAML loading (Phase 1-5 of `runtime-yaml-loading-plan.md`), the `methodology-loader.ts` file contains legacy JSON operations that are:
1. Rarely executed (RuntimeMethodologyLoader takes priority)
2. Adding unnecessary complexity
3. Maintaining dead code paths
4. Duplicating path resolution logic

### Files Involved

| File | Role | Status |
|------|------|--------|
| `src/frameworks/methodology/methodology-loader.ts` | Legacy JSON loader with YAML forwarding | **Removed** |
| `src/frameworks/methodology/runtime-methodology-loader.ts` | Runtime YAML loader | Canonical implementation |
| `src/frameworks/methodology/index.ts` | Barrel exports | May need updates |
| `src/frameworks/methodology/registry.ts` | Uses loaders | Consumer - verify still works |

### Legacy Code to Remove

#### 1. `getMethodologiesDir()` Function (Lines 117-164)
```typescript
// Complex path resolution for dist/methodologies/*.json
// - Walks up directory tree looking for .json files
// - Uses MCP_SERVER_ROOT environment variable
// - Multiple fallback paths
// NOT NEEDED: RuntimeMethodologyLoader handles its own path resolution for YAML
```

#### 2. JSON Fallback in `loadMethodology()` (Lines 214-238)
```typescript
// Falls back to reading compiled JSON files
// - Uses getMethodologiesDir()
// - Reads .json files from dist/methodologies/
// - Parses and validates JSON
// NOT NEEDED: RuntimeMethodologyLoader loads YAML directly
```

#### 3. `listMethodologies()` Function (Lines 245-260)
```typescript
// Only lists .json files in dist/methodologies/
// - Filters for .json extension
// - Ignores manifest.json
// PROBLEM: Doesn't discover YAML-based methodologies
// SOLUTION: Delegate to RuntimeMethodologyLoader.discoverMethodologies()
```

#### 4. `methodologyExists()` Function (Lines 293-305)
```typescript
// Checks for .json file existence
// PROBLEM: Doesn't check YAML source
// SOLUTION: Delegate to RuntimeMethodologyLoader.methodologyExists()
```

### What to Keep

1. **Type Definitions** - `MethodologyDefinition`, `MethodologyGateDefinition`, etc.
   - These are used across the codebase
   - Option A: Keep in methodology-loader.ts
   - Option B: Move to dedicated `methodology-types.ts` (cleaner)

2. **Exported API** - Function signatures for backwards compatibility
   - `loadMethodology(id)`
   - `listMethodologies()`
   - `loadAllMethodologies()`
   - `clearMethodologyCache()`
   - `methodologyExists(id)`

3. **Cache** - `methodologyCache` Map
   - RuntimeMethodologyLoader has its own cache
   - Option: Remove duplicate cache, use RuntimeMethodologyLoader's cache

---

## Implementation Plan

### Phase 1: Extract Types to Dedicated File

**Goal**: Separate type definitions from loader implementation

**Create**: `src/frameworks/methodology/methodology-definition-types.ts`

```typescript
// @lifecycle canonical - Type definitions for methodology system
/**
 * Methodology Definition Types
 *
 * Shared type definitions used by both legacy and runtime loaders.
 */

export interface MethodologyDefinition {
  id: string;
  name: string;
  methodology: string;
  version: string;
  enabled: boolean;
  systemPromptGuidance: string;
  gates?: {
    include?: string[];
    exclude?: string[];
  };
  methodologyGates?: MethodologyGateDefinition[];
  templateSuggestions?: TemplateSuggestionDefinition[];
  methodologyElements?: MethodologyElementsDefinition;
  argumentSuggestions?: ArgumentSuggestionDefinition[];
  toolDescriptions?: MethodologyToolDescriptions;
  phases?: PhasesDefinition & {
    qualityIndicators?: PhaseQualityIndicators;
  };
  judgePrompt?: JudgePromptDefinition;
}

export interface MethodologyGateDefinition { /* ... */ }
export interface TemplateSuggestionDefinition { /* ... */ }
export interface MethodologyElementsDefinition { /* ... */ }
export interface ArgumentSuggestionDefinition { /* ... */ }
```

**Update**: `src/frameworks/methodology/index.ts`
- Export types from new file
- Maintain backwards-compatible re-exports from methodology-loader.ts

### Phase 2: Simplify methodology-loader.ts

**Goal**: Remove all JSON operations, delegate to RuntimeMethodologyLoader

**Before** (306 lines):
```typescript
// Complex loader with:
// - getMethodologiesDir() path resolution
// - JSON file reading
// - Multiple fallback paths
// - Duplicate caching
```

**After** (~80 lines):
```typescript
// @lifecycle deprecated - Thin wrapper, use RuntimeMethodologyLoader directly
/**
 * Methodology Loader (Legacy Wrapper)
 *
 * Provides backwards-compatible API that delegates to RuntimeMethodologyLoader.
 * New code should import from RuntimeMethodologyLoader directly.
 *
 * @deprecated Import from RuntimeMethodologyLoader for new code
 */

import {
  RuntimeMethodologyLoader,
  getDefaultRuntimeLoader
} from './runtime-methodology-loader.js';

// Re-export types for backwards compatibility
export type {
  MethodologyDefinition,
  MethodologyGateDefinition,
  // ... etc
} from './methodology-definition-types.js';

/**
 * @deprecated Use RuntimeMethodologyLoader.loadMethodology() directly
 */
export function loadMethodology(methodologyId: string): MethodologyDefinition | undefined {
  return getDefaultRuntimeLoader().loadMethodology(methodologyId);
}

/**
 * @deprecated Use RuntimeMethodologyLoader.discoverMethodologies() directly
 */
export function listMethodologies(): string[] {
  return getDefaultRuntimeLoader().discoverMethodologies();
}

/**
 * @deprecated Use RuntimeMethodologyLoader.loadAllMethodologies() directly
 */
export function loadAllMethodologies(): Map<string, MethodologyDefinition> {
  return getDefaultRuntimeLoader().loadAllMethodologies();
}

/**
 * @deprecated Use RuntimeMethodologyLoader.clearCache() directly
 */
export function clearMethodologyCache(): void {
  getDefaultRuntimeLoader().clearCache();
}

/**
 * @deprecated Use RuntimeMethodologyLoader.methodologyExists() directly
 */
export function methodologyExists(methodologyId: string): boolean {
  return getDefaultRuntimeLoader().methodologyExists(methodologyId);
}
```

### Phase 3: Update Consumers

**Goal**: Ensure all consumers work with simplified loader

**Files to Check**:
1. `src/frameworks/methodology/registry.ts` - Uses loadMethodology, listMethodologies
2. `src/frameworks/methodology/generic-methodology-guide.ts` - Uses MethodologyDefinition type
3. `src/mcp-tools/system-control.ts` - May use loader functions
4. Any tests that mock or use methodology loader

**Actions**:
- Verify each consumer still works
- Update imports if needed (types from new location)
- Run tests to confirm no regressions

### Phase 4: Remove dist/methodologies JSON Output

**Goal**: Stop generating compiled JSON files (no longer needed)

**Update**: `scripts/build-methodologies.js`
- Already deprecated in Phase 5 of runtime-yaml-loading-plan.md
- Confirm it no longer generates JSON to dist/methodologies/
- Consider deleting the script entirely or keeping as archive

**Update**: `.gitignore`
- Add `dist/methodologies/` if not already ignored

**Clean up**: Remove any existing `dist/methodologies/*.json` files

### Phase 5: Update Documentation

**Goal**: Document the new architecture

**Update**: `docs/architecture.md`
- Remove references to compiled JSON methodology loading
- Document RuntimeMethodologyLoader as canonical

**Update**: `CLAUDE.md`
- Update methodology loading section if present

---

## Testing Requirements

### Unit Tests

```bash
# Run existing methodology tests
npm test -- --grep "methodology"

# Specific tests to verify:
# - RuntimeMethodologyLoader loads all 4 methodologies
# - listMethodologies() returns correct IDs
# - methodologyExists() works for valid/invalid IDs
# - clearMethodologyCache() clears and reload works
# - Registry initializes with runtime-loaded methodologies
```

### Integration Tests

```bash
# Test framework system end-to-end
npm run start:stdio
# Then via MCP tools:
# - system_control(action:"framework", operation:"list")
# - system_control(action:"framework", operation:"list_methodologies")
# - prompt_engine(command:">>analytical @ReACT")
```

### Verification Checklist

- [ ] All 4 methodologies load (5w1h, cageerf, react, scamper)
- [ ] Framework switching with `@` operator works
- [ ] Methodology gates appear in prompts
- [ ] Hot reload works (modify YAML, see changes)
- [ ] Registry stats show `yaml-runtime` source
- [ ] No errors in server logs during startup
- [ ] `npm run validate:methodologies` passes

---

## Rollback Plan

If issues arise:
1. Revert methodology-loader.ts changes
2. Keep type extraction (non-breaking)
3. RuntimeMethodologyLoader continues to work independently

---

## Success Criteria

- [x] Legacy `methodology-loader.ts` removed; runtime loader is the sole path
- [x] All JSON file operations removed
- [x] Types extracted to dedicated file (`methodology-definition-types.ts`)
- [x] All existing tests pass
- [x] Framework system works identically to before
- [x] No `dist/methodologies/*.json` files generated or needed

---

## Future Considerations

1. **Ensure no reintroduction of legacy loaders**: Block new imports of removed `methodology-loader.ts`; keep runtime loader as the only path.
2. **Prompts YAML Migration**: The YAML utilities created for methodologies (`src/utils/yaml/`) can be reused when migrating prompts from JSON to YAML format.
3. **Unified Loader Pattern**: Consider if prompts and methodologies could share more infrastructure (hot reload, validation, etc.)

---

## Files Changed Summary

| Action | File |
|--------|------|
| CREATE | `src/frameworks/methodology/methodology-definition-types.ts` |
| DELETE | `src/frameworks/methodology/methodology-loader.ts` (legacy wrapper) |
| DELETE | `scripts/build-methodologies.js` (legacy JSON build script) |
| MODIFY | `src/frameworks/methodology/index.ts` (runtime-only exports) |
| MODIFY | `docs/architecture.md` |
| MODIFY | `.gitignore` |
| VERIFY | `src/frameworks/methodology/registry.ts` |
| VERIFY | `src/frameworks/methodology/generic-methodology-guide.ts` |

---

**Plan Created**: 2025-01-29
**Status**: ✅ COMPLETED (runtime YAML canonical; legacy wrapper removed)

## Implementation Notes

### Changes Made

1. **Phase 1**: Confirmed canonical type definitions live in `src/frameworks/methodology/methodology-definition-types.ts`
2. **Phase 2**: Removed legacy `methodology-loader.ts`; runtime loader is the sole implementation path
3. **Phase 3**: Registry/generic guides rely on runtime YAML loading with streamlined barrel exports
4. **Phase 4**: Deleted `scripts/build-methodologies.js`; validation handled by `scripts/validate-methodologies.js`
5. **Phase 5**: Updated documentation/plan status to reflect runtime YAML as canonical

### Additional Changes

- Updated `src/frameworks/utils/template-enhancer.ts` to import types from canonical source
- Updated `src/frameworks/utils/index.ts` to avoid duplicate type exports
- Resolved type conflicts in barrel exports
- Removed compatibility exports tied to the legacy wrapper; runtime loader only
- Ignored `server/dist/methodologies/` artifacts and documented runtime YAML loading in `docs/architecture.md`

### Files Changed

| Action | File |
|--------|------|
| CREATE | `src/frameworks/methodology/methodology-definition-types.ts` |
| CREATE | `src/frameworks/methodology/methodology-loader.ts` |
| CREATE | `src/frameworks/methodology/methodology-definition-types.ts` |
| MODIFY | `src/frameworks/methodology/index.ts` |
| MODIFY | `scripts/build-methodologies.js` |
| MODIFY | `docs/architecture.md` |
| MODIFY | `.gitignore` |
| VERIFY | `src/frameworks/methodology/registry.ts` |
| VERIFY | `src/frameworks/methodology/generic-methodology-guide.ts` |
