---
title: "P5 Visibility Policy — Implementation Notes"
plan: adaptive-chain-runtime-p5-visibility-policy-2026-08-12.md
date: 2026-08-12
status: active
tags: [adaptive-chain-runtime, deviations]
---

# P5 Visibility Policy — Implementation Notes

Deviation log, §Rulings, and validation ledger for the P5 plan. Created before the first source edit (deviation-log discipline).

## Rulings

All five open questions ruled main-thread 2026-08-12, before any dependent tier dispatched. Plan §Open Questions statuses flip to RULED as each dependent tier launches.

### OQ-P5-1 — Exposure addressing → RULED: item kinds only

`VisibilityItem = 'previous_step_output' | 'chain_history' | 'unknowns_ledger'`. Node-id-addressed exposure hard-depends on P4-F2 (`ParsedCommandSnapshot.steps` carries no nodeId — verified chain-session.ts:61-64) and P6 is that finding's landing zone. v1 ships item kinds; node addressing is a P6-adjacent extension.

### OQ-P5-2 — unknowns_ledger in v1 → RULED: INCLUDE

Evidence: the ledger renders through exactly one helper, `buildUnknownsSection(chainContext)` in chain-operator-executor.ts (call sites :146 review path, :405 step render; source read `chainContext['unknowns_ledger']` at :721). One chokepoint in a file Tier 3 already touches — the include condition from the plan default is met.

### OQ-P5-3 — Manifest verbosity → RULED: names only

The manifest line lists withheld item NAMES, never values. Silent omission rejected: the phase's stated purpose is an honest boundary, and a subagent that cannot know something was withheld cannot flag that it needed it.

### OQ-P5-4 — Review scoping mechanism → RULED: separate `reviewGateIds`

Measured reader sweep (step 3): `accumulatedGateIds` read by stage 13:219, stage 14:183-198 (gate-guidance INJECTION input), response-assembler:684 (review display). Filtering the shared list in place would couple review scoping to injection inputs. New per-step `reviewGateIds` written on the chain path; response-assembler consumes `reviewGateIds ?? accumulatedGateIds` so the single-prompt path (:247 writer) stays byte-identical.

### OQ-P5-5 — Cold-load resume → RULED: blueprint re-derivation

Visibility declarations are definition-time facts. They persist via `ParsedCommandSnapshot.steps[].visibility` (Tier 1.2) inside the existing blueprint; no run-state table or column. The phantom-column gate would rightly reject a column whose value never mutates after parse. Round-trip proven by the 1.3 unit test + exercised again in 5.1.

## Deviations

### DEV-T1-1 — `parser-utils.ts` is not a chain-step copy site

Plan Tier 1.3 named `src/engine/execution/parsers/parser-utils.ts` as a file to thread `visibility`
through. Re-verified at edit time: that file implements only framework-operator (`@word`) text
detection outside quotes — it never constructs or copies a `ChainStep`/`ChainStepPrompt` shape.
No edit made there. The actual copy sites on the direct-command path are
`src/modules/prompts/yaml-prompt-loader.ts` (`LoadedPromptFile.chainSteps` inline type +
`normalizeChainSteps`) and `src/engine/execution/pipeline/stages/04-parsing-stage.ts`
(`ChainStepPrompt` construction in `buildDirectCommand`), both edited. Also checked and
deliberately left untouched: `src/engine/execution/parsers/symbolic-command-builder.ts`
(`buildSymbolicChain`) — the `>>` operator syntax has no grammar for a per-step `visibility:`
declaration, and that construction site already omits `inputMapping`/`outputMapping`/`retries`/
`framework` for the same reason (confirmed by reading its `ChainStepPrompt` literal), so omitting
`visibility` there matches existing precedent rather than being a missed site.
`src/engine/execution/operators/node-step-projection.ts`'s `resolveStepForNode` returns the
matched parse-time step by reference (or a synthesized insertion step with no `visibility`), so it
requires no edit — round-trip is structural there.

### DEV-T1-2 — Tier 1.4 contract regen is a no-op for this field

`tooling/contracts/*.json` and `_generated/*` describe the three MCP tool call surfaces
(`prompt_engine`, `resource_manager`, `system_control`) — `mcp-contracts.md`. `ChainStepSchema`
validates `prompt.yaml` resource content, a different SSOT (hand-written Zod in
`src/modules/prompts/prompt-schema.ts`) with no representation in the tool-contract JSON; grepped
`tooling/contracts/*.json` for `chainSteps`/`ChainStepSchema` — zero hits before or after this
change. Ran `npm run generate:contracts` and `npm run validate:contracts` per the gate; both pass
with no diff, confirming no drift, but there is nothing to author in `tooling/contracts/` for
`visibility`.

### DEV-T1-3 — Tier 1 gate's test pattern doesn't reach two of the round-trip tests

`npm run test:match -- "prompt-schema|parser"` matches Jest `--testPathPatterns` against the file
PATH. Neither `tests/unit/prompts/yaml-to-prompt-data.test.ts` (covers `normalizeChainSteps`
threading — the actual regression risk, per that file's own existing comment on the sibling `id`
test) nor `tests/unit/execution/pipeline/parsing-stage-commandtype.test.ts` (covers
`ChainStepPrompt` threading in `04-parsing-stage.ts`) contains the substring `prompt-schema` or
`parser` (pipeline-stage tests are named `*-stage*`/`*commandtype*`, not `*parser*`; only
`tests/unit/execution/parsers/*` matches `parser`). Ran the gate command exactly as specified
(230/230 pass, unaffected by this tier's changes) and separately ran
`npm run test:match -- "yaml-to-prompt-data|parsing-stage-commandtype"` (27/27 pass) to verify the
new round-trip tests actually run and pass. Also ran
`npm run test:match -- "chain-step-strictness|delegation-schema"` (32/32 pass) as a
collateral-damage check against the `.strict()`→`.strip()` `ChainStepSchema` change landed by a
concurrent session (D11) on the same file this tier edits.

### DEV-T2-1 — `runStepView` omitted from `DecideVisibilityInput`, not carried as an unused optional param

Tier 2's task brief offered two compliant choices for the `runStepView` input the plan sketched
("accept it as optional input for future skipped-node awareness ... or omit the param entirely
and record the narrowing as a deviation"). Checked what it would have referenced: `RunStepView`
(`src/engine/gates/services/run-step-view.ts`) already exists with exactly this shape
(`nodeIds`, `skippedNodeIds`) and was built for the gate layer's temporary-gate step targeting
(P4 row 4.1 / OQ-P4-3), not for chain visibility. Importing it into `decisions/visibility/`
would pull a `gates/services` dependency into a module the plan and the sibling
`mutation/types.ts` both describe as taking only plain data with no pipeline/domain coupling —
`decideMutation`'s equivalent input (`nodes: NodeOrderInput`) comes from `shared/utils/`, not
from another subsystem's service layer. Since v1 semantics are explicitly stated not to branch
on it, and an unused parameter carrying a cross-domain import type is a worse artifact than no
parameter, `DecideVisibilityInput` ships with exactly `{ step, priorDeclarations }`. Adding
skipped-node awareness later is additive (a new optional field) whenever a Tier actually reads
it — no interface break either way this was decided.

### DEV-T2-2 — mutation-check performed on both live branches before reporting

`testing.md` Red Flags: "Test written but never run against the broken code — a test that has
not failed is unverified, not passing." Ran two temporary mutations against
`visibility-policy.ts` (reverted before the tier gate, never committed): (1) deleted the
`withheld.push(item)` line — failed `withhold without expose` and `unknown item rejected at
schema not policy` (2 tests), left `withhold+later expose` and the two-priors test passing,
confirming those two do NOT exercise the withhold-population branch. (2) neutered the
`exposedByCurrent.has(item)` override check (always route to `withheld`) — failed `withhold+later
expose` and `two priors withholding the same item + one expose still exposes it once` (2 tests),
leaving the withhold-only test passing. The two mutations fail disjoint test sets, confirming
2.2's distinct-mutation discrimination requirement. File restored from a pre-mutation copy;
`test:match -- "visibility"` reran green (8/8) before the gate command.

### DEV-T3-1 — Tier 3 gate command ORs its patterns; ran verbatim AND precisely

`npm run test:integration -- chain` expands to `jest --runInBand tests/integration chain`. Jest
treats positional args as testPathPatterns joined by OR, so this runs every integration suite
PLUS every path matching `chain` anywhere — a superset, not the intended `integration/chain`
subset. Ran it exactly as the plan specifies (51 suites / 665 tests, green) and additionally
`npm run test:match -- "integration/chain"` (7 suites / 71 tests, green) so the tier's own new
suite is provably in the run rather than inferred from a superset pass.

### DEV-T3-2 — `chain_history` withholding covers the positional surface, not `outputMapping` aliases

`stripChainHistory` deletes `step_results`, `previous_step_results` and every `step{N}_result`
key — the surface `TextReferenceStore.buildChainVariables` and `getChainContext` publish. Named
outputs declared via a step's `outputMapping` (e.g. `{{findings}}`) are `Object.assign`-ed into
the SAME flat context as ordinary arguments and carry no marker distinguishing them, so a
withhold of `chain_history` does not remove them. Closing that needs the mapping to travel with
the rendering context (or the named outputs to live under their own namespaced key) — a Tier 1/2
data-shape change, not a Tier 3 consumer change. Recorded in the code at `stripChainHistory`'s
docblock so the boundary is discoverable from the implementation, not only from this file.
Deliberately NOT stripped: `previous_step_result`/`previous_step_output`, which are the OTHER
`VisibilityItem` — withholding history while keeping the immediately-preceding output is a
declaration the vocabulary is designed to allow, and the two tests assert exactly that split.

### DEV-T3-3 — `ExecutionEnvelope.chainHistory` has zero producers; the filter is defensive

Row 3.2 says "envelope excludes withheld items". Measured before writing it: `chainHistory` is
written by NOTHING in `src/` — `ResponseAssembler.buildHandoffEnvelope` sets only
`gateInstructions`/`frameworkGuidance`, and `ChainOperatorExecutor.buildDelegationCTA` passed
`undefined` for the whole envelope. The only writer in the repo is
`tests/unit/delegation/delegation-renderer.test.ts`. So the exclusion half of 3.2 is vacuous
today and is implemented for the field's future writer; the non-vacuous half of 3.2 is the
manifest line plus wiring the SECOND producer (DEV-T3-6). Stated here rather than left as an
apparently-complete row, since a reader could otherwise take "envelope excludes withheld items"
as evidence that history actually flows through delegation.

### DEV-T3-4 — envelope filtering lives in `delegation/`, not in `decisions/visibility/`

`applyVisibilityToEnvelope` needs both `VisibilityDecision` and `ExecutionEnvelope`. Putting it
in `decisions/visibility/` would give a pure decision module a dependency on a rendering type
(and the plan/Tier 2 both describe that module as plain-data-only); putting it in `delegation/`
and importing the decision type would give `delegation/` a `pipeline/decisions` edge no other
file in that directory has. Resolved the way `decisions/visibility/types.ts` resolved the same
tension for `ChainStepPrompt`: new file `src/engine/execution/delegation/envelope-visibility.ts`
declaring a minimal structural input (`EnvelopeVisibility = { withheld, manifest }`) that
`VisibilityDecision` satisfies without either module importing the other. `VisibilityItem`
itself is imported from `#shared/types/chain-execution.js` — the Tier 1 SSOT, reachable from
both layers.

### DEV-T3-5 — `buildDelegationCTA` signature changed: the manifest is about the DELEGATED step

Was `(nextStep, totalSteps, gateGuidanceEnabled, chainContext)`. The visibility decision the
manifest reports is a decision over the handed-off step's PRIORS, which the step object alone
cannot supply, so it now takes `(stepPrompts, nextStepIndex, gateGuidanceEnabled, chainContext)`
and derives both `nextStep` and `totalSteps` from them. A manifest computed for the rendering
step instead would report the wrong set whenever the delegated step carries its own `expose` —
covered by the discriminating test `the manifest describes the DELEGATED step, not the step
doing the handing off`.

### DEV-T3-6 — the plan named one envelope producer; there are two

Row 3.2 points at `delegation/types.ts` + `strategy.ts` + `renderer.ts`. Enumerating
`ExecutionEnvelope` writers found TWO: `ChainOperatorExecutor.buildDelegationCTA` (the CTA on a
step render) and `ResponseAssembler.buildHandoffEnvelope` (the handoff section on the formatted
response — and the only one that actually carries gate/framework text today). Wiring only the
first would leave every real handoff unlabelled, so both are wired.
`ResponseAssembler.findNextDelegatedStep` now also returns the resolved `index` rather than a
second call site recomputing the node-id/ordinal fallback and risking disagreement with it.
Visibility on that path is read off `context.parsedCommand.steps` — the parse-time blueprint,
per OQ-P5-5's re-derivation ruling. Covered by a new suite,
`tests/unit/execution/formatting/response-assembler-visibility.test.ts`.

Also enumerated and found NOT to need an edit: `strategy.ts`. The brief asked for the manifest
line to appear "per strategy contract, not just the default", but `DelegationStrategy` owns only
`resolveModel`/`formatToolCall`/`formatConstraints`, all consumed by `buildInstructions` —
envelope rendering is strategy-INDEPENDENT, so one line in `renderer.buildEnvelope` reaches all
six profiles through one path. Asserted rather than assumed: the per-profile test is
`test.each` over all six `DelegationProfile` values.

### DEV-T3-7 — review path resolves visibility for the REVIEWED step, and both ledger call sites are handled

`renderGateReviewStep` re-renders the reviewed step's own template as "Original Task
Instructions", so it uses that step's decision (`targetIndex`, tracking `targetStep`'s own
resolution: `lastStepIndex` when `resolveReviewStep` matched, else the fallback last index) —
otherwise the review is a second, un-withheld copy of context the step was denied. Both
`buildUnknownsSection` call sites (`:146` review, `:405` step render, pre-edit line numbers) plus
the review path's own template context are wired.

Early-exit audit, all four render paths traced:

| Path                                                                                              | Visibility behavior                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Normal step render (`renderNormalStep`, stage 18)                                                 | Decision applied to template context (history strip before `inputMapping`), `previous_step_output` branch, unknowns section, and the delegation CTA for the next step          |
| Gate review (`renderGateReviewStep`, stage 20)                                                    | Decision for the reviewed step applied to template context + unknowns section                                                                                                  |
| Gate RETRY render (`isRetry` branch inside the review)                                            | `originalContent` is overwritten wholesale with the static "## Review Context" stub before assembly, so no withheld value can survive; nothing to wire, exempt by construction |
| Delegation handoff (`buildDelegationCTA` + `ResponseAssembler.buildHandoffSection`)               | Manifest attached, `chainHistory` filtered (DEV-T3-3)                                                                                                                          |
| `renderStep` empty-chain early return and `renderNormalStep`'s missing-`convertedPrompt` fallback | Emit static text carrying no chain context — exempt, nothing to withhold                                                                                                       |

### DEV-T3-8 — one mutation SURVIVED on the first pass; the test was strengthened, not the claim

Seven mutations run against the tier's own code (backups restored, verified byte-identical by
`diff` afterwards). Six were killed immediately. The seventh — deleting the
`applyWithheldToTemplateContext` call from the REVIEW path — **survived**: the first version of
the review test withheld `unknowns_ledger` + `previous_step_output` and asserted the reviewed
step's output was absent, but the reviewed template read `{{previous_step_output}}` from a
fixture context that never set that key, so the assertion passed vacuously (`memory:
feedback_mutation_never_reached`). Fixed by making the fixture carry
`previous_step_output` (which real runs do — `mcp/tools/index.ts` writes the resumed
`user_response` there), pinning the reviewed step via `metadata.stepNumber` (the top-level
`stepNumber` the first draft passed is not a `PendingGateReview` field and was silently ignored
by `resolveReviewStep`), and withholding all three items so the template-context and
section paths are separately observable. Both halves of the review wiring now fail on their own
mutation.

Final kill table (each mutation reverted before the next):

| #   | Mutation                                                                     | Tests failed                               |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| M1  | drop the `withheld.has('previous_step_output')` branch in `renderNormalStep` | 2 (withhold, expose-override)              |
| M2  | drop the `stripChainHistory` call                                            | 2 (history strip, inputMapping re-publish) |
| M3  | normal-path unknowns section unconditional                                   | 1                                          |
| M4a | review path skips `applyWithheldToTemplateContext`                           | 1 (survived pre-strengthening)             |
| M4b | review path unknowns section unconditional                                   | 1                                          |
| M5  | `buildDelegationCTA` renders `undefined` envelope                            | 1                                          |
| M6  | `buildHandoffEnvelope` ignores the decision                                  | 2                                          |
| M7  | `renderer.buildEnvelope` drops the manifest line                             | 10 (incl. all six per-profile cases)       |

### DEV-T3-9 — two gates are red for reasons this tier did not cause

`lint:ratchet` reports `import-x/order` 7→9. All nine violations are in files this tier never
touched; the two new ones are in `src/shared/types/index.ts` (Tier 1's uncommitted
`VisibilityItem` import placement). Zero of the nine are in `chain-operator-executor.ts`,
`response-assembler.ts` or `delegation/*` — verified by running `npx eslint src/` and reading
every reporting file. Three violations this tier DID introduce (`no-unnecessary-type-assertion`
×3, `strict-boolean-expressions` ×2, `prettier/prettier` ×1) were fixed rather than baselined;
those rules are back at baseline.

`typecheck:tests:ratchet` reports two baseline-tracked files "absent":
`tests/integration/checkpoint/checkpoint-manager.test.ts` (staged as DELETED by a concurrent
session) and `tests/unit/prompts/delegation-schema.test.ts` (modified by a concurrent session, 11
errors now 0). Regenerating the baseline would lock in another session's uncommitted state, so it
was left alone. This tier's own increase (+1 in the new `envelope-visibility.test.ts`, a
`ClientFamily` literal) was fixed.

### DEV-T4-1 — stage 11 has no `sessionContext`; "current" was read off the run instead

Row 4.1 says `reviewGateIds` is "the filtered list FOR THE CURRENT STEP", and the frozen semantics
say to determine current "the same way the loop/stage already does". Measured: the loop has no
notion of current at all — `enhanceChainSteps` walks EVERY parse-time step in one call, and gate
enhancement is **stage 11**, which runs before `SessionManagementStage` (stage 13) publishes
`context.sessionContext`. Stage 14's `resolveCurrentChainStep` (node-id-first, ordinal fallback)
is the canonical resolver, but it reads `sessionContext.currentNodeId`, which does not exist yet.

The value stage 13 puts there is `existingSession.state.currentNodeId` (13-session-stage.ts:120),
or the first node for a new run (:160). So `RunStepView` — the run read model the gate layer
already resolves once per call for skipped-node vetoes — gained `currentNodeId`, sourced from that
same `session.state.currentNodeId`. Same fact, same run, one hop earlier. No second notion of
"current", and no new dependency: `createRunStepViewProvider` already had the session in hand.

`resolveCurrentStepKey` maps it to `{ nodeId?, ordinal }`: no run → ordinal 1 (the call that
STARTS a chain stands at its first node); `currentNodeId === null` → ordinal 0, which matches no
step, so a run that has walked off its last node publishes no scope at all. `isCurrentStep` then
matches node-id-first with ordinal fallback — the same precedence `filterGatesByStepTarget` uses,
for the same reason.

### DEV-T4-2 — row 4.2's reader is NOT the chain review; the feed that blocks chains is stage 13

Row 4.2 names `response-assembler.ts:684` (post-Tier-3: **:741**, `appendGateAction`). Traced its
reachability: `appendGateAction` is called only from `buildNextActionCTA`, which is called only
from `formatSinglePromptResponse`. A **chain step** renders through `formatChainResponse`, whose
review block is `buildGateReviewCTA` (:538) — and that reads `pendingReview.gateIds`, not
`accumulatedGateIds`. `pendingReview.gateIds` is built at **13-session-stage.ts:225**, which the
OQ-P5-4 reader sweep lists as an `accumulatedGateIds` consumer.

So row 4.2 alone would have shipped a green tier that closes nothing for chains: the surface that
actually lists gates to a client mid-chain, and the one that BLOCKS the run until a verdict
arrives, would still have been run-wide. Both readers were switched to
`reviewGateIds ?? accumulatedGateIds` — the same one-line shape, no new field, and the fallback
keeps every single-prompt path byte-identical (proved by the two pre-existing `session-stage`
tests that write only `accumulatedGateIds`; their expectations are unchanged).

Stage 14 (:183, gate-guidance INJECTION input) was deliberately left on `accumulatedGateIds`, per
OQ-P5-4. Stage 20 needed no change: it reads `pendingReview.gateIds` exclusively, so it inherits
the scoping from stage 13.

Consequence worth naming: `hasBlockingGates` stays run-wide (`totalGatesApplied > 0`), so a step
whose own gate list is empty previously opened a review against gates bound to other nodes. It now
opens none — `createPendingGateReviewIfNeeded` early-returns on the empty scope. That is the P4-F3
fix, not a regression, and it is pinned by a test.

### DEV-T4-3 — verdict indices are safe under a shorter list; nothing joins them to gate ids

Standing lesson asked explicitly. `buildStructuredVerdictTemplate` (:626) numbers `per_gate`
entries `1..N` positionally over whatever list it is handed. Traced the return path:
`GateEnforcementAuthority.parseGateVerdicts` (:148) parses `[n] PASS - why` into
`{index, passed, rationale}` with `index` as a **bare integer**, and stores it at
`context.state.gates.perGateVerdicts`. `rg` across `src/` finds **zero readers** of
`perGateVerdicts` — it is written and never consumed; the only other `index` use is
`gate-verdict-renderer.ts:82`, which re-renders `[index]` for display. No lookup joins an index
back to a gate id anywhere, so a narrower list renumbers safely. (`perGateVerdicts` being a
write-with-no-reader is a real finding, but it predates this tier and is out of scope.)

### DEV-T4-4 — the write is published BEFORE the empty-list `continue`, deliberately

`enhanceChainSteps` does `if (gateIds.length === 0) continue;` right after the filter. Publishing
after it would leave `reviewGateIds` unwritten exactly when the answer is "no gate applies to this
step" — and both readers fall back to `accumulatedGateIds` on unwritten, which is the run-wide list
this tier exists to stop showing. So `[]` is a positive finding here, not a missing write.
Mutation M5 (move the write below the `continue`) fails tests (a) and (c) and nothing else.

### DEV-T4-5 — residual: an INSERTED node as the current node still falls back to run-wide

Not fixed, and named rather than left silent. An inserted node has no parse-time step (stage 14's
`resolveCurrentChainStep` returns undefined for one by design), so the enhancement loop never
visits it, no step matches `currentStepKey`, and `reviewGateIds` stays unwritten → both readers
fall back to `accumulatedGateIds`. Behaviour on inserted nodes is therefore unchanged from before
this tier (no regression), but it is the one place P4-F3's shape survives.

Closing it means deciding what an inserted node's review should be — OQ-P4-6 says inserted nodes
get no gates in v1, which argues for `[]`, i.e. no review at all on an inserted node. That is a
behaviour decision the frozen P5 semantics do not cover, so it is left for the owner rather than
invented here. Cheap to close: `filterGatesByStepTarget` against a synthetic
`{ nodeId: currentNodeId, stepNumber: ordinal }` step after the loop.

Second, smaller residual: a step skipped by `shouldSkip(step.executionPlan?.modifiers)` `continue`s
before the filter runs, so if the CURRENT step is modifier-skipped no scope is published and the
readers fall back. Such a step receives no gate enhancement at all today, so this is also unchanged
behaviour.

### DEV-T4-6 — `enhanceChainSteps` cognitive complexity 28 → 30 (pre-existing over-limit)

Measured against `git show HEAD:` of the same file with the identical ESLint config: the function
was **already 28** against a limit of 15 before this tier. The one `if` added inside the loop costs
+2 (nesting-weighted). `lint:ratchet` is green (3199 errors / 1016 warnings, no regressions) and no
new violation lands on any line this tier wrote — verified per-line via `eslint --format json` over
the four touched source files. Decomposing a 28-complexity hot-path function is a separate
refactor, not a P5 row. A branch-free variant (collect per-step lists, select after the loop) was
considered and rejected: it saves 1 point, allocates per step, and moves the publication away from
the only place the filtered list exists.

## Validation ledger

(hook-authored; appended per validation run)

## Validation runs

- 2026-08-12 22:45 · `python3 - <<'PY' p='plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12.md' s=open(p,encoding='utf-8').read() subs=[ ` · ran
- 2026-08-12 22:44 · `git add plans/adaptive-chain-runtime-2026-08-09.md plans/adaptive-chain-runtime-2026-08-09-implementation-notes.md plans` · ran
- 2026-08-12 22:36 · `for f in server/package.json server/scripts/run-validation-suite.js server/scripts/eslint-ratchet.js server/resources/ga` · ran
- 2026-08-12 22:35 · `python3 - << 'PYEOF' plan = 'plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12.md' lines = open(plan).read()` · ran
- 2026-08-12 22:32 · `cd server && npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci && npm run ` · ran
- 2026-08-12 22:31 · `python3 - << 'PYEOF' p = 'scripts/validate-plan-row-tracking.js' s = open(p).read() # 1) auditOpenRows takes an entries ` · ran
- 2026-08-12 22:30 · `cd server && npm run validate:plan-row-tracking:self-test 2>&1 | tail -8` · ran
- 2026-08-12 22:29 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -3 && echo "=== LINT ===" && n` · ran
- 2026-08-12 22:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -3; echo "===" ; npm run lint:` · ran
- 2026-08-12 22:28 · `cd server && npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci && npm run ` · ran
- 2026-08-12 22:27 · `cat >> plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md <<'NOTES' **Tier 1 addendum — broa` · ran
- 2026-08-12 22:27 · `ps -eo pid,etime,cmd | grep -E "jest" | grep -v grep | head -5` · ran
- 2026-08-12 22:27 · `cat >> plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md <<'NOTES' **Formatting note (Tier ` · ran
- 2026-08-12 22:27 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad; md5s` · ran
- 2026-08-12 22:27 · `git show HEAD:plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md | npx prettier --check --st` · ran
- 2026-08-12 22:26 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad && cp` · ran
- 2026-08-12 22:26 · `cp /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/notes` · ran
- 2026-08-12 22:26 · `git show HEAD:plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md > /tmp/claude-1000/-home-mi` · ran
- 2026-08-12 22:26 · `npx prettier --check plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md 2>&1 | tail -5` · ran
- 2026-08-12 22:26 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementat` · ran
- 2026-08-12 22:26 · `git stash list | head -3; npx prettier --check plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-not` · ran
- 2026-08-12 22:25 · `cat >> plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md <<'WRITEBACK' ## Tier 2 — worker e` · ran
- 2026-08-12 22:24 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 550 npm run test:match -- "visibility-policy|p5-acce` · ran
- 2026-08-12 22:24 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 900 npx cross-env NODE_OPTIONS="--experimental-vm-mo` · ran
- 2026-08-12 22:23 · `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci && npm run validate:all ` · ran
- 2026-08-12 22:16 · `npm run test:match -- "resource-manager|file-operations|version-history|prompt-patch|p7-acceptance" 2>&1 | rg "Tests:|Su` · ran
- 2026-08-12 22:15 · `rg -n "overrides|permanent|frozen|freez" tooling/contracts/resource-manager.json | head -4 && npm run typecheck 2>&1 | t` · ran
- 2026-08-12 22:14 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --write tests/unit/execution/formatting/respons` · ran
- 2026-08-12 22:14 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --check src/engine/execution/formatting/respons` · ran
- 2026-08-12 22:13 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/engine/execution/formatting/response-assemble` · ran
- 2026-08-12 22:13 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "visibility|p5-acceptance|integration/` · ran
- 2026-08-12 22:13 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "operator-validation" 2>&1 | tail -8` · ran
- 2026-08-12 22:12 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "06-|delegation|chain-operator" 2>&1 |` · ran
- 2026-08-12 22:12 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -4 && echo "=== LINT ===" && n` · ran
- 2026-08-12 22:12 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && md5sum src/mcp/tools/resource-manager/core/router.ts && npm ` · ran
- 2026-08-12 22:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:arch 2>&1 | tail -8; echo "===ESLINT PER-FI` · ran
- 2026-08-12 22:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -4 && echo "===GATE2===" && np` · ran
- 2026-08-12 22:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:arch 2>&1 | tail -15` · ran
- 2026-08-12 22:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager/router" 2>&1 | tail ` · ran
- 2026-08-12 22:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "operator-validation|integration/chain` · ran
- 2026-08-12 22:10 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx tsc --noEmit --project tsconfig.test.json 2>&1 | grep "c` · ran
- 2026-08-12 22:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ls tsconfig*.json; cat scripts/typecheck-tests-ratchet.js | ` · ran
- 2026-08-12 22:09 · `npx prettier --check plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md 2>&1 | tail -` · ran
- 2026-08-12 22:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx tsc --noEmit -p tsconfig.tests.json 2>&1 | grep -i "chai` · ran
- 2026-08-12 22:09 · `cat >> plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md <<'NOTES' ## OQ-P7-8 — impl` · ran
- 2026-08-12 22:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "response-assembler|session-stage|blue` · ran
- 2026-08-12 22:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "response-assembler|session-stage|blue` · ran
- 2026-08-12 22:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "response-assembler|session-stage|blue` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && echo "=== typecheck ===" && npm run typecheck 2>&1 | tail -5` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "06-|delegation|chain-operator" 2>&1 |` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck:tests:ratchet 2>&1 | tail -8` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:arch 2>&1 | tail -10` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck && npm run lint:ratchet && npm run typeche` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -8` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "response-assembler" 2>&1 | tail -40` · ran
- 2026-08-12 22:07 · `cp /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/06-mi` · ran
- 2026-08-12 22:07 · `git stash list >/dev/null; mkdir -p /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-b` · ran
- 2026-08-12 22:07 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "response-assembler" 2>&1 | tail -50` · ran
- 2026-08-12 22:07 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:06 · `git show HEAD:server/.eslint-ratchet-baseline.json | rg -n "no-unused-vars" -A 3 && echo "=== diff of baseline ===" && g` · ran
- 2026-08-12 22:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && git status --porcelain .eslint-ratchet-baseline.json; rg -n ` · ran
- 2026-08-12 22:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && fd -H "ratchet" scripts/ . --max-depth 2 2>/dev/null | head ` · ran
- 2026-08-12 22:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:06 · `for f in server/src/engine/execution/context/context-resolver.ts server/src/engine/execution/parsers/symbolic-operator-p` · ran
- 2026-08-12 22:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src --rule '{"@typescript-eslint/no-unused-vars":` · ran
- 2026-08-12 22:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 22:05 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:05 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/engine/execution/pipeline/stages/06-operator-` · ran
- 2026-08-12 22:05 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -12` · ran
- 2026-08-12 22:05 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5 && echo "===LINT===" && npm` · ran
- 2026-08-12 22:05 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5` · ran
- 2026-08-12 22:04 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-12 22:04 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/mcp/tools/resource-manager/prompt/services/pr` · ran
- 2026-08-12 22:04 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-12 22:04 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5; echo "===LINT==="; npm run` · ran
- 2026-08-12 22:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-12 22:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx jest tests/unit/execution/pipeline/p6-probe.test.ts 2>&1` · ran
- 2026-08-12 22:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx jest tests/unit/execution/pipeline/p6-probe.test.ts 2>&1` · ran
- 2026-08-12 22:03 · `tail -8 /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/5c2e54b0-7145-4581-9f2d-cf1d4e773e39/tasks/bhqwz` · ran
- 2026-08-12 22:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && cat jest.config.js 2>/dev/null || cat jest.config.cjs 2>/dev` · ran
- 2026-08-12 22:02 · `git stash list >/dev/null; npx prettier --check docs/reference/mcp-tools.md >/dev/null 2>&1; echo "---"; git diff --stat` · ran
- 2026-08-12 22:02 · `npx prettier --check docs/reference/mcp-tools.md 2>&1 | tail -5` · ran
- 2026-08-12 22:01 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit` · ran
- 2026-08-12 22:01 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx jest tests/unit 2>&1 | tail -8` · ran
- 2026-08-12 22:01 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:00 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:00 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "version-history" 2>&1 | tail -25` · ran
- 2026-08-12 22:00 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "prompt-lifecycle-processor" 2>&1 | ta` · ran
- 2026-08-12 21:59 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "file-operations" 2>&1 | tail -30` · ran
- 2026-08-12 21:58 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "argument-contract" 2>&1 | tail -30` · ran
- 2026-08-12 21:57 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run generate:contracts 2>&1 | tail -15 && echo "=== type` · ran
- 2026-08-12 21:51 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p5-visibility-policy-2026-08-12-imple` · ran
- 2026-08-12 21:50 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "gate-review-scoping|chain-session|res` · ran
- 2026-08-12 21:50 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck:tests:ratchet 2>&1 | tail -60` · ran
- 2026-08-12 21:50 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -60` · ran
- 2026-08-12 21:50 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -40` · ran
- 2026-08-12 21:49 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 21:49 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "gate-review-scoping" 2>&1 | tail -100` · ran
- 2026-08-12 21:49 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "gate-review-scoping" 2>&1 | tail -80` · ran
- 2026-08-12 21:49 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx jest tests/unit/gates/services/gate-review-scoping.test.` · ran
- 2026-08-12 21:49 · `npx prettier --check plans/adaptive-chain-runtime-p5-visibility-policy-2026-08-12-implementation-notes.md 2>&1 echo "---` · ran
- 2026-08-12 21:49 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p5-visibility-policy-2026-08-12-imple` · ran
- 2026-08-12 21:48 · `npx prettier --write docs/reference/chain-schema.md 2>&1 && npx prettier --check docs/reference/chain-schema.md docs/ref` · ran
- 2026-08-12 21:45 · `npm run typecheck 2>&1 | tail -2 && npm run lint:ratchet 2>&1 | tail -1 && npm run test:match -- "p7-acceptance|prompt-p` · ran
- 2026-08-12 21:44 · `npx eslint src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts src/mcp/tools/resource-manager/p` · ran
- 2026-08-12 21:44 · `npx eslint src/mcp/tools/resource-manager/prompt/ --rule '{"@typescript-eslint/no-unnecessary-type-assertion":"error"}' ` · ran
- 2026-08-12 21:44 · `npx eslint src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts src/mcp/tools/resource-manager/p` · ran
- 2026-08-12 21:44 · `npm run typecheck 2>&1 | tail -3 && npm run lint:ratchet 2>&1 | tail -1 && npm run typecheck:tests:ratchet 2>&1 | tail -` · ran
- 2026-08-12 21:42 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | head -25` · ran
- 2026-08-12 21:42 · `npm run typecheck 2>&1 | head -25` · ran
- 2026-08-12 21:34 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-impl` · ran
- 2026-08-12 21:33 · `npm run typecheck:tests:ratchet 2>&1 | tail -80` · ran
- 2026-08-12 21:33 · `npm run lint:ratchet 2>&1 | tail -60` · ran
- 2026-08-12 21:32 · `npm run typecheck 2>&1 | tail -60` · ran
- 2026-08-12 21:32 · `npm run test:match -- "p7-acceptance|prompt-patch-update|resource-manager|file-operations|version-history" 2>&1 | tail -` · ran
- 2026-08-12 21:31 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -150` · ran
- 2026-08-12 21:31 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -30` · ran
- 2026-08-12 21:31 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -150` · ran
- 2026-08-12 21:29 · `npm run test:match -- "p7-acceptance" 2>&1 | grep -A 40 "DEBUG"` · ran
- 2026-08-12 21:28 · `npm run test:match -- "p7-acceptance" 2>&1 | grep -A 20 "DEBUG"` · ran
- 2026-08-12 21:28 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -60` · ran
- 2026-08-12 21:28 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -150` · ran
- 2026-08-12 21:25 · `npm run test:match -- "p7-acceptance" 2>&1 | rg -A12 "clause \(c\)" | head -30` · ran
- 2026-08-12 21:25 · `npx jest tests/integration/mcp-tools/p7-acceptance.integration.test.ts -t "clause \(c\)" 2>&1 | tail -20` · ran
- 2026-08-12 21:24 · `npm run test:match -- "p7-acceptance" 2>&1 | rg "●.*P7 acceptance" | sort -u` · ran
- 2026-08-12 21:24 · `npm run test:match -- "p7-acceptance" 2>&1 | rg "✓|✕|Tests:" | head -10` · ran
- 2026-08-12 21:23 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -8` · ran
- 2026-08-12 21:19 · `npm run test:match -- "p7-acceptance" 2>&1 | rg -B8 "266:34" | head -30` · ran
- 2026-08-12 21:19 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -25` · ran
- 2026-08-12 21:16 · `python3 - << 'PYEOF' notes = 'plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md' tex` · ran
- 2026-08-12 21:15 · `python3 - << 'PYEOF' plan = 'plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12.md' lines = open(plan).read()` · ran
- 2026-08-12 21:15 · `cd /home/minipuft/Applications/claude-prompts-mcp && npx prettier --write plans/adaptive-chain-runtime-p5-visibility-pol` · ran
- 2026-08-12 21:15 · `npm run validate:format 2>&1 | tail -3 && npm run test:match -- "resource-manager" 2>&1 | tail -5` · ran
- 2026-08-12 19:36 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-impl` · ran
- 2026-08-12 19:35 · `npx --prefix server prettier --check docs/reference/mcp-tools.md 2>&1 echo "---diff stat---" git diff --stat -- docs/ref` · ran
- 2026-08-12 19:35 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --write ../docs/reference/mcp-tools.md 2>&1 | t` · ran
- 2026-08-12 19:35 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --check ../docs/reference/mcp-tools.md 2>&1 | t` · ran
- 2026-08-12 19:30 · `cd /home/minipuft/Applications/claude-prompts-mcp && python3 - << 'PYEOF' plan = 'plans/adaptive-chain-runtime-p7-resour` · ran
- 2026-08-12 19:30 · `npm run test:match -- "file-operations|resource-manager" 2>&1 | tail -8` · ran
- 2026-08-12 19:30 · `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet 2>&1 | tail -5` · ran
- 2026-08-12 19:28 · `\ echo "=== typecheck ===" && npm run typecheck 2>&1 | tail -5 && \ echo "=== lint:ratchet ===" && npm run lint:ratchet ` · ran
- 2026-08-12 19:27 · `npm run test:match -- "file-operations|resource-manager" 2>&1 | tail -100` · ran
- 2026-08-12 19:27 · `npm run typecheck:tests:ratchet 2>&1 | tail -50` · ran
- 2026-08-12 19:26 · `npm run typecheck 2>&1 | tail -30` · ran
- 2026-08-12 19:26 · `npm run lint:ratchet 2>&1 | tail -40` · ran
- 2026-08-12 19:26 · `npx eslint src/mcp/tools/resource-manager/prompt/operations/file-operations.ts src/mcp/tools/resource-manager/prompt/cor` · ran
- 2026-08-12 19:26 · `npx eslint src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts 2>&1 | grep -E "import-x/order"` · ran
- 2026-08-12 19:25 · `sed -n '90,135p' eslint.config.mjs 2>/dev/null || sed -n '90,135p' eslint.config.js 2>/dev/null || find . -maxdepth 1 -i` · ran
- 2026-08-12 19:25 · `grep -n "import-x/order\|pathGroups\|groups:" eslint.config.* 2>/dev/null | head -40` · ran
- 2026-08-12 19:25 · `npx eslint src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts 2>&1 | head -20` · ran
- 2026-08-12 19:25 · `npx eslint src/mcp/tools/resource-manager/prompt/operations/file-operations.ts src/mcp/tools/resource-manager/prompt/ser` · ran
- 2026-08-12 19:25 · `npx eslint src/mcp/tools/resource-manager/prompt/operations/file-operations.ts src/mcp/tools/resource-manager/prompt/ser` · ran
- 2026-08-12 19:24 · `npm run lint:ratchet 2>&1 | tail -80` · ran
- 2026-08-12 19:24 · `npm run typecheck 2>&1 | tail -60` · ran
- 2026-08-12 19:23 · `npm run test:match -- "prompt-lifecycle-processor" 2>&1 | tail -60` · ran
- 2026-08-12 19:23 · `npm run test:match -- "file-operations|prompt-lifecycle-processor" 2>&1 | tail -140` · ran
- 2026-08-12 19:23 · `npm run test:match -- "prompt-lifecycle-processor" 2>&1 | tail -80` · ran
- 2026-08-12 19:23 · `npm run test:match -- "prompt-lifecycle-processor" 2>&1 | tail -80` · ran
- 2026-08-12 19:23 · `npm run test:match -- "prompt-lifecycle-processor" 2>&1 | tail -150` · ran
- 2026-08-12 19:21 · `npm run test:match -- "file-operations" 2>&1 | tail -80` · ran
- 2026-08-12 19:21 · `npm run test:match -- "file-operations" 2>&1 | tail -150` · ran
- 2026-08-12 19:21 · `npx jest tests/integration/resources/yaml-corpus.test.ts 2>&1 | tail -40` · ran
- 2026-08-12 19:21 · `npx jest tests/unit/mcp-tools/resource-manager/prompt/file-operations.validation.test.ts 2>&1 | tail -100` · ran
- 2026-08-12 19:19 · `npm run typecheck 2>&1 | tail -60` · ran
- 2026-08-12 19:12 · `python3 - << 'PYEOF' import io, re plan = '../plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12.md' with io.` · ran
- 2026-08-12 19:11 · `wc -l src/mcp/tools/resource-manager/prompt/operations/template-patch.ts; rg -n "replace_all|anchor_ambiguous" src/mcp/t` · ran
- 2026-08-12 19:10 · `echo "===FINAL GATE==="; npm run typecheck 2>&1 | tail -2; npm run validate:contracts 2>&1 | tail -2; npm run lint:ratch` · ran
- 2026-08-12 19:09 · `python3 - <<'PY' import io p='/home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p7-resource-au` · ran
- 2026-08-12 19:09 · `python3 - <<'PY' import io p='/home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p7-resource-au` · ran
- 2026-08-12 19:09 · `until ! pgrep -f "jest --runInBand tests/integration" >/dev/null; do sleep 15; done; rg "Tests:|Suites:|●.*›" /tmp/claud` · ran
- 2026-08-12 18:58 · `pgrep -f "jest --runInBand tests/integration" >/dev/null && echo STILL_RUNNING || rg "Tests:|Suites:|●.*›" /tmp/claude-1` · ran
- 2026-08-12 18:58 · `cd /home/minipuft/Applications/claude-prompts-mcp && git diff --stat -- server/.eslint-ratchet-baseline.json && git diff` · ran
- 2026-08-12 18:57 · `pgrep -f "jest --runInBand tests/integration" >/dev/null && echo STILL_RUNNING || rg "Tests:|Suites:|●.*›" /tmp/claude-1` · ran
- 2026-08-12 18:57 · `npx prettier --check src/mcp/tools/resource-manager/prompt/utils/validation.ts; npm run typecheck 2>&1 | tail -2; npm ru` · ran
- 2026-08-12 18:57 · `ls -la /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/5c2e54b0-7145-4581-9f2d-cf1d4e773e39/tasks/ | tai` · ran
- 2026-08-12 18:57 · `pgrep -f "jest --runInBand tests/integration" >/dev/null && echo STILL_RUNNING || rg "Tests:|Suites:|●.*›" /tmp/claude-1` · ran
- 2026-08-12 18:56 · `pgrep -f "jest --runInBand tests/integration" >/dev/null && echo STILL_RUNNING || rg "Tests:|Suites:|●.*›" /tmp/claude-1` · ran
- 2026-08-12 18:56 · `until ! pgrep -f "jest --runInBand tests/integration" >/dev/null; do sleep 10; done; echo INTEGRATION_DONE` · ran
- 2026-08-12 18:56 · `pgrep -f "jest --runInBand tests/integration" >/dev/null && echo STILL_RUNNING || rg "●.*›|Tests:|Suites:|exit" /tmp/cla` · ran
- 2026-08-12 18:55 · `cat /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/5c2e54b0-7145-4581-9f2d-cf1d4e773e39/tasks/bjjco9cpd` · ran
- 2026-08-12 18:55 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-impl` · ran
- 2026-08-12 18:54 · `NODE_OPTIONS="--experimental-vm-modules" timeout 1200 npx jest --runInBand tests/integration 2>&1 | rg "●.*›|Tests:|Suit` · ran
- 2026-08-12 18:43 · `NODE_OPTIONS="--experimental-vm-modules" timeout 900 npx jest --runInBand tests/unit 2>&1 | rg "●.*›|Tests:|Suites:" | h` · ran
- 2026-08-12 18:42 · `echo "===TYPECHECK==="; npm run typecheck 2>&1 | tail -2; echo "===VALIDATE:CONTRACTS==="; npm run validate:contracts 2>` · ran
- 2026-08-12 18:41 · `npx prettier --write src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts src/mcp/tools/resource` · ran
- 2026-08-12 18:41 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/utils/validation.ts' s=io.open(p,encoding='utf-8').r` · ran
- 2026-08-12 18:40 · `npx eslint --format json src/mcp/tools/schemas/resource-manager.schema.ts src/mcp/tools/resource-manager/core/types.ts s` · ran
- 2026-08-12 18:40 · `rg -n "eslint|glob|src|tests" scripts/eslint-ratchet.js | head -20` · ran
- 2026-08-12 18:40 · `npx eslint --format json src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts 2>/dev/null | node` · ran
- 2026-08-12 18:40 · `npm run lint:ratchet 2>&1 | tail -6` · ran
- 2026-08-12 18:39 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/utils/validation.ts' s=io.open(p,encoding='utf-8').r` · ran
- 2026-08-12 18:39 · `echo "=== template-patch.ts ==="; npx eslint src/mcp/tools/resource-manager/prompt/operations/template-patch.ts 2>&1 | t` · ran
- 2026-08-12 18:39 · `npx eslint src/mcp/tools/resource-manager/prompt/operations/template-patch.ts src/mcp/tools/resource-manager/prompt/util` · ran
- 2026-08-12 18:39 · `npm run typecheck 2>&1 | tail -3; echo "===CONTRACTS==="; npm run validate:contracts 2>&1 | tail -3; echo "===LINT:RATCH` · ran
- 2026-08-12 18:38 · `npx prettier --write src/mcp/tools/resource-manager/prompt/operations/template-patch.ts tests/unit/mcp-tools/resource-ma` · ran
- 2026-08-12 18:38 · `npx prettier --check src/mcp/tools/resource-manager/prompt/operations/template-patch.ts src/mcp/tools/resource-manager/p` · ran
- 2026-08-12 18:37 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/core/router.ts' s=io.open(p,encoding='utf-8').read() s=s.re` · ran
- 2026-08-12 18:37 · `npm run test:match -- "resource-manager-workflow" 2>&1 | rg "●.*›|Tests:|Suites:" | head` · ran
- 2026-08-12 18:37 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/operations/template-patch.ts' s=io.open(p,encoding='` · ran
- 2026-08-12 18:37 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open(p,` · ran
- 2026-08-12 18:37 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open(p,` · ran
- 2026-08-12 18:36 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open(p,` · ran
- 2026-08-12 18:36 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open(p,` · ran
- 2026-08-12 18:36 · `npm run test:match -- "patch-update|prompt-patch-update" 2>&1 | rg "●.*›" | head -10` · ran
- 2026-08-12 18:36 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open(p,` · ran
- 2026-08-12 18:36 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open(p,` · ran
- 2026-08-12 18:36 · `python3 - <<'PY' import io,re p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open` · ran
- 2026-08-12 18:35 · `python3 - <<'PY' import io,re p='tests/integration/mcp-tools/prompt-patch-update.test.ts' s=io.open(p,encoding='utf-8').` · ran
- 2026-08-12 18:35 · `npm run test:match -- "prompt-patch-update" 2>&1 | tail -50` · ran
- 2026-08-12 18:34 · `npm run test:match -- "patch-update" 2>&1 | tail -60` · ran
- 2026-08-12 18:33 · `npm run test:match -- "template-patch" 2>&1 | tail -20` · ran
- 2026-08-12 18:32 · `npm run validate:contracts 2>&1 | tail -8; echo "===ARCH==="; npm run validate:arch 2>&1 | tail -15` · ran
- 2026-08-12 18:32 · `npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 18:31 · `npm run generate:contracts 2>&1 | tail -5; echo "=== typecheck ==="; npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 18:20 · `python3 - << 'PYEOF' import io, re notes = '../plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementat` · ran
- 2026-08-12 18:20 · `npx prettier --write tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-processor.test.ts tests/unit/versioni` · ran
- 2026-08-12 18:19 · `python3 -c " import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' t=io.open(p,enco` · ran
- 2026-08-12 18:18 · `python3 - << 'PYEOF' import io p = 'tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-processor.test.ts' wit` · ran
- 2026-08-12 18:18 · `npm run test:match -- "resource-manager|versioning" 2>&1 | rg "Tests:|Suites:"; echo -- FALSIFY; cp src/mcp/tools/resour` · ran
- 2026-08-12 18:17 · `python3 - << 'PYEOF' import io p = 'tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-processor.test.ts' wit` · ran
- 2026-08-12 18:16 · `npm run test:match -- "resource-manager" 2>&1 | rg -B2 -A10 "✕|FAIL " | head -30` · ran
- 2026-08-12 18:16 · `npm run test:match -- "resource-manager" 2>&1 | rg -B3 -A14 "●.*›.*›" | head -30` · ran
- 2026-08-12 18:16 · `npm run test:match -- "resource-manager" 2>&1 | tail -4` · ran
- 2026-08-12 18:16 · `npm run test:match -- "versioning" 2>&1 | tail -4` · ran
- 2026-08-12 18:15 · `npm run test:match -- "versioning" 2>&1 | rg -B4 -A12 "✕|●.*›" | head -40` · ran
- 2026-08-12 18:15 · `npm run typecheck 2>&1 | tail -2 && npm run test:match -- "versioning" 2>&1 | tail -4` · ran
- 2026-08-12 18:12 · `cd server && npm run test:match -- "versioning|resource-manager" 2>&1 | tail -3 && npm run typecheck 2>&1 | tail -1 && n` · ran
- 2026-08-12 18:12 · `rg -n "npx jest tests/integration" plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md` · ran
- 2026-08-12 18:11 · `python3 - <<'PY' import io p = 'plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md' s` · ran
- 2026-08-12 18:10 · `pgrep -f "jest tests/integration" >/dev/null && echo RUNNING || cat /tmp/claude-1000/-home-minipuft-Applications-claude-` · ran
- 2026-08-12 18:10 · `pgrep -f "jest tests/integration" >/dev/null && echo RUNNING || echo DONE; ls -la /tmp/claude-1000/-home-minipuft-Applic` · ran
- 2026-08-12 18:10 · `sleep 90 2>/dev/null; pgrep -f "jest tests/integration" >/dev/null && echo RUNNING || cat /tmp/claude-1000/-home-minipuf` · ran
- 2026-08-12 18:10 · `pgrep -f "jest tests/integration" >/dev/null && echo RUNNING || cat /tmp/claude-1000/-home-minipuft-Applications-claude-` · ran
- 2026-08-12 18:10 · `pgrep -f "jest tests/integration" >/dev/null && echo RUNNING || cat /tmp/claude-1000/-home-minipuft-Applications-claude-` · ran
- 2026-08-12 18:10 · `pgrep -f "jest tests/integration" >/dev/null && echo RUNNING || echo DONE` · ran
- 2026-08-12 18:09 · `pgrep -f "jest tests/integration" >/dev/null && echo "STILL RUNNING" || echo "FINISHED"; wc -c /tmp/claude-1000/-home-mi` · ran
- 2026-08-12 18:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --check src/mcp/tools/resource-manager/prompt/s` · ran
- 2026-08-12 18:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 300 npx jes` · ran
- 2026-08-12 18:07 · `wc -c /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/5c2e54b0-7145-4581-9f2d-cf1d4e773e39/tasks/b7xq1y2` · ran
- 2026-08-12 18:06 · `cat >> plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md <<'EOF' ### Tier 2 validati` · ran
- 2026-08-12 18:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 900 npx jes` · ran
- 2026-08-12 17:54 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 900 npx jes` · ran
- 2026-08-12 17:53 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:table-contracts 2>&1 | tail -6; echo "===PH` · ran
- 2026-08-12 17:53 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "versioning|resource-manager" 2>&1 | t` · ran
- 2026-08-12 17:52 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5; echo "===LINT:RATCHET===";` · ran
- 2026-08-12 17:49 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/modules/versioning/version-history-service.ts` · ran
- 2026-08-12 17:48 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -8; echo "===LINT:RATCHET===";` · ran
- 2026-08-12 17:47 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:46 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:46 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:45 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:45 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:44 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:44 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:44 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:43 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:43 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:34 · `cd /home/minipuft/Applications/claude-prompts-mcp && python3 - << 'PYEOF' import io, re plan = 'plans/adaptive-chain-run` · ran
- 2026-08-12 17:33 · `cd server && rg -n "required|defaultValue|validation" src/mcp/tools/schemas/resource-manager.schema.ts | sed -n '1,6p'; ` · ran
- 2026-08-12 17:32 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck && npm run validate:contracts && npm run l` · ran
- 2026-08-12 17:31 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --check src/mcp/tools/schemas/resource-manager.` · ran
- 2026-08-12 17:31 · `npx prettier --write plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md 2>&1 | tail -` · ran
- 2026-08-12 17:31 · `npx prettier --check plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md 2>&1 | tail -` · ran
- 2026-08-12 17:30 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 500 npx jes` · ran
- 2026-08-12 17:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|prompt-schema" 2>&1 ` · ran
- 2026-08-12 17:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck:tests:ratchet 2>&1 | tail -10` · ran
- 2026-08-12 17:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5; echo "===VALIDATE:CONTRACT` · ran
- 2026-08-12 17:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 300 npx jes` · ran
- 2026-08-12 17:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 300 npx jes` · ran
- 2026-08-12 17:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 300 npx jes` · ran
- 2026-08-12 17:27 · `cd server && rg -n "currentNodeOrigin" src/engine/gates/services/run-step-view.ts src/engine/gates/services/gate-enhance` · ran
- 2026-08-12 17:26 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 300 npx jes` · ran
- 2026-08-12 17:25 · `python3 - <<'PY' import io p='plans/adaptive-chain-runtime-p5-visibility-policy-2026-08-12-implementation-notes.md' s=io` · ran
- 2026-08-12 17:25 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -3 && echo "=== git status ` · ran
- 2026-08-12 17:24 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -25` · ran
- 2026-08-12 17:23 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && node scripts/eslint-ratchet.js check 2>&1 | tail -20 && echo` · ran
- 2026-08-12 17:23 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/mcp/tools/resource-manager/prompt/operations/` · ran
- 2026-08-12 17:23 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 17:22 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint --format json src/engine/gates/services/run-step-` · ran
- 2026-08-12 17:22 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:ci 2>&1 | tail -6 && echo "===TYPECHECK===" && ` · ran
- 2026-08-12 17:20 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --check src/engine/gates/services/run-step-view` · ran
- 2026-08-12 17:19 · `git status --short | grep -v "^ M .github\|^ M README\|^ M docs/portfolio\|^ M package.json\|^ M plans/adaptive-chain-ru` · ran
- 2026-08-12 17:19 · `cat >> plans/adaptive-chain-runtime-p5-visibility-policy-2026-08-12-implementation-notes.md <<'EOF' ## Deviations — row ` · ran
- 2026-08-12 17:18 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && git stash list >/dev/null; git show c07a80c1:server/src/engi` · ran
- 2026-08-12 17:17 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint --format json src/engine/gates/services/gate-enha` · ran
- 2026-08-12 17:17 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:ci 2>&1 | tail -6 && echo "===TYPECHECK===" && ` · ran
- 2026-08-12 17:15 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:15 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 300 npx jes` · ran
- 2026-08-12 17:14 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && md5sum src/engine/gates/services/gate-enhancement-service.ts` · ran
- 2026-08-12 17:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/mcp/tools/resource-manager/prompt/services/pr` · ran
- 2026-08-12 17:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --write src/engine/gates/services/gate-enhancem` · ran
- 2026-08-12 17:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint --format json src/engine/gates/services/gate-enha` · ran
- 2026-08-12 17:02 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/engine/gates/services/gate-enhancement-servic` · ran
- 2026-08-12 17:02 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -25` · ran
- 2026-08-12 17:02 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5 && echo "---TESTS RATCHET--` · ran
- 2026-08-12 17:01 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:ci 2>&1 | tail -25` · ran
- 2026-08-12 17:00 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && cp /tmp/claude-1000/-home-minipuft-Applications-claude-promp` · ran
- 2026-08-12 17:00 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-12 17:00 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-12 16:59 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-12 16:59 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-12 16:58 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-12 16:58 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx jest tests/unit/gates/services/gate-review-scoping.test.` · ran
- 2026-08-12 16:57 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx tsc --noEmit 2>&1 | head -20` · ran
- 2026-08-12 16:47 · `cd /tmp/claude-1000/p5-headcheck/server && npx tsc --noEmit > /tmp/claude-1000/tsc1.txt 2>&1; echo "SRC_TSC_EXIT=$?"; wc` · ran
- 2026-08-12 16:46 · `cd /home/minipuft/Applications/claude-prompts-mcp WT=/tmp/claude-1000/p5-headcheck rm -rf "$WT" 2>/dev/null; git worktre` · ran
- 2026-08-12 08:47 · `cd server && npm run test:match -- "p5-acceptance" 2>&1 | tail -4 && npm run typecheck 2>&1 | tail -1 && npm run lint:ra` · ran
- 2026-08-12 08:33 · `npm run test:match -- "p5-acceptance" 2>&1 | tail -3 && npm run typecheck:tests:ratchet 2>&1 | tail -1; ls /tmp/claude-1` · ran
- 2026-08-12 08:30 · `timeout 1200 npm run typecheck:tests:ratchet 2>&1 | tail -6` · ran
- 2026-08-12 08:29 · `timeout 900 npm run test:match -- "p5-acceptance" > /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029` · ran
- 2026-08-12 08:28 · `npx tsc -p tsconfig.test.json --noEmit 2>&1 | grep -c "p5-acceptance"; echo "^ errors in my file (0 expected)"` · ran
- 2026-08-12 08:27 · `timeout 1200 npm run typecheck:tests:ratchet > /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-` · ran
- 2026-08-12 08:27 · `timeout 900 npm run test:match -- "p5-acceptance" > /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029` · ran
- 2026-08-12 08:26 · `timeout 900 npm run test:match -- "p5-acceptance" > /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029` · ran
- 2026-08-12 08:26 · `timeout 900 npm run test:match -- "p5-acceptance" > /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029` · ran
- 2026-08-12 08:23 · `timeout 900 npm run test:match -- "p5-acceptance" > /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029` · ran
- 2026-08-12 08:19 · `timeout 900 npm run test:match -- "p5-acceptance" > /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029` · ran
- 2026-08-12 08:16 · `wc -c /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/p5` · ran
- 2026-08-12 08:16 · `timeout 900 npm run test:match -- "p5-acceptance" > /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029` · ran
- 2026-08-12 08:13 · `pid=$(pgrep -f "bin/jest --runInBand" | head -1); echo "pid=$pid"; cat /proc/$pid/status | grep -E "State|Threads"; ls -` · ran
- 2026-08-12 08:13 · `cat jest.config.* 2>/dev/null | head -60` · ran
- 2026-08-12 08:12 · `npm run test:match -- "p5-acceptance" 2>&1 | tail -80` · ran
- 2026-08-12 08:09 · `npx prettier --check src/modules/prompts/prompt-schema.ts && npm run typecheck 2>&1 | tail -1` · ran
- 2026-08-12 08:08 · `cd /home/minipuft/Applications/claude-prompts-mcp && npx prettier --check docs/guides/injection-control.md docs/concepts` · ran
- 2026-08-12 08:07 · `cd /home/minipuft/Applications/claude-prompts-mcp && npx prettier --check docs/concepts/chains-lifecycle.md 2>&1` · ran
- 2026-08-12 08:06 · `cd /home/minipuft/Applications/claude-prompts-mcp && npx prettier --check docs/guides/injection-control.md docs/concepts` · ran
- 2026-08-12 08:06 · `cd /home/minipuft/Applications/claude-prompts-mcp && npx prettier --write docs/concepts/chains-lifecycle.md && npx prett` · ran
- 2026-08-12 08:00 · `rg -n "reviewGateIds" src/engine/execution/context/internal-state.ts src/engine/execution/pipeline/stages/13-session-sta` · ran
- 2026-08-12 07:59 · `npm run test:ci 2>&1 | grep -E "Tests:|Suites:" ; echo "=== typecheck ==="; npm run typecheck 2>&1 | tail -2; echo "=== ` · ran
- 2026-08-12 07:57 · `npm run validate:arch 2>&1 | tail -6; echo "=== integration (chain+gates) ==="; npm run test:integration 2>&1 | tail -15` · ran
- 2026-08-12 07:56 · `cp /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/ges-h` · ran
- 2026-08-12 07:56 · `npx eslint --format json src/engine/gates/services/gate-enhancement-service.ts 2>/dev/null | python3 -c " import json,sy` · ran
- 2026-08-12 07:56 · `npx eslint --format json src/engine/gates/services/gate-enhancement-service.ts src/engine/gates/services/run-step-view.t` · ran
- 2026-08-12 07:55 · `npx eslint --format unix src/engine/gates/services/gate-enhancement-service.ts src/engine/gates/services/run-step-view.t` · ran
- 2026-08-12 07:55 · `npx eslint src/engine/gates/services/gate-enhancement-service.ts src/engine/gates/services/run-step-view.ts src/engine/e` · ran
- 2026-08-12 07:55 · `npm run lint:ratchet 2>&1 | tail -12` · ran
- 2026-08-12 07:55 · `npm run validate:table-contracts 2>&1 | tail -12; echo "=== phantom ==="; npm run validate:no-phantom-columns 2>&1 | tai` · ran
- 2026-08-12 07:55 · `npm run test:ci 2>&1 | tail -40` · ran
- 2026-08-12 07:54 · `npm run typecheck 2>&1 | tail -5 && npm run typecheck:tests:ratchet 2>&1 | tail -15` · ran
- 2026-08-12 07:53 · `cp /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/s13.b` · ran
- 2026-08-12 07:53 · `python3 - <<'EOF' p='src/engine/execution/pipeline/stages/13-session-stage.ts' s=open(p).read() old=""" const gateIds = ` · ran
- 2026-08-12 07:53 · `npm run test:match -- "session-stage" 2>&1 | grep -E "●|Tests:" | head -20` · ran
- 2026-08-12 07:53 · `cp /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/ges.b` · ran
- 2026-08-12 07:52 · `cp /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/ra.ba` · ran
- 2026-08-12 07:52 · `cp /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/ges.b` · ran
- 2026-08-12 07:52 · `cp /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/ges.b` · ran
- 2026-08-12 07:52 · `cp /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/ges.b` · ran
- 2026-08-12 07:52 · `npm run test:match -- "gate-review-scoping" 2>&1 | grep -E "●|✗|●" | head -20; echo "---names---"; npm run test:match --` · ran
- 2026-08-12 07:52 · `npm run test:match -- "gate-review-scoping" 2>&1 | grep -E "✕|✓" | head -20` · ran
- 2026-08-12 07:52 · `python3 - <<'EOF' import re,io p='src/engine/gates/services/gate-enhancement-service.ts' s=open(p).read() old=""" if (th` · ran
- 2026-08-12 07:51 · `npm run test:match -- "gate-review-scoping" 2>&1 | tail -60` · ran
- 2026-08-12 07:50 · `npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 07:42 · `cd server && npm run test:match -- "visibility|integration/chain" 2>&1 | tail -4 && npm run typecheck 2>&1 | tail -1 && ` · ran
- 2026-08-12 07:41 · `npx eslint src --rule '{"prettier/prettier":"error"}' --no-inline-config 2>/dev/null | rg -B4 "prettier/prettier" | head` · ran
- 2026-08-12 07:41 · `npx prettier --write src/shared/types/index.ts && npm run lint:ratchet 2>&1 | tail -2 && npm run typecheck 2>&1 | tail -` · ran
- 2026-08-12 07:40 · `npx eslint src/shared/types/index.ts 2>&1 | rg "import-x/order|problems" ; npm run typecheck 2>&1 | tail -1 && npm run l` · ran
- 2026-08-12 07:38 · `npx eslint src/shared/types/index.ts 2>&1 | rg "import-x/order"` · ran
- 2026-08-12 07:38 · `rg -n "decideVisibility|withheld" src/engine/execution/operators/chain-operator-executor.ts | head -8; echo -- BYTE-IDEN` · ran
- 2026-08-12 07:37 · `npm run test:integration -- chain 2>&1 | tail -8 && echo "===== typecheck:tests:ratchet =====" && npm run typecheck:test` · ran
- 2026-08-12 07:35 · `npm run validate:arch 2>&1 | tail -5` · ran
- 2026-08-12 07:35 · `npm run test:unit 2>&1 | tail -12` · ran
- 2026-08-12 07:34 · `npm run test:match -- "integration/chain" 2>&1 | tail -10` · ran
- 2026-08-12 07:33 · `npm run test:integration -- chain 2>&1 | tail -15` · ran
- 2026-08-12 07:33 · `npm run typecheck:tests:ratchet 2>&1 | tail -20` · ran
- 2026-08-12 07:32 · `npx tsc --noEmit --project tsconfig.test.json 2>&1 | grep "envelope-visibility"` · ran
- 2026-08-12 07:32 · `npm run typecheck 2>&1 | tail -3; echo "=== TESTS:TESTS RATCHET ==="; npm run typecheck:tests:ratchet 2>&1 | tail -20` · ran
- 2026-08-12 07:32 · `BAK=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/bak ` · ran
- 2026-08-12 07:32 · `BAK=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/bak ` · ran
- 2026-08-12 07:31 · `npm run test:match -- "visibility-policy.integration" 2>&1 | grep -E "●|Tests:|Expected|Received" | head -30` · ran
- 2026-08-12 07:30 · `BAK=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/bak ` · ran
- 2026-08-12 07:30 · `BAK=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/bak ` · ran
- 2026-08-12 07:30 · `BAK=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/bak ` · ran
- 2026-08-12 07:30 · `BAK=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/bak ` · ran
- 2026-08-12 07:30 · `python3 - <<'EOF' import re,io p='src/engine/execution/operators/chain-operator-executor.ts' s=open(p).read() s2=s.repla` · ran
- 2026-08-12 07:29 · `npm run test:match -- "response-assembler-visibility" 2>&1 | tail -40` · ran
- 2026-08-12 07:29 · `npm run test:match -- "visibility-policy.integration" 2>&1 | tail -12` · ran
- 2026-08-12 07:28 · `npm run test:match -- "visibility-policy.integration" 2>&1 | tail -80` · ran
- 2026-08-12 07:27 · `npm run test:match -- "envelope-visibility" 2>&1 | tail -30` · ran
- 2026-08-12 07:26 · `npm run lint:ratchet 2>&1 | tail -8 && npm run typecheck 2>&1 | tail -3` · ran
- 2026-08-12 07:26 · `npx eslint src/ 2>&1 | grep -E "^/|prettier/prettier" | grep -B1 "prettier/prettier" | head -20` · ran
- 2026-08-12 07:25 · `npm run lint:ratchet 2>&1 | tail -10` · ran
- 2026-08-12 07:24 · `npx eslint src/ 2>&1 | grep -E "^/|import-x/order" | grep -B1 "import-x/order" | head -30` · ran
- 2026-08-12 07:24 · `npx eslint src/engine/execution/operators/chain-operator-executor.ts src/engine/execution/formatting/response-assembler.` · ran
- 2026-08-12 07:23 · `npx eslint src/engine/execution/operators/chain-operator-executor.ts 2>&1 | grep -nE "import-x/order|strict-boolean" | h` · ran
- 2026-08-12 07:23 · `npm run lint:ratchet 2>&1 | tail -10` · ran
- 2026-08-12 07:23 · `git stash list >/dev/null; npx eslint src/engine/execution/formatting/response-assembler.ts 2>&1 | head -40` · ran
- 2026-08-12 07:23 · `npx eslint src/engine/execution/delegation/ 2>&1 | tail -20` · ran
- 2026-08-12 07:22 · `npx eslint --format unix src/engine/execution/formatting/response-assembler.ts 2>&1 | grep -E ":(2[0-9]|3[0-9]|31[0-9]|3` · ran
- 2026-08-12 07:22 · `npx eslint --format unix src/engine/execution/delegation/envelope-visibility.ts src/engine/execution/delegation/types.ts` · ran
- 2026-08-12 07:22 · `npm run lint:ratchet 2>&1 | tail -30` · ran
- 2026-08-12 07:22 · `npm run validate:arch 2>&1 | tail -20 && npx eslint src/engine/execution/operators/chain-operator-executor.ts src/engine` · ran
- 2026-08-12 07:21 · `npm run test:match -- "chain-operator-executor|delegation|response-assembler" 2>&1 | tail -25` · ran
- 2026-08-12 07:21 · `npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 07:14 · `npm run test:match -- "visibility" 2>&1 | tail -4 && npm run typecheck 2>&1 | tail -2 && npm run typecheck:tests:ratchet` · ran
- 2026-08-12 07:12 · `npm run test:match -- "visibility" && npm run typecheck && npm run typecheck:tests:ratchet 2>&1 | tail -60` · ran
- 2026-08-12 07:12 · `npm run typecheck:tests:ratchet 2>&1 | tail -40` · ran
- 2026-08-12 07:12 · `npm run typecheck 2>&1 | tail -40` · ran
- 2026-08-12 07:12 · `cp /tmp/visibility-policy.ts.bak src/engine/execution/pipeline/decisions/visibility/visibility-policy.ts rm /tmp/visibil` · ran
- 2026-08-12 07:11 · `cp /tmp/visibility-policy.ts.bak src/engine/execution/pipeline/decisions/visibility/visibility-policy.ts # Mutation 2: n` · ran
- 2026-08-12 07:11 · `cp src/engine/execution/pipeline/decisions/visibility/visibility-policy.ts /tmp/visibility-policy.ts.bak # Mutation 1: n` · ran
- 2026-08-12 07:11 · `npm run test:match -- "visibility" 2>&1 | tail -80` · ran
- 2026-08-12 07:07 · `npm run typecheck 2>&1 | tail -3 && npm run test:match -- "prompt-schema|yaml-to-prompt-data|parsing-stage-commandtype" ` · ran
- 2026-08-12 07:06 · `npm run typecheck:tests:ratchet 2>&1 | tail -10` · ran
- 2026-08-12 07:06 · `npm run test:match -- "prompt-schema|parser" 2>&1 | tail -10` · ran
- 2026-08-12 07:06 · `npm run validate:contracts 2>&1 | tail -10` · ran
- 2026-08-12 07:06 · `npm run typecheck 2>&1 | tail -10` · ran
- 2026-08-12 07:05 · `npm run test:match -- "chain-step-strictness|delegation-schema" 2>&1 | tail -60` · ran
- 2026-08-12 07:05 · `npm run test:match -- "yaml-to-prompt-data|parsing-stage-commandtype" 2>&1 | tail -100` · ran
- 2026-08-12 07:05 · `npm run test:match -- "prompt-schema|parser" 2>&1 | tail -100` · ran
- 2026-08-12 07:05 · `npm run validate:contracts 2>&1 | tail -60` · ran
- 2026-08-12 07:04 · `npm run typecheck:tests:ratchet 2>&1 | tail -80` · ran
- 2026-08-12 07:04 · `npm run typecheck 2>&1 | tail -60` · ran
- 2026-08-12 07:03 · `npm run validate:python 2>&1 | tail -150` · ran
- 2026-08-12 07:03 · `npm run validate:python 2>&1 | tail -150` · ran
- 2026-08-12 07:03 · `npm run validate:python 2>&1 | tail -100` · ran
- 2026-08-12 07:03 · `python3 -m pytest ../hooks/tests/test_delegation_deadlock_fixes.py -v 2>&1 | tail -20` · ran
- 2026-08-12 07:03 · `python3 -m pytest ../hooks/tests/test_delegation_deadlock_fixes.py::TestDefect3ClearCondition -v 2>&1 | tail -50` · ran
- 2026-08-12 07:03 · `python3 -m pytest ../hooks/tests/test_delegation_deadlock_fixes.py::TestDefect2GateSentinel -v 2>&1 | tail -40` · ran
- 2026-08-12 07:02 · `python3 -m pytest ../hooks/tests/test_delegation_deadlock_fixes.py::TestDefect1DelegationArming -v 2>&1 | tail -30` · ran
- 2026-08-12 07:02 · `npm run typecheck 2>&1 | tail -80` · ran
- 2026-08-12 07:02 · `python3 -m pytest ../hooks/tests/test_delegation_deadlock_fixes.py -v 2>&1 | tail -60` · ran

### DEV-T5-0 — dispatch reassignment: 5.1 authoring delegated (main-thread acceptance retained)

The plan's Execution Dispatch table put 5.1 (E2E acceptance test) on the main thread. Reassigned
the AUTHORING to an opus worker per the operator's standing delegation directive (2026-08-12,
logged to observations.jsonl): evidence production delegates, judgment stays. What stays
main-thread from the never-delegate list is unchanged: falsification re-run, tier acceptance,
the 5.3 live drive, and the scope check. The reassignment is itself the correction's point —
a forced inline detour (or an authored table) does not override the delegation posture.

### DEV-T5-1 — docs task brief's own YAML example used the wrong field name

Task 5.2's brief illustrated the per-step schema with a `chain_steps:` (snake_case) key. Verified
against `prompt-schema.ts:366` and `chain-schema.md:17,57`: the real YAML key is `chainSteps`
(camelCase) — `chain_steps` does not exist anywhere in the schema, loader, or existing docs.
Both new doc examples (`docs/reference/mcp-tools.md` §Visibility Policy,
`docs/concepts/chains-lifecycle.md` §Visibility Policy) use `chainSteps`. Fixed forward; not a
landed-behavior defect, just a brief-authoring slip that would have shipped a docs bug if copied
verbatim.

### DEV-T5-2 — `prompt-schema.ts` visibility comments read stale against Tier 3 reality

`ChainStepSchema.visibility`'s doc-comment (prompt-schema.ts:183-186) still says "ADDITIVE
ONLY... nothing downstream consumes it yet (Tier 2-3)" and `StepVisibilitySchema`'s says
"Additive only (Tier 1)". Both predate Tier 3 landing: `decideVisibility` (visibility-policy.ts),
`chain-operator-executor.ts` (template-context filtering, unknowns-section suppression),
`envelope-visibility.ts` and `renderer.ts` (delegation manifest) all consume the field today —
confirmed by `rg` (18 hits across 8 non-schema files) and read in full. Docs were written against
the CURRENT (Tier 3) behavior per the docs-lockstep rule, not against the stale schema comment.
Not fixed in source — out of scope for a docs-only task; flagging here so a future source touch
updates the comment rather than trusting it.

### DEV-T5-3 (task 5.1) — an untargeted temporary gate is NOT run-wide; the control had to be a planned gate

Row 5.1's brief said to register "one untargeted gate + one gate with target_step_id" through the
`gates` parameter. Measured while driving it: `normalizeGateInput` gives every temporary gate that
names no target `apply_to_steps: [currentStep]`
(`temporary-gate-registrar.ts:496-501`, `effectiveApplyToSteps`), so a temp gate requested with no
target binds to the step the request was made at and `filterGatesByStepTarget` strips it from every
later step. The first driven run showed it directly: step 2's injected guidance read
`Gate guidance for: gate-node-scoped` — the "run-wide" gate had already been filtered off.

An untargeted temp gate therefore cannot express the inheritance control the criterion needs. The
control is a PLANNED gate instead (`step.executionPlan.gates`), which reaches the accumulator with
no registry entry, so `filterGatesByStepTarget` lets it through on every step — the same mechanism
`tests/unit/gates/services/gate-review-scoping.test.ts` uses for its `RUN_WIDE_GATE`, whose comment
states the reason. Not a defect: `apply_to_steps: [currentStep]` is deliberate for ad-hoc
per-request gates. Recorded because the phrase "untargeted gate" reads as run-wide and is not.

### DEV-T5-4 (task 5.1) — the sibling harness's stubbed `TextReferenceStore` makes criterion (a) phantom

`step-lifecycle.integration.test.ts` stubs `TextReferenceStore`
(`buildChainVariables → {}`). Mirroring that stub, as the brief directed, produced a green-looking
absence assertion for the wrong reason: with no step results published, EVERY render takes the
`**[CONTEXT INSTRUCTION]**: Use the response you produced for Step N` fallback, so the withheld
value is absent because it never existed. Caught by the exposing step, which then could not find
S2 either (run 2 of 4: `Prior: **[CONTEXT INSTRUCTION]**...` where `Prior: S2_SENTINEL_BRAVO` was
required).

The acceptance test uses the REAL `TextReferenceStore`. This also makes the two `History: []`
assertions non-vacuous: `previous_step_output` resolves out of `step_results`, the same surface
`chain_history` strips, so the S2 the exposing step DOES render proves the history surface was
populated in that run.

### DEV-T5-5 (task 5.1) — `stepN_result` and `step_results` disagree by one; templates must not assert on it

Observed while choosing the history template. `ChainSessionStore.persistStepResult` passes the
1-based `ordinalOf(...)` (`node-order.ts:101-104`) to `storeChainStepResult`, and
`buildChainVariables` then publishes `variables[step${ordinal + 1}_result]` while
`step_results` stays keyed by the ordinal itself (`text-refs/index.ts:114-123`). So step 1's
content is readable as `step_results['1']` (what `getStoredStepResult` reads, correctly) AND as
`{{step2_result}}`. Not caused by P5 and not touched here — flagged because the fixture in
`tests/integration/chain/visibility-policy.integration.test.ts` hand-builds a context where
`step1_result` holds step 1's content, i.e. it encodes the opposite convention and would not
survive being rebuilt from the real store. The acceptance test avoids the question by reaching for
every `stepN_result` key at once and asserting the bracketed slot is exactly empty.

### DEV-T5-6 (task 5.1) — what row 5.1 could NOT express (honest gaps for the 5.3 live drive)

1. **Envelope value-stripping is unexercised end to end.** `applyVisibilityToEnvelope` drops
   `chainHistory`, but no producer populates `ExecutionEnvelope.chainHistory` (DEV-T3-3), so on a
   driven run the manifest line is the only observable effect. Criterion (b) is asserted as: the
   handoff section carries the names-only manifest and none of the run's sentinel values. The
   drop-branch itself remains unit-covered only.
2. **The gate SERVICE is stubbed** (`enhancePrompt`). It decides gate TEXT, not which gates apply;
   the routing under test never calls it. Gate ids, targeting, review scoping, session store,
   registry and registrar are all real.
3. **The handoff header names the wrong prompt.** The driven text reads
   `HANDOFF: Execute Step 4 ("Synthesize")` — step NUMBER 4 is the delegated step, but the name
   comes from `executionResults.metadata.promptName`, which is step 3's. Pre-existing, outside P5,
   not asserted on beyond the step number. Worth a look during the live drive.
4. **Pending review is observed off the store, not off rendered text.** `buildGateReviewCTA`
   renders the verdict template from `pendingReview.gateIds` but does not print the ids as a list
   on the chain path (`**Gates**:` is the single-prompt render), so the per-node review scope is
   read as `session.pendingGateReview.gateIds` — the exact array stage 13 wrote from
   `reviewGateIds`. Client-observable via the run, not via one substring.

### DEV-T5-7 (task 5.1) — falsification: two mutations, both killed the intended criterion only

Run, not inspected. Baselines by md5 before touching anything:
`visibility-policy.ts c5e2b23e8864d3d5f53a87c443de9dc7`,
`gate-enhancement-service.ts 907408c3f5cc3e6b449541bb5e792218`.

- **M1** — `visibility-policy.ts::decideVisibility`, expose-override branch neutered (every prior
  withhold pushed to `withheld`, `exposedByCurrent` never consulted). Test FAILED at line 527,
  `expect(atNode3).toContain('Prior: S2_SENTINEL_BRAVO')`, received
  `Prior: **[CONTEXT WITHHELD]**: Step 2 (Analyze)'s output was withheld...`. Criterion (a) only.
- **M2** — `gate-enhancement-service.ts:351`, `context.state.gates.reviewGateIds = gateIds` removed
  from inside its `isCurrentStep` guard. Test FAILED at line 557,
  `expect(reviewAtNode1).not.toContain('gate-node-scoped')`, received
  `["gate-node-scoped", "gate-run-wide"]` — the stage-13 fallback to the run-wide accumulator, i.e.
  P4-F3 reproduced. Assertions for (a) and (b) all sit ABOVE line 557 and passed on that run, so
  the mutation is criterion-(c)-specific.

Both files restored and re-verified byte-identical by md5 (same two hashes). `git diff --stat`
still reports `gate-enhancement-service.ts | 52 ++++` — that is Tier 4's own uncommitted work in
this shared worktree, present before this task started; the md5 match against the pre-mutation
baseline is the restoration proof, not the diff against HEAD. Test re-run green after restore.

## Owner rulings — 2026-08-12 (post-core-complete)

### Row 4.4 → RULED: INHERIT the triggering unknown's target gates

An inserted investigation node's review scope = the gates targeted at the node its triggering
unknown blocked (`origin_unknown_id` → ledger entry → `target_step_id` → gates whose target is
that node). Both alternatives rejected by the owner: `[]` (loses the review the investigation
exists to serve) and run-wide fallback (the P4-F3 shape). This is new plumbing — ledger target →
review-scope resolution — and executes as its own dispatched task after the P5 core commit.

### P5-F5 → RULED: DEFERRED to P6

The stage-06 hoist changes behavior for every YAML chain carrying `subagentModel`; P6 owns the
delegation surface and decides with a survey of affected chains.

### Sequencing → RULED: commit P5 core now (P8 sighting two); P7 opens next; 4.4 follows the commit

## Deviations — row 4.4 (P5-F4), executed after the P5 core commit

### DEV-T4-7 — the join lives in `RunStepView`, not in the gate service

The ruling's chain is `current node → origin_unknown_id → ledger entry → target_step_id`. That
walks two session-owned collections (`state.nodes` and `unknownsLedger`), and the gate layer owns
neither. Resolved in `createRunStepViewProvider` and published as one optional field,
`RunStepView.currentNodeOrigin: { origin: 'inserted'; originUnknownId?; unknownTargetNodeId? }`.

Chosen because `run-step-view.ts` is already the declared seam for run facts entering gate
selection — its own header says the gate layer needs exactly the facts it lists, kept behind a
function type rather than an injected `ChainSessionService`. Adding a third fact there costs one
field; resolving it in `GateEnhancementService` would make the gate layer import ledger internals
(`UnknownLedgerEntry`) to read one string, and would put a second definition of "which node is
current" beside `resolveCurrentStepKey`'s.

Rejected: (a) passing the whole `ChainSession` into the gate service — widens the seam the module
exists to keep narrow; (b) re-deriving the target from the inserted node's ID — `mintInsertionId`
slugifies, so the id is not a decodable inverse, which is the same reason `origin_unknown_id`
exists as a column rather than being parsed back out of `id`.

The field is emitted ONLY for `origin === 'inserted'`. Absence is what keeps every planned-node
path byte-identical: the inheritance branch is entered on the field's presence, never on a node id
failing to match a parse step (see DEV-T4-9).

### DEV-T4-8 — the inherited scope reads the FULL accumulator, and only the NODE address

Two choices the ruling leaves open, both settled conservatively:

1. **Which accumulator snapshot.** Tier 4's per-step write publishes the accumulator _as of that
   step_. An inserted node has no parse step, so it has no "as of" — there is no position in the
   parse array to take a snapshot at, which is the whole reason this defect exists. The inherited
   scope is therefore computed after the loop against the complete accumulated set, matching the
   ruling's own wording ("accumulated gates whose `target_step_id` === that node"). Practically
   identical: the untargeted half is run-wide by definition, and the targeted half is filtered to
   one node.
2. **Node address only, never an ordinal.** `filterGatesForTarget` is called with `{ nodeId }` and
   no `stepNumber`, so a gate addressed _only_ by ordinal (`target_step_number` / `apply_to_steps`
   with no `target_step_id`) does NOT inherit. An ordinal names a parse-time position, and the
   run's ordinal space stopped agreeing with the parse array the moment a node was inserted —
   inheriting one would be exactly the silent retarget OQ-P4-3's node-id-first rule exists to
   prevent. In practice this costs nothing: `TemporaryGateRegistrar.resolveStepTarget` cross-fills
   both forms at registration, so a gate that named a real step carries `target_step_id` too.

Mechanics are reused rather than reimplemented: `filterGatesByStepTarget` and the inherited path
now both call one `filterGatesForTarget`, so the skipped-node veto, the node-id-first precedence
and the untargeted pass-through have a single definition. The target descriptor distinguishes
`nodeId: null` ("no node identity, and none can be inherited" → every node-addressed gate drops)
from `nodeId: undefined` ("this step carries no node id", the legacy P3 D10 case → the ordinal
branch decides). Collapsing the two would have made an unknown with no target silently inherit
every node-addressed gate — the widening the ruling explicitly rejects.

### DEV-T4-9 — the branch is gated on PROVENANCE, not on "no scope was written"

DEV-T4-5 suggested closing this by filtering "after the loop" against a synthetic step. The
tempting guard is `if (reviewGateIds === undefined)`. That is wrong twice, and both are covered by
test (h):

- it fires for a run that has walked off its last node (`currentNodeId === null`, ordinal 0
  matching nothing), which Tier 4 deliberately leaves unwritten — measured: that guard turns the
  existing "walked off its last node writes no review scope" test red;
- it would silently start inheriting for any future case where no parse step matched.

Gating on `currentNodeOrigin` also makes the write unconditional _within_ the branch rather than a
fallback, which matters for a chain whose parse steps carry no node ids at all: `isCurrentStep`
then falls back to ordinal matching and can match some unrelated step for an inserted current node.
The run's own provenance is the authority, so it overwrites.

### DEV-T4-10 — the `shouldSkip` sibling residual is NOT covered for free; still open

DEV-T4-5's second, smaller residual: a current step carrying `clean` / `framework` modifiers
`continue`s before the filter runs, so no scope is published and both readers fall back run-wide.
This fix does not touch it and was not extended to. Such a step is PLANNED, so the provider emits
no `currentNodeOrigin` for it and the new branch never fires — verified by construction and by
test (h), which is the same shape (no provenance → nothing written). Behaviour there is unchanged
from `c07a80c1`.

Left open deliberately: closing it means deciding what a step that receives NO gate enhancement at
all should be reviewed against, which is a behaviour question the row-4.4 ruling does not answer.
It is the last remaining fallback-to-run-wide path.

### DEV-T4-11 — `enhanceChainSteps` cognitive complexity 30 → 31

Measured with the identical ESLint config against `git show c07a80c1:` of the same file: the
function was already **30** (Tier 4 took it 28 → 30). The one post-loop `if` costs +1. No new rule
fires — `sonarjs/cognitive-complexity` was already reporting this function — and `lint:ratchet` is
green at 3199 errors / 1016 warnings, unchanged. `filterGatesForTarget` (the extracted filter, +2
branches over the original) stays under the limit and is not flagged, as its predecessor was not.
Decomposing a 31-complexity hot-path function remains a separate refactor, per DEV-T4-6.

One incidental fix: the new `&&` line tripped `prettier/prettier` (+1 over baseline) and was
reformatted with `npx prettier --write` on the four touched files. `run-step-view.ts` and the
integration test were already conformant.

### DEV-T4-12 — falsification: three mutations, each killed only what it should

Run, not inspected. Pre-mutation md5:
`gate-enhancement-service.ts 131b47a19a1036a50d16fe0b4ff16273`,
`run-step-view.ts d8f4f9d46188463370db96518a7850c2`.

- **M1** — `inheritedReviewGateIds`: the resolved target replaced by `null`, so nothing is ever
  inherited. **1 failed / 13 passed** — only (e), `Expected value: "temp_1" / Received array:
["run-wide-gate"]`. (f) and (g) already expect `["run-wide-gate"]`, so they stay green, which is
  what makes M1 criterion-(e)-specific.
- **M2** — the whole post-loop branch disabled (pre-fix behaviour). **3 failed / 11 passed** —
  (e), (f) and (g), each `Received: undefined`, i.e. the reader fallback to the run-wide
  accumulator. (h), (i) and all six Tier-4 cases green, confirming planned-node behaviour is
  untouched by the branch's existence.
- **M3** — the guard swapped from `currentNodeOrigin !== undefined` to
  `reviewGateIds === undefined && runStepView !== undefined` (the naive "unwritten" guard).
  **2 failed / 12 passed** — (h), plus the pre-existing "a run that has walked off its last node
  writes no review scope", both `Received: ["run-wide-gate"]`. This is DEV-T4-9's claim, measured.

Both files restored from byte copies and re-verified by md5 against the hashes above; suite green
after restore. Final hashes differ from the pre-mutation ones for two behaviour-free reasons
applied AFTER all three runs: the Prettier reformat of DEV-T4-11
(`gate-enhancement-service.ts 05cee0db8d7038cbfcb9b0d9de31e8cf`), and naming
`resolveInsertedNodeOrigin`'s return type `InsertedNodeOrigin` instead of restating its inline
shape (`run-step-view.ts 8e97f87a92805d13b751833a08774f22`). Typecheck and the suites were re-run
green after each.

`git diff` against `main` in this shared worktree still shows other parties' files; the md5 match
is the restoration proof, not the diff.

**Shared-worktree noise, recorded not chased**: one `lint:ratchet` run reported
`@typescript-eslint/no-unused-vars 17 → 18` and the immediately following run reported OK with no
edit in between. `npx eslint` over both touched source files reports zero `no-unused-vars` at any
point. Another session was mid-edit; the ratchet measures the whole project, so it sees that.

### DEV-T4-13 — the provider join needed an INTEGRATION test; the unit suite structurally cannot cover it

`gate-review-scoping.test.ts` hands `GateEnhancementService` a hand-built `RunStepView`, so it
proves what the gate layer DOES with `currentNodeOrigin` and nothing about whether the provider
ever produces one. Three cases were added to
`tests/integration/chain/unknown-observations-flow.integration.test.ts` — the suite that already
owns the ledger's chain of custody — driving the real `ChainSessionStore` through
`applyUnknownObservations` → `insertNodeAfter` → `advanceStep` and then calling
`createRunStepViewProvider` for real: target present, target absent, and a planned node carrying
no provenance at all. Without them a rename of `UnknownLedgerEntry.targetStepId` would leave the
whole unit suite green while the feature returned nothing.

### Row 4.5 — RULED 2026-08-13 (owner, AskUserQuestion)

**No review for skipped steps.** A modifier-`shouldSkip`ped step produced no output — there is
nothing to judge, so it triggers no gate review at all. This removes the LAST fallback-to-run-wide
path (DEV-T4-10 residual). Rejected: keep run-wide fallback (the over-broad scope P4-F3 existed to
fix); review against planned gates (reviews output that does not exist). ~10 lines + discriminating
test; dispatched to a sonnet worker. Row 5.5 separately ruled: dispatch now as its own docs worker
(NOT folded into P6 — pre-answers half of the P6 planner's OQ-P6-7).

## Row 5.5 — docs worker execution

**Scope**: `docs/reference/chain-schema.md` Step Schema table, the `gate-guidance` frequency
contradiction between `docs/reference/mcp-tools.md` §Injection Control and
`docs/guides/injection-control.md`, and this append-only note.

### Chain-schema Step Schema table — measured against `ChainStepSchema`

`server/src/modules/prompts/prompt-schema.ts:130-209` (`ChainStepSchema`, `.strict()`) declares
twelve fields: `promptId`, `stepName`, `id`, `inputMapping`, `outputMapping`, `retries`,
`subagentModel`, `agentType`, `framework`, `inlineGateIds`, `visibility`, `delegation`. The table
had seven (missing `id`, `framework`, `inlineGateIds`, `visibility`, `delegation` — two beyond the
three named in the row: `framework` and `delegation` were also undocumented). Added all five as
rows, in schema declaration order, plus a `### Visibility` subsection (allowed-item table for
`VisibilityItemSchema` at `prompt-schema.ts:80-84`: `previous_step_output`, `chain_history`,
`unknowns_ledger`) matching the existing `### Subagent Model` / `### Agent Type` subsection
pattern. `inlineGateIds`'s row states its "accepted but not yet wired" status verbatim from the
schema's own doc comment (`prompt-schema.ts:172-181`) — omitting that would misrepresent a
declared-but-inert field as live. `delegation`'s row notes it is read only by the skills-sync
exporter, not the execution pipeline (`prompt-schema.ts:193-206`).

### Frequency contradiction — measured ground truth

Default `gateGuidance.frequency` is `0` (first-only), not "every step":

- `server/src/infra/config/index.ts:164` — `DEFAULT` injection config: `gateGuidance: { frequency: 0, target: 'both' }`.
- `server/src/infra/config/index.ts:527` — `toFrequency(inj?.gateGuidance?.frequency, 'first-only')`, the resolved shipped default when unset.
- `server/src/shared/types/core-config.ts:129-130,243-244` — doc comments on both `gateGuidance.frequency` and the flat `gateGuidanceFrequency` alias: "Inject gate criteria every N steps. 0 = first-only (default: 0)".
- `rg -n "gateGuidance" server/resources/ --no-ignore` — no match; no shipped resource config overrides the code default.

`docs/guides/injection-control.md` already stated this correctly (`First step only`, `frequency: 0`
in its example, line 12/30/45). `docs/reference/mcp-tools.md` §Injection Control (line 924) was
the wrong doc — it said "Every step". Corrected the single cell to `First step only`; no other
line in that doc's Injection Control section needed a change. `injection-control.md` was left
untouched (already correct — not in this worker's writable scope for that reason too).

### Prettier

`npx prettier --check` on the three touched-or-writable-scope files initially flagged
`docs/reference/chain-schema.md` (my table edit widened columns without realigning). `--write`
reformatted it (widened the `Description` column, tightened the new Visibility table); reran
`--check` on `chain-schema.md` + `mcp-tools.md` — both clean. `injection-control.md` was not
touched, so not re-checked.

### Smelled wrong / out of scope

- `framework` and `delegation` being undocumented was not in the plan row's named gap list
  (`visibility`, `id`, `inlineGateIds`) but is the same defect class — flagged and fixed per the
  row's own "not a cap" instruction, not left for a future pass.
- Did not touch `inlineGateIds`' "not yet wired" status beyond documenting it — wiring it to the
  gate pipeline is a separate, behaviourally risky change per the schema's own comment
  (`prompt-schema.ts:178-180`), out of scope for a docs row.
- Did not flip the P5 plan row status (per instructions); this section is append-only.

## Row 4.5 — worker execution

Sonnet worker, per ruling recorded above (owner 2026-08-13, AskUserQuestion): a modifier-`shouldSkip`ped
current step gets NO gate review — not `[]` as a symptom of "unwritten", but `[]` written
deliberately, matching the existing "no applicable gates" convention at the empty-gate-list
`continue` a few lines below (both readers' `?? accumulatedGateIds` treats `undefined` as
"nothing was decided, fall back" and `[]` as "empty was decided, stop").

### Where the fallback lived

`server/src/engine/gates/services/gate-enhancement-service.ts:297-299` (pre-fix) — the
`shouldSkip` branch inside `enhanceChainSteps`'s per-step loop `continue`d before reaching the
`isCurrentStep` write at (then) line 350, so a shouldSkip'ped current step left
`context.state.gates.reviewGateIds` unset for that call. Both readers
(`13-session-stage.ts:225`, `response-assembler.ts:741`) resolve an unset value via
`?? accumulatedGateIds ?? []`, which is the run-wide fallback this row closes — the last of the
three fallback-to-run-wide paths named across Tiers 4-4.5 (post-insertion ordinal drift → 4.1-4.3;
inserted-node no-provenance → 4.4; shouldSkip'ped current step → this row).

### What was written

```ts
if (this.shouldSkip(step.executionPlan?.modifiers)) {
  // Row 4.5 (P5-F4 residual, DEV-T4-10, owner-ruled 2026-08-13). A modifier-skipped step
  // produces no output, so there is nothing to review. Write the same positive-empty-list
  // convention the "no applicable gates" case below uses (line ~356) rather than leaving
  // the field unset — unset is exactly what both readers' `?? accumulatedGateIds` fallback
  // turns into a run-wide review, the last remaining fallback path this row closes.
  if (this.isCurrentStep(step, currentStepKey)) {
    context.state.gates.reviewGateIds = [];
  }
  continue;
}
```

8 lines added (7 body + the guard is the pre-existing `if`), inside the owner service
(`GateEnhancementService`) per Domain Ownership Matrix — no stage touched. `isCurrentStep` and
`currentStepKey` were already resolved above the loop (Tier 4), so no new plumbing was needed —
this row only moved a write earlier in the same function's control flow.

### Deviations

| #   | What                                                                                                                                 | Why                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Extended `stepPrompt()`/`reviewGatesFor()` test helpers with an optional `modifiers`/`skipNodeIds` parameter instead of a new helper | Existing helpers already parameterize per-node state (`plannedGates`, `view`); a parallel helper would duplicate the stage/service wiring boilerplate for no behavioral difference                         |
| D2  | Added a second test (k) — a shouldSkip'ped step that is NOT current — beyond the single discriminating test asked for                | The ~10-line source fix has exactly one branch-order hazard worth guarding: a non-current skip must not disturb the real current step's write; cheap to add, closes a plausible off-by-one before it ships |

### Falsification

Pre-fix hash (matches DEV-T4-12's final recorded hash exactly, confirming no drift since Tier 4):
`gate-enhancement-service.ts 05cee0db8d7038cbfcb9b0d9de31e8cf`. Post-fix hash:
`gate-enhancement-service.ts c9e324a707e684c890868bab9778fa2a`.

Reverted the hunk with Edit (md5 matched the pre-fix hash exactly) and re-ran
`test:match gate-review-scoping`: **1 failed / 15 passed** — the new discriminating test (j)
failed with `Expected: [] / Received: undefined`, i.e. exactly the pre-fix "unset → fallback"
shape. Test (k) (the non-current-skip guard) and all 14 pre-existing tests stayed green. Restored
the fix with Edit; md5 matched the post-fix hash exactly; re-ran the suite green (16/16).

### Validation ledger

| Gate                                                                           | Result                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                            | clean, no output                                                                                                                                                                                           |
| `npm run lint:ratchet`                                                         | `OK: 3199 errors, 1017 warnings (no regressions)` — 1 warning above DEV-T4-12's recorded 1016; not chased, same shared-worktree noise class DEV-T4-12 documented (other parties mid-edit in this worktree) |
| `npm run typecheck:tests:ratchet`                                              | `OK: 377 errors in tests/ (no regressions)`                                                                                                                                                                |
| `npm run test:match -- "gate-review-scoping\|chain-session\|response-capture"` | `Test Suites: 8 passed, 8 total` / `Tests: 106 passed, 106 total`                                                                                                                                          |

### Smelled wrong / out of scope

- None found beyond the ruling's own scope. The three fallback-to-run-wide paths named in Tier 4's
  record are now all closed (4.1-4.3, 4.4, 4.5) — worth a note for whoever verifies P4-F3/P5-F4
  closure at Tier 5 acceptance that this was the actual last one, not just the last one _named_ at
  the time DEV-T4-10 was written.
- Did not flip the plan row status (per instructions); this section is append-only.
