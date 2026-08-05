---
title: "CLI Distribution and Release Integration Plan"
date: 2026-08-02
status: active
tags: []
---

# CLI Distribution and Release Integration Plan

**Status:** Implemented; deployment evidence pending the next Release Please version  
**Lifecycle:** `cli/` source = canonical; `server/package.json` publication contract = canonical; incidental CLI copies in MCP/plugin archives = removed  
**Date:** 2026-08-02 (America/Denver)  
**Scope:** npm package, GitHub Release assets, MCPB/plugin contents, CI validation, downstream release synchronization

## Intent

Complete the existing CPM CLI integration without creating a second release identity or forcing every MCP/plugin installation surface to carry an unexposed CLI artifact.

The canonical distribution model will be:

1. `cli/` remains a private workspace containing CLI source, build tooling, and tests.
2. `server/package.json` remains the sole published npm manifest and exposes both `claude-prompts` and `cpm` bins.
3. `server/package.json.version` is the release-version source of truth for both bins.
4. GitHub Releases expose the self-contained CLI as an explicit, checksummed artifact.
5. MCPB and plugin runtime archives contain only artifacts they expose at runtime.
6. Source maps remain available as separate release diagnostics rather than inflating every npm installation.

## Safety Preconditions

- Do not create a worktree for this plan or its implementation; the user explicitly selected the existing working directory.
- The working directory started on `release-3.1.0-final`, not `main`, with unrelated work. On 2026-08-02 the user explicitly authorized in-place implementation and directed the other session to adapt so the work can batch into the next release.
- Do not reset, stash, overwrite, or include the other session's changes in this work.
- Do not push directly to protected `main`. Reconcile the combined branch through review before the next Release Please PR.
- Keep Renovate lock-refresh PR #194 unchanged; this plan is not dependency-lock maintenance.

## Current-State Evidence

| Surface                | Current state                                                                              | Consequence                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| npm manifest           | `server/package.json` publishes `claude-prompts -> dist/index.js` and `cpm -> dist/cpm.js` | CLI is already part of the primary npm package                         |
| CLI workspace          | `cli/package.json` is private and versioned `0.1.0`                                        | Suitable as a build boundary, but not as a release-version authority   |
| Published CLI          | `claude-prompts@3.1.1` executes `cpm --version` as `0.1.0`                                 | Release identity is inconsistent and current tests do not detect it    |
| Required CI            | `CLI` typechecks, builds, and runs integration tests for full-scope changes                | Source behavior is covered, but the packed npm artifact is not         |
| npm publish            | Verifies declared bin files exist before publishing                                        | Existence-only validation permits the wrong embedded version           |
| npm payload            | 4,471,147-byte tarball; 19,471,250 bytes unpacked                                          | Source maps dominate payload size                                      |
| CLI payload            | `cpm.js` 301,934 bytes; `cpm.js.map` 1,184,454 bytes                                       | Runtime is modest; its map is approximately four times larger          |
| GitHub Release         | v3.1.1 exposes the MCPB, not a named standalone CLI asset                                  | CLI distribution is implicit rather than a release contract            |
| MCPB/plugin staging    | Broadly copies `server/dist`                                                               | Unexposed `cpm.js` and its map are carried incidentally                |
| Extension workflow     | v3.1.1 built its artifacts successfully but failed marketplace auto-merge                  | Downstream merge policy assumes protected-branch auto-merge everywhere |
| Downstream marketplace | v3.1.0 PR #5 and v3.1.1 PR #6 remain open                                                  | #5 is superseded; #6 is the canonical recovery candidate               |

## Decisions

### D1 — One published npm package, two bins

Keep the existing `claude-prompts` package with both executable entries. Do not merge CLI development dependencies into `server/package.json`, and do not publish the private `cpm-cli` workspace.

**Reason:** source/build isolation and release identity are different concerns. The private workspace prevents Jest, TypeScript, and esbuild development dependencies from becoming server runtime dependencies, while the published server manifest provides one installation and version lifecycle.

### D2 — Server release version is authoritative

The server publication version must be injected into every distributed CLI build. A standalone development build may still use the same server manifest because it already depends on server source through `cli-shared`.

**Guarded removal:** Delete the CLI package version as a runtime/build input once the packed-artifact test proves `cpm --version === server/package.json.version`.

### D3 — Package contents are explicit

Replace broad `files: ["dist", ...]` inclusion with explicit runtime entry files. Publish source maps as a separate GitHub Release diagnostic archive.

**Guarded removal:** Stop shipping `dist/*.map` through npm once the release workflow uploads the diagnostic archive and the package smoke test proves both executable entries work without local source maps.

### D4 — CLI is a first-class GitHub Release asset

Attach a versioned CLI file and checksum, for example:

- `cpm-<version>.js`
- `cpm-<version>.js.sha256`
- `claude-prompts-<version>-sourcemaps.tar.gz`

The asset must be produced by the same release commit and version assertion used for npm publication.

### D5 — MCP/plugin archives use an allowlist

MCPB and plugin installers expose the MCP server, hooks, agents, configuration, and resources. They do not currently register a `cpm` executable. Stage only the server entry and its debugging map rather than copying all of `server/dist`.

**Guarded removal:** Delete incidental `cpm.js`/`cpm.js.map` copies from MCPB and plugin archives once the standalone GitHub asset and npm bin pass their consumer smoke tests.

### D6 — Validate consumer artifacts, not only source builds

Add one reusable verifier that inspects the built/packed artifacts and fails on:

- missing declared bins;
- version disagreement;
- unexpected source maps in npm;
- missing GitHub CLI/checksum inputs;
- unexpected CLI artifacts in MCPB/plugin stages;
- package-size regression beyond the measured budget.

### D7 — Downstream merge behavior is capability-aware

Represent downstream merge behavior in the workflow matrix:

- protected repositories with required checks -> enable GitHub auto-merge;
- repositories without required protection -> merge the already validated sync PR immediately;
- never push changes directly to a downstream default branch.

## Seven-Step Implementation

### Step 1 — Correct CLI version identity

**Files likely affected**

- `cli/esbuild.config.mjs`
- `cli/src/cli.ts`
- `cli/tests/integration/cli.test.ts`
- `cli/README.md`

**Actions**

1. Read the distributed version from the canonical server manifest or require it as an explicit build option supplied by the server build.
2. Remove `cli/package.json.version` from the distributed-version decision path.
3. Replace the weak semantic-version-shaped assertion with equality against `server/package.json.version`.
4. Preserve the private workspace version only if npm workspace tooling requires it; document that it is not a release identity.

**Exit gate**

```text
npm -w cli run build
node cli/dist/cpm.js --version == server/package.json.version
```

### Step 2 — Establish a packed-package consumer verifier

**Files likely affected**

- `server/scripts/validate-package-entries.js` or a focused `server/scripts/verify-package-artifact.js`
- `server/package.json`
- verifier self-tests under `server/tests/unit/` if the script is importable, otherwise a `--self-test` mode

**Actions**

1. Build the production server and CLI entries.
2. Run `npm pack --json` into a temporary directory.
3. Extract the tarball and resolve every `bin` target from the packed `package.json`.
4. Execute both bins with safe informational arguments.
5. Assert `cpm --version` equals the packed package version.
6. Measure packed and unpacked sizes and fail above documented ratchet budgets.
7. Make every verifier rule falsifiable through tests or self-test fixtures.

**Exit gate**

- A fabricated missing bin fails.
- A fabricated version mismatch fails.
- The real production tarball passes from outside the repository tree.

### Step 3 — Make npm contents explicit and lean

**Files likely affected**

- `server/package.json`
- `server/scripts/verify-package-artifact.js` or the selected verifier
- `docs/guides/release-process.md`

**Actions**

1. Replace the broad `dist` package entry with explicit executable files.
2. Exclude external source maps from npm publication.
3. Preserve all required runtime resources, hooks, README, license, and configuration.
4. Record before/after tarball and unpacked sizes in implementation notes.

**Target**

The current maps account for roughly 14.47 MB unpacked and 3.20 MB when individually compressed. The exact package target must be set from the post-change `npm pack --json` measurement rather than estimated values.

**Exit gate**

- Packed consumer verifier passes.
- `npm pack --dry-run` inventory contains both bins and no `.map` files.
- Package-size ratchet passes.

### Step 4 — Publish explicit GitHub CLI and diagnostics assets

**Files likely affected**

- `.github/workflows/extension-publish.yml`
- `.github/workflows/npm-publish.yml` if artifact production is owned there instead
- `docs/guides/cli.md`
- `docs/guides/release-process.md`

**Actions**

1. Produce `cpm-<version>.js` from the release commit.
2. Execute it and assert its version before upload.
3. Generate a SHA-256 checksum.
4. Archive the source maps separately with versioned naming.
5. Upload the CLI, checksum, source-map archive, and MCPB to the same GitHub Release.
6. Support both `workflow_run` and manual recovery paths without deriving different versions.

**Exit gate**

- A manual dry-run/workflow artifact contains the expected versioned files.
- Release upload configuration references all artifacts explicitly.
- Missing CLI or checksum fails before upload.

### Step 5 — Remove unexposed CLI copies from MCPB and plugin archives

**Files likely affected**

- `scripts/build-extension.sh`
- `scripts/sync-to-cache.sh`
- `scripts/stage-server-runtime.sh`
- `server/scripts/validate-extension-artifact.js`
- `.github/workflows/extension-publish.yml`

**Actions**

1. Replace broad `server/dist` staging with an explicit runtime allowlist where practical.
2. Keep `index.js` in every MCP/plugin runtime archive; keep its map where the format supports it. GitHub's diagnostic archive is the canonical map distribution.
3. Exclude `cpm.js` and `cpm.js.map` because neither manifest registers a CLI entry.
4. Extend staged-artifact validation to assert both required presence and forbidden absence.
5. Measure the MCPB and plugin archive reductions.

**Exit gate**

- MCPB validation passes.
- Server startup smoke test passes from the staged archive.
- `cpm.js` is absent from MCP/plugin archives and present in npm/GitHub CLI distributions.

### Step 6 — Integrate release validation and capability-aware downstream merging

**Files likely affected**

- `.github/workflows/ci.yml`
- `.github/workflows/npm-publish.yml`
- `.github/workflows/extension-publish.yml`
- `scripts/classify-validation-scope.js` and its self-test if the new verifier changes scope routing

**Actions**

1. Keep `CLI` as a stable required context for full changes.
2. Run the packed-package verifier in CI before a release can be created or published.
3. Run artifact staging checks in the extension workflow.
4. Add a declared downstream merge mode to each matrix entry rather than attempting `--auto` universally.
5. Direct-merge only the validated PR in repositories without required branch rules; retain auto-merge elsewhere.
6. Ensure docs-only changes retain lightweight required contexts without building release artifacts.

**Exit gate**

- `Classify validation scope`, `Lint & Validate`, `CLI`, `Build`, and `Test Suite` report stable expected results.
- Workflow syntax validation passes.
- Downstream matrix self-review proves every repository declares one merge mode.
- A missing required check cannot be satisfied by a no-op duplicate context.

### Step 7 — Recover current release state and close the migration

**Actions**

1. Inspect downstream marketplace PR #6 and confirm its version/license diff matches v3.1.1.
2. Merge #6 using the repository's validated immediate-merge path.
3. Close superseded v3.1.0 PR #5 with a link to #6.
4. Do not rerun the failed v3.1.1 workflow blindly; its immutable run would repeat the old merge command. Record manual reconciliation instead.
5. Update CLI and release-process documentation with the final distribution table.
6. Update implementation notes with measured npm, MCPB, plugin, and release-asset sizes.
7. Verify no legacy version reader, broad artifact copy, or superseded downstream PR remains.

**Exit gate**

- `cpm --version` equals the released `claude-prompts` version from npm and the GitHub asset.
- npm contains both executable bins and excludes source maps.
- GitHub Release contains the MCPB, CLI, checksum, and diagnostic maps.
- MCPB/plugin archives contain no unregistered CLI artifact.
- Downstream marketplace points to the latest released version.
- All migration checklist items are marked `removed` or `canonical`; none remain indefinitely `migrating`.

## Validation Matrix

| Concern              | Command/evidence                                                                    |
| -------------------- | ----------------------------------------------------------------------------------- |
| CLI source typing    | `npm -w cli run typecheck`                                                          |
| CLI behavior         | `npm -w cli run build && npm -w cli run test:ci`                                    |
| Canonical version    | `node cli/dist/cpm.js --version` compared with `server/package.json.version`        |
| Server typing        | `npm --prefix server run typecheck`                                                 |
| Ratchet lint         | `npm --prefix server run lint:ratchet`                                              |
| Unit tests           | `npm --prefix server run test:ci`                                                   |
| Package contract     | production build plus packed-package verifier and verifier self-test                |
| Architecture         | `npm --prefix server run validate:arch`                                             |
| Complete policy      | `npm --prefix server run validate:all` (call out existing debt if it fails)         |
| MCPB                 | `npm --prefix server run pack:mcpb` and staged-file inventory                       |
| Workflow syntax/pins | `npm --prefix server run validate:github-action-pins` plus YAML parse/action review |
| Scope routing        | `npm --prefix server run validate:push-scope:self-test`                             |
| Release recovery     | GitHub Release asset inventory and downstream PR state                              |

## Consumer Consequence Map

| Consumer               | Reads                                 | Writes/produces            | Decision affected                                           |
| ---------------------- | ------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| Release Please         | `server/package.json.version`         | release PR/tag             | Remains release-version owner                               |
| CLI build              | canonical version + CLI/server source | `cpm.js`, map              | Stops reading private workspace version as release identity |
| Server build           | server source + CLI build options     | `index.js`, `cpm.js`, maps | Continues producing both bins                               |
| npm publish            | server manifest and build output      | npm tarball                | Publishes both bins without maps                            |
| GitHub Release         | release commit artifacts              | CLI, checksum, maps, MCPB  | Makes CLI independently downloadable                        |
| MCPB/plugin installers | staged runtime allowlist              | installed MCP server       | No longer carry unregistered CLI bytes                      |
| CI                     | source, pack, staged artifacts        | protected contexts         | Tests consumer-visible distribution contracts               |
| Downstream sync        | release version and repo merge mode   | downstream PRs             | Avoids invalid auto-merge calls                             |

## Risks and Countermeasures

| Risk                                                         | Severity | Countermeasure                                                                                                         |
| ------------------------------------------------------------ | -------: | ---------------------------------------------------------------------------------------------------------------------- |
| Source-map removal reduces debugging context                 |   Medium | Publish versioned diagnostic archive on the same release and document retrieval                                        |
| CLI asset and npm bin drift                                  |     High | Produce both from the same commit and assert identical embedded version/checksum inputs                                |
| Explicit dist allowlist omits a future runtime chunk         |     High | Package verifier executes from the tarball; build remains single-file and any chunking change must update the contract |
| Direct downstream merge bypasses future checks               |     High | Merge mode is declared per repository; change to auto only when required protection exists, and never direct-push      |
| Release workflow changes are hard to test without publishing |   Medium | Support manual artifact mode, validate staging locally, and inspect action expressions before merge                    |
| Shared dirty checkout obscures change ownership              |     High | User explicitly authorized in-place work; retain scoped evidence and reconcile the combined branch through review      |

## Rollback

- Revert the focused implementation PR; do not unpublish an npm release.
- If source maps are needed in npm, restore their explicit file entries in the next patch release while retaining the GitHub diagnostic archive.
- If standalone CLI upload fails, block extension completion before downstream synchronization; npm remains the existing canonical CLI distribution.
- If downstream capability routing is uncertain, leave its PR open for manual merge rather than bypassing validation or pushing directly.

## Completion Checklist

- [x] CLI distributed version reads the canonical server release version.
- [x] Version equality test replaces shape-only validation.
- [x] Packed npm consumer verifier and falsifiable self-test pass.
- [x] npm runtime inventory is explicit and size-ratcheted.
- [x] GitHub CLI, checksum, and source-map assets are explicit.
- [x] MCPB/plugin staging excludes unregistered CLI artifacts.
- [x] Required CI validates source and packed consumer behavior.
- [x] Downstream merge behavior is declared per repository.
- [x] Marketplace PR #6 is merged and superseded PR #5 is closed.
- [x] Documentation describes one canonical CLI lifecycle and each distribution surface.
- [x] No legacy version reader, broad staging copy, or superseded release path remains.

Deployment evidence for the new npm and GitHub Release artifacts remains gated on the next Release Please version; v3.1.1 is immutable and is not being republished.
