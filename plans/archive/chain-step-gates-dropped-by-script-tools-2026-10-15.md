---
title: A chain step that binds a script tool silently drops its inline gates
date: 2026-10-15
status: done
type: plan
publish: push · owner ruling 2026-10-28 ("the cut and PR split"): open the PR, no merge until review
tags: [gates, chains]
---

# A chain step that binds a script tool silently drops its inline gates

## Now (2026-10-27)

Goal: every shape this plan recorded is closed on one branch, and the README hero clip is re-recorded against the fixed server.
Slice: rows 1.1–1.3, 2.1–2.4 and the hook built-in routing are commits on local branch `fix/chain-step-gates` (not pushed); the third shape (system_message update without a yaml pointer) is still open below. Next: re-record the hero take with a retry scenario (a gate fails once) and a shorter feature string, then the owner rules on PRs.
Constraint: owner ruling 2026-10-27 — hold at the local branch until the demo is final; this file carries `publish: none`.

## Reproduction (measured 2026-10-15 on dist built Oct 6; mechanism re-read on main `5e703819`)

- Input: chain `[plain → A → plain]` where A's prompt has `tools:` (a script tool) and `inlineGateIds: [a shell_verify gate]`; started as `>>chain` with no modifier and no call-level `gates`.
- State: `applyScriptToolDefaults` (`src/engine/execution/planning/execution-planner.ts:328`) sets `modifiers.clean = true` because the call carried no modifier and `gatesRequested` (call-level only, line 361, passed unchanged into every step plan by `createChainPlan` lines 202, 226) is false.
- Observed: `applyGatesToStep` (`gate-enhancement-service.ts:531`, `shouldSkip`) returns before the step's gate ids resolve; no `## Inline Gates` section, no review, the chain advances. The call-level form of the same conflict is refused by `gate-suppression-refusal.ts` ("%clean runs without gates, but this call requested N gates"); the per-step form is not.
- Expected: the gate renders and runs, or the call is refused with that message.
- Controls: the same chains with A not binding a tool, with A delegated, with the gate listing two categories, and with `development`-category step prompts all ran their gates; `%lean >>chain` and a call-level `gates:[…]` ran the gates on the tool-bearing step too. Receipts under `~/.cache/gate-diag/` (`run-d`, `run-e` fail; `run-d-lean`, `run-e-lean`, `run-d-gates` pass; `run-real` is the showcase chain `showcase_shot` with steps 4 and 5 skipped, `run-real-lean` with all three gates PASSED).
- Where it bit: the showcase film's per-shot chain ran its key-fit and inbetween gates on none of three drives (`media/showcase/evidence/drive-FcXUmh`, `drive-VcQYuF`, `drive-P7TOpp` in the showcase worktree); plates that failed the key gate by hand reached render unchallenged on run 2.

## Rows

| Row | Task                                                                                                                                            | Artifact check                                                                                                                          | Status                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | Per-step `gatesRequested` in `createChainPlan` (inline ids and criteria count), script-tool clean default skipped for a gated step              | unit test: the three-step reproduction renders and runs A's gate; control: the same chain without the gate still gets the clean default | ✓ 2026-10-27 (local branch `fix/chain-step-gates`, `edc3fd6e`): `createChainPlan` sets `gatesRequested` per step from `declaredStepGateCount`; `chain-step-gate-script-tool.test.ts` fails 3/5 before, passes 5/5 after (control: the ungated chain keeps `clean`) |
| 1.2 | Loud failure: a step plan with gates and `clean` throws by name in `applyGatesToStep` instead of skipping                                       | planted: a step plan built with both fails with the message                                                                             | ✓ 2026-10-27 (`edc3fd6e`): `assertSkippedStepDeclaresNoGates` throws by step and modifier; planted test rejects with the message, control still skips quietly                                                                                                      |
| 1.3 | Docs: `docs/guides/gates.md` states that a step's inline gates run regardless of the prompt's tool binding, and CHANGELOG entry in reader voice | the sentence exists; changelog line present                                                                                             | ✓ 2026-10-27: sentence in `docs/guides/gates.md` §How It Works in a Chain; CHANGELOG `Fixed` entry under Unreleased                                                                                                                                                |

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
call's verdict already graded that node — ☑ 2026-10-27 (`7c6fb53e`): stage 16 passes
`gradedNodeLeftStanding` (pure, `pipeline/decisions/gates/`) to its post-advance-review guard, so no
second review opens on the node the call's verdict graded and the shell hold left standing; a passing
inline check now renders under `Shell Verification Results` in the chain reply (nothing read stage
17's result before). `shell-verify-step-hold.e2e.test.ts` row 2.3 (a) advances 1→2 in one call with
the result shown and the check run once, (b) a failing check still refuses the PASS; unit
`step-response-capture-stage` (no review after a held one-call PASS; control without a check
unchanged). Not changed: a next step's review after a shell release still opens on the next call's
stage 13; a single-prompt `:: verify:` pass still renders no result.

Seen in the same take: `creed-fidelity` (a bundled CloudySky design gate, `server/resources/gates/`,
`activation.framework_context: [RADIANT]`) attached to a `development` step running under ReACT and
put "Glow relapse … Painted bubble … readability.mjs" into a code review's gate text. Either the
framework half of the activation AND is not applied on this path or the gate should not ship in the
bundle. Row 2.4 — ☑ 2026-10-27 (`ca7a1e59`): two causes. Activation read an absent framework as
"unconstrained" for every gate type but `framework`; a declared `framework_context` now requires a
matching framework whatever the gate type (`gate-activation.test.ts`, RADIANT positive control). And
the chain prompt's own gate resolution input (`chainPromptResolutionInput`) never carried the active
framework id, so a development chain's category gates were resolved with no framework at all
(`chain-prompt-gates-framework.test.ts`: not attached under react or with none, attached under
radiant). Reverting either half fails its own test. Whether a CloudySky gate (and the RADIANT /
liquescent frameworks) belong in the bundle is an open owner question: cloudySky has no resource
workspace to move them into — ✓ 2026-10-28: ruled. cloudySky has had `.claude-prompts/` since 2026-10-27 (the gate lives there); the two frameworks follow in `plans/framework-bundle-membership-2026-10-28.md`, the slice after the PR split.

## Third shape (2026-10-18): a system_message update on a prompt with none writes the file but not the pointer

Measured on the showcase server (dist built 2026-10-06, main checkout) across 18 of 21 prompt updates: `resource_manager update` carrying only `system_message` for a prompt that has no system message writes `system-message.md` but leaves `prompt.yaml` without `systemMessageFile:`. The server answers `post-write verification FAILED (mismatched: systemMessage)` and still saves a version bump. Repeating the call with any yaml-resident key (`category` set to its current value) rewrites the yaml and succeeds. Cause: `writesYaml` in `file-operations.ts` (~line 1010) does not force a yaml rewrite when `systemMessage` is supplied and no pointer exists yet. Receipts: `media/showcase/evidence/call-*` listed in `media/showcase/v3/studies/vocabulary-2026-10-18.md` (showcase worktree). Not checked against current main. Row to add: the update path treats a new file-backed field as a yaml write; a test plants a prompt without a system message, updates with only `system_message`, and asserts the yaml carries the pointer and the verification passes.

Tracked since 2026-10-28 as row 3 of `plans/backlog/project-workspace-followups-2026-10-28.md`; not a row here.
