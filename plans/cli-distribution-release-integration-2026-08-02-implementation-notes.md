---
title: "CLI Distribution and Release Integration — Implementation Notes"
date: 2026-08-02
status: active
tags: []
---

# CLI Distribution and Release Integration — Implementation Notes

## Status

Implementation complete locally on 2026-08-02. Deployment evidence remains gated on the next Release Please version. Source changes were intentionally made in the shared checkout after the user overrode the initial clean-tree precondition; unrelated work remains owned by the other session.

## Deviations

- **In-place shared checkout:** No worktree was created. The user directed this implementation to continue while the other session adapts and the changes batch into the next release.
- **Branch reconciliation deferred:** The checkout remains on the divergent `release-3.1.0-final` branch. No reset, stash, branch switch, direct main push, or unrelated commit has been performed.
- **Static package validation retained:** `validate-package-entries.js` remains a complementary build-free source-contract check. The new packed verifier owns consumer runtime, inventory, version, and size assertions.
- **npm publish dry-run:** The generated tarball was accepted and inventoried by npm, then the registry rejected the already-published local version `3.1.0`. A publishable new version must come from Release Please.

## Measurements

| Artifact                   |                      Before |                        Current local result |
| -------------------------- | --------------------------: | ------------------------------------------: |
| npm tarball                |             4,471,147 bytes | 1,952,004 bytes with concurrent SDK v2 work |
| npm unpacked               |            19,471,250 bytes | 8,223,607 bytes with concurrent SDK v2 work |
| npm source maps            |                           2 |                                           0 |
| production CLI bundle      | approximately 301,934 bytes |                               301,934 bytes |
| source-map release archive |               not published |                             5,517,164 bytes |
| MCPB                       |   9,312,008 bytes in v3.1.1 |                             2,145,732 bytes |
| plugin archive             |                not measured |                             7,631,366 bytes |
| dist runtime archive       |                not measured |                             7,418,139 bytes |

Current results use the shared branch's production dependency state and may shift when it is reconciled with `main`; ratchets allow 2.5 MB packed and 10 MB unpacked. A development build is intentionally not used for the publication measurement.

## Evidence Collected

- CLI regression test failed with expected `3.1.0`, received `0.1.0`, before the version-source fix.
- CLI targeted integration test passed after the fix: 19/19.
- Packed verifier self-test rejects missing bins, source maps, size overruns, missing declarations, and version mismatch.
- Real packed consumer installs outside the repository and reports `cpm 3.1.0`.
- Release-artifact self-test rejects missing CLI/maps, version mismatch, and checksum mismatch.
- Local release assets pass SHA-256 verification and contain both source maps.
- Release-workflow self-test rejects missing/unknown merge modes, incomplete assets, and single-trigger checkout logic.
- Runtime staging self-test copied only `index.js`/`index.js.map` and removed stale CLI, chunk, and directory entries from an existing target.
- A bundle-only MCP surface probe passed initialize, tool listing, `system_control`, `resource_manager`, and `prompt_engine` from an isolated directory with no `node_modules`. MCPB dependency staging was therefore removed as duplicate runtime payload and its dependency validator was replaced by an artifact validator.
- The final MCPB contains the server entrypoint but no CLI, `node_modules`, or generated `runtime-state`; its size fell from 9,312,008 bytes in v3.1.1 to 2,145,732 bytes. An intermediate build that still staged dependencies and generated state measured 24,808,978 bytes and was rejected.
- The measured plugin and dist-runtime archives contain `index.js` and `index.js.map`, with no CLI, `node_modules`, or generated `runtime-state` paths.
- Marketplace PR #6 merged as `07575852a996122cb6724ce892b15db027eeb33c`; marketplace `main` now reports v3.1.1/MIT. Superseded PR #5 was closed with a link to #6.
- Required server unit suite passed: 147 suites, 1,784 tests.
- The initial server typecheck/build attempt was blocked while the concurrent SDK v2 migration still had two legacy transport imports. After that session updated its imports, server typecheck and the production build passed.
- Ratchet lint passed at `3,413` errors and `1,090` warnings with no regressions; this implementation changes no `server/src` files.
- Architecture, version-alignment, required-context, file-size, workflow-pin, YAML, shell-syntax, scoped ESLint, and scoped Prettier checks passed. Architecture reported two existing type-only dependency warnings and no errors.
- `validate:all` reached `validate:format` and stopped on the other session's modified `README.md`, modified `plans/acquisition-recovery.md`, and deleted tracked `plans/readme_thoughts.md`. The formatting issue it initially reported in this plan's release-process documentation was corrected; all files in this implementation now pass scoped Prettier checks.
- Orphan search found no broad `server/dist` staging copies, no distributed `0.1.0` reader, and no cleanup markers in the new implementation.

## Remaining

- Re-run complete repository policy validation after the concurrent MCP SDK work settles; scoped distribution checks and the required server suite pass.
- Reconcile the shared branch with current `main` through review.
- Validate the next Release Please tag produces and publishes the complete asset set.

## Captured Learning

- Distribution boundaries should follow exposed entrypoints, not the build directory: npm exposes both bins, while MCPB/plugin manifests expose only the bundled server.
- A release check is strongest when it packs, installs, and executes the exact tarball later published; source-build and declaration-only checks remain useful but do not replace the consumer test.
- Downstream automation needs an explicit capability model. Protected repositories can queue auto-merge, while an unprotected repository needs a separately declared validated direct-merge path.
