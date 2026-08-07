---
title: "Acquisition Recovery Plan — Listings, Metadata, README Content Pass — Implementation Notes"
plan: acquisition-recovery.md
date: 2026-08-06
status: active
tags: []
---

# Implementation Notes

Deviations, discovered constraints, unknowns, and re-measurements found while
executing the plan. Conservative option taken, logged, work continued.

## Deviations

- **2026-08-06 · G2 execution touched CHANGELOG.md** (not foreseen by the plan text): folding the
  phantom `## [3.1.2]` section into `## [Unreleased]` was required by the version reset — the
  section documented a release that never happened, and `validate:versions` reads the changelog for
  the core version's entry. One bullet moved; no content lost.
- **2026-08-06 · Unplanned CI hygiene fix in the PR range**: `git diff --check` in the classify job
  failed on markdown two-space hard breaks in three OLDER plan files
  (`cli-distribution-release-integration-2026-08-02.md`,
  `downstream-standards-federation-2026-08-02{,-implementation-notes}.md`) — not this plan's files,
  but they blocked G4 for the whole PR. Trailing whitespace stripped (`e0d32557`); prettier accepts
  the stripped form. Rendering cost: those header lines lose their hard-break, acceptable in plan
  docs.
- **2026-08-06 · Lockfile version fields synced by hand** (`npm install --package-lock-only`, root +
  server) after the 3.1.1 reset — `sync-versions.js` does not touch lockfiles (deliberately, per
  the validate-versions comment), so a manual reset like this leaves them stale unless done.

- **2026-08-06 · G4 blocker fixed in the CLI package's test fixtures**: `2d838276` (CLI stops
  creating state.db schema) updated the server-side tests but not `cli/tests/integration/`
  — whose python seeder still created the pre-scope-column `version_history` shape with
  `tenant_id='default'`. The scoped CLI reads returned empty ("No version history") and CI's
  CLI job failed 7 tests; pre-push never sees it (CLI tests are CI-only). Seeder now mirrors
  the engine DDL and pins the scope via `identity.launchDefaults.workspaceId` in the fixture
  workspace's config.json. CLI suite 75/75 locally.

- **2026-08-06 · Second G4 blocker: stale MCP tool-schema snapshot** (`validate:tool-schemas`,
  Build job). The branch's SDK/zod-4 upgrade moved all three tools' published inputSchemas from
  draft-07 to 2020-12 and added the structured `gate_verdict` object + chain `agentType`; the
  committed snapshot predated them. Re-captured against a fresh build with repo runtime-state
  moved aside (snapshot-environment lesson: the schema union depends on gate/framework state),
  verified green, committed `1d4f2e29`. Pre-commit prettier reformats the generated snapshot but
  the check compares structure, not bytes — no `.prettierignore` entry needed.

## Unknowns / gaps found during execution

- **RP behavior with a never-released manifest version** (the trap G2 closed): a manifest stating a
  version with no matching tag makes release-please's commit-range derivation undefined — the
  reason the reset went back to 3.1.1 rather than forward to 3.2.0. If a future manual publish
  pre-stages again, the manifest is the file that must NOT be pre-staged.
- **`sync-versions.js` cannot set `server/package.json` itself** — it reads its target FROM that
  file; a full reset needs `npm pkg set version=X --prefix server` first. Candidate small fix:
  accept the server package in the manifest list when a CLI version is passed.

## G4 run log

- 2026-08-06 · run 1: classify failed (PR-range trailing whitespace) → fixed `e0d32557`
- 2026-08-06 · run 2: CLI job failed (stale history fixtures) → fixed `3e7b7306`; classify/lint green
- 2026-08-06 · run 3: Build failed (stale tool-schema snapshot) → fixed `1d4f2e29`; CLI green
- 2026-08-06 · run 4 (head `a2db54cf`): in flight — first run with all three fixes; Test Suite matrix
  has not yet completed on any run of this PR

## Release-PR phase (post-merge, 2026-08-06/07)

- Merge `9029fb4d` landed as a MERGE COMMIT deliberately — release-please reads conventional
  commits and the `Release-As: 3.2.0` footer from main history; a squash would have collapsed both.
- RP opened #197 titled `chore(main): release 3.2.0` — the Release-As pin held; every version
  surface bumps 3.1.1→3.2.0 including BOTH server.json fields (G3 wiring proven live). RP merged
  its generated commit list into the hand-written Unreleased sections and retitled the block.
- **Retracted trap (2026-08-07): "RP's PR gets no CI" was a misdiagnosis.** The
  `RELEASE_PLEASE_TOKEN` PAT (set 2026-01-14) already makes RP's PRs trigger workflows — #197 was
  authored by minipuft and its CI run started 4s after open. What looked like "no CI" was the
  window before the classify job registered the four check contexts: `gh pr checks` lists only
  REGISTERED check runs, and BLOCKED means "required checks pending", not "never coming". The
  close/reopen was unnecessary churn that cancelled a healthy run. Real lesson: before declaring
  a workflow untriggered, check `gh run list` for the head branch — not `gh pr checks`.
- **Trap: `gh pr merge` on a BLOCKED PR exits 0** while printing an --auto/--admin hint — it
  no-ops without failing, so any merge automation must verify `state == MERGED` afterward, not
  trust the exit code. Bit twice before the loop verified state.
- Release PR merged as SQUASH to match the 3.1.1 precedent (`chore(main): release 3.1.1 (#191)`,
  single parent).

## Validation runs

- 2026-08-06 17:49 · `npm run build >/dev/null 2>&1 && NODE_OPTIONS="--experimental-vm-modules" npx jest --config jest.config.cjs 2>&1 | tail ` · ran
- 2026-08-06 17:48 · `cd cli && NODE_OPTIONS="--experimental-vm-modules" npx jest --config jest.config.cjs tests/integration/new-commands.test` · ran
- 2026-08-06 17:45 · `npm test 2>&1 | grep -E "✕|FAIL|● " | head -20` · ran
- 2026-08-06 17:45 · `grep -A6 '"scripts"' package.json && npm test 2>&1 | tail -12` · ran
- 2026-08-06 17:45 · `cd /home/minipuft/Applications/claude-prompts-mcp/cli && npx jest tests/integration/new-commands.test.ts 2>&1 | tail -15` · ran

- 2026-08-06 17:42 · `for f in plans/cli-distribution-release-integration-2026-08-02.md plans/downstream-standards-federation-2026-08-02-imple` · ran

- 2026-08-07 · Plan-sync marker: the `cli/tests/integration/new-commands.test.ts` edit is fully
  flushed (logged above, committed `3e7b7306`); no further chat-only state pends against it.
