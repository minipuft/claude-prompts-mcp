---
title: A chain step that binds a script tool silently drops its inline gates
date: 2026-10-15
status: draft
type: plan
publish: none
tags: [gates, chains]
---

# A chain step that binds a script tool silently drops its inline gates

## Now (2026-10-15)

Goal: a chain step's `inlineGateIds` run on every step, or the call is refused by name; a step with a gate and a clean plan fails loudly.
Slice: one PR on the server: compute `gatesRequested` per step from `step.inlineGateIds` / `inlineGateCriteria` in `createChainPlan`, so `applyScriptToolDefaults` does not set `modifiers.clean` on a step that declares gates; a loud failure where `applyGatesToStep` would skip a gated step for `clean`; a unit test with the three-step reproduction and a positive control (the same chain under `%lean` ran every gate before the fix).
Constraint: awaits the owner's publish ruling (this file carries `publish: none`).

## Reproduction (measured 2026-10-15 on dist built Oct 6; mechanism re-read on main `5e703819`)

- Input: chain `[plain → A → plain]` where A's prompt has `tools:` (a script tool) and `inlineGateIds: [a shell_verify gate]`; started as `>>chain` with no modifier and no call-level `gates`.
- State: `applyScriptToolDefaults` (`src/engine/execution/planning/execution-planner.ts:328`) sets `modifiers.clean = true` because the call carried no modifier and `gatesRequested` (call-level only, line 361, passed unchanged into every step plan by `createChainPlan` lines 202, 226) is false.
- Observed: `applyGatesToStep` (`gate-enhancement-service.ts:531`, `shouldSkip`) returns before the step's gate ids resolve; no `## Inline Gates` section, no review, the chain advances. The call-level form of the same conflict is refused by `gate-suppression-refusal.ts` ("%clean runs without gates, but this call requested N gates"); the per-step form is not.
- Expected: the gate renders and runs, or the call is refused with that message.
- Controls: the same chains with A not binding a tool, with A delegated, with the gate listing two categories, and with `development`-category step prompts all ran their gates; `%lean >>chain` and a call-level `gates:[…]` ran the gates on the tool-bearing step too. Receipts under `~/.cache/gate-diag/` (`run-d`, `run-e` fail; `run-d-lean`, `run-e-lean`, `run-d-gates` pass; `run-real` is the showcase chain `showcase_shot` with steps 4 and 5 skipped, `run-real-lean` with all three gates PASSED).
- Where it bit: the showcase film's per-shot chain ran its key-fit and inbetween gates on none of three drives (`media/showcase/evidence/drive-FcXUmh`, `drive-VcQYuF`, `drive-P7TOpp` in the showcase worktree); plates that failed the key gate by hand reached render unchallenged on run 2.

## Rows

| Row | Task                                                                                                                                            | Artifact check                                                                                                                          | Status                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1.1 | Per-step `gatesRequested` in `createChainPlan` (inline ids and criteria count), script-tool clean default skipped for a gated step              | unit test: the three-step reproduction renders and runs A's gate; control: the same chain without the gate still gets the clean default | ☐ (as of 2026-10-15 · flips when the test exists and passes) |
| 1.2 | Loud failure: a step plan with gates and `clean` throws by name in `applyGatesToStep` instead of skipping                                       | planted: a step plan built with both fails with the message                                                                             | ☐ (as of 2026-10-15 · flips when the planted test passes)    |
| 1.3 | Docs: `docs/guides/gates.md` states that a step's inline gates run regardless of the prompt's tool binding, and CHANGELOG entry in reader voice | the sentence exists; changelog line present                                                                                             | ☐ (as of 2026-10-15 · flips with the PR)                     |

## Second shape (2026-10-16)

A reply that carries its own `gate_verdict` is waved through on every step that has no open review, and the step's checks never run. This is a different defect from the first shape (no tool binding, no `clean` modifier involved); the two share only the symptom "a declared gate never grades the step".

- Input: `animation_animatic` (six gated steps, no tool bindings) driven with every reply sent as ONE call, `user_response` + `gate_verdict` (receipts `media/showcase/evidence/drive-qmh04w/` in the showcase worktree: `004`..`009` all carry both fields). The engine's own footer asks for that form: `Next: chain_id=…, user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"`.
- State: step N is rendered with its `## Inline Gates` section (it is listed on steps 2-6; only the run and the review are missing), and no review is open for N. A step's review opens when its answer is captured, and its checks run in `GateReviewStage` (`stages/20-gate-review-stage.ts`, `runGateReviewEvidence`) after capture.
- Expected: the reply opens the review, the step's shell check runs against the answer, a failing check refuses a PASS (`gate verdict refused: … recorded a failing check`).
- Observed: no `## Shell Verification Results`, no `Gate Review Required`; the run advances. A planted failing check on step 2 (exit 2) passed the same way. Step 1 ran its check only at the start call (before any answer: `ledgerFirstRenderedStep` note in stage 20), and the reply's verdict is judged against that render-time result (inferred from `answerReview` reading the stored review; not separately probed).
- Where (`server/dist/index.js`, source `server/src/engine/gates/services/gate-verdict-processor.ts`): `processReviewVerdict` (dist 188067, src 631) runs in stage 16 before stage 20. `answerVerdict` (dist 188131, src 724) passes an `open` callback for any non-bare verdict; `answerReview` (dist 188209, src 839) calls it when no review exists (`reason === "no-review"`), creating the review with `authority.createReview` and NO `checkResults`, then `advanceReview` -> `applyVerdict` (`review-lifecycle.ts`) sees no failing check and returns `passed`. The only caller that supplies `grade` (which runs `runReviewChecks` against the output) is `processDetachedReviewVerdict` (dist 187789, src 292). Stage 20 then finds no pending review and skips. The verdict that opens a review is accepted before any check has run.
- Not the cause (tested): chain category (`animation` and `development` identical), the first step's gate (present or absent, identical), reply body length / phase-guard findings (long compliant bodies: identical), tool bindings (none). A phase-guard finding only adds a structural hold; it does not restore the gate. Not isolated (the scratch chains carry neither): chain-level `gate_configuration`, `pauseOnBlocking`, the `handoff-artifacts` gate type; the split-form control above shows the animatic's own shape needs none of them to explain the loss.

### Reproduction (scratch resources, created and deleted through the client)

Three-step chain, a `shell_verify` gate per step, `>>chain` start; receipts `~/.cache/gate-diag2/run-*` (driver `drive.mjs`, `split` = reply, then verdict-only call when a review shows; `combined` = reply + verdict in one call):

| chain                                | calls                                                              | gates that ran (shell result rendered)                   |
| ------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------- |
| `animation`, split                   | 7                                                                  | GA, GB, GC (`run-anim-split-long`)                       |
| `animation`, combined                | 4                                                                  | GA at the start call only (`run-anim-combined-long`)     |
| `development`, split / combined      | 7 / 4                                                              | same as `animation` (`run-dev-*-long`)                   |
| first step ungated, either category  | split 7 / combined 4                                               | split: GB, GC; combined: none (`run-*-nofirst-*`)        |
| step 2 gate = failing probe (exit 2) | split: FAILED shown, PASS verdict refused; combined: run completes | positive control (`run-fail-split`, `run-fail-combined`) |

### Fix

- Workaround (client or chain author): answer a step with `user_response` alone; send `gate_verdict` alone in the next call when the response shows `Gate Review Required`. The driver does exactly this and every gate runs. The chain definition cannot work around it.
- Server: in `answerVerdict`, give the `open` path the same `grade` the detached path has, so the review a verdict opens is graded by `runReviewChecks` over the call's `user_response` before `advanceReview`; or refuse a verdict-with-answer on a step whose resolved gates include a check and no review is open (`send the answer alone first; its checks run on that call`). Either also removes the step-1 stale-result case (re-grade on every verdict that carries an answer). Fix the `Next:` footer to stop advertising the combined form for steps whose checks have not run.
- Class gate: a test that drives a gated chain in the combined form and asserts a failing check refuses the PASS (the `run-fail-combined` shape), plus one asserting the shell result renders on a step opened by a verdict.
- Rows: 2.1 grade-on-answer in `answerVerdict` + combined-form failing-check test — ☑ 2026-10-21 (working tree, uncommitted): `gradeReviewChecks` (`gate-review-grading.ts`) runs the review's check-tier gates against the call's `user_response` whenever a verdict carries one, on a review this call opened or one opened at render; `tests/unit/gates/services/gate-verdict-answer-grades-checks.test.ts` fails 3/4 before and passes 4/4 after. 2.2 `docs/guides/gates.md` sentence — ☑ 2026-10-21; the `Next:` footer keeps the one-call form, which now runs the checks it used to skip.
- Where it bit next (2026-10-21): the README hero recording — the model followed the footer, the gate never ran on screen, and the clip could not show a shell gate verifying anything.
- Note: `server/dist` here is built 2026-10-06; `answerVerdict`/`answerReview` read the same on main `49bfb674` (`adjudicateReviewEvent` is new there; the `open` path has no `grade`).

## Second shape, inline operator variant (2026-10-21): the one-call reply costs a second verdict

Measured on the README hero take (sonnet, dist built 2026-10-21 with row 2.1 in): a chain started as
`>>implement_feature … @ReACT :: verify:"npm test" --> >>review`, answered with `user_response` +
`gate_verdict` in one call. Server log, one call, in order: `Gate PASS - advance deferred until the
step is captured` → `Advance held by pending shell verification` → `Created post-advance
PendingGateReview {gateIds:[temp_…, creed-fidelity, framework-compliance], nodeId: n1}` → the
inline check runs (`shell_verify npm test … passed, exit 0, 144 ms`) → `Shell verification PASSED` →
`Gate review not cleared by shell verification {reason: "No ground-truth criteria ran for this
review"}` → the review for n1 is rendered again, `Progress 1/2`. The next call, `gate_verdict`
alone, advances to 2/2. So the verdict the call carried was spent on the render-time review, and the
capture opened a second, post-advance review on the same node whose reminder gates asked for the
same verdict again. The model narrated it on camera: "the engine returned the same gate review, so
I'm resending the verdict on its own." Not the row 2.1 defect (that one never ran the check); this
one runs it and still asks twice. Row 2.3 (open): a verdict that arrives with the answer should
answer the post-advance review the capture opens, or the capture should not open one when the
call's verdict already graded that node — `☐` (as of 2026-10-21 · flips when the one-call form on
an inline-verify chain advances in one call, with the shell result shown, and a failing check still
refuses).

Seen in the same take: `creed-fidelity` (a bundled CloudySky design gate, `server/resources/gates/`,
`activation.framework_context: [RADIANT]`) attached to a `development` step running under ReACT and
put "Glow relapse … Painted bubble … readability.mjs" into a code review's gate text. Either the
framework half of the activation AND is not applied on this path or the gate should not ship in the
bundle. Row 2.4 (open): decide and close — `☐` (as of 2026-10-21 · flips when a development prompt
under ReACT renders no creed-fidelity text, with a test naming the activation rule).

## Third shape (2026-10-18): a system_message update on a prompt with none writes the file but not the pointer

Measured on the showcase server (dist built 2026-10-06, main checkout) across 18 of 21 prompt updates: `resource_manager update` carrying only `system_message` for a prompt that has no system message writes `system-message.md` but leaves `prompt.yaml` without `systemMessageFile:`. The server answers `post-write verification FAILED (mismatched: systemMessage)` and still saves a version bump. Repeating the call with any yaml-resident key (`category` set to its current value) rewrites the yaml and succeeds. Cause: `writesYaml` in `file-operations.ts` (~line 1010) does not force a yaml rewrite when `systemMessage` is supplied and no pointer exists yet. Receipts: `media/showcase/evidence/call-*` listed in `media/showcase/v3/studies/vocabulary-2026-10-18.md` (showcase worktree). Not checked against current main. Row to add: the update path treats a new file-backed field as a yaml write; a test plants a prompt without a system message, updates with only `system_message`, and asserts the yaml carries the pointer and the verification passes.
