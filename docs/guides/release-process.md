# Release Process

Ship releases to npm, update the `dist` branch, and sync downstream extensions—automatically.

## Why This Matters

| Problem | Solution | Result |
|---------|----------|--------|
| Manual version bumps across 4 files | release-please automation | Merge PR → versions sync |
| Downstream projects need pre-built runtime | `dist` branch with bundled artifacts | `git submodule update` pulls latest |
| Extension repos get stale | Automatic dispatch + PR creation | gemini-prompts stays in sync |

---

## Quick Reference

```bash
# Check current version
cd server && npm run validate:versions

# Trigger a release
gh workflow run release-please.yml

# Force-update dist branch
gh workflow run extension-publish.yml -f version=1.3.3

# Sync downstream manually
cd ../gemini-prompts && git submodule update --remote --merge
```

---

## Distribution Architecture

### Branch Strategy

| Branch | Contains | Consumers |
|--------|----------|-----------|
| `main` | Full source, tests, CI, docs | Developers |
| `dist` | Pre-built runtime only | Extensions via submodule |

The `dist` branch is **force-pushed** after each release. No source code, no node_modules—just what's needed to run:

```
dist/
├── .claude-plugin/plugin.json
├── .mcp.json
├── hooks/
└── server/
    ├── dist/index.js          # ~4.5MB bundled runtime
    ├── config.json
    └── resources/             # prompts, gates, methodologies
```

### Downstream Consumers

Both extension projects track `dist` as a git submodule:

| Project | Submodule | Purpose |
|---------|-----------|---------|
| [gemini-prompts](https://github.com/minipuft/gemini-prompts) | `core/` → `origin/dist` | Gemini CLI extension |
| [opencode-prompts](https://github.com/minipuft/opencode-prompts) | `core/` → `origin/dist` | OpenCode extension |

```ini
# .gitmodules (both projects)
[submodule "core"]
    path = core
    url = https://github.com/minipuft/claude-prompts-mcp.git
    branch = dist
```

**Why submodules?** No build step. Consumers run `git submodule update` and get the latest runtime instantly.

---

## Workflow Chain

```
Push to main
     │
     ▼
┌────────────────────────────────────┐
│  release-please.yml                │
│  Creates Release PR, bumps:        │
│  • server/package.json             │
│  • manifest.json                   │
│  • .claude-plugin/plugin.json      │
└────────────────────────────────────┘
     │ (merge PR)
     ▼
┌────────────────────────────────────┐
│  GitHub Release                    │
│  Tag: v{version}                   │
└────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  npm-publish.yml                   │
│  • Publishes to npm with provenance│
│  • Dispatches to gemini-prompts    │
└────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  extension-publish.yml             │
│  • Builds desktop extension        │
│  • Force-pushes dist branch        │
└────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  gemini-prompts/update-submodule   │
│  • Updates core submodule          │
│  • Creates sync PR                 │
└────────────────────────────────────┘
```

---

## Configuration

| File | Purpose |
|------|---------|
| `release-please-config.json` | Version bump settings, extra-files |
| `.release-please-manifest.json` | Current version state |
| `.github/workflows/release-please.yml` | Release PR automation |
| `.github/workflows/npm-publish.yml` | npm + downstream dispatch |
| `.github/workflows/extension-publish.yml` | dist branch + desktop extension |

---

## Secrets

| Secret | Source | Purpose |
|--------|--------|---------|
| `RELEASE_PLEASE_TOKEN` | GitHub PAT | Create releases that trigger workflows |
| `DOWNSTREAM_PAT` | GitHub PAT | Dispatch to gemini-prompts |
| `NPM_TOKEN` | npmjs.com | Publish to registry |

### Setup

```bash
# GitHub PAT (fine-grained, repos: claude-prompts + gemini-prompts)
# Permissions: Contents, Pull requests, Actions (read/write)
gh secret set RELEASE_PLEASE_TOKEN
gh secret set DOWNSTREAM_PAT

# npm automation token
gh secret set NPM_TOKEN
```

---

## Manual Operations

### Trigger Release

```bash
gh workflow run release-please.yml
# → Opens/updates release PR
```

### Create Release Without Automation

```bash
git tag v1.3.3
git push origin v1.3.3
gh release create v1.3.3 --title "v1.3.3" --notes "See CHANGELOG.md"
# → Triggers npm-publish and extension-publish
```

### Force-Update dist Branch

```bash
gh workflow run extension-publish.yml -f version=1.3.3
# → Rebuilds and force-pushes dist
```

### Sync Submodule Manually

```bash
# In gemini-prompts or opencode-prompts
git submodule update --remote --merge
git add core
git commit -m "chore: update core submodule"
git push
```

---

## Troubleshooting

### release-please fails: "illegal pathing characters"

`extra-files` paths can't use `../`. Put them at root level:

```json
// ❌ Wrong
{ "packages": { "server": { "extra-files": [{"path": "../manifest.json"}] }}}

// ✅ Correct
{ "packages": { "server": {} }, "extra-files": [{"path": "manifest.json"}] }
```

### npm-publish doesn't trigger

`GITHUB_TOKEN` can't trigger cross-workflow events. Verify `RELEASE_PLEASE_TOKEN` is set.

### Submodule not updating

1. Check `DOWNSTREAM_PAT` has gemini-prompts access
2. Check Actions tab in gemini-prompts for failures
3. Manual fix: `git submodule update --remote --merge`

### dist branch stale or invalid

1. Verify `extension-publish.yml` succeeded
2. Check `dist` branch has `server/dist/index.js`
3. Re-run: `gh workflow run extension-publish.yml -f version=X.Y.Z`
4. If dist contains `.github/` or `docs/`, validation failed—check workflow logs

### Version mismatch

```bash
cd server && npm run validate:versions
```

Files that must match:
- `server/package.json`
- `manifest.json`
- `.claude-plugin/plugin.json`
- `gemini-prompts/gemini-extension.json` (after sync)
