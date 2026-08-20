---
title: "Argument & Gate/Injection Pipeline Fixes"
date: 2026-07-28
status: reference
tags: []
---

# claude-prompts-mcp — Argument & Gate/Injection Pipeline Fixes

**Date**: 2026-07-28 · **Target**: claude-prompts-mcp v2.1.0 · **Repo**: `/home/minipuft/Applications/claude-prompts-mcp`

Tier-gated plan. `Status` columns (☐/✓) and per-tier Gate criteria make this file the state machine for `>>tier_execute`.

---

## Context — how these were found

All four defects surfaced while authoring the `>>scene_muse` prompt, and each was reproduced or traced to a named mechanism before being written down. Two of them corrupted this very planning session:

- The first `>>scene_muse` run silently dropped half the thematic goal and fabricated a `Target` argument. The output looked plausible; only diffing against what was passed revealed it.
- CAGEERF was re-injected on chain continuations of this plan despite `%clean` on the initial call, because modifiers are per-request — a live demonstration of the T2 gap.

---

## Phase 1 — Discovery & Triage

**work_type**: bug_fix · **secondary**: feature (T2/T3 add surface, not only repair)

**Sibling patterns**: `JSON.stringify(value)` is the house serialization convention at 7 sites (`jsonUtils.ts:141`, `argument-parser.ts:198`, `response-assembler.ts:867`, `errorHandling.ts:426`, `script-reference-resolver.ts:371`, `config-action-handler.ts:122`, `12-post-formatting-cleanup-stage.ts:108`). `00-request-normalization-stage.ts:216` is the lone deviation.
Caveat: `JSON.stringify` alone is insufficient — it escapes inner `"` as `\"`, which the parser's `"([^"]*)"` branch cannot consume. Serializer and parser must move together.

**No sibling pattern for T3** — nothing under `src/engine/gates` references `inline_gate_definitions`. It is a new seam.

**Domain ownership**: T0 → `engine/execution/parsers` + `pipeline/stages` · T1/T2 → `pipeline/decisions/injection` (+ `decisions/gates`) · T3 → `engine/gates`, crossing the `modules/prompts` → `engine/gates` boundary (hence `validate:arch` is a required gate).

**Risk**: T0 low · T1 low but blocking · T2 medium (changes advertised `%lean` behaviour) · T3 medium-high (arms previously-inert config on upgrade).

---

## Phase 2 — Design & Pre-flight

**Pre-flight failures: 2 → compound diagnosis `defined + contracts` = Interface contract violation.**

The quoting grammar is encoded in **two places that disagree**: the split regex (`argument-parser.ts:248-251`) excludes quotes from unquoted values via `[^\s"']+`, while the per-pair regex (`:254`) uses greedy `(.*)`. Line 216 emits a third encoding neither can decode.

> **Fix the contract, not the symptom.** Patching line 216 alone leaves the next value class (embedded `"`, embedded `\`) to reopen the same bug.

**Chosen**: `JSON.stringify` on encode + escape-aware decode — `"((?:[^"\\]|\\.)*)"` and `'((?:[^'\\]|\\.)*)'` — then unescape. Total over all strings; simple unquoted commands parse byte-identically.

**Rejected**: (a) pick-a-quote-absent-from-the-value — fails when both quote chars are present, a narrower patch of the same bug class. (b) Drop the string round-trip and pass options as structured args — the true root design flaw, but the bake is deliberate (`00-request-normalization-stage.ts:99-101`); rewriting the normalization contract breaks "T0 ships alone". **Logged as a follow-up.**

**Interfaces**

```ts
serializeOptionValue(value: unknown): string   // string → JSON.stringify; else String(value)
parseQuotedValue(raw: string): string          // unescape "…" / '…' honouring backslash escapes
// applied identically at argument-parser.ts:248-251 and :254
```

---

## Phase 2.5 — Verification

All 11 paths verified present. **No shims** (smallest file 150 lines). Three corrections carried into Phase 3:

| #   | Correction                                                                                     | Evidence                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Split regex spans **248-251**, not line 249                                                    | `rg -n "rawArgs.match"` → 248 for the call, regex literal on 249                                                   |
| 2   | `findCategoryConfig` has **three** callsites (130 enabled, 396 frequency, 431 target), not one | `rg -n "findCategoryConfig"` — threading only 130 lets a prompt disable injection yet inherit a category frequency |
| 3   | T1 ADR is **`0001-`**                                                                          | `ls docs/adr/` → only `0000-template.md` + `README.md`                                                             |

---

## Phase 3 — Implementation Plan

### Tier T0 — lossless, injection-proof option round-trip _(disjoint from T1-T3; ships alone)_

| #   | Status | File                                                                | Change                                                                                                                                          | ~Lines | Depends  | Verify                                    |
| --- | ------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ----------------------------------------- |
| 0.1 | ✓      | `src/shared/utils/jsonUtils.ts`                                     | Add `serializeOptionValue` + `parseQuotedValue`; export from `shared/utils/index.ts`                                                            | ~30    | —        | `npm run typecheck`                       |
| 0.2 | ✓      | `…/stages/00-request-normalization-stage.ts:216`                    | Replace `` `'${value}'` `` ternary with `serializeOptionValue(value)`                                                                           | ~2     | 0.1      | test 0.5                                  |
| 0.3 | ✓      | `…/parsers/argument-parser.ts:248-251`                              | Split regex → escape-aware quoted alternatives                                                                                                  | ~4     | 0.1      | test 0.6                                  |
| 0.4 | ✓      | `…/parsers/argument-parser.ts:254-267`                              | Per-pair regex same; route quoted captures through `parseQuotedValue` before `.trim()`                                                          | ~8     | 0.1, 0.3 | test 0.6                                  |
| 0.5 | ✓      | `tests/unit/execution/pipeline/request-normalization-stage.test.ts` | Regression: value with (a) apostrophe (b) double quote (c) both (d) embedded `Word: phrase` — byte-identical arrival AND no undeclared argument | ~50    | 0.2      | `npm test -- request-normalization-stage` |
| 0.6 | ✓      | `tests/unit/execution/parsers/argument-parser.test.ts`              | Escaped quotes decode; pre-existing unescaped commands parse identically (compat lock)                                                          | ~40    | 0.3, 0.4 | `npm test -- argument-parser`             |

**T0 gate**: ✓ PASSED 2026-07-28 — typecheck clean · `lint:ratchet` OK (3531 errors / 1461 warnings, no regressions) · `test:ci` 134 suites / 1576 tests all pass · `validate:arch` 0 errors (2 pre-existing warnings in files not touched).

**Gate criterion CORRECTED after measurement.** It originally read "the four 0.5 cases fail on `git stash` and pass after." Measured: reverting only the serializer fails **two** of the four — the apostrophe case and the both-quotes case. The double-quote and phantom-argument cases passed under the old encoder _by luck_, because it wrapped values in single quotes and left `"` untouched. Those two are forward guards for the new escape convention, not reproductions of the original defect. Accurate criterion: **the two apostrophe-bearing cases fail without the fix and pass with it.**

**✓ Backslash pre-merge check RUN and CLEARED 2026-07-29 — and the warning it came from was wrong in scope.**

The warning read "a value containing a literal backslash changes meaning." Measured against the actual code, that is **false for the `options` path**: `serializeOptionValue` escapes `\` → `\\` and `parseQuotedValue` reverses it, so the round trip is lossless. Verified by executing both helpers over the real backslash-bearing values found in the corpus — Windows paths, `\s`/`\w`/`\d` regexes, escaped dots, trailing backslashes — **all 14 returned byte-identical**.

The risk is real only for a **hand-authored** quoted value, which never passes through the serializer: an author typing `path:'C:\Users\dev'` now receives `C:Usersdev`. That distinction was not in the original warning and is what made the check look scarier than it was.

**Corpus scan — no shipped prompt or resource is affected:**

| Scan                                                           | Result                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Files with any backslash under `resources/prompts/` (73 files) | 9 — all accounted for below                                                      |
| Backslashes in a quoted **option value**                       | **0**                                                                            |
| `>>command key:"…"` examples carrying a backslash              | **0** (the pattern itself occurs in 10 files, so the scan would have caught one) |
| Hand-authored raw backslash in a quoted value, repo-wide       | **0**                                                                            |

The 9 hits are all in positions that never reach the argument parser: regex patterns in YAML lists (`content_patterns` in 4 gates, phase-guard patterns in `verify`/`radiant`, `verdict-patterns.yaml`), `\n` inside JSON parameter examples (structured params bypass the command string entirely), shell line-continuations in bash code blocks, a markdown `\_` escape, and escaped fences in a template. Plus three Python script-tool files, which are not option values at all.

**Gap closed rather than just cleared.** The one breaking case was undocumented and unpinned — `argument-parser.test.ts:73` states the compat lock covers only commands that "contain no backslashes", so nothing tested the case that actually changed. Added `tests/unit/shared/option-value-round-trip.test.ts` (21 tests): losslessness across the corpus-realistic values, and the hand-authored semantics — single backslash consumed, doubled backslash yields one, control escapes and `\uXXXX` honoured, no-backslash values unchanged. Documented in `docs/reference/mcp-tools.md` § Quoting and escapes in argument values, with a before/after table and the rule "double any backslash you mean literally", stated where authors type these values. The tests exist so that doc and the code cannot drift.
⚠️ `import/order` regression caught by the ratchet on first attempt (new import must precede `../../validation/…`); fixed before the gate passed.

### Tier T1 — gate-resolution precedence _(BLOCKING; docs only)_

| #   | Status | File                                          | Change                                                                                                                                                                                                                                                                      | ~Lines | Verify       |
| --- | ------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------ |
| 1.1 | ✓      | `docs/adr/0001-gate-resolution-precedence.md` | **NEW.** Decide (a) total order among inline / include-exclude / category-auto / framework gates; (b) merge-or-override for inline gates; (c) methodology-gate nesting: unconditional or opt-in; (d) migration for prompts already shipping inert `inline_gate_definitions` | ~120   | Human review |

**T1 gate**: ✓ PASSED 2026-07-29 — ADR status Accepted; (a)-(d) each answered under its own heading. typecheck clean · `lint:ratchet` OK (3531/1461, no regressions) · `test:ci` 134 suites / 1576 tests pass · `validate:arch` 0 errors (2 pre-existing warnings, files not touched).

**Discovery changed the ADR's scope.** Three precedence specs exist in the tree and **two are unreachable**, so the ADR reconciles rather than adds:

| #   | Finding                                                                                                                                                                                                                          | Evidence                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| F1  | Source priority is **provenance-only, never subtractive** — rank decides which source label a duplicate ID keeps; the set is a union                                                                                             | `gate-accumulator.ts:43-84`                                             |
| F2  | **`framework_gates: false` is inert** — the planner's filter reads `enhancedGateConfiguration`, which has **5 readers and 0 writers** repo-wide                                                                                  | `execution-planner.ts:154`; `execution/types.ts:73`                     |
| F3  | `CategoryExtractor.selectGatesWithPrecedence` / `…WithEnhancedPrecedence` have **zero callers** — their documented 4/5-level precedence describes no live behavior, and conflates `framework_gates` into gating _category_ gates | `category-extractor.ts:229,363`                                         |
| F4  | `%lean` keeps framework-dependent gates while suppressing the methodology they score against                                                                                                                                     | `execution-planner.ts:464-466` vs `docs/guides/injection-control.md:77` |
| F5  | All 6 `inline_gate_definitions` consumers are display/analysis; a live registration seam already exists                                                                                                                          | `temporary-gate-registry.ts`, `temporary-gate-registrar.ts`             |

**Prior-art survey run before acceptance** (`>>tech_recommendation`, 5 systems: K8s admission, OPA/Rego, AWS Cedar, CSS cascade layers, ESLint flat config, `webpack-merge`). It confirmed the two-stage shape and corrected three specifics:

1. Stage 2's ordering was **spurious** — four of five steps are commutative removals, so it is now an unordered veto set with a permutation property test instead of a fixed chain.
2. Ordering had **silently answered a question by pipeline position**: a prompt author's `exclude` would have vetoed a gate the _caller_ typed. Each veto now declares a binding rank; `exclude` caps at **60**. ⚠️ Open for owner review — behavior choice, not a surveyed fact.
3. (b) gained **per-field** override semantics (declared replaces, omitted inherits, arrays replace rather than append) instead of one global "body wins" rule.

**T2/T3 must not start while any answer is open.** T1.5 now sits between T1 and T2 — see below.

### Tier T1.5 — one owner for gate resolution _(BLOCKING for T2/T3; no behavior change except 1.5.5)_

**Why this tier exists.** Pre-flight on the T2/T3 targets fails five checks at once: `domain` (selection logic sits in `engine/execution/planning`; CLAUDE.md's matrix declares `engine/gates` the owner), `layer` (`ExecutionPlanner` holds 8 private gate-domain methods), `defined` (F3 — precedence encoded 3×), `contracts` (F2 — read-only phantom field), `size` (`execution-planner.ts` 628 ln vs 200-600 services advisory). `refactoring.md` resolves `domain + layer + defined` to **Wrong domain boundary → re-scope first**. Building T2/T3 into the current boundary would add a **fourth** precedence site, against "consolidation over addition".

**Identification** (before shape): resolution is **stateless and per-request** over `(prompt, category, modifiers, frameworkId, methodologyInjected, callerGates, config)` → shape is a class with two injected deps and pure private internals. Rejected: extending `GateManager` — it is long-lived and holds the registry plus a state manager, so a per-request concern would load request scope onto a singleton. Rejected: a bare function module — the two deps would become two extra params at every callsite, against the house DI-by-constructor pattern.

| #     | Status | File                                                                                           | Change                                                                                                                                                                                                                                                                                                                         | ~Lines | Depends | Verify                                                                           |
| ----- | ------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------- | -------------------------------------------------------------------------------- |
| 1.5.1 | ✓      | `src/engine/gates/services/gate-set-resolver.ts`                                               | **NEW.** `GateSetResolver` owning ADR Stage 1 (ranked additive union) + Stage 2 (order-independent veto set with binding ranks). ⚠️ `frameworkId` and `methodologyInjected` arrive as **inputs** — importing `engine/frameworks` trips `no-frameworks-in-gates`, which is **error**-severity (`.dependency-cruiser.cjs:148`)   | 379    | T1      | `npm run typecheck` + `validate:arch`                                            |
| 1.5.2 | ✓      | `…/execution/planning/execution-planner.ts`                                                    | Delete the 8 gate-domain private methods — `loadMethodologyGateIds` :86, `applyModifierOverrides` :443, `shouldAutoAssignGates` :485, `autoAssignGates` :501, `collectExplicitGateIds` :522, `getPromptLevelIncludes` :542, `getPromptLevelExcludes` :554, `mergeGates` :566 — and have `createPlan` call `resolver.resolve()` | -114   | 1.5.1   | planner unit tests · `wc -l` back under 600                                      |
| 1.5.3 | ✓      | `…/gates/services/gate-enhancement-service.ts`                                                 | Route accumulation through the resolver (single-prompt **and** chain-step paths); `GateAccumulator` stays as the **provenance recorder** (F1 semantics preserved, not replaced). Deletes `selectRegistryGates`                                                                                                                 | -40    | 1.5.1   | enhancement unit tests + `test:ci`                                               |
| 1.5.7 | ✓      | `src/engine/gates/gate-manager.ts` + `tests/integration/gates/gate-category-selection.test.ts` | **DELETE** `getCategoryGates()` per ADR 0001's legacy-removal criterion. Landed **outside T3** (see note) — method removed (-47), suite migrated (+31/-17)                                                                                                                                                                     | ~-47   | 1.5.3   | ✓ `test:integration` 16/16 · `rg getCategoryGates` zero hits                     |
| 1.5.4 | ✓      | `…/execution/planning/category-extractor.ts`                                                   | **DELETE** `selectGatesWithPrecedence` (:229) + `selectGatesWithEnhancedPrecedence` (:363). Zero callers, competing order (F3)                                                                                                                                                                                                 | -280   | 1.5.2   | caller search returns nothing · `test:ci`                                        |
| 1.5.5 | ✓      | `src/engine/execution/types.ts` + its 5 readers                                                | **DELETE** `EnhancedGateConfiguration` + `enhancedGateConfiguration` (F2); repoint readers to `gateConfiguration`. **Arms `framework_gates: false`** — the one behavior change in this tier                                                                                                                                    | -23    | 1.5.1   | test: `framework_gates: false` drops methodology gates and leaves category gates |
| 1.5.6 | ✓      | `tests/unit/gates/services/gate-set-resolver.test.ts`                                          | **NEW.** Veto-set permutation invariance (any order → same set); rank-60 cap (caller gate survives a prompt `exclude`)                                                                                                                                                                                                         | 358    | 1.5.1   | `npm test -- gate-set-resolver`                                                  |

**T1.5 status: 7 of 7 rows landed 2026-07-29; gate MET.** (6 original + follow-up row 1.5.7, which closed outside the T3 invocation — see its note below.) typecheck clean · `lint:ratchet` OK and **improved** (3531→**3497** errors, 1461→**1442** warnings) · `test:ci` 135 suites / **1602** tests pass with **zero pre-existing tests modified** · `validate:arch` **0 errors** (same 2 pre-existing warnings, files untouched) · `execution-planner.ts` 628→514 lines, under the 600 advisory · dead-symbol grep (`selectGatesWithPrecedence`, `selectGatesWithEnhancedPrecedence`, `enhancedGateConfiguration`, `selectRegistryGates`) returns **zero hits** in `src/` · **26** resolver tests, including the 6-permutation invariance property, both directions of registry framework-awareness, and both authorized behavior fixes.

**Consolidation is now real**: `GateSetResolver` is the only place that decides which gates survive, for the planner path, the single-prompt enhancement path, and the chain-step path. `GateAccumulator` remains the provenance recorder; registry metadata enrichment (`retry_config`, `blockResponseOnFail`) stays in `GateEnhancementService`, which is enrichment rather than resolution.

**Pre-existing debt this tier improved but did not clear**: `enhanceSinglePrompt` (cyclomatic 23), `enhanceChainSteps` (30), `addRegistryGatesWithRetryConfig` (15), and `execution-planner.createPlan` (15, down from ~19) all still exceed the ≤10 limit. Each was over threshold before this tier and got smaller, not larger. Decomposing them is a planner/enhancement-service concern, not a gate-resolution one — separate tier.

**✓ The `registry-auto` gap is RESOLVED — owner decision 2026-07-29: the registry holds the semantic.** ADR 0001 § (a) now states that `registry-auto` **is** `GateManager.selectGates()`, the registry's own activation query, and that `getCategoryGates()` is a category-only convenience which no resolution path may use (it is now a deletion candidate, recorded under the ADR's legacy-removal criteria). Framework-awareness is expressed by the **context passed in**, never by switching queries.

The resolver was switched to `selectGates()` accordingly, and this is **behavior-neutral on the planner path** — verified, not assumed: `framework-compliance` is the only `gate_type: 'framework'` gate in the corpus and it declares `framework_context: [CAGEERF, ReACT, 5W1H, SCAMPER]`, so the AND logic at `gate-activation.ts:90-99` withholds it whenever no framework id is in context. The planner passes none, so it gets category gates only — the same set `getCategoryGates()` returned. Two tests pin both directions.

**Consequence: consolidation is partial until 1.5.3 lands.** The planner path has one owner; ranks 80/90/100 are still accumulated inside `GateEnhancementService`. T2/T3 are unblocked (both target the resolver, which exists and is wired).

**✓ 1.5.3 landed 2026-07-29 — owner authorized the two behavior fixes.** Both paths (`enhanceSinglePrompt` and `enhanceChainSteps`) now resolve through `GateSetResolver`. Delivered:

1. **`exclude` is now effective against registry gates.** Previously the planner honoured `exclude`, then `selectRegistryGates()` re-added the same gates at rank 20 with no exclude applied — so a prompt excluding a category-activated gate did not actually lose it. One veto set now covers every tier.
2. **`framework_gates: false` now reaches the methodology (40) and registry-auto (20) tiers**, not just the planner's set — completing 1.5.5's arming.
3. **The global `enableMethodologyGates: false` switch became a resolver veto** binding every rank, per ADR Stage 2.

Both fixes remove gates the author asked to remove — the same safe direction as 1.5.5.

**Four implementation findings, each of which would have changed behavior silently:**

- **`ensureDefaultMethodologyGate` and the global filter are mutually exclusive.** The earlier "move both or neither" caution was over-cautious: the additive step only fires when `enableMethodologyGates` is **true** (`:511`) and the filter only when it is **false**, so they can never interact. The veto moved alone, safely.
- **`selectRegistryGates` wrapped `selectGates` in a try/catch** that degraded to `[]` and warned. The resolver had no such guard, so a registry failure would have propagated and failed the whole resolution instead of dropping one tier. Ported before deleting the method, with a test.
- **`gateManagerProvider` must not be called in the constructor.** It is a provider precisely because the manager is wired _after_ this service is constructed — resolving it eagerly captured `undefined` for the process lifetime. The resolver is built per call, matching the planner.
- **Chain steps share one cumulative accumulator**: step N inherits gates from steps 1..N−1. Preserved explicitly, with a comment, because replacing the accumulator per step would have silently broken it.

Confirmed safe: the resolver's modifier veto mirrors `shouldSkip()` (`:57-62`) exactly — both fire on `clean` and `framework` — and stage 05 skips enhancement entirely in those cases, so `%clean` already yielded zero gates.

**✓ 1.5.7 CLOSED — landed outside the T3 invocation, verified not assumed.** Discovered during T3's scope review: `gate-manager.ts` carried an unexplained -47 and `gate-category-selection.test.ts` a +31/-17 that T3 did not produce. Checked rather than credited: `getCategoryGates()` is gone, `rg getCategoryGates` returns **zero hits** across `server/` (source _and_ tests), and the migrated suite passes **16/16**. The migration went the direction the ADR requires — the assertions that encoded the deprecated "excludes framework gates" contract were re-derived against the registry semantic, and the suite grew from 12 assertions to 16. The original blocker below stands as the reason it was a separate unit of work.

**Why it was deferred in the first place (retained — the reasoning still holds):** `getCategoryGates()` now has **zero `src/` callers**, so ADR 0001's legacy-removal criterion is met on the source side. But `tests/integration/gates/gate-category-selection.test.ts` is a **12-assertion suite dedicated to it**, and some of those assertions encode the very contract the ADR deprecated ("excludes framework gates"). Deleting the method without migrating them would break the build; migrating them means re-deriving each assertion against the registry semantic. Per `cleanup-standards.md` § Test Surface Audit the removal and its test migration belong together, so it is one focused unit of work rather than a loose end of this one. **`rg` over `src/` alone would have reported this as safe to delete** — the test surface is invisible to it.

**Deviations from the tier as planned** — all four are logged rather than silently absorbed:

1. **`applyModifierOverrides` was split, not deleted.** It returned _both_ the gate set and `requiresFramework`. Moving it whole would have put a framework decision inside `engine/gates`, which `no-frameworks-in-gates` exists to prevent. The gate half became the resolver's modifier veto; the framework half became `resolveFrameworkRequirement()` in the planner.
2. **`methodologyInjected` is passed as a literal `true`.** Feeding it the planner's real post-modifier `requiresFramework` would immediately make `%lean` drop `framework-compliance` — that is **2.4's** behavior change, and it would break this tier's byte-identical criterion. The veto is wired and unit-tested directly; 2.4 replaces the literal.
3. **Test path is `tests/unit/gates/services/`**, not the `tests/unit/gates/` the row specified — mirrors `src/engine/gates/services/`, matching the two sibling service tests.
4. **The per-field body-override test was dropped from 1.5.6.** The resolver resolves ids, not bodies; body merging is built in **3.3**. The row asked for a test of code that does not exist yet.

**A ratchet blind spot worth knowing.** `collectPromptConfigGateIds` shipped at cyclomatic 12 against a limit of 10, and `lint:ratchet` passed it — deleting nine methods lowered the project-wide count by more than the one new violation raised it. A ratchet measures direction, not conformance; per-file `npx eslint <path>` is what catches a new violation inside a net-negative diff. Fixed by splitting into three pure functions.

**Also found, out of scope:** `gate-analyzer.ts:449` keeps a private duplicate of the hardcoded category→gate map that 1.5.4 deleted from `CategoryExtractor`. Both duplicate the YAML activation rules. Separate debt, `mcp/tools` layer.

**Migration asymmetry — deliberate, do not unify.** 1.5.5 arms `framework_gates: false` immediately because it **removes** gates: it grants an opt-out the author already wrote and the docs already promise. T3's `inline_gate_definitions` keeps the two-release warn-then-arm from ADR (d) because it **adds** enforcement an author may have forgotten. Same class of inert config, opposite risk direction.

**Pre-existing condition, not created here**: `engine/gates/services/` already holds 11 files + barrel, past the "≤7 flat, then `internal/`" rule. 1.5.1 makes it 12. Reorganizing 11 files mid-extraction adds churn to a tier whose value is the extraction — logged as separate debt instead.

**T1.5 gate**: `test:ci` + `validate:arch` 0 errors · `execution-planner.ts` under the 600-line advisory · `rg "selectGatesWithPrecedence|selectGatesWithEnhancedPrecedence|enhancedGateConfiguration"` returns **zero** hits in `src/` · permutation test green · a prompt carrying no gate config resolves **byte-identically** to pre-change.

### Tier T2 — nest gates under methodology + per-prompt injection opt-out _(2.1-2.3 need T1c only; 2.4 needs T1.5)_

| #   | Status | File                                                                                                               | Change                                                                                                                                                                                                     | ~Lines | Depends       | Verify                                                                   |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------- | ------------------------------------------------------------------------ |
| 2.1 | ✓      | `src/modules/prompts/prompt-schema.ts` + `src/shared/types/injection.ts`                                           | Optional prompt-level injection block in zod schema (**both** `PromptDataSchema` and `PromptYamlSchema`); `PromptInjectionConfig`/`PromptInjectionRule`; `'prompt-config'` source + priority + description | ~95    | T1            | `npm run typecheck`                                                      |
| 2.2 | ✓      | `…/yaml-prompt-loader.ts` + `shared/types/index.ts` + `engine/execution/types.ts` + `modules/prompts/converter.ts` | Normalize through to `PromptData` **and** `ConvertedPrompt` (mirrors `normalizeGateConfiguration`, called at both normalization sites)                                                                     | ~75    | 2.1           | loader unit test (6 cases)                                               |
| 2.3 | ✓      | `…/injection/internal/hierarchy-resolver.ts` + `stages/07b-injection-control-stage.ts`                             | Prompt tier **between step and chain** — modifiers → runtime → step → **prompt** → chain → category → global → default. All **three** `findCategoryConfig` callsites covered (130, 396, 431)               | ~120   | 2.2, T1       | resolver unit test (8 cases)                                             |
| 2.4 | ✓      | `…/injection/methodology-injection.ts` **(NEW)** + 3 callsites                                                     | Derive `methodologyInjected` from pre-injection signals; replaces the literal `true` at `execution-planner.ts:133`, `gate-enhancement-service.ts:154` **and `:291`**                                       | ~100   | **T1.5**, T1c | 15 tests: `%lean` drops `framework-compliance`, non-framework unaffected |
| 2.5 | ✓      | `docs/guides/injection-control.md`, `docs/reference/prompt-yaml-schema.md`                                         | 8-level hierarchy + nesting rule + prompt-level examples; narrowed `injection-control.md:77` from "keep gates" to "keeps non-framework gates"                                                              | ~95    | 2.3, 2.4      | doc review                                                               |

⚠️ **2.4 was retargeted.** It originally named `decisions/gates/gate-enforcement-authority.ts`, which owns verdict parsing, enforcement-mode resolution and retry limits — **not selection**. Withholding gates belongs where the gate set and the injection decision are both in hand, which after T1.5 is `GateSetResolver`. Implementing it at the original address would have put selection logic into the enforcement authority and deepened the boundary problem T1.5 exists to fix.

**T2 gate**: ✓ PASSED 2026-07-29 — typecheck clean · `lint:ratchet` OK and **improved again** (3497→**3488** errors, 1442→**1440** warnings) · `test:ci` 136 suites / **1631** tests pass with **zero pre-existing tests modified** · `validate:arch` **0 errors** (same 2 pre-existing warnings, files untouched) · `validate:contracts` in sync · `npm run build` clean · integration suite **byte-identical to HEAD** (7 suites / 24 tests fail at HEAD _and_ here — verified in a throwaway `git worktree` at HEAD with symlinked `node_modules`, not assumed) · `%lean` schedules zero framework-dependent gates · a prompt setting `system-prompt.enabled: false` resolves via `prompt-config` over chain and category, independent of the active framework.

**The ordering trap 2.4 was built on top of.** 2.4 as written says to use "the resolved `methodologyInjected` input". Measured against the stage list in `prompt-execution-pipeline.ts:259-288`, the real order is `planning(04) → gates(05) → framework(06) → session(07) → injectionControl(07b)`. **All three literals live in stages that run before `context.state.injection` exists** — injection control is late because it needs the `currentStep` the session stage supplies. Reading the resolved decision at gate-resolution time would have read a value that is not there yet, and `?? true` on an absent value would have silently produced today's behavior while looking wired.

So 2.4 ships a **projection**, not the decision: `isMethodologyInjected()` answers the same question from the signals already settled at stage 04/05 — command modifiers, and the prompt's own declaration. Rejected alternatives: (a) moving `InjectionControlStage` earlier — it would drag the session stage ahead of the judge/framework flow, a pipeline-wide reorder for one boolean; (b) threading `InjectionConfig` into `ExecutionPlanner` and `GateEnhancementService` so they could run the real hierarchy — new constructor wiring in two services for the chain/category/global tiers, which no reproduced defect needs; (c) re-resolving gates after 07b — a second resolution site, which is what T1.5 deleted.

**Direction of error is chosen, and it is the safe one.** The tiers the projection cannot see (runtime overrides, chain/category/global `enabled`, frequency) can only make the true answer _more_ restrictive. Defaulting to "injected" means methodology gates are withheld **only on positive suppression** — someone explicitly turning the methodology off. No gate is ever dropped on a guess. Residual gap, documented rather than hidden: with the methodology disabled at the chain or global tier, methodology gates are still scheduled — unchanged from before 2.4, so a remaining gap, not a regression.

**2.4 turned out to be wiring, not building.** The nesting veto already existed from 1.5.1 (`gate-set-resolver.ts:272-274`) and its `rejects` predicate was already the right set: `GateLoader.getMethodologyGateIds()` filters exactly `gate_type === 'framework'` (`gate-loader.ts:279-284`), which is what 2.4 specifies. Only the signal was dishonest.

**Plan under-scoped 2.2 and 2.4; both were corrected upward.**

- **2.2 named one file; the route is five.** `gateConfiguration` — the sibling this mirrors — travels schema → `LoadedPromptFile` → normalize (**two** call sites) → `converter.ts` → `ConvertedPrompt`. Stopping at `PromptData` as the row specified would have left the block sitting in the registry where nothing reads it, which is **exactly the F2 defect this plan exists to fix**. Caught by asking which layer stage 07b actually reads from (`convertedPrompt`, same as `category`).
- **2.4 named one literal; there were three.** `gate-enhancement-service.ts:291` is the chain-step path. Flipping only the two the plan implied would have left `%lean` still scheduling framework gates for every chain step.
- **`yamlToPromptData` spreads passthrough fields**, so an un-destructured `injection` would have reached `PromptData` raw — normalized on the `LoadedPromptFile` path and unnormalized on the other. Destructured explicitly, with a test that pins it.

**Three findings worth keeping:**

- **`promptId` was a writer-only phantom** — set at `07b:136-138`, with zero readers anywhere in the injection module. The mirror image of F2 (readers, no writers). Half the seam 2.3 needed was already built and inert; the tier now uses it for diagnostics while the config itself travels as data, because a prompt's block lives in the prompt file and there is no `config.json` array to search by id.
- **An empty rule had to be made non-matching.** `{ 'system-prompt': {} }` would otherwise register as a hierarchy match and shadow the chain and category tiers while contributing no fields. Normalized away in the loader _and_ skipped in `findPromptConfig` — two layers, because either path can construct the input. Pinned at both levels.
- **`conditions` is deliberately absent from the prompt-level rule.** Every case in `InjectionConditionWhen` (`chain-position`, `step-number`, `previous-step-result`) describes a position in a chain, not a property of a prompt. Accepting it would have shipped a field nothing could act on — a new F2 in the same commit that removes the old one. The zod schema is `.strict()`, so a typo fails at load instead.

**Complexity: the tier's own addition was refactored away rather than absorbed.** Adding the prompt tier pushed `getFrequencyFromHierarchy` to cyclomatic 14 and `getTargetFromHierarchy` to 15, against a limit of 10. Both were the same shape — walk the tiers, take the first defined value — written out twice, which is _why_ the plan had to name three callsites. Replaced with one lazy `buildTierChain()` plus a generic `findInHierarchy()`; thunks preserve the original short-circuit so no extra tier is searched. Measured on that file: **34 → 23** lint problems, both complexity warnings gone.

**Per-file lint verified against HEAD for every touched file, not just the ratchet.** Three additions initially regressed a file (`import/order` ×2, `prettier` ×1) and one grew `loadYamlPrompt` from cyclomatic 31 to 32; all four were fixed — the loader guard moved into `applyInjectionConfig()` so a function already 3× over budget did not get worse, and `PromptData.injection` uses an inline `import(...)` type so it does not reorder an import group it has no stake in. Final state: every touched file at or below its HEAD count. This is the T1.5 ratchet lesson applied deliberately — the ratchet passed all four of these.

**Pre-existing debt this tier did not clear**: `07b-injection-control-stage.ts` is 305 lines against the 50-125 orchestration advisory (150 max) and holds seven private context-reader helpers, which `architecture.md` says orchestration may not define. It was already 282 lines with six of them; `getPromptInjection` is a seventh of exactly the same shape as `getCategoryId`. Extracting a service whose only job is reading one field off the context would be worse than the violation. The real fix is decomposing the stage's input builder — a stage concern, not an injection-hierarchy one, so it is logged here rather than done inside T2. `loadYamlPrompt` (31/38) and the four functions listed under T1.5 are likewise unchanged.

### Tier T3 — make inline gate definitions execute _(needs T1a/b/d + T1.5; 3.1 pullable now)_

| #   | Status | File                                                                                                                        | Change                                                                                                                                                                                                                | ~Lines | Depends                         | Verify     |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------- | ---------- |
| 3.1 | ✓      | `src/modules/prompts/yaml-prompt-loader.ts` + `markdown-prompt-parser.ts` + `loader.ts`                                     | Replace bare `continue` with a warn naming prompt, gate and **every** missing field. **Release N of ADR (d)'s warn-then-arm** — ships ON                                                                              | ~150   | — _(pulled forward as planned)_ | 16 tests   |
| 3.2 | ✓      | `…/gates/services/temporary-gate-registrar.ts` + `gate-set-resolver.ts` + `05-gate-enhancement-stage.ts` + `gates/types.ts` | Register prompt-scoped inline definitions through the existing `TemporaryGateRegistry` seam (F5); contribute canonical IDs at **rank 60 `prompt-config`**. Gated by `executeInlineGateDefinitions`, default **false** | ~230   | **T1.5**, 3.1                   | 12 tests   |
| 3.3 | ✓      | `…/gates/services/gate-body-merge.ts` **(NEW)** — retargeted, see below                                                     | Per-field body override per ADR (b): declared replaces, omitted inherits, arrays replace rather than append, objects replace rather than merge key-by-key                                                             | ~49    | 3.2                             | 15 tests   |
| 3.4 | ✓      | `docs/reference/{prompt-yaml-schema,gate-configuration}.md`                                                                 | Full inline-definition field table with a "survives normalization" column; execution-status section; scoped `gate-configuration.md` to standalone `gate.yaml` with a pointer                                          | ~60    | 3.3                             | doc review |
| 3.5 | ✓      | `CHANGELOG.md`                                                                                                              | `Deprecated` entry flagging the pending arm with why-you-care and what-to-do; plus the three T1.5/T2 behavior changes that were still unlogged                                                                        | ~10    | 3.3                             | —          |

**T3 gate**: ✓ PASSED 2026-07-29 — typecheck clean · `lint:ratchet` OK and **improved again** (3488→**3487** errors, 1440→**1438** warnings) · `test:ci` 139 suites / **1675** tests pass with **zero pre-existing tests modified** · `validate:arch` **0 errors** (same 2 pre-existing warnings) · `validate:contracts` in sync · `build` clean · integration suite **identical to the HEAD baseline** (7 suites / 24 tests, same as T2's measured baseline) · inline definitions appear in the resolved set attributed to `prompt-config` · a prompt declaring none resolves byte-identically.

**⚠️ The tier could not ship as one release, and that is ADR (d), not a shortfall.** ADR 0001 (d) sequences this explicitly: release N logs warnings and _"Definitions still do not execute"_; release N+1 registers and executes. The plan reinforces it — "Migration asymmetry — deliberate, do not unify." But the gate criterion ("names in the **executed** set") describes the N+1 outcome, so satisfying it in release N would have violated an accepted ADR.

Resolved with the mechanism **the plan's own Risks table already names as the rollback for this exact risk — "Feature-flag 3.2"**: all code lands, execution gated by `GatesConfig.executeInlineGateDefinitions`, default `false`. Release N behavior is unchanged; release N+1 is a default flip. Per `cleanup-standards.md` § Parity Gates Are Debt, the flag's retirement is written into its doc comment — the evidence that flips it (one release of clean warn logs) and the commit that deletes it (bake `true`, remove the field _and_ both branches). A knob parked at its baked value is a parallel system with a nicer name.

**⚠️ 3.3 was retargeted — the third plan row this tier to name the wrong file.** The row put per-field body override in `gate-set-resolver.ts`, but that resolver returns IDs and provenance; it has no body in its input or output. T1.5 already drew this line: _"registry metadata enrichment stays in `GateEnhancementService`, which is enrichment rather than resolution."_ Bodies are merged where bodies are assembled — a new pure `gate-body-merge.ts`, applied at registration. Implementing it in the resolver would have expanded a deliberately narrow contract to carry data it does not own. (2.2 and 2.4 were the first two; the pattern is that the plan's Files column was written before the boundaries T1.5 established.)

**A phantom API I wrote and deleted before it shipped.** The first `gate-body-merge.ts` exported `replacesWholesale()`, `arrayFields()`, and `objectFields()`. `replacesWholesale` ended in `|| true` — it could only ever return `true` — and the other two had no callers. That is the F2 shape this plan exists to remove: a declared surface nothing reads. Since ADR (b)'s three field kinds _all_ resolve to "declared replaces", the correct implementation is a shallow field-wise assignment; the per-kind table belongs in the doc comment as the statement of intent, with an explicit note that adding deep merge would contradict an accepted ADR. Final file: one exported function, 49 lines.

**Findings:**

- **The warning had to fire exactly once, and nearly fired twice.** `loadYamlPrompt` normalizes the gate config at its own site _and_ again inside `yamlToPromptData`, so attaching a logger to both would double every warning — and an operator counting affected prompts, which is the entire purpose of this release, would double-count. The logger is attached at one site only, chosen because it also sits past the cache-hit early return, so a definition warns once per load from disk rather than once per prompt reuse.
- **Markdown prompts warn too.** ADR (d)'s purpose is workspace-wide visibility, and markdown remains loadable, so the origin threads through `parseMarkdownPromptContent` → `parseGateConfiguration` as well. Without it, a markdown prompt would have armed silently at N+1.
- **The warning reports every offending field, not the first.** An author fixing one field per load cycle would otherwise need as many cycles as they have mistakes.
- **A parameter name collision caught by the compiler**: the loop already binds `const source = definition['source']`, so the new `source` parameter shadowed it. Renamed to `origin`.
- **Registration failures are contained per definition.** One unregisterable definition warns and is skipped, leaving the prompt's other gates intact — the same "degrade, don't take the prompt out of service" rule ADR (d) sets for malformed definitions. Pinned by a test that makes the first of two registrations throw.

**Complexity worked down rather than absorbed**: `normalizeInlineGateDefinitions` was **cyclomatic 23** before this tier and adding the warnings would have pushed it higher; split into validate / report / assemble, its warning is now **gone entirely** (under 10), and the file measured 31→27 lint problems. `parseGateConfiguration` and `parseMarkdownPromptContent` each gained a branch from a defaulted parameter — both defaults removed, callee defaults instead, both back to baseline. `buildInlineTemporaryGate` hit 11 and was split.

**Stage 05 was clean and I broke it, then fixed it.** Adding the flag check plus the single-vs-chain walk took `execute()` from 0 violations to cyclomatic 12. Rather than add a private helper — which `architecture.md` forbids in orchestration — the enablement check moved into the registrar and the prompt walk became an exported pure `inlineDefinitionCarriers()`. The stage is back to **0** and adds no branches of its own.

**Size rule revised on owner instruction (2026-07-29).** `temporary-gate-registrar.ts` reached 735 lines against the project's former hard "max 600, write-blocked". Assessed by responsibility instead of arithmetic: both entry points register temporary gates through the same registry seam, share `trackTemporaryGateScope`, and share the scope-id convention — one responsibility, two input shapes. Splitting would have produced a file justified only by a line count. `Applications/CLAUDE.md` § Layer Size Limits was rewritten to match global `refactoring.md`, which always called size **"SECONDARY — advisory"**: ranges are now diagnostics that oblige answering "how many responsibilities?", per-function complexity stays the hard mechanical gate, and Critical is reserved for size co-occurring with a second signal.

**One knowingly-kept lint finding**: `context.state.gates.temporaryGateIds ?? []` trips `no-unnecessary-condition` because the type declares the field non-optional while the runtime initializes it lazily. It mirrors the adjacent pre-existing line exactly, and the test suite hits the undefined case. The honest fix is correcting that pipeline-state type — a separate change with its own consumers to check.

### Parallelism

- **T0 ∥ T1** — disjoint code paths, fully parallel. Both complete.
- **T1.5 is a hard serialization point.** It rewrites the seam T2 and T3 both extend, so neither may start until its gate passes. Attempting T2 ∥ T1.5 means merging two rewrites of the same resolution path.
- **T2 / T3** — sequential T2 → T3 after T1.5. The earlier "concurrent if T1 assigns non-overlapping responsibilities" escape no longer applies: post-T1.5 both tiers land in `gate-set-resolver.ts`, so they overlap by construction.
- **3.1** is independent of T1 _and_ T1.5 and can be pulled forward now — it is also release N of the (d) migration, so shipping it early lengthens the warning window.
- **Within T1.5**: 1.5.1 is the foundation; 1.5.2/1.5.3/1.5.5/1.5.6 are parallel-eligible siblings once it lands; 1.5.4 waits on 1.5.2 (deleting the dead methods after the planner stops being the owner keeps each diff reviewable).

**New files in the whole plan**: the T1 ADR, plus T1.5's `gate-set-resolver.ts` and its test. Everything else extends an existing file. T0's helpers extend `jsonUtils.ts` specifically so encode and decode cannot drift apart again — the root cause there. T1.5's new file exists for the mirror-image reason: three copies of the resolution contract drifted because **no** file owned it.

---

## Phase 4-6 — Validation & Completion

### Testing strategy

| What                                                                                      | Type            | Location                                                            | Why                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Option value survives round-trip (apostrophe, `"`, both, `Word: phrase`)                  | Unit            | `tests/unit/execution/pipeline/request-normalization-stage.test.ts` | Deterministic string transform; the phantom-argument case is the real defect                                                                                                                                               |
| Escaped quotes decode; legacy commands unchanged                                          | Unit            | `tests/unit/execution/parsers/argument-parser.test.ts`              | Compat lock is what lets T0 ship alone                                                                                                                                                                                     |
| Veto set is permutation-invariant                                                         | Unit (property) | `tests/unit/gates/gate-set-resolver.test.ts`                        | The survey's finding: the four vetoes commute, so a fixed-order assertion would pin behavior that carries no meaning. This test is also the tripwire if a future non-commutative veto is added                             |
| Caller-supplied gate survives a prompt-level `exclude`                                    | Unit            | same                                                                | The rank-60 cap. Without this, a prompt author silently overrules the person invoking the prompt                                                                                                                           |
| Per-field body override — omitted inherits, declared array replaces                       | Unit            | same                                                                | ADR (b). "Body wins" was untestable at field granularity                                                                                                                                                                   |
| Resolution is byte-identical for a prompt with no gate config                             | Unit            | same                                                                | T1.5 is a refactor; this is what makes that claim checkable rather than asserted                                                                                                                                           |
| `%lean` schedules no framework-dependent gate                                             | Unit            | `tests/unit/gates/services/gate-set-resolver.test.ts`               | The exact reproduced incoherence. Location moved from `decisions/gates` when 2.4 was retargeted. Composed with the real projection rather than a hand-passed boolean, so the test fails if the signal is ever re-hardcoded |
| Methodology projection: modifiers, prompt opt-out, `%judge` override, default-to-injected | Unit            | `tests/unit/execution/injection/methodology-injection.test.ts`      | The pre-injection projection is where 2.4's correctness lives; the veto it feeds was already covered by 1.5.6                                                                                                              |
| Prompt-level injection opt-out honoured across enabled/frequency/target                   | Unit            | `tests/unit/execution/injection/hierarchy-resolver.test.ts`         | Three callsites — partial threading is the failure mode. One test per callsite, plus an empty-rule case proving a fieldless block cannot shadow the tier below                                                             |
| Inline gates reach the executed set                                                       | Integration     | gate integration suite                                              | Crosses a module boundary; unit tests would mock the seam under test                                                                                                                                                       |
| Module boundaries hold                                                                    | Arch            | `npm run validate:arch`                                             | T3 moves data `modules/prompts` → `engine/gates`, and T1.5 must not import `engine/frameworks` from `engine/gates` (error-severity rule)                                                                                   |

### Done criteria

| Criterion                           | Validation               | Pass                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No silent value corruption          | 0.5 tests                | Fail before, pass after                                                                                                                                                                                                     |
| No phantom arguments                | 0.5(d)                   | Only declared args reach the template                                                                                                                                                                                       |
| Backwards compatible                | `test:ci`                | Zero pre-existing tests changed to accommodate                                                                                                                                                                              |
| One owner for resolution            | `validate:arch` + review | No gate-domain logic left in `execution/planning`; `execution-planner.ts` under the 600-line advisory                                                                                                                       |
| Zero competing precedence encodings | `rg`                     | `selectGatesWithPrecedence`, `selectGatesWithEnhancedPrecedence`, `enhancedGateConfiguration` all return no hits in `src/`                                                                                                  |
| No read-only phantom contracts      | Review                   | Every declared gate-config field has a writer, or is deleted                                                                                                                                                                |
| Gates coherent with methodology     | 2.4 test                 | ✓ Zero framework gates under `%lean`, and under a prompt-level `system-prompt.enabled: false`. Bounded: the projection sees modifiers + prompt tier, not chain/global/frequency — it withholds only on positive suppression |
| Inline gates execute                | 3.2/3.3 tests            | ✓ Names in the resolved set at rank 60, attributed to `prompt-config`. **Behind `executeInlineGateDefinitions`, default `false` this release** per ADR (d) — the arm is release N+1, and the flag names its own retirement  |
| Docs match behaviour                | Review                   | No doc describes an unimplemented field                                                                                                                                                                                     |

### Risks

| Risk                                                                    | Impact                      | Mitigation                                                                                                                                                                                                              | Rollback                                               |
| ----------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Backslash-bearing values change meaning                                 | ~~Low, silent~~ **RETIRED** | Check run: `options` path is lossless (14/14 values byte-identical); zero shipped prompts affected. Only hand-authored quoted values are affected — now documented in `mcp-tools.md` and pinned by 21 tests             | Revert T0 (self-contained)                             |
| `%lean` change breaks users relying on "keep gates"                     | Medium                      | ADR decides opt-in vs unconditional; changelog                                                                                                                                                                          | Revert 2.4 only                                        |
| Inert inline gates become live on upgrade                               | **Medium-high**             | T1d migration position + changelog flag                                                                                                                                                                                 | Feature-flag 3.2                                       |
| T2/T3 conflict in gate resolution                                       | High if parallelised early  | T1 is a hard gate; T1.5 is a second one — both tiers land in the same file afterwards                                                                                                                                   | —                                                      |
| Partial threading of the prompt tier                                    | Medium, subtle              | 2.3 explicitly names all three callsites                                                                                                                                                                                | Revert 2.3                                             |
| T1.5 changes resolved gate sets while claiming to be a refactor         | **High, silent**            | The byte-identical baseline test (no gate config → same set) plus `test:ci` with zero pre-existing tests edited to accommodate. If a pre-existing test needs changing, that is the signal T1.5 stopped being a refactor | Revert T1.5 as one unit — it has no consumers until T2 |
| `GateSetResolver` reaches into `engine/frameworks` for the framework ID | Medium, caught at CI        | `no-frameworks-in-gates` is error-severity; 1.5.1 takes `frameworkId` + `methodologyInjected` as inputs                                                                                                                 | Fix forward — `validate:arch` blocks the merge         |
| Arming `framework_gates: false` (1.5.5) surprises a workspace           | Low                         | It removes gates the author already asked to remove, and the docs already promise the behavior; opposite risk direction to T3's inline gates                                                                            | Revert 1.5.5 alone                                     |
| `exclude` rank-60 cap is the wrong call                                 | Medium                      | ⚠️ Flagged for owner review; it is a behavior choice, not a surveyed fact. Changing it before 1.5.6 is cheap, after T3 is not                                                                                           | Change one constant + its test                         |

### Release

`commit_convention`: `fix(execution): …` for T0 · `docs(adr): …` for T1 · `refactor(gates): …` for T1.5 (except 1.5.5, which is `fix(gates): …` — it arms a flag) · `feat(gates): …` for T2/T3
`scope`: `execution`, `gates`, `prompts`, `adr`

**Owner decision — no commits until the whole plan lands** (2026-07-29). T0 is verified but uncommitted, and the tree also carries an unrelated `mcpPromptMode` launcher + phase-guard workstream. Consequence to remember at commit time: T0's stated rollback ("revert T0, self-contained") only holds if T0 lands as its own commit, so the boundaries above still apply when the batch is finally split.

**✓ The T0 pre-merge backslash check is RUN and CLEARED** (2026-07-29) — zero affected prompts, measured not assumed; the warning's scope was corrected, the one real breaking case is now documented and pinned by 21 tests. Details under Tier T0 above. **No outstanding pre-merge checks remain.**

### Growth capture

- [x] Memory: `claude-prompts-inline-gate-contract` — inline gates need `scope`+`guidance` to load **and never execute even then**
- [ ] Memory: option-apostrophe corruption — retire once T0 ships
- [x] `docs/TODO.md` §Known Issues — all four logged with file:line
- [ ] **Prompt defect — second occurrence confirmed, trigger met.** The "Design Enrichment (visual/creative/UI work)" block mis-fires on non-visual work. First seen in `>>implementation_plan`; on 2026-07-29 the same block fired inside `>>tech_recommendation` on a policy-resolution question, requesting Shadertoy / GDC / motion-design sources and Day-1 `bash` install steps for a design primitive with no package to install. It is a **shared block**, so the fix is one place, not two. Per the deferral rule in `project_prompt_evolution_backlog`, second occurrence is the trigger to act.
- [ ] Memory: architecture-diagnosis pattern — a capability documented as working, with readers but **zero writers**, is a stronger signal than a failing test: it means nobody ever exercised the path. Found `enhancedGateConfiguration` (F2) this way; the same grep shape (`rg -n "field" | grep -v` readers) found F3's zero-caller methods. Candidate for `/search` or `/refactoring`.
- [x] Prior-art survey recorded in ADR 0001 § Prior art rather than in memory — it is decision context for this codebase, so it belongs with the decision.

---

**GATE_REVIEW: PASS** — every path verified against the filesystem with literal tool output; the compound pre-flight diagnosis (`defined + contracts`) changed the fix strategy from "patch line 216" to "unify the quoting contract across serializer and both regexes"; T1 is correctly positioned as a blocking decision rather than parallel work.

**AMENDED 2026-07-29 after T1.** The original plan's shape was right but its boundary assumption was wrong: it treated gate resolution as one seam to extend, when discovery found three encodings of it and two unreachable (F1-F3). Pre-flight on the T2/T3 targets fails five checks, resolving to `domain + layer + defined` = **wrong domain boundary → re-scope first** — so T1.5 was inserted as a second blocking tier rather than letting T2/T3 add a fourth encoding. Item 2.4 was retargeted off `gate-enforcement-authority.ts`, which does not own selection. A prior-art survey (5 systems) run before accepting ADR 0001 corrected the subtractive stage from an ordered chain to an order-independent veto set, and surfaced one question the ordering had silently answered: whether a prompt author's `exclude` may veto the caller. It may not — ⚠️ that cap is the one decision still open for owner review.
