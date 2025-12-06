# Fix MCP Server Package Installation Failures

## Goal

Server should work with **zero flags**:
```bash
npx claude-prompts-server  # Just works!
```

Minimal Claude Desktop config:
```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts-server"]
    }
  }
}
```

## Problem Summary

The `claude-prompts-server` package fails to launch when installed via npm/npx due to multiple issues:
1. Executable permissions not set on bin entry
2. Path resolution assumes local development context
3. Hardcoded `/tmp` paths fail on Windows/restricted environments
4. **STDIO protocol corruption** - `console.log` sends to stdout, corrupting MCP JSON-RPC

---

## Root Causes Identified

### 1. CRITICAL: File Permissions (Blocking npm bin)

**File:** `server/dist/index.js`
**Issue:** Mode `644` (not executable), npm requires `755` for bin entries

```
-rw-r--r-- 1 minipuft minipuft 20731 Dec  5 19:11 dist/index.js
```

**Result:** `npm install -g` creates broken symlink, `npx` fails with "command not found"

### 2. HIGH: Hardcoded /tmp Paths

**Files with hardcoded `/tmp/`:**
- `src/config/index.ts:16` → `/tmp/config-manager.log`
- `src/mcp-tools/prompt-engine/utils/classification.ts:16` → `/tmp/prompt-classifier.log`
- `src/mcp-tools/prompt-engine/utils/validation.ts:14` → `/tmp/engine-validator.log`
- `src/mcp-tools/prompt-engine/utils/context-builder.ts:18` → `/tmp/context-builder.log`

**Result:** Fails on Windows (no `/tmp`), fails in containers with restricted temp access

### 3. HIGH: Path Resolution Assumes Development Context

**Issue:** Server root detection in `src/runtime/startup.ts` relies on:
- `process.cwd()` fallbacks that fail when run from arbitrary directory
- Relative paths in `config.json` for gates/templates directories

**Result:** When installed globally:
```
npx claude-prompts-server     # runs from /home/user/project
Expected config: /usr/lib/node_modules/claude-prompts-server/config.json
Actual lookup:   /home/user/project/config.json  # WRONG
```

### 4. MEDIUM: Missing package.json `exports` Field

**Issue:** No `exports` field defined, may cause module resolution issues in some bundlers/runtimes

### 5. CRITICAL: STDIO Protocol Corruption (console.log → stdout)

**Issue:** MCP STDIO transport requires:
- **stdout**: Reserved EXCLUSIVELY for JSON-RPC protocol messages
- **stderr**: ALL logging, debug, help messages, diagnostics

Multiple files use `console.log()` which sends to stdout and corrupts the MCP protocol.

**Files with `console.log` issues (~25 occurrences):**

| File | Lines | Issue |
|------|-------|-------|
| `src/index.ts` | 297, 407, 423, 428, 517 | Help message + CI debug |
| `src/logging/index.ts` | 160, 169, 281, 296 | Logger INFO/DEBUG |
| `src/utils/global-resource-tracker.ts` | 182-208, 268 | Diagnostics |
| `src/prompts/promptUtils.ts` | 12 | Inline logger |
| `src/utils/index.ts` | 59, 266, 278 | Module cache + logger |
| `src/frameworks/methodology/runtime-methodology-loader.ts` | 99, 126, 168 | Debug output |

**Result:** When running `npx claude-prompts-server`:
1. Server prints messages to stdout via `console.log()`
2. Output corrupts JSON-RPC protocol stream
3. MCP client can't parse response → connection fails

---

## Implementation Plan

### Phase 1: Fix Executable Permissions

- [x] **File:** `server/package.json`
- [x] Add `postbuild` script: `"postbuild": "chmod +x dist/index.js || true"`

### Phase 2: Fix Hardcoded /tmp Paths

- [x] `src/config/index.ts` - Replace `/tmp/` with `os.tmpdir()`
- [x] `src/mcp-tools/prompt-engine/utils/classification.ts` - Replace `/tmp/` with `os.tmpdir()`
- [x] `src/mcp-tools/prompt-engine/utils/validation.ts` - Replace `/tmp/` with `os.tmpdir()`
- [x] `src/mcp-tools/prompt-engine/utils/context-builder.ts` - Replace `/tmp/` with `os.tmpdir()`

### Phase 3: Redesign Server Root Detection

- [x] **File:** `src/runtime/startup.ts` - Complete rewrite of ServerRootDetector

**New Strategy Priority Order:**

| Priority | Strategy | Method | Works For |
|----------|----------|--------|-----------|
| 1 | Package Resolution | Find package.json, verify name match | npm/npx installs |
| 2 | Script Entry Point | `fs.realpath(process.argv[1])` | Claude Desktop, direct node |
| 3 | Module URL | `import.meta.url` walk up | All contexts |
| 4 | Environment Variable | `MCP_SERVER_ROOT` (deprecated) | Legacy fallback |
| 5 | CWD Fallback | `process.cwd()` patterns | Local dev only |

**Key Improvements:**
1. **Package Resolution (NEW)**: Walk up from `import.meta.url` to find `package.json`, verify `name === 'claude-prompts-server'`
2. **Symlink Resolution**: Use `fs.realpath()` on `process.argv[1]`
3. **Validation**: Verify ALL required files exist after detection
4. **Deprecate MCP_SERVER_ROOT**: Still works but emits deprecation warning
5. **Clear Error Message**: Actionable troubleshooting steps on failure

### Phase 4: Add `exports` Field

- [x] **File:** `server/package.json` - Add exports configuration

### Phase 5: Fix STDIO Protocol Corruption

- [x] Replace ALL `console.log()` → `console.error()` (~25 occurrences in 6 files)

**Files fixed:**
1. `src/index.ts` - Help message + CI debug logs ✅
2. `src/logging/index.ts` - Logger INFO/DEBUG implementations ✅
3. `src/utils/global-resource-tracker.ts` - Diagnostics output ✅
4. `src/prompts/promptUtils.ts` - Inline logger ✅
5. `src/utils/index.ts` - Module cache + inline logger ✅
6. `src/frameworks/methodology/runtime-methodology-loader.ts` - Debug output ✅

### Phase 6: Zero-Flag Experience

- [x] Auto-enable quiet mode when transport=stdio (unless --verbose)
- [x] Update README.md with simplified configuration (remove flags from examples)

**Auto-quiet logic in `src/index.ts`:**
```typescript
// If STDIO transport, force quiet mode to prevent protocol corruption
if (transport === 'stdio' && !args.includes('--verbose')) {
  isQuiet = true;
}
```

---

## Files to Modify

### Completed (Phases 1-4)

| File | Change | Status |
|------|--------|--------|
| `server/package.json` | Add `postbuild` script, `exports` field | [x] |
| `server/src/config/index.ts` | Replace `/tmp/` with `os.tmpdir()` | [x] |
| `server/src/mcp-tools/prompt-engine/utils/classification.ts` | Replace `/tmp/` with `os.tmpdir()` | [x] |
| `server/src/mcp-tools/prompt-engine/utils/validation.ts` | Replace `/tmp/` with `os.tmpdir()` | [x] |
| `server/src/mcp-tools/prompt-engine/utils/context-builder.ts` | Replace `/tmp/` with `os.tmpdir()` | [x] |
| `server/src/runtime/startup.ts` | Complete rewrite of ServerRootDetector | [x] |

### Phase 5: STDIO Protocol Fix (console.log → console.error)

| File | Change | Status |
|------|--------|--------|
| `server/src/index.ts` | Replace `console.log` with `console.error` (lines 297, 407, 423, 428, 517) | [x] |
| `server/src/logging/index.ts` | Replace `console.log` with `console.error` (lines 160, 169, 281, 296) | [x] |
| `server/src/utils/global-resource-tracker.ts` | Replace `console.log` with `console.error` (lines 182-208, 268) | [x] |
| `server/src/prompts/promptUtils.ts` | Replace `console.log` with `console.error` (line 12) | [x] |
| `server/src/utils/index.ts` | Replace `console.log` with `console.error` (lines 59, 266, 278) | [x] |
| `server/src/frameworks/methodology/runtime-methodology-loader.ts` | Replace `console.log` with `console.error` (lines 99, 126, 168) | [x] |

### Phase 6: Zero-Flag Experience

| File | Change | Status |
|------|--------|--------|
| `server/src/runtime/options.ts` | Auto-enable quiet mode for STDIO transport | [x] |
| `server/README.md` | Simplify config examples (remove `--transport=stdio --quiet`) | [x] |

---

## Validation Steps

### Build & Permissions
```bash
npm run build
ls -la dist/index.js  # Should show -rwxr-xr-x (755)
```

### Unit Tests
```bash
npm test  # All tests pass
```

### STDIO Protocol Validation (NEW)
```bash
# Test STDIO outputs nothing to stdout (only JSON-RPC)
node dist/index.js 2>/dev/null | head -1
# Should show nothing or valid JSON-RPC only

# Test help goes to stderr (not stdout)
node dist/index.js --help 2>&1 >/dev/null | head -1
# Should show help text

# Test quiet mode is auto-enabled for STDIO
node dist/index.js --startup-test 2>&1 | grep -c "DEBUG"
# Should be 0 (no debug output unless --verbose)
```

### Local Testing
```bash
node dist/index.js --verbose  # Works from server/
cd /tmp && node /path/to/server/dist/index.js --verbose  # Works from arbitrary cwd
```

### Zero-Flag npx Testing (NEW)
```bash
cd /tmp
# Test with ZERO flags - should just work
npx /path/to/claude-prompts-server-*.tgz --startup-test
# Should complete without errors
```

### Package Testing
```bash
npm pack  # Creates .tgz
npm install -g ./claude-prompts-server-*.tgz
claude-prompts-server --help  # Command found and runs
claude-prompts-server --startup-test  # Server starts with zero flags
npm uninstall -g claude-prompts-server
```

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| chmod in postbuild | Low | Only affects build output |
| os.tmpdir() change | Low | Cross-platform compatible |
| Server root detection | Medium | Comprehensive testing needed |
| exports field | Low | Additive change |
| console.log → console.error | Low | Semantic-preserving, output just goes to stderr |
| Auto-quiet for STDIO | Low | Only suppresses non-essential output, --verbose overrides |
| README simplification | Low | Documentation-only change |

## Summary

**Two-part fix for zero-flag experience:**
1. **Protocol safety**: All `console.log` → `console.error` (prevents STDIO corruption)
2. **Zero-flag UX**: Auto-quiet for STDIO transport + simplified docs

---

## Completion Status

**All phases completed on 2025-12-05**

### Validation Results
- ✅ Build: Passed
- ✅ Tests: 205 tests passing
- ✅ STDIO Protocol: No output to stdout (verified with `2>/dev/null`)
- ✅ Help goes to stderr (verified with redirect test)
- ✅ Auto-quiet enabled for STDIO transport
- ✅ Version bumped to 1.3.3

### Ready for npm publish
```bash
npm publish --access public
```
