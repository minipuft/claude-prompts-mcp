# Unified Runtime YAML Loading for Methodologies & Prompts

## Summary

Eliminate the build-time YAML→JSON compilation for methodologies by implementing runtime YAML loading. Create shared YAML utilities that will also serve future prompt YAML migration.

## Key Decisions

1. **Runtime YAML** with shared utilities for both methodologies and future prompt YAML
2. **Gradual deprecation** of TypeScript guide classes (keep as fallback)
3. **Keep file-watching in src/prompts/** - methodologies import from there
4. **Accept js-yaml** as runtime dependency (~100KB acceptable)

---

## Phase 1: Shared YAML Utilities

- [x] **Complete**

**Goal**: Create runtime YAML parsing infrastructure in `src/utils/yaml/`

### Files to Create

#### `src/utils/yaml/yaml-parser.ts`
- `parseYaml<T>(content, options)` - Returns result object with success/error info
- `parseYamlOrThrow<T>(content, options)` - Throws on error
- Comprehensive error handling with line numbers and snippets

#### `src/utils/yaml/yaml-file-loader.ts`
- `loadYamlFile<T>(path, options)` - Async file loading
- `loadYamlFileSync<T>(path, options)` - Sync file loading
- `discoverYamlFiles(dirPath)` - Find YAML files in directory
- `discoverYamlDirectories(rootDir, entryPoint)` - Find subdirs with entry points

#### `src/utils/yaml/index.ts`
- Barrel exports

### Files to Modify

#### `package.json`
```diff
  "dependencies": {
+   "js-yaml": "^4.1.1"
  },
  "devDependencies": {
-   "js-yaml": "^4.1.1",
  }
```

#### `src/utils/index.ts`
```diff
+ export * from './yaml/index.js';
```

---

## Phase 2: Runtime Methodology Loader

- [x] **Complete**

**Goal**: Replace build-time compilation with runtime YAML loading

### Files to Create

#### `src/frameworks/methodology/runtime-methodology-loader.ts`
```typescript
export class RuntimeMethodologyLoader {
  loadMethodology(id: string): MethodologyDefinition | undefined
  discoverMethodologies(): string[]
  clearCache(id?: string): void
  getStats(): LoaderStats
}
```

Key features:
- Loads from `methodologies/{id}/methodology.yaml`
- Inlines referenced files (phases.yaml, judge-prompt.md)
- Validates definitions on load
- Caches results (configurable)
- Resolves methodologies dir from multiple locations

### Files to Modify

#### `src/frameworks/methodology/methodology-loader.ts` (removed)
- Legacy loader deleted; use `RuntimeMethodologyLoader` exclusively

#### `src/frameworks/methodology/registry.ts`
- Add `preferRuntimeYaml` config option
- Inject RuntimeMethodologyLoader
- Track source in guide entries (`yaml-runtime` | `json-compiled` | `typescript-fallback`)

#### `src/frameworks/methodology/index.ts`
- Export RuntimeMethodologyLoader

---

## Phase 3: Hot Reload Integration

- [x] **Complete**

**Goal**: Auto-reload methodologies when YAML files change

### Files to Modify

#### `src/prompts/file-observer.ts`
Add ~20 lines:
```typescript
private isMethodologyFile(filename: string, fullPath?: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (ext !== '.yaml' && ext !== '.yml') return false;
  return fullPath?.includes('/methodologies/') ?? false;
}

// In handleFileEvent:
if (isMethodologyFile) {
  this.emit('methodologyFileChange', event);
}
```

#### `src/prompts/hot-reload-manager.ts`
- Add `methodology_changed` event type
- Add `setMethodologyReloadCallback()`
- Handle methodology file changes, extract ID from path

### Files to Create

#### `src/frameworks/methodology/methodology-hot-reload.ts`
```typescript
export class MethodologyHotReloadCoordinator {
  handleMethodologyChange(event: HotReloadEvent): Promise<void>
}
```
- Clears loader cache
- Reloads definition from YAML
- Re-registers guide with registry

### Integration Point (startup.ts or Application)
```typescript
hotReloadManager.setMethodologyReloadCallback(
  (event) => methodologyHotReload.handleMethodologyChange(event)
);
await hotReloadManager.watchDirectories([{ path: methodologiesDir }]);
```

---

## Phase 4: TypeScript Guide Deprecation

- [x] **Complete**

**Goal**: Mark TypeScript classes as deprecated fallbacks

### Files to Modify

All guide files (`cageerf-guide.ts`, `react-guide.ts`, `5w1h-guide.ts`, `scamper-guide.ts`):

```typescript
/**
 * @lifecycle deprecated - Use data-driven YAML definition instead
 * @deprecation-version 2.0.0
 * @removal-version 3.0.0
 */
export class CAGEERFMethodologyGuide {
  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[DEPRECATED] Use YAML definition at methodologies/cageerf/');
    }
  }
}
```

---

## Phase 5: Build Script Transformation

- [x] **Complete**

**Goal**: Transform build:methodologies to validation-only

### Files to Modify

#### Legacy `scripts/build-methodologies.js` removed; use `scripts/validate-methodologies.js`
- Validate YAML syntax and schema
- Check referenced files exist
- No JSON output generation
- `--strict` flag for CI failures

#### `package.json`
```diff
- "prebuild": "npm run generate:action-metadata && npm run build:methodologies",
+ "prebuild": "npm run generate:action-metadata",
- "build:methodologies": "node scripts/build-methodologies.js",
+ "validate:methodologies": "node scripts/validate-methodologies.js",
+ "validate:all": "... && npm run validate:methodologies",
```

---

## Critical Files

| File | Action | Purpose |
|------|--------|---------|
| `src/utils/yaml/yaml-parser.ts` | Create | Core YAML parsing |
| `src/utils/yaml/yaml-file-loader.ts` | Create | File operations |
| `src/frameworks/methodology/runtime-methodology-loader.ts` | Create | Runtime loading |
| `src/frameworks/methodology/methodology-hot-reload.ts` | Create | Hot reload coordination |
| `src/prompts/file-observer.ts` | Modify | YAML file detection |
| `src/prompts/hot-reload-manager.ts` | Modify | Methodology events |
| `src/frameworks/methodology/registry.ts` | Modify | Runtime loader integration |
| `package.json` | Modify | Move js-yaml to dependencies |

---

## Implementation Order

```
Phase 1 (YAML Utils)     [BLOCKING]
         |
         v
Phase 2 (Runtime Loader) [BLOCKING]
         |
    +----+----+
    |         |
    v         v
Phase 3    Phase 4
(Hot Reload) (Deprecation)
[PARALLEL]  [PARALLEL]
    |         |
    +----+----+
         |
         v
    Phase 5
  (Build Script)
```

---

## Testing Strategy

1. **Unit tests** for YAML utilities (parse valid/invalid, error messages)
2. **Unit tests** for runtime loader (loading, caching, validation)
3. **Integration tests** for hot reload (modify file → verify registry update)
4. **Comparison test**: runtime-loaded vs build-compiled definitions identical

---

## Success Criteria

- [x] Methodologies load from YAML at runtime (no build step)
- [x] Hot reload works (<2s propagation)
- [x] TypeScript classes are fallbacks with deprecation warnings
- [x] All existing tests pass
- [x] validate:all includes methodology validation
