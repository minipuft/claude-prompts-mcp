---
title: "Plan Retirement Federation — Implementation Notes"
date: 2026-08-13
status: active
tags:
  - planning
  - migration
  - repository-standards
---

# Plan Retirement Federation — Implementation Notes

Companion: [`plan-retirement-federation-2026-08-03.md`](plan-retirement-federation-2026-08-03.md)

## Outcome

- `repository-standards` v1.2.0 owns the executable, JSON schema, tests, documentation, and optional
  composite action. PR [minipuft/repository-standards#6](https://github.com/minipuft/repository-standards/pull/6)
  passed CI and merged; tag `v1.2.0` resolves to `ff063189f3bb78dc373f44ddcf97157dcb44e0f2`.
- The isolated `claude-prompts-mcp` review branch consumes the tagged archive for local commands and
  the same executable through the action at immutable SHA
  `d8cf765790dada41e03bfda4d2e533d5a0d23706`. Its local 738-line implementation is deleted; the
  canonical branch remains unchanged until review and merge. Draft PR
  [minipuft/claude-prompts-mcp#209](https://github.com/minipuft/claude-prompts-mcp/pull/209)
  preserves the isolated result without mutating the active checkout.
- `cloudySky` was migrated and exercised in an independent clone. Its canonical dirty checkout and
  repository metadata were not modified. Importing the validated bundle is the remaining F4.6 gate.

## Deviations

| ID       |      Tier | Plan assumption                                                        | Evidence and ruling                                                                                                                                                                                      | Consequence                                                                                                                                 |
| -------- | --------: | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-F4-1 | F4.1-F4.5 | Implementation could use the active checkouts.                         | Concurrent sessions changed overlapping package, workflow, documentation, plan, and source files. The operator ruled out linked worktrees because shared repository metadata could interfere with them.  | Work ran in independent clones under `/tmp/plan-retirement-federation-20260813`; original worktrees and refs remained untouched.            |
| DEV-F4-2 |      F4.4 | Configured citation sources were the only missing fail-closed premise. | CloudySky did not ignore `plans/archive/`, invalidating the contract that git history is the archive.                                                                                                    | v1.2.0 also refuses `--apply` unless the archive destination is ignored; two polarity tests pin the guard.                                  |
| DEV-F4-3 |      F4.6 | CloudySky's measured 49 `done` plans formed one archive queue.         | Citation closure reclassified 34 as `reference`; 15 remained archiveable. Nine pre-existing reference plans produced 43 relocations total. Two committed plans also lacked valid four-field frontmatter. | The isolated migration repaired frontmatter, moved 43 plans to `plans/reference/`, archived 15, and finished at 0 queued / 0 misclassified. |
| DEV-F4-4 |      F4.7 | CI packaging could remain deferred.                                    | Installing the entire consumer dependency graph inside Release Please solely to reach one binary duplicates work and couples retirement to install health.                                               | Added a thin composite action that invokes the canonical executable; no second implementation exists.                                       |
| DEV-F4-5 |      F4.5 | Suite substrate remained `file + tracked + walk + spawn`.              | After extraction, this repository directly spawns a pinned external executable; its internal substrate is owned and tested in repository-standards.                                                      | Updated the suite declaration to `spawn` and documented the checked converse.                                                               |

## CloudySky isolation artifact

- Bundle: `/tmp/plan-retirement-federation-20260813/artifacts/cloudySky-plan-retirement-federation.bundle`
- Bundle SHA-256: `7fa1d5a27b33e02db9fae7c241c2b7bfa2b8d115efd49f897a711d941c28ae14`
- Base: `9ed9dcaecb2c5fa164c2ff403f121c1e46b1edaf`
- Head: `d42c0db6407b75701ea534d61d8811db3eeb5f68`
- Three matching format patches live under
  `/tmp/plan-retirement-federation-20260813/artifacts/cloudySky-patches/`.
- `git bundle verify` passes. Do not import it until the active CloudySky session has committed or
  otherwise protected its overlapping plan and source edits.

## Validation ledger

| Surface                    | Evidence                                                  | Result                                                                                                                                |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Standards contract         | `npm run validate` in isolated repository-standards clone | PASS: 28 tests, workflow validation, Renovate validation, format                                                                      |
| Standards remote           | PR #6 checks and immutable tag lookup                     | PASS                                                                                                                                  |
| Missing configuration      | Node contract test                                        | PASS: exit 1 names `linkSources`                                                                                                      |
| Missing configured source  | Node contract test                                        | PASS: exit 1 before scan                                                                                                              |
| Archive lifecycle          | Node polarity tests                                       | PASS: non-ignored destination refused; ignored destination applied                                                                    |
| claude-prompts queue       | `npm --prefix server run plans:retire:check`              | PASS: 0 queued / 0 misclassified                                                                                                      |
| claude-prompts self-test   | `npm --prefix server run plans:retire:self-test`          | PASS: 61 tracked plans                                                                                                                |
| claude-prompts full suite  | `npm --prefix server run validate:all`                    | PASS: all 36 validation steps                                                                                                         |
| claude-prompts CI tests    | `npm --prefix server run test:ci`                         | BASELINE-BLOCKED: 188/190 suites; category-count fixture and one-line suite-parser assumption both fail on the unchanged base         |
| CloudySky seeded failure   | temporary cited `done` plan in isolated clone             | PASS: exit 1 names seed and citer                                                                                                     |
| CloudySky apply            | `npm run plans:retire` in isolated clone                  | PASS: 15 archive, 43 reference                                                                                                        |
| CloudySky post-check       | check + self-test                                         | PASS: 0 queued / 0 misclassified; 115 tracked plans                                                                                   |
| CloudySky repository suite | `npm run validate`                                        | PARTIAL: lint and typecheck passed; 160/161 Jest suites passed; unrelated timing test failed once and passed immediately in isolation |

## Remaining closeout

1. Review and merge the isolated `claude-prompts-mcp` branch after its two predecessor commits are
   present on the canonical release branch; rerun the retirement check and full validation there.
2. Wait until the canonical CloudySky worktree's overlapping edits are protected.
3. Import the bundle or three patches, resolve conflicts without discarding newer edits, and rerun
   plan check, seeded failure, self-test, and `npm run validate`.
4. Change F4.5 and F4.6 to ✓, mark both companion documents `reference`, and run retirement from the
   canonical `claude-prompts-mcp` checkout.
