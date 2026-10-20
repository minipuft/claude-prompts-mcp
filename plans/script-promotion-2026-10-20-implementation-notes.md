---
title: Script promotion notes
date: 2026-10-20
status: active
plan: script-promotion-2026-10-20.md
tags: [scripts, repository-standards, fleet, hooks, validation]
---

# Script promotion — implementation notes

## 2026-10-20 — opened

- Source: chat assessment 2026-10-20 (planner session). Measured before cutting: `delivery-contract check` run against the upstream checkout at main (v1.12.0) reports drift on 5 managed files because this repo pins v1.10.1 and #508 (v1.12.0 adoption) is open, auto-merge armed, waiting on the Node 22 test jobs. Not this plan's defect.
- Upstream `package.json` has no runtime dependencies; managed scripts are `.mjs`; tests are `node --test test/**/*.test.mjs`; `validate` = test + validate-workflows + renovate + format:check.
- Rulings R1–R9 recorded in the plan.

## Deviations

- DEV-T1-1 (2026-10-20): row 1.1's brief named `scripts/dev-link.sh` for deletion; the file was not tracked (gitignored at `.gitignore:166`, retired earlier). The local ignored copy in the main checkout is what the assessment read. Fix: the stale ignore line was removed in the same commit. Lesson: `git ls-files` before naming files in a brief; `ls` reads ignored files too.

## 2026-10-20 — T1 at the PR boundary, T2 cut

- PR #509 opened, auto-merge armed. Boundary suite first ran 86/88: `validate:lockfile-sync` and `validate:delivery-contract` red because the main checkout's shared `server/node_modules` held standards 1.10.1 against the branch lockfile's 1.11.0 (#507 merged without a reinstall). Not this slice's defect; fixed at the cause (main fast-forwarded to #508, `npm ci` in server and root), then `origin/main` merged into the branch so its lockfile matched the installed 1.12.0. Both checks green after; `standards-pins` 7/7 at v1.12.0.
- Row 2.0 handoff accepted (read-only; it ran the validators' self-tests as baselines, which write nothing). Its seven questions are ruled R10–R16; R17 fixes the shared-file boundary upstream. Finding kept: `bin/delivery-contract.cjs` has an `omit` list (per-member opt-out of a managed file) — the self-gates in R4/R11 still stand because a member that never created the input should pass without editing its contract file.
- Finding: R6 links `cli/node_modules` too (tracked `package.json` + `node_modules` present); `CLAUDE.md` §Concurrent sessions and `AGENTS.md` name only root and `server/` — adoption row 2.9 updates both via `guidance:sync`.
- Finding: adoption must declare `tracked` on the suite entries for git-hooks-active (and lockfile-sync under R10) in `run-validation-suite.js`, since `validate:suite-membership` re-derives `reads` from source.

## 2026-10-20 — T2 ports landing

- 2.1, 2.4, 2.3, 2.2 accepted in that order and committed upstream one concern each (`5dd870c`, `19447d0`, `a515027`, `4714ffb`).
- DEV-T2-1: the planner added the six manifest entries before rows 2.2 and 2.5 had written their files, so `npm test` upstream went red (11 failures: "manifest entry … has no file in the template") for every worker still running. The workers attributed it correctly. Lesson: a shared-tree file that references others' outputs is committed LAST, not prepared early.
- DEV-T2-2: the first writeback's row insert for 2.1–2.5 was a no-match `str.replace` that exited 0; the committed plan at `9a49c3c7` still carried the placeholder line. Caught at the 2.1–2.4 writeback; fixed with an asserted line anchor (memory: silent no-op edits exit 0).
- Rulings on handoff concerns: docker digest refs need no `# vX.Y.Z` comment (a digest is the immutable ref) — R16 stands. The dropped YAML parse of `validate-workflows.mjs` needs no replacement: an unparseable workflow never reports its required check, so the PR blocks anyway. Lockfile fixtures under `test/fixtures/**` are not a Renovate surface (no package.json beside them).
- Finding (2.2): the new reader refuses an empty or flow-style `jobs:` block where js-yaml returned no names; loud over silent, kept.

## Findings
