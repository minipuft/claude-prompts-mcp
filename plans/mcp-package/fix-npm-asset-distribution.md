# Fix NPM Package Asset Distribution

## Problem Statement

When installing `claude-prompts-server` via npm/npx, the server fails with:
```
FATAL: Methodology 'cageerf' not found. Expected: methodologies/cageerf/methodology.yaml
```

## Root Cause Analysis

### Issue 1: RuntimeMethodologyLoader Path Resolution Bug
- **VERIFIED**: Methodologies ARE in published v1.3.5 tarball ✓
- **VERIFIED**: `files` array includes `methodologies` ✓
- **THE BUG**: `RuntimeMethodologyLoader.resolveMethodologiesDir()` path walk-up fails in npx context
  - npx installs to `~/.npm/_npx/{hash}/node_modules/claude-prompts-server/`
  - `__dirname` resolves to `.../dist/frameworks/methodology/`
  - Walk-up only goes 6 levels - not enough for npx cache depth

### Issue 2: Gates Definitions NOT Bundled (Deeper Infrastructure Problem)
- Gate definitions exist at `src/gates/definitions/*.json`
- These JSON files are **NOT**:
  - Copied to `dist/` during build (TypeScript ignores them)
  - Listed in `files` array
  - Available in the npm package
- **Hardcoded paths** assume development structure:
  - `src/gates/core/gate-loader.ts:48`: `path.join(process.cwd(), 'src/gates/definitions')`
  - `src/mcp-tools/prompt-engine/core/prompt-execution-service.ts:164`: `path.resolve(this.serverRoot, 'src/gates/definitions')`
  - `config.json`: `"definitionsDirectory": "src/gates/definitions"`

---

## Solution

### Phase 1: Fix RuntimeMethodologyLoader Path Resolution (URGENT)

**Status**: [ ] Not started

The walk-up algorithm fails because it only goes 6 levels up from `dist/frameworks/methodology/`, but the npx cache structure puts `node_modules` deeper.

**Fix**: Add package.json-based resolution strategy (mirrors ServerRootDetector):

```typescript
// In resolveMethodologiesDir()
// NEW Priority 1: Find package.json with matching name
private resolveFromPackageJson(): string | null {
  const __filename = fileURLToPath(import.meta.url);
  let dir = dirname(__filename);
  for (let i = 0; i < 10; i++) {  // Increase depth to 10
    const pkgPath = join(dir, 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg.name === 'claude-prompts-server') {
        const methodologiesPath = join(dir, 'methodologies');
        if (existsSync(methodologiesPath)) {
          return methodologiesPath;
        }
      }
    } catch {}
    dir = dirname(dir);
  }
  return null;
}
```

**File to modify:**
- `server/src/frameworks/methodology/runtime-methodology-loader.ts`

---

### Phase 2: Gates Infrastructure Migration (YAML-based)

**Status**: [ ] Not started

Create `RuntimeGateLoader` mirroring `RuntimeMethodologyLoader`:

**New folder structure:**
```
server/
├── methodologies/     # (existing)
├── gates/             # (NEW - root level)
│   ├── code-quality/
│   │   └── gate.yaml
│   ├── content-structure/
│   │   └── gate.yaml
│   ├── educational-clarity/
│   │   └── gate.yaml
│   ├── framework-compliance/
│   │   └── gate.yaml
│   ├── methodology-validation/
│   │   └── gate.yaml
│   ├── research-quality/
│   │   └── gate.yaml
│   ├── security-awareness/
│   │   └── gate.yaml
│   └── technical-accuracy/
│       └── gate.yaml
```

**Key components:**
1. `RuntimeGateLoader` - Multi-strategy path resolution (mirrors methodology loader)
2. `gate-schema.ts` - Zod validation for YAML gate definitions
3. Convert JSON → YAML for all 8 gate definitions
4. Update `GateLoader` to use `RuntimeGateLoader` as backend

---

### Phase 3: Cleanup

**Status**: [ ] Not started

- [ ] Delete `src/gates/definitions/*.json` (replaced by YAML)
- [ ] Remove hardcoded paths from `prompt-execution-service.ts`

---

## Files to Modify

### Phase 1 (Immediate Fix)
| File | Change | Status |
|------|--------|--------|
| `src/frameworks/methodology/runtime-methodology-loader.ts` | Add package.json resolution strategy | [ ] |

### Phase 2 (Gates Migration)
| File | Change | Status |
|------|--------|--------|
| `package.json` | Add `gates` to `files` array | [ ] |
| `config.json` | Update `gates.definitionsDirectory` to `gates` | [ ] |
| NEW: `src/gates/core/runtime-gate-loader.ts` | RuntimeGateLoader class | [ ] |
| NEW: `src/gates/core/gate-schema.ts` | Zod schema for YAML validation | [ ] |
| `src/gates/core/gate-loader.ts` | Integrate RuntimeGateLoader | [ ] |
| NEW: `gates/{id}/gate.yaml` (x8) | YAML gate definitions | [ ] |
| NEW: `scripts/validate-gates.js` | CI validation script | [ ] |

### Phase 3 (Cleanup)
| File | Change | Status |
|------|--------|--------|
| DELETE: `src/gates/definitions/*.json` | Replaced by YAML | [ ] |
| `src/mcp-tools/prompt-engine/core/prompt-execution-service.ts` | Remove hardcoded path | [ ] |

---

## Validation Checklist

- [ ] `npm run build` - Passes
- [ ] `npm test` - Passes
- [ ] `npm run validate:gates` - New validation passes
- [ ] `npm pack --dry-run` - Verify tarball contains:
  - `methodologies/**/*.yaml`
  - `gates/**/*.yaml`
  - `prompts/**`
- [ ] **npx test**: `npx -y claude-prompts-server@latest --startup-test --verbose`

---

## Version Bump

- **v1.3.6**: After Phase 1 fix (urgent - fixes npm install)
- **v1.4.0**: After Phase 2 complete (gates migration = minor version)

---

## References

- `ServerRootDetector` in `src/runtime/startup.ts` - Reference for package.json resolution
- `RuntimeMethodologyLoader` in `src/frameworks/methodology/runtime-methodology-loader.ts` - Pattern for RuntimeGateLoader
- Existing gate definitions in `src/gates/definitions/*.json` - Source for YAML conversion
