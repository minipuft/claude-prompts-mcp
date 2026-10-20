# Release Process

Ship releases to npm and update the `dist` branch automatically; downstream projects pick the release up through their npm dependency.

## Why This Matters

| Problem                                  | Solution                     | Result                   |
| ---------------------------------------- | ---------------------------- | ------------------------ |
| Manual version bumps across 4 files      | release-please automation    | Merge PR → versions sync |
| Downstream projects need latest runtime  | npm dependency + sync job    | Auto-PRs, auto-merged    |
| Non-conventional commits break changelog | commitlint + commit-msg hook | Enforced at commit time  |

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

| Surface                 | Includes                                                           | Excludes                                                      |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| npm `claude-prompts`    | `claude-prompts` + `cpm` bins, resources, hooks                    | external source maps                                          |
| GitHub Release          | MCPB, versioned `cpm` bundle, SHA-256 checksum, source-map archive | source and development dependencies                           |
| MCPB                    | self-contained registered MCP server entry and public resources    | `cpm`, source maps, generated state, duplicate `node_modules` |
| `dist` / plugin archive | registered MCP server entry, server map, resources, hooks          | unregistered `cpm` bundle and duplicate `node_modules`        |

`server/package.json#version` is the sole release identity. The npm workflow verifies and publishes the same packed tarball; the extension workflow asserts that every named asset reports that version.

### Downstream Consumers

Every downstream project consumes the engine as an **npm dependency** — none of them is a generated
or rendered copy of this repository. They own their own source, their own client adapters, and their
own release toolchain; what they share is the published package.

| Project                                                          | Distribution                                       | Update Mechanism                          |
| ---------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------- |
| [gemini-prompts](https://github.com/minipuft/gemini-prompts)     | Gemini CLI extension (npm pkg unpublished)         | sync job → validated PR, auto-merge       |
| [opencode-prompts](https://github.com/minipuft/opencode-prompts) | npm package + OpenCode plugin                      | sync job → validated PR, auto-merge       |
| [codex-prompts](https://github.com/minipuft/codex-prompts)       | Codex CLI plugin, installed from its `dist` branch | sync job → its `publish-dist` republishes |
| [minipuft-plugins](https://github.com/minipuft/minipuft-plugins) | Marketplace index only, no plugin content          | sync job → validated PR, auto-merge       |

```json
// package.json (gemini-prompts, opencode-prompts, codex-prompts)
{ "dependencies": { "claude-prompts": "^3.0.0" } }
```

The `sync-downstream` job in `extension-publish.yml` is the **only** writer of a downstream
`claude-prompts` version. It opens a PR in each repository above on every upstream release and
auto-merges it once the repository's checks pass; **no workflow pushes directly to a downstream
default branch**. Nothing else moves the version: the shared Renovate preset in
`minipuft/repository-standards` lists `claude-prompts` in `ignoreDeps` so that a second writer
cannot race the sync, and no member runs Dependabot. A member whose sync fails therefore stays on
its old version until a release is synced again, and the weekly drift audit below is what reports
it. That is how 5.1.0 and 5.1.1 reached no member (the first sync waited about 100 seconds for
a publication npm took 2 to 6 minutes to serve, and the marketplace was sent through a lock sync
it has no lock entry for).

The job checks out each downstream and edits the one thing it owns:

| Member kind                                                                | Edit                                            | Lockfile                                                                                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| declares `claude-prompts` in `dependencies` or `devDependencies` (3 repos) | the dependency **range** (`^MAJOR.0.0`)         | regenerated through `server/scripts/synchronize-downstream-lock.js`, then `npm ci` must install exactly the released version |
| does not declare it (minipuft-plugins)                                     | the marketplace entry's `version` and `license` | untouched, even when the repository has one for its own tooling                                                              |

The branch is chosen by what `package.json` **declares**, never by whether a lockfile exists:
minipuft-plugins gained a lockfile for commitlint and husky and still has no `claude-prompts`
entry in it. Editing `package.json` without the lock desynchronizes the two, which once left
opencode-prompts with `^2.0.0` against a `1.7.0` lock and blocked its publish workflow for months.

The lock sync first waits until `npm view claude-prompts@<version>` lists the release (15 minutes,
polling every 15 seconds), because a fresh publication takes minutes to become installable; then it
refreshes the lock, retrying a few times for the gap between a listing and an installable
resolution. If either bound runs out, the job fails instead of opening a PR whose lock points at
another version, and a failed run is re-run once npm lists the release.

What _was_ removed is the separate `downstream-sync.yml` workflow and its `repository_dispatch`
trigger — a dead chain that had never run. The job described above lives inside
`extension-publish.yml` and is unrelated to it.

Drift is watched centrally rather than per-repo: `minipuft/repository-standards` runs a weekly
`Fleet Drift Audit` over the repositories listed in its `fleet.json`, comparing each one's resolved
`node_modules/claude-prompts` version against this repository's published version.

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
│  Downstream (sync-downstream job)  │
│  • marketplace: validated merge    │
│  • gemini-prompts: auto-merge PR   │
│  • opencode-prompts: auto-merge PR │
│  • codex-prompts: auto-merge PR    │
└────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  Fleet Drift Audit (weekly)        │
│  repository-standards/fleet.json   │
│  • fails the job on drift          │
└────────────────────────────────────┘
```

---

### Plan retirement

The release PR retires finished plans. `status: done` is the tag meaning "retire at the next
release" — there is no separate queue file, and no fifth frontmatter field (the convention is
exactly four).

The frontmatter schema, the status vocabulary, and the `done` vs `reference` test are defined
once, publicly, at
[`repository-standards/conventions/plan-frontmatter.md`](https://github.com/minipuft/repository-standards/blob/v1.11.0/conventions/plan-frontmatter.md).
This guide owns only how **this** repository runs the retirement — the workflow step, its
placement on the release PR, and the local commands. Restating the convention here is what let it
drift the last time it had two homes.

The versioned `retire-done-plans` executable from `repository-standards` clears finished work out
of the working set by **two different doors**, because the two kinds of finished plan have
different obligations:

| Status      | Destination        | Tracked?        | Why                                                                                           |
| ----------- | ------------------ | --------------- | --------------------------------------------------------------------------------------------- |
| `done`      | `plans/archive/`   | no — gitignored | Nothing cites it. Git history is the archive.                                                 |
| `reference` | `plans/reference/` | **yes**         | Something still cites it (an ADR, a successor plan, a doc), so its citers need it to resolve. |

Both preserve the subpath (`plans/technical-debt/x.md` → `plans/<dest>/technical-debt/x.md`) and
re-base relative links for the added depth. Relocating a `reference` plan additionally rewrites
every **inbound** link to it, across the sources declared by this repository. The workflow stages
the complete retirement transaction rather than duplicating that source list in YAML.

`plan-retirement.config.json` owns the consumer-specific citation corpus. Its `linkSources` array
has no default: missing configuration, an empty key, or a source that does not exist is a hard
error before the tool scans or moves a plan. An incomplete corpus could otherwise turn a live
inbound citation into a destructive false negative.

**A plan must be committed before it is retired, and `--apply` enforces it.** `plans/archive/` is
gitignored, so archiving an untracked plan deletes it outright and archiving a modified one loses
the uncommitted delta from the history that is supposed to preserve it. `--apply` refuses to
archive any queued plan that `git status` reports as untracked or modified — which is what makes
it safe to run by hand between releases (e.g. at phase completion) rather than only on the release
PR, where the checkout is clean by construction. `reference` relocations are not guarded: they
stay tracked and carry their content with them. `plans/future/` is likewise gitignored and is left
alone entirely — relocating out of it would silently commit a file the repo had chosen not to
carry.

It runs on the **release PR**, not on the created release. No workflow in this repo pushes to
`main` — the release doc states that as a principle, and `main` is protected — so retirement that
fired on `release_created` would need a new push-to-main path. On the PR the moves are reviewable
before merge, and the step is idempotent: if Release Please updates the PR branch and drops the
archive commit, the next update re-runs it. That is the same property the changelog merge relies on.

The check half runs in `validate:all` on every CI run. It does **not** fail because the queue is
non-empty; `done` plans exist legitimately between releases, and a gate that fired on their
existence would be red almost always and therefore ignored. It fails on exactly two things:

1. **A `done` plan that something still cites** — a misclassification that would break the citing
   document if archived. Citations from plans that are archiving in the _same_ run do not count:
   a plan and its implementation-notes companion cite each other by convention, and counting that
   would deadlock every such pair permanently.
2. **A plan whose frontmatter is missing, incomplete, or carries a status outside the four.** Such a
   plan is invisible to retirement — never queued, never checked, never archived — so it
   accumulates in the working set looking live. Eight plans had drifted into that state before this
   became an error rather than a silent skip.

A `reference` plan that _nothing_ cites is reported as an advisory, not a failure: it is
misclassified in the opposite direction and is probably `done`, but whether the work is finished is
a judgement the frontmatter author owns.

```bash
npm --prefix server run plans:retire:check      # report queue; fail on misclassification
npm --prefix server run plans:retire:self-test  # exercise safety against this corpus
npm --prefix server run plans:retire            # apply the same operation as the release PR
```

## Configuration

| File                                      | Purpose                            |
| ----------------------------------------- | ---------------------------------- |
| `release-please-config.json`              | Version bump settings, extra-files |
| `.release-please-manifest.json`           | Current version state              |
| `.github/workflows/release-please.yml`    | Release PR automation              |
| `.github/workflows/npm-publish.yml`       | npm + downstream dispatch          |
| `.github/workflows/extension-publish.yml` | dist branch + desktop extension    |
| `plan-retirement.config.json`             | Required local citation corpus     |

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
