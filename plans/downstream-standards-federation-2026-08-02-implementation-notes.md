---
title: "Downstream Standards Federation — Implementation Notes"
date: 2026-08-02
status: active
tags: []
---

# Downstream Standards Federation — Implementation Notes

**Date:** 2026-08-02 (America/Denver)  
**Status:** In progress at external evidence guards  
**Plan:** `plans/downstream-standards-federation-2026-08-02.md`

## Worktree decision

- No worktree: the user explicitly directed work to continue without one.
- Downstream repositories were handled through fresh, isolated clones under `/tmp/downstream-standards-federation`, one branch and PR per repository.
- The shared upstream checkout was preserved except for the scoped release-sync/validator changes recorded below. No unrelated file was reset, stashed, committed, or deleted.

## Landed evidence

| Repository      | Evidence              | Result                                                                                                                         |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Gemini          | PR #36                | `claude-prompts` lock reconciled to 3.1.1; `npm ci` and server/hooks/symlink checks passed                                     |
| OpenCode        | PR #33                | lock reconciled to 3.1.1; typecheck/build/32 Jest tests passed                                                                 |
| OpenCode        | PR #26                | obsolete v1.7 -> v2 product update closed with links to v3 and 3.1.1 replacements                                              |
| Standards       | PR #1, release v1.0.0 | contract schema, profiles, verifier, reusable workflow, and presets released at `bb7c4fa89e2766ad39ac1b1e597ba8e5cd805d83`     |
| Gemini          | PR #37                | protected shared contract adopted; Actions upgraded and SHA-pinned                                                             |
| OpenCode        | PR #34                | npm-authoritative CI, exact tarball verifier/publication path, protected contract, and SHA pins landed                         |
| Marketplace     | PR #7                 | marketplace contract passed, became required, and SHA pinning was enforced                                                     |
| Standards       | PR #2, release v1.0.1 | corrected Renovate's v-prefixed tag resolution at `af8ca90a9a3d38dac5b10afe361b8ceead3b960e`                                   |
| Gemini/OpenCode | PRs #38/#35           | immutable shared Renovate configuration landed; resolved dry-run ignores `claude-prompts` and extracts both OpenCode manifests |
| Standards       | PR #3, release v1.1.0 | fleet schema/auditor/workflow released at `67e61429abfb43c9f17d5d66f32191053410df67`                                           |

Action-update PRs superseded by Gemini #37 and OpenCode #34 were closed only after the replacement workflows passed their protected checks.

## Measured validation

- Standards v1.0.0: 8 tests; clean install; strict Renovate validation; workflow YAML/Action pins; real Gemini consumer invocation.
- Standards v1.0.1: 9 tests; tag-prefix regression fixture; strict validation.
- Standards v1.1.0: 19 tests; fleet drift negative fixtures; strict validation; workflow pins/format.
- Gemini shared check observed as `Consumer Contract / Consumer Contract`, then added to strict protection before merge.
- OpenCode shared check observed with `validate` and `validate-plugin`, then added to strict protection before merge.
- Marketplace shared check observed before strict protection was configured.
- OpenCode package baseline: 45,378 packed / 231,484 unpacked bytes.
- OpenCode package ratchet: 75,000 packed / 350,000 unpacked bytes.
- OpenCode verified artifact: 45,416 packed / 231,862 unpacked bytes / 51 files.
- Authenticated live fleet audit: upstream 3.1.1; all three repositories passed; zero unexplained drift.
- Renovate 44.7.2 authenticated dry-run: both presets resolved, `claude-prompts` was ignored in both consumers, and OpenCode root plus `.opencode/package.json` were extracted.

## Scoped upstream changes awaiting the release batch

- `.github/workflows/extension-publish.yml`
  - all registered downstreams use protected auto-merge;
  - the temporary marketplace direct branch was removed;
  - downstream locks use bounded registry-propagation retries;
  - installed lock versions must equal the released version.
- `server/scripts/validate-release-workflow.js`
  - accepts only `auto`;
  - rejects direct-mode regressions;
  - requires bounded lock synchronization and exact-version assertions.
- `server/scripts/synchronize-downstream-lock.js`
  - new stateless release utility with bounded retry and failure fixtures.
- `server/package.json`
  - registers the new self-test in `validate:all`.

Targeted validation passed: downstream-lock self-test, release-workflow self-test and live validator, GitHub Action pins, TypeScript typecheck, YAML parse, and `git diff --check`.

## Deviations

1. The observed required context is `Consumer Contract / Consumer Contract`, not the planning default `Consumer Contract`; protection and fleet inventory use the observed name.
2. Renovate treated `#1.0.0` literally while the released tag is `v1.0.0`. The immutable tag was not moved. v1.0.1 corrected the internal reference and added a regression test; consumers use `#v1.0.1`.
3. OpenCode's `validate:legacy-state` script referenced a missing file. The orphaned script entry and bare working-directory release script were removed in the exact-publication migration.
4. Upstream remote `main` already used auto-merge for all downstreams. The direct-mode regression existed only in the in-flight local release refactor and was removed there before batching.
5. Fleet inventory labels Gemini/OpenCode updater ownership `migrating`; this is explicit lifecycle state rather than unexplained drift.

## External hold points

1. **Renovate App authorization:** no hosted dashboard or Renovate-authored PR exists yet. Keep Dependabot configs and auto-merge workflows until both repositories show a dashboard and one representative non-product PR.
2. **Fleet audit credential:** configure `FLEET_AUDIT_TOKEN` in `minipuft/repository-standards` with read-only Administration access to the three downstream repositories. The local authenticated audit passed; the scheduled workflow must prove the same result.
3. **npm trusted publisher:** configure `opencode-prompts` for `.github/workflows/npm-publish.yml` and the `npm` environment. Keep `NPM_TOKEN` until one new-version exact-tarball publication carries expected provenance; then remove the token path in the same closeout PR.
4. **Representative upstream sync:** the next `claude-prompts` release must produce Gemini/OpenCode/marketplace sync PRs that pass the protected shared contract and auto-merge. Only then remove duplicated Gemini common checks and close the direct-mode lifecycle guard.
5. **Updater closeout:** after hosted Renovate evidence, delete both Dependabot configurations and auto-merge workflows, close remaining superseded updater PRs, and change fleet lifecycle from `migrating` to `renovate`.

## Growth capture

- Confirmed twice: entangle contracts, not source trees.
- Confirmed across three repositories: shadow check -> observed exact name -> protection -> legacy removal.
- Confirmed by lock reconciliation and Renovate dry-run: one product-version writer prevents stale update PRs.
- New correction: a schema-valid shareable preset still requires resolved remote-tag validation; tag spelling is part of the API contract.
