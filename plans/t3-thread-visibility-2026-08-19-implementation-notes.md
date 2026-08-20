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

**Not validated, and cannot be from here**: whether `additionalContext` renders inline in a T3
_thread_. Every check above ran in a terminal, where both channels are visible — which is exactly
the surface that was never broken. That remains an open marker in the plan with its falsifier
named (first `>>` run in a thread). Only the operator can close it.
