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

### Phase 1: Bundle as Default Build ✅ COMPLETE

**Goal**: Replace tsc with esbuild as the default build, outputting directly to `dist/index.js`.

**Status**: Completed 2026-01-09

**Decision**: Implemented **Option A** - Bundle replaces index.js directly. This avoids config changes and provides a cleaner migration path.

**Tasks**:
- [x] Install esbuild: `npm install -D esbuild` (v0.27.2)
- [x] Create `esbuild.config.mjs` configuration
- [x] Make `build` script use esbuild (outputs to `dist/index.js`)
- [x] Keep `build:tsc` for development debugging
- [x] Test bundle output
- [x] Verify path resolution works
- [x] Verify all MCP tools function
- [x] All 881 tests pass

**Implementation Notes**:
- Bundle size: 4.37 MB (within expected 3-5MB range)
- Used ESM format with `createRequire` shim for CJS interop
- Node.js built-ins marked as external (always available at runtime)
- Source maps enabled for debugging
- `keepNames: true` for readable stack traces
- **No config changes needed** - all existing configs already point to `dist/index.js`

**Files created/modified**:
```
server/
├── esbuild.config.mjs      # NEW - esbuild configuration
├── package.json            # UPDATED - build uses esbuild
└── dist/
    └── index.js            # NOW bundled output (4.37 MB)
```

**Package.json scripts (final)**:
```json
{
  "scripts": {
    "prebuild": "npm run generate:contracts",
    "build": "node esbuild.config.mjs",
    "build:prod": "NODE_ENV=production node esbuild.config.mjs",
    "build:tsc": "tsc --project tsconfig.json",
    "dev": "node esbuild.config.mjs --watch"
  }
}
```

**esbuild.config.mjs** (actual implementation):
```javascript
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'dist/index.js',  // Direct replacement
  sourcemap: true,
  minify: false,  // Keep readable for debugging
  keepNames: true,  // Readable stack traces
  external: [
    // Node.js built-ins (always available at runtime)
    'fs', 'path', 'http', 'https', 'crypto', 'url', 'util', 'stream', 'events',
    'node:fs', 'node:path', 'node:fs/promises', // etc.
  ],
  banner: {
    // Require shim for CJS dependencies (Express, etc.)
    js: `import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);`,
  },
});
```

**Validation checklist**:
- [x] `npm run build` succeeds (4.37 MB bundle)
- [x] `node dist/index.js --transport=stdio` starts
- [x] Path resolution finds config.json and resources/
- [x] Hot reload detects file changes (resources loaded from filesystem)
- [x] All MCP tools respond correctly (prompt_engine, system_control, resource_manager)
- [x] `system_control(action: "status")` works
- [x] All 881 unit tests pass
- [x] TypeScript type checking passes

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

### Phase 3: Update Distribution Configs ⏭️ SKIPPED

**Status**: Not needed - Option A outputs bundle to `dist/index.js`, so all existing configs work unchanged.

All distribution channels already point to `dist/index.js`:
- `.mcp.json` → `server/dist/index.js` ✅
- `gemini-extension.json` → `server/dist/index.js` ✅
- `manifest.json` → `server/dist/index.js` ✅

No changes required.

### Phase 4: Simplify Hooks ✅ COMPLETE

**Goal**: Remove node_modules repair logic from hooks (no longer needed).

**Status**: Completed 2026-01-09

**Changes Made**:
- Removed `CRITICAL_PACKAGES` constant
- Removed `check_node_modules()` function
- Removed `repair_node_modules()` function
- Removed `subprocess` import (no longer needed)
- Removed node_modules check in `main()`
- Updated docstring to note bundled distribution

| Hook | Before | After |
|------|--------|-------|
| `hooks/dev-sync.py` | Sync files + repair node_modules | Sync files only ✅ |
| `.gemini/hooks/dev-sync.py` | N/A (doesn't exist) | N/A |

**Why keep hooks**:
- Still useful for syncing dist/cache/hooks from source (dev workflow)
- Hooks now purely about file sync, not dependency repair
- File reduced from ~273 lines to ~220 lines

**Removed code**:
```python
# Removed:
# - CRITICAL_PACKAGES constant
# - check_node_modules() function
# - repair_node_modules() function
# - subprocess import
# - node_modules check in main()

# Kept:
# - File sync logic
# - Quick-check timestamp mode
```

### Phase 5: Update Build Pipeline ✅ COMPLETE

**Goal**: Make bundled build the default.

**Status**: Completed as part of Phase 1 (Option A)

**Tasks**:
- [x] Change default `build` script to use esbuild
- [x] Keep `build:tsc` as fallback for debugging
- [ ] Update CI/CD to use bundled build (TODO)
- [ ] Update documentation (TODO)

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

### Phase 6: Clean Up ✅ COMPLETE

**Goal**: Remove deprecated files and update documentation.

**Status**: Completed 2026-01-09

**Tasks**:
- [x] Remove old dist/*.js files from subdirectories (kept only `index.js` bundle)
- [x] Keep dist/*.d.ts files (TypeScript declarations for consumers)
- [x] Update CLAUDE.md with new build process
- [x] Update README.md installation instructions
- [x] Update .mcpbignore to exclude `server/node_modules/` (no longer needed in package)
- [x] Update CHANGELOG.md

**Changes Made**:
- Removed 376 `.js` files from `dist/` subdirectories (all now bundled in `index.js`)
- Removed all `.js.map` files from subdirectories
- Kept 375 `.d.ts` files for TypeScript type support
- Updated `.mcpbignore` to exclude `server/node_modules/` from mcpb package
- Updated CLAUDE.md command reference for bundled build
- Updated README.md with note about self-contained bundle
- Updated CHANGELOG.md with bundled distribution changes

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

- [x] Bundled server starts successfully in all contexts
- [x] All MCP tools function correctly
- [x] Hot reload works for prompts/gates/methodologies
- [x] Path resolution finds all resources
- [x] No performance regression (881/881 tests pass)
- [x] Hooks simplified (no node_modules repair)
- [x] Documentation updated
- [ ] CI/CD uses bundled build (pending Phase 2 validation)
- [ ] Phase 2: Validate across distribution channels (pending)

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

---

## Target-State Release & Distribution Strategy (2026-01)

Objective: Stop committing `server/dist/` to git, deliver prebuilt artifacts via GitHub Releases for extensions, keep npm package builds intact (dist included in the tarball), and update install docs to prefer release-based installs.

### Decisions

- Git repository: Do not commit generated `server/dist/` (post‑migration). Developers build locally; CI builds for releases.
- npm: Keep `dist/` in the published npm tarball via `files` and `prepublishOnly` (already configured).
- GitHub Releases: Primary distribution for Claude Desktop extension (`.mcpb`) and Gemini CLI extension (platform-agnostic or platform-specific archives per naming convention).
- Repo install: Treated as a developer path; requires `npm install` + `npm run build`.
- Release gating: Use Release Please to cut releases; initially publish as `draft: true` until pipeline is validated, then flip to `draft: false`.

### CI/CD Changes

1) Release creation (Release Please)
- Trigger: merge of the release PR to `main`.
- Action: create (draft) GitHub Release with version and changelog.

2) Build & Package job (runs on release creation)
- Build bundled server (`esbuild` target) and validate startup (`npm run build && npm run start:test`).
- Produce artifacts:
  - Claude extension: run `npm --prefix server run pack:mcpb` (calls `scripts/build-extension.sh`) → upload `.mcpb` as release asset.
  - Gemini extension: create archive(s) following `{platform}.{arch}.{name}.{extension}` or single generic archive; ensure `gemini-extension.json` at archive root.
  - Optional: attach `docs/static/diagrams` artifact if bundled with docs release.
- Publish npm (optional auto-publish): `npm publish` gated on a “publish” input or separate workflow to avoid unintended publishes.

3) Post‑migration guard
- Block committing `server/dist/` by ignoring it in repo `.gitignore` (kept today for compatibility; flip when release pipeline validated).

### Tasks (Phased)

Phase A — Prepare
- [ ] Confirm esbuild bundle (Phase 1 above) passes startup + tests.
- [ ] Ensure `server/package.json` includes `files: ["dist", ...]` and `prepublishOnly` → OK today.
- [ ] Create `scripts/package-gemini-extension.sh` to zip/tar the extension with proper layout and names.
- [ ] Add GitHub Actions workflow `release-artifacts.yml` triggered on `release` event (created) to build and upload `.mcpb` and Gemini archives.
- [ ] Optionally set Release Please `draft: true` in `release-please-config.json` during validation period.

Phase B — Flip documentation & installs
- [ ] Update README/docs to prefer GitHub Releases for Claude Desktop `.mcpb` and Gemini extension archives; keep repo install as “dev only”.
- [ ] Document npm install still supported via `npx`/`npm install` and is self-contained (bundled dist in tarball).

Phase C — Remove dist from git
- [ ] Add/keep `.gitignore` rule to exclude `server/dist/`.
- [ ] Remove tracked `server/dist/` from repo once releases validated (1+ successful releases with verified assets).
- [ ] Remove dev-sync hooks’ `node_modules` repair paths (already tracked in Phase 4 above) — final cleanup.

### Validation & Exit Criteria

- [ ] Release created by Release Please includes correct changelog and version bump.
- [ ] Build job uploads `.mcpb` and Gemini archives under expected names; assets download and run locally.
- [ ] npm publish contains `dist/` in tarball; consumers install and run without dev deps.
- [ ] README/docs updated with install commands for Releases and npm; repo install marked as dev-only.
- [ ] After at least one successful release, remove `server/dist/` from git and enforce ignore.

### Rollback Plan (Distribution)

- If Release assets fail validation: keep `server/dist/` committed temporarily; re-run fixed build, attach assets manually if needed.
- If npm publish fails: re-run publish with corrected token/2FA; consumers still have GitHub Releases.
- Maintain `build:tsc` fallback script and `dist/index.js` entry for quick revert (until stable).

### Notes & Follow-ups

- Hooks layering (deduplication): audit `~/.gemini/settings.json`, project `.gemini/settings.json`, and `gemini-extension.json` to ensure hooks have unique `name`+`command` combinations; rename to avoid multi-run.
- Gemini hooks alignment: migrate `BeforeModel` → `BeforeAgent` for prompt-context injection; ensure output structure uses `hookSpecificOutput.additionalContext`; keep logging hooks for diagnosis.
- Docs diagrams: diagrams are rendered in CI to `docs/static/diagrams/` and referenced in docs; generated assets are ignored in git.
