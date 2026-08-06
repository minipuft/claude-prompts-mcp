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

## Unknowns / gaps found during execution

- **RP behavior with a never-released manifest version** (the trap G2 closed): a manifest stating a
  version with no matching tag makes release-please's commit-range derivation undefined — the
  reason the reset went back to 3.1.1 rather than forward to 3.2.0. If a future manual publish
  pre-stages again, the manifest is the file that must NOT be pre-staged.
- **`sync-versions.js` cannot set `server/package.json` itself** — it reads its target FROM that
  file; a full reset needs `npm pkg set version=X --prefix server` first. Candidate small fix:
  accept the server package in the manifest list when a CLI version is passed.

## Validation runs

- 2026-08-06 17:42 · `for f in plans/cli-distribution-release-integration-2026-08-02.md plans/downstream-standards-federation-2026-08-02-imple` · ran
