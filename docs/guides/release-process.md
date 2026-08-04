# Release Process

Ship releases to npm, update the `dist` branch, and sync downstream extensions—automatically.

## Why This Matters

| Problem                                  | Solution                          | Result                   |
| ---------------------------------------- | --------------------------------- | ------------------------ |
| Manual version bumps across 4 files      | release-please automation         | Merge PR → versions sync |
| Downstream projects need latest runtime  | npm dependency + daily Dependabot | Auto-PRs within 24h      |
| Non-conventional commits break changelog | commitlint + commit-msg hook      | Enforced at commit time  |

---

## Quick Reference

```bash
# Check current version
cd server && npm run validate:versions

# Run full validation (includes README charter check)
cd server && npm run validate:all

# Build and verify the npm tarball from a temporary consumer
cd server && npm run build:prod && npm run verify:package-artifact

# Trigger a release
gh workflow run release-please.yml

# Force-update dist branch
gh workflow run extension-publish.yml -f version=1.3.3
```

---

## Pre-Release Charter Walkthrough

Before merging a Release PR, walk the README as a first-time reader. Log violations as issues with label `readme-charter`; small fixes ship in the release PR, larger restructures defer.

| Step | What to check                                                          | Source                                     |
| ---- | ---------------------------------------------------------------------- | ------------------------------------------ |
| 1    | `npm run validate:readme --mode=block` exits 0                         | Charter §8 budget + voice + quadrant tests |
| 2    | First 30 lines still contain the pitch table                           | Charter §3 reader journey                  |
| 3    | Quick Start has ≤ 2 visible client sections, others collapsed          | Charter §4 budget                          |
| 4    | Every `## ` heading has a Diátaxis marker                              | Charter §6                                 |
| 5    | No new forbidden words without `<!-- charter-allow: -->` justification | Charter §5                                 |

---

## Distribution Architecture

### Branch Strategy

| Branch | Contains                     | Consumers                     |
| ------ | ---------------------------- | ----------------------------- |
| `main` | Full source, tests, CI, docs | Developers                    |
| `dist` | Pre-built runtime only       | Claude Code desktop extension |

The `dist` branch is **force-pushed** after each release for the desktop extension.

### Distribution Surfaces

| Surface                 | Includes                                                                       | Excludes                                                      |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| npm `claude-prompts`    | `claude-prompts` + `cpm` bins, resources, hooks                                | external source maps                                          |
| GitHub Release          | MCPB, versioned `cpm` bundle, SHA-256 checksum, source-map archive             | source and development dependencies                           |
| MCPB                    | self-contained registered MCP server entry and public resources                | `cpm`, source maps, generated state, duplicate `node_modules` |
| `dist` / plugin archive | registered MCP server entry, server map, resources, hooks/agents as applicable | unregistered `cpm` bundle and duplicate `node_modules`        |

`server/package.json#version` is the sole release identity. The npm workflow verifies and publishes the same packed tarball; the extension workflow asserts that every named asset reports that version.

### Downstream Consumers

Both extension projects use `claude-prompts` as an **npm dependency**:

| Project                                                          | Distribution                   | Update Mechanism                     |
| ---------------------------------------------------------------- | ------------------------------ | ------------------------------------ |
| [gemini-prompts](https://github.com/minipuft/gemini-prompts)     | Gemini CLI extension (private) | Daily Dependabot                     |
| [opencode-prompts](https://github.com/minipuft/opencode-prompts) | npm package + OpenCode plugin  | Daily Dependabot + upstream dispatch |

```json
// package.json (both projects)
{ "dependencies": { "claude-prompts": "^1.x" } }
```

Dependabot creates PRs daily when new versions are published. Centralized release synchronization also opens validated PRs. Protected downstream repositories use GitHub auto-merge; the unprotected marketplace repository merges its validated PR immediately. No workflow pushes directly to a downstream default branch.

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
│  Changelog: conventional commits   │
│  → Keep a Changelog sections       │
│  Merges manual [Unreleased] notes  │
│  Retires finished plans → archive  │
└────────────────────────────────────┘
     │ (merge PR)
     ▼
┌────────────────────────────────────┐
│  GitHub Release                    │
│  Tag: v{version}                   │
└────────────────────────────────────┘
     │
     ├──────────────────────┐
     ▼                      ▼
┌──────────────────┐  ┌──────────────────┐
│  npm-publish.yml │  │ extension-publish│
│  • pack + verify │  │ • Desktop ext    │
│  • publish tgz   │  │ • cpm + checksum │
│  • Provenance    │  │ • maps + dist    │
└──────────────────┘  └──────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  Downstream (daily Dependabot)     │
│  • marketplace: validated merge    │
│  • gemini-prompts: auto-merge PR   │
│  • opencode-prompts: auto-merge PR │
│    + dispatches downstream-release │
└────────────────────────────────────┘
```

---

### Plan retirement

The release PR retires finished plans. `status: done` is the tag meaning "retire at the next
release" — there is no separate queue file, and no fifth frontmatter field (the convention is
exactly four).

The frontmatter schema, the status vocabulary, and the `done` vs `reference` test are defined
once, publicly, at
[`repository-standards/conventions/plan-frontmatter.md`](https://github.com/minipuft/repository-standards/blob/main/conventions/plan-frontmatter.md).
This guide owns only how **this** repository runs the retirement — the workflow step, its
placement on the release PR, and the local commands. Restating the convention here is what let it
drift the last time it had two homes.

`scripts/retire-done-plans.js --apply` moves every `done` plan with **no inbound links** into
`plans/archive/`, preserving its subpath and re-basing its relative links for the added depth.
Plans something still cites — an ADR, a successor plan, a doc — are `reference`, not `done`, and
are never archived.

It runs on the **release PR**, not on the created release. No workflow in this repo pushes to
`main` — the release doc states that as a principle, and `main` is protected — so retirement that
fired on `release_created` would need a new push-to-main path. On the PR the moves are reviewable
before merge, and the step is idempotent: if Release Please updates the PR branch and drops the
archive commit, the next update re-runs it. That is the same property the changelog merge relies on.

The check half runs in `validate:all` on every CI run. It does **not** fail because the queue is
non-empty; `done` plans exist legitimately between releases, and a gate that fired on their
existence would be red almost always and therefore ignored. It fails on exactly one thing: a
`done` plan that something still cites, which is a misclassification that would break the citing
document if archived.

```bash
npm run plans:retire:check   # report the queue; fail on misclassification
node scripts/retire-done-plans.js --apply   # what the release PR runs
```

## Configuration

| File                                      | Purpose                            |
| ----------------------------------------- | ---------------------------------- |
| `release-please-config.json`              | Version bump settings, extra-files |
| `.release-please-manifest.json`           | Current version state              |
| `.github/workflows/release-please.yml`    | Release PR automation              |
| `.github/workflows/npm-publish.yml`       | npm + downstream dispatch          |
| `.github/workflows/extension-publish.yml` | dist branch + desktop extension    |

---

## Secrets

| Secret                 | Source     | Purpose                                  |
| ---------------------- | ---------- | ---------------------------------------- |
| `RELEASE_PLEASE_TOKEN` | GitHub PAT | Create releases that trigger workflows   |
| `NPM_TOKEN`            | npmjs.com  | Publish to registry (or OIDC provenance) |

### Setup

```bash
# GitHub PAT (fine-grained, repo: claude-prompts)
# Permissions: Contents, Pull requests, Actions (read/write)
gh secret set RELEASE_PLEASE_TOKEN

# npm automation token (if not using OIDC trusted publishing)
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

### Release artifact mismatch

```bash
cd server
npm run build:prod
npm run verify:package-artifact
npm run prepare:release-artifacts -- --output-dir /tmp/claude-prompts-release
```

The npm tarball must contain both declared bins and no `.map` files. GitHub Release diagnostics are the versioned `claude-prompts-<version>-sourcemaps.tar.gz` asset.
