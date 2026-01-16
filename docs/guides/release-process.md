# Release Process

Purpose: ship claude-prompts releases, publish dist artifacts, and update downstream extensions.

## Workflow Chain

```
Push to main
       │
       ▼
┌─────────────────────────────────────────┐
│  release-please.yml                     │
│  - Creates/updates Release PR           │
│  - Bumps versions in:                   │
│    • server/package.json                │
│    • manifest.json                      │
│    • .claude-plugin/plugin.json         │
└─────────────────────────────────────────┘
       │
       │ (merge Release PR)
       ▼
┌─────────────────────────────────────────┐
│  GitHub Release Created                 │
│  - Tag: claude-prompts-v{version}       │
│  - Triggers: release:published event    │
└─────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│  npm-publish.yml                        │
│  - Builds and tests                     │
│  - Publishes to npm with provenance     │
│  - Dispatches to gemini-prompts         │
└─────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│  extension-publish.yml                  │
│  - Builds desktop extension             │
│  - Publishes dist branch (marketplace)  │
└─────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│  gemini-prompts/update-submodule.yml    │
│  - Updates core submodule               │
│  - Syncs version to gemini-extension    │
│  - Creates PR in gemini-prompts repo    │
└─────────────────────────────────────────┘
```

## Required Secrets

| Secret | Source | Purpose | Rotation |
|--------|--------|---------|----------|
| `RELEASE_PLEASE_TOKEN` | GitHub PAT | Create releases that trigger workflows | 2 years |
| `DOWNSTREAM_PAT` | GitHub PAT (same) | Dispatch to gemini-prompts | 2 years |
| `NPM_TOKEN` | npmjs.com | Publish to npm registry | 60 days |

### Creating Tokens

**GitHub PAT (Fine-grained):**
1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Repository access: `claude-prompts` AND `gemini-prompts`
3. Permissions:
   - Contents: Read and write
   - Pull requests: Read and write
   - Actions: Read and write

**npm Token:**
1. npmjs.com → Access Tokens → Generate New Token
2. Type: Automation
3. Copy immediately (cannot be retrieved later)

### Setting Secrets

```bash
# Same GitHub PAT for both
gh secret set RELEASE_PLEASE_TOKEN -R minipuft/claude-prompts
gh secret set DOWNSTREAM_PAT -R minipuft/claude-prompts

# npm token
gh secret set NPM_TOKEN -R minipuft/claude-prompts
```

### Checking Secrets

```bash
gh secret list --repo minipuft/claude-prompts
```

## Configuration Files

| File | Purpose |
|------|---------|
| `release-please-config.json` | Release-please settings, extra-files to version |
| `.release-please-manifest.json` | Current version tracker |
| `.github/workflows/release-please.yml` | Release PR creation |
| `.github/workflows/npm-publish.yml` | npm publishing + downstream dispatch |
| `.github/workflows/extension-publish.yml` | Desktop extension build + dist branch publish |

## Manual Operations

### Trigger Release Manually

```bash
gh workflow run release-please.yml --repo minipuft/claude-prompts
# Outcome: release PR opened/updated
```

### Create Release Without release-please

```bash
# Tag and release manually
git tag claude-prompts-v1.2.0
git push origin claude-prompts-v1.2.0
gh release create claude-prompts-v1.2.0 --title "v1.2.0" --notes "See CHANGELOG.md"
# Outcome: release published, extension-publish.yml can run
```

### Publish dist Branch Manually

```bash
# Triggers dist publish + desktop extension build
gh workflow run extension-publish.yml --repo minipuft/claude-prompts -f version=1.3.1
# Outcome: dist branch updated
```

### Sync Submodule Manually

```bash
# In gemini-prompts repo
git submodule update --remote --merge
git add core
git commit -m "chore: update core submodule"
git push
```

## Troubleshooting

### release-please fails with "illegal pathing characters"

The `extra-files` paths cannot use `../`. Use root-level `extra-files` config instead of package-level.

**Wrong:**
```json
{
  "packages": {
    "server": {
      "extra-files": [{"path": "../manifest.json"}]  // ❌
    }
  }
}
```

**Correct:**
```json
{
  "packages": { "server": { ... } },
  "extra-files": [{"path": "manifest.json"}]  // ✅ Root-level
}
```

### npm-publish doesn't trigger after release

Check that `RELEASE_PLEASE_TOKEN` is set. The default `GITHUB_TOKEN` cannot trigger cross-workflow events.

### gemini-prompts submodule not updating

1. Verify `DOWNSTREAM_PAT` has access to gemini-prompts repo
2. Check Actions tab in gemini-prompts for failed runs
3. Manual sync: `git submodule update --remote --merge`

### dist branch missing or stale

1. Confirm `extension-publish.yml` ran and succeeded
2. Verify `dist` branch exists and includes `server/dist/index.js`
3. Re-run the workflow with `version` input

### Version mismatch between files

Run version validation:
```bash
cd server && npm run validate:versions
```

Files that should have matching versions:
- `server/package.json`
- `manifest.json`
- `.claude-plugin/plugin.json`
- `gemini-prompts/gemini-extension.json` (after submodule sync)
