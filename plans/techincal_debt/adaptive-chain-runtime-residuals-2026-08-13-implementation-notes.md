---
title: "Adaptive Chain Runtime residuals — implementation notes"
date: 2026-08-13
status: reference
tags: []
---

# Residuals sweep — implementation notes

Governing plan: `adaptive-chain-runtime-residuals-2026-08-13.md`. Scope ruled by owner
2026-08-13: Tier A quick fixes (P7-F10, P7-F9, P6-F14, P6-F15, P6-F12) + Tier B settability
family (P6-F10/P6-F16/P7-F8/P7-F12, design-first) + P5-F6 diagnosis-only. Seven background
workers dispatched in parallel; judgment (acceptance, rulings, integration validation, commits)
stays main-thread. No pushes without owner approval.

## In-flight edits

- Wave 2 workers (2026-08-13, running): Tier B increment 3 editing the resource-manager write
  path (file-operations.ts, prompt-lifecycle-processor.ts + tests — Fix B suppliedKeys scope
  narrowing + true category move per owner ruling); P5-F6 fix editing the pipeline/gates area
  (13-session-stage.ts, 16-response-capture-stage.ts, gate-enforcement-authority.ts,
  gate-enhancement-service.ts, pipeline-builder.ts + tests — post-advance declared-gate review
  re-evaluation). A third read-only worker is auditing resource_manager settability parity
  (matrix + create_prompt compensation list) for a proposed follow-up initiative.
- Wave 3 (running): Fix D worker on the resource-manager contract surface — its
  `docs/reference/mcp-tools.md` edit is the layer-6 docs step of the argument_updates
  six-layer alignment (schema/contract/router/types/processor/docs).

- P7-F9 worker: `server/src/mcp/tools/gate-manager/services/gate-lifecycle-processor.ts` and
  `server/src/mcp/tools/framework-manager/services/framework-lifecycle-processor.ts` — deleting
  the two unreachable `else { warn }` branches left after saveVersion became throwing. Note:
  actual paths are `src/mcp/tools/*-manager/services/`, not the `src/mcp-tools/` guess in the
  worker brief — worker located them correctly.

## Accepted

- **P7-F9 ✓ (2026-08-13)** — both unreachable `else { warn }` branches deleted
  (gate-lifecycle-processor.ts, framework-lifecycle-processor.ts; +4/−12 incl. the pointless
  `if (versionResult.success)` wrappers). Reachability proven: `saveVersion` has no
  `{success:false}` return path (throws). Prompt lifecycle processor already correct (cites
  P7-D2/OQ-P7-6 inline). `SaveVersionResult.success` stays boolean for the CLI writer's
  intentional non-throwing posture. Typecheck + 63 targeted tests green. Uncommitted.

- **P6-F15 ✓ (2026-08-13)** — `generate-contracts.ts` +227/−29 + one package.json script:
  posture resolver replaces the silent deprecated-skip; unmarked contract → exit 1 naming the
  file; ≥1-artifact assertion per tool/resource-shape contract; explicit artifact-less posture
  requires `artifactKindReason` + `closedBy`. No existing contract lacked a marker (all 5
  classified). Red/green falsified with a temp contract; `_generated/` byte-identical. Gate
  coverage inherited via validate:contracts inside validate:all. Uncommitted.

- **P7-F10 ✓ (2026-08-13)** — release-flagged numbering sync landed. Divergence was NOT the
  raw `saveVersion` primitive (already identical) but ROLLBACK: CLI recorded the pre-rollback
  snapshot as newest (newest row ≠ on-disk state); now mirrors the server (bridge unrecorded
  live state, record RESTORED content as newest). `cpm rollback` consumes the fixed export.
  `recordEditResult` also ported + exported (no cpm caller yet — matches the pre-existing
  `saveVersion` export precedent; JSDoc names the cross-writer parity purpose). Error posture
  unchanged (by design). Stale `RollbackResult.saved_version` JSDoc corrected. Falsified
  (3 tests red under mutation); 105 targeted tests + typecheck green. Uncommitted.

- **P5-F6 ✓ diagnosis (2026-08-13)** — verdict (b): code defect. Mechanism: review creation
  at stage 13 (pre-advance) vs verdict→advance→render in one round trip (stages 16→18), so
  step N>1 is structurally never current where declared-gate reviews are created; no frequency
  value alters this. Docs already consistent (af4a8c5d fixed the false "Every step" claim).
  No edits made. Residuals row re-routed: gates hygiene backlog, pairs with P6-F14. Fix shape:
  re-evaluate declared-gate review post-advance before StepExecutionStage.

- **P6-F14 ✓ (2026-08-13)** — Stage 1.5 existence gate inside GateSetResolver (the declared
  single owner): validates ids against GateManager.has() ∪ TemporaryGateRegistry; unregistered
  → warn + drop + `unregistered` result field surfaced via context.diagnostics (mirrors
  `vetoed`); fails open when manager uninitialized. Posture matched to siblings
  (validate-and-drop, not hard-reject). Falsified (2/5 new tests red under neuter); 350 gates
  tests + typecheck + tests-ratchet green. Accepted narrow gap: Stage 7 planner validates
  without temp-registry access — Stage 11 is authoritative. Uncommitted.
- **P6-F12 ✓ (2026-08-13)** — real count was 7 empty vars, not 4. Root cause: chainSteps had
  no outputMapping, and sub-prompts referenced bare `{{name}}` where named outputs publish
  only as `{{outputs.name}}` (P5-F2 anti-leak design). Fixed via resource_manager only:
  4 template patches + 1 chain_steps update (versions v2/v2/v2/v2/v3); dead 45-line "## Chain
  Steps" prose block deleted; two never-produced gate-status vars dropped. sha256 collateral
  checks clean; live before/after chain drive shows all vars populated. **CAVEAT: pr-review/
  is gitignored (P7-F4)** — this fix lives in workspace resources, not in git; nothing to
  commit. Transient note: worker hit a mid-flight broken prebuild while P7-F10's duplicate
  symbol existed; resolved before completion (later typechecks clean).
- **Tier B increment 1+2 ✓ (Fix A + Fix C, 2026-08-13)** — writer preserves `tools` (id list
  carried forward when no full defs supplied) + authored `category` (interim disk-wins rule);
  createPrompt gained the `diagnosePromptWrite(null, …)` pre-write hop (broken template →
  refused, nothing written, dir absent). 5 integration + 7 unit tests; falsified per-fix
  (exact expected reds); parity tests untouched green; 254 wider prompt tests green.
  Uncommitted.

- **Tier B increment 3 ✓ (Fix B + category move, 2026-08-13)** — suppliedKeys write-scope
  narrowing (optional param, defaults to full set — backward compatible); patch-only template
  edit now leaves prompt.yaml BYTE-IDENTICAL (comments + key order preserved — the P6-F10
  acceptance bar); category rule upgraded to caller>disk>omit; true category MOVE (owner
  ruling): both dirs as transaction targets, cp+rm (EXDEV-safe), mid-move failure injection
  restores, registry coherence verified against the full-rescan reload path. 93 new/extended
  tests, 233 targeted green, parity suites unmodified. Two increment-1 interim-rule tests
  updated as planned. Known cosmetic residue: empty parent category dir may linger (matches
  delete behavior). Uncommitted.

- **P5-F6 fix ✓ (2026-08-13)** — design (a): post-advance review re-evaluation. New single
  creation path `GateEnforcementAuthority.createReviewForStep` (stage 13 now delegates —
  dedup); `GateEnhancementService.ensurePostAdvanceReview` idempotent, triggers on
  step-targeted gates only, creates the FULL step-applicable set (targeted-only content was a
  real bug the acceptance test caught mid-build); stage 16 call-through at 3 post-advance
  exits; stage 18 untouched. Real-pipeline integration tests + 8 unit tests; falsified;
  step-1 behavior pinned unchanged; 860 tests green. OPEN THREAD: worker's lint:ratchet run
  showed +1..+4 project-wide — trace at integration validation over the combined tree.
  Uncommitted.

- **Tier B increment 4 ✓ (Fix D argument_updates, 2026-08-13)** — six-layer alignment
  (Zod/contract/router/types/processor/docs) with shared `promptArgumentSchema` SSOT; new pure
  merge module `argument-updates.ts` (merge-by-name, no upsert, unmatched → typed refusal
  before version spend); rejected on create; conflict with `arguments`; dry_run free.
  Only `_generated/` churn is the parameter itself; validate:contracts clean under the
  hardened generator. Falsified; 222 targeted tests green. TIER B COMPLETE (A+B+C+D+move).
  Uncommitted.
- **Settability audit ✓ (2026-08-13)** — matrix persisted to
  `plans/techincal_debt/resource-manager-settability-matrix-2026-08-13.md` (267 lines,
  code-cited): 7 set-unreachable, 7 unset-broken, 2 missing typed ops, 1 NEW gate-surface
  data loss; create_prompt/prompt_builder bridge confirmed broken
  (`user_message_template_file`/`system_message_file` params never read by resource_manager).
  Seeds a settability-parity follow-up initiative (7-step increment sequence in the matrix).

## Owner rulings (2026-08-13)

- Tier B open decisions 1/2/4/5/6 ratified per proposal recommendations (snapshots stay
  tools-blind; id-string tools repair deferred; supplied-keys; argument_updates; no create
  dry_run). Decision 3: owner ruled **implement true category MOVE now** (not refusal) —
  folded into increment 3.
- P5-F6: owner ruled **fix in this sweep** (was diagnosis-only).
- Gate `activation`/`retry_config` silent deletion (NEW, found by the settability audit):
  owner ruled **fix in this sweep** — fallback-merge at the gate writer, worker dispatched.
  Remaining audit gaps (unset class, typed ops, prompt_builder bridge) → settability-parity
  follow-up initiative, NOT this sweep.

## Gate data-loss fix (in-sweep, under the ruling above)

- **Part 1 ✓ (2026-08-13)** — fallback-merge in gate-lifecycle-processor handleUpdate for
  `activation`/`retry_config` + self-found `pass_criteria` (same shape); used
  `getDefinition()` raw values, not normalizing accessors (avoids fabricating empty keys).
  4 preservation tests, falsified (3 red under neuter), 10/10 green.
- **Part 2 ✓ (2026-08-13)** — writer-side preservation landed: `PRESERVED_GATE_YAML_KEYS`
  derived from `GateDefinitionSchema.shape` − projected − excluded, + 2 manually-appended
  passthrough-only keys (`evaluation`, `blockResponseOnFail` — invisible to `.shape`, limit
  documented inline); `writeGateFiles` reads existing gate.yaml pre-mutation and merges.
  Schema-coverage test auto-fails on unclassified future declared keys. Falsified; 12/12
  green. Uncommitted.
- **Reported → initiative**: `blockResponseOnFail`/`evaluation` unreachable (unused on disk,
  nothing at risk); `GateManagerInput.activation.frameworks` vs loader `framework_context`
  naming-contract bug (supplied value stripped on next load) — dead input param.

## Integration cleanup (2026-08-13, final wave)

- **Gate-fix worker ✓** — lint:ratchet delta (+17 across 8 rules) fixed inside changed hunks
  only, no baseline regeneration: `recordEditResultRow` 7→options-object params;
  prettier on version-history/file-operations; `||`→`??` in gate-lifecycle fallbacks
  (semantics improved: fall back on omission, not falsy-present); explicit boolean tests in
  gate-enhancement-service; narrow casts for new unsafe accesses; misplaced eslint-disable
  re-anchored. validate:arch error fixed via new engine module
  `src/engine/gates/core/gate-yaml-keys.ts` exporting `GATE_YAML_DECLARED_KEYS` (sole
  value-importer of GateDefinitionSchema; tool layer imports the plain array).
  Full `npm run build` (dist fresh incl. cpm.js) → validate:package-entries green;
  verify:mcp 12/12. Final: lint:ratchet OK, validate:arch OK, targeted 198 unit + 19
  integration green.
- Main thread: prettier'd the sweep's own doc/plan files → validate:format green.
  Final receipt: `validate:all` 39/39.

## Shipped

- **PR #231 MERGED 2026-08-17T04:46:45Z** (merge commit; 9 scoped commits + merge-from-main +
  2 CI-fix commits preserved on main). CI green across Build/CLI/Test Suite/Node 22+24/Lint.
  Two CI-only failures fixed post-push: (a) `cli/tests/integration/new-commands.test.ts`
  encoded old rollback numbering — the standalone cli/ workspace has its OWN test surface
  that server-side test sweeps do not cover (lesson: enumerate every workspace consuming a
  changed module); (b) MCP tool schema snapshot (`server/tests/snapshots/mcp-input-schemas.json`
  via capture-tool-schemas.mjs) needed regeneration for argument_updates — diff verified
  argument_updates-only. Local checkout intentionally left on the merged feature branch:
  returning to main would collide with a live concurrent session's uncommitted WIP.
- Hook wart discovered during commits: pre-commit contract regeneration reads the WORKING
  TREE contract files and re-stages all of `_generated/` whenever the generator or any
  contract JSON is staged — defeats file-scoped commits; commit 4 needed git plumbing.
  Candidate hook fix (not taken).

## Deviations

- **DEV-R-1**: residuals row P5-F6's original route ("injection/review frequency owner") was
  a wrong hypothesis inherited from the master ledger — corrected in the residuals table.
- **DEV-R-2** (new, found during P5-F6): `shared/types/injection.ts:436-443`
  `DEFAULT_GATE_GUIDANCE_FREQUENCY = {mode:'every', interval:1}` with "Injects on every step"
  comment is dead/stale — runtime default comes from `infra/config/index.ts` `toFrequency(0,
'first-only')` and always overrides it. Candidate: comment/constant correction on next touch.
