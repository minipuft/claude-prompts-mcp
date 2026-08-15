---
title: "Plan Retirement Federation — Implementation Notes"
date: 2026-08-13
status: reference
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

| ID       |      Tier | Plan assumption                                                        | Evidence and ruling                                                                                                                                                                                           | Consequence                                                                                                                                 |
| -------- | --------: | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-F4-1 | F4.1-F4.5 | Implementation could use the active checkouts.                         | Concurrent sessions changed overlapping package, workflow, documentation, plan, and source files. The operator ruled out linked worktrees because shared repository metadata could interfere with them.       | Work ran in independent clones under `/tmp/plan-retirement-federation-20260813`; original worktrees and refs remained untouched.            |
| DEV-F4-2 |      F4.4 | Configured citation sources were the only missing fail-closed premise. | CloudySky did not ignore `plans/archive/`, invalidating the contract that git history is the archive.                                                                                                         | v1.2.0 also refuses `--apply` unless the archive destination is ignored; two polarity tests pin the guard.                                  |
| DEV-F4-3 |      F4.6 | CloudySky's measured 49 `done` plans formed one archive queue.         | Citation closure reclassified 34 as `reference`; 15 remained archiveable. Nine pre-existing reference plans produced 43 relocations total. Two committed plans also lacked valid four-field frontmatter.      | The isolated migration repaired frontmatter, moved 43 plans to `plans/reference/`, archived 15, and finished at 0 queued / 0 misclassified. |
| DEV-F4-4 |      F4.7 | CI packaging could remain deferred.                                    | Installing the entire consumer dependency graph inside Release Please solely to reach one binary duplicates work and couples retirement to install health.                                                    | Added a thin composite action that invokes the canonical executable; no second implementation exists.                                       |
| DEV-F4-5 |      F4.5 | Suite substrate remained `file + tracked + walk + spawn`.              | After extraction, this repository directly spawns a pinned external executable; its internal substrate is owned and tested in repository-standards.                                                           | Updated the suite declaration to `spawn` and documented the checked converse.                                                               |
| DEV-F4-6 |      F4.5 | The delivery PR alone could own accepted-work tracking.                | GitHub planning separates accepted work from delivery evidence. PR #209 initially targeted a non-default branch, where closing keywords are ignored, then became eligible to target `main` after #211 landed. | Issue #210 owns the accepted work; PR #209 closes it from `main`, while Release Please remains packaging-only.                              |

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
| Accepted-work tracking     | Issue #210 and private Project 1                          | PASS: exactly one Issue item; Status In Progress; Priority Normal; Area Repository Automation; Milestone unset                        |
| Delivery linkage           | PR #209 body                                              | PASS: retargeted to `main` after #211; `Closes #210` assigns closure to the delivery PR rather than Release Please                    |

## Remaining closeout

1. Review and merge the isolated `claude-prompts-mcp` branch after its two predecessor commits are
   present on the canonical release branch; rerun the retirement check and full validation there.
2. Wait until the canonical CloudySky worktree's overlapping edits are protected.
3. Import the bundle or three patches, resolve conflicts without discarding newer edits, and rerun
   plan check, seeded failure, self-test, and `npm run validate`.
4. Change F4.5 and F4.6 to ✓, mark both companion documents `reference`, and run retirement from the
   canonical `claude-prompts-mcp` checkout.

## Closeout step 1 executed — 2026-08-14

**Done**: `origin/main` (carrying #209) was merged into `release-3.1.0-final`, and the retirement
check plus full validation were rerun there.

**Result**: `validate:all` 36/37, `test:ci` 2480/2480, both ratchets green
(`lint:ratchet` no regressions; `typecheck:tests:ratchet` 377 errors, no regressions). The single
failure is `plans:retire:check`.

**The migration exposed a defect it did not cause.** The local `retire-done-plans.js` carried a
guard skipping `<plan-stem>.validation-log.md` — the gitignored, machine-written validation ledger
this repo puts beside each plan. The shared executable has no such guard, so its filesystem walk
reports the sidecar as "a plan with no frontmatter" and exits 1. Reproduced directly against
`v1.2.0` before touching anything, then again through `npm run plans:retire:check`.

**Why this was worth stopping for.** `plans:retire:check` is a `validate:all` step, and CI checks
out fresh — so CI has no gitignored files and stays green while every developer machine goes red.
That is the same asymmetry as the FORCE_COLOR ratchet incident: a gate that fails only where the
fix would be applied, whose recommended remedy is the thing that does damage. Left alone it trains
people to skip the suite.

**Fixed upstream, not locally patched.** `repository-standards` PR #7 skips gitignored files via
`git check-ignore --stdin -z`. That is more general than the suffix guard it replaces and is
principled rather than a workaround: retirement's entire safety model is that git history is the
surviving copy — the archive destination must be gitignored and `--apply` refuses uncommitted
plans — so a gitignored file cannot be a retirable plan by construction.

`--no-index` is deliberately omitted so a **committed** plan stays visible regardless of ignore
rules, and the self-test asserts that direction too, because the dangerous failure is the filter
removing something it should have kept. Verified: check exit 1 → 0, self-test 0, upstream
`npm run validate` green (28 tests, workflows, renovate config, format).

**Merge resolutions worth knowing** (the branch and `main` had both developed this feature):
`scripts/retire-done-plans.js` accepted `main`'s deletion; `server/package.json` took `main`'s
`retire-done-plans --repo ..` binary calls plus the branch's `render:*` scripts; the
validation-suite test kept the branch's import of the real `SUITE` export over `main`'s regex
scrape — both files export `SUITE`, and reading the declaration rather than its formatting is why
`main` needed a regex fix in the first place.

**Still open**: closeout steps 2-4 (CloudySky, F4.6) are untouched by this session.

## F4.6 — cloudySky onboarded 2026-08-15

**The generalization proof was organic, not seeded.** Writing
`plan-retirement.config.json` against cloudySky's real layout (`plans`, `docs`, `src`, `tests`,
`tools`, plus the three root handbooks) and running the check surfaced **30 `done` plans that were
still cited**, 57 citations in all, from `src/**/*.ts`, `docs/` and sibling plans. The retired
hardcoded `LINK_SOURCES` named `server/src` and `server/scripts` — paths that do not exist there —
so the old scan would have reported a clean queue and archived all 30 into a gitignored directory in
the one repo with **no remote**. F4.1/F4.2 were written for exactly this and they earned it on the
first real run.

**Reclassification cascades; budget for it.** 30, then 3, then 1 — converging after three passes.
A plan reclassified to `reference` stops co-moving, so citations _from_ it begin blocking their own
targets. A first-pass count understates the work, and an onboarding script that reclassifies once
and declares victory would leave the tail misclassified.

**Two prerequisites the plan never listed.** `plans/archive/` had to be gitignored before `--apply`
would run at all (`assertArchiveDestinationIgnored` throws otherwise), and the config had to be
written from an inspection of the repo's actual directories rather than copied from this repo's.
Both are onboarding steps worth adding to any future consumer checklist.

**Final: 15 archived / 43 referenced / 0 remaining** — matching F4.6's predicted numbers exactly,
which is a stronger result than it looks: those numbers came from an isolated bundle, and the
canonical checkout reproduced them.

**The guard fired, and that is part of the proof.** `--apply` refused the entire batch because
`plans/ocean-surface-cone-remediation-2026-07-21.md` is `done` with uncommitted changes. It refused
_everything_ rather than applying partially — correct, since `plans/archive/` is gitignored and
git history would be the only surviving copy, in a repo with no remote. Left alone: it is another
session's work. Owner-held.

**Observation for a future tier — a gitignored sidecar still counts as a citer.** v1.3.0 stopped the
frontmatter walk reporting gitignored files as broken plans, but `inboundLinks` still scans them as
documents whose citations must be preserved: retiring the agent-plugins plan listed
`plans/agent-plugins-migration-2026-08-08.validation-log.md` among its citers. Harmless here — two
legitimate citers existed anyway — and the failure direction is safe (a plan is held back rather
than wrongly archived). But if a machine-written sidecar were ever the _only_ citer, a finished plan
would be pinned open by telemetry that cites everything it logs. Not fixed: it needs its own
release cycle and the safe direction makes it low priority.
