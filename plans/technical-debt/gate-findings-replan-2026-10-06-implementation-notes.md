---
title: "Gate findings, re-planned on main: implementation notes"
plan: gate-findings-replan-2026-10-06.md
date: 2026-10-06
status: active
tags: [gates, tests]
---

# Implementation notes

## Deviations

## Findings

- The branch `feat/gate-findings` is archived as `archive/feat-gate-findings` (`7a1a59945`, its 27 uncommitted Tier 3–4 files committed on 2026-10-07). Read-only comparison with `main` at `4adcbc4b2`: per-gate verdict record already on `main` (#380, #382); hot-reload activation copy and the schema deletion obsolete; shell-failure evidence, refusal carry-through and always-on partial; findings with ids, evidence objects, criterion ids, module invariants and the key-set test absent.
- `gate-shell-verify-runner.ts:202-211` drops the executor's `refused`, so a command the allowlist refused reads as `exitCode -1`: a live defect, row 1.1.
- An empty `activation: {}` activates a gate everywhere (`gate-activation.ts:151-191`); the owner has not ruled whether that meaning stays, row 1.3.
