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

Q1, Q2 and Q3 were RULED on 2026-08-18 by the owner after an interview. Plan rows flipped in the
same edit (commit `acfa9353`).

| Id  | Ruling                                                                                                                                                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Date       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Q1  | Inline refs honor `confirm` via the existing stateless `explicitRequest` channel; the re-run tracker is NOT extended to the inline path. Elicitation deferred to a consent-architecture plan. | `explicitRequest` is already a first-class approval channel: set from `tool:<id>` keys in the invocation args (`tool-detection-service.ts:140-150`) and checked BEFORE the confirm branch (`tool-trigger-filter.ts:150-160`). The re-run tracker carries the defects: key is `${promptId}:${toolId}` on a process-wide singleton (`pending-confirmation-tracker.ts:218,280`), so consent is unscoped across clients over HTTP; and its hash would cover the whole rendering context inline where the declarative path hashes only `match.extractedInputs` (`tool-trigger-filter.ts:181`). | 2026-08-18 |
| Q2  | No port change. Promote `extractExplicitToolRequests` out of `private` into a shared pure function instead.                                                                                   | `jsonUtils.ts:353` builds `combinedContext = { ...specialContext, ...args }` and passes it to `preResolve`, so the resolver already receives `args`. Pre-ruling rows 3.1/3.2/3.4 were deleted, not deferred — no new layer edge is created, so the `validate:arch` risk row is inapplicable.                                                                                                                                                                                                                                                                                              | 2026-08-18 |
| Q3  | Cap output AND report truncation as failure.                                                                                                                                                  | `tryParseJson` runs on the already-truncated string (`process.ts:411` then `:426`), so a silent cap degrades a structured result to an unparsed string and breaks `{{script:id.field}}`. The cap is a robustness control, not a security boundary — a script author already has arbitrary code execution by design.                                                                                                                                                                                                                                                                       | 2026-08-18 |

### Elicitation spike (2026-08-18) — viable, deferred

Recorded so it is not re-derived. `@modelcontextprotocol/server` 2.0.0 exports `inputRequired`,
`acceptedContent`, `isInputRequiredResult`; constructing a confirm elicitation emits a valid
form-mode `elicitation/create` (executed, not read from docs). Claude Code 2.1.234 advertises
`elicitation: {}` and renders form + URL modes through a queue whose action label is
`"Skip confirmation"`. The server negotiates protocol revision 2026-07-28, so it is in-era.

Deferred because `inputRequired` is a **tool-handler return value** and the confirm decision
happens deep inside the 22-stage pipeline, which has no upward input-required channel. The SDK
also warns that `requestState` returns as attacker-controlled input needing HMAC/AEAD it does not
provide. **The live round-trip is UNPROVEN** — structural evidence on the client, executed
evidence on the SDK, no end-to-end drive.

### Sweep that cleared the F9 fix (2026-08-18)

Zero prompts use `{{script:id}}` anywhere: `server/resources/prompts/**`, `minipuft-plugins`,
`gemini-prompts`, `opencode-prompts`, `~/.claude`. All 7 script tools are consumed through the
declarative `tools:` path (`create_prompt/prompt.yaml:8`). The only script emitting template
syntax is `prompt_builder/script.py:114`, which emits `{{ref}}` as literal text inside an error
message — the case escaping protects, not one it breaks. So "script output is data, never template
source" breaks nothing that exists. Consequence: F1 and F9 are hardening-before-use rather than
actively reachable from shipped resources.

## Deviations

| Id       | Tier | Deviation                                                                                                                                                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                               | Date       |
| -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| DEV-T1-1 | 1    | The plan's new-file justification says every existing scripts test "mocks `ScriptExecutor.execute`". Neither does. `tests/unit/scripts/execution/script-executor.test.ts` points at nonexistent paths so every case exits on an early guard; `tests/integration/scripts/script-tools-workflow.test.ts` mocks the whole `fs` module. Same conclusion — no existing test reaches the spawn — reached by a different mechanism. | Recorded because the mechanism matters: the unit suite is a live instance of the plan's own trap (1), a test that cannot observe the code it names because an earlier return short-circuits it.                                                                                                                                                                   | 2026-08-18 |
| DEV-T1-2 | 1    | Row 1.5's argv assertion was ordered `result.success` first, `existsSync(sentinel)` second. Under the `shell: true` mutation the injected `;.cjs` exits non-zero, so the test failed on the success line and the sentinel line never ran. Reordered so the sentinel is asserted first.                                                                                                                                       | The mutation "failed the test" while never exercising the claim the test exists to make — trap (1) again, caught only because the failing line number was checked rather than the pass/fail result.                                                                                                                                                               | 2026-08-18 |
| DEV-T1-3 | 1    | The first timeout mutation removed only `killProcess(...)` and the test SURVIVED. The SIGTERM and the 1s SIGKILL backstop are individually sufficient for a Node child, so both had to be removed before the test failed.                                                                                                                                                                                                    | Recorded as a coverage limit, not a fix: this test cannot detect a regression that removes one of the two kills. Closing that needs a unit test on the escalation itself, which is out of this plan's scope (`process.ts` is assertion-target-only).                                                                                                              | 2026-08-18 |
| DEV-T1-4 | 1    | `ToolDetectionService` takes a `ToolDetectionConfig`, not a `Logger`. My first draft passed a logger stub through an `as unknown as Logger` cast, so `config.debug` resolved to the stub's `debug` **function** — truthy — and silently enabled debug logging.                                                                                                                                                               | The cast defeated the type check that would have caught it. Noted because the same shape (stub cast to the wrong param type) would pass typecheck anywhere in this suite.                                                                                                                                                                                         | 2026-08-18 |
| DEV-T2-1 | 2    | Tier 2's two reproductions are committed as `test.failing`, not held uncommitted.                                                                                                                                                                                                                                                                                                                                            | A red test on `main` breaks CI; holding them uncommitted risks loss in a shared worktree. `test.failing` encodes the RED, keeps CI green, and **self-retires**: when Tier 3 lands the fix the body starts passing, which makes `test.failing` itself fail and forces the flip to `test`. A marker that cannot outlive what it describes (`cleanup-standards.md`). | 2026-08-18 |

## Falsification record

A row closes only with an entry here. "Test added" is not a closure — the mutation must have been
applied and a named test must have failed.

| Claim                                                                                        | Mutation applied                                                                                                          | Test that failed                                                                                                                                                                         | Date       |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Parent-process secrets do not reach a script tool (1.4)                                      | `buildSafeEnvironment` returns `{...process.env, ...safeParentEnv, ...}` (`process.ts:169`)                               | `does not hand a parent secret to the child process` — `Received: "super-secret-value"` at line 106                                                                                      | 2026-08-18 |
| Scripts are spawned by argv, never through a shell (1.5)                                     | `spawn([cmd, ...args].join(' '), {..., shell: true})` (`process.ts:351`)                                                  | `treats a script path containing shell metacharacters as one literal argument` — `existsSync(sentinel)` `Expected: false, Received: true` at line 151; the injected `touch` actually ran | 2026-08-18 |
| A script outliving its timeout is killed within a bounded wall-clock (1.3)                   | Both kills removed from the timeout handler (`process.ts:363-371`). **Removing only SIGTERM was survived** — see DEV-T1-3 | `kills a script that outlives its timeout, within a bounded wall-clock` — `Exceeded timeout of 20000 ms for a test`                                                                      | 2026-08-18 |
| Script stdout is parsed to JSON when parseable and wrapped as `{output}` when not (1.2, 1.6) | `output: result.stdout` in place of `result.parsed ?? result.stdout` (`script-executor.ts`)                               | both `spawns the script for real and returns its parsed JSON stdout` and `wraps non-JSON stdout rather than failing`                                                                     | 2026-08-18 |
| A non-zero exit is reported as failure (1.6)                                                 | `const success = true;` in place of `result.exitCode === 0` (`script-executor.ts`)                                        | `reports a non-zero exit as failure and keeps stderr` — `Expected: false, Received: true`                                                                                                | 2026-08-18 |

Every mutation above was confirmed **applied** before the run (assert-on-replace in the patch
script plus a `grep` for the injected text) and every source file was restored with
`git checkout -- <path>` and re-verified clean with `git diff --quiet`. `src/` was clean at the
end of Tier 1. A mutation that edits a string which does not exist produces a false green; this
initiative has already paid for that once.

### Tier 2 — observed RED (the reproductions, on unmodified source)

No mutation applies here: these fail against current code by design.

| Row | Test                                                                                                                               | Observed                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | `refuses to run a confirm:true tool the invocation did not name` + `runs the same tool once the invocation names it via tool:<id>` | **GREEN** — the declarative control holds, using the real `ToolDetectionService` and `ToolTriggerFilter`. `requiresConfirmation` is derived from `execution.confirm` by the service, not asserted by hand |
| 2.2 | `inline {{script:id}} must not run a confirm:true tool the invocation did not name`                                                | **RED** — `existsSync(sentinel)` `Expected: false, Received: true`. The sentinel file proves the subprocess ran, independent of what the resolver reported                                                |
| 2.3 | `script output must not be evaluated as template syntax`                                                                           | **RED** — rendered content was `"Scout says: sk-SECRET-abc123"`. A script emitting `{{ api_key }}` in a JSON string value disclosed another argument's value into the prompt                              |

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
