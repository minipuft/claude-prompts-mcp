---
title: "Implementation notes — Script tools verification"
date: 2026-08-17
status: backlog
tags: []
---

# Implementation notes — Script tools verification

Deviation log for `script-tools-verification-2026-08-17.md`. Created before Tier 1's first edit,
per task 5.2 and the standing rule that this artifact has no gate and is otherwise written last,
when it is worth least.

Workers: log under `## Deviations` as they happen. Take the conservative option and keep going;
this is the record, not a request for permission.

## Rulings

Q1, Q2 and Q3 are OPEN in the plan. Record the ruling and its evidence here, and flip the plan row
to RULED in the same edit.

| Id  | Ruling | Evidence | Date |
| --- | ------ | -------- | ---- |

## Deviations

| Id  | Tier | Deviation | Why | Date |
| --- | ---- | --------- | --- | ---- |

## Falsification record

A row closes only with an entry here. "Test added" is not a closure — the mutation must have been
applied and a named test must have failed.

| Claim | Mutation applied | Test that failed | Date |
| ----- | ---------------- | ---------------- | ---- |

## Carried-in evidence (from the diagnosis that produced this plan)

Not deviations — recorded so a worker does not re-derive them.

| Fact                                                   | How it was established                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `ScriptReferenceResolver` never reads `tool.execution` | `rg "confirm\|execution\|trigger"` on the file returns only local variables (`executionCache`, `executionResult`) |
| No test imports the process executor                   | `rg -l "executeProcess\|spawnProcess" tests/` returns zero files                                                  |
| Timeout/env coverage exists only for shell-verify      | `rg -l "SAFE_ENV_ALLOWLIST\|timedOut" tests/` returns 6 files, all under gates/shell                              |
| `ToolTriggerFilterPort` already crosses engine→modules | declared `shared/types/index.ts:408`, imported `08-script-execution-stage.ts:29,58`                               |
| python3 is not a guaranteed suite dependency           | `validate:python` in `.github/workflows/ci.yml` is conditional on changed paths                                   |

## Tooling hazard found during Step 3

`rg -rn "<pattern>" <file>` parses `-r` as `--replace`, so every match rendered as the literal
`n` and the symbol name was destroyed in the output. Pasted uncritically it would have read as
"the interface is named `n`". Use `rg -n`, and treat a suspiciously uniform match column as a
flag argument error rather than a finding.
