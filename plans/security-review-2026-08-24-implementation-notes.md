---
title: "Security review — implementation notes"
plan: security-review-2026-08-24.md
date: 2026-08-24
status: active
tags: [security, implementation-notes]
---

# Security Review — Implementation Notes

Created before the first tier runs, so deviations land as they happen rather than being
reconstructed at the end.

## Rulings

| ID  | Date | Ruling                                                       |
| --- | ---- | ------------------------------------------------------------ |
| —   | —    | OQ-1 (default execution posture) is open and blocks Tier 1.3 |

## Deviations

| ID  | Tier | Authored premise | Measured evidence |
| --- | ---- | ---------------- | ----------------- |
| —   | —    | —                | —                 |

## Findings ledger

Format is defined in the plan. `SUSPECTED` never reports as `CONFIRMED`.

| ID  | Class                  | Status    | Summary                                                                          |
| --- | ---------------------- | --------- | -------------------------------------------------------------------------------- |
| C1  | Elevation of privilege | CONFIRMED | `shell_verify` runs an author string via `sh -c` (`process.ts:381`)              |
| C2  | Elevation of privilege | CONFIRMED | Gate with no `activation` is always active; warning only (`gate-schema.ts:359`)  |
| C3  | Configuration          | CONFIRMED | Gate system on by default (`infra/config/index.ts:188`)                          |
| C4  | Elevation of privilege | CONFIRMED | `shell_command` unconstrained; `shell_working_dir`/`shell_env` author-controlled |
| C5  | Documentation          | CONFIRMED | `CLAUDE.md:247` claims the server does not execute shell commands; it does       |
| S1  | Tampering              | SUSPECTED | Path traversal on resource ids — grep found no guard, unprobed (Tier 2.1)        |

## Validation ledger

| Date       | Tier | Command                          | Result |
| ---------- | ---- | -------------------------------- | ------ |
| 2026-08-24 | —    | plan authored; no probes run yet | —      |
