# Bundled Distribution Migration Plan

## Overview

Migrate from TypeScript compilation (`tsc`) to bundled distribution (`esbuild`) to eliminate runtime dependency on `node_modules`. This modernizes the installation process and removes the need for the `dev-sync.py` hook workaround.

## Current State

### Build System
- **Compiler**: `tsc` (TypeScript compiler)
- **Output**: 377 separate `.js` files in `dist/`
- **Runtime deps**: Requires `node_modules/` with ~820 packages
- **Entry point**: `dist/index.js`

### Distribution Channels

| Channel | Config File | Entry Point | node_modules Required |
|---------|-------------|-------------|----------------------|
| npm package | `server/package.json` | `dist/index.js` | Yes (postinstall) |
| Claude Code plugin | `.claude-plugin/plugin.json` + `mcp.json` | `server/dist/index.js` | Yes (hook repairs) |
| Gemini CLI | `gemini-extension.json` | `server/dist/index.js` | Yes (hook repairs) |
| Claude Desktop | `manifest.json` | `server/dist/index.js` | Yes (manual) |

### Current Workarounds
- `hooks/dev-sync.py` - Checks and repairs `node_modules` on SessionStart
- `.gemini/hooks/dev-sync.py` - Same for Gemini CLI
- Both run `npm install` if `@modelcontextprotocol/` is missing

## Target State

### Build System
- **Bundler**: `esbuild`
- **Output**: Single `dist/server.js` (~3-5MB)
- **Runtime deps**: None (all inlined)
- **Entry point**: `dist/server.js`

### Distribution Channels (After Migration)

| Channel | Entry Point | node_modules Required |
|---------|-------------|----------------------|
| npm package | `dist/server.js` | No |
| Claude Code plugin | `server/dist/server.js` | No |
| Gemini CLI | `server/dist/server.js` | No |
| Claude Desktop | `server/dist/server.js` | No |

## Risk Assessment

### High Risk Areas

| Area | Risk | Mitigation |
|------|------|------------|
| Path resolution | `import.meta.url` changes in bundle | Test ServerRootDetector thoroughly |
| Dynamic imports | May not bundle correctly | Audit and refactor if needed |
| Hot reload | File watchers must still work | Resources are external, should work |
| Native modules | Cannot be bundled | Audit - we don't use any |

### Medium Risk Areas

| Area | Risk | Mitigation |
|------|------|------------|
| Bundle size | May be large (~5-10MB) | Acceptable for server |
| Source maps | Debugging harder | Generate source maps |
| Error stack traces | May be mangled | Configure esbuild for readable output |

### Low Risk Areas

| Area | Risk | Mitigation |
|------|------|------------|
| Resource loading | Still loads from filesystem | No change needed |
| Configuration | Still reads config.json | No change needed |
| MCP protocol | SDK bundled inline | Should work |

## Implementation Phases

### Phase 1: Add Bundled Build (Non-Destructive)

**Goal**: Add esbuild alongside existing tsc build for testing.

**Tasks**:
- [ ] Install esbuild: `npm install -D esbuild`
- [ ] Create `esbuild.config.mjs` configuration
- [ ] Add `build:bundle` script to package.json
- [ ] Test bundle output manually
- [ ] Verify path resolution works
- [ ] Verify hot reload works
- [ ] Verify all MCP tools function

**Files to create/modify**:
```
server/
├── esbuild.config.mjs      # NEW - esbuild configuration
├── package.json            # ADD build:bundle script
└── dist/
    ├── index.js            # KEEP - tsc output (fallback)
    └── server.js           # NEW - bundled output
```

**Package.json changes**:
```json
{
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "build:bundle": "node esbuild.config.mjs",
    "build:all": "npm run build && npm run build:bundle"
  }
}
```

**esbuild.config.mjs**:
```javascript
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'dist/server.js',
  sourcemap: true,
  minify: false,  // Keep readable for debugging
  external: [],   // Bundle everything
  banner: {
    js: '#!/usr/bin/env node',
  },
});
```

**Validation checklist**:
- [ ] `npm run build:bundle` succeeds
- [ ] `node dist/server.js --transport=stdio` starts
- [ ] Path resolution finds config.json and resources/
- [ ] Hot reload detects file changes
- [ ] All MCP tools respond correctly
- [ ] `system_control(action: "status")` works

### Phase 2: Validate Across Distribution Channels

**Goal**: Test bundled server in all distribution contexts.

**Tasks**:
- [ ] Test npm package installation
- [ ] Test Claude Code plugin (update mcp.json entry point)
- [ ] Test Gemini CLI extension
- [ ] Test Claude Desktop configuration
- [ ] Verify startup time improvement
- [ ] Verify no regressions in functionality

**Test matrix**:

| Channel | Test Command | Expected Result |
|---------|--------------|-----------------|
| Local | `node dist/server.js --startup-test` | Starts successfully |
| npm | `npx claude-prompts --startup-test` | Starts successfully |
| Claude Code | MCP tools work | All tools respond |
| Gemini CLI | MCP tools work | All tools respond |

### Phase 3: Update Distribution Configs

**Goal**: Point all distribution channels to bundled entry point.

**Files to update**:

**mcp.json**:
```json
{
  "claude-prompts": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/server/dist/server.js", "--transport=stdio"],
    "env": {
      "MCP_WORKSPACE": "${CLAUDE_PLUGIN_ROOT}"
    }
  }
}
```

**gemini-extension.json** (mcpServers section):
```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "node",
      "args": ["${extensionPath}/server/dist/server.js", "--transport=stdio"]
    }
  }
}
```

**manifest.json** (if applicable):
```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "node",
      "args": ["/path/to/server/dist/server.js"]
    }
  }
}
```

### Phase 4: Simplify Hooks

**Goal**: Remove node_modules repair logic from hooks (no longer needed).

**Decision**: Keep hooks but simplify them.

| Hook | Current Purpose | After Bundling |
|------|-----------------|----------------|
| `dev-sync.py` | Sync files + repair node_modules | Sync files only |
| Gemini `dev-sync.py` | Sync files + repair node_modules | Sync files only |

**Why keep hooks**:
- Still useful for syncing dist/cache/hooks from source (dev workflow)
- Just remove the `check_node_modules()` and `repair_node_modules()` functions
- Hooks become purely about file sync, not dependency repair

**Files to modify**:
```
hooks/dev-sync.py              # REMOVE node_modules repair logic
.gemini/hooks/dev-sync.py      # REMOVE node_modules repair logic
```

**Simplified dev-sync.py**:
```python
# Remove:
# - CRITICAL_PACKAGES constant
# - check_node_modules() function
# - repair_node_modules() function
# - node_modules check in main()

# Keep:
# - File sync logic
# - Quick-check timestamp mode
```

### Phase 5: Update Build Pipeline

**Goal**: Make bundled build the default.

**Tasks**:
- [ ] Change default `build` script to use esbuild
- [ ] Keep `build:tsc` as fallback for debugging
- [ ] Update CI/CD to use bundled build
- [ ] Update documentation

**Package.json final state**:
```json
{
  "scripts": {
    "build": "node esbuild.config.mjs",
    "build:tsc": "tsc --project tsconfig.json",
    "build:dev": "npm run build:tsc",
    "postbuild": "chmod +x dist/server.js || true"
  }
}
```

### Phase 6: Clean Up

**Goal**: Remove deprecated files and update documentation.

**Tasks**:
- [ ] Remove old dist/*.js files (keep only server.js)
- [ ] Update CLAUDE.md with new build process
- [ ] Update README.md installation instructions
- [ ] Update troubleshooting guide
- [ ] Remove node_modules from .mcpbignore (no longer needed in package)
- [ ] Update CHANGELOG.md

## Downstream Effects

### npm Package

| Aspect | Before | After |
|--------|--------|-------|
| Package size | ~500KB + deps | ~5MB (self-contained) |
| Install time | Slow (820 deps) | Fast (no deps) |
| postinstall | Required | Not needed |
| node_modules | ~200MB | 0 |

### Claude Code Plugin

| Aspect | Before | After |
|--------|--------|-------|
| SessionStart hook | Repairs node_modules | File sync only |
| First launch | Slow if deps missing | Fast always |
| Update behavior | May need repair | Just works |
| Cache size | ~250MB | ~10MB |

### Gemini CLI

| Aspect | Before | After |
|--------|--------|-------|
| SessionStart hook | Repairs node_modules | File sync only |
| Extension size | Large | Small |

### Claude Desktop

| Aspect | Before | After |
|--------|--------|-------|
| Manual npm install | Required | Not needed |
| Configuration | Complex | Simple |

## Rollback Plan

If issues are discovered after migration:

1. **Immediate**: Switch mcp.json back to `dist/index.js`
2. **Short-term**: Keep `build:tsc` script available
3. **Long-term**: Both builds can coexist

## Success Criteria

- [ ] Bundled server starts successfully in all contexts
- [ ] All MCP tools function correctly
- [ ] Hot reload works for prompts/gates/methodologies
- [ ] Path resolution finds all resources
- [ ] No performance regression
- [ ] Hooks simplified (no node_modules repair)
- [ ] Documentation updated
- [ ] CI/CD uses bundled build

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1 | 1-2 hours | None |
| Phase 2 | 1-2 hours | Phase 1 |
| Phase 3 | 30 mins | Phase 2 validated |
| Phase 4 | 30 mins | Phase 3 |
| Phase 5 | 30 mins | Phase 4 |
| Phase 6 | 1 hour | Phase 5 |

**Total**: ~5-7 hours of focused work

## Open Questions

1. Should we keep tsc build for development debugging?
2. Should we minify the bundle or keep it readable?
3. Should we split into multiple chunks for faster cold starts?
4. Should hooks be removed entirely or just simplified?

## References

- [esbuild documentation](https://esbuild.github.io/)
- [MCP SDK bundling considerations](https://modelcontextprotocol.io/)
- Current hook implementation: `hooks/dev-sync.py`
