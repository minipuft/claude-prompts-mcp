---
title: "Implementation notes — T3 thread visibility"
date: 2026-08-19
status: active
tags: []
---

# Implementation notes — T3 thread visibility

Companion to `t3-thread-visibility-2026-08-19.md`. Rows 2, 3, 4 landed 2026-08-19; row 1 was
killed before execution; rows 5 and 6 were discovered during it.

## Deviations

**DEV-1 — the miss-path fix became a function, not an inline loop.**
The plan said "append each suggestion's argument signature", which reads as an edit inside the
existing early return. Inlining it would have grown a `main()` that is already the longest thing in
the file and left the branch reachable only by driving stdin. Extracted
`format_unknown_prompt_message()` beside the other `format_*` functions instead. Conservative in
the sense that matters: no behaviour beyond what the row asked for, and the branch is now unit
testable in isolation (`TestHelperInIsolation`).

**DEV-2 — one new test asserted the wrong thing and was corrected, not the code.**
`test_operators_are_visible` initially asserted `@cageerf`. The hook validates frameworks
case-folded but preserves the casing the user typed, so the real output is `@CAGEERF`. The
assertion was wrong; the code was right. Fixed the test and left a comment saying which half is
case-folded, because the asymmetry is the part a future reader will trip on.

## Discovered

**Expanded output is already enabled in this configuration.** `is_expanded_output()` returns true
here, so the hit path renders a full `Arguments:` block. Row 3 therefore delivers more than the
row anticipated — the argument list and the `Provided:` line ride into the thread as well, not
just the id.

**The fuzzy matcher never gives up.** `>>zzzqqq_no_such_thing` returns three suggestions, so the
"No similar prompts found" branch is close to unreachable against a real prompt library. Recorded
as row 5 and killed there with a revive condition rather than left as prose.

**Row 3 made a pre-existing cosmetic defect visible.** The echoed id is case-folded
(`strategicimplement`) while the directive beneath it carries `>>strategicImplement`. Nobody saw
this before because the echo did not reach the user in this client. Recorded as row 6, open.

## Corrections

**COR-1 — row 5 was killed on an unprobed mechanism, and the mechanism was wrong.**
The kill reason asserted the matcher was lenient _by design_ and that leniency beats a dead-end
message. Neither half was measured. The owner overruled the kill ("in the future i will fix this
at the source"), and probing then showed leniency was not a design property at all: the
word-overlap term scores on unbounded substring containment (`qw in iw or iw in qw`, no minimum
word length) at `cache_manager.py:246` and `command-parser.ts:604`, so `"notes".includes("no")`
scores 30 and clears the `score > 0` filter. Every query matches something because of a defect,
not a preference.

A kill reason is a claim and needs a probe exactly like a finding does. Killing on an unprobed
mechanism is worse than leaving the row open, because the kill text then teaches the wrong thing
to whoever reads it next — which is precisely what a superseded-not-deleted entry is for. Logged
to `~/.claude/observations.jsonl` under `plan-hygiene/kill-decisions`.

Third implementation discovered while probing: `errorHandling.ts:584
createDidYouMeanSuggestion()` uses pure Levenshtein with a hard `<= 2` threshold and already
behaves the way the fix wants. Nothing routes prompt-id suggestions through it. So the source fix
is a consolidation, not a new algorithm.

## Row 5 execution (2026-08-19, same day)

**DEV-3 — scope grew from "add a floor" to "move every scoring constant into a contract."**
Pre-flight failed two checks, not zero: `service` (capability reimplemented) and `defined` (every
constant declared twice). The compound reading is that patching the floor in two files would have
re-created the exact drift the row exists to remove — `cache_manager.py` already _claimed_ parity
with the TypeScript scorer in its docstring and nothing enforced it. Moving all eight constants
was the smaller long-term change. The house pattern already existed: `operators.json` +
`operator-patterns.ts` import assertion + `operators.py` runtime loader.

**DEV-4 — the "third implementation" was deleted, not consolidated.**
The previous note called `errorHandling.ts:584 createDidYouMeanSuggestion()` a consolidation
target because it already had the threshold behaviour wanted. Probing callers first showed it has
**zero** — it and its private Levenshtein were 69 lines of dead code. `cleanup-standards.md` says
delete, so it was deleted in the same change rather than merged into anything.

**DEV-5 — pyrefly caught a typing gap in the row-4 helper written earlier today.**
`isinstance(arg, dict)` narrows to `dict`, not to the `ArgumentInfo` TypedDict, so
`format_arg_signature(arg)` took `dict[Unknown, Unknown] | ArgumentInfo`. Runtime was fine; the
type was not. **This is a gate I skipped last turn**: I ran `pytest hooks/tests` but not
`npm run validate:python`, which is the gate the project CLAUDE.md actually names. A local subset
that skips a declared gate predicts nothing about CI — the project's own validation note says so
in those words. Fixed with an explicit `cast`.

**Threshold chosen by measurement, not taste.** Swept the floor 1..5 over five real typos and six
nonsense strings against the 99-prompt live library: typo top-1 accuracy is 5/5 at every value,
nonsense-silent goes 2/6 → 3/6 → 5/6 at floor 3 and gains nothing at 4 or 5. Also tested gating
the id-word side as well as the query-word side: no outcome changed, so it was not added. The
sweep and its numbers live in the contract's `rationale` field, next to the value they justify.

`the_quick_brown_fox` still matches `quick_decision`. That is correct, not residue — "quick" is a
genuine shared word.

## Row 6 execution (2026-08-20)

**No deviation from the approved shape.** Two behaviour changes plus one helper, as scoped.

**Discovered — three more dead helpers.** Enumerating every display site turned up
`format_tool_call`, `get_chain_step_args`, and `format_chain_step_args`: defined, never called.
The same shape as row 5's `createDidYouMeanSuggestion`, and the second time in two days that
walking a call graph found dead code in this file. Deliberately NOT deleted — the user scoped row
6 to the display fix, and having already widened scope once today (row 5's contract), the
disciplined move was to record row 7 rather than take the liberty twice.

**Discovered — a concurrent session is editing this repo.**
`server/src/engine/execution/operators/chain-operator-executor.ts` appeared modified between two
`git status` runs in the same session: absent at the row-5 scope check, present at the row-6 one,
mtime 00:15:23 against this work's last edit at 00:12:33, threading a `promptDir` parameter
through `renderTemplateString`. It pushed `max-lines` from baseline=1 to current=2 and turned
`lint:ratchet` red.

Attributed rather than assumed, and left alone: no file touched by rows 3-7 appears in the
`max-lines` report. Recorded as row 8 (⚠) because a gate nobody can pass blocks every later tier.
This is also the first live instance of the exact condition the t3-md overlap panel was built to
detect — two actors in one repo inside the same minutes — arriving the day after that panel
shipped with its live branch still unobserved.

**Rows 3-5 were committed by another actor while row 6 was in progress**, in four commits between
23:59:28 and 00:03:52, all authored as `minipuft`:

```
b5b1904c  fix(contracts): give both suggestion matchers one scoring contract and a word floor
c17864d9  refactor(server): delete the unreachable did-you-mean duplicate
488e5bb1  fix(hooks): carry the >> resolution line on the channel clients actually read
e01b4038  docs(docs): archive the script-tools notes its plan retirement left behind
```

**Verified intact, not assumed**: all four row-5 artifacts are on disk and tracked, and the floor
is still applied in both matchers (`cache_manager.py:253`, `command-parser.ts:612`). Nothing was
lost or mangled. An intermediate `git status` in this session showed those paths missing, which
read as deletion; they had been committed. Recorded because the wrong reading was the obvious one.

**Row 6 remains uncommitted** — `hooks/lib/cache_manager.py`, `hooks/prompt-suggest.py`, and
`hooks/tests/test_prompt_id_display_fidelity.py`.

**Consequence for committing**: `git commit -a` here would still sweep up the other session's
in-progress `chain-operator-executor.ts`, `symbolic-command-builder.ts`, and
`yaml-prompt-loader.ts`. Any commit of row 6 must name its three paths explicitly.

## Row 7 execution (2026-08-20)

**No deviation.** Three dead helpers deleted as scoped, plus the one orphan the deletion created.

**The orphan is the part worth remembering.** `format_chain_step_args` was the only caller passing
`include_desc=True` to `format_arg_signature`, so removing it made that branch unreachable. Cutting
the three functions and leaving a parameter that can now only ever be false is exactly the partial
removal `cleanup-standards.md` names — the dead code would have survived the dead-code deletion.
Checking what a removal orphans is a step, not a courtesy.

**Discovered — argument values are scanned for control syntax (row 9).** Dispatching row 7 failed
twice with `Single prompt command required for framework resolution` before the cause was clear: the
`task` argument contained `>>a --> >>b` as prose, and the chain delimiter was read out of the
argument value. Removing only the `-->` — same command, same everything else — made the identical
call succeed. Then the PostToolUse hook emitted `chain_id="chain-operator-executor"`, extracted from
the filename `chain-operator-executor.ts` in the same prose. Two components, one shape: data scanned
as syntax. Writing about this system inside a task for this system is ordinary, so this is not an
exotic collision.

**Discovered — nine unreaped sessions (row 10).** `session list` shows one active session per
`strategicImplement` run since 02:27, all reading `Step 2/1` on runs whose gate verdicts were
accepted.

**Row 8 closed by evidence, not by this work.** `chain-operator-executor.ts` is now 1369 lines
(was 1384); the other session kept working and shrank it under the counted-line limit.
`lint:ratchet` passes and `manager.ts` is again the baseline's single entry. Closed rather than left
standing: a `⚠` that outlives its condition reads as a live blocker to whoever comes next.

**Gate scope came from the project's own SSOT.** `scripts/classify-validation-scope.js` classifies
this change as `{"scope":"hooks","reason":"Only Python hooks and documentation changed."}`, whose
declared gate is `validate:python`. The TS gates were run anyway and both pass — that is how row 8's
resolution was noticed.

## Validation ledger

| What                                          | Command                                                              | Result                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| New regression tests                          | `pytest hooks/tests/test_prompt_suggest_thread_visibility.py -q`     | 12 passed                                                                                      |
| Full hook suite (no regressions)              | `pytest hooks/tests -q`                                              | 202 passed, 44 warnings                                                                        |
| Python syntax                                 | `ast.parse(prompt-suggest.py)`                                       | ok                                                                                             |
| settings.json still valid                     | `json.load` + entry count                                            | 10 deny entries; the 5 keepers absent                                                          |
| Live drive, real cache                        | 4 invocations piped to the hook                                      | all four rendered — see plan receipts                                                          |
| **Row 5** — `npm run typecheck`               | strict TS, `src/`                                                    | PASS                                                                                           |
| **Row 5** — `npm run lint:ratchet`            | ESLint regression gate                                               | PASS (3111/1004, no regressions; one `import-x/order` I introduced was fixed, not rebaselined) |
| **Row 5** — `npm run typecheck:tests:ratchet` | the gate `typecheck` is blind to                                     | PASS (369 in `tests/`, no regressions)                                                         |
| **Row 5** — `npm run test:ci`                 | full unit suite                                                      | **204 suites, 2673 passed**, 1 skipped                                                         |
| **Row 5** — `npm run validate:python`         | ruff + pyrefly + pytest                                              | PASS — **210 passed** (8 new)                                                                  |
| **Row 5** — registry/contract/arch validators | `registry-coherence`, `operator-registry-drift`, `contracts`, `arch` | all PASS                                                                                       |
| **Row 5** — falsifier                         | `>>zzzqqq_no_such_thing` / `>>test_defult`                           | silent / resolves — both halves met                                                            |
| **Row 6** — `npm run validate:python`         | ruff + pyrefly + pytest                                              | PASS — **220 passed** (10 new)                                                                 |
| **Row 6** — `npm run typecheck`               | strict TS                                                            | PASS                                                                                           |
| **Row 6** — `npm run typecheck:tests:ratchet` | tests/ regression gate                                               | PASS (369, no regressions)                                                                     |
| **Row 6** — `npm run test:ci`                 | full unit suite                                                      | **2678 passed**, 1 skipped                                                                     |
| **Row 6** — `npm run lint:ratchet`            | ESLint regression gate                                               | **RED — attributed to another session, see row 8**                                             |
| **Row 6** — falsifier                         | `>>diagnosiscrd`                                                     | → `>>diagnosisCard` — met                                                                      |
| **Row 7** — `npm run validate:python`         | the declared gate for `hooks` scope                                  | PASS — **220 passed**                                                                          |
| **Row 7** — `npm run typecheck`               | strict TS                                                            | PASS                                                                                           |
| **Row 7** — `npm run lint:ratchet`            | ESLint regression gate                                               | **PASS** — row 8 resolved itself                                                               |
| **Row 7** — live drive                        | hit w/ args · ad-hoc chain · miss w/ suggestions                     | all three render; `>>diagnosisCard signals:string` proves the reduced `format_arg_signature`   |
| **Row 7** — residue                           | `rg` for all four removed names                                      | none                                                                                           |
| **Row 11** — `npm run validate:python`        | ruff + ruff format + pyrefly + pytest                                | PASS — **226 passed** (6 new)                                                                  |
| **Row 11** — measurement                      | T3 `handleSystemMessage` vs CLI string table                         | `informational` unhandled → `runtime.warning` red row (`ClaudeAdapter.ts:3425-3436`)           |
| **Row 11** — env pinning                      | `run_hook` pins `CLAUDE_CODE_ENTRYPOINT`                             | two existing assertions no longer depend on where pytest is launched                           |

**The "cannot be validated from here" marker flipped 2026-08-20** — the first `>>` run in a T3
thread showed only the red `runtime.warning` row derived from `systemMessage`, and
`additionalContext` reaches the model, not the thread (no inline rendering exists to observe).
That measurement is what produced Row 11: withhold `systemMessage` on SDK entrypoints and have
the model echo the line as assistant text. See the plan's amended ruling and Row 11 receipt.
