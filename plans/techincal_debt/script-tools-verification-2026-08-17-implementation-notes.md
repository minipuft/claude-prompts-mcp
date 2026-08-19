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

### Sweep that cleared the F9 fix (2026-08-18) — SUPERSEDED 2026-08-19

**The premise below is false and the conclusion it draws is wrong.** `reference_demo` uses
`{{script:word_count}}` and always did; the sweep was run with a shell function aliasing `grep`
to `ugrep`, which silently skipped that directory (DEV-T3-1). F1 and F9 were therefore **reachable
from a shipped resource**, not hardening-before-use, which is what the 2026-08-19 live drive
demonstrated. The 2026-08-19 re-measurement with `rg` is in the plan's Findings Ledger. Kept
verbatim below because the shape of the error is the reusable part: a negative result is the
easiest kind to get wrong and the hardest to notice, and this one licensed a "breaks nothing that
exists" conclusion that a single correct grep would have blocked.

> ~~Zero prompts use `{{script:id}}` anywhere: `server/resources/prompts/**`, `minipuft-plugins`,
> `gemini-prompts`, `opencode-prompts`, `~/.claude`. All 7 script tools are consumed through the
> declarative `tools:` path (`create_prompt/prompt.yaml:8`). The only script emitting template
> syntax is `prompt_builder/script.py:114`, which emits `{{ref}}` as literal text inside an error
> message — the case escaping protects, not one it breaks. So "script output is data, never template
> source" breaks nothing that exists. Consequence: F1 and F9 are hardening-before-use rather than
> actively reachable from shipped resources.~~

## Deviations

| Id       | Tier | Deviation                                                                                                                                                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                               | Date       |
| -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| DEV-T1-1 | 1    | The plan's new-file justification says every existing scripts test "mocks `ScriptExecutor.execute`". Neither does. `tests/unit/scripts/execution/script-executor.test.ts` points at nonexistent paths so every case exits on an early guard; `tests/integration/scripts/script-tools-workflow.test.ts` mocks the whole `fs` module. Same conclusion — no existing test reaches the spawn — reached by a different mechanism. | Recorded because the mechanism matters: the unit suite is a live instance of the plan's own trap (1), a test that cannot observe the code it names because an earlier return short-circuits it.                                                                                                                                                                   | 2026-08-18 |
| DEV-T1-2 | 1    | Row 1.5's argv assertion was ordered `result.success` first, `existsSync(sentinel)` second. Under the `shell: true` mutation the injected `;.cjs` exits non-zero, so the test failed on the success line and the sentinel line never ran. Reordered so the sentinel is asserted first.                                                                                                                                       | The mutation "failed the test" while never exercising the claim the test exists to make — trap (1) again, caught only because the failing line number was checked rather than the pass/fail result.                                                                                                                                                               | 2026-08-18 |
| DEV-T1-3 | 1    | The first timeout mutation removed only `killProcess(...)` and the test SURVIVED. The SIGTERM and the 1s SIGKILL backstop are individually sufficient for a Node child, so both had to be removed before the test failed.                                                                                                                                                                                                    | Recorded as a coverage limit, not a fix: this test cannot detect a regression that removes one of the two kills. Closing that needs a unit test on the escalation itself, which is out of this plan's scope (`process.ts` is assertion-target-only).                                                                                                              | 2026-08-18 |
| DEV-T1-4 | 1    | `ToolDetectionService` takes a `ToolDetectionConfig`, not a `Logger`. My first draft passed a logger stub through an `as unknown as Logger` cast, so `config.debug` resolved to the stub's `debug` **function** — truthy — and silently enabled debug logging.                                                                                                                                                               | The cast defeated the type check that would have caught it. Noted because the same shape (stub cast to the wrong param type) would pass typecheck anywhere in this suite.                                                                                                                                                                                         | 2026-08-18 |
| DEV-T2-1 | 2    | Tier 2's two reproductions are committed as `test.failing`, not held uncommitted.                                                                                                                                                                                                                                                                                                                                            | A red test on `main` breaks CI; holding them uncommitted risks loss in a shared worktree. `test.failing` encodes the RED, keeps CI green, and **self-retires**: when Tier 3 lands the fix the body starts passing, which makes `test.failing` itself fail and forces the flip to `test`. A marker that cannot outlive what it describes (`cleanup-standards.md`). | 2026-08-18 |

| DEV-T3-1 | 3 | **The Tier 1-2 sweep claim was false.** "Zero prompts anywhere use `{{script:id}}`" was measured with a shell function aliasing `grep` to `ugrep`, which silently skipped `resources/prompts/examples/reference_demo/`. `rg` finds it immediately. | The claim reached the user, the plan, AND commit `1d2ae383`'s message before Section A re-measurement caught it. The lesson is not "ugrep is bad" — it is that a negative result (zero hits) is the easiest kind to get wrong and the hardest to notice, so it deserves a second tool before it is reported as fact. | 2026-08-19 |
| DEV-T3-2 | 3 | Two python import-insertion helpers placed `import` statements INSIDE a multi-line `import type { ... }` block, because "last line starting with `import`" matched the opening line of a multi-line import. Broke both files; caught by typecheck. | Recorded because the same one-liner is reusable and the same trap will recur — anchor on a specific import statement, never on "the last import-looking line". | 2026-08-19 |
| DEV-T3-3 | 3 | `git checkout -- src/shared/utils/jsonUtils.ts` was used to revert a mutation and **destroyed the uncommitted `neutralizeTemplateSyntax` function with it**. Restored by re-editing. | Earlier reverts in this session were safe only because those files were unmodified at HEAD. A mutation revert must restore MY working state, not HEAD. Subsequent falsifications used a scratchpad `cp` backup instead. | 2026-08-19 |
| DEV-T3-4 | 3 | Three existing tests in `script-reference-resolver.test.ts` asserted `resolvedTemplate` exactly and broke under 3.4. Retargeted to assert the RENDERED result via `processTemplate`. | Their subject — "the reference is replaced by the output" — is unchanged; only the intermediate representation moved. Asserting the raw wrapper would pin an implementation detail, while every production consumer (`processTemplateWithRefs`, `PromptReferenceResolver`) renders before anyone reads it. Enumerated all consumers before deciding. | 2026-08-19 |
| DEV-T3-5 | 3 | The two F9 tests began failing once 3.3 landed, because the guard blocked the tool before the splice ran. Added `tool:guarded_tool` to their args. | They exercise output neutralization, not confirmation; they must pass the gate to reach the code under test. A same-file interaction between two rows of one tier. | 2026-08-19 |
| DEV-T3-6 | 3 | `validate:knip-ratchet` failed 16→24 unused files: the seven executable fixtures are spawned by path and never imported. Added the fixtures dir to `knip.json` ignore (row 3.7). | **Commit `1d2ae383` would have failed CI.** The Tier 1-2 gate ran `typecheck`, the tests-ratchet, and the scoped suites, but not `validate:all` — a local subset that skipped the one check the new files could break. | 2026-08-19 |
| DEV-T3-7 | 3 | Raw-wrapping proved escapable in a way the Tier 2 probe never covered: content carrying its own `{% endraw %}` closes the wrapper. Measured behaviour is fail-closed (Nunjucks throws) rather than leaking, but it kills the render. `neutralizeTemplateSyntax` splits on every closer form and re-wraps each segment. | The plan said "handle it"; the measurement said which way it fails, which changed the fix from a security patch to an availability one. `{%- endraw -%}` turned out not to close at all. | 2026-08-19 |

| DEV-T3-8 | 3 | The loader/config-vs-Logger mismatch recurred: `ScriptToolDefinitionLoader` also takes a config, and my first draft passed a logger stub. Caught by `typecheck:tests:ratchet`, not by `typecheck` (which excludes `tests/`) and not by jest (which ran green with the wrong argument). | Second sighting of the shape DEV-T1-4 records. Both classes read `config.debug`, so a stub whose `debug` is a function silently enables debug logging while every runtime check passes. Only the tests-typecheck ratchet sees it — which is exactly why project CLAUDE.md calls that gate not-optional. | 2026-08-19 |
| DEV-T3-9 | 3 | Row 3.6 resolved by SPLITTING the demo into two tools rather than by relaxing `word_count`. Owner ruling; the reason recorded here because it changed the row's value. | Measured before implementing: all 7 tool-declaring prompts declare exactly ONE tool, and `loadAllToolsForPrompt` appears in a single loader unit test with no end-to-end multi-tool coverage. So the fix also closes a shipped-capability coverage gap, and the pair gives a discriminating test — one tool blocked and one running in the same prompt — that no single-tool fixture can produce. | 2026-08-19 |

| DEV-T4-1 | 4 | **The Tier 4 gate was vacuous.** The plan named `npm run test:ci`; `package.json:86` defines that as `npm run test:unit`, which reads `tests/unit` only. Tier 4's tests are integration, so the stated gate could not observe one file this tier wrote. Substituted a scoped jest run plus `validate:all`. | It is not a Tier 4 defect — **every tier in this plan had the same blind gate**, because all of them wrote integration tests. A green gate that reads none of the tier's output is evidence about nothing. Raised as row 6.3 rather than patched per-tier, because the fix is one decision about what `test:ci` means. | 2026-08-19 |
| DEV-T4-2 | 4 | The plan's Step 1 says `process.ts` is "the shared spawn boundary with TWO consumers", and the file's own header doc listed two. Measured: **three**. `gate-validator.ts:386` uses `await import('#shared/utils/process.js')`. | A dynamic import is invisible to the static-import search that produced the count — and being rarely exercised is _why_ a call site ends up lazily imported, so the consumer an inventory misses is systematically the one least likely to have been tested. The missed one carries two defects (F10, F5b). Both the plan and the file header now name three. | 2026-08-19 |
| DEV-T4-3 | 4 | While implementing 4.2 the truncation message proved to under-report: the streaming handler slices stdout down to `2×cap` as it arrives, so `truncate` — which computes `output.length - maxChars` — can never report more than the cap. A 20k-char overrun under a 500 cap read "truncated 500 chars". Added `stdoutDropped`/`stderrDropped` accumulators; opened row 4.3. | Not in the plan, and found only because 4.2 required an error message that names real quantities. Writing "exceeded the cap" without checking what the adjacent number meant would have shipped a fix built on a wrong measurement. | 2026-08-19 |
| DEV-T4-4 | 4 | Row 4.1 as written says "falls back when `commands[0]` absent". Implemented as _the probe may only widen what runs_: when NO candidate resolves, `findRuntimeCommand` returns `commands[0]` anyway rather than `undefined`. | A literal reading would make an unreadable PATH — an exotic layout, a permission quirk, a platform this scan gets wrong — into a new early failure ("No interpreter found") on hosts that work today. With the fallback, an unresolvable name still reaches spawn and still fails there, exactly as before. Pinned by its own test so the choice cannot be silently reverted. | 2026-08-19 |
| DEV-T4-5 | 4 | 4.2 also changed `output` to `null` on **every** failure, not just truncation. Previously a non-zero exit returned `result.parsed ?? result.stdout` while the three early-guard failures returned `null`. | One failure shape instead of two. Verified safe by enumerating both readers first: stage 08 (`if (result.success)`) and the resolver (`if (!executionResult.success)` → throw) each gate on `success` before touching `output`, and `createErrorResult` already set `null`. | 2026-08-19 |

| DEV-T5-1 | 5 | **The post-fix live drive found the demo completely broken, and the breakage was mine.** Row 3.6's "What This Demonstrates" table contained a literal `` `{{script:id}}` `` in a header cell. `preResolve` is a regex over raw text — backticks do not protect anything — so it resolved that as a reference to a tool named `id` and threw, aborting the whole prompt. Rewriting it as `{{script:<id>}}` escaped the regex but then failed Nunjucks parsing. Fixed by removing the braces from the table entirely. | **Every gate was green with this shipped.** `validate:all` 44/44, 218 scoped tests, `verify:mcp` 18/18. `multi-tool-resource.test.ts` reads the real `tool.yaml` files but builds its own template strings, so it never rendered `user-message.md`. Third sighting of "surface check is not end-to-end" — and the first where the artifact under test was a resource rather than code. Rows 6.5 and 6.6 opened for the underlying gap. | 2026-08-19 |
| DEV-T5-2 | 5 | I was about to file the confirmation message as a defect: it says "re-run the same command" while Q1 ruled approval goes through `tool:<id>`. Drove it instead — two identical calls in one session — and **the second one ran the tool**. The stateful tracker works and the message is accurate. | The correction went the other way: my Tier 5 doc sentence ("approve either one the same way") was the thing that was wrong, because the declarative route accepts BOTH channels and the inline route accepts only `tool:<id>` — it has no pending state to resume against, having aborted the render. Both docs now carry the asymmetry as a table. A defect I was confident about, disproved by the cheapest possible probe. | 2026-08-19 |

| DEV-T5-3 | 5 | **`d6cd6b73` landed on `main` and failed CI.** Row 3.4's raw-wrapping broke 5 assertions in `tests/integration/reference/script-reference-resolution.test.ts` — a SECOND consumer test file. DEV-T3-4 enumerated consumers and fixed `tests/unit/execution/reference/`, but `rg -l resolvedTemplate tests/` was never run; the enumeration covered production callers, not test callers. Fixed the same way: assert the rendered output via a `render()` helper. | Row 6.3 predicted this in the abstract one commit earlier and I still walked into it, because the row named the gate and I kept reasoning about the _tier's_ files. Two compounding blind spots: `validate:all` and pre-push both run `test:unit` only, so nothing local executes `tests/integration/**`; and my scoped substitute gate named `tests/integration/scripts`, one directory away from the file that broke. The durable fix is 6.3; the durable habit is to enumerate consumers with `rg -l <symbol> tests/`, not from the tier's file list. | 2026-08-19 |

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

### Tier 3 — falsification record

| Claim                                                                                      | Mutation applied                                                       | Test that failed                                                                                                                                                                                     | Date       |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| The `tool:<id>` extraction rule is genuinely shared, not a dead copy (3.1, 3.2)            | `extractExplicitToolRequests` returns an empty Set unconditionally     | Six named cases in `tool-detection-service.test.ts`, including `should detect tool by explicit tool request` and `should extract tool from tool arg`                                                 | 2026-08-19 |
| An inline reference will not run a confirm-required tool the invocation did not name (3.3) | `const requiresConfirmation = false` in `script-reference-resolver.ts` | Exactly one: `inline {{script:id}} must not run a confirm:true tool the invocation did not name` — `existsSync(sentinel)` `Expected: false, Received: true`                                          | 2026-08-19 |
| Script output cannot be evaluated as template syntax (3.4)                                 | `neutralizeTemplateSyntax` returns its input unchanged                 | Two: `script output must not be evaluated as template syntax` (`Received: "Scout says: sk-SECRET-abc123"`) and `script output containing its own endraw stays literal and does not break the render` | 2026-08-19 |

Mutations were confirmed applied by assert-on-replace plus a `grep` for the injected text.
Restores used a scratchpad copy, never `git checkout` — see DEV-T3-3 for why that distinction
cost a function the first time.

| Two tools coexist in one resource and each keeps its own `confirm` (3.6) | `word_count`'s `execution.confirm` flipped `false` -> `true` in the shipped `tool.yaml` | Three of four in `multi-tool-resource.test.ts`: `loads both declared tools`, `declarative route: the auto tool is ready, the gated tool waits`, `inline route: the auto tool runs, the gated tool refuses` | 2026-08-19 |
| The `confirm` default claimed by tool.yaml comments matches the code (3.8) | n/a — documentation correction, verified by reading `DEFAULT_EXECUTION_CONFIG.confirm = true` against the comment claiming `default: false` | n/a: a comment has no test. Recorded as a measured contradiction rather than a falsified claim | 2026-08-19 |

### Tier 4 — falsification record

Seven mutations, each isolating one claim. All ran against
`tests/integration/scripts/script-executor-robustness.test.ts` (9 tests).

| Claim                                                                  | Mutation applied                                                              | Test that failed                                                                      | Date       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------- |
| A declared fallback interpreter is used when the first is absent (4.1) | `return commands[0]` restored in place of `return resolved ?? commands[0]`    | `falls back to the second candidate when the first is not on PATH` (1 of 9)           | 2026-08-19 |
| Candidate ORDER is honored, not merely candidate presence (4.1)        | `resolveExecutable` iterates `[...candidates].reverse()`                      | `still prefers the first candidate when both are on PATH` (1 of 9)                    | 2026-08-19 |
| The probe may only widen what runs, never veto it (4.1, DEV-T4-4)      | `return resolved` in place of `return resolved ?? commands[0]`                | `when no candidate resolves it still attempts the first, as before` (1 of 9)          | 2026-08-19 |
| Script stdout is capped at all (4.2)                                   | `truncateOutput: 0` restored in place of `this.maxOutputChars`                | **4 of 9**, including `the default cap is enforced without any configuration`         | 2026-08-19 |
| Truncation is reported as a failure, not a degraded success (4.2)      | `const success = result.exitCode === 0` — the `&& !overflowed` term removed   | 3 of 9, including `output over the configured cap fails, and the error names the cap` | 2026-08-19 |
| A truncated result is not offered for field access (4.2)               | `output: result.parsed ?? result.stdout` in place of the success-gated `null` | `a truncated result is not offered for field access` (1 of 9)                         | 2026-08-19 |
| The truncation notice counts what the process wrote (4.3)              | `droppedChars` ignores `alreadyDropped`                                       | `the truncation notice counts what the script wrote, not what survived` (1 of 9)      | 2026-08-19 |

Each mutation was asserted **applied** by grepping for an injected `//MUTANT` marker before the
run, and the harness aborted rather than reporting a false green when the pattern did not match.
Restores used scratchpad copies (DEV-T3-3), and both source files were verified byte-identical to
their backups with `diff` afterwards. Every mutation failed a _distinct_ named test, so no
criterion is covered only by a test that another mutation would also have caught.

**Coverage note**: the four-failure result for the cap mutation is not four independent checks —
removing the cap makes truncation impossible, so every test downstream of truncation fails at
once. The discriminating pair is the cap mutation versus the loud-failure mutation: the second
leaves truncation happening and only removes the reporting, and it spares
`the truncation notice counts what the script wrote`.

### Live drive (2026-08-19, pre-fix, against the running server)

`>>reference_demo text:"alpha beta gamma delta"` returned, in one response:

```
- Full JSON output: {"word_count":4,"character_count":19,"line_count":1,"unique_words":4}
⚠️ **Tool Confirmation**: `word_count`  →  To proceed: `>>reference_demo`
```

The script had already run while the same response asked permission to run it. Stage 08 records
`confirmationRequired` into context and does not halt; the only reader is `ResponseAssembler` at
formatting, which is after stage 18 renders the template. So on the inline path the confirmation
prompt is not a gate, it is a caption on something already done.

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

## Tier 6 — deviations and falsification record (2026-08-19)

### DEV-T6-1 — the worktree was rolled back below HEAD before work started

Tier 6 opened against a working tree that was 875 lines BEHIND `HEAD`: every file from
`639fe268` and `655642d5` was present in git and absent on disk, `t3.json` was untracked
again, and the plan file itself was the pre-Tier-6 304-line version with no Tier 6 section.
Reading that file first is how this was caught — the tier being executed did not exist in it.

Provenance: 23 files shared one mtime to the second (02:44:23), nine minutes AFTER the 02:35
commits and after the push. `git reflog` shows no reset, so nothing moved `HEAD`; the tree was
restored around it. The 213 worktree-only lines were all stale intermediates of work that is now
committed — the pre-rewrite `script-inline-path-parity.test.ts`, the earlier `{{script:<id>}}`
form of the demo table.

Conservative option taken: `git diff HEAD` saved to the scratchpad as a reversible backup, then
`git restore --source=HEAD --worktree -- .`. Nothing unique was lost and `origin/main` already
carried everything. **The lesson is the ordering, not the restore**: had the first Tier 6 edit
landed on that tree, the commit closing Tier 6 would have silently reverted two commits' worth of
CI and docs work, and every gate would have passed on the reverted state.

### DEV-T6-2 — the row's premise was right, its conclusion was not (F11)

Row 6.4 said: correct `create_gate` "to match 6.1's outcome". That instruction assumes the doc is
false only because the code is wrong, so fixing the code makes the doc true. Fixing the code did
not make the doc true.

`script_tool` has no live execution path at all. Stage 20 is the only consumer of `pass_criteria`
and it filters for `shell_verify`; `GateValidator`'s entire entry chain has zero production
callers. Writing "**Enforced** — resolves the id and runs THAT tool" would have been a _more
accurate description of dormant code_ and a _worse claim about the product_ — the failure mode
of verifying a fix against its own unit boundary. It was actually written that way first, and
reverted once the drive ran.

Generalizes past this row: **a doc row's verify condition should name an observation, not another
row's completion.** "Claim matches behavior" survives F11; "matches 6.1's outcome" did not.

### DEV-T6-3 — an arity assertion broke on a change it was not about

`shell-verify-gate-criteria.test.ts` asserted `createGateValidator` has arity 2, as the structural
half of proving `llm_self_check` takes no config ("Arity is the only way to assert an argument's
absence"). Adding an injected script-tool runtime — a third parameter with nothing to do with
`llm_self_check` — turned it red.

The claim was still true; the proxy could not express it. A count cannot distinguish "the retired
config argument came back" from "an unrelated argument was added". Replaced with the behavioral
form: inject a runtime whose provider THROWS, and assert the reserved type still skips and still
reports no `configPath`. That fails if config ever reaches the verdict and passes for any
unrelated injection.

### DEV-T6-4 — the drive found a defect in its own explanatory prose

The `reference_demo` summary table, rewritten to carry real `{{script:...}}` syntax inside
`{% raw %}`, gained a sentence reading "Those two cells are wrapped in `{% raw %}`". Backticks are
markdown; Nunjucks reads the tag anyway. The rendered output showed "wrapped in ``" — the literal
tag consumed as an unterminated raw open.

Third time this specific prompt's own documentation of a mechanism has triggered the mechanism
(twice pre-fix per row 6.5, once here). Rephrased to "sit inside a `raw` block". A template that
explains template syntax has no safe way to quote a tag in prose short of escaping it, and prose
is exactly where nobody looks for one.

### Falsification record — Tier 6

Each mutation was applied with a `//MUTANT` marker, confirmed present by `grep -c`, run, and
reverted from a pre-mutation copy with the marker count re-checked at 0.

| Row | Mutation applied                                                                                  | Named failure                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | Unresolved id falls back to `executeProcess({command: toolId})` — the pre-Tier-6 defect, restored | `a gate whose script_tool_id is a shell command does not run a shell` — sentinel existed (`Expected: false, Received: true`), proving the shell ran `touch` |
| 6.2 | `unrunnableScriptTool` returns `passed: true, score: 1.0`                                         | 4 failures, incl. `a missing script_tool_id does not score 1.0` and `a gate with no script-tool runtime wired fails closed rather than passing`             |
| 6.5 | Raw-range skip removed from `detectScriptReferences`                                              | 3 failures, incl. `does not execute a reference inside a raw block` (executor called once, expected zero)                                                   |

**The 6.1 mutation is the one worth keeping.** Its first version of the test asserted only the
verdict, and passed on unfixed code: `sh -c "echo hi"` produced unparseable stdout, so `passed`
was already `false` for the wrong reason. A verdict cannot distinguish "resolved nothing" from
"shelled it and the shell failed". The sentinel file can, and it is what the mutation moved.
