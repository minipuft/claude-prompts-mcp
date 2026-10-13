---
title: "Skills Sync boundary — product surfaces describe translation only — Implementation Notes"
plan: skills-sync-boundary-2026-10-12.md
# (both files moved to plans/reference/ at closure)
date: 2026-10-12
status: reference
tags: [skills-sync, docs, contributing, hooks, boundaries]
---

# Implementation Notes

Deviations, discovered constraints, unknowns, and re-measurements found while
executing the plan. Conservative option taken, logged, work continued.

## Ruling rationales (2026-10-12 interview)

- R1 — delete, not relocate: the policy already lives in `~/.claude/README.md`; a second copy in
  this repo is the drift that produced the sighting.
- R2 — CONTRIBUTING over a new guide page: CONTRIBUTING already owns the pre-commit and PR
  contracts the projection participates in; a new page is one more file to keep in lockstep.
- R3 — no exporter hook: `~/.claude/skills/_index.md` has zero readers outside the `~/.claude`
  framework (measured 2026-10-12: this repo's `_index.md` hits are `resources/gates/_index.md`, a
  different file; Claude Code discovers skills by directory and SKILL.md frontmatter; the
  exporter's manifest, `diff` and prune path never read it). The owner asked whether other users'
  setups break without it — they do not.
- R4 — env with fallback over a published `cpm` subcommand: the hook is personal tooling; a
  product entry point for it would be scope this plan does not have.

## Rulings (planner thread, 2026-10-13)

- Q1 → RULED: §Run Anywhere adds nothing after the callout goes; the two existing sentences and
  the guide link stay. Alternative (a pointer to the CONTRIBUTING projection section) declined.
- R5 — `~/.claude/skills/_index.md` stays as the hand-written catalog; only the exporter-coupled
  auto-catalog branch of `validate-indexes.py` is removed (row 2.3). The owner weighed full
  retirement (precedent: `rules/_index.md` deleted under candidate-jit-context-v1 M6) and kept the
  human browsing surface.
- R6 — publish: push+merge for the Tier 1 PR; hard stops per act.

## Deviations

- DEV-T1-1 (row 1.1, 2026-10-13): the brief's delete range said lines 10-45; the "Behavior
  references" paragraph ended at 41 in the worktree copy. Worker deleted 10-41 and kept the table.
  Brief fault: a range of numbers where a text anchor was needed.
- DEV-T1-2 (row 1.1): the Verify rg used `-i`, so `agents/` in the Codex table row and
  "scripts and agents" in Quick Start matched. Case-sensitive run is 0 hits; the row's stamp
  records the case-sensitive probe.
- DEV-T1-3 (row 1.3): the brief's `npx jest` command fails on `tests/setup.ts` without
  `NODE_OPTIONS=--experimental-vm-modules`; worker used the flag `test:unit` sets. The `diff
--json` report carries output-relative file names, not the resolved root, so the test observes
  the project root through `export --client agent-plugins --scope project` and files on disk, with
  `process.cwd` spied to a second temp dir.
- DEV-T1-4 (planner): the first guide commit failed commitlint (header length) and its staged
  change was swept into the `fix(cli)` commit; soft-reset and recommitted as `64f48d5b` (guide) and
  `2d2667eb` (marker + test).
- DEV-T1-5 (row 1.4): the brief said `sync` prunes only marker-carrying directories and that the
  `drift` array is described earlier in §Drift Detection. Measured: the prune plan merges
  manifest-listed and marker-carrying directories (`buildSyncPrunePlan`, `sync-engine.ts`), and the
  `drift` description sits under §Commands. The doc says "manifest lists it or its SKILL.md carries
  the marker" and links §Commands. The marker constant lives in `sync-engine.ts:4`, not
  `service.ts` as the row's Verify assumed.
- DEV-T1-6 (row 1.2): the Getting Help row was relabelled ("Understand agent guidance") rather than
  dropped; the brief allowed either.

- DEV-T1-7 (PR boundary, 2026-10-13): `validate:all` failed 1 of 85 — `validate:documented-options`
  rejected the `--from-index` token in the new CONTRIBUTING sentence (root-script flag, not a
  server CLI option). Sentence reworded; that validator, `validate:format` and
  `validate:agent-guidance` re-run green; the other 83 steps were green on the same tree minus one
  prose line, so the suite was not re-run whole.

## Live drive (2026-10-13)

`npm run build` → `verify:mcp` 20/20; a temporary `skills-sync.yaml` registering
`prompt:development/review` for `agent-plugins` project scope, `export --client agent-plugins
--scope project` with no `MCP_WORKSPACE` → wrote `<worktree>/skills/review/…` (the checkout root,
resolved by `.git`), nothing under `server/skills`. Temp config and output removed.

- DEV-T2-1 (rows 2.1–2.3): the `~/.claude` tree carried other sessions' uncommitted edits, so
  rows edited in place and the planner committed only the named files (`git add <file>`), no
  branch. Row 2.2 was folded into 2.3 because both edit `hooks/README.md`. The full hook suite has
  one pre-existing failure (`test_hidden_skill_callers.py`, `skills/evidence-report/SKILL.md:5`)
  unrelated to this plan; the row check ran `test_framework_root.py` (8/8).
- DEV-T2-2 (row 2.1): a linked worktree without the gitignored `server/skills-sync.yaml` makes the
  drift hook silent (the CLI exits 1 on the missing file); the env-var proof used a symlink to the
  main checkout instead.

## Findings

- `adoptUnmarkedSkillDirs` in `service.ts` stamps the marker onto directories exported before
  markers existed, without pruning (row 1.4 worker). Not documented; out of this plan's scope.
- CONTRIBUTING §Git Hooks lists pre-commit as eslint, prettier and typecheck and omits the guidance
  render; the new §Documentation Standards sentence is the only place it is described (row 1.2
  worker). Candidate for a later docs row, not this slice.

## Unknowns / gaps found during execution
