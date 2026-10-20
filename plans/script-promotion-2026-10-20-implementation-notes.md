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

## Findings
